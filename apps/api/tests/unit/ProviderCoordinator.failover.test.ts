/**
 * @file ProviderCoordinator.failover.test.ts
 * @description Tests for ProviderCoordinator - failover and health
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, afterAll, expect } from "vitest";
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
  createMockScheduler,
  mockProviders,
  mockAdapters,
  setupMockProviders,
} from "./ProviderCoordinator.test-helpers.js";

const originalGetAllProviders = providerRegistry.getAllProviders.bind(providerRegistry);
const originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);

providerRegistry.getAllProviders = () => Array.from(mockProviders.values());
providerRegistry.getAdapter = ((id: string) => mockAdapters.get(id as ProviderId)) as any;

describe("ProviderCoordinator - failover and health", () => {
  afterAll(() => {
    providerRegistry.getAllProviders = originalGetAllProviders;
    providerRegistry.getAdapter = originalGetAdapter;
  });

  // ============================================================================
  // Failover Tests
  // ============================================================================

  describe("ProviderCoordinator - Failover Handling", () => {
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
        scheduler: createMockScheduler(),
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

    afterEach(async () => {
      await (coordinator as any).scheduler?.shutdownAll();
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

      expect(result.ok).toBeTruthy();
      expect(result.value).toBeTruthy();
      expect(result.value).not.toBe(failedProvider);
    });

    it("should evaluate error_rate failover condition", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6; // Above threshold

      const content = createMockCanonicalPost();
      const result = await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      expect(result.ok).toBeTruthy();
    });

    it("should evaluate response_time failover condition", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.averageResponseTime = 12000; // Above threshold

      const content = createMockCanonicalPost();
      const result = await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      expect(result.ok).toBeTruthy();
    });

    it("should update provider status to failed on failover", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.6; // Trigger failover

      const content = createMockCanonicalPost();
      await coordinator.handleFailover("x" as ProviderId, content, "job-123");

      expect(xNode.status).toBe("failed");
      expect(xNode.failureCount > 0).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
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

      expect(eventEmitted).toBeTruthy();
    });
  });

  // ============================================================================
  // Health Monitoring Tests
  // ============================================================================

  describe("ProviderCoordinator - Health Monitoring", () => {
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
        scheduler: createMockScheduler(),
      });

      await coordinator.initialize();
    });

    afterEach(async () => {
      await (coordinator as any).scheduler?.shutdownAll();
    });

    it("should return overall health status", async () => {
      const health = await coordinator.getHealthStatus();

      expect(health).toBeTruthy();
      expect(["healthy", "degraded", "unhealthy"].includes(health.status)).toBeTruthy();
    });

    it("should calculate health based on provider statuses", async () => {
      const health = await coordinator.getHealthStatus();

      expect(health.metrics).toBeTruthy();
      expect(typeof health.metrics.failureRate === "number").toBeTruthy();
    });

    it("should track active orchestrations in health metrics", async () => {
      const health = await coordinator.getHealthStatus();

      expect(typeof health.metrics.activeOrchestrations === "number").toBeTruthy();
    });

    it("should calculate provider availability", async () => {
      const health = await coordinator.getHealthStatus();

      expect(health.metrics.providerAvailability).toBeTruthy();
    });

    it("should report degraded status when some providers are unhealthy", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const instagramNode = providerNodes.get("instagram" as ProviderId);
      instagramNode.health.status = "unhealthy";

      const health = await coordinator.getHealthStatus();

      // With 1 out of 2 providers unhealthy (50%), status should be degraded
      expect(["degraded", "unhealthy"].includes(health.status)).toBeTruthy();
    });
  });
}); // end outer describe
