/**
 * Comprehensive Tests for EngagementPredictor (engagementPredictor.ts)
 *
 * This test suite validates the rule-based engagement scoring logic for social media content.
 *
 * Tests cover platform-specific configurations and helper methods.
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/engagementPredictor.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EngagementPredictor } from "../../src/analytics/engagementPredictor.js";
import {
  PLATFORM_MULTIPLIERS,
  MODEL_WEIGHTS,
} from "../../src/analytics/engagementPredictor.config.js";
import { getDayName, getMonthName } from "../../src/analytics/engagementPredictor.scoring.js";

describe("EngagementPredictor - Initialization", () => {
  it("initializes successfully", () => {
    const predictor = new EngagementPredictor();
    assert.ok(
      predictor instanceof EngagementPredictor,
      "Should be an EngagementPredictor instance"
    );
  });
});

describe("EngagementPredictor - Platform Configuration", () => {
  it("Twitter optimal length is 120 characters", () => {
    assert.strictEqual(PLATFORM_MULTIPLIERS.twitter.textOptimal, 120);
  });

  it("Instagram optimal length is 150 characters", () => {
    assert.strictEqual(PLATFORM_MULTIPLIERS.instagram.textOptimal, 150);
  });

  it("LinkedIn optimal length is 300 characters", () => {
    assert.strictEqual(PLATFORM_MULTIPLIERS.linkedin.textOptimal, 300);
  });
});

describe("EngagementPredictor - Hashtag Configuration", () => {
  it("Twitter prefers 2 hashtags", () => {
    assert.strictEqual(PLATFORM_MULTIPLIERS.twitter.hashtagOptimal, 2);
  });

  it("Instagram prefers 8 hashtags", () => {
    assert.strictEqual(PLATFORM_MULTIPLIERS.instagram.hashtagOptimal, 8);
  });

  it("LinkedIn prefers 5 hashtags", () => {
    assert.strictEqual(PLATFORM_MULTIPLIERS.linkedin.hashtagOptimal, 5);
  });
});

describe("EngagementPredictor - Peak Hours Configuration", () => {
  it("Twitter has 4 peak hours", () => {
    const expectedPeakHours = [9, 12, 17, 19];

    assert.ok(Array.isArray(PLATFORM_MULTIPLIERS.twitter.peakHours));
    assert.strictEqual(PLATFORM_MULTIPLIERS.twitter.peakHours.length, expectedPeakHours.length);

    expectedPeakHours.forEach((hour) => {
      assert.ok(PLATFORM_MULTIPLIERS.twitter.peakHours.includes(hour));
    });
  });

  it("Instagram has more peak hours than Twitter", () => {
    const twitterPeakHours = PLATFORM_MULTIPLIERS.twitter.peakHours;
    const instagramPeakHours = PLATFORM_MULTIPLIERS.instagram.peakHours;

    assert.ok(instagramPeakHours.length >= twitterPeakHours.length);
  });
});

describe("EngagementPredictor - Content Type Multipliers", () => {
  it("video content has high multiplier on TikTok", () => {
    const videoMultiplier = PLATFORM_MULTIPLIERS.tiktok.contentTypeMultipliers.video;
    assert.ok(videoMultiplier > 2.0);
  });

  it("reel content performs best on Instagram", () => {
    const reelMultiplier = PLATFORM_MULTIPLIERS.instagram.contentTypeMultipliers.reel;
    assert.ok(reelMultiplier > 2.0);
  });

  it("text content performs relatively better on LinkedIn", () => {
    const linkedinTextMultiplier = PLATFORM_MULTIPLIERS.linkedin.contentTypeMultipliers.text;
    const instagramTextMultiplier = PLATFORM_MULTIPLIERS.instagram.contentTypeMultipliers.text;

    assert.ok(linkedinTextMultiplier > instagramTextMultiplier);
  });
});

describe("EngagementPredictor - Model Weights", () => {
  it("model weights are properly configured", () => {
    assert.ok(MODEL_WEIGHTS.contentLength < 0); // Negative impact
    assert.ok(MODEL_WEIGHTS.mediaPresence > 0.3); // Strong positive
    assert.ok(MODEL_WEIGHTS.historicalPerformance > 0.2); // Meaningful weight
  });

  it("hashtag usage has positive weight", () => {
    assert.ok(MODEL_WEIGHTS.hashtagCount > 0);
    assert.ok(MODEL_WEIGHTS.hashtagCount < 0.5);
  });

  it("timing factors have meaningful weights", () => {
    assert.ok(MODEL_WEIGHTS.timeOfDay > 0);
    assert.ok(MODEL_WEIGHTS.dayOfWeek > 0);
    assert.ok(MODEL_WEIGHTS.timeOfDay > MODEL_WEIGHTS.dayOfWeek);
  });
});

describe("EngagementPredictor - Helper Methods", () => {
  it("getDayName returns correct day names", () => {
    assert.strictEqual(getDayName(0), "Sunday");
    assert.strictEqual(getDayName(1), "Monday");
    assert.strictEqual(getDayName(3), "Wednesday");
  });

  it("getMonthName returns correct month names", () => {
    assert.strictEqual(getMonthName(0), "January");
    assert.strictEqual(getMonthName(11), "December");
  });
});
