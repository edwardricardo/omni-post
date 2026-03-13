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
  mockProviders,
  mockAdapters,
  setupMockProviders,
} from "./ProviderCoordinator.test-helpers.js";

const originalGetAllProviders = providerRegistry.getAllProviders.bind(providerRegistry);
const originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);

providerRegistry.getAllProviders = () => Array.from(mockProviders.values());
providerRegistry.getAdapter = ((id: string) => mockAdapters.get(id as ProviderId)) as any;

describe("ProviderCoordinator - balancing, events, metrics, circuit breaker", () => {
  afterAll(() => {
    providerRegistry.getAllProviders = originalGetAllProviders;
    providerRegistry.getAdapter = originalGetAdapter;
  });

  // ============================================================================
  // Load Balancing Tests
  // ============================================================================

  describe("ProviderCoordinator - Load Balancing", () => {
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

    it("should update load balancing strategy", async () => {
      const newStrategy = {
        type: "round_robin" as const,
        parameters: {},
        enabled: true,
      };

      const result = await coordinator.updateLoadBalancingStrategy(newStrategy);

      expect(result.ok).toBeTruthy();
      expect((coordinator as any).loadBalancer.type).toBe("round_robin");
    });

    it("should validate load balancing strategy type", async () => {
      const invalidStrategy = {
        type: "invalid_type" as any,
        parameters: {},
        enabled: true,
      };

      const result = await coordinator.updateLoadBalancingStrategy(invalidStrategy);

      expect(result.ok).toBe(false);
      expect(result.error?.message.includes("Invalid")).toBeTruthy();
    });

    it("should support weighted load balancing", async () => {
      const strategy = {
        type: "weighted" as const,
        parameters: {
          responseTimeWeight: 0.5,
          errorRateWeight: 0.3,
          loadWeight: 0.2,
        },
        enabled: true,
      };

      const result = await coordinator.updateLoadBalancingStrategy(strategy);

      expect(result.ok).toBeTruthy();
    });

    it("should support least_connections load balancing", async () => {
      const strategy = {
        type: "least_connections" as const,
        parameters: {},
        enabled: true,
      };

      const result = await coordinator.updateLoadBalancingStrategy(strategy);

      expect(result.ok).toBeTruthy();
    });

    it("should support response_time load balancing", async () => {
      const strategy = {
        type: "response_time" as const,
        parameters: {},
        enabled: true,
      };

      const result = await coordinator.updateLoadBalancingStrategy(strategy);

      expect(result.ok).toBeTruthy();
    });

    it("should persist load balancing strategy to Redis", async () => {
      const strategy = {
        type: "round_robin" as const,
        parameters: {},
        enabled: true,
      };

      await coordinator.updateLoadBalancingStrategy(strategy);

      const stored = await mockRedis.get("coordinator:load_balancer");
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!).type).toBe("round_robin");
    });
  });

  // ============================================================================
  // Event Handling Tests
  // ============================================================================

  describe("ProviderCoordinator - Event Handling", () => {
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

    it("should handle PROVIDER_HEALTH_CHANGED event", async () => {
      const handler = (mockEventService as any).getHandler("PROVIDER_HEALTH_CHANGED");
      expect(handler).toBeTruthy();

      await handler.handle({
        id: "evt-123",
        type: "PROVIDER_HEALTH_CHANGED",
        aggregateId: "x",
        aggregateType: "Provider",
        version: 1,
        data: {
          providerId: "x",
          health: { status: "degraded", uptime: 80 },
        },
        metadata: {},
        timestamp: new Date(),
      });

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      expect(xNode.health.status).toBe("degraded");
    });

    it("should handle PROVIDER_ERROR event", async () => {
      const handler = (mockEventService as any).getHandler("PROVIDER_ERROR");
      expect(handler).toBeTruthy();

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      const initialFailureCount = xNode.failureCount;

      await handler.handle({
        id: "evt-123",
        type: "PROVIDER_ERROR",
        aggregateId: "x",
        aggregateType: "Provider",
        version: 1,
        data: {
          providerId: "x",
          error: "Connection timeout",
        },
        metadata: {},
        timestamp: new Date(),
      });

      expect(xNode.failureCount > initialFailureCount).toBeTruthy();
      expect(xNode.loadMetrics.errorRate > 0).toBeTruthy();
    });
  });

  // ============================================================================
  // Metrics Collection Tests
  // ============================================================================

  describe("ProviderCoordinator - Metrics Collection", () => {
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

    it("should update provider metrics after publishing", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x"] as ProviderId[];

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);
      const initialErrorRate = xNode.loadMetrics.errorRate;

      await coordinator.coordinatePublishing(content, providers);

      // Successful publish should decrease error rate
      expect(xNode.loadMetrics.errorRate <= initialErrorRate).toBeTruthy();
    });

    it("should track response time in metrics", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x"] as ProviderId[];

      await coordinator.coordinatePublishing(content, providers);

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      expect(xNode.loadMetrics.averageResponseTime >= 0).toBeTruthy();
    });

    it("should track active requests during publishing", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x"] as ProviderId[];

      await coordinator.coordinatePublishing(content, providers);

      // After completion, active requests should be 0
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      expect(xNode.loadMetrics.activeRequests).toBe(0);
    });
  });

  // ============================================================================
  // Circuit Breaker Integration Tests
  // ============================================================================

  describe("ProviderCoordinator - Circuit Breaker Integration", () => {
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

    it("should configure circuit breaker for each provider", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      expect(xNode.configuration.circuitBreaker).toBeTruthy();
      expect(xNode.configuration.circuitBreaker.enabled).toBeTruthy();
      expect(xNode.configuration.circuitBreaker.failureThreshold > 0).toBeTruthy();
    });

    it("should configure retry policy for each provider", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      expect(xNode.configuration.retryPolicy).toBeTruthy();
      expect(xNode.configuration.retryPolicy.maxAttempts).toBe(3);
      expect(xNode.configuration.retryPolicy.exponentialBackoff).toBeTruthy();
    });

    it("should configure rate limiting for each provider", async () => {
      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      expect(xNode.configuration.rateLimit).toBeTruthy();
      expect(xNode.configuration.rateLimit.requestsPerMinute > 0).toBeTruthy();
      expect(xNode.configuration.rateLimit.burstSize > 0).toBeTruthy();
    });
  });
}); // end outer describe
