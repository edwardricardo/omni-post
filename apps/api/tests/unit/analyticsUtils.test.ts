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

import { describe, it, expect } from "vitest";
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

    expect(metrics.totalViews).toBe(1000);
    expect(metrics.totalLikes).toBe(100);
    expect(metrics.totalComments).toBe(50);
    expect(metrics.totalShares).toBe(25);
    expect(metrics.totalEngagement).toBe(175);
    expect(metrics.avgViewsPerPost).toBe(1000);
    expect(metrics.avgEngagementRate).toBe(17.5);
  });

  it("should calculate correct metrics for multiple analytics entries", () => {
    const analytics = [
      createAnalytics({ views: 1000, likes: 100, comments: 50, shares: 25 }),
      createAnalytics({ views: 2000, likes: 200, comments: 100, shares: 50 }),
      createAnalytics({ views: 500, likes: 50, comments: 25, shares: 10 }),
    ];

    const metrics = AnalyticsAggregator.calculateEngagementMetrics(analytics);

    expect(metrics.totalViews).toBe(3500);
    expect(metrics.totalLikes).toBe(350);
    expect(metrics.totalComments).toBe(175);
    expect(metrics.totalShares).toBe(85);
    expect(metrics.totalEngagement).toBe(610);
    expect(metrics.avgViewsPerPost).toBe(3500 / 3);
  });

  it("should return zero metrics for empty array", () => {
    const metrics = AnalyticsAggregator.calculateEngagementMetrics([]);

    expect(metrics.totalViews).toBe(0);
    expect(metrics.totalLikes).toBe(0);
    expect(metrics.totalComments).toBe(0);
    expect(metrics.totalShares).toBe(0);
    expect(metrics.totalEngagement).toBe(0);
    expect(metrics.avgEngagementRate).toBe(0);
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

    expect(metrics.totalViews).toBe(0);
    expect(metrics.totalLikes).toBe(0);
    expect(metrics.totalComments).toBe(0);
    expect(metrics.totalShares).toBe(0);
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

    expect(rate).toBe(17.5);
  });

  it("should return zero rate when views is zero", () => {
    const analytics = createAnalytics({
      views: 0,
      likes: 100,
      comments: 50,
      shares: 25,
    });

    const rate = AnalyticsAggregator.calculateEngagementRate(analytics);

    expect(rate).toBe(0);
  });

  it("should handle null engagement metrics", () => {
    const analytics = createAnalytics({
      views: 1000,
      likes: null,
      comments: null,
      shares: null,
    });

    const rate = AnalyticsAggregator.calculateEngagementRate(analytics);

    expect(rate).toBe(0);
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

    expect(grouped.length).toBe(2);
    expect(grouped[0]!.date).toBe("2024-01-15");
    expect(grouped[0]!.views).toBe(3000);
    expect(grouped[0]!.posts).toBe(2);
    expect(grouped[1]!.date).toBe("2024-01-16");
    expect(grouped[1]!.views).toBe(500);
  });

  it("should group analytics by hour", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-15T10:30:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-15T10:45:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-01-15T11:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "hour");

    expect(grouped.length).toBe(2);
    expect(grouped[0]!.views).toBe(3000);
    expect(grouped[1]!.views).toBe(500);
    expect(grouped[0]!.posts).toBe(2);
    expect(grouped[1]!.posts).toBe(1);
  });

  it("should group analytics by month", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-15T10:00:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-20T10:00:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-02-15T10:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "month");

    expect(grouped.length).toBe(2);
    expect(grouped[0]!.date).toBe("2024-01");
    expect(grouped[0]!.views).toBe(3000);
    expect(grouped[1]!.date).toBe("2024-02");
  });

  it("should return sorted time series data", () => {
    const analytics = [
      createAnalytics({ id: "1", capturedAt: new Date("2024-01-20T10:00:00Z"), views: 1000 }),
      createAnalytics({ id: "2", capturedAt: new Date("2024-01-15T10:00:00Z"), views: 2000 }),
      createAnalytics({ id: "3", capturedAt: new Date("2024-01-18T10:00:00Z"), views: 500 }),
    ];

    const grouped = AnalyticsAggregator.groupByPeriod(analytics, "day");

    expect(grouped[0]!.date < grouped[1]!.date).toBeTruthy();
    expect(grouped[1]!.date < grouped[2]!.date).toBeTruthy();
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

    expect(topPerforming.length).toBe(2);
    expect(topPerforming[0]!.id).toBe("2");
    expect(topPerforming[1]!.id).toBe("1");
  });

  it("should find poor performing posts", () => {
    const analytics = [
      createAnalytics({ id: "1", views: 1000, likes: 100, comments: 50, shares: 25 }), // 17.5% rate
      createAnalytics({ id: "2", views: 1000, likes: 200, comments: 100, shares: 50 }), // 35% rate
      createAnalytics({ id: "3", views: 1000, likes: 50, comments: 25, shares: 10 }), // 8.5% rate
    ];

    const poorPerforming = AnalyticsAggregator.findPoorPerforming(analytics, 2);

    expect(poorPerforming.length).toBe(2);
    expect(poorPerforming[0]!.id).toBe("3");
    expect(poorPerforming[1]!.id).toBe("1");
  });

  it("should filter out low view posts from poor performing", () => {
    const analytics = [
      createAnalytics({ id: "1", views: 50, likes: 1, comments: 0, shares: 0 }), // Low views
      createAnalytics({ id: "2", views: 1000, likes: 10, comments: 5, shares: 2 }), // 1.7% rate
    ];

    const poorPerforming = AnalyticsAggregator.findPoorPerforming(analytics, 10);

    expect(poorPerforming.length).toBe(1);
    expect(poorPerforming[0]!.id).toBe("2");
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

    expect(growth.viewsGrowth).toBe(50);
    expect(growth.likesGrowth).toBe(50);
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

    expect(growth.viewsGrowth).toBe(100);
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

    expect(percentile).toBe(40);
  });

  it("should return 100 for value above all", () => {
    const analytics = [createAnalytics({ views: 100 }), createAnalytics({ views: 200 })];

    const percentile = AnalyticsAggregator.calculatePercentile(analytics, "views", 300);

    expect(percentile).toBe(100);
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

    expect(movingAvg.length).toBe(2);
    expect(movingAvg[0]!.views).toBe(150);
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

    expect(movingAvg.length).toBe(2);
    expect(movingAvg).toBe(dataPoints);
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

    expect(comparison.groupA.totalViews).toBe(1000);
    expect(comparison.groupB.totalViews).toBe(500);
    expect(comparison.difference.totalViews).toBe(500);
    expect(comparison.percentChange.totalViews).toBe(100);
  });

  it("should handle zero values in comparison", () => {
    const groupA = [createAnalytics({ views: 1000, likes: 100, comments: 50, shares: 25 })];

    const groupB: Analytics[] = [];

    const comparison = AnalyticsAggregator.compareGroups(groupA, groupB);

    expect(comparison.groupB.totalViews).toBe(0);
    expect(comparison.percentChange.totalViews).toBe(100);
  });
});
