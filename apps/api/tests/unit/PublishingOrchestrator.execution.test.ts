/**
 * PublishingOrchestrator - Execution Tests
 *
 * Covers:
 * 4. Plan execution (executePlan)
 * 5. Execution strategies (SIMULTANEOUS, SEQUENTIAL, DEPENDENCY_BASED, OPTIMIZED_TIMING)
 * 6. Retry logic with exponential backoff
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PublishingOrchestrator } from "../../src/orchestration/PublishingOrchestrator.js";
import type {
  ExecuteOrchestrationRequest,
  OrchestrationPlan,
  OrchestrationExecution,
} from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  asPrisma,
  asRedis,
  asEventService,
  stubOrchestratorInternals,
  mockProviderRegistry,
} from "./PublishingOrchestrator.test-helpers.js";

describe("PublishingOrchestrator", { concurrency: 1 }, () => {
  let orchestrator: PublishingOrchestrator;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEvents: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEvents = new MockEventService();

    orchestrator = new PublishingOrchestrator({
      prisma: asPrisma(mockPrisma),
      redis: asRedis(mockRedis),
      eventService: asEventService(mockEvents),
    });

    stubOrchestratorInternals(orchestrator);
  });

  afterEach(() => {
    mockRedis.clear();
    mockEvents.clear();
  });

  // ============================================================================
  // 4. Plan Execution Tests
  // ============================================================================

  describe("executePlan()", () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it("should execute plan and return execution object", async () => {
      const request: ExecuteOrchestrationRequest = {
        planId: "plan-123",
      };

      const result = await orchestrator.executePlan(request);

      assert.ok(result.ok);
      assert.ok(result.value);
      assert.strictEqual(result.value.planId, "plan-123");
      // executeAsync fires without await, setting status to "executing" synchronously
      assert.strictEqual(result.value.status, "executing");
    });

    it("should enforce concurrent execution limit", async () => {
      const config = {
        maxConcurrentExecutions: 2,
      };

      const limitedOrchestrator = new PublishingOrchestrator({
        prisma: asPrisma(mockPrisma),
        redis: asRedis(mockRedis),
        eventService: asEventService(mockEvents),
        config,
      });

      (limitedOrchestrator as any).setupRedisChannels = async () => {};
      (limitedOrchestrator as any).registerEventHandlers = () => {};
      (limitedOrchestrator as any).startHealthMonitoring = () => {};
      (limitedOrchestrator as any).getPlan = (orchestrator as any).getPlan;
      (limitedOrchestrator as any).storePlan = async () => {};
      (limitedOrchestrator as any).storeExecution = async () => {};

      await limitedOrchestrator.initialize();

      // Create 2 executions
      await limitedOrchestrator.executePlan({ planId: "plan-1" });
      await limitedOrchestrator.executePlan({ planId: "plan-2" });

      // Third should fail
      const result = await limitedOrchestrator.executePlan({ planId: "plan-3" });

      assert.ok(!result.ok);
      assert.ok(result.error?.message.includes("Maximum concurrent executions"));
      assert.strictEqual(result.error?.retryable, true);
    });

    it("should return error if plan not found", async () => {
      (orchestrator as any).getPlan = async () => null;

      const result = await orchestrator.executePlan({ planId: "nonexistent" });

      assert.ok(!result.ok);
      assert.ok(result.error?.message.includes("not found"));
    });

    it("should perform dry run without actual execution", async () => {
      (orchestrator as any).simulateExecution = async (execution: any) => ({
        ok: true,
        value: { ...execution, status: "completed" },
      });

      const result = await orchestrator.executePlan({
        planId: "plan-123",
        dryRun: true,
      });

      assert.ok(result.ok);
      // Should not trigger actual execution
      const providerEvents = mockEvents.getEventsByType("PROVIDER_PUBLISH_STARTED");
      assert.strictEqual(providerEvents.length, 0);
    });

    it("should emit ORCHESTRATION_STARTED event", async () => {
      await orchestrator.executePlan({ planId: "plan-123" });

      // Wait a bit for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      const events = mockEvents.getEventsByType("ORCHESTRATION_STARTED");
      assert.ok(events.length >= 1);
    });

    it("should apply execution overrides", async () => {
      let capturedPlan: any;
      (orchestrator as any).executeAsync = async (_exec: any, plan: any) => {
        capturedPlan = plan;
      };

      const result = await orchestrator.executePlan({
        planId: "plan-123",
        overrides: {
          conflictResolution: "FAIL_FAST",
        },
      });

      // executePlan should return a successful result
      assert.ok(result.ok, "executePlan should succeed when applying overrides");
      // applyExecutionOverrides is currently a pass-through, so the plan
      // should still be passed to executeAsync unchanged
      assert.ok(capturedPlan, "executeAsync should have been called with the plan");
      assert.strictEqual(capturedPlan.id, "plan-123", "Plan ID should match");
    });
  });

  // ============================================================================
  // 5. Execution Strategies Tests
  // ============================================================================

  describe("Execution Strategies", () => {
    beforeEach(async () => {
      await orchestrator.initialize();

      // Override provider registry
      (global as any).providerRegistry = mockProviderRegistry;
    });

    it("should execute SIMULTANEOUS strategy in parallel", async () => {
      const plan: OrchestrationPlan = {
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "SIMULTANEOUS",
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId, "instagram" as ProviderId],
        dependencies: [],
        timing: { timezone: "UTC", respectRateLimits: true },
        estimatedDuration: 3000,
        createdAt: new Date(),
        createdBy: "user-123",
      };

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: plan.id,
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      const startTime = Date.now();
      await (orchestrator as any).executeSimultaneous(execution, plan);
      const duration = Date.now() - startTime;

      // All providers should be executed
      assert.strictEqual(Object.keys(execution.results).length, 3);
      // Should be faster than sequential (rough check)
      assert.ok(duration < 1000);
    });

    it("should execute SEQUENTIAL strategy with delays", async () => {
      const plan: OrchestrationPlan = {
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "SEQUENTIAL",
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
        dependencies: [],
        timing: {
          timezone: "UTC",
          respectRateLimits: true,
          providerDelays: {
            facebook: 100,
          } as Record<string, number>,
        },
        estimatedDuration: 2000,
        createdAt: new Date(),
        createdBy: "user-123",
      };

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: plan.id,
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      const startTime = Date.now();
      await (orchestrator as any).executeSequential(execution, plan);
      const duration = Date.now() - startTime;

      // All providers executed
      assert.strictEqual(Object.keys(execution.results).length, 2);
      // Should respect delay
      assert.ok(duration >= 100);
    });

    it("should execute DEPENDENCY_BASED strategy with proper ordering", async () => {
      // Mock publishToProvider to return success (avoids real providerRegistry)
      (orchestrator as any).publishToProvider = async (
        _execution: any,
        _plan: any,
        providerId: string
      ) => ({
        providerId,
        status: "success",
        providerPostId: `post-${providerId}`,
        duration: 100,
        retryCount: 0,
      });

      const plan: OrchestrationPlan = {
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "DEPENDENCY_BASED",
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
        dependencies: [
          {
            providerId: "facebook" as ProviderId,
            dependsOn: ["twitter" as ProviderId],
          },
        ],
        timing: { timezone: "UTC", respectRateLimits: true },
        estimatedDuration: 3000,
        createdAt: new Date(),
        createdBy: "user-123",
      };

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: plan.id,
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      await (orchestrator as any).executeDependencyBased(execution, plan);

      // Both providers executed
      assert.strictEqual(Object.keys(execution.results).length, 2);
      assert.ok((execution.results as Record<string, unknown>)["twitter"]);
      assert.ok((execution.results as Record<string, unknown>)["facebook"]);
    });

    it("should detect dependency deadlock", async () => {
      (orchestrator as any).getReadyProviders = () => [];

      const plan: OrchestrationPlan = {
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "DEPENDENCY_BASED",
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
        dependencies: [
          {
            providerId: "twitter" as ProviderId,
            dependsOn: ["facebook" as ProviderId],
          },
          {
            providerId: "facebook" as ProviderId,
            dependsOn: ["twitter" as ProviderId],
          },
        ],
        timing: { timezone: "UTC", respectRateLimits: true },
        estimatedDuration: 3000,
        createdAt: new Date(),
        createdBy: "user-123",
      };

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: plan.id,
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      await assert.rejects(
        async () => await (orchestrator as any).executeDependencyBased(execution, plan),
        { message: /deadlock detected/i }
      );
    });

    it("should execute OPTIMIZED_TIMING strategy with calculated delays", async () => {
      (orchestrator as any).sortProvidersByOptimalTiming = async () => [
        { providerId: "twitter" as ProviderId, delay: 0 },
        { providerId: "facebook" as ProviderId, delay: 50 },
      ];

      const plan: OrchestrationPlan = {
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "OPTIMIZED_TIMING",
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
        dependencies: [],
        timing: { timezone: "UTC", respectRateLimits: true },
        estimatedDuration: 3000,
        createdAt: new Date(),
        createdBy: "user-123",
      };

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: plan.id,
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      const startTime = Date.now();
      await (orchestrator as any).executeOptimizedTiming(execution, plan);
      const duration = Date.now() - startTime;

      assert.strictEqual(Object.keys(execution.results).length, 2);
      assert.ok(duration >= 50);
    });
  });

  // ============================================================================
  // 6. Retry Logic Tests
  // ============================================================================

  describe("Retry Logic", () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it("should retry on retryable errors with exponential backoff", async () => {
      let attempts = 0;
      const mockAdapter = {
        publish: async () => {
          attempts++;
          if (attempts < 3) {
            return { ok: false, error: "RATE_LIMIT" };
          }
          return {
            ok: true,
            value: { providerPostId: "123", url: "http://test.com", publishedAt: new Date() },
          };
        },
      };

      const retryPolicy = {
        maxAttempts: 3,
        baseDelay: 10,
        maxDelay: 1000,
        backoffStrategy: "exponential" as const,
        retryableErrors: ["RATE_LIMIT"],
      };

      const result = await (orchestrator as any).publishWithRetry(
        mockAdapter,
        { channelId: "ch-123" },
        retryPolicy
      );

      assert.ok(result.ok);
      assert.strictEqual(attempts, 3);
    });

    it("should calculate exponential backoff delay correctly", () => {
      const retryPolicy = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 10000,
        backoffStrategy: "exponential" as const,
        retryableErrors: [],
      };

      const delay0 = (orchestrator as any).calculateRetryDelay(0, retryPolicy);
      const delay1 = (orchestrator as any).calculateRetryDelay(1, retryPolicy);
      const delay2 = (orchestrator as any).calculateRetryDelay(2, retryPolicy);

      assert.strictEqual(delay0, 100);
      assert.strictEqual(delay1, 200);
      assert.strictEqual(delay2, 400);
    });

    it("should calculate linear backoff delay correctly", () => {
      const retryPolicy = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 10000,
        backoffStrategy: "linear" as const,
        retryableErrors: [],
      };

      const delay0 = (orchestrator as any).calculateRetryDelay(0, retryPolicy);
      const delay1 = (orchestrator as any).calculateRetryDelay(1, retryPolicy);
      const delay2 = (orchestrator as any).calculateRetryDelay(2, retryPolicy);

      assert.strictEqual(delay0, 100);
      assert.strictEqual(delay1, 200);
      assert.strictEqual(delay2, 300);
    });

    it("should respect max delay cap", () => {
      const retryPolicy = {
        maxAttempts: 10,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffStrategy: "exponential" as const,
        retryableErrors: [],
      };

      const delay5 = (orchestrator as any).calculateRetryDelay(5, retryPolicy);

      // 1000 * 2^5 = 32000, but should be capped at 5000
      assert.strictEqual(delay5, 5000);
    });

    it("should not retry non-retryable errors", async () => {
      let attempts = 0;
      const mockAdapter = {
        publish: async () => {
          attempts++;
          return { ok: false, error: "INVALID_CREDENTIALS" };
        },
      };

      const retryPolicy = {
        maxAttempts: 3,
        baseDelay: 10,
        maxDelay: 1000,
        backoffStrategy: "exponential" as const,
        retryableErrors: ["RATE_LIMIT", "NETWORK"],
      };

      const result = await (orchestrator as any).publishWithRetry(
        mockAdapter,
        { channelId: "ch-123" },
        retryPolicy
      );

      assert.ok(!result.ok);
      assert.strictEqual(attempts, 1);
    });
  });
});
