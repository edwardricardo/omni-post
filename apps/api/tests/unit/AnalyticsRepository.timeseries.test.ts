import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaAnalyticsReadRepository } from "../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js";
import { prisma } from "@infra/prisma";
import {
  setupTestData,
  teardownTestData,
  testPostIds,
  testProjectId,
} from "./AnalyticsRepository.test-helpers.js";

describe("AnalyticsRepository - getTimeSeriesData", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("groups analytics by day", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day");

    assert.ok(Array.isArray(timeSeries), "Should return an array");
    assert.ok(timeSeries.length > 0, "Should return time series data");

    timeSeries.forEach((period) => {
      assert.ok(period.period, "Should have period key");
      assert.ok(typeof period.totalViews === "number", "Should have aggregated views");
      assert.ok(typeof period.recordCount === "number", "Should have record count");
    });
  });

  it("groups analytics by hour", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "hour");

    assert.ok(Array.isArray(timeSeries), "Should return hourly data");

    timeSeries.forEach((period) => {
      assert.ok(period.period.length >= 13, "Hour period should have hour precision");
    });
  });

  it("groups analytics by week", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "week");

    assert.ok(Array.isArray(timeSeries), "Should return weekly data");
  });

  it("includes aggregated metrics per period", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day");

    timeSeries.forEach((period) => {
      assert.ok(typeof period.totalViews === "number", "Should have total views");
      assert.ok(typeof period.totalLikes === "number", "Should have total likes");
      assert.ok(typeof period.totalComments === "number", "Should have total comments");
      assert.ok(typeof period.totalShares === "number", "Should have total shares");
      assert.ok(typeof period.totalEngagement === "number", "Should have total engagement");
      assert.ok(typeof period.avgEngagementRate === "number", "Should have engagement rate");
    });
  });

  it("respects date range filters", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day", {
      startDate: twoDaysAgo,
    });

    assert.ok(timeSeries.length > 0, "Should return filtered time series");
  });
});

describe("AnalyticsRepository - getPostsWithAnalytics", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns posts with analytics in single query", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    assert.ok(Array.isArray(posts), "Should return posts array");
    assert.strictEqual(posts.length, 5, "Should return all posts");

    posts.forEach((post) => {
      assert.ok(Array.isArray(post.analytics), "Should include analytics array");
      assert.ok(Array.isArray(post.contents), "Should include contents");
      assert.ok(Array.isArray(post.media), "Should include media");
    });
  });

  it("filters analytics by date range", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const posts = await repo.getPostsWithAnalytics(testProjectId, {
      startDate: twoDaysAgo,
    });

    posts.forEach((post) => {
      post.analytics.forEach((analytics) => {
        assert.ok(analytics.capturedAt >= twoDaysAgo, "Analytics should be after start date");
      });
    });
  });

  it("filters analytics by provider", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId, {
      provider: "X",
    });

    posts.forEach((post) => {
      post.analytics.forEach((analytics) => {
        assert.strictEqual(analytics.provider, "X", "Should only include X analytics");
      });
    });
  });

  it("respects post pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId, { take: 2 });

    assert.strictEqual(posts.length, 2, "Should return paginated posts");
  });

  it("orders posts by createdAt desc", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    for (let i = 0; i < posts.length - 1; i++) {
      assert.ok(
        posts[i]!.createdAt >= posts[i + 1]!.createdAt,
        "Posts should be ordered by createdAt desc"
      );
    }
  });

  it("orders analytics by capturedAt desc within each post", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    posts.forEach((post) => {
      for (let i = 0; i < post.analytics.length - 1; i++) {
        assert.ok(
          post.analytics[i]!.capturedAt >= post.analytics[i + 1]!.capturedAt,
          "Analytics should be ordered by capturedAt desc"
        );
      }
    });
  });
});

describe("AnalyticsRepository - Edge Cases", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("handles concurrent queries correctly", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);

    const results = await Promise.all([
      repo.getByPostIds([testPostIds[0]!]),
      repo.getByChannelId(
        (await import("./AnalyticsRepository.test-helpers.js")).testChannelIds[0]!
      ),
      repo.getLatestForPosts(testPostIds),
    ]);

    assert.ok(results[0]!.length > 0, "First query should succeed");
    assert.ok(results[1]!.length > 0, "Second query should succeed");
    assert.ok(results[2]!.length > 0, "Third query should succeed");
  });

  it("handles large date ranges", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const analytics = await repo.getByProjectId(testProjectId, {
      startDate: oneYearAgo,
    });

    assert.ok(Array.isArray(analytics), "Should handle large date ranges");
  });

  it("handles empty result sets gracefully", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);

    const analytics = await repo.getByPostIds(["non-existent-post"]);
    assert.strictEqual(analytics.length, 0, "Should return empty array");

    const latest = await repo.getLatestForPosts(["non-existent-post"]);
    assert.strictEqual(latest.length, 0, "Should return empty array");

    const timeSeries = await repo.getTimeSeriesData(["non-existent-post"]);
    assert.strictEqual(timeSeries.length, 0, "Should return empty array");
  });
});
