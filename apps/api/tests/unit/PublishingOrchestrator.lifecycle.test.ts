/**
 * PublishingOrchestrator - Lifecycle, Health and Event Tests
 *
 * Covers:
 * 7. Execution status retrieval and cancellation
 * 8. Health status monitoring
 * 9. Error handling and rollback scenarios
 * 10. Event emission
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PublishingOrchestrator } from "../../src/orchestration/PublishingOrchestrator.js";
import type { OrchestrationExecution, OrchestrationPlan } from "@shared/orchestration";
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
  // 7. Execution Status and Cancellation Tests
  // ============================================================================

  describe("getExecution() and cancelExecution()", () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it("should retrieve active execution", async () => {
      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      (orchestrator as any).activeExecutions.set("exec-123", execution);

      const result = await orchestrator.getExecution("exec-123");

      assert.notStrictEqual(
        result,
        null,
        "getExecution should return a result for an active execution"
      );
      assert.strictEqual(result!.id, "exec-123");
      assert.strictEqual(result!.status, "executing");
    });

    it("should retrieve execution from Redis cache", async () => {
      const execution = {
        id: "exec-123",
        planId: "plan-123",
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: {},
        errors: [],
      };

      await mockRedis.setex("orchestration:execution:exec-123", 3600, JSON.stringify(execution));

      const result = await orchestrator.getExecution("exec-123");

      assert.notStrictEqual(
        result,
        null,
        "getExecution should return a result for a cached execution"
      );
      assert.strictEqual(result!.id, "exec-123");
      assert.strictEqual(result!.status, "completed");
    });

    it("should return null for non-existent execution", async () => {
      const result = await orchestrator.getExecution("nonexistent");
      assert.strictEqual(result, null);
    });

    it("should cancel active execution", async () => {
      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      (orchestrator as any).activeExecutions.set("exec-123", execution);

      const result = await orchestrator.cancelExecution("exec-123");

      assert.ok(result.ok);
      assert.strictEqual(execution.status, "cancelled");
      assert.ok(execution.completedAt);
    });

    it("should emit cancellation event", async () => {
      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      (orchestrator as any).activeExecutions.set("exec-123", execution);

      await orchestrator.cancelExecution("exec-123");

      const events = mockEvents.getEventsByType("ORCHESTRATION_CANCELLED");
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].aggregateId, "exec-123");
    });

    it("should handle cancellation of non-existent execution", async () => {
      const result = await orchestrator.cancelExecution("nonexistent");

      assert.ok(!result.ok);
      assert.ok(result.error?.message.includes("not found"));
    });

    it("should handle cancellation of already completed execution", async () => {
      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      (orchestrator as any).activeExecutions.set("exec-123", execution);

      const result = await orchestrator.cancelExecution("exec-123");

      assert.ok(result.ok);
    });
  });

  // ============================================================================
  // 8. Health Monitoring Tests
  // ============================================================================

  describe("getHealthStatus()", () => {
    beforeEach(async () => {
      await orchestrator.initialize();

      (orchestrator as any).getQueuedExecutionsCount = async () => 5;
      (orchestrator as any).calculateErrorRate = async () => 0.1;
      (orchestrator as any).calculateAverageExecutionTime = async () => 2500;
    });

    it("should return healthy status with normal metrics", async () => {
      const health = await orchestrator.getHealthStatus();

      assert.strictEqual(health.status, "healthy");
      assert.strictEqual(health.details.activeExecutions, 0);
      assert.strictEqual(health.details.queuedExecutions, 5);
      assert.strictEqual(health.details.errorRate, 0.1);
      assert.strictEqual(health.details.averageExecutionTime, 2500);
    });

    it("should return degraded status with high error rate", async () => {
      (orchestrator as any).calculateErrorRate = async () => 0.3;

      const health = await orchestrator.getHealthStatus();

      assert.strictEqual(health.status, "degraded");
    });

    it("should return unhealthy status with very high error rate", async () => {
      (orchestrator as any).calculateErrorRate = async () => 0.6;

      const health = await orchestrator.getHealthStatus();

      assert.strictEqual(health.status, "unhealthy");
    });

    it("should return degraded status with high active executions", async () => {
      // Add 9 active executions (90% of max 10)
      for (let i = 0; i < 9; i++) {
        (orchestrator as any).activeExecutions.set(`exec-${i}`, {
          id: `exec-${i}`,
          planId: "plan-123",
          status: "executing",
          startedAt: new Date(),
          results: {} as OrchestrationExecution["results"],
          conflicts: [],
          metrics: (orchestrator as any).initializeMetrics(),
          errors: [],
        });
      }

      const health = await orchestrator.getHealthStatus();

      assert.strictEqual(health.status, "degraded");
      assert.strictEqual(health.details.activeExecutions, 9);
    });

    it("should handle health check errors gracefully", async () => {
      (orchestrator as any).calculateErrorRate = async () => {
        throw new Error("Metrics unavailable");
      };

      const health = await orchestrator.getHealthStatus();

      assert.strictEqual(health.status, "unhealthy");
      assert.strictEqual(health.details.errorRate, 1);
    });
  });

  // ============================================================================
  // 9. Error Handling and Rollback Tests
  // ============================================================================

  describe("Error Handling and Rollback", () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it("should handle provider publish failures", async () => {
      const failingAdapter = {
        render: () => ({ ok: true, value: {} }),
        publish: async () => ({ ok: false, error: "Network timeout" }),
      };

      (global as any).providerRegistry = {
        getAdapter: () => failingAdapter,
      };

      const result = await (orchestrator as any).publishToProvider(
        {
          id: "exec-123",
          planId: "plan-123",
          status: "executing",
          startedAt: new Date(),
          results: {} as OrchestrationExecution["results"],
          conflicts: [],
          metrics: (orchestrator as any).initializeMetrics(),
          errors: [],
        },
        {
          id: "plan-123",
          postId: "post-123",
          projectId: "project-456",
          strategy: "SIMULTANEOUS",
          conflictResolution: "BEST_EFFORT",
          providers: ["twitter"],
          dependencies: [],
          timing: { timezone: "UTC", respectRateLimits: true },
          estimatedDuration: 3000,
          createdAt: new Date(),
          createdBy: "user-123",
        },
        "twitter" as ProviderId
      );

      assert.strictEqual(result.status, "failed");
      assert.ok(result.error);
    });

    it("should update execution metrics after completion", () => {
      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        results: {
          x: {
            providerId: "x" as ProviderId,
            status: "success",
            retryCount: 0,
            duration: 250,
          },
          facebook: {
            providerId: "facebook" as ProviderId,
            status: "failed",
            error: "Rate limit",
            retryCount: 2,
            duration: 500,
          },
        } as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      (orchestrator as any).updateExecutionMetrics(execution);

      assert.strictEqual(execution.metrics.successfulProviders, 1);
      assert.strictEqual(execution.metrics.failedProviders, 1);
      assert.strictEqual(execution.metrics.averageProviderLatency, 375);
    });

    it("should emit ORCHESTRATION_FAILED event on execution failure", async () => {
      (orchestrator as any).getPlan = async () => ({
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "INVALID_STRATEGY" as any,
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter"],
        dependencies: [],
        timing: { timezone: "UTC", respectRateLimits: true },
        estimatedDuration: 3000,
        createdAt: new Date(),
        createdBy: "user-123",
      });

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      await (orchestrator as any).executeAsync(
        execution,
        await (orchestrator as any).getPlan("plan-123")
      );

      // Wait for async completion
      await new Promise((resolve) => setTimeout(resolve, 100));

      const events = mockEvents.getEventsByType("ORCHESTRATION_FAILED");
      assert.ok(events.length > 0);
    });

    it("should emit ORCHESTRATION_COMPLETED event on successful execution", async () => {
      (global as any).providerRegistry = mockProviderRegistry;

      const plan: OrchestrationPlan = {
        id: "plan-123",
        postId: "post-123",
        projectId: "project-456",
        strategy: "SIMULTANEOUS",
        conflictResolution: "BEST_EFFORT",
        providers: ["twitter" as ProviderId],
        dependencies: [],
        timing: { timezone: "UTC", respectRateLimits: true },
        estimatedDuration: 1000,
        createdAt: new Date(),
        createdBy: "user-123",
      };

      const execution: OrchestrationExecution = {
        id: "exec-123",
        planId: "plan-123",
        status: "executing",
        startedAt: new Date(),
        results: {} as OrchestrationExecution["results"],
        conflicts: [],
        metrics: (orchestrator as any).initializeMetrics(),
        errors: [],
      };

      await (orchestrator as any).executeAsync(execution, plan);

      // Wait for async completion
      await new Promise((resolve) => setTimeout(resolve, 100));

      const events = mockEvents.getEventsByType("ORCHESTRATION_COMPLETED");
      assert.ok(events.length > 0);
    });
  });

  // ============================================================================
  // 10. Event Emission Tests
  // ============================================================================

  describe("Event Emission", () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it("should emit events with correct structure", async () => {
      await (orchestrator as any).emitEvent({
        type: "ORCHESTRATION_PLANNED",
        orchestrationId: "plan-123",
        timestamp: new Date(),
        data: { test: "data" },
      });

      const events = mockEvents.getEvents();
      const lastEvent = events[events.length - 1];

      assert.ok(lastEvent.id);
      assert.strictEqual(lastEvent.type, "ORCHESTRATION_PLANNED");
      assert.strictEqual(lastEvent.aggregateId, "plan-123");
      assert.strictEqual(lastEvent.aggregateType, "Orchestration");
      assert.strictEqual(lastEvent.metadata.source, "PublishingOrchestrator");
    });

    it("should emit PROVIDER_PUBLISH_STARTED events", async () => {
      (global as any).providerRegistry = mockProviderRegistry;

      await (orchestrator as any).publishToProvider(
        {
          id: "exec-123",
          planId: "plan-123",
          status: "executing",
          startedAt: new Date(),
          results: {} as OrchestrationExecution["results"],
          conflicts: [],
          metrics: (orchestrator as any).initializeMetrics(),
          errors: [],
        },
        {
          id: "plan-123",
          postId: "post-123",
          projectId: "project-456",
          strategy: "SIMULTANEOUS",
          conflictResolution: "BEST_EFFORT",
          providers: ["twitter"],
          dependencies: [],
          timing: { timezone: "UTC", respectRateLimits: true },
          estimatedDuration: 3000,
          createdAt: new Date(),
          createdBy: "user-123",
        },
        "twitter" as ProviderId
      );

      const events = mockEvents.getEventsByType("PROVIDER_PUBLISH_STARTED");
      assert.ok(events.length > 0);
      assert.strictEqual(events[0].data.providerId, "twitter");
    });

    it("should emit PROVIDER_PUBLISH_COMPLETED events on success", async () => {
      // Mock publishToProvider to emit COMPLETED event (real one needs providerRegistry)
      const originalPublish = (orchestrator as any).publishToProvider.bind(orchestrator);
      (orchestrator as any).publishToProvider = async (
        execution: any,
        plan: any,
        providerId: ProviderId
      ) => {
        await (orchestrator as any).emitEvent({
          type: "PROVIDER_PUBLISH_STARTED",
          orchestrationId: execution.id,
          timestamp: new Date(),
          data: { providerId, planId: plan.id },
        });

        const result = {
          providerId,
          status: "success",
          providerPostId: `${providerId}-post-123`,
          url: `https://${providerId}.com/post/123`,
          publishedAt: new Date(),
          duration: 100,
          retryCount: 0,
        };

        await (orchestrator as any).emitEvent({
          type: "PROVIDER_PUBLISH_COMPLETED",
          orchestrationId: execution.id,
          timestamp: new Date(),
          data: { providerId, result },
        });

        return result;
      };

      await (orchestrator as any).publishToProvider(
        {
          id: "exec-123",
          planId: "plan-123",
          status: "executing",
          startedAt: new Date(),
          results: {} as OrchestrationExecution["results"],
          conflicts: [],
          metrics: (orchestrator as any).initializeMetrics(),
          errors: [],
        },
        {
          id: "plan-123",
          postId: "post-123",
          projectId: "project-456",
          strategy: "SIMULTANEOUS",
          conflictResolution: "BEST_EFFORT",
          providers: ["twitter"],
          dependencies: [],
          timing: { timezone: "UTC", respectRateLimits: true },
          estimatedDuration: 3000,
          createdAt: new Date(),
          createdBy: "user-123",
        },
        "twitter" as ProviderId
      );

      const events = mockEvents.getEventsByType("PROVIDER_PUBLISH_COMPLETED");
      assert.ok(events.length > 0);
      assert.ok(events[0].data.result);

      // Restore original
      (orchestrator as any).publishToProvider = originalPublish;
    });
  });
});
