/**
 * Unit Tests for PostsService (node:test)
 * Testing optimized queries, caching layers, performance metrics
 *
 * Pure unit test — no database, no Redis, no env-setup imports.
 * All dependencies are injected via constructor with t.mock.fn() mocks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
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

function createMocks(t: TestContext): Mocks {
  const dbOptimizer: MockDbOptimizer = {
    getDashboardPosts: t.mock.fn(async (_accountId: string, _limit: number, _offset: number) => [
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
    getDashboardPostsCount: t.mock.fn(async (_accountId: string): Promise<number> => 10),
    getTenantDashboardStats: t.mock.fn(async (_accountId: string) => ({
      totalPosts: 10,
      publishedPosts: 5,
      scheduledPosts: 3,
      failedPosts: 2,
      totalChannels: 5,
      lastActivity: new Date(),
      avgPostViews: 500,
    })),
    recordPerformanceMetric: t.mock.fn(async () => {}),
  };

  const cacheManager: MockCacheManager = {
    get: t.mock.fn(async (_key: string) => ({ ok: true as const, value: null })),
    set: t.mock.fn(async () => ({ ok: true as const, value: undefined })),
    warmCache: t.mock.fn(async () => ({ ok: true as const, value: 0 })),
  };

  const service = new PostsService(
    dbOptimizer as DatabaseOptimizer,
    cacheManager as RedisCacheManager
  );

  return { dbOptimizer, cacheManager, service };
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TEST_ACCOUNT_ID = "account-test-001";

function cacheMiss(t: TestContext, cacheManager: MockCacheManager): void {
  t.mock.method(cacheManager, "get", async () => ({ ok: true as const, value: null }));
}

function cacheHit<T>(t: TestContext, cacheManager: MockCacheManager, data: T): void {
  t.mock.method(cacheManager, "get", async () => ({ ok: true as const, value: data }));
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("PostsService", { concurrency: 1 }, () => {
  describe("getOptimizedPosts", () => {
    it("should return cached results on cache hit", async (t) => {
      const { cacheManager, service } = createMocks(t);

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

      cacheHit(t, cacheManager, cachedData);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      assert.strictEqual(result.cached, true);
      assert.strictEqual(result.cacheLevel, "multi-level");
      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].id, "cached-1");
    });

    it("should fetch from database on cache miss", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      assert.strictEqual(result.cached, false);
      assert.strictEqual(result.cacheLevel, "database");
      assert.ok(Array.isArray(result.data));
      assert.strictEqual(result.total, 10);
      assert.strictEqual(result.page, 1);
      assert.strictEqual(result.limit, 20);
    });

    it("should store results in cache after database fetch", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify cache.set was called
      const setCalls = (cacheManager.set as any).mock.calls;
      assert.ok(setCalls.length > 0, "cache.set should have been called");
      const setCall = setCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes("dashboard:posts:")
      );
      assert.ok(setCall, "cache.set should be called with a key containing 'dashboard:posts'");
      assert.ok(
        setCall.arguments[0].includes("dashboard:posts"),
        `Expected key to contain 'dashboard:posts', got '${setCall.arguments[0]}'`
      );
    });

    it("should use correct cache key format", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

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
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes("dashboard:posts:")
      );
      assert.ok(getCall, "cache.get should be called with a dashboard:posts key");
      assert.strictEqual(getCall.arguments[0], `dashboard:posts:${accountId}:${page}:${limit}`);
    });

    it("should calculate pagination correctly", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 10,
        offset: 0,
      });

      // getDashboardPostsCount returns 10, limit=10 → totalPages = ceil(10/10) = 1
      assert.strictEqual(result.totalPages, 1);
    });

    it("should transform database results to API schema", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      assert.strictEqual(result.data.length, 2, "Should have 2 posts from mock");
      const post = result.data[0];
      assert.ok("id" in post);
      assert.ok("title" in post);
      assert.ok("status" in post);
      assert.ok("createdAt" in post);
      assert.ok("tags" in post);
      assert.ok("channelCount" in post);
      assert.ok("totalViews" in post);

      // Verify transformation details
      assert.strictEqual(post.id, "post-1");
      assert.strictEqual(post.title, "Test Post 1");
      assert.strictEqual(post.status, "PUBLISHED");
      assert.strictEqual(typeof post.createdAt, "string"); // Date → ISO string
      assert.deepStrictEqual(post.tags, []);
      assert.strictEqual(post.channelCount, 3);
      assert.strictEqual(post.totalViews, 1000);
    });

    it("should record performance metrics on cache hit", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks(t);

      const cachedData = {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        cached: false,
        cacheLevel: "database" as const,
      };

      cacheHit(t, cacheManager, cachedData);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify performance metric was recorded
      const metricCalls = (dbOptimizer.recordPerformanceMetric as any).mock.calls;
      const metricCall = metricCalls.find(
        (call: any) => call.arguments[0] === "optimized_posts_response_time"
      );
      assert.ok(metricCall, "Should record optimized_posts_response_time metric");
      assert.strictEqual(metricCall.arguments[3].cached, true);
    });

    it("should record performance metrics on cache miss", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      const metricCalls = (dbOptimizer.recordPerformanceMetric as any).mock.calls;
      const metricCall = metricCalls.find(
        (call: any) => call.arguments[0] === "optimized_posts_response_time"
      );
      assert.ok(metricCall, "Should record optimized_posts_response_time metric");
      assert.strictEqual(metricCall.arguments[3].cached, false);
    });

    it("should handle multi-tenant isolation correctly", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

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
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes(accountId1)
      );
      const key2 = getCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes(accountId2)
      );

      assert.ok(key1, "Should have a cache key containing account-1");
      assert.ok(key2, "Should have a cache key containing account-2");
      assert.notStrictEqual(key1.arguments[0], key2.arguments[0]);
    });

    it("should cache total count separately", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify total count cache key was used
      const getCalls = (cacheManager.get as any).mock.calls;
      const totalCacheCall = getCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" &&
          call.arguments[0].includes("dashboard:posts:total")
      );
      assert.ok(totalCacheCall, "Should attempt to get total count from cache");
    });
  });

  describe("getDashboardStats", () => {
    it("should return cached stats on cache hit", async (t) => {
      const { cacheManager, service } = createMocks(t);

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

      cacheHit(t, cacheManager, cachedStats);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      assert.strictEqual(result.cached, true);
      assert.strictEqual(result.cacheLevel, "multi-level");
      assert.strictEqual(result.totalPosts, 15);
      assert.strictEqual(result.publishedPosts, 10);
    });

    it("should fetch from materialized view on cache miss", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      assert.strictEqual(result.cached, false);
      assert.strictEqual(result.cacheLevel, "materialized-view");
      assert.strictEqual(result.totalPosts, 10);
      assert.strictEqual(result.publishedPosts, 5);
    });

    it("should return fallback stats when materialized view has no data", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      // Mock empty materialized view
      t.mock.method(dbOptimizer, "getTenantDashboardStats", async () => null);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      assert.strictEqual(result.totalPosts, 0);
      assert.strictEqual(result.publishedPosts, 0);
      assert.strictEqual(result.scheduledPosts, 0);
      assert.strictEqual(result.failedPosts, 0);
      assert.strictEqual(result.cacheLevel, "fallback");
    });

    it("should cache fallback stats", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      t.mock.method(dbOptimizer, "getTenantDashboardStats", async () => null);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      // Verify set was called for fallback
      const setCalls = (cacheManager.set as any).mock.calls;
      const fallbackSetCall = setCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes("tenant:stats")
      );
      assert.ok(fallbackSetCall, "Should cache fallback stats");
      assert.strictEqual(fallbackSetCall.arguments[2].ttl, 300); // 5 minutes for fallback
    });

    it("should use correct cache key for stats", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const accountId = "stats-account-123";
      await service.getDashboardStats(accountId);

      const getCalls = (cacheManager.get as any).mock.calls;
      const getCall = getCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes("tenant:stats")
      );
      assert.ok(getCall, "Should attempt to get stats from cache");
      assert.strictEqual(getCall.arguments[0], `tenant:stats:${accountId}`);
    });

    it("should record performance metrics", async (t) => {
      const { dbOptimizer, cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      const metricCalls = (dbOptimizer.recordPerformanceMetric as any).mock.calls;
      const metricCall = metricCalls.find(
        (call: any) => call.arguments[0] === "dashboard_stats_response_time"
      );
      assert.ok(metricCall, "Should record dashboard_stats_response_time metric");
    });

    it("should transform lastActivity to ISO string", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      if (result.lastActivity) {
        assert.strictEqual(typeof result.lastActivity, "string");
        // Verify it's a valid ISO date string
        const parsed = new Date(result.lastActivity);
        assert.ok(!isNaN(parsed.getTime()), "lastActivity should be a valid ISO date string");
      }
    });

    it("should include all required stats fields", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      const result = await service.getDashboardStats(TEST_ACCOUNT_ID);

      assert.ok("totalPosts" in result);
      assert.ok("publishedPosts" in result);
      assert.ok("scheduledPosts" in result);
      assert.ok("failedPosts" in result);
      assert.ok("totalChannels" in result);
      assert.ok("lastActivity" in result);
      assert.ok("avgPostViews" in result);
      assert.ok("cached" in result);
      assert.ok("cacheLevel" in result);
    });

    it("should cache stats with correct TTL", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      const setCalls = (cacheManager.set as any).mock.calls;
      const statsSetCall = setCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes("tenant:stats")
      );
      assert.ok(statsSetCall, "Should cache stats");
      assert.strictEqual(statsSetCall.arguments[2].ttl, 600); // 10 minutes
    });

    it("should tag cache entries correctly", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      await service.getDashboardStats(TEST_ACCOUNT_ID);

      const setCalls = (cacheManager.set as any).mock.calls;
      const statsSetCall = setCalls.find(
        (call: any) =>
          typeof call.arguments[0] === "string" && call.arguments[0].includes("tenant:stats")
      );
      assert.ok(statsSetCall, "Should cache stats");
      const tags = statsSetCall.arguments[2].tags;
      assert.ok(tags.includes("dashboard"), "Should have 'dashboard' tag");
      assert.ok(tags.includes("stats"), "Should have 'stats' tag");
      assert.ok(
        tags.some((tag: string) => tag.includes("account:")),
        "Should have an 'account:' tag"
      );
    });
  });

  describe("warmCache", () => {
    it("should successfully warm cache", async (t) => {
      const { service } = createMocks(t);

      const result = await service.warmCache(TEST_ACCOUNT_ID);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, "Cache warming completed");
      assert.strictEqual(result.accountId, TEST_ACCOUNT_ID);
    });

    it("should call cache manager warmCache method", async (t) => {
      const { cacheManager, service } = createMocks(t);

      await service.warmCache(TEST_ACCOUNT_ID);

      const warmCacheCalls = (cacheManager.warmCache as any).mock.calls;
      assert.ok(warmCacheCalls.length > 0, "warmCache should have been called");
      assert.strictEqual(warmCacheCalls[0].arguments[0], Number(TEST_ACCOUNT_ID));
    });

    it("should handle string accountId conversion to number", async (t) => {
      const { cacheManager, service } = createMocks(t);
      const stringAccountId = "12345";

      await service.warmCache(stringAccountId);

      const warmCacheCalls = (cacheManager.warmCache as any).mock.calls;
      assert.ok(warmCacheCalls.length > 0, "warmCache should have been called");
      assert.strictEqual(warmCacheCalls[0].arguments[0], 12345);
    });
  });

  describe("BaseService integration", () => {
    it("should log operations with context", async (t) => {
      const { cacheManager, service } = createMocks(t);
      cacheMiss(t, cacheManager);

      // This should trigger logging through BaseService.execute
      const result = await service.getOptimizedPosts({
        accountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 20,
        offset: 0,
      });

      // Verify operation completed with valid PaginatedPostsResponse structure
      assert.ok(typeof result === "object" && result !== null, "Should return a result object");
      assert.ok("data" in result, "Should have data field");
      assert.ok("total" in result, "Should have total field");
      assert.ok("page" in result, "Should have page field");
    });

    it("should handle errors gracefully", async (t) => {
      const { cacheManager, service } = createMocks(t);

      t.mock.method(cacheManager, "get", async () => {
        throw new Error("Cache error");
      });

      // BaseService.execute rethrows errors
      await assert.rejects(
        async () => {
          await service.getOptimizedPosts({
            accountId: TEST_ACCOUNT_ID,
            page: 1,
            limit: 20,
            offset: 0,
          });
        },
        {
          message: "Cache error",
        }
      );
    });
  });
});
