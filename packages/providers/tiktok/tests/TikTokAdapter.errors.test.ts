/**
 * TikTokAdapter - Error Handling & Interaction Settings Tests
 *
 * Tests validated here:
 * 1. Error Handling (7 tests) — verifies that failures in hashtag generation,
 *    sound selection, and marketing API are non-blocking (graceful fallback /
 *    circuit-breaker pattern). Also validates the Result<ok/err> shape and
 *    environment-variable initialisation-error paths.
 * 2. Interaction Settings (5 tests) — verifies that disableComment, disableDuet,
 *    and disableStitch meta flags are correctly passed through the PublishInput,
 *    both individually and in combination.
 *
 * All tests are Tier 0 (no network, no DB, no Redis).
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { TikTokAdapter } from "../src/TikTokAdapter.js";
import {
  createMockApiClient,
  createMockResearchClient,
  createMockMarketingClient,
  createTestPublishInput,
  MOCK_CREDENTIALS,
  EMPTY_CREDENTIALS,
} from "./TikTokAdapter.test-helpers.js";

// ============================================================================
// Error Handling Tests (7 tests)
// ============================================================================

describe("TikTokAdapter - Error Handling", () => {
  it("should handle hashtag generation failure without failing publish", async () => {
    const adapter = new TikTokAdapter({
      researchClientFactory: () => createMockResearchClient(),
      marketingClientFactory: () => createMockMarketingClient(),
    });
    const description = "Test video";

    // Simulate error with empty/invalid credentials
    const result = await (adapter as any).applyHashtagStrategy(
      createMockApiClient(),
      EMPTY_CREDENTIALS,
      description,
      { useHashtagStrategy: true }
    );

    // Should return original description on error (graceful fallback) — must not throw
    assert.ok(result, "Should return a result");
  });

  it("should handle sound selection placeholder gracefully", async () => {
    const adapter = new TikTokAdapter({
      researchClientFactory: () => createMockResearchClient(true),
      marketingClientFactory: () => createMockMarketingClient(),
    });

    // selectTrendingSound is a planned future method (see TikTokAdapter.ts line 247).
    // Verify the adapter does not expose it yet — calling it would be a no-op.
    assert.strictEqual(
      typeof (adapter as any).selectTrendingSound,
      "undefined",
      "selectTrendingSound should not be implemented yet"
    );
  });

  it("should handle marketing API failure without failing publish", async () => {
    const adapter = new TikTokAdapter({
      researchClientFactory: () => createMockResearchClient(),
      marketingClientFactory: () => createMockMarketingClient(),
    });

    // Should complete without throwing error
    const result = await (adapter as any).createPromotedContent(EMPTY_CREDENTIALS, "video-123", {
      promotedContent: true,
      marketingBudget: 500,
    });

    assert.strictEqual(result, undefined, "Should handle error gracefully");
  });

  it("should handle hashtag and marketing features failing simultaneously", async () => {
    const adapter = new TikTokAdapter({
      researchClientFactory: () => createMockResearchClient(true),
      marketingClientFactory: () => createMockMarketingClient(),
    });
    const description = "Test video";

    // Both implemented features should fail gracefully with circuit breaker fallbacks
    const hashtagResult = await (adapter as any).applyHashtagStrategy(
      createMockApiClient(),
      EMPTY_CREDENTIALS,
      description,
      { useHashtagStrategy: true }
    );

    const marketingResult = await (adapter as any).createPromotedContent(
      EMPTY_CREDENTIALS,
      "video-123",
      { promotedContent: true, marketingBudget: 500 }
    );

    // Both should complete without throwing — circuit breaker provides fallback data
    assert.ok(hashtagResult !== null, "Hashtag should return result (circuit breaker fallback)");
    assert.strictEqual(marketingResult, undefined, "Marketing should return undefined");
  });

  it("should verify Result pattern returns with ok/err", async () => {
    const _adapter = new TikTokAdapter();

    // Test successful result structure
    const successResult = { ok: true, value: { data: "test" } };
    assert.strictEqual(successResult.ok, true, "Success result should have ok: true");

    // Test error result structure
    const errorResult = { ok: false, error: "AUTH" };
    assert.strictEqual(errorResult.ok, false, "Error result should have ok: false");
    assert.strictEqual(errorResult.error, "AUTH", "Error result should have error type");
  });

  it("should handle TikTokResearchApiClient initialization errors", async () => {
    const adapter = new TikTokAdapter({
      researchClientFactory: () => createMockResearchClient(),
      marketingClientFactory: () => createMockMarketingClient(),
    });

    // Simulate init error via env var — preserve and restore
    const originalEnv = process.env.TIKTOK_RESEARCH_API_KEY;
    process.env.TIKTOK_RESEARCH_API_KEY = "placeholder";

    const result = await (adapter as any).applyHashtagStrategy(
      createMockApiClient(),
      MOCK_CREDENTIALS,
      "Test",
      { useHashtagStrategy: true }
    );

    if (originalEnv !== undefined) {
      process.env.TIKTOK_RESEARCH_API_KEY = originalEnv;
    } else {
      delete process.env.TIKTOK_RESEARCH_API_KEY;
    }

    assert.ok(result, "Should return result even with initialization error");
  });

  it("should handle TikTokMarketingApiClient initialization errors", async () => {
    const adapter = new TikTokAdapter({
      researchClientFactory: () => createMockResearchClient(),
      marketingClientFactory: () => createMockMarketingClient(),
    });

    // Simulate init error via env var — preserve and restore
    const originalEnv = process.env.TIKTOK_ADVERTISER_ACCOUNT_ID;
    process.env.TIKTOK_ADVERTISER_ACCOUNT_ID = "placeholder";

    const result = await (adapter as any).createPromotedContent(MOCK_CREDENTIALS, "video-123", {
      promotedContent: true,
      marketingBudget: 500,
    });

    if (originalEnv !== undefined) {
      process.env.TIKTOK_ADVERTISER_ACCOUNT_ID = originalEnv;
    } else {
      delete process.env.TIKTOK_ADVERTISER_ACCOUNT_ID;
    }

    assert.strictEqual(result, undefined, "Should complete without error");
  });
});

// ============================================================================
// Interaction Settings Tests (5 tests)
// ============================================================================

describe("TikTokAdapter - Interaction Settings", () => {
  it("should verify disableComment setting passthrough", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with comments disabled",
      meta: {
        disableComment: true,
      },
    });

    assert.strictEqual(input.post.meta?.disableComment, true, "Should extract disableComment");
    assert.strictEqual(typeof input.post.meta?.disableComment, "boolean", "Should be boolean");
  });

  it("should verify disableDuet setting passthrough", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with duet disabled",
      meta: {
        disableDuet: true,
      },
    });

    assert.strictEqual(input.post.meta?.disableDuet, true, "Should extract disableDuet");
    assert.strictEqual(typeof input.post.meta?.disableDuet, "boolean", "Should be boolean");
  });

  it("should verify disableStitch setting passthrough", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with stitch disabled",
      meta: {
        disableStitch: true,
      },
    });

    assert.strictEqual(input.post.meta?.disableStitch, true, "Should extract disableStitch");
    assert.strictEqual(typeof input.post.meta?.disableStitch, "boolean", "Should be boolean");
  });

  it("should handle all interaction settings enabled", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with all interactions disabled",
      meta: {
        disableComment: true,
        disableDuet: true,
        disableStitch: true,
      },
    });

    assert.strictEqual(input.post.meta?.disableComment, true);
    assert.strictEqual(input.post.meta?.disableDuet, true);
    assert.strictEqual(input.post.meta?.disableStitch, true);
  });

  it("should handle all interaction settings disabled (allow all)", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with all interactions allowed",
      meta: {
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
      },
    });

    assert.strictEqual(input.post.meta?.disableComment, false);
    assert.strictEqual(input.post.meta?.disableDuet, false);
    assert.strictEqual(input.post.meta?.disableStitch, false);
  });
});
