/**
 * PublishingOrchestrator - Initialization and Plan Management Tests
 *
 * Covers:
 * 1. Initialization and setup
 * 2. Plan creation and validation
 * 3. Plan updates with conflict handling
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { PublishingOrchestrator } from "../../src/orchestration/PublishingOrchestrator.js";
import type {
  CreateOrchestrationRequest,
  UpdateOrchestrationRequest,
  OrchestrationExecution,
  ProviderDependency,
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
  // 1. Initialization Tests
  // ============================================================================

  describe("Initialization", () => {
    it("should initialize with default configuration", async () => {
      await orchestrator.initialize();

      const events = mockEvents.getEventsByType("ORCHESTRATION_STARTED");
      expect(events.length).toBe(1);
      expect(events[0].data.status).toBe("initialized");
      expect(events[0].data.config).toBeTruthy();
    });

    it("should initialize with custom configuration", async () => {
      const customOrchestrator = new PublishingOrchestrator({
        prisma: asPrisma(mockPrisma),
        redis: asRedis(mockRedis),
        eventService: asEventService(mockEvents),
        scheduler: new NoopBackgroundTaskScheduler(),
        config: {
          maxConcurrentExecutions: 20,
          enableRollback: false,
        },
      });

      (customOrchestrator as any).setupRedisChannels = async () => {};
      (customOrchestrator as any).registerEventHandlers = () => {};
      (customOrchestrator as any).startHealthMonitoring = () => {};

      await customOrchestrator.initialize();

      const events = mockEvents.getEventsByType("ORCHESTRATION_STARTED");
      expect(events.length > 0).toBeTruthy();
      expect(events[0].data.config.maxConcurrentExecutions).toBe(20);
      expect(events[0].data.config.enableRollback).toBe(false);
    });

    it("should not reinitialize if already initialized", async () => {
      await orchestrator.initialize();
      const eventsBefore = mockEvents.getEvents().length;

      await orchestrator.initialize();
      const eventsAfter = mockEvents.getEvents().length;

      expect(eventsBefore).toBe(eventsAfter);
    });

    it("should handle initialization errors gracefully", async () => {
      const errorOrchestrator = new PublishingOrchestrator({
        prisma: asPrisma(mockPrisma),
        redis: asRedis(mockRedis),
        eventService: asEventService(mockEvents),
        scheduler: new NoopBackgroundTaskScheduler(),
      });

      (errorOrchestrator as any).setupRedisChannels = async () => {
        throw new Error("Redis connection failed");
      };

      await expect(errorOrchestrator.initialize()).rejects.toThrow("Redis connection failed");
    });
  });

  // ============================================================================
  // 2. Plan Creation Tests
  // ============================================================================

  describe("createPlan()", () => {
    let mockValidatePlan: any;

    beforeEach(async () => {
      await orchestrator.initialize();

      mockValidatePlan = (orchestrator as any).validateCreateRequest;
      (orchestrator as any).validateCreateRequest = async () => ({ ok: true, value: undefined });
      (orchestrator as any).generatePlan = async (request: CreateOrchestrationRequest) => ({
        id: `plan-${Date.now()}`,
        postId: request.postId,
        projectId: "project-456",
        strategy: request.strategy || "SIMULTANEOUS",
        conflictResolution: request.conflictResolution || "BEST_EFFORT",
        providers: request.providers,
        dependencies: request.dependencies || [],
        timing: {
          ...request.timing,
          timezone: request.timing?.timezone || "UTC",
          respectRateLimits: request.timing?.respectRateLimits ?? true,
        },
        estimatedDuration: 5000,
        createdAt: new Date(),
        createdBy: "user-123",
      });
    });

    afterEach(() => {
      (orchestrator as any).validateCreateRequest = mockValidatePlan;
    });

    it("should create a basic orchestration plan", async () => {
      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
      };

      const result = await orchestrator.createPlan(request);

      expect(result.ok).toBeTruthy();
      expect(result.value).toBeTruthy();
      expect(result.value.postId).toBe("post-123");
      expect(result.value.providers.length).toBe(2);
    });

    it("should create plan with custom strategy", async () => {
      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
        strategy: "SEQUENTIAL",
      };

      const result = await orchestrator.createPlan(request);

      expect(result.ok).toBeTruthy();
      expect(result.value?.strategy).toBe("SEQUENTIAL");
    });

    it("should create plan with dependencies", async () => {
      const dependencies: ProviderDependency[] = [
        {
          providerId: "facebook" as ProviderId,
          dependsOn: ["twitter" as ProviderId],
          delayAfterDependency: 1000,
        },
      ];

      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: ["twitter" as ProviderId, "facebook" as ProviderId],
        strategy: "DEPENDENCY_BASED",
        dependencies,
      };

      const result = await orchestrator.createPlan(request);

      expect(result.ok).toBeTruthy();
      expect(result.value?.dependencies.length).toBe(1);
      const firstDep = result.value?.dependencies[0];
      expect(firstDep).toBeTruthy();
      expect(firstDep.providerId).toBe("facebook");
    });

    it("should cache created plan in Redis", async () => {
      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: ["twitter" as ProviderId],
      };

      const result = await orchestrator.createPlan(request);
      expect(result.ok).toBeTruthy();

      const cached = await mockRedis.get(`orchestration:plan:${result.value?.id}`);
      expect(cached).toBeTruthy();
      const cachedPlan = JSON.parse(cached);
      expect(cachedPlan.postId).toBe("post-123");
    });

    it("should emit ORCHESTRATION_PLANNED event", async () => {
      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: ["twitter" as ProviderId],
      };

      await orchestrator.createPlan(request);

      const events = mockEvents.getEventsByType("ORCHESTRATION_PLANNED");
      expect(events.length).toBe(1);
      expect(events[0].data.plan).toBeTruthy();
    });

    it("should handle validation errors", async () => {
      (orchestrator as any).validateCreateRequest = async () => ({
        ok: false,
        error: {
          id: "err-123",
          type: "validation",
          message: "Invalid provider list",
          retryable: false,
          occurredAt: new Date(),
        },
      });

      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: [],
      };

      const result = await orchestrator.createPlan(request);

      expect(result.ok).toBeFalsy();
      expect(result.error?.type).toBe("validation");
      expect(result.error?.message).toBe("Invalid provider list");
    });

    it("should handle system errors during plan creation", async () => {
      (orchestrator as any).generatePlan = async () => {
        throw new Error("Database connection failed");
      };

      const request: CreateOrchestrationRequest = {
        postId: "post-123",
        providers: ["twitter" as ProviderId],
      };

      const result = await orchestrator.createPlan(request);

      expect(result.ok).toBeFalsy();
      expect(result.error?.message.includes("Database connection failed")).toBeTruthy();
    });
  });

  // ============================================================================
  // 3. Plan Update Tests
  // ============================================================================

  describe("updatePlan()", () => {
    beforeEach(async () => {
      await orchestrator.initialize();
      (orchestrator as any).validatePlan = async () => ({ ok: true, value: undefined });
    });

    it("should update plan strategy", async () => {
      const updates: UpdateOrchestrationRequest = {
        strategy: "SEQUENTIAL",
      };

      const result = await orchestrator.updatePlan("plan-123", updates);

      expect(result.ok).toBeTruthy();
      expect(result.value?.strategy).toBe("SEQUENTIAL");
    });

    it("should update plan providers", async () => {
      const updates: UpdateOrchestrationRequest = {
        providers: ["twitter" as ProviderId, "instagram" as ProviderId, "linkedin" as ProviderId],
      };

      const result = await orchestrator.updatePlan("plan-123", updates);

      expect(result.ok).toBeTruthy();
      expect(result.value?.providers.length).toBe(3);
    });

    it("should reject update if plan not found", async () => {
      (orchestrator as any).getPlan = async () => null;

      const result = await orchestrator.updatePlan("nonexistent", {
        strategy: "SEQUENTIAL",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error?.message.includes("not found")).toBeTruthy();
    });

    it("should reject update if execution is in progress", async () => {
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

      (orchestrator as any).activeExecutions.set("plan-123", execution);

      const result = await orchestrator.updatePlan("plan-123", {
        strategy: "SEQUENTIAL",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error?.message.includes("execution is in progress")).toBeTruthy();
    });

    it("should preserve undefined values using conditional spreading", async () => {
      const updates: UpdateOrchestrationRequest = {
        strategy: "SEQUENTIAL",
        // conflictResolution intentionally undefined
      };

      const result = await orchestrator.updatePlan("plan-123", updates);

      expect(result.ok).toBeTruthy();
      expect(result.value?.strategy).toBe("SEQUENTIAL");
      expect(result.value?.conflictResolution).toBe("BEST_EFFORT"); // Original value preserved
    });

    it("should update Redis cache after plan update", async () => {
      const result = await orchestrator.updatePlan("plan-123", {
        strategy: "SEQUENTIAL",
      });

      expect(result.ok).toBeTruthy();

      const cached = await mockRedis.get(`orchestration:plan:plan-123`);
      expect(cached).toBeTruthy();
      const cachedPlan = JSON.parse(cached);
      expect(cachedPlan.strategy).toBe("SEQUENTIAL");
    });

    it("should handle validation errors during update", async () => {
      (orchestrator as any).validatePlan = async () => ({
        ok: false,
        error: {
          id: "err-123",
          type: "validation",
          message: "Invalid strategy",
          retryable: false,
          occurredAt: new Date(),
        },
      });

      const result = await orchestrator.updatePlan("plan-123", {
        strategy: "INVALID" as any,
      });

      expect(result.ok).toBeFalsy();
      expect(result.error?.message).toBe("Invalid strategy");
    });
  });
});
