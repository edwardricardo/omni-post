/**
 * Analytics Aggregator Unit Tests
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the analytics calculation and aggregation logic
 * for social media performance metrics across multiple platforms.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - Engagement metrics calculation (views, likes, comments, shares)
 * - Time series data grouping (hourly, daily, monthly)
 * - Performance analytics (top/poor performing content)
 * - Growth rate calculations across time periods
 * - Statistical analysis (percentiles, moving averages)
 * - Group comparisons for A/B testing and optimization
 *
 * ANALYTICS BUSINESS RULES:
 * - Engagement rate = (likes + comments + shares) / views * 100
 * - Poor performing posts must have >100 views to be statistically significant
 * - Time series data is always sorted chronologically
 * - Null values are treated as zero in aggregations
 * - Growth rates handle zero-division edge cases (0 previous = 100% growth)
 *
 * DEPENDENCIES:
 * - Pure logic tests - NO database required
 * - NO external services or API calls
 * - NO authentication or authorization
 * - Stateless utility functions only
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api test apps/api/tests/unit/analyticsUtils.test.ts
 *
 * @module AnalyticsUtilsTests
 * @category UnitTests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AnalyticsAggregator,
  type EngagementMetrics,
  type TimeSeriesDataPoint,
} from "../../src/analytics/analyticsUtils.js";
import type { Analytics } from "@infra/prisma";

// ========================================
// TEST UTILITIES
// ========================================

/**
 * Helper to create mock analytics data for testing
 *
 * @param override - Partial analytics data to override defaults
 * @returns Complete Analytics object with sensible defaults
 */
function createAnalytics(override: Partial<Analytics> = {}): Analytics {
  return {
    id: override.id || "test-id",
    publishLogId: override.publishLogId || "log-id",
    views: override.views ?? 1000,
    likes: override.likes ?? 100,
    comments: override.comments ?? 50,
    shares: override.shares ?? 25,
    clicks: override.clicks ?? null,
    impressions: override.impressions ?? null,
    reach: override.reach ?? null,
    saves: override.saves ?? null,
    profileVisits: override.profileVisits ?? null,
    capturedAt: override.capturedAt || new Date("2024-01-15T12:00:00Z"),
    createdAt: override.createdAt || new Date(),
    ...override,
  } as Analytics;
}

// ========================================
// TEST SUITE: Calculate Engagement Metrics
// ========================================

describe("AnalyticsAggregator - Calculate Engagement Metrics", () => {
  it("should calculate correct metrics for single analytics entry", () => {
    const analytics = [
      createAnalytics({
        views: 1000,
        likes: 100,
        comments: 50,
        shares: 25,
      }),
    ];

    const metrics = AnalyticsAggregator.calculateEngagementMetrics(analytics);

    assert.strictEqual(metrics.totalViews, 1000, "Should have correct total views");
    assert.strictEqual(metrics.totalLikes, 100, "Should have correct total likes");
    assert.strictEqual(metrics.totalComments, 50, "Should have correct total comments");
    assert.strictEqual(metrics.totalShares, 25, "Should have correct total shares");
    assert.strictEqual(
      metrics.totalEngagement,
      175,
      "Should calculate total engagement (100+50+25)"
    );
    assert.strictEqual(metrics.avgViewsPerPost, 1000, "Should have correct avg views per post");
    assert.strictEqual(
      metrics.avgEngagementRate,
      17.5,
      "Should calculate engagement rate (175/1000*100)"
    );
  });

  it("should calculate correct metrics for multiple analytics entries", () => {
    const analytics = [
      createAnalytics({ views: 1000, likes: 100, comments: 50, shares: 25 }),
      createAnalytics({ views: 2000, likes: 200, comments: 100, shares: 50 }),
      createAnalytics({ views: 500, likes: 50, comments: 25, shares: 10 }),
    ];

    const metrics = AnalyticsAggregator.calculateEngagementMetrics(analytics);

    assert.strictEqual(metrics.totalViews, 3500, "Should sum all views");
    assert.strictEqual(metrics.totalLikes, 350, "Should sum all likes");
    assert.strictEqual(metrics.totalComments, 175, "Should sum all comments");
    assert.strictEqual(metrics.totalShares, 85, "Should sum all shares");
    assert.strictEqual(metrics.totalEngagement, 610, "Should sum all engagement");
    assert.strictEqual(metrics.avgViewsPerPost, 3500 / 3, "Should calculate avg views per post");
  });

  it("should return zero metrics for empty array", () => {
    const metrics = AnalyticsAggregator.calculateEngagementMetrics([]);

    assert.strictEqual(metrics.totalViews, 0, "Should have zero views");
    assert.strictEqual(metrics.totalLikes, 0, "Should have zero likes");
    assert.strictEqual(metrics.totalComments, 0, "Should have zero comments");
    assert.strictEqual(metrics.totalShares, 0, "Should have zero shares");
    assert.strictEqual(metrics.totalEngagement, 0, "Should have zero engagement");
    assert.strictEqual(metrics.avgEngagementRate, 0, "Should have zero engagement rate");
  });

  it("should handle null values in analytics", () => {
    const analytics = [
      createAnalytics({
        views: null,
        likes: null,
        comments: null,
        shares: null,
      }),
    ];

    const metrics = AnalyticsAggregator.calculateEngagementMetrics(analytics);

    assert.strictEqual(metrics.totalViews, 0, "Should treat null views as 0");
    assert.strictEqual(metrics.totalLikes, 0, "Should treat null likes as 0");
    assert.strictEqual(metrics.totalComments, 0, "Should treat null comments as 0");
    assert.strictEqual(metrics.totalShares, 0, "Should treat null shares as 0");
  });
});

// ========================================
// TEST SUITE: Calculate Engagement Rate
// ========================================

describe("AnalyticsAggregator - Calculate Engagement Rate", () => {
  it("should calculate engagement rate correctly", () => {
    const analytics = createAnalytics({
      views: 1000,
      likes: 100,
      comments: 50,
      shares: 25,
    });

    const rate = AnalyticsAggregator.calculateEngagementRate(analytics);

    assert.strictEqual(rate, 17.5, "Should calculate correct rate (175/1000*100)");
  });

  it("should return zero rate when views is zero", () => {
    const analytics = createAnalytics({
      views: 0,
      likes: 100,
      comments: 50,
      shares: 25,
    });

    const rate = AnalyticsAggregator.calculateEngagementRate(analytics);

    assert.strictEqual(rate, 0, "Should return 0 when views is 0");
  });

  it("should handle null engagement metrics", () => {
    const analytics = createAnalytics({
      views: 1000,
      likes: null,
      comments: null,
      shares: null,
    });

    const rate = AnalyticsAggregator.calculateEngagementRate(analytics);

    assert.strictEqual(rate, 0, "Should return 0 when all engagement is null");
  });
});

// ========================================
// TEST SUITE: Group By Period
// ========================================

describe("AnalyticsAggregator - Group By Period", () => {
  it("should group analytics by day", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-15T10:00:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-15T14:00:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-01-16T10:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "day");

    assert.strictEqual(grouped.length, 2, "Should group into 2 days");
    assert.strictEqual(grouped[0]!.date, "2024-01-15", "First group should be Jan 15");
    assert.strictEqual(grouped[0]!.views, 3000, "First group should have combined views");
    assert.strictEqual(grouped[0]!.posts, 2, "First group should have 2 posts");
    assert.strictEqual(grouped[1]!.date, "2024-01-16", "Second group should be Jan 16");
    assert.strictEqual(grouped[1]!.views, 500, "Second group should have 500 views");
  });

  it("should group analytics by hour", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-15T10:30:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-15T10:45:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-01-15T11:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "hour");

    assert.strictEqual(grouped.length, 2, "Should group into 2 hours");
    assert.strictEqual(
      grouped[0]!.views,
      3000,
      "First group should have combined views from same hour"
    );
    assert.strictEqual(grouped[1]!.views, 500, "Second group should have 500 views");
    assert.strictEqual(grouped[0]!.posts, 2, "First group should have 2 posts");
    assert.strictEqual(grouped[1]!.posts, 1, "Second group should have 1 post");
  });

  it("should group analytics by month", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-15T10:00:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-20T10:00:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-02-15T10:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "month");

    assert.strictEqual(grouped.length, 2, "Should group into 2 months");
    assert.strictEqual(grouped[0]!.date, "2024-01", "First group should be January");
    assert.strictEqual(grouped[0]!.views, 3000, "First group should have combined views");
    assert.strictEqual(grouped[1]!.date, "2024-02", "Second group should be February");
  });

  it("should return sorted time series data", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-20T10:00:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-15T10:00:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-01-18T10:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "day");

    assert.ok(grouped[0]!.date < grouped[1]!.date, "Should be sorted by date ascending");
    assert.ok(grouped[1]!.date < grouped[2]!.date, "Should be sorted by date ascending");
  });
});

// ========================================
// TEST SUITE: Top and Poor Performing
// ========================================

describe("AnalyticsAggregator - Top and Poor Performing", () => {
  it("should find top performing posts", () => {
    const analytics = [
      createAnalytics({ id: "1", views: 1000, likes: 100, comments: 50, shares: 25 }), // 17.5% rate
      createAnalytics({ id: "2", views: 1000, likes: 200, comments: 100, shares: 50 }), // 35% rate
      createAnalytics({ id: "3", views: 1000, likes: 50, comments: 25, shares: 10 }), // 8.5% rate
    ];

    const topPerforming = AnalyticsAggregator.findTopPerforming(analytics, 2);

    assert.strictEqual(topPerforming.length, 2, "Should return 2 top posts");
    assert.strictEqual(topPerforming[0]!.id, "2", "First should be highest engagement rate");
    assert.strictEqual(topPerforming[1]!.id, "1", "Second should be next highest");
  });

  it("should find poor performing posts", () => {
    const analytics = [
      createAnalytics({ id: "1", views: 1000, likes: 100, comments: 50, shares: 25 }), // 17.5% rate
      createAnalytics({ id: "2", views: 1000, likes: 200, comments: 100, shares: 50 }), // 35% rate
      createAnalytics({ id: "3", views: 1000, likes: 50, comments: 25, shares: 10 }), // 8.5% rate
    ];

    const poorPerforming = AnalyticsAggregator.findPoorPerforming(analytics, 2);

    assert.strictEqual(poorPerforming.length, 2, "Should return 2 poor posts");
    assert.strictEqual(poorPerforming[0]!.id, "3", "First should be lowest engagement rate");
    assert.strictEqual(poorPerforming[1]!.id, "1", "Second should be next lowest");
  });

  it("should filter out low view posts from poor performing", () => {
    const analytics = [
      createAnalytics({ id: "1", views: 50, likes: 1, comments: 0, shares: 0 }), // Low views
      createAnalytics({ id: "2", views: 1000, likes: 10, comments: 5, shares: 2 }), // 1.7% rate
    ];

    const poorPerforming = AnalyticsAggregator.findPoorPerforming(analytics, 10);

    assert.strictEqual(poorPerforming.length, 1, "Should exclude posts with <100 views");
    assert.strictEqual(
      poorPerforming[0]!.id,
      "2",
      "Should only include posts with meaningful views"
    );
  });
});

// ========================================
// TEST SUITE: Growth Rate Calculation
// ========================================

describe("AnalyticsAggregator - Growth Rate Calculation", () => {
  it("should calculate positive growth rate", () => {
    const previous: EngagementMetrics = {
      totalViews: 1000,
      totalLikes: 100,
      totalComments: 50,
      totalShares: 25,
      totalEngagement: 175,
      avgEngagementRate: 17.5,
      avgViewsPerPost: 1000,
      avgLikesPerPost: 100,
      avgCommentsPerPost: 50,
      avgSharesPerPost: 25,
    };

    const current: EngagementMetrics = {
      totalViews: 1500,
      totalLikes: 150,
      totalComments: 75,
      totalShares: 37.5,
      totalEngagement: 262.5,
      avgEngagementRate: 17.5,
      avgViewsPerPost: 1500,
      avgLikesPerPost: 150,
      avgCommentsPerPost: 75,
      avgSharesPerPost: 37.5,
    };

    const growth = AnalyticsAggregator.calculateGrowthRate(current, previous);

    assert.strictEqual(growth.viewsGrowth, 50, "Should calculate 50% views growth");
    assert.strictEqual(growth.likesGrowth, 50, "Should calculate 50% likes growth");
  });

  it("should handle zero previous values", () => {
    const previous: EngagementMetrics = {
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalEngagement: 0,
      avgEngagementRate: 0,
      avgViewsPerPost: 0,
      avgLikesPerPost: 0,
      avgCommentsPerPost: 0,
      avgSharesPerPost: 0,
    };

    const current: EngagementMetrics = {
      totalViews: 1000,
      totalLikes: 100,
      totalComments: 50,
      totalShares: 25,
      totalEngagement: 175,
      avgEngagementRate: 17.5,
      avgViewsPerPost: 1000,
      avgLikesPerPost: 100,
      avgCommentsPerPost: 50,
      avgSharesPerPost: 25,
    };

    const growth = AnalyticsAggregator.calculateGrowthRate(current, previous);

    assert.strictEqual(growth.viewsGrowth, 100, "Should return 100% when previous is 0");
  });
});

// ========================================
// TEST SUITE: Percentile Calculation
// ========================================

describe("AnalyticsAggregator - Percentile Calculation", () => {
  it("should calculate percentile correctly", () => {
    const analytics = [
      createAnalytics({ views: 100 }),
      createAnalytics({ views: 200 }),
      createAnalytics({ views: 300 }),
      createAnalytics({ views: 400 }),
      createAnalytics({ views: 500 }),
    ];

    const percentile = AnalyticsAggregator.calculatePercentile(analytics, "views", 300);

    assert.strictEqual(percentile, 40, "Should be at 40th percentile (2/5 * 100)");
  });

  it("should return 100 for value above all", () => {
    const analytics = [createAnalytics({ views: 100 }), createAnalytics({ views: 200 })];

    const percentile = AnalyticsAggregator.calculatePercentile(analytics, "views", 300);

    assert.strictEqual(percentile, 100, "Should return 100 for value above all");
  });
});

// ========================================
// TEST SUITE: Moving Average
// ========================================

describe("AnalyticsAggregator - Moving Average", () => {
  it("should calculate moving average with sufficient data", () => {
    const dataPoints: TimeSeriesDataPoint[] = [
      {
        date: "2024-01-01",
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
        engagement: 17,
        engagementRate: 17,
        posts: 1,
      },
      {
        date: "2024-01-02",
        views: 200,
        likes: 20,
        comments: 10,
        shares: 5,
        engagement: 35,
        engagementRate: 17.5,
        posts: 1,
      },
      {
        date: "2024-01-03",
        views: 300,
        likes: 30,
        comments: 15,
        shares: 8,
        engagement: 53,
        engagementRate: 17.66,
        posts: 1,
      },
    ];

    const movingAvg = AnalyticsAggregator.calculateMovingAverage(dataPoints, 2);

    assert.strictEqual(movingAvg.length, 2, "Should return 2 data points for window size 2");
    assert.strictEqual(movingAvg[0]!.views, 150, "Should average first two points (100+200)/2");
  });

  it("should return original data when window size exceeds data length", () => {
    const dataPoints: TimeSeriesDataPoint[] = [
      {
        date: "2024-01-01",
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
        engagement: 17,
        engagementRate: 17,
        posts: 1,
      },
      {
        date: "2024-01-02",
        views: 200,
        likes: 20,
        comments: 10,
        shares: 5,
        engagement: 35,
        engagementRate: 17.5,
        posts: 1,
      },
    ];

    const movingAvg = AnalyticsAggregator.calculateMovingAverage(dataPoints, 5);

    assert.strictEqual(movingAvg.length, 2, "Should return original data");
    assert.strictEqual(movingAvg, dataPoints, "Should return same reference");
  });
});

// ========================================
// TEST SUITE: Compare Groups
// ========================================

describe("AnalyticsAggregator - Compare Groups", () => {
  it("should compare two groups correctly", () => {
    const groupA = [createAnalytics({ views: 1000, likes: 100, comments: 50, shares: 25 })];

    const groupB = [createAnalytics({ views: 500, likes: 50, comments: 25, shares: 10 })];

    const comparison = AnalyticsAggregator.compareGroups(groupA, groupB);

    assert.strictEqual(comparison.groupA.totalViews, 1000, "Should have groupA metrics");
    assert.strictEqual(comparison.groupB.totalViews, 500, "Should have groupB metrics");
    assert.strictEqual(comparison.difference.totalViews, 500, "Should calculate difference");
    assert.strictEqual(
      comparison.percentChange.totalViews,
      100,
      "Should calculate percent change (100%)"
    );
  });

  it("should handle zero values in comparison", () => {
    const groupA = [createAnalytics({ views: 1000, likes: 100, comments: 50, shares: 25 })];

    const groupB: Analytics[] = [];

    const comparison = AnalyticsAggregator.compareGroups(groupA, groupB);

    assert.strictEqual(comparison.groupB.totalViews, 0, "Should have zero for empty group");
    assert.strictEqual(
      comparison.percentChange.totalViews,
      100,
      "Should return 100% when comparing to zero"
    );
  });
});
