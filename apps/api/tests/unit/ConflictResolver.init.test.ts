/**
 * ConflictResolver Tests - Initialization, Pattern Detection, and Conflict Resolution
 */

import { describe, it, beforeEach, expect } from "vitest";
import { ConflictResolver } from "../../src/orchestration/ConflictResolver.js";
import type { OrchestrationConflict } from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  createTestContext,
  createTestPublishResult,
} from "./ConflictResolver.test-helpers.js";

describe("ConflictResolver - Initialization", () => {
  let resolver: ConflictResolver;
  let mockEventService: MockEventService;

  beforeEach(() => {
    const mockPrisma = new MockPrismaClient();
    const mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should initialize with built-in patterns", async () => {
    await resolver.initialize();

    // Should emit initialization event
    expect(mockEventService.publishEvent.mock.calls.length).toBe(1);
    const eventCall = mockEventService.publishEvent.mock.calls[0];
    expect(eventCall[0].type).toBe("CONFLICT_RESOLVED");
    expect(eventCall[0].data.component).toBe("ConflictResolver");
    expect(eventCall[0].data.status).toBe("initialized");
  });

  it("should load built-in conflict patterns", async () => {
    await resolver.initialize();

    // Verify initialization completed (patterns loaded)
    const stats = await resolver.getResolutionStatistics({
      start: new Date(),
      end: new Date(),
    });

    expect(typeof stats.totalConflicts).toBe("number");
  });
});

describe("ConflictResolver - Pattern Detection", () => {
  let resolver: ConflictResolver;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async (_t) => {
    const mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  it("should detect rate limit conflicts", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].type).toBe("rate_limit");
    expect(conflicts[0].providerId).toBe("twitter");
    expect(conflicts[0].autoResolved).toBe(false);
  });

  it("should detect authentication errors", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "AUTH_EXPIRED" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].type).toBe("custom");
    expect(conflicts[0].description.includes("authentication")).toBeTruthy();
  });

  it("should detect network timeout errors", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "NETWORK_TIMEOUT" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].description.includes("Network")).toBeTruthy();
  });

  it("should calculate conflict severity correctly", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts[0].severity).toBe("critical");
  });

  it("should emit CONFLICT_DETECTED event", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    await resolver.detectConflicts(context, result);

    const conflictEvents = mockEventService.publishEvent.mock.calls.filter(
      (call) => call[0].type === "CONFLICT_DETECTED"
    );
    expect(conflictEvents.length).toBe(1);
  });

  it("should store conflicts in Redis", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    await resolver.detectConflicts(context, result);

    expect(mockRedis.setex.mock.calls.length).toBe(1);
    const redisCall = mockRedis.setex.mock.calls[0];
    expect(redisCall[0]).toBe(`conflicts:${context.planId}`);
  });

  it("should return empty array for successful publish", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({
      status: "success",
      error: undefined,
    });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length).toBe(0);
  });

  it("should handle multiple pattern matches", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length >= 1).toBeTruthy();
  });
});

describe("ConflictResolver - Conflict Resolution", () => {
  let resolver: ConflictResolver;
  let mockEventService: MockEventService;

  beforeEach(async (_t) => {
    const mockPrisma = new MockPrismaClient();
    const mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  it("should resolve rate limit conflict with retry strategy", async () => {
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "conflict-1",
      type: "rate_limit",
      providerId: "twitter" as ProviderId,
      description: "Rate limit exceeded",
      severity: "critical",
      autoResolved: false,
    };

    const result = await resolver.resolveConflicts([conflict], context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0].action).toBe("resolved");
      expect(result.value[0].strategy).toBe("retry");
      expect(result.value[0].nextAttemptIn).toBeTruthy();
    }
  });

  it("should escalate content validation conflict when content is unavailable", async () => {
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "conflict-2",
      type: "content_validation",
      providerId: "twitter" as ProviderId,
      description: "Content too long",
      severity: "high",
      autoResolved: false,
    };

    const result = await resolver.resolveConflicts([conflict], context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Content adaptation strategy fails because getCurrentContent returns null (placeholder)
      // so the resolver escalates to manual intervention
      expect(result.value[0].action).toBe("escalated");
    }
  });

  it("should escalate timing conflict when no matching pattern exists", async () => {
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "conflict-3",
      type: "timing_conflict",
      providerId: "twitter" as ProviderId,
      description: "Scheduled time in past",
      severity: "critical",
      autoResolved: false,
    };

    const result = await resolver.resolveConflicts([conflict], context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // No built-in pattern maps to "timing_conflict" type (scheduled_time_past maps to "custom"),
      // so the resolver escalates to manual intervention
      expect(result.value[0].action).toBe("escalated");
      expect(result.value[0].strategy).toBe("manual_intervention");
    }
  });

  it("should emit CONFLICT_RESOLVED event", async () => {
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "conflict-4",
      type: "rate_limit",
      providerId: "twitter" as ProviderId,
      description: "Rate limit exceeded",
      severity: "critical",
      autoResolved: false,
    };

    await resolver.resolveConflicts([conflict], context);

    // Filter out the initialization event (data.status === "initialized")
    // and only count actual conflict resolution events
    const resolvedEvents = mockEventService.publishEvent.mock.calls.filter(
      (call) => call[0].type === "CONFLICT_RESOLVED" && call[0].data?.status !== "initialized"
    );
    expect(resolvedEvents.length).toBe(1);
  });

  it("should update conflict with resolution details", async () => {
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "conflict-5",
      type: "rate_limit",
      providerId: "twitter" as ProviderId,
      description: "Rate limit exceeded",
      severity: "critical",
      autoResolved: false,
    };

    await resolver.resolveConflicts([conflict], context);

    expect(conflict.resolution).toBeTruthy();
    expect(conflict.resolvedAt).toBeTruthy();
    expect(conflict.autoResolved).toBe(true);
  });

  it("should handle multiple conflicts in order", async () => {
    const context = createTestContext();
    const conflicts: OrchestrationConflict[] = [
      {
        id: "conflict-6",
        type: "rate_limit",
        providerId: "twitter" as ProviderId,
        description: "Rate limit exceeded",
        severity: "critical",
        autoResolved: false,
      },
      {
        id: "conflict-7",
        type: "content_validation",
        providerId: "twitter" as ProviderId,
        description: "Content too long",
        severity: "high",
        autoResolved: false,
      },
    ];

    const result = await resolver.resolveConflicts(conflicts, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
    }
  });

  it("should handle unknown conflict type gracefully", async () => {
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "conflict-8",
      type: "custom",
      providerId: "twitter" as ProviderId,
      description: "Unknown error",
      severity: "medium",
      autoResolved: false,
    };

    const result = await resolver.resolveConflicts([conflict], context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].action).toBe("escalated");
    }
  });
});
