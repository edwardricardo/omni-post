#!/usr/bin/env tsx
/**
 * Unit Tests for cacheStatsRoutes
 * Testing cache statistics and monitoring endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import type { RedisCacheManager } from "@adapters/cache-redis";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockCacheManager = Pick<
  RedisCacheManager,
  "getStats" | "healthCheck" | "flush" | "invalidateByTag" | "invalidateByPattern" | "warmCache"
>;

// Mock cache manager factory
function createMockCacheManager(
  t: TestContext,
  config: {
    healthy?: boolean;
    statsSuccess?: boolean;
    flushSuccess?: boolean;
    invalidateSuccess?: boolean;
    warmSuccess?: boolean;
  } = {}
): MockCacheManager {
  const {
    healthy = true,
    statsSuccess = true,
    flushSuccess = true,
    invalidateSuccess = true,
    warmSuccess = true,
  } = config;

  return {
    getStats: t.mock.fn(async () => ({
      ok: statsSuccess,
      value: statsSuccess
        ? {
            hits: 1000,
            misses: 200,
            hitRate: 0.833,
            totalKeys: 500,
            memoryUsage: 5242880, // 5MB
            l1Hits: 800,
            l2Hits: 200,
            l1Size: 300,
            avgTtl: 3600,
            hotKeys: [
              { key: "user:123", hits: 150 },
              { key: "post:456", hits: 120 },
              { key: "project:789", hits: 100 },
              { key: "channel:abc", hits: 90 },
              { key: "analytics:xyz", hits: 80 },
            ],
          }
        : undefined,
    })),
    healthCheck: t.mock.fn(async () => ({
      ok: healthy,
      value: healthy
        ? {
            status: "healthy",
            latency: 15,
          }
        : undefined,
    })),
    flush: t.mock.fn(async () => ({
      ok: flushSuccess,
      value: flushSuccess ? undefined : undefined,
    })),
    invalidateByTag: t.mock.fn(async (tag: string) => ({
      ok: invalidateSuccess,
      value: invalidateSuccess ? (tag === "users" ? 10 : 5) : 0,
    })),
    invalidateByPattern: t.mock.fn(async (pattern: string) => ({
      ok: invalidateSuccess,
      value: invalidateSuccess ? (pattern === "user:*" ? 15 : 8) : 0,
    })),
    warmCache: t.mock.fn(async () => ({
      ok: warmSuccess,
      value: warmSuccess ? 25 : 0,
    })),
  };
}

describe("cacheStatsRoutes - Unit Tests", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let mockCacheManager: MockCacheManager;

  beforeEach(async (t) => {
    mockCacheManager = createMockCacheManager(t);

    app = Fastify({ logger: false });

    // Attach cache manager to server
    app.decorate("cache", mockCacheManager as RedisCacheManager);

    const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
    await app.register(cacheStatsRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /cache/stats", () => {
    it("should return comprehensive cache statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.stats);
      assert.ok(body.timestamp);
    });

    it("should include hit/miss metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.stats.hits);
      assert.ok(body.stats.misses);
      assert.ok(body.stats.hitRate);
      assert.ok(body.stats.hitRatePercentage);
    });

    it("should include cache size metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.stats.totalKeys);
      assert.ok(body.stats.memoryUsage);
      assert.ok(body.stats.memoryUsageMB);
    });

    it("should include L1/L2 cache breakdown", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.stats.l1Hits === "number");
      assert.ok(typeof body.stats.l2Hits === "number");
      assert.ok(typeof body.stats.l1Size === "number");
    });

    it("should include hot keys (top 10)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.stats.hotKeys));
      assert.ok(body.stats.hotKeys.length <= 10);
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "GET",
        url: "/cache/stats",
      });

      assert.strictEqual(response.statusCode, 503);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
      assert.ok(body.error);

      await appWithoutCache.close();
    });

    it("should handle cache manager errors gracefully", async (t) => {
      const appWithFailingCache = Fastify({ logger: false });
      const failingCache = createMockCacheManager(t, { statsSuccess: false });
      appWithFailingCache.decorate("cache", failingCache as RedisCacheManager);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithFailingCache.register(cacheStatsRoutes);

      const response = await appWithFailingCache.inject({
        method: "GET",
        url: "/cache/stats",
      });

      assert.strictEqual(response.statusCode, 500);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);

      await appWithFailingCache.close();
    });
  });

  describe("GET /cache/health", () => {
    it("should return cache health status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/health",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.health);
      assert.ok(body.timestamp);
    });

    it("should include health status and latency", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/health",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.health.status);
      assert.ok(typeof body.health.latency === "number");
      assert.ok(body.health.latencyMs);
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "GET",
        url: "/cache/health",
      });

      assert.strictEqual(response.statusCode, 503);
      await appWithoutCache.close();
    });

    it("should handle health check failures", async (t) => {
      const appWithUnhealthyCache = Fastify({ logger: false });
      const unhealthyCache = createMockCacheManager(t, { healthy: false });
      appWithUnhealthyCache.decorate("cache", unhealthyCache as RedisCacheManager);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithUnhealthyCache.register(cacheStatsRoutes);

      const response = await appWithUnhealthyCache.inject({
        method: "GET",
        url: "/cache/health",
      });

      assert.strictEqual(response.statusCode, 500);
      await appWithUnhealthyCache.close();
    });
  });

  describe("POST /cache/flush", () => {
    it("should flush cache successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/flush",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.message);
      assert.ok(body.timestamp);
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "POST",
        url: "/cache/flush",
      });

      assert.strictEqual(response.statusCode, 503);
      await appWithoutCache.close();
    });

    it("should handle flush failures", async (t) => {
      const appWithFailingFlush = Fastify({ logger: false });
      const failingCache = createMockCacheManager(t, { flushSuccess: false });
      appWithFailingFlush.decorate("cache", failingCache);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithFailingFlush.register(cacheStatsRoutes);

      const response = await appWithFailingFlush.inject({
        method: "POST",
        url: "/cache/flush",
      });

      assert.strictEqual(response.statusCode, 500);
      await appWithFailingFlush.close();
    });
  });

  describe("POST /cache/invalidate", () => {
    it("should invalidate cache by tags", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          tags: ["users", "posts"],
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(typeof body.invalidated === "number");
      assert.ok(Array.isArray(body.tags));
      assert.ok(body.timestamp);
    });

    it("should invalidate cache by patterns", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          patterns: ["user:*", "post:*"],
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(typeof body.invalidated === "number");
      assert.ok(Array.isArray(body.patterns));
    });

    it("should invalidate cache by both tags and patterns", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          tags: ["users"],
          patterns: ["post:*"],
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.invalidated > 0);
    });

    it("should return 400 when no tags or patterns provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
      assert.ok(body.error);
    });

    it("should handle empty tags array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          tags: [],
          patterns: ["test:*"],
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          tags: ["test"],
        },
      });

      assert.strictEqual(response.statusCode, 503);
      await appWithoutCache.close();
    });
  });

  describe("GET /cache/hot-keys", () => {
    it("should return top hot keys", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/hot-keys",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.hotKeys));
      assert.ok(typeof body.count === "number");
      assert.ok(body.timestamp);
    });

    it("should limit hot keys to 50 entries", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/hot-keys",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.hotKeys.length <= 50);
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "GET",
        url: "/cache/hot-keys",
      });

      assert.strictEqual(response.statusCode, 503);
      await appWithoutCache.close();
    });
  });

  describe("POST /cache/warm", () => {
    it("should warm cache successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/warm",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(typeof body.warmedCount === "number");
      assert.ok(body.timestamp);
    });

    it("should return warmed keys count", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/warm",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.warmedCount >= 0);
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "POST",
        url: "/cache/warm",
      });

      assert.strictEqual(response.statusCode, 503);
      await appWithoutCache.close();
    });

    it("should handle warming failures", async (t) => {
      const appWithFailingWarm = Fastify({ logger: false });
      const failingCache = createMockCacheManager(t, { warmSuccess: false });
      appWithFailingWarm.decorate("cache", failingCache as RedisCacheManager);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithFailingWarm.register(cacheStatsRoutes);

      const response = await appWithFailingWarm.inject({
        method: "POST",
        url: "/cache/warm",
      });

      assert.strictEqual(response.statusCode, 500);
      await appWithFailingWarm.close();
    });
  });
});
