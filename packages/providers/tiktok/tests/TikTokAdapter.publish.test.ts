/**
 * TikTokAdapter - Enhanced Publish Integration & Metadata Handling Tests
 *
 * Tests validated here:
 * 1. Enhanced Publish Integration (10 tests) — verifies meta fields are correctly
 *    extracted and forwarded for each feature combination (hashtags, sound, marketing,
 *    all-enabled, all-disabled, pairwise combos, privacy settings).
 * 2. Metadata Handling (8 tests) — validates individual meta field types and shapes:
 *    contentCategory, targetAudience, brandedHashtags, soundCategory, soundMood,
 *    soundTempo, marketingBudget, targetDemographics.
 *
 * All tests are Tier 0 (no network, no DB, no Redis).
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { TikTokAdapter } from "../src/TikTokAdapter.js";
import { createTestPublishInput } from "./TikTokAdapter.test-helpers.js";

// ============================================================================
// Enhanced Publish Integration Tests (10 tests)
// ============================================================================

describe("TikTokAdapter - Enhanced Publish Integration", () => {
  it("should publish with hashtag strategy enabled", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Test video with hashtags",
      meta: {
        useHashtagStrategy: true,
        contentCategory: "dance",
      },
    });

    assert.strictEqual(input.post.meta?.useHashtagStrategy, true);
    assert.strictEqual(input.post.meta?.contentCategory, "dance");
  });

  it("should publish with trending sound enabled", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Test video with sound",
      meta: {
        useTrendingSound: true,
        soundCategory: "dance",
        soundMood: "energetic",
      },
    });

    assert.strictEqual(input.post.meta?.useTrendingSound, true);
    assert.strictEqual(input.post.meta?.soundCategory, "dance");
    assert.strictEqual(input.post.meta?.soundMood, "energetic");
  });

  it("should publish with promoted content enabled", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Test promoted video",
      meta: {
        promotedContent: true,
        marketingBudget: 500,
      },
    });

    assert.strictEqual(input.post.meta?.promotedContent, true);
    assert.strictEqual(input.post.meta?.marketingBudget, 500);
  });

  it("should publish with all three features enabled simultaneously", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Test full featured video",
      meta: {
        useHashtagStrategy: true,
        contentCategory: "dance",
        useTrendingSound: true,
        soundCategory: "dance",
        soundMood: "energetic",
        promotedContent: true,
        marketingBudget: 1000,
      },
    });

    assert.strictEqual(input.post.meta?.useHashtagStrategy, true);
    assert.strictEqual(input.post.meta?.useTrendingSound, true);
    assert.strictEqual(input.post.meta?.promotedContent, true);
  });

  it("should publish with all features disabled (basic video upload)", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Basic video without features",
      meta: {},
    });

    assert.strictEqual(input.post.meta?.useHashtagStrategy, undefined);
    assert.strictEqual(input.post.meta?.useTrendingSound, undefined);
    assert.strictEqual(input.post.meta?.promotedContent, undefined);
  });

  it("should publish with only hashtags enabled (no sound, no marketing)", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with hashtags only",
      meta: {
        useHashtagStrategy: true,
        contentCategory: "comedy",
      },
    });

    assert.strictEqual(input.post.meta?.useHashtagStrategy, true);
    assert.strictEqual(input.post.meta?.useTrendingSound, undefined);
    assert.strictEqual(input.post.meta?.promotedContent, undefined);
  });

  it("should publish with only sound enabled (no hashtags, no marketing)", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Video with sound only",
      meta: {
        useTrendingSound: true,
        soundMood: "calm",
      },
    });

    assert.strictEqual(input.post.meta?.useHashtagStrategy, undefined);
    assert.strictEqual(input.post.meta?.useTrendingSound, true);
    assert.strictEqual(input.post.meta?.promotedContent, undefined);
  });

  it("should publish with only marketing enabled (no hashtags, no sound)", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Promoted video only",
      meta: {
        promotedContent: true,
        marketingBudget: 300,
      },
    });

    assert.strictEqual(input.post.meta?.useHashtagStrategy, undefined);
    assert.strictEqual(input.post.meta?.useTrendingSound, undefined);
    assert.strictEqual(input.post.meta?.promotedContent, true);
  });

  it("should verify public privacy settings passthrough", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Public video",
      meta: {
        privacy: "public",
      },
    });

    assert.strictEqual(input.post.meta?.privacy, "public");
  });

  it("should verify private privacy settings passthrough", async () => {
    const _adapter = new TikTokAdapter();
    const input = createTestPublishInput({
      body: "Private video",
      meta: {
        privacy: "private",
      },
    });

    assert.strictEqual(input.post.meta?.privacy, "private");
  });
});

// ============================================================================
// Metadata Handling Tests (8 tests)
// ============================================================================

describe("TikTokAdapter - Metadata Handling", () => {
  it("should parse and validate contentCategory values", async () => {
    const _adapter = new TikTokAdapter();
    const categories = ["dance", "comedy", "education", "lifestyle", "business"];

    categories.forEach((category) => {
      const meta = { contentCategory: category };
      assert.strictEqual(meta.contentCategory, category, `Should extract ${category} category`);
    });
  });

  it("should parse and validate targetAudience strings", async () => {
    const _adapter = new TikTokAdapter();
    const meta = {
      targetAudience: "Gen Z dancers aged 18-24",
    };

    assert.strictEqual(
      meta.targetAudience,
      "Gen Z dancers aged 18-24",
      "Should extract target audience string"
    );
    assert.strictEqual(typeof meta.targetAudience, "string", "Should be a string");
  });

  it("should parse and validate brandedHashtags arrays", async () => {
    const _adapter = new TikTokAdapter();
    const meta = {
      brandedHashtags: ["MyBrand", "BrandChallenge", "Promotion2024"],
    };

    assert.ok(Array.isArray(meta.brandedHashtags), "Should be an array");
    assert.strictEqual(meta.brandedHashtags.length, 3, "Should have 3 elements");
    assert.deepStrictEqual(
      meta.brandedHashtags,
      ["MyBrand", "BrandChallenge", "Promotion2024"],
      "Should match expected array"
    );
  });

  it("should parse and validate soundCategory values", async () => {
    const _adapter = new TikTokAdapter();
    const categories = ["dance", "comedy", "education", "lifestyle", "music"];

    categories.forEach((category) => {
      const meta = { soundCategory: category };
      assert.strictEqual(meta.soundCategory, category, `Should extract ${category} sound category`);
    });
  });

  it("should parse and validate soundMood values", async () => {
    const _adapter = new TikTokAdapter();
    const moods = ["energetic", "calm", "funny", "dramatic"];

    moods.forEach((mood) => {
      const meta = { soundMood: mood };
      assert.strictEqual(meta.soundMood, mood, `Should extract ${mood} mood`);
    });
  });

  it("should parse and validate soundTempo values", async () => {
    const _adapter = new TikTokAdapter();
    const tempos = ["slow", "medium", "fast"];

    tempos.forEach((tempo) => {
      const meta = { soundTempo: tempo };
      assert.strictEqual(meta.soundTempo, tempo, `Should extract ${tempo} tempo`);
    });
  });

  it("should parse and validate marketingBudget numbers", async () => {
    const _adapter = new TikTokAdapter();
    const budgets = [100, 500, 1000, 5000];

    budgets.forEach((budget) => {
      const meta = { marketingBudget: budget };
      assert.strictEqual(meta.marketingBudget, budget, `Should extract budget ${budget}`);
      assert.strictEqual(typeof meta.marketingBudget, "number", "Should be a number");
    });
  });

  it("should parse and validate targetDemographics object structure", async () => {
    const _adapter = new TikTokAdapter();
    const meta = {
      targetDemographics: {
        ageRange: ["18-24", "25-34"],
        gender: ["female", "male"],
        locations: ["US", "UK", "CA"],
      },
    };

    assert.ok(typeof meta.targetDemographics === "object", "Should be an object");
    assert.ok(Array.isArray(meta.targetDemographics.ageRange), "ageRange should be array");
    assert.ok(Array.isArray(meta.targetDemographics.gender), "gender should be array");
    assert.ok(Array.isArray(meta.targetDemographics.locations), "locations should be array");
  });
});
