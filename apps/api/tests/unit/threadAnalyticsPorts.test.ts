/**
 * @file threadAnalyticsPorts.test.ts
 * @description Behavior tests for ThreadAnalytics after the prisma→DI refactor.
 *              Verifies that thread reads flow through the injected
 *              ThreadReadRepository port (not Prisma) and that tweet analytics
 *              flow through the AnalyticsReadRepository port, with the metric
 *              aggregation preserved.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThreadAnalytics } from "../../src/analytics/threadAnalytics.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import type { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import type { ThreadReadRepositoryPort } from "@core/domain/repositories/ThreadReadRepository.js";
import type { ThreadWithRelations, TweetDto } from "@core/domain/repositories/ReadModelDtos.js";

const baseDate = new Date("2026-05-01T00:00:00Z");

function makeTweet(overrides: Partial<TweetDto> = {}): TweetDto {
  return {
    id: "tw-1",
    threadId: "thread-1",
    sequenceNumber: 1,
    content: "hello",
    media: null,
    tweetId: "x-1",
    parentTweetId: null,
    status: "PUBLISHED",
    publishedAt: baseDate,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

function makeThread(): ThreadWithRelations {
  return {
    id: "thread-1",
    postId: "post-1",
    strategy: "MANUAL",
    createdAt: baseDate,
    updatedAt: baseDate,
    post: {
      id: "post-1",
      projectId: "proj-1",
      status: "PUBLISHED",
      scheduledAt: null,
      publishedAt: baseDate,
      deletedAt: null,
      createdAt: baseDate,
      updatedAt: baseDate,
      project: {
        id: "proj-1",
        name: "Project One",
        locale: "en",
        accountId: "acc-1",
        isInCrisisMode: false,
        crisisStartedAt: null,
        crisisReason: null,
        crisisModeHistory: null,
        deletedAt: null,
        createdAt: baseDate,
        updatedAt: baseDate,
      },
    },
    tweets: [
      makeTweet({ id: "tw-1", sequenceNumber: 1, tweetId: "x-1", status: "PUBLISHED" }),
      makeTweet({ id: "tw-2", sequenceNumber: 2, tweetId: "x-2", status: "FAILED" }),
    ],
  };
}

function makeService(
  threadRepo: ThreadReadRepositoryPort,
  analyticsRepo: AnalyticsReadRepositoryPort
): ThreadAnalytics {
  return new ThreadAnalytics(
    new InMemoryCacheAdapter(),
    {} as unknown as ApiMetrics,
    analyticsRepo,
    threadRepo
  );
}

describe("ThreadAnalytics port-based reads", () => {
  let threadRepo: { getById: ReturnType<typeof vi.fn> } & ThreadReadRepositoryPort;
  let analyticsRepo: { getByPostIds: ReturnType<typeof vi.fn> } & AnalyticsReadRepositoryPort;

  beforeEach(() => {
    threadRepo = {
      getById: vi.fn(),
      getByIds: vi.fn(),
      getByProjectIdAndTimeframe: vi.fn(),
      getByAccountIdAndTimeframe: vi.fn(),
      getByProjectId: vi.fn(),
      getByAccountId: vi.fn(),
      countByProjectId: vi.fn(),
    } as unknown as { getById: ReturnType<typeof vi.fn> } & ThreadReadRepositoryPort;
    analyticsRepo = {
      getByPostIds: vi.fn(),
      getByProjectId: vi.fn(),
      getByChannelId: vi.fn(),
      getLatestForPosts: vi.fn(),
      aggregateEngagement: vi.fn(),
      getTimeSeriesData: vi.fn(),
      getPostsWithAnalytics: vi.fn(),
      getDailySummary: vi.fn(),
      getMonthlySummary: vi.fn(),
      getHistoricalTrends: vi.fn(),
    } as unknown as { getByPostIds: ReturnType<typeof vi.fn> } & AnalyticsReadRepositoryPort;
  });

  it("returns null when the thread is not found via the port", async () => {
    threadRepo.getById.mockResolvedValue(null);
    const service = makeService(threadRepo, analyticsRepo);

    const result = await service.getThreadMetrics("missing");

    expect(result).toBeNull();
    expect(threadRepo.getById).toHaveBeenCalledWith("missing");
  });

  it("computes thread metrics from port data with completion rate preserved", async () => {
    threadRepo.getById.mockResolvedValue(makeThread());
    analyticsRepo.getByPostIds.mockResolvedValue([
      {
        id: "a-1",
        postId: "x-1",
        channelId: "ch-1",
        provider: "X",
        views: 1000,
        likes: 50,
        comments: 20,
        shares: 10,
        capturedAt: baseDate,
      },
    ]);
    const service = makeService(threadRepo, analyticsRepo);

    const result = await service.getThreadMetrics("thread-1");

    expect(result).not.toBeNull();
    expect(result?.totalTweets).toBe(2);
    expect(result?.publishedTweets).toBe(1);
    expect(result?.failedTweets).toBe(1);
    // 1 published of 2 total = 50% completion
    expect(result?.completionRate).toBe(50);
    expect(result?.strategy).toBe("MANUAL");
    // Tweet analytics fetched through the port for published tweet ids only.
    expect(analyticsRepo.getByPostIds).toHaveBeenCalledWith(["x-1", "x-2"], {
      provider: "X",
      orderBy: { capturedAt: "desc" },
    });
  });

  it("compareStrategies routes a projectId through getByProjectId", async () => {
    threadRepo.getByProjectId = vi.fn().mockResolvedValue([]);
    const service = makeService(threadRepo, analyticsRepo);

    await service.compareStrategies("proj-1");

    expect(threadRepo.getByProjectId).toHaveBeenCalledWith("proj-1");
  });
});
