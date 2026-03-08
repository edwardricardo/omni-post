/**
 * ConflictResolver Tests - Statistics, Built-in Patterns, and Edge Cases
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConflictResolver } from "../../src/orchestration/ConflictResolver.js";
import { providerRegistry } from "../../src/providers/providerRegistry.js";
import type { OrchestrationConflict } from "@shared/orchestration";
import type {
  ProviderId,
  ContentValidationResult,
} from "../../src/providers/providerAdapter.interface.js";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  createTestContext,
  createTestPublishResult,
  createTestCanonicalPost,
} from "./ConflictResolver.test-helpers.js";

describe("ConflictResolver - Statistics", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    const mockEventService = new MockEventService(t);

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  it("should return resolution statistics", async () => {
    const stats = await resolver.getResolutionStatistics({
      start: new Date(Date.now() - 86400000),
      end: new Date(),
    });

    assert.strictEqual(typeof stats.totalConflicts, "number");
    assert.strictEqual(typeof stats.resolvedConflicts, "number");
    assert.strictEqual(typeof stats.averageResolutionTime, "number");
    assert.ok(Array.isArray(stats.topConflictPatterns));
  });

  it("should include conflicts by type", async () => {
    const stats = await resolver.getResolutionStatistics({
      start: new Date(Date.now() - 86400000),
      end: new Date(),
    });

    assert.ok(typeof stats.conflictsByType === "object");
  });

  it("should include resolutions by strategy", async () => {
    const stats = await resolver.getResolutionStatistics({
      start: new Date(Date.now() - 86400000),
      end: new Date(),
    });

    assert.ok(typeof stats.resolutionsByStrategy === "object");
  });
});

describe("ConflictResolver - Built-in Patterns", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    const mockEventService = new MockEventService(t);

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  it("should load rate_limit_exceeded pattern", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.ok(conflicts.length > 0);
    assert.strictEqual(conflicts[0].type, "rate_limit");
  });

  it("should load content_too_long pattern", async () => {
    // Pattern is checked during resolution, so verify resolution works
    const context = createTestContext();
    const conflict: OrchestrationConflict = {
      id: "test",
      type: "content_validation",
      providerId: "twitter" as ProviderId,
      description: "Content too long",
      severity: "high",
      autoResolved: false,
    };

    const result = await resolver.resolveConflicts([conflict], context);
    assert.strictEqual(result.ok, true);
  });

  it("should load authentication_expired pattern", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "AUTH_EXPIRED" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.ok(conflicts.length > 0);
  });

  it("should load network_timeout pattern", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "NETWORK_TIMEOUT" });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.ok(conflicts.length > 0);
  });

  it("should have correct priority for critical patterns", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    // Rate limit should be critical severity (priority 1)
    assert.strictEqual(conflicts[0].severity, "critical");
  });
});

describe("ConflictResolver - Edge Cases", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;
  let originalGetAdapter: typeof providerRegistry.getAdapter;

  before(() => {
    // Save original for restoration
    originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);
  });

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    const mockEventService = new MockEventService(t);

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  after(() => {
    // Restore original getAdapter
    providerRegistry.getAdapter = originalGetAdapter;
  });

  it("should handle empty conflicts array", async () => {
    const context = createTestContext();

    const result = await resolver.resolveConflicts([], context);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.length, 0);
    }
  });

  it("should handle null/undefined error in publish result", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: undefined });

    const conflicts = await resolver.detectConflicts(context, result);

    assert.strictEqual(conflicts.length, 0);
  });

  it("should handle adaptation with empty validation errors", async (t) => {
    providerRegistry.getAdapter = t.mock.fn((() => ({
      id: "twitter",
      limits: { maxChars: 280, maxMediaPerPost: 4, allowedMedia: ["image"] },
      validateContent: t.mock.fn(
        async (): Promise<ContentValidationResult> => ({
          valid: true,
          errors: [],
          suggestions: [],
          adaptations: [],
        })
      ),
    })) as any);

    const content = createTestCanonicalPost();

    const result = await resolver.adaptContentForProvider(content, "twitter" as ProviderId, []);

    assert.strictEqual(result.ok, true);
  });

  it("should handle concurrent conflict resolution", async () => {
    const context = createTestContext();
    const conflicts: OrchestrationConflict[] = [
      {
        id: "c1",
        type: "rate_limit",
        providerId: "twitter" as ProviderId,
        description: "Test",
        severity: "high",
        autoResolved: false,
      },
      {
        id: "c2",
        type: "content_validation",
        providerId: "instagram" as ProviderId,
        description: "Test",
        severity: "medium",
        autoResolved: false,
      },
    ];

    const result = await resolver.resolveConflicts(conflicts, context);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.length, 2);
    }
  });
});
