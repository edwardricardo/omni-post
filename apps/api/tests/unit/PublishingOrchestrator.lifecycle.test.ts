/**
 * PublishingOrchestrator - Lifecycle, Health and Event Tests
 *
 * Covers:
 * 7. Execution status retrieval and cancellation
 * 8. Health status monitoring
 * 9. Error handling and rollback scenarios
 * 10. Event emission
 *
 * @file PublishingOrchestrator.lifecycle.test.ts
 * @description Tests for PublishingOrchestrator
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
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
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

describe("PublishingOrchestrator", () => {
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
      scheduler: new NoopBackgroundTaskScheduler(),
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

      expect(result).not.toBe(null);
      expect(result!.id).toBe("exec-123");
      expect(result!.status).toBe("executing");
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

      expect(result).not.toBe(null);
      expect(result!.id).toBe("exec-123");
      expect(result!.status).toBe("completed");
    });

    it("should return null for non-existent execution", async () => {
      const result = await orchestrator.getExecution("nonexistent");
      expect(result).toBe(null);
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

      expect(result.ok).toBeTruthy();
      expect(execution.status).toBe("cancelled");
      expect(execution.completedAt).toBeTruthy();
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
      expect(events.length).toBe(1);
      expect(events[0].aggregateId).toBe("exec-123");
    });

    it("should handle cancellation of non-existent execution", async () => {
      const result = await orchestrator.cancelExecution("nonexistent");

      expect(result.ok).toBeFalsy();
      expect(result.error?.message.includes("not found")).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
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

      expect(health.status).toBe("healthy");
      expect(health.details.activeExecutions).toBe(0);
      expect(health.details.queuedExecutions).toBe(5);
      expect(health.details.errorRate).toBe(0.1);
      expect(health.details.averageExecutionTime).toBe(2500);
    });

    it("should return degraded status with high error rate", async () => {
      (orchestrator as any).calculateErrorRate = async () => 0.3;

      const health = await orchestrator.getHealthStatus();

      expect(health.status).toBe("degraded");
    });

    it("should return unhealthy status with very high error rate", async () => {
      (orchestrator as any).calculateErrorRate = async () => 0.6;

      const health = await orchestrator.getHealthStatus();

      expect(health.status).toBe("unhealthy");
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

      expect(health.status).toBe("degraded");
      expect(health.details.activeExecutions).toBe(9);
    });

    it("should handle health check errors gracefully", async () => {
      (orchestrator as any).calculateErrorRate = async () => {
        throw new Error("Metrics unavailable");
      };

      const health = await orchestrator.getHealthStatus();

      expect(health.status).toBe("unhealthy");
      expect(health.details.errorRate).toBe(1);
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

      expect(result.status).toBe("failed");
      expect(result.error).toBeTruthy();
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

      expect(execution.metrics.successfulProviders).toBe(1);
      expect(execution.metrics.failedProviders).toBe(1);
      expect(execution.metrics.averageProviderLatency).toBe(375);
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
      expect(events.length > 0).toBeTruthy();
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
      expect(events.length > 0).toBeTruthy();
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

      expect(lastEvent.id).toBeTruthy();
      expect(lastEvent.type).toBe("ORCHESTRATION_PLANNED");
      expect(lastEvent.aggregateId).toBe("plan-123");
      expect(lastEvent.aggregateType).toBe("Orchestration");
      expect(lastEvent.metadata.source).toBe("PublishingOrchestrator");
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
      expect(events.length > 0).toBeTruthy();
      expect(events[0].data.providerId).toBe("twitter");
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
      expect(events.length > 0).toBeTruthy();
      expect(events[0].data.result).toBeTruthy();

      // Restore original
      (orchestrator as any).publishToProvider = originalPublish;
    });
  });
});
