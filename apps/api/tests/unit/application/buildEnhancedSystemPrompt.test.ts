/**
 * @file buildEnhancedSystemPrompt.test.ts
 * @description Unit tests for buildEnhancedSystemPrompt.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildEnhancedSystemPrompt } from "@core/application/ai/buildEnhancedSystemPrompt.js";

describe("buildEnhancedSystemPrompt", () => {
  it("includes brand voice when available", () => {
    const prompt = buildEnhancedSystemPrompt({
      brandVoice: "Write in a friendly, approachable tone. Use casual language.",
    });

    assert.ok(prompt.includes("BRAND VOICE"));
    assert.ok(prompt.includes("friendly, approachable"));
  });

  it("includes top performer examples when available", () => {
    const prompt = buildEnhancedSystemPrompt({
      performanceContext: {
        posts: [
          {
            content: "Check out our new feature!",
            platform: "INSTAGRAM",
            engagementRate: 8.5,
            impressions: 1000,
            publishedAt: new Date("2026-03-10"),
          },
        ],
        accountAvgEngagement: 3.0,
        topPerformingPlatform: "INSTAGRAM",
        insights: ["Videos outperform images 3x"],
      },
    });

    assert.ok(prompt.includes("WHAT WORKS FOR THIS BRAND"));
    assert.ok(prompt.includes("Check out our new feature!"));
    assert.ok(prompt.includes("8.5%"));
  });

  it("includes performance insights", () => {
    const prompt = buildEnhancedSystemPrompt({
      performanceContext: {
        posts: [
          {
            content: "Test post",
            platform: "X",
            engagementRate: 5,
            impressions: 500,
            publishedAt: new Date(),
          },
        ],
        accountAvgEngagement: 2.5,
        topPerformingPlatform: "X",
        insights: ["Posts on Tuesday get 40% more reach", "Questions get 2x comments"],
      },
    });

    assert.ok(prompt.includes("Key insights"));
    assert.ok(prompt.includes("Posts on Tuesday"));
    assert.ok(prompt.includes("Questions get 2x"));
  });

  it("produces valid prompt when both brand voice and data are missing", () => {
    const prompt = buildEnhancedSystemPrompt({});

    assert.ok(prompt.length > 0);
    assert.ok(prompt.includes("social media content expert"));
  });

  it("prompt with performance data is longer than without", () => {
    const withData = buildEnhancedSystemPrompt({
      brandVoice: "Be professional",
      performanceContext: {
        posts: [
          {
            content: "Great post",
            platform: "X",
            engagementRate: 5,
            impressions: 500,
            publishedAt: new Date(),
          },
        ],
        accountAvgEngagement: 2,
        topPerformingPlatform: "X",
        insights: ["Insight 1"],
      },
    });
    const withoutData = buildEnhancedSystemPrompt({ brandVoice: "Be professional" });

    assert.ok(withData.length > withoutData.length);
  });

  it("handles empty posts array gracefully", () => {
    const prompt = buildEnhancedSystemPrompt({
      brandVoice: "Be fun",
      performanceContext: {
        posts: [],
        accountAvgEngagement: 0,
        topPerformingPlatform: null,
        insights: [],
      },
    });

    assert.ok(prompt.includes("BRAND VOICE"));
    assert.ok(!prompt.includes("WHAT WORKS"));
  });
});
