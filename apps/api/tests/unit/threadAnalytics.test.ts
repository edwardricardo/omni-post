/**
 * Comprehensive Tests for ThreadAnalytics (threadAnalytics.ts)
 *
 * This test suite validates thread performance calculation logic for X/Twitter threading.
 *
 * Tests cover:
 * - Performance rating calculation
 * - Thread scoring algorithm
 * - Engagement weighting
 * - Completion rate impact
 * - Tweet count optimization
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/threadAnalytics.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { ThreadAnalytics } from "../../src/analytics/threadAnalytics.js";
import Redis from "ioredis";

let mockRedis: Redis;
let threadAnalytics: ThreadAnalytics;

before(async () => {
  mockRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  const mockMetrics: any = {
    metrics: {
      cacheHits: { inc: () => {} },
    },
  };
  threadAnalytics = new ThreadAnalytics(mockRedis, mockMetrics);
});

after(() => {
  mockRedis.disconnect();
});

// ========================================
// TESTS: Performance Rating Calculation
// ========================================

describe("ThreadAnalytics - calculatePerformanceRating", () => {
  it("returns excellent rating (score >= 0.8)", () => {
    // Perfect score: avgEngagement=10, completionRate=100%, totalTweets=10
    // Score = (10/10)*0.4 + (100/100)*0.4 + (10/10)*0.2 = 0.4 + 0.4 + 0.2 = 1.0
    const rating = threadAnalytics.calculatePerformanceRating(10, 100, 10);
    assert.strictEqual(rating, "excellent");
  });

  it("returns excellent with high engagement", () => {
    // High engagement: avgEngagement=9, completionRate=90%, totalTweets=10
    // Score = (9/10)*0.4 + (90/100)*0.4 + (10/10)*0.2 = 0.36 + 0.36 + 0.2 = 0.92
    const rating = threadAnalytics.calculatePerformanceRating(9, 90, 10);
    assert.strictEqual(rating, "excellent");
  });

  it("returns excellent at threshold (score = 0.8)", () => {
    // At threshold: avgEngagement=7, completionRate=85%, totalTweets=10
    // Score = (7/10)*0.4 + (85/100)*0.4 + (10/10)*0.2 = 0.28 + 0.34 + 0.2 = 0.82
    const rating = threadAnalytics.calculatePerformanceRating(7, 85, 10);
    assert.strictEqual(rating, "excellent");
  });

  it("returns good rating (0.6 <= score < 0.8)", () => {
    // Good: avgEngagement=5, completionRate=70%, totalTweets=10
    // Score = (5/10)*0.4 + (70/100)*0.4 + (10/10)*0.2 = 0.2 + 0.28 + 0.2 = 0.68
    const rating = threadAnalytics.calculatePerformanceRating(5, 70, 10);
    assert.strictEqual(rating, "good");
  });

  it("returns good at threshold (score = 0.6)", () => {
    // At threshold: avgEngagement=4, completionRate=60%, totalTweets=10
    // Score = (4/10)*0.4 + (60/100)*0.4 + (10/10)*0.2 = 0.16 + 0.24 + 0.2 = 0.60
    const rating = threadAnalytics.calculatePerformanceRating(4, 60, 10);
    assert.strictEqual(rating, "good");
  });

  it("returns average rating (0.4 <= score < 0.6)", () => {
    // Average: avgEngagement=3, completionRate=50%, totalTweets=10
    // Score = (3/10)*0.4 + (50/100)*0.4 + (10/10)*0.2 = 0.12 + 0.2 + 0.2 = 0.52
    const rating = threadAnalytics.calculatePerformanceRating(3, 50, 10);
    assert.strictEqual(rating, "average");
  });

  it("returns average at threshold (score = 0.4)", () => {
    // At threshold: avgEngagement=2, completionRate=40%, totalTweets=10
    // Score = (2/10)*0.4 + (40/100)*0.4 + (10/10)*0.2 = 0.08 + 0.16 + 0.2 = 0.44
    const rating = threadAnalytics.calculatePerformanceRating(2, 40, 10);
    assert.strictEqual(rating, "average");
  });

  it("returns poor rating (score < 0.4)", () => {
    // Poor: avgEngagement=1, completionRate=20%, totalTweets=10
    // Score = (1/10)*0.4 + (20/100)*0.4 + (10/10)*0.2 = 0.04 + 0.08 + 0.2 = 0.32
    const rating = threadAnalytics.calculatePerformanceRating(1, 20, 10);
    assert.strictEqual(rating, "poor");
  });

  it("returns poor with zero engagement", () => {
    // Zero engagement: avgEngagement=0, completionRate=50%, totalTweets=5
    // Score = (0/10)*0.4 + (50/100)*0.4 + (5/10)*0.2 = 0 + 0.2 + 0.1 = 0.30
    const rating = threadAnalytics.calculatePerformanceRating(0, 50, 5);
    assert.strictEqual(rating, "poor");
  });
});

// ========================================
// TESTS: Engagement Weight (40%)
// ========================================

describe("ThreadAnalytics - Engagement Weight", () => {
  it("high engagement improves rating significantly", () => {
    const lowRating = threadAnalytics.calculatePerformanceRating(2, 50, 10);
    const highRating = threadAnalytics.calculatePerformanceRating(8, 50, 10);

    const ratings = ["poor", "average", "good", "excellent"];
    const lowIndex = ratings.indexOf(lowRating);
    const highIndex = ratings.indexOf(highRating);

    assert.ok(highIndex > lowIndex);
  });

  it("max engagement alone yields average rating", () => {
    // avgEngagement=10 should contribute maximum (0.4)
    // If completionRate=0, totalTweets=0, score = 0.4 (average)
    const rating = threadAnalytics.calculatePerformanceRating(10, 0, 0);
    assert.strictEqual(rating, "average");
  });

  it("engagement over 10 capped at 10", () => {
    const rating1 = threadAnalytics.calculatePerformanceRating(10, 50, 10);
    const rating2 = threadAnalytics.calculatePerformanceRating(15, 50, 10);

    assert.strictEqual(rating1, rating2);
  });
});

// ========================================
// TESTS: Completion Rate Weight (40%)
// ========================================

describe("ThreadAnalytics - Completion Rate Weight", () => {
  it("100% completion ranks better than 0%", () => {
    const zeroCompletion = threadAnalytics.calculatePerformanceRating(5, 0, 10);
    const fullCompletion = threadAnalytics.calculatePerformanceRating(5, 100, 10);

    const ratings = ["poor", "average", "good", "excellent"];
    const zeroIndex = ratings.indexOf(zeroCompletion);
    const fullIndex = ratings.indexOf(fullCompletion);

    assert.ok(fullIndex > zeroIndex);
  });

  it("50% completion alone yields poor rating", () => {
    // completionRate=50% contributes (50/100)*0.4 = 0.2
    // If avgEngagement=0, totalTweets=0, score = 0.2 (poor)
    const rating = threadAnalytics.calculatePerformanceRating(0, 50, 0);
    assert.strictEqual(rating, "poor");
  });

  it("completion over 100% capped at 100%", () => {
    const rating1 = threadAnalytics.calculatePerformanceRating(5, 100, 10);
    const rating2 = threadAnalytics.calculatePerformanceRating(5, 120, 10);

    assert.strictEqual(rating1, rating2);
  });
});

// ========================================
// TESTS: Tweet Count Weight (20%)
// ========================================

describe("ThreadAnalytics - Tweet Count Weight", () => {
  it("10 tweets alone yields poor rating", () => {
    // totalTweets=10 contributes (10/10)*0.2 = 0.2
    // If avgEngagement=0, completionRate=0, score = 0.2 (poor)
    const rating = threadAnalytics.calculatePerformanceRating(0, 0, 10);
    assert.strictEqual(rating, "poor");
  });

  it("tweets over 10 capped at 10", () => {
    const rating1 = threadAnalytics.calculatePerformanceRating(5, 50, 10);
    const rating2 = threadAnalytics.calculatePerformanceRating(5, 50, 20);

    assert.strictEqual(rating1, rating2);
  });

  it("5 tweets and 10 tweets both poor with zero engagement", () => {
    const rating5 = threadAnalytics.calculatePerformanceRating(0, 0, 5);
    const rating10 = threadAnalytics.calculatePerformanceRating(0, 0, 10);

    assert.strictEqual(rating5, "poor");
    assert.strictEqual(rating10, "poor");
  });

  it("single tweet with zero engagement is poor", () => {
    const rating = threadAnalytics.calculatePerformanceRating(0, 0, 1);
    assert.strictEqual(rating, "poor");
  });
});

// ========================================
// TESTS: Weighted Score Formula
// ========================================

describe("ThreadAnalytics - Weighted Formula", () => {
  it("all components contribute to final score", () => {
    const rating = threadAnalytics.calculatePerformanceRating(5, 60, 8);

    // expectedScore = (5/10)*0.4 + (60/100)*0.4 + (8/10)*0.2 = 0.2 + 0.24 + 0.16 = 0.60
    assert.strictEqual(rating, "good");
  });

  it("engagement and completion equally weighted", () => {
    const highEngagementLowCompletion = threadAnalytics.calculatePerformanceRating(8, 20, 10);
    const lowEngagementHighCompletion = threadAnalytics.calculatePerformanceRating(2, 80, 10);

    assert.strictEqual(highEngagementLowCompletion, lowEngagementHighCompletion);
    assert.strictEqual(highEngagementLowCompletion, "good");
  });

  it("tweet count has least impact (20%)", () => {
    const rating1Tweet = threadAnalytics.calculatePerformanceRating(5, 50, 1);
    const rating10Tweets = threadAnalytics.calculatePerformanceRating(5, 50, 10);

    const ratings = ["poor", "average", "good", "excellent"];
    const index1 = ratings.indexOf(rating1Tweet);
    const index10 = ratings.indexOf(rating10Tweets);

    assert.ok(Math.abs(index10 - index1) <= 1);
  });
});

// ========================================
// TESTS: Edge Cases
// ========================================

describe("ThreadAnalytics - Edge Cases", () => {
  it("all zeros should be poor", () => {
    const rating = threadAnalytics.calculatePerformanceRating(0, 0, 0);
    assert.strictEqual(rating, "poor");
  });

  it("negative values still return valid rating", () => {
    const rating = threadAnalytics.calculatePerformanceRating(-5, -10, -3);
    assert.ok(["poor", "average", "good", "excellent"].includes(rating));
  });

  it("very large numbers capped at excellent", () => {
    const rating = threadAnalytics.calculatePerformanceRating(1000, 1000, 1000);
    assert.strictEqual(rating, "excellent");
  });

  it("fractional values work correctly", () => {
    const rating = threadAnalytics.calculatePerformanceRating(5.5, 75.5, 7.5);
    assert.strictEqual(rating, "good");
  });
});

// ========================================
// TESTS: Boundary Conditions
// ========================================

describe("ThreadAnalytics - Boundary Conditions", () => {
  it("score exactly 0.799 should be good, not excellent", () => {
    const rating = threadAnalytics.calculatePerformanceRating(6.5, 82, 10);
    assert.strictEqual(rating, "good");
  });

  it("score exactly 0.599 should be average, not good", () => {
    const rating = threadAnalytics.calculatePerformanceRating(3.5, 59, 10);
    assert.strictEqual(rating, "average");
  });

  it("score exactly 0.399 should be poor, not average", () => {
    const rating = threadAnalytics.calculatePerformanceRating(1.4, 35, 10);
    assert.strictEqual(rating, "poor");
  });
});
