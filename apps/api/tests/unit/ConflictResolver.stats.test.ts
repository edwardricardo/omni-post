/**
 * ConflictResolver Tests - Statistics, Built-in Patterns, and Edge Cases
 *
 * @file ConflictResolver.stats.test.ts
 * @description Tests for ConflictResolver - Statistics
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
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

describe("ConflictResolver - Statistics", () => {
  let resolver: ConflictResolver;

  beforeEach(async (_t) => {
    const mockPrisma = new MockPrismaClient();
    const mockRedis = new MockRedis();
    const mockEventService = new MockEventService();

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

    expect(typeof stats.totalConflicts).toBe("number");
    expect(typeof stats.resolvedConflicts).toBe("number");
    expect(typeof stats.averageResolutionTime).toBe("number");
    expect(Array.isArray(stats.topConflictPatterns)).toBeTruthy();
  });

  it("should include conflicts by type", async () => {
    const stats = await resolver.getResolutionStatistics({
      start: new Date(Date.now() - 86400000),
      end: new Date(),
    });

    expect(typeof stats.conflictsByType === "object").toBeTruthy();
  });

  it("should include resolutions by strategy", async () => {
    const stats = await resolver.getResolutionStatistics({
      start: new Date(Date.now() - 86400000),
      end: new Date(),
    });

    expect(typeof stats.resolutionsByStrategy === "object").toBeTruthy();
  });
});

describe("ConflictResolver - Built-in Patterns", () => {
  let resolver: ConflictResolver;

  beforeEach(async (_t) => {
    const mockPrisma = new MockPrismaClient();
    const mockRedis = new MockRedis();
    const mockEventService = new MockEventService();

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

    expect(conflicts.length > 0).toBeTruthy();
    expect(conflicts[0].type).toBe("rate_limit");
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
    expect(result.ok).toBe(true);
  });

  it("should load authentication_expired pattern", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "AUTH_EXPIRED" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length > 0).toBeTruthy();
  });

  it("should load network_timeout pattern", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "NETWORK_TIMEOUT" });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length > 0).toBeTruthy();
  });

  it("should have correct priority for critical patterns", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: "RATE_LIMIT" });

    const conflicts = await resolver.detectConflicts(context, result);

    // Rate limit should be critical severity (priority 1)
    expect(conflicts[0].severity).toBe("critical");
  });
});

describe("ConflictResolver - Edge Cases", () => {
  let resolver: ConflictResolver;
  let originalGetAdapter: typeof providerRegistry.getAdapter;

  beforeAll(() => {
    // Save original for restoration
    originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);
  });

  beforeEach(async (_t) => {
    const mockPrisma = new MockPrismaClient();
    const mockRedis = new MockRedis();
    const mockEventService = new MockEventService();

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  afterAll(() => {
    // Restore original getAdapter
    providerRegistry.getAdapter = originalGetAdapter;
  });

  it("should handle empty conflicts array", async () => {
    const context = createTestContext();

    const result = await resolver.resolveConflicts([], context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(0);
    }
  });

  it("should handle null/undefined error in publish result", async () => {
    const context = createTestContext();
    const result = createTestPublishResult({ error: undefined });

    const conflicts = await resolver.detectConflicts(context, result);

    expect(conflicts.length).toBe(0);
  });

  it("should handle adaptation with empty validation errors", async (_t) => {
    providerRegistry.getAdapter = vi.fn((() => ({
      id: "twitter",
      limits: { maxChars: 280, maxMediaPerPost: 4, allowedMedia: ["image"] },
      validateContent: vi.fn(
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

    expect(result.ok).toBe(true);
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
    }
  });
});
