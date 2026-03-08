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

describe("ProviderCoordinator - init and selection", { concurrency: 1 }, () => {
  after(() => {
    providerRegistry.getAllProviders = originalGetAllProviders;
    providerRegistry.getAdapter = originalGetAdapter;
  });

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe("ProviderCoordinator - Initialization", { concurrency: 1 }, () => {
    let coordinator: ProviderCoordinator;
    let mockPrisma: PrismaClient;
    let mockRedis: Redis;
    let mockEventService: EventService;

    beforeEach(() => {
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
    });

    afterEach(() => {
      (coordinator as any).healthCheckInterval &&
        clearInterval((coordinator as any).healthCheckInterval);
      (coordinator as any).metricsCollectionInterval &&
        clearInterval((coordinator as any).metricsCollectionInterval);
    });

    it("should initialize with provider nodes loaded", async () => {
      await coordinator.initialize();

      const providerNodes = (coordinator as any).providerNodes;
      assert.strictEqual(providerNodes.size, 2, "Should load 2 providers");
      assert.ok(providerNodes.has("x" as ProviderId), "Should have X provider");
      assert.ok(providerNodes.has("instagram" as ProviderId), "Should have Instagram provider");
    });

    it("should set up default configuration for each provider", async () => {
      await coordinator.initialize();

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      assert.ok(xNode, "X provider node should exist");
      assert.strictEqual(xNode.status, "active", "Provider should be active");
      assert.strictEqual(xNode.configuration.priority, 1, "Should have default priority");
      assert.strictEqual(
        xNode.configuration.maxConcurrentRequests,
        10,
        "Should have default max concurrent requests"
      );
      assert.ok(xNode.configuration.circuitBreaker.enabled, "Circuit breaker should be enabled");
    });

    it("should initialize load balancing strategy", async () => {
      await coordinator.initialize();

      const loadBalancer = (coordinator as any).loadBalancer;
      assert.strictEqual(loadBalancer.type, "weighted", "Should use weighted strategy");
      assert.strictEqual(loadBalancer.enabled, true, "Load balancer should be enabled");
      assert.ok(loadBalancer.parameters.responseTimeWeight, "Should have response time weight");
    });

    it("should not reinitialize if already initialized", async () => {
      await coordinator.initialize();
      const providerNodesSize = (coordinator as any).providerNodes.size;

      await coordinator.initialize();
      assert.strictEqual(
        (coordinator as any).providerNodes.size,
        providerNodesSize,
        "Should not reload providers"
      );
    });

    it("should register event handlers on initialization", async () => {
      await coordinator.initialize();

      const healthHandler = (mockEventService as any).getHandler("PROVIDER_HEALTH_CHANGED");
      const errorHandler = (mockEventService as any).getHandler("PROVIDER_ERROR");

      assert.ok(healthHandler, "Should register health changed handler");
      assert.ok(errorHandler, "Should register error handler");
    });
  });

  // ============================================================================
  // Provider Selection Tests
  // ============================================================================

  describe("ProviderCoordinator - Provider Selection", { concurrency: 1 }, () => {
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
          adapter: createMockProviderAdapter("x" as ProviderId, { latency: 100 }),
        },
        {
          id: "instagram" as ProviderId,
          adapter: createMockProviderAdapter("instagram" as ProviderId, { latency: 200 }),
        },
        {
          id: "facebook" as ProviderId,
          adapter: createMockProviderAdapter("facebook" as ProviderId, { latency: 150 }),
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

    it("should select provider with highest score", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram", "facebook"] as ProviderId[];

      const result = await coordinator.selectOptimalProvider(providers, content);

      assert.ok(result.ok, "Selection should succeed");
      assert.ok(result.value, "Should return routing decision");
      assert.ok(
        providers.includes(result.value.selectedProvider),
        "Should select one of available providers"
      );
    });

    it("should exclude inactive providers from selection", async () => {
      const content = createMockCanonicalPost();
      const providerNodes = (coordinator as any).providerNodes;

      const xNode = providerNodes.get("x" as ProviderId);
      xNode.status = "inactive";

      const result = await coordinator.selectOptimalProvider(["x"] as ProviderId[], content);

      assert.strictEqual(result.ok, false, "Should fail when no active providers");
      assert.ok(
        result.error?.message.includes("No valid providers"),
        "Should indicate no valid providers"
      );
    });

    it("should exclude providers in excludeProviders criteria", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram", "facebook"] as ProviderId[];

      const result = await coordinator.selectOptimalProvider(providers, content, {
        excludeProviders: ["x", "instagram"] as ProviderId[],
      });

      assert.ok(result.ok, "Selection should succeed");
      assert.strictEqual(result.value?.selectedProvider, "facebook", "Should select Facebook");
    });

    it("should return alternative providers in routing decision", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram", "facebook"] as ProviderId[];

      const result = await coordinator.selectOptimalProvider(providers, content);

      assert.ok(result.ok, "Selection should succeed");
      assert.ok(result.value?.alternativeProviders, "Should have alternative providers");
      assert.ok(
        result.value!.alternativeProviders.length > 0,
        "Should have at least one alternative"
      );
    });

    it("should include reasoning in routing decision", async () => {
      const content = createMockCanonicalPost();

      const result = await coordinator.selectOptimalProvider(["x"] as ProviderId[], content);

      assert.ok(result.ok, "Selection should succeed");
      assert.ok(result.value?.reasoning, "Should have reasoning");
      assert.ok(result.value!.reasoning.length > 0, "Should have reasoning items");
    });
  });
}); // end outer describe
