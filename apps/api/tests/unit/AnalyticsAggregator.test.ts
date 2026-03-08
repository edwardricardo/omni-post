#!/usr/bin/env tsx
/**
 * Unit Tests for AnalyticsAggregator
 * Testing analytics calculation and aggregation methods
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/AnalyticsAggregator.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnalyticsAggregator } from "../../src/analytics/analyticsUtils.js";
import type { Analytics } from "@infra/prisma";

// Helper function to create mock Analytics
function createAnalytics(data: Partial<Analytics>): Analytics {
  return {
    id: data.id || "test-id",
    postId: data.postId || "post-id",
    channelId: data.channelId || "channel-id",
    provider: data.provider || "twitter",
    views: data.views ?? 0,
    likes: data.likes ?? 0,
    comments: data.comments ?? 0,
    shares: data.shares ?? 0,
    metadata: data.metadata || null,
    capturedAt: data.capturedAt || new Date(),
    createdAt: data.createdAt || new Date(),
  };
}

describe("AnalyticsAggregator - calculateEngagementMetrics", () => {
  it("returns zero metrics for empty array", () => {
    const emptyMetrics = AnalyticsAggregator.calculateEngagementMetrics([]);

    assert.strictEqual(emptyMetrics.totalViews, 0);
    assert.strictEqual(emptyMetrics.totalLikes, 0);
    assert.strictEqual(emptyMetrics.totalComments, 0);
    assert.strictEqual(emptyMetrics.totalShares, 0);
    assert.strictEqual(emptyMetrics.totalEngagement, 0);
    assert.strictEqual(emptyMetrics.avgEngagementRate, 0);
  });

  it("calculates metrics for single entry", () => {
    const singleAnalytics = [
      createAnalytics({
        views: 1000,
        likes: 50,
        comments: 10,
        shares: 5,
      }),
    ];

    const singleMetrics = AnalyticsAggregator.calculateEngagementMetrics(singleAnalytics);

    assert.strictEqual(singleMetrics.totalViews, 1000);
    assert.strictEqual(singleMetrics.totalLikes, 50);
    assert.strictEqual(singleMetrics.totalComments, 10);
    assert.strictEqual(singleMetrics.totalShares, 5);
    assert.strictEqual(singleMetrics.totalEngagement, 65); // 50 + 10 + 5
    assert.strictEqual(singleMetrics.avgEngagementRate, 6.5); // (65/1000) * 100
    assert.strictEqual(singleMetrics.avgViewsPerPost, 1000);
    assert.strictEqual(singleMetrics.avgLikesPerPost, 50);
  });

  it("aggregates multiple entries correctly", () => {
    const multipleAnalytics = [
      createAnalytics({ views: 1000, likes: 50, comments: 10, shares: 5 }),
      createAnalytics({ views: 2000, likes: 100, comments: 20, shares: 10 }),
      createAnalytics({ views: 500, likes: 25, comments: 5, shares: 2 }),
    ];

    const multipleMetrics = AnalyticsAggregator.calculateEngagementMetrics(multipleAnalytics);

    assert.strictEqual(multipleMetrics.totalViews, 3500); // 1000 + 2000 + 500
    assert.strictEqual(multipleMetrics.totalLikes, 175); // 50 + 100 + 25
    assert.strictEqual(multipleMetrics.totalComments, 35); // 10 + 20 + 5
    assert.strictEqual(multipleMetrics.totalShares, 17); // 5 + 10 + 2
    assert.strictEqual(multipleMetrics.totalEngagement, 227); // 175 + 35 + 17
    assert.ok(Math.abs(multipleMetrics.avgEngagementRate - 6.486) < 0.01); // (227/3500) * 100 ≈ 6.486
    assert.ok(Math.abs(multipleMetrics.avgViewsPerPost - 1166.67) < 0.01); // 3500 / 3
  });
});

describe("AnalyticsAggregator - calculateEngagementRate", () => {
  it("returns 0 for zero views", () => {
    const zeroViewsAnalytics = createAnalytics({
      views: 0,
      likes: 50,
      comments: 10,
      shares: 5,
    });

    const zeroViewsRate = AnalyticsAggregator.calculateEngagementRate(zeroViewsAnalytics);

    assert.strictEqual(zeroViewsRate, 0);
  });

  it("calculates engagement rate correctly", () => {
    const engagedAnalytics = createAnalytics({
      views: 1000,
      likes: 50,
      comments: 10,
      shares: 5,
    });

    const engagementRate = AnalyticsAggregator.calculateEngagementRate(engagedAnalytics);

    assert.strictEqual(engagementRate, 6.5); // (50 + 10 + 5) / 1000 * 100 = 6.5
  });
});

describe("AnalyticsAggregator - groupByPeriod", () => {
  it("groups analytics by day correctly", () => {
    const date1 = new Date("2024-01-01T10:00:00Z");
    const date2 = new Date("2024-01-01T15:00:00Z");
    const date3 = new Date("2024-01-02T10:00:00Z");

    const timeSeriesAnalytics = [
      createAnalytics({ views: 1000, likes: 50, comments: 10, shares: 5, capturedAt: date1 }),
      createAnalytics({ views: 2000, likes: 100, comments: 20, shares: 10, capturedAt: date2 }),
      createAnalytics({ views: 500, likes: 25, comments: 5, shares: 2, capturedAt: date3 }),
    ];

    const groupedByDay = AnalyticsAggregator.groupByPeriod(timeSeriesAnalytics, "day");

    assert.strictEqual(groupedByDay.length, 2); // Two days
    assert.strictEqual(groupedByDay[0]?.date, "2024-01-01");
    assert.strictEqual(groupedByDay[0]?.views, 3000); // 1000 + 2000
    assert.strictEqual(groupedByDay[0]?.posts, 2);
    assert.strictEqual(groupedByDay[1]?.date, "2024-01-02");
    assert.strictEqual(groupedByDay[1]?.views, 500);
    assert.strictEqual(groupedByDay[1]?.posts, 1);
  });
});

describe("AnalyticsAggregator - findTopPerforming", () => {
  it("sorts by engagement rate and returns top N", () => {
    const performanceAnalytics = [
      createAnalytics({ id: "low", views: 1000, likes: 10, comments: 5, shares: 0 }), // 1.5%
      createAnalytics({ id: "high", views: 1000, likes: 50, comments: 20, shares: 10 }), // 8%
      createAnalytics({ id: "medium", views: 1000, likes: 30, comments: 10, shares: 5 }), // 4.5%
    ];

    const topPerforming = AnalyticsAggregator.findTopPerforming(performanceAnalytics, 2);

    assert.strictEqual(topPerforming.length, 2);
    assert.strictEqual(topPerforming[0]?.id, "high");
    assert.strictEqual(topPerforming[1]?.id, "medium");
  });
});

describe("AnalyticsAggregator - calculateGrowthRate", () => {
  it("calculates growth between periods correctly", () => {
    const previousMetrics = {
      totalViews: 1000,
      totalLikes: 50,
      totalComments: 10,
      totalShares: 5,
      totalEngagement: 65,
      avgEngagementRate: 6.5,
      avgViewsPerPost: 1000,
      avgLikesPerPost: 50,
      avgCommentsPerPost: 10,
      avgSharesPerPost: 5,
    };

    const currentMetrics = {
      totalViews: 1500, // 50% growth
      totalLikes: 75, // 50% growth
      totalComments: 20, // 100% growth
      totalShares: 10, // 100% growth
      totalEngagement: 105,
      avgEngagementRate: 7.0,
      avgViewsPerPost: 1500,
      avgLikesPerPost: 75,
      avgCommentsPerPost: 20,
      avgSharesPerPost: 10,
    };

    const growthRate = AnalyticsAggregator.calculateGrowthRate(currentMetrics, previousMetrics);

    assert.strictEqual(growthRate.viewsGrowth, 50);
    assert.strictEqual(growthRate.likesGrowth, 50);
    assert.strictEqual(growthRate.commentsGrowth, 100);
    assert.strictEqual(growthRate.sharesGrowth, 100);
  });
});
