/**
 * Comprehensive Tests for EngagementPredictor (engagementPredictor.ts)
 *
 * This test suite validates the rule-based engagement scoring logic for social media content.
 *
 * Tests cover platform-specific configurations and helper methods.
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/engagementPredictor.test.ts
 *
 * @file engagementPredictor.test.ts
 * @description Tests for EngagementPredictor - Initialization
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { EngagementPredictor } from "../../src/analytics/engagementPredictor.js";
import {
  PLATFORM_MULTIPLIERS,
  MODEL_WEIGHTS,
} from "../../src/analytics/engagementPredictor.config.js";
import { getDayName, getMonthName } from "../../src/analytics/engagementPredictor.scoring.js";

describe("EngagementPredictor - Initialization", () => {
  it("initializes successfully", () => {
    const predictor = new EngagementPredictor();
    expect(predictor instanceof EngagementPredictor).toBeTruthy();
  });
});

describe("EngagementPredictor - Platform Configuration", () => {
  it("Twitter optimal length is 120 characters", () => {
    expect(PLATFORM_MULTIPLIERS.twitter.textOptimal).toBe(120);
  });

  it("Instagram optimal length is 150 characters", () => {
    expect(PLATFORM_MULTIPLIERS.instagram.textOptimal).toBe(150);
  });

  it("LinkedIn optimal length is 300 characters", () => {
    expect(PLATFORM_MULTIPLIERS.linkedin.textOptimal).toBe(300);
  });
});

describe("EngagementPredictor - Hashtag Configuration", () => {
  it("Twitter prefers 2 hashtags", () => {
    expect(PLATFORM_MULTIPLIERS.twitter.hashtagOptimal).toBe(2);
  });

  it("Instagram prefers 8 hashtags", () => {
    expect(PLATFORM_MULTIPLIERS.instagram.hashtagOptimal).toBe(8);
  });

  it("LinkedIn prefers 5 hashtags", () => {
    expect(PLATFORM_MULTIPLIERS.linkedin.hashtagOptimal).toBe(5);
  });
});

describe("EngagementPredictor - Peak Hours Configuration", () => {
  it("Twitter has 4 peak hours", () => {
    const expectedPeakHours = [9, 12, 17, 19];

    expect(Array.isArray(PLATFORM_MULTIPLIERS.twitter.peakHours)).toBeTruthy();
    expect(PLATFORM_MULTIPLIERS.twitter.peakHours.length).toBe(expectedPeakHours.length);

    expectedPeakHours.forEach((hour) => {
      expect(PLATFORM_MULTIPLIERS.twitter.peakHours.includes(hour)).toBeTruthy();
    });
  });

  it("Instagram has more peak hours than Twitter", () => {
    const twitterPeakHours = PLATFORM_MULTIPLIERS.twitter.peakHours;
    const instagramPeakHours = PLATFORM_MULTIPLIERS.instagram.peakHours;

    expect(instagramPeakHours.length >= twitterPeakHours.length).toBeTruthy();
  });
});

describe("EngagementPredictor - Content Type Multipliers", () => {
  it("video content has high multiplier on TikTok", () => {
    const videoMultiplier = PLATFORM_MULTIPLIERS.tiktok.contentTypeMultipliers.video;
    expect(videoMultiplier > 2.0).toBeTruthy();
  });

  it("reel content performs best on Instagram", () => {
    const reelMultiplier = PLATFORM_MULTIPLIERS.instagram.contentTypeMultipliers.reel;
    expect(reelMultiplier > 2.0).toBeTruthy();
  });

  it("text content performs relatively better on LinkedIn", () => {
    const linkedinTextMultiplier = PLATFORM_MULTIPLIERS.linkedin.contentTypeMultipliers.text;
    const instagramTextMultiplier = PLATFORM_MULTIPLIERS.instagram.contentTypeMultipliers.text;

    expect(linkedinTextMultiplier > instagramTextMultiplier).toBeTruthy();
  });
});

describe("EngagementPredictor - Model Weights", () => {
  it("model weights are properly configured", () => {
    expect(MODEL_WEIGHTS.contentLength < 0).toBeTruthy(); // Negative impact
    expect(MODEL_WEIGHTS.mediaPresence > 0.3).toBeTruthy(); // Strong positive
    expect(MODEL_WEIGHTS.historicalPerformance > 0.2).toBeTruthy(); // Meaningful weight
  });

  it("hashtag usage has positive weight", () => {
    expect(MODEL_WEIGHTS.hashtagCount > 0).toBeTruthy();
    expect(MODEL_WEIGHTS.hashtagCount < 0.5).toBeTruthy();
  });

  it("timing factors have meaningful weights", () => {
    expect(MODEL_WEIGHTS.timeOfDay > 0).toBeTruthy();
    expect(MODEL_WEIGHTS.dayOfWeek > 0).toBeTruthy();
    expect(MODEL_WEIGHTS.timeOfDay > MODEL_WEIGHTS.dayOfWeek).toBeTruthy();
  });
});

describe("EngagementPredictor - Helper Methods", () => {
  it("getDayName returns correct day names", () => {
    expect(getDayName(0)).toBe("Sunday");
    expect(getDayName(1)).toBe("Monday");
    expect(getDayName(3)).toBe("Wednesday");
  });

  it("getMonthName returns correct month names", () => {
    expect(getMonthName(0)).toBe("January");
    expect(getMonthName(11)).toBe("December");
  });
});
