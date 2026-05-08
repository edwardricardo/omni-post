/**
 * @file AnalyticsRepository.channel.test.ts
 * @description Tests for AnalyticsRepository - getLatestForPosts
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

describe("AnalyticsRepository - getLatestForPosts", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns latest analytics record for each post", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts(testPostIds);

    expect(Array.isArray(latest)).toBeTruthy();
    expect(latest.length).toBe(5);

    const postIdCounts = new Map<string, number>();
    latest.forEach((record) => {
      if (record.postId) {
        postIdCounts.set(record.postId, (postIdCounts.get(record.postId) || 0) + 1);
      }
    });

    postIdCounts.forEach((count, _postId) => {
      expect(count).toBe(1);
    });
  });

  it("returns most recent analytics by capturedAt", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([testPostIds[0]!]);

    expect(latest.length).toBe(1);

    const allAnalytics = await prisma.analytics.findMany({
      where: { postId: testPostIds[0] },
      orderBy: { capturedAt: "desc" },
    });

    expect(latest[0]!.id).toBe(allAnalytics[0]!.id);
  });

  it("returns empty array for empty post IDs", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const latest = await repo.getLatestForPosts([]);

    expect(latest.length).toBe(0);
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

    expect(latest.length).toBe(0);

    await prisma.postContent.deleteMany({ where: { postId: postWithoutAnalytics.id } });
    await prisma.post.delete({ where: { id: postWithoutAnalytics.id } });
  });
});

describe("AnalyticsRepository - aggregateEngagement", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("calculates engagement metrics correctly", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    expect(typeof metrics.totalViews === "number").toBeTruthy();
    expect(typeof metrics.totalLikes === "number").toBeTruthy();
    expect(typeof metrics.totalComments === "number").toBeTruthy();
    expect(typeof metrics.totalShares === "number").toBeTruthy();
    expect(typeof metrics.totalEngagement === "number").toBeTruthy();
    expect(typeof metrics.avgEngagementRate === "number").toBeTruthy();
  });

  it("calculates total engagement as sum of likes, comments, and shares", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    const expectedTotal = metrics.totalLikes + metrics.totalComments + metrics.totalShares;
    expect(metrics.totalEngagement).toBe(expectedTotal);
  });

  it("calculates engagement rate as percentage", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!]);

    const metrics = repo.aggregateEngagement(analytics);

    if (metrics.totalViews > 0) {
      const expectedRate = (metrics.totalEngagement / metrics.totalViews) * 100;
      expect(metrics.avgEngagementRate).toBe(expectedRate);
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

    expect(metrics.avgEngagementRate).toBe(0);
  });

  it("handles empty analytics array", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const metrics = repo.aggregateEngagement([]);

    expect(metrics.totalViews).toBe(0);
    expect(metrics.totalLikes).toBe(0);
    expect(metrics.totalComments).toBe(0);
    expect(metrics.totalShares).toBe(0);
    expect(metrics.totalEngagement).toBe(0);
    expect(metrics.avgEngagementRate).toBe(0);
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

    expect(metrics.totalViews).toBe(0);
    expect(metrics.totalLikes).toBe(0);
  });
});
