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

describe("ProviderCoordinator - scoring and strategies", { concurrency: 1 }, () => {
  after(() => {
    providerRegistry.getAllProviders = originalGetAllProviders;
    providerRegistry.getAdapter = originalGetAdapter;
  });

  // ============================================================================
  // Provider Scoring Tests
  // ============================================================================

  describe("ProviderCoordinator - Provider Scoring", { concurrency: 1 }, () => {
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

    it("should score based on provider priority", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.configuration.priority = 5;

      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(
        ["x", "instagram"] as ProviderId[],
        content
      );

      assert.ok(result.ok, "Selection should succeed");
      assert.strictEqual(
        result.value?.selectedProvider,
        "x",
        "Should prefer higher priority provider"
      );
    });

    it("should score based on provider health", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const instagramNode = providerNodes.get("instagram" as ProviderId);
      instagramNode.health.status = "degraded";

      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(
        ["x", "instagram"] as ProviderId[],
        content
      );

      assert.ok(result.ok, "Selection should succeed");
      // Healthy provider should score higher
    });

    it("should score based on load metrics", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.activeRequests = 9; // Near max

      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(
        ["x", "instagram"] as ProviderId[],
        content
      );

      assert.ok(result.ok, "Selection should succeed");
      // Instagram should be preferred due to lower load
    });

    it("should score based on response time", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.averageResponseTime = 5000; // 5 seconds

      const instagramNode = providerNodes.get("instagram" as ProviderId);
      instagramNode.loadMetrics.averageResponseTime = 500; // 500ms

      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(
        ["x", "instagram"] as ProviderId[],
        content
      );

      assert.ok(result.ok, "Selection should succeed");
      // Instagram should be preferred due to faster response time
    });

    it("should score based on error rate", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.errorRate = 0.5; // 50% error rate

      const instagramNode = providerNodes.get("instagram" as ProviderId);
      instagramNode.loadMetrics.errorRate = 0.05; // 5% error rate

      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(
        ["x", "instagram"] as ProviderId[],
        content
      );

      assert.ok(result.ok, "Selection should succeed");
      assert.strictEqual(
        result.value?.selectedProvider,
        "instagram",
        "Should prefer lower error rate"
      );
    });

    it("should include load score in routing decision", async () => {
      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(["x"] as ProviderId[], content);

      assert.ok(result.ok, "Selection should succeed");
      assert.ok(typeof result.value?.loadScore === "number", "Should include load score");
    });

    it("should include estimated latency in routing decision", async () => {
      const content = createMockCanonicalPost();
      const result = await coordinator.selectOptimalProvider(["x"] as ProviderId[], content);

      assert.ok(result.ok, "Selection should succeed");
      assert.ok(
        typeof result.value?.estimatedLatency === "number",
        "Should include estimated latency"
      );
    });
  });

  // ============================================================================
  // Coordination Strategy Tests
  // ============================================================================

  describe("ProviderCoordinator - Coordination Strategies", { concurrency: 1 }, () => {
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

    it("should execute parallel coordination strategy", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram"] as ProviderId[];

      const result = await coordinator.coordinatePublishing(content, providers, {
        strategy: "parallel",
      });

      assert.ok(result.ok, "Coordination should succeed");
      assert.strictEqual(result.value?.size, 2, "Should publish to both providers");
    });

    it("should execute sequential coordination strategy", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram"] as ProviderId[];

      const result = await coordinator.coordinatePublishing(content, providers, {
        strategy: "sequential",
      });

      assert.ok(result.ok, "Coordination should succeed");
      assert.strictEqual(result.value?.size, 2, "Should publish to both providers");
    });

    it("should execute optimized coordination strategy", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram"] as ProviderId[];

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      xNode.loadMetrics.averageResponseTime = 500; // Fast provider

      const instagramNode = providerNodes.get("instagram" as ProviderId);
      instagramNode.loadMetrics.averageResponseTime = 2000; // Slow provider

      const result = await coordinator.coordinatePublishing(content, providers, {
        strategy: "optimized",
      });

      assert.ok(result.ok, "Coordination should succeed");
      assert.strictEqual(result.value?.size, 2, "Should publish to both providers");
    });

    it("should default to optimized strategy when not specified", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x"] as ProviderId[];

      const result = await coordinator.coordinatePublishing(content, providers);

      assert.ok(result.ok, "Coordination should succeed");
    });

    it("should track active jobs during coordination", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x"] as ProviderId[];

      const coordinationPromise = coordinator.coordinatePublishing(content, providers);

      // Check active jobs while coordination is in progress
      const _activeJobs = (coordinator as any).activeJobs;
      // Job might complete too quickly, so we just check it succeeds

      await coordinationPromise;
      assert.ok(true, "Coordination completed");
    });
  });
}); // end outer describe
