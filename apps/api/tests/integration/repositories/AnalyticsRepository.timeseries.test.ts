/**
 * @file AnalyticsRepository.timeseries.test.ts
 * @description Tests for AnalyticsRepository - getTimeSeriesData
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PrismaAnalyticsReadRepository } from "../../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js";
import { prisma } from "@infra/prisma";
import {
  setupTestData,
  teardownTestData,
  testPostIds,
  testProjectId,
} from "./AnalyticsRepository.test-helpers.js";

describe("AnalyticsRepository - getTimeSeriesData", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("groups analytics by day", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day");

    expect(Array.isArray(timeSeries)).toBeTruthy();
    expect(timeSeries.length > 0).toBeTruthy();

    timeSeries.forEach((period) => {
      expect(period.period).toBeTruthy();
      expect(typeof period.totalViews === "number").toBeTruthy();
      expect(typeof period.recordCount === "number").toBeTruthy();
    });
  });

  it("groups analytics by hour", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "hour");

    expect(Array.isArray(timeSeries)).toBeTruthy();

    timeSeries.forEach((period) => {
      expect(period.period.length >= 13).toBeTruthy();
    });
  });

  it("groups analytics by week", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "week");

    expect(Array.isArray(timeSeries)).toBeTruthy();
  });

  it("includes aggregated metrics per period", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day");

    timeSeries.forEach((period) => {
      expect(typeof period.totalViews === "number").toBeTruthy();
      expect(typeof period.totalLikes === "number").toBeTruthy();
      expect(typeof period.totalComments === "number").toBeTruthy();
      expect(typeof period.totalShares === "number").toBeTruthy();
      expect(typeof period.totalEngagement === "number").toBeTruthy();
      expect(typeof period.avgEngagementRate === "number").toBeTruthy();
    });
  });

  it("respects date range filters", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const timeSeries = await repo.getTimeSeriesData(testPostIds, "day", {
      startDate: twoDaysAgo,
    });

    expect(timeSeries.length > 0).toBeTruthy();
  });
});

describe("AnalyticsRepository - getPostsWithAnalytics", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns posts with analytics in single query", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    expect(Array.isArray(posts)).toBeTruthy();
    expect(posts.length).toBe(5);

    posts.forEach((post) => {
      expect(Array.isArray(post.analytics)).toBeTruthy();
      expect(Array.isArray(post.contents)).toBeTruthy();
      expect(Array.isArray(post.media)).toBeTruthy();
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
        expect(analytics.capturedAt >= twoDaysAgo).toBeTruthy();
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
        expect(analytics.provider).toBe("X");
      });
    });
  });

  it("respects post pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId, { take: 2 });

    expect(posts.length).toBe(2);
  });

  it("orders posts by createdAt desc", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    for (let i = 0; i < posts.length - 1; i++) {
      expect(posts[i]!.createdAt >= posts[i + 1]!.createdAt).toBeTruthy();
    }
  });

  it("orders analytics by capturedAt desc within each post", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const posts = await repo.getPostsWithAnalytics(testProjectId);

    posts.forEach((post) => {
      for (let i = 0; i < post.analytics.length - 1; i++) {
        expect(post.analytics[i]!.capturedAt >= post.analytics[i + 1]!.capturedAt).toBeTruthy();
      }
    });
  });
});

describe("AnalyticsRepository - Edge Cases", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
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

    expect(results[0]!.length > 0).toBeTruthy();
    expect(results[1]!.length > 0).toBeTruthy();
    expect(results[2]!.length > 0).toBeTruthy();
  });

  it("handles large date ranges", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const analytics = await repo.getByProjectId(testProjectId, {
      startDate: oneYearAgo,
    });

    expect(Array.isArray(analytics)).toBeTruthy();
  });

  it("handles empty result sets gracefully", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);

    const analytics = await repo.getByPostIds(["non-existent-post"]);
    expect(analytics.length).toBe(0);

    const latest = await repo.getLatestForPosts(["non-existent-post"]);
    expect(latest.length).toBe(0);

    const timeSeries = await repo.getTimeSeriesData(["non-existent-post"]);
    expect(timeSeries.length).toBe(0);
  });
});
