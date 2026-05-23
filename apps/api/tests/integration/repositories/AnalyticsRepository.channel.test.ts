/**
 * @file AnalyticsRepository.channel.test.ts
 * @description Tests for AnalyticsRepository - getLatestForPosts
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

describe("AnalyticsRepository - getLatestForPosts", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns latest analytics record for each post", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts(testPostIds);

    assert.ok(Array.isArray(latest));
    assert.equal(latest.length, 5);

    const postIdCounts = new Map<string, number>();
    latest.forEach((record) => {
      if (record.postId) {
        postIdCounts.set(record.postId, (postIdCounts.get(record.postId) || 0) + 1);
      }
    });

    postIdCounts.forEach((count, _postId) => {
      assert.equal(count, 1);
    });
  });

  it("returns most recent analytics by capturedAt", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([testPostIds[0]!]);

    assert.equal(latest.length, 1);

    const allAnalytics = await prisma.analytics.findMany({
      where: { postId: testPostIds[0] },
      orderBy: { capturedAt: "desc" },
    });

    assert.equal(latest[0]!.id, allAnalytics[0]!.id);
  });

  it("returns empty array for empty post IDs", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([]);

    assert.equal(latest.length, 0);
  });

  it("handles posts with no analytics", async () => {
    const postWithoutAnalytics = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: "DRAFT",
        contents: {
          create: { locale: "en", body: "No analytics", revision: 1 },
        },
      },
    });

    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([postWithoutAnalytics.id]);

    assert.equal(latest.length, 0);

    await prisma.postContent.deleteMany({ where: { postId: postWithoutAnalytics.id } });
    await prisma.post.delete({ where: { id: postWithoutAnalytics.id } });
  });
});

describe("AnalyticsRepository - aggregateEngagement", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("calculates engagement metrics correctly", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    assert.ok(typeof metrics.totalViews === "number");
    assert.ok(typeof metrics.totalLikes === "number");
    assert.ok(typeof metrics.totalComments === "number");
    assert.ok(typeof metrics.totalShares === "number");
    assert.ok(typeof metrics.totalEngagement === "number");
    assert.ok(typeof metrics.avgEngagementRate === "number");
  });

  it("calculates total engagement as sum of likes, comments, and shares", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    const expectedTotal = metrics.totalLikes + metrics.totalComments + metrics.totalShares;
    assert.equal(metrics.totalEngagement, expectedTotal);
  });

  it("calculates engagement rate as percentage", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    if (metrics.totalViews > 0) {
      const expectedRate = (metrics.totalEngagement / metrics.totalViews) * 100;
      assert.equal(metrics.avgEngagementRate, expectedRate);
    }
  });

  it("returns zero engagement rate when views are zero", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const zeroAnalytics = [
      {
        id: "test",
        postId: "test",
        channelId: "test",
        provider: "X" as const,
        views: 0,
        likes: 10,
        comments: 5,
        shares: 2,
        capturedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        platformId: null,
        impressions: null,
        reach: null,
        engagement: null,
        clicks: null,
        saves: null,
      },
    ];

    const metrics = repo.aggregateEngagement(zeroAnalytics);

    assert.equal(metrics.avgEngagementRate, 0);
  });

  it("handles empty analytics array", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const metrics = repo.aggregateEngagement([]);

    assert.equal(metrics.totalViews, 0);
    assert.equal(metrics.totalLikes, 0);
    assert.equal(metrics.totalComments, 0);
    assert.equal(metrics.totalShares, 0);
    assert.equal(metrics.totalEngagement, 0);
    assert.equal(metrics.avgEngagementRate, 0);
  });

  it("handles null/undefined values in analytics", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analyticsWithNulls = [
      {
        id: "test",
        postId: "test",
        channelId: "test",
        provider: "X" as const,
        views: null,
        likes: null,
        comments: null,
        shares: null,
        capturedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        platformId: null,
        impressions: null,
        reach: null,
        engagement: null,
        clicks: null,
        saves: null,
      },
    ];

    const metrics = repo.aggregateEngagement(analyticsWithNulls);

    assert.equal(metrics.totalViews, 0);
    assert.equal(metrics.totalLikes, 0);
  });
});
