/**
 * ConflictResolver Tests - Initialization, Pattern Detection, and Conflict Resolution
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

describe("ConflictResolver - Initialization", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;
  let mockEventService: MockEventService;

  beforeEach((t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    mockEventService = new MockEventService(t);

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should initialize with built-in patterns", async () => {
    await resolver.initialize();

    // Should emit initialization event
    assert.strictEqual(mockEventService.publishEvent.mock.calls.length, 1);
    const eventCall = mockEventService.publishEvent.mock.calls[0];
    assert.strictEqual(eventCall.arguments[0].type, "CONFLICT_RESOLVED");
    assert.strictEqual(eventCall.arguments[0].data.component, "ConflictResolver");
    assert.strictEqual(eventCall.arguments[0].data.status, "initialized");
  });

  it("should load built-in conflict patterns", async () => {
    await resolver.initialize();

    // Verify initialization completed (patterns loaded)
    const stats = await resolver.getResolutionStatistics({
      start: new Date(),
      end: new Date(),
    });

    assert.strictEqual(typeof stats.totalConflicts, "number");
  });
});

describe("ConflictResolver - Pattern Detection", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    mockRedis = new MockRedis(t);
    mockEventService = new MockEventService(t);

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

    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].type, "rate_limit");
    assert.strictEqual(conflicts[0].providerId, "twitter");
    assert.strictEqual(conflicts[0].autoResolved, false);
  });

  it("should detect authentication errors", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "AUTH_EXPIRED" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].type, "custom");
    assert.ok(conflicts[0].description.includes("authentication"));
  });

  it("should detect network timeout errors", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "NETWORK_TIMEOUT" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.strictEqual(conflicts.length, 1);
    assert.ok(conflicts[0].description.includes("Network"));
  });

  it("should calculate conflict severity correctly", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.strictEqual(conflicts[0].severity, "critical");
  });

  it("should emit CONFLICT_DETECTED event", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    await resolver.detectConflicts(context, result);

    const conflictEvents = mockEventService.publishEvent.mock.calls.filter(
      (call) => call.arguments[0].type === "CONFLICT_DETECTED"
    );
    assert.strictEqual(conflictEvents.length, 1);
  });

  it("should store conflicts in Redis", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    await resolver.detectConflicts(context, result);

    assert.strictEqual(mockRedis.setex.mock.calls.length, 1);
    const redisCall = mockRedis.setex.mock.calls[0];
    assert.strictEqual(redisCall.arguments[0], `conflicts:${context.planId}`);
  });

  it("should return empty array for successful publish", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({
      status: "success",
      error: undefined,
    });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.strictEqual(conflicts.length, 0);
  });

  it("should handle multiple pattern matches", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.ok(conflicts.length >= 1);
  });
});

describe("ConflictResolver - Conflict Resolution", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;
  let mockEventService: MockEventService;

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    mockEventService = new MockEventService(t);

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

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.length, 1);
      assert.strictEqual(result.value[0].action, "resolved");
      assert.strictEqual(result.value[0].strategy, "retry");
      assert.ok(result.value[0].nextAttemptIn);
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

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      // Content adaptation strategy fails because getCurrentContent returns null (placeholder)
      // so the resolver escalates to manual intervention
      assert.strictEqual(result.value[0].action, "escalated");
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

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      // No built-in pattern maps to "timing_conflict" type (scheduled_time_past maps to "custom"),
      // so the resolver escalates to manual intervention
      assert.strictEqual(result.value[0].action, "escalated");
      assert.strictEqual(result.value[0].strategy, "manual_intervention");
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
      (call) =>
        call.arguments[0].type === "CONFLICT_RESOLVED" &&
        call.arguments[0].data?.status !== "initialized"
    );
    assert.strictEqual(resolvedEvents.length, 1);
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

    assert.ok(conflict.resolution);
    assert.ok(conflict.resolvedAt);
    assert.strictEqual(conflict.autoResolved, true);
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

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.length, 2);
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

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value[0].action, "escalated");
    }
  });
});
