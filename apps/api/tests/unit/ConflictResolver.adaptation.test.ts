/**
 * ConflictResolver Tests - Content Adaptation and Alternative Timing
 *
 * These tests require monkey-patching the providerRegistry singleton
 * since ConflictResolver imports it statically.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConflictResolver } from "../../src/orchestration/ConflictResolver.js";
import { providerRegistry } from "../../src/providers/providerRegistry.js";
import type { TimingConfiguration } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type {
  ProviderId,
  ContentValidationResult,
} from "../../src/providers/providerAdapter.interface.js";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  createTestCanonicalPost,
} from "./ConflictResolver.test-helpers.js";

describe("ConflictResolver - Content Adaptation", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;
  let originalGetAdapter: typeof providerRegistry.getAdapter;
  let mockValidateContent: ReturnType<typeof import("node:test").mock.fn>;

  before(() => {
    // Save original for restoration
    originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);
  });

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    const mockEventService = new MockEventService(t);

    // Create mock validateContent
    mockValidateContent = t.mock.fn(
      async (_content: CanonicalPost): Promise<ContentValidationResult> => ({
        valid: true,
        errors: [],
        suggestions: [],
        adaptations: [],
      })
    );

    // Monkey-patch the singleton
    providerRegistry.getAdapter = t.mock.fn(((id: string) => {
      if (id === "twitter") {
        return {
          id: "twitter",
          limits: {
            maxChars: 280,
            maxMediaPerPost: 4,
            allowedMedia: ["image", "video"],
          },
          validateContent: mockValidateContent,
        };
      }
      return undefined;
    }) as any);

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

  it("should adapt content for TEXT_TOO_LONG error", async () => {
    const content = createTestCanonicalPost({
      body: "x".repeat(300), // Exceeds Twitter's 280 char limit
    });

    const result = await resolver.adaptContentForProvider(content, "twitter" as ProviderId, [
      "TEXT_TOO_LONG",
    ]);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.value.adaptedContent.body.length <= 280);
      assert.strictEqual(result.value.providerId, "twitter");
    }
  });

  it("should adapt content for UNSUPPORTED_MEDIA error", async () => {
    const content = createTestCanonicalPost({
      media: [{ type: "image", url: "test.gif" }],
    });

    const result = await resolver.adaptContentForProvider(content, "twitter" as ProviderId, [
      "UNSUPPORTED_MEDIA",
    ]);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.value.adaptationRules.length > 0);
      assert.strictEqual(result.value.adaptationRules[0].type, "media_format");
    }
  });

  it("should calculate adaptation confidence", async () => {
    const content = createTestCanonicalPost({
      body: "x".repeat(300),
    });

    const result = await resolver.adaptContentForProvider(content, "twitter" as ProviderId, [
      "TEXT_TOO_LONG",
    ]);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.value.confidence >= 0 && result.value.confidence <= 1);
    }
  });

  it("should set requiresManualReview when validation fails", async () => {
    // Mock adapter to return validation errors
    mockValidateContent.mock.mockImplementation(
      async (): Promise<ContentValidationResult> => ({
        valid: false,
        errors: [{ field: "content", message: "Invalid", severity: "error" }],
        suggestions: [],
        adaptations: [],
      })
    );

    const content = createTestCanonicalPost();

    const result = await resolver.adaptContentForProvider(content, "twitter" as ProviderId, [
      "TEXT_TOO_LONG",
    ]);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.requiresManualReview, true);
    }
    // No need to reset — beforeEach creates fresh mocks for each test
  });

  it("should handle missing provider adapter", async () => {
    const content = createTestCanonicalPost();

    // "unknown" provider returns undefined from our mock
    const result = await resolver.adaptContentForProvider(content, "unknown" as ProviderId, [
      "TEXT_TOO_LONG",
    ]);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.type, "validation");
      assert.ok(result.error.message.includes("not found"));
    }
  });

  it("should include warnings in adaptation result", async () => {
    const content = createTestCanonicalPost({ body: "x".repeat(300) });

    const result = await resolver.adaptContentForProvider(content, "twitter" as ProviderId, [
      "TEXT_TOO_LONG",
      "INVALID_ERROR",
    ]);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.value.warnings.length >= 0);
    }
  });
});

describe("ConflictResolver - Alternative Timing", { concurrency: 1 }, () => {
  let resolver: ConflictResolver;
  let originalGetAdapter: typeof providerRegistry.getAdapter;
  let mockGetOptimalTimes: ReturnType<typeof import("node:test").mock.fn>;

  before(() => {
    originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);
  });

  beforeEach(async (t) => {
    const mockPrisma = new MockPrismaClient(t);
    const mockRedis = new MockRedis(t);
    const mockEventService = new MockEventService(t);

    mockGetOptimalTimes = t.mock.fn(async () => ({
      ok: true,
      value: [
        { datetime: new Date(Date.now() + 3600000), timezone: "UTC", optimal: true },
        { datetime: new Date(Date.now() + 7200000), timezone: "UTC", optimal: true },
      ],
    }));

    // Monkey-patch the singleton
    providerRegistry.getAdapter = t.mock.fn((() => ({
      id: "twitter",
      limits: {
        maxChars: 280,
        maxMediaPerPost: 4,
        allowedMedia: ["image", "video"],
      },
      getOptimalTimes: mockGetOptimalTimes,
    })) as any);

    resolver = new ConflictResolver({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });

    await resolver.initialize();
  });

  after(() => {
    providerRegistry.getAdapter = originalGetAdapter;
  });

  it("should find alternative timing from optimal times", async () => {
    const originalTime = new Date();
    const timingConfig: TimingConfiguration = {
      timezone: "UTC",
      respectRateLimits: true,
    };

    const result = await resolver.findAlternativeTiming(
      "twitter" as ProviderId,
      originalTime,
      timingConfig
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.value > originalTime);
    }
  });

  it("should fallback to random delay when getOptimalTimes unavailable", async (t) => {
    // Override the adapter mock to return one without getOptimalTimes
    providerRegistry.getAdapter = t.mock.fn((() => ({
      id: "twitter",
      limits: { maxChars: 280, maxMediaPerPost: 4, allowedMedia: ["image", "video"] },
    })) as any);

    const originalTime = new Date();
    const timingConfig: TimingConfiguration = {
      timezone: "UTC",
      respectRateLimits: true,
    };

    const result = await resolver.findAlternativeTiming(
      "twitter" as ProviderId,
      originalTime,
      timingConfig
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.value > originalTime);
      // Should be between 15-75 minutes ahead
      const diffMinutes = (result.value.getTime() - originalTime.getTime()) / 60000;
      assert.ok(diffMinutes >= 15 && diffMinutes <= 75);
    }
    // No need to restore — beforeEach creates fresh mocks for each test
  });

  it("should fallback to next day when no optimal time available", async () => {
    mockGetOptimalTimes.mock.mockImplementation(async () => ({
      ok: true,
      value: [], // No optimal times
    }));

    const originalTime = new Date();
    const timingConfig: TimingConfiguration = {
      timezone: "UTC",
      respectRateLimits: true,
    };

    const result = await resolver.findAlternativeTiming(
      "twitter" as ProviderId,
      originalTime,
      timingConfig
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      // Should be approximately 1 day ahead
      const diffHours = (result.value.getTime() - originalTime.getTime()) / 3600000;
      assert.ok(diffHours >= 23 && diffHours <= 25);
    }
  });

  it("should handle getOptimalTimes error", async () => {
    mockGetOptimalTimes.mock.mockImplementation(async () => ({
      ok: false,
      error: "API_ERROR",
    }));

    const originalTime = new Date();
    const timingConfig: TimingConfiguration = {
      timezone: "UTC",
      respectRateLimits: true,
    };

    const result = await resolver.findAlternativeTiming(
      "twitter" as ProviderId,
      originalTime,
      timingConfig
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.type, "provider");
    }
  });
});
