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

describe("AnalyticsRepository - getLatestForPosts", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns latest analytics record for each post", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts(testPostIds);

    assert.ok(Array.isArray(latest), "Should return an array");
    assert.strictEqual(latest.length, 5, "Should return one record per post");

    const postIdCounts = new Map<string, number>();
    latest.forEach((record) => {
      if (record.postId) {
        postIdCounts.set(record.postId, (postIdCounts.get(record.postId) || 0) + 1);
      }
    });

    postIdCounts.forEach((count, postId) => {
      assert.strictEqual(count, 1, `Post ${postId} should have exactly one latest record`);
    });
  });

  it("returns most recent analytics by capturedAt", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([testPostIds[0]!]);

    assert.strictEqual(latest.length, 1, "Should return one record");

    const allAnalytics = await prisma.analytics.findMany({
      where: { postId: testPostIds[0] },
      orderBy: { capturedAt: "desc" },
    });

    assert.strictEqual(
      latest[0]!.id,
      allAnalytics[0]!.id,
      "Should return the most recent analytics record"
    );
  });

  it("returns empty array for empty post IDs", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([]);

    assert.strictEqual(latest.length, 0, "Should return empty array");
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

    assert.strictEqual(latest.length, 0, "Should return empty array for posts without analytics");

    await prisma.postContent.deleteMany({ where: { postId: postWithoutAnalytics.id } });
    await prisma.post.delete({ where: { id: postWithoutAnalytics.id } });
  });
});

describe("AnalyticsRepository - aggregateEngagement", { concurrency: 1 }, () => {
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

    assert.ok(typeof metrics.totalViews === "number", "Should calculate total views");
    assert.ok(typeof metrics.totalLikes === "number", "Should calculate total likes");
    assert.ok(typeof metrics.totalComments === "number", "Should calculate total comments");
    assert.ok(typeof metrics.totalShares === "number", "Should calculate total shares");
    assert.ok(typeof metrics.totalEngagement === "number", "Should calculate total engagement");
    assert.ok(
      typeof metrics.avgEngagementRate === "number",
      "Should calculate avg engagement rate"
    );
  });

  it("calculates total engagement as sum of likes, comments, and shares", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    const expectedTotal = metrics.totalLikes + metrics.totalComments + metrics.totalShares;
    assert.strictEqual(
      metrics.totalEngagement,
      expectedTotal,
      "Total engagement should equal sum of interactions"
    );
  });

  it("calculates engagement rate as percentage", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    if (metrics.totalViews > 0) {
      const expectedRate = (metrics.totalEngagement / metrics.totalViews) * 100;
      assert.strictEqual(
        metrics.avgEngagementRate,
        expectedRate,
        "Engagement rate should be correct percentage"
      );
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

    assert.strictEqual(
      metrics.avgEngagementRate,
      0,
      "Engagement rate should be 0 when views are 0"
    );
  });

  it("handles empty analytics array", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const metrics = repo.aggregateEngagement([]);

    assert.strictEqual(metrics.totalViews, 0, "Total views should be 0");
    assert.strictEqual(metrics.totalLikes, 0, "Total likes should be 0");
    assert.strictEqual(metrics.totalComments, 0, "Total comments should be 0");
    assert.strictEqual(metrics.totalShares, 0, "Total shares should be 0");
    assert.strictEqual(metrics.totalEngagement, 0, "Total engagement should be 0");
    assert.strictEqual(metrics.avgEngagementRate, 0, "Engagement rate should be 0");
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

    assert.strictEqual(metrics.totalViews, 0, "Should treat null as 0");
    assert.strictEqual(metrics.totalLikes, 0, "Should treat null as 0");
  });
});
