/**
 * @file AnalyticsRepository.timeseries.test.ts
 * @description Tests for AnalyticsRepository - getTimeSeriesData
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaAnalyticsReadRepository } from "../../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js";
import { prisma } from "@infra/prisma";
import {
  setupTestData,
  teardownTestData,
  testPostIds,
  testProjectId,
} from "./AnalyticsRepository.test-helpers.js";

describe("AnalyticsRepository - getTimeSeriesData", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("groups analytics by day", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day");

    assert.ok(Array.isArray(timeSeries));
    assert.ok(timeSeries.length > 0);

    timeSeries.forEach((period) => {
      assert.ok(period.period);
      assert.ok(typeof period.totalViews === "number");
      assert.ok(typeof period.recordCount === "number");
    });
  });

  it("groups analytics by hour", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "hour");

    assert.ok(Array.isArray(timeSeries));

    timeSeries.forEach((period) => {
      assert.ok(period.period.length >= 13);
    });
  });

  it("groups analytics by week", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "week");

    assert.ok(Array.isArray(timeSeries));
  });

  it("includes aggregated metrics per period", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day");

    timeSeries.forEach((period) => {
      assert.ok(typeof period.totalViews === "number");
      assert.ok(typeof period.totalLikes === "number");
      assert.ok(typeof period.totalComments === "number");
      assert.ok(typeof period.totalShares === "number");
      assert.ok(typeof period.totalEngagement === "number");
      assert.ok(typeof period.avgEngagementRate === "number");
    });
  });

  it("respects date range filters", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day", {
      startDate: twoDaysAgo,
    });

    assert.ok(timeSeries.length > 0);
  });
});

describe("AnalyticsRepository - getPostsWithAnalytics", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns posts with analytics in single query", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    assert.ok(Array.isArray(posts));
    assert.equal(posts.length, 5);

    posts.forEach((post) => {
      assert.ok(Array.isArray(post.analytics));
      assert.ok(Array.isArray(post.contents));
      assert.ok(Array.isArray(post.media));
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
        assert.ok(analytics.capturedAt >= twoDaysAgo);
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
        assert.equal(analytics.provider, "X");
      });
    });
  });

  it("respects post pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId, { take: 2 });

    assert.equal(posts.length, 2);
  });

  it("orders posts by createdAt desc", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    for (let i = 0; i < posts.length - 1; i++) {
      assert.ok(posts[i]!.createdAt >= posts[i + 1]!.createdAt);
    }
  });

  it("orders analytics by capturedAt desc within each post", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    posts.forEach((post) => {
      for (let i = 0; i < post.analytics.length - 1; i++) {
        assert.ok(post.analytics[i]!.capturedAt >= post.analytics[i + 1]!.capturedAt);
      }
    });
  });
});

describe("AnalyticsRepository - Edge Cases", () => {
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

    assert.ok(results[0]!.length > 0);
    assert.ok(results[1]!.length > 0);
    assert.ok(results[2]!.length > 0);
  });

  it("handles large date ranges", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const analytics = await repo.getByProjectId(testProjectId, {
      startDate: oneYearAgo,
    });

    assert.ok(Array.isArray(analytics));
  });

  it("handles empty result sets gracefully", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);

    const analytics = await repo.getByPostIds(["non-existent-post"]);
    assert.equal(analytics.length, 0);

    const latest = await repo.getLatestForPosts(["non-existent-post"]);
    assert.equal(latest.length, 0);

    const timeSeries = await repo.getTimeSeriesData(["non-existent-post"]);
    assert.equal(timeSeries.length, 0);
  });
});
