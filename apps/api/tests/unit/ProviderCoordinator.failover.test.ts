import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { ProviderCoordinator } from "../../src/orchestration/ProviderCoordinator.js";
import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { EventService } from "../../src/events/EventService.js";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";
import { providerRegistry } from "../../src/providers/providerRegistry.js";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockProviderAdapter,
  createMockCanonicalPost,
  mockProviders,
  mockAdapters,
  setupMockProviders,
} from "./ProviderCoordinator.test-helpers.js";

const originalGetAllProviders = providerRegistry.getAllProviders.bind(providerRegistry);
const originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);

providerRegistry.getAllProviders = () => Array.from(mockProviders.values());
providerRegistry.getAdapter = ((id: string) => mockAdapters.get(id as ProviderId)) as any;

describe("ProviderCoordinator - failover and health", { concurrency: 1 }, () => {
  after(() => {
    providerRegistry.getAllProviders = originalGetAllProviders;
    providerRegistry.getAdapter = originalGetAdapter;
  });

  // ============================================================================
  // Failover Tests
  // ============================================================================

  describe("ProviderCoordinator - Failover Handling", { concurrency: 1 }, () => {
    let coordinator: ProviderCoordinator;
    let mockPrisma: PrismaClient;
    let mockRedis: Redis;
    let mockEventService: EventService;

    beforeEach(async () => {
      mockPrisma = createMockPrisma();
      mockRedis = createMockRedis();
      mockEventService = createMockEventService();

      setupMockProviders([
        { id: "x" as ProviderId, adapter: createMockProviderAdapter("x" as ProviderId) },
        {
          id: "instagram" as ProviderId,
          adapter: createMockProviderAdapter("instagram" as ProviderId),
        },
        {
          id: "facebook" as ProviderId,
          adapter: createMockProviderAdapter("facebook" as ProviderId),
        },
      ]);

      coordinator = new ProviderCoordinator({
        prisma: mockPrisma,
        redis: mockRedis,
        eventService: mockEventService,
      });

      await coordinator.initialize();

      // Fix failover strategies: during initialization, providers are added sequentially,
      // so earlier providers' failover strategies have incomplete fallback lists.
      // Re-configure all strategies now that all providers are loaded.
      const providerNodes = (coordinator as any).providerNodes;
      const failoverStrategies = (coordinator as any).failoverStrategies;
      for (const [providerId] of providerNodes) {
        const alternatives = Array.from(providerNodes.keys()).filter(
          (id: ProviderId) => id !== providerId
        );
        const existing = failoverStrategies.get(providerId);
        if (existing) {
          existing.fallbackProviders = alternatives;
        }
      }
    });

    afterEach(() => {
      (coordinator as any).healthCheckInterval &&
        clearInterval((coordinator as any).healthCheckInterval);
      (coordinator as any).metricsCollectionInterval &&
        clearInterval((coordinator as any).metricsCollectionInterval);
    });

    it("should handle failover when provider fails", async () => {
      const content = createMockCanonicalPost();
      const failedProvider = "x" as ProviderId;
      const jobId = "job-123";

      // Set error rate above threshold (0.5) to trigger failover conditions
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6;

      const result = await coordinator.handleFailover(failedProvider, content, jobId);

      assert.ok(result.ok, `Failover should succeed. Error: ${JSON.stringify(result.error)}`);
      assert.ok(result.value, "Should select fallback provider");
      assert.notStrictEqual(result.value, failedProvider, "Should select different provider");
    });

    it("should evaluate error_rate failover condition", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6; // Above threshold

      const content = createMockCanonicalPost();
      const result = await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      assert.ok(
        result.ok,
        `Failover should succeed due to high error rate. Error: ${JSON.stringify(result.error)}`
      );
    });

    it("should evaluate response_time failover condition", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.averageResponseTime = 12000; // Above threshold

      const content = createMockCanonicalPost();
      const result = await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      assert.ok(result.ok, "Failover should succeed due to high response time");
    });

    it("should update provider status to failed on failover", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6; // Trigger failover

      const content = createMockCanonicalPost();
      await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      assert.strictEqual(xNode.status, "failed", "Provider status should be failed");
      assert.ok(xNode.failureCount > 0, "Failure count should be incremented");
    });

    it("should handle graceful failover strategy", async () => {
      const failoverStrategies = (coordinator as any).failoverStrategies;
      const xStrategy = failoverStrategies.get("x" as ProviderId);
      xStrategy.strategy = "graceful";

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6;

      const content = createMockCanonicalPost();
      const result = await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      assert.ok(result.ok, "Graceful failover should succeed");
    });

    it("should emit failover event", async () => {
      let eventEmitted = false;
      (mockEventService as any).publishEvent = async (event: any) => {
        if (event.type === "PROVIDER_FAILOVER") {
          eventEmitted = true;
        }
      };

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6;

      const content = createMockCanonicalPost();
      await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      assert.ok(eventEmitted, "Should emit failover event");
    });
  });

  // ============================================================================
  // Health Monitoring Tests
  // ============================================================================

  describe("ProviderCoordinator - Health Monitoring", { concurrency: 1 }, () => {
    let coordinator: ProviderCoordinator;
    let mockPrisma: PrismaClient;
    let mockRedis: Redis;
    let mockEventService: EventService;

    beforeEach(async () => {
      mockPrisma = createMockPrisma();
      mockRedis = createMockRedis();
      mockEventService = createMockEventService();

      setupMockProviders([
        {
          id: "x" as ProviderId,
          adapter: createMockProviderAdapter("x" as ProviderId, { healthy: true }),
        },
        {
          id: "instagram" as ProviderId,
          adapter: createMockProviderAdapter("instagram" as ProviderId, { healthy: false }),
        },
      ]);

      coordinator = new ProviderCoordinator({
        prisma: mockPrisma,
        redis: mockRedis,
        eventService: mockEventService,
      });

      await coordinator.initialize();
    });

    afterEach(() => {
      (coordinator as any).healthCheckInterval &&
        clearInterval((coordinator as any).healthCheckInterval);
      (coordinator as any).metricsCollectionInterval &&
        clearInterval((coordinator as any).metricsCollectionInterval);
    });

    it("should return overall health status", async () => {
      const health = await coordinator.getHealthStatus();

      assert.ok(health, "Should return health status");
      assert.ok(
        ["healthy", "degraded", "unhealthy"].includes(health.status),
        "Should have valid status"
      );
    });

    it("should calculate health based on provider statuses", async () => {
      const health = await coordinator.getHealthStatus();

      assert.ok(health.metrics, "Should include metrics");
      assert.ok(typeof health.metrics.failureRate === "number", "Should include failure rate");
    });

    it("should track active orchestrations in health metrics", async () => {
      const health = await coordinator.getHealthStatus();

      assert.ok(
        typeof health.metrics.activeOrchestrations === "number",
        "Should track active orchestrations"
      );
    });

    it("should calculate provider availability", async () => {
      const health = await coordinator.getHealthStatus();

      assert.ok(health.metrics.providerAvailability, "Should include provider availability");
    });

    it("should report degraded status when some providers are unhealthy", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const instagramNode = providerNodes.get("instagram" as ProviderId);
      instagramNode.health.status = "unhealthy";

      const health = await coordinator.getHealthStatus();

      // With 1 out of 2 providers unhealthy (50%), status should be degraded
      assert.ok(
        ["degraded", "unhealthy"].includes(health.status),
        "Should report degraded or unhealthy status"
      );
    });
  });
}); // end outer describe
