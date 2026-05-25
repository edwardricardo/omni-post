/**
 * @file realtimeAnalytics.test.ts
 * @description Unit tests for RealtimeAnalyticsService (SSE metrics poller). Covers
 *              the pure engagement-rate computation, connection-id generation, and
 *              the 30s poll (updateAllMetrics): per-cycle delta vs the CachePort
 *              keyed-state buffer and broadcast per post. Transport (SSE) lives in
 *              the route + broadcaster, not here.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { RealtimeAnalyticsService } from "../../src/analytics/realtimeAnalytics.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import type {
  AnalyticsStreamBroadcaster,
  AnalyticsStreamEventPayload,
} from "../../src/services/AnalyticsStreamBroadcaster.js";

// Pure-computation tests never reach the analytics repo or broadcaster, so empty
// stubs suffice. The ctor registers the poll on a Noop scheduler (no real timer).
const stubAnalyticsRepository = {} as unknown as AnalyticsReadRepositoryPort;
const stubBroadcaster = {
  getWatchedPostIds: () => [],
  broadcast: async () => {},
} as unknown as AnalyticsStreamBroadcaster;

const realtimeService = new RealtimeAnalyticsService(
  new NoopBackgroundTaskScheduler(),
  new InMemoryCacheAdapter(),
  stubAnalyticsRepository,
  stubBroadcaster
);

// ========================================
// TESTS: calculateEngagementRate
// ========================================

describe("RealtimeAnalyticsService - calculateEngagementRate", () => {
  it("calculates correct rate with views > 0", () => {
    // (50 + 20 + 10) / 1000 * 100 = 8%
    expect(
      realtimeService.calculateEngagementRate({ views: 1000, likes: 50, comments: 20, shares: 10 })
    ).toBe(8);
  });

  it("returns 0 when views is 0", () => {
    expect(
      realtimeService.calculateEngagementRate({ views: 0, likes: 50, comments: 20, shares: 10 })
    ).toBe(0);
  });

  it("handles null views as 0", () => {
    expect(
      realtimeService.calculateEngagementRate({ views: null, likes: 50, comments: 20, shares: 10 })
    ).toBe(0);
  });

  it("handles null engagement metrics", () => {
    expect(
      realtimeService.calculateEngagementRate({
        views: 1000,
        likes: null,
        comments: null,
        shares: null,
      })
    ).toBe(0);
  });

  it("handles partial null engagement metrics", () => {
    // (50 + 0 + 10) / 1000 * 100 = 6%
    expect(
      realtimeService.calculateEngagementRate({
        views: 1000,
        likes: 50,
        comments: null,
        shares: 10,
      })
    ).toBe(6);
  });

  it("calculates fractional engagement rates", () => {
    // (15 + 8 + 2) / 1000 * 100 = 2.5%
    expect(
      realtimeService.calculateEngagementRate({ views: 1000, likes: 15, comments: 8, shares: 2 })
    ).toBe(2.5);
  });

  it("handles 100% engagement rate", () => {
    expect(
      realtimeService.calculateEngagementRate({ views: 100, likes: 60, comments: 30, shares: 10 })
    ).toBe(100);
  });

  it("handles over 100% engagement rate", () => {
    expect(
      realtimeService.calculateEngagementRate({ views: 100, likes: 80, comments: 50, shares: 30 })
    ).toBe(160);
  });

  it("handles very small engagement rates", () => {
    const rate = realtimeService.calculateEngagementRate({
      views: 1000000,
      likes: 10,
      comments: 5,
      shares: 1,
    });
    expect(Math.abs(rate - 0.0016) < 0.0001).toBeTruthy();
  });

  it("handles large numbers", () => {
    expect(
      realtimeService.calculateEngagementRate({
        views: 5000000,
        likes: 250000,
        comments: 100000,
        shares: 50000,
      })
    ).toBe(8);
  });

  it("handles zero engagement", () => {
    expect(
      realtimeService.calculateEngagementRate({ views: 1000, likes: 0, comments: 0, shares: 0 })
    ).toBe(0);
  });

  it("handles single view with engagement", () => {
    expect(
      realtimeService.calculateEngagementRate({ views: 1, likes: 1, comments: 0, shares: 0 })
    ).toBe(100);
  });

  it("keeps negative deltas (API decrements) rather than clamping to 0", () => {
    // (-10 + 5 + 2) / 1000 * 100 = -0.3%
    expect(
      realtimeService.calculateEngagementRate({ views: 1000, likes: -10, comments: 5, shares: 2 })
    ).toBe(-0.3);
  });

  it("computes very precise decimal engagement rates", () => {
    // (10 + 5 + 3) / 999 * 100 = 1.8018018018...
    const rate = realtimeService.calculateEngagementRate({
      views: 999,
      likes: 10,
      comments: 5,
      shares: 3,
    });
    expect(Math.abs(rate - 1.8018018018018) < 0.0000001).toBeTruthy();
  });
});

// ========================================
// TESTS: generateConnectionId
// ========================================

describe("RealtimeAnalyticsService - generateConnectionId", () => {
  it("generates ID with correct prefix", () => {
    expect(realtimeService.generateConnectionId().startsWith("conn_")).toBeTruthy();
  });

  it("generates unique IDs", () => {
    expect(realtimeService.generateConnectionId()).not.toBe(realtimeService.generateConnectionId());
  });

  it("ID contains a UUID after the prefix", () => {
    const uuid = realtimeService.generateConnectionId().replace("conn_", "");
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
    ).toBeTruthy();
  });
});

// ========================================
// TESTS: updateAllMetrics (30s poll — delta + broadcast)
// ========================================

describe("RealtimeAnalyticsService - updateAllMetrics", () => {
  const TASK_ID = "realtime-analytics-metrics-updater";

  interface CapturedBroadcast {
    event: AnalyticsStreamEventPayload;
    postId: string;
  }

  /** Build a service whose poll can be fired manually via the Noop scheduler. */
  function makeService(records: () => unknown[]): {
    scheduler: NoopBackgroundTaskScheduler;
    broadcasts: CapturedBroadcast[];
  } {
    const scheduler = new NoopBackgroundTaskScheduler();
    const broadcasts: CapturedBroadcast[] = [];
    const analyticsRepo = {
      getByPostIds: async () => records(),
    } as unknown as AnalyticsReadRepositoryPort;
    const broadcaster = {
      getWatchedPostIds: () => ["post-1"],
      broadcast: async (event: AnalyticsStreamEventPayload, postId: string) => {
        broadcasts.push({ event, postId });
      },
    } as unknown as AnalyticsStreamBroadcaster;

    new RealtimeAnalyticsService(scheduler, new InMemoryCacheAdapter(), analyticsRepo, broadcaster);
    return { scheduler, broadcasts };
  }

  it("does nothing when no posts are watched", async () => {
    const scheduler = new NoopBackgroundTaskScheduler();
    let broadcastCount = 0;
    const analyticsRepo = {
      getByPostIds: async () => {
        broadcastCount++;
        return [];
      },
    } as unknown as AnalyticsReadRepositoryPort;
    const broadcaster = {
      getWatchedPostIds: () => [],
      broadcast: async () => {},
    } as unknown as AnalyticsStreamBroadcaster;
    new RealtimeAnalyticsService(scheduler, new InMemoryCacheAdapter(), analyticsRepo, broadcaster);

    await scheduler.triggerTask(TASK_ID);

    expect(broadcastCount).toBe(0); // short-circuited before querying analytics
  });

  it("broadcasts current metrics with no delta on the first cycle", async () => {
    const { scheduler, broadcasts } = makeService(() => [
      { postId: "post-1", provider: "X", views: 100, likes: 10, comments: 0, shares: 0 },
    ]);

    await scheduler.triggerTask(TASK_ID);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.postId).toBe("post-1");
    expect(broadcasts[0]?.event.metrics.views).toBe(100);
    expect(broadcasts[0]?.event.deltaMetrics).toBeUndefined();
    expect(typeof broadcasts[0]?.event.timestamp).toBe("string");
  });

  it("computes per-cycle deltas against the previous cycle", async () => {
    let likes = 10;
    const { scheduler, broadcasts } = makeService(() => [
      { postId: "post-1", provider: "X", views: 100, likes, comments: 0, shares: 0 },
    ]);

    await scheduler.triggerTask(TASK_ID); // cycle 1 — baseline
    likes = 15;
    await scheduler.triggerTask(TASK_ID); // cycle 2 — +5 likes

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[1]?.event.deltaMetrics?.likes).toBe(5);
    expect(broadcasts[1]?.event.deltaMetrics?.views).toBe(0);
  });
});
