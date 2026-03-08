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

describe(
  "ProviderCoordinator - balancing, events, metrics, circuit breaker",
  { concurrency: 1 },
  () => {
    after(() => {
      providerRegistry.getAllProviders = originalGetAllProviders;
      providerRegistry.getAdapter = originalGetAdapter;
    });

    // ============================================================================
    // Load Balancing Tests
    // ============================================================================

    describe("ProviderCoordinator - Load Balancing", { concurrency: 1 }, () => {
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

        assert.ok(result.ok, "Update should succeed");
        assert.strictEqual(
          (coordinator as any).loadBalancer.type,
          "round_robin",
          "Strategy should be updated"
        );
      });

      it("should validate load balancing strategy type", async () => {
        const invalidStrategy = {
          type: "invalid_type" as any,
          parameters: {},
          enabled: true,
        };

        const result = await coordinator.updateLoadBalancingStrategy(invalidStrategy);

        assert.strictEqual(result.ok, false, "Should reject invalid strategy");
        assert.ok(result.error?.message.includes("Invalid"), "Should indicate validation error");
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

        assert.ok(result.ok, "Should accept weighted strategy");
      });

      it("should support least_connections load balancing", async () => {
        const strategy = {
          type: "least_connections" as const,
          parameters: {},
          enabled: true,
        };

        const result = await coordinator.updateLoadBalancingStrategy(strategy);

        assert.ok(result.ok, "Should accept least_connections strategy");
      });

      it("should support response_time load balancing", async () => {
        const strategy = {
          type: "response_time" as const,
          parameters: {},
          enabled: true,
        };

        const result = await coordinator.updateLoadBalancingStrategy(strategy);

        assert.ok(result.ok, "Should accept response_time strategy");
      });

      it("should persist load balancing strategy to Redis", async () => {
        const strategy = {
          type: "round_robin" as const,
          parameters: {},
          enabled: true,
        };

        await coordinator.updateLoadBalancingStrategy(strategy);

        const stored = await mockRedis.get("coordinator:load_balancer");
        assert.ok(stored, "Should persist strategy to Redis");
        assert.strictEqual(JSON.parse(stored!).type, "round_robin", "Stored strategy should match");
      });
    });

    // ============================================================================
    // Event Handling Tests
    // ============================================================================

    describe("ProviderCoordinator - Event Handling", { concurrency: 1 }, () => {
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
        assert.ok(handler, "Should have health changed handler");

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
        assert.strictEqual(xNode.health.status, "degraded", "Should update provider health");
      });

      it("should handle PROVIDER_ERROR event", async () => {
        const handler = (mockEventService as any).getHandler("PROVIDER_ERROR");
        assert.ok(handler, "Should have error handler");

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

        assert.ok(xNode.failureCount > initialFailureCount, "Should increment failure count");
        assert.ok(xNode.loadMetrics.errorRate > 0, "Should increase error rate");
      });
    });

    // ============================================================================
    // Metrics Collection Tests
    // ============================================================================

    describe("ProviderCoordinator - Metrics Collection", { concurrency: 1 }, () => {
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
        assert.ok(
          xNode.loadMetrics.errorRate <= initialErrorRate,
          "Error rate should not increase on success"
        );
      });

      it("should track response time in metrics", async () => {
        const content = createMockCanonicalPost();
        const providers = ["x"] as ProviderId[];

        await coordinator.coordinatePublishing(content, providers);

        const providerNodes = (coordinator as any).providerNodes;
        const xNode = providerNodes.get("x" as ProviderId);

        assert.ok(xNode.loadMetrics.averageResponseTime >= 0, "Should track response time");
      });

      it("should track active requests during publishing", async () => {
        const content = createMockCanonicalPost();
        const providers = ["x"] as ProviderId[];

        await coordinator.coordinatePublishing(content, providers);

        // After completion, active requests should be 0
        const providerNodes = (coordinator as any).providerNodes;
        const xNode = providerNodes.get("x" as ProviderId);

        assert.strictEqual(
          xNode.loadMetrics.activeRequests,
          0,
          "Active requests should be decremented"
        );
      });
    });

    // ============================================================================
    // Circuit Breaker Integration Tests
    // ============================================================================

    describe("ProviderCoordinator - Circuit Breaker Integration", { concurrency: 1 }, () => {
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

        assert.ok(xNode.configuration.circuitBreaker, "Should have circuit breaker config");
        assert.ok(xNode.configuration.circuitBreaker.enabled, "Circuit breaker should be enabled");
        assert.ok(
          xNode.configuration.circuitBreaker.failureThreshold > 0,
          "Should have failure threshold"
        );
      });

      it("should configure retry policy for each provider", async () => {
        const providerNodes = (coordinator as any).providerNodes;
        const xNode = providerNodes.get("x" as ProviderId);

        assert.ok(xNode.configuration.retryPolicy, "Should have retry policy");
        assert.strictEqual(
          xNode.configuration.retryPolicy.maxAttempts,
          3,
          "Should have max attempts"
        );
        assert.ok(
          xNode.configuration.retryPolicy.exponentialBackoff,
          "Should use exponential backoff"
        );
      });

      it("should configure rate limiting for each provider", async () => {
        const providerNodes = (coordinator as any).providerNodes;
        const xNode = providerNodes.get("x" as ProviderId);

        assert.ok(xNode.configuration.rateLimit, "Should have rate limit config");
        assert.ok(xNode.configuration.rateLimit.requestsPerMinute > 0, "Should have RPM limit");
        assert.ok(xNode.configuration.rateLimit.burstSize > 0, "Should have burst size");
      });
    });
  }
); // end outer describe
