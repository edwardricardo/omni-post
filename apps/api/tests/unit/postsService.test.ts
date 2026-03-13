/**
 * Unit Tests for PostsService (node:test)
 * Testing optimized queries, caching layers, performance metrics
 *
 * Pure unit test — no database, no Redis, no env-setup imports.
 * All dependencies are injected via constructor with vi.fn() mocks.
 */

import { describe, it, vi, expect } from "vitest";
import { PostsService } from "../../src/posts/postsService.js";
import type { DatabaseOptimizer } from "../../src/database/DatabaseOptimizer.js";
import type { RedisCacheManager } from "@adapters/cache-redis";

// ─── Types ───────────────────────────────────────────────────────────

type MockDbOptimizer = Pick<
  DatabaseOptimizer,
  | "getDashboardPosts"
  | "getDashboardPostsCount"
  | "getTenantDashboardStats"
  | "recordPerformanceMetric"
>;

type MockCacheManager = Pick<RedisCacheManager, "get" | "set" | "warmCache">;

interface Mocks {
  dbOptimizer: MockDbOptimizer;
  cacheManager: MockCacheManager;
  service: PostsService;
}

// ─── Factory ─────────────────────────────────────────────────────────

function createMocks(): Mocks {
  const dbOptimizer: MockDbOptimizer = {
    getDashboardPosts: vi.fn(async (_accountId: string, _limit: number, _offset: number) => [
      {
        id: "post-1",
        title: "Test Post 1",
        status: "PUBLISHED",
        scheduledAt: new Date(),
        createdAt: new Date(),
        channelCount: 3,
        totalViews: 1000,
      },
      {
        id: "post-2",
        title: "Test Post 2",
        status: "DRAFT",
        scheduledAt: null,
        createdAt: new Date(),
        channelCount: 1,
        totalViews: 0,
      },
    ]),
    getDashboardPostsCount: vi.fn(async (_accountId: string): Promise<number> => 10),
    getTenantDashboardStats: vi.fn(async (_accountId: string) => ({
      totalPosts: 10,
      publishedPosts: 5,
      scheduledPosts: 3,
      failedPosts: 2,
      totalChannels: 5,
      lastActivity: new Date(),
      avgPostViews: 500,
    })),
    recordPerformanceMetric: vi.fn(async () => {}),
  };

  const cacheManager: MockCacheManager = {
    get: vi.fn(async (_key: string) => ({ ok: true as const, value: null })),
    set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    warmCache: vi.fn(async () => ({ ok: true as const, value: 0 })),
  };

  const service = new PostsService(
    dbOptimizer as DatabaseOptimizer,
    cacheManager as RedisCacheManager
  );

  return { dbOptimizer, cacheManager, service };
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TEST_ACCOUNT_ID = "account-test-001";

function cacheMiss(cacheManager: MockCacheManager): void {
  vi.spyOn(cacheManager, "get").mockImplementation(async () => ({
    ok: true as const,
    value: null,
  }));
}

function cacheHit<T>(cacheManager: MockCacheManager, data: T): void {
  vi.spyOn(cacheManager, "get").mockImplementation(async () => ({
    ok: true as const,
    value: data,
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("PostsService", () => {
  describe("getOptimizedPosts", () => {
    it("should return cached results on cache hit", async (t) => {
      const { cacheManager, service } = createMocks();

      const cachedData = {
        data: [
          {
            id: "cached-1",
            title: "Cached Post",
            body: null,
            status: "PUBLISHED" as const,
            createdAt: new Date().toISOString(),
            scheduledAt: null,
            tags: [],
            channelCount: 2,
            totalViews: 500,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        cached: false,
        cacheLevel: "database" as const,
      };

      cacheHit(cacheManager, cachedData);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      expect(result.cached).toBe(true);
      expect(result.cacheLevel).toBe("multi-level");
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe("cached-1");
    });

    it("should fetch from database on cache miss", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      expect(result.cached).toBe(false);
      expect(result.cacheLevel).toBe("database");
      expect(Array.isArray(result.data)).toBeTruthy();
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("should store results in cache after database fetch", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify cache.set was called
      const setCalls = (cacheManager.set as any).mock.calls;
      expect(setCalls.length > 0).toBeTruthy();
      const setCall = setCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("dashboard:posts:")
      );
      expect(setCall).toBeTruthy();
      expect(setCall[0].includes("dashboard:posts")).toBeTruthy();
    });

    it("should use correct cache key format", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const accountId = "test-account-123";
      const page = 2;
      const limit = 50;

      await service.getOptimizedPosts({
        accountId,
        page,
        limit,
        offset: 50,
      });

      const getCalls = (cacheManager.get as any).mock.calls;
      const getCall = getCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("dashboard:posts:")
      );
      expect(getCall).toBeTruthy();
      expect(getCall[0]).toBe(`dashboard:posts:${accountId}:${page}:${limit}`);
    });

    it("should calculate pagination correctly", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 10,
        offset: 0,
      });

      // getDashboardPostsCount returns 10, limit=10 → totalPages = ceil(10/10) = 1
      expect(result.totalPages).toBe(1);
    });

    it("should transform database results to API schema", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      expect(result.data.length).toBe(2);
      const post = result.data[0];
      expect("id" in post).toBeTruthy();
      expect("title" in post).toBeTruthy();
      expect("status" in post).toBeTruthy();
      expect("createdAt" in post).toBeTruthy();
      expect("tags" in post).toBeTruthy();
      expect("channelCount" in post).toBeTruthy();
      expect("totalViews" in post).toBeTruthy();

      // Verify transformation details
      expect(post.id).toBe("post-1");
      expect(post.title).toBe("Test Post 1");
      expect(post.status).toBe("PUBLISHED");
      expect(typeof post.createdAt).toBe("string"); // Date → ISO string
      expect(post.tags).toStrictEqual([]);
      expect(post.channelCount).toBe(3);
      expect(post.totalViews).toBe(1000);
    });

    it("should record performance metrics on cache hit", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks();

      const cachedData = {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        cached: false,
        cacheLevel: "database" as const,
      };

      cacheHit(cacheManager, cachedData);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify performance metric was recorded
      const metricCalls = (dbOptimizer.recordPerformanceMetric as any).mock.calls;
      const metricCall = metricCalls.find(
        (call: any) => call[0] === "optimized_posts_response_time"
      );
      expect(metricCall).toBeTruthy();
      expect(metricCall[3].cached).toBe(true);
    });

    it("should record performance metrics on cache miss", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      const metricCalls = (dbOptimizer.recordPerformanceMetric as any).mock.calls;
      const metricCall = metricCalls.find(
        (call: any) => call[0] === "optimized_posts_response_time"
      );
      expect(metricCall).toBeTruthy();
      expect(metricCall[3].cached).toBe(false);
    });

    it("should handle multi-tenant isolation correctly", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const accountId1 = "account-1";
      const accountId2 = "account-2";

      await service.getOptimizedPosts({
        accountId: accountId1,
        page: 1,
        limit: 20,
        offset: 0,
      });

      await service.getOptimizedPosts({
        accountId: accountId2,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify different cache keys were used
      const getCalls = (cacheManager.get as any).mock.calls;
      const key1 = getCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes(accountId1)
      );
      const key2 = getCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes(accountId2)
      );

      expect(key1).toBeTruthy();
      expect(key2).toBeTruthy();
      expect(key1[0]).not.toBe(key2[0]);
    });

    it("should cache total count separately", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify total count cache key was used
      const getCalls = (cacheManager.get as any).mock.calls;
      const totalCacheCall = getCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("dashboard:posts:total")
      );
      expect(totalCacheCall).toBeTruthy();
    });
  });

  describe("getDashboardStats", () => {
    it("should return cached stats on cache hit", async (t) => {
      const { cacheManager, service } = createMocks();

      const cachedStats = {
        totalPosts: 15,
        publishedPosts: 10,
        scheduledPosts: 3,
        failedPosts: 2,
        totalChannels: 5,
        lastActivity: new Date().toISOString(),
        avgPostViews: 750,
        cached: false,
        cacheLevel: "materialized-view" as const,
      };

      cacheHit(cacheManager, cachedStats);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      expect(result.cached).toBe(true);
      expect(result.cacheLevel).toBe("multi-level");
      expect(result.totalPosts).toBe(15);
      expect(result.publishedPosts).toBe(10);
    });

    it("should fetch from materialized view on cache miss", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      expect(result.cached).toBe(false);
      expect(result.cacheLevel).toBe("materialized-view");
      expect(result.totalPosts).toBe(10);
      expect(result.publishedPosts).toBe(5);
    });

    it("should return fallback stats when materialized view has no data", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      // Mock empty materialized view
      vi.spyOn(dbOptimizer, "getTenantDashboardStats").mockImplementation(async () => null);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      expect(result.totalPosts).toBe(0);
      expect(result.publishedPosts).toBe(0);
      expect(result.scheduledPosts).toBe(0);
      expect(result.failedPosts).toBe(0);
      expect(result.cacheLevel).toBe("fallback");
    });

    it("should cache fallback stats", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      vi.spyOn(dbOptimizer, "getTenantDashboardStats").mockImplementation(async () => null);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      // Verify set was called for fallback
      const setCalls = (cacheManager.set as any).mock.calls;
      const fallbackSetCall = setCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("tenant:stats")
      );
      expect(fallbackSetCall).toBeTruthy();
      expect(fallbackSetCall[2].ttl).toBe(300); // 5 minutes for fallback
    });

    it("should use correct cache key for stats", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const accountId = "stats-account-123";
      await service.getDashboardStats(accountId);

      const getCalls = (cacheManager.get as any).mock.calls;
      const getCall = getCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("tenant:stats")
      );
      expect(getCall).toBeTruthy();
      expect(getCall[0]).toBe(`tenant:stats:${accountId}`);
    });

    it("should record performance metrics", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      const metricCalls = (dbOptimizer.recordPerformanceMetric as any).mock.calls;
      const metricCall = metricCalls.find(
        (call: any) => call[0] === "dashboard_stats_response_time"
      );
      expect(metricCall).toBeTruthy();
    });

    it("should transform lastActivity to ISO string", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      if (result.lastActivity) {
        expect(typeof result.lastActivity).toBe("string");
        // Verify it's a valid ISO date string
        const parsed = new Date(result.lastActivity);
        expect(isNaN(parsed.getTime())).toBeFalsy();
      }
    });

    it("should include all required stats fields", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      expect("totalPosts" in result).toBeTruthy();
      expect("publishedPosts" in result).toBeTruthy();
      expect("scheduledPosts" in result).toBeTruthy();
      expect("failedPosts" in result).toBeTruthy();
      expect("totalChannels" in result).toBeTruthy();
      expect("lastActivity" in result).toBeTruthy();
      expect("avgPostViews" in result).toBeTruthy();
      expect("cached" in result).toBeTruthy();
      expect("cacheLevel" in result).toBeTruthy();
    });

    it("should cache stats with correct TTL", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      const setCalls = (cacheManager.set as any).mock.calls;
      const statsSetCall = setCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("tenant:stats")
      );
      expect(statsSetCall).toBeTruthy();
      expect(statsSetCall[2].ttl).toBe(600); // 10 minutes
    });

    it("should tag cache entries correctly", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      const setCalls = (cacheManager.set as any).mock.calls;
      const statsSetCall = setCalls.find(
        (call: any) => typeof call[0] === "string" && call[0].includes("tenant:stats")
      );
      expect(statsSetCall).toBeTruthy();
      const tags = statsSetCall[2].tags;
      expect(tags.includes("dashboard")).toBeTruthy();
      expect(tags.includes("stats")).toBeTruthy();
      expect(tags.some((tag: string) => tag.includes("account:"))).toBeTruthy();
    });
  });

  describe("warmCache", () => {
    it("should successfully warm cache", async (t) => {
      const { service } = createMocks();

      const result = await service.warmCache(TEST_ACCOUNT_ID);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Cache warming completed");
      expect(result.accountId).toBe(TEST_ACCOUNT_ID);
    });

    it("should call cache manager warmCache method", async (t) => {
      const { cacheManager, service } = createMocks();

      await service.warmCache(TEST_ACCOUNT_ID);

      const warmCacheCalls = (cacheManager.warmCache as any).mock.calls;
      expect(warmCacheCalls.length > 0).toBeTruthy();
      expect(warmCacheCalls[0][0]).toBe(Number(TEST_ACCOUNT_ID));
    });

    it("should handle string accountId conversion to number", async (t) => {
      const { cacheManager, service } = createMocks();
      const stringAccountId = "12345";

      await service.warmCache(stringAccountId);

      const warmCacheCalls = (cacheManager.warmCache as any).mock.calls;
      expect(warmCacheCalls.length > 0).toBeTruthy();
      expect(warmCacheCalls[0][0]).toBe(12345);
    });
  });

  describe("BaseService integration", () => {
    it("should log operations with context", async (t) => {
      const { cacheManager, service } = createMocks();
      cacheMiss(cacheManager);

      // This should trigger logging through BaseService.execute
      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify operation completed with valid PaginatedPostsResponse structure
      expect(typeof result === "object" && result !== null).toBeTruthy();
      expect("data" in result).toBeTruthy();
      expect("total" in result).toBeTruthy();
      expect("page" in result).toBeTruthy();
    });

    it("should handle errors gracefully", async (t) => {
      const { cacheManager, service } = createMocks();

      vi.spyOn(cacheManager, "get").mockImplementation(async () => {
        throw new Error("Cache error");
      });

      // BaseService.execute rethrows errors
      await expect(
        service.getOptimizedPosts({
          accountId: TEST_ACCOUNT_ID,
          page: 1,
          limit: 20,
          offset: 0,
        })
      ).rejects.toThrow("Cache error");
    });
  });
});
