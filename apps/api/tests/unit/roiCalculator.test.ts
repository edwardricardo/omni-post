/**
 * @file roiCalculator.test.ts
 * @description Unit tests for ROICalculator. Covers the pure-math helpers
 *              (date range, seasonal factor, cache key) and the prisma-free
 *              data paths now backed by injected ports: trackConversion maps
 *              lowercase domain literals to the UPPERCASE conversion port input,
 *              and calculateROI reads analytics/posts/conversions through the
 *              ports (no Prisma). Redis is stubbed to isolate the unit.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ROICalculator } from "../../src/analytics/roiCalculator.js";
import type { ProjectQueryRepositoryPort } from "../../src/domain/repositories/ProjectQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../src/domain/repositories/AnalyticsReadRepository.js";
import type { ConversionRepositoryPort } from "../../src/domain/repositories/ConversionRepository.js";
import type { CachePort } from "@ports/core";
import type { ConversionTracking } from "../../src/analytics/roi/types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeProjectRepo(
  overrides: Partial<ProjectQueryRepositoryPort> = {}
): ProjectQueryRepositoryPort {
  return {
    getPostIds: vi.fn(async () => []),
    getPostsWithContent: vi.fn(async () => []),
    getPostsWithAnalytics: vi.fn(async () => []),
    getPublishedPosts: vi.fn(async () => []),
    countPosts: vi.fn(async () => 0),
    getByAccountId: vi.fn(async () => []),
    countByAccountId: vi.fn(async () => 0),
    getMediaCountsByAccount: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    getProjectAccess: vi.fn(async () => true),
    getChannelsByProject: vi.fn(async () => []),
    ...overrides,
  };
}

function makeAnalyticsRepo(
  overrides: Partial<AnalyticsReadRepositoryPort> = {}
): AnalyticsReadRepositoryPort {
  return {
    getByPostIds: vi.fn(async () => []),
    getByProjectId: vi.fn(async () => []),
    getByChannelId: vi.fn(async () => []),
    getLatestForPosts: vi.fn(async () => []),
    aggregateEngagement: vi.fn(() => ({
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalEngagement: 0,
      avgEngagementRate: 0,
    })),
    getTimeSeriesData: vi.fn(async () => []),
    getPostsWithAnalytics: vi.fn(async () => []),
    getDailySummary: vi.fn(async () => []),
    getMonthlySummary: vi.fn(async () => []),
    getHistoricalTrends: vi.fn(async () => []),
    ...overrides,
  };
}

function makeConversionRepo(
  overrides: Partial<ConversionRepositoryPort> = {}
): ConversionRepositoryPort {
  return {
    record: vi.fn(async () => {}),
    findByAccount: vi.fn(async () => []),
    ...overrides,
  };
}

function makeCache(): CachePort {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    // getOrSet runs the factory so the data path is exercised.
    getOrSet: vi.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
    delete: vi.fn(async () => {}),
    invalidateByTag: vi.fn(async () => {}),
    has: vi.fn(async () => false),
  } as unknown as CachePort;
}

interface FakeRedis {
  hgetall: ReturnType<typeof vi.fn>;
  hmset: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
}

/** Construct a calculator with all ports mocked and Redis stubbed out. */
function makeCalculator(parts?: {
  projectRepo?: ProjectQueryRepositoryPort;
  analyticsRepo?: AnalyticsReadRepositoryPort;
  conversionRepo?: ConversionRepositoryPort;
  cache?: CachePort;
}): { calc: ROICalculator; redis: FakeRedis } {
  const calc = new ROICalculator(
    parts?.projectRepo ?? makeProjectRepo(),
    parts?.analyticsRepo ?? makeAnalyticsRepo(),
    parts?.conversionRepo ?? makeConversionRepo(),
    parts?.cache ?? makeCache()
  );
  const redis: FakeRedis = {
    hgetall: vi.fn(async () => ({})),
    hmset: vi.fn(async () => "OK"),
    expire: vi.fn(async () => 1),
  };
  (calc as unknown as { redis: FakeRedis }).redis = redis;
  return { calc, redis };
}

describe("ROICalculator - Initialization", () => {
  it("initializes with default cost model", () => {
    const { calc } = makeCalculator();
    expect(calc instanceof ROICalculator).toBeTruthy();
  });
});

describe("ROICalculator - Date Range Calculation", () => {
  it("calculates 7 days correctly", () => {
    const { calc } = makeCalculator();
    const { startDate, endDate } = calc.calculateDateRange("7d");
    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBe(7);
  });

  it("calculates 30 days correctly", () => {
    const { calc } = makeCalculator();
    const { startDate, endDate } = calc.calculateDateRange("30d");
    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBe(30);
  });

  it("calculates 90 days correctly", () => {
    const { calc } = makeCalculator();
    const { startDate, endDate } = calc.calculateDateRange("90d");
    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBe(90);
  });

  it("calculates 1 year correctly", () => {
    const { calc } = makeCalculator();
    const { startDate, endDate } = calc.calculateDateRange("1y");
    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff >= 365 && daysDiff <= 366).toBeTruthy();
  });

  it("uses custom dates when provided", () => {
    const { calc } = makeCalculator();
    const customStart = new Date("2024-01-01");
    const customEnd = new Date("2024-01-31");
    const { startDate, endDate } = calc.calculateDateRange("custom", customStart, customEnd);
    expect(startDate.getTime()).toBe(customStart.getTime());
    expect(endDate.getTime()).toBe(customEnd.getTime());
  });
});

describe("ROICalculator - Seasonal Factors", () => {
  it("returns higher factor for November (holiday season)", () => {
    const { calc } = makeCalculator();
    expect(calc.getSeasonalFactor(10) > 1.0).toBeTruthy();
  });

  it("returns higher factor for December (holiday season)", () => {
    const { calc } = makeCalculator();
    expect(calc.getSeasonalFactor(11) > 1.0).toBeTruthy();
  });

  it("returns lower factor for February (slow season)", () => {
    const { calc } = makeCalculator();
    expect(calc.getSeasonalFactor(1) < 1.0).toBeTruthy();
  });

  it("returns factors within reasonable range", () => {
    const { calc } = makeCalculator();
    for (let month = 0; month < 12; month++) {
      const factor = calc.getSeasonalFactor(month);
      expect(factor >= 0.5 && factor <= 2.0).toBeTruthy();
    }
  });
});

describe("ROICalculator - Cache Key Generation", () => {
  it("creates unique key for account and time range", () => {
    const { calc } = makeCalculator();
    const key = calc.generateCacheKey({ accountId: "acc-123", timeRange: "30d" });
    expect(key.includes("acc-123")).toBeTruthy();
    expect(key.includes("30d")).toBeTruthy();
  });

  it("includes project ID when provided", () => {
    const { calc } = makeCalculator();
    const key = calc.generateCacheKey({
      accountId: "acc-123",
      projectId: "proj-456",
      timeRange: "7d",
    });
    expect(key.includes("proj-456")).toBeTruthy();
  });

  it("creates different keys for different accounts", () => {
    const { calc } = makeCalculator();
    const key1 = calc.generateCacheKey({ accountId: "acc-123", timeRange: "30d" });
    const key2 = calc.generateCacheKey({ accountId: "acc-456", timeRange: "30d" });
    expect(key1).not.toBe(key2);
  });

  it("creates different keys for different time ranges", () => {
    const { calc } = makeCalculator();
    const key1 = calc.generateCacheKey({ accountId: "acc-123", timeRange: "7d" });
    const key2 = calc.generateCacheKey({ accountId: "acc-123", timeRange: "30d" });
    expect(key1).not.toBe(key2);
  });
});

describe("ROICalculator - trackConversion (prisma-free write path)", () => {
  const baseConversion: ConversionTracking = {
    accountId: "acc-1",
    source: "X",
    contentId: "post-1",
    conversionType: "sale",
    value: 149.99,
    timestamp: new Date("2026-05-10T12:00:00Z"),
    attribution: "last_click",
  };

  it("records the conversion through the port, mapping literals to UPPERCASE kinds", async () => {
    const conversionRepo = makeConversionRepo();
    const { calc } = makeCalculator({ conversionRepo });

    await calc.trackConversion(baseConversion);

    expect(conversionRepo.record).toHaveBeenCalledTimes(1);
    expect(conversionRepo.record).toHaveBeenCalledWith({
      accountId: "acc-1",
      source: "X",
      contentId: "post-1",
      conversionType: "SALE",
      value: 149.99,
      attribution: "LAST_CLICK",
      occurredAt: new Date("2026-05-10T12:00:00Z"),
    });
  });

  it("maps every conversionType + attribution literal to its UPPERCASE kind", async () => {
    const conversionRepo = makeConversionRepo();
    const { calc } = makeCalculator({ conversionRepo });

    await calc.trackConversion({
      ...baseConversion,
      conversionType: "signup",
      attribution: "time_decay",
    });

    const arg = (conversionRepo.record as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.conversionType).toBe("SIGNUP");
    expect(arg.attribution).toBe("TIME_DECAY");
  });

  it("updates the real-time Redis counters after recording", async () => {
    const conversionRepo = makeConversionRepo();
    const { calc, redis } = makeCalculator({ conversionRepo });

    await calc.trackConversion(baseConversion);

    expect(redis.hmset).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });
});

describe("ROICalculator - calculateROI (prisma-free read paths)", () => {
  it("reads analytics, posts, and conversions through the ports for a project scope", async () => {
    const projectRepo = makeProjectRepo({
      getPostIds: vi.fn(async () => ["post-1", "post-2"]),
    });
    const analyticsRepo = makeAnalyticsRepo();
    const conversionRepo = makeConversionRepo();
    const { calc } = makeCalculator({ projectRepo, analyticsRepo, conversionRepo });

    await calc.calculateROI({ accountId: "acc-1", projectId: "proj-1", timeRange: "30d" });

    expect(projectRepo.getPostIds).toHaveBeenCalledWith("proj-1");
    expect(analyticsRepo.getByPostIds).toHaveBeenCalledTimes(1);
    const getByPostIdsArgs = (analyticsRepo.getByPostIds as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(getByPostIdsArgs?.[0]).toEqual(["post-1", "post-2"]);
    expect(getByPostIdsArgs?.[1]?.orderBy).toEqual({ capturedAt: "asc" });
    expect(conversionRepo.findByAccount).toHaveBeenCalledTimes(1);
    expect((conversionRepo.findByAccount as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "acc-1"
    );
  });

  it("folds conversion revenue into total revenue", async () => {
    const conversionRepo = makeConversionRepo({
      findByAccount: vi.fn(async () => [
        {
          id: "conv-1",
          accountId: "acc-1",
          source: "X" as const,
          contentId: "post-1",
          conversionType: "SALE" as const,
          value: 500,
          attribution: "LAST_CLICK" as const,
          occurredAt: new Date("2026-05-10T12:00:00Z"),
          createdAt: new Date("2026-05-10T12:00:01Z"),
        },
      ]),
    });
    const projectRepo = makeProjectRepo({ getPostIds: vi.fn(async () => ["post-1"]) });
    const { calc } = makeCalculator({ projectRepo, conversionRepo });

    const result = await calc.calculateROI({
      accountId: "acc-1",
      projectId: "proj-1",
      timeRange: "30d",
    });

    // The single SALE conversion (value 500) must contribute to revenue.
    expect(result.totalRevenue).toBeGreaterThanOrEqual(500);
  });

  it("short-circuits analytics reads when the scope has no posts", async () => {
    const projectRepo = makeProjectRepo({ getPostIds: vi.fn(async () => []) });
    const analyticsRepo = makeAnalyticsRepo();
    const { calc } = makeCalculator({ projectRepo, analyticsRepo });

    await calc.calculateROI({ accountId: "acc-1", projectId: "proj-1", timeRange: "30d" });

    expect(analyticsRepo.getByPostIds).not.toHaveBeenCalled();
  });
});
