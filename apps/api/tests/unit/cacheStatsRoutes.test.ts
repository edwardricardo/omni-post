#!/usr/bin/env tsx
/**
 * Unit Tests for cacheStatsRoutes
 * Testing cache statistics and monitoring endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import type { RedisCacheManager } from "@adapters/cache-redis";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockCacheManager = Pick<
  RedisCacheManager,
  "getStats" | "healthCheck" | "flush" | "invalidateByTag" | "invalidateByPattern" | "warmCache"
>;

// Mock cache manager factory
function createMockCacheManager(
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
    getStats: vi.fn(async () => ({
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
    healthCheck: vi.fn(async () => ({
      ok: healthy,
      value: healthy
        ? {
            status: "healthy",
            latency: 15,
          }
        : undefined,
    })),
    flush: vi.fn(async () => ({
      ok: flushSuccess,
      value: flushSuccess ? undefined : undefined,
    })),
    invalidateByTag: vi.fn(async (tag: string) => ({
      ok: invalidateSuccess,
      value: invalidateSuccess ? (tag === "users" ? 10 : 5) : 0,
    })),
    invalidateByPattern: vi.fn(async (pattern: string) => ({
      ok: invalidateSuccess,
      value: invalidateSuccess ? (pattern === "user:*" ? 15 : 8) : 0,
    })),
    warmCache: vi.fn(async () => ({
      ok: warmSuccess,
      value: warmSuccess ? 25 : 0,
    })),
  };
}

describe("cacheStatsRoutes - Unit Tests", () => {
  let app: FastifyInstance;
  let mockCacheManager: MockCacheManager;

  beforeEach(async (t) => {
    mockCacheManager = createMockCacheManager();

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

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.stats).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include hit/miss metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      expect(body.stats.hits).toBeTruthy();
      expect(body.stats.misses).toBeTruthy();
      expect(body.stats.hitRate).toBeTruthy();
      expect(body.stats.hitRatePercentage).toBeTruthy();
    });

    it("should include cache size metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      expect(body.stats.totalKeys).toBeTruthy();
      expect(body.stats.memoryUsage).toBeTruthy();
      expect(body.stats.memoryUsageMB).toBeTruthy();
    });

    it("should include L1/L2 cache breakdown", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.stats.l1Hits === "number").toBeTruthy();
      expect(typeof body.stats.l2Hits === "number").toBeTruthy();
      expect(typeof body.stats.l1Size === "number").toBeTruthy();
    });

    it("should include hot keys (top 10)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
      });

      const body = JSON.parse(response.body);
      expect(Array.isArray(body.stats.hotKeys)).toBeTruthy();
      expect(body.stats.hotKeys.length <= 10).toBeTruthy();
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "GET",
        url: "/cache/stats",
      });

      expect(response.statusCode).toBe(503);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBeTruthy();

      await appWithoutCache.close();
    });

    it("should handle cache manager errors gracefully", async (t) => {
      const appWithFailingCache = Fastify({ logger: false });
      const failingCache = createMockCacheManager({ statsSuccess: false });
      appWithFailingCache.decorate("cache", failingCache as RedisCacheManager);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithFailingCache.register(cacheStatsRoutes);

      const response = await appWithFailingCache.inject({
        method: "GET",
        url: "/cache/stats",
      });

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);

      await appWithFailingCache.close();
    });
  });

  describe("GET /cache/health", () => {
    it("should return cache health status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/health",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.health).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include health status and latency", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/health",
      });

      const body = JSON.parse(response.body);
      expect(body.health.status).toBeTruthy();
      expect(typeof body.health.latency === "number").toBeTruthy();
      expect(body.health.latencyMs).toBeTruthy();
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "GET",
        url: "/cache/health",
      });

      expect(response.statusCode).toBe(503);
      await appWithoutCache.close();
    });

    it("should handle health check failures", async (t) => {
      const appWithUnhealthyCache = Fastify({ logger: false });
      const unhealthyCache = createMockCacheManager({ healthy: false });
      appWithUnhealthyCache.decorate("cache", unhealthyCache as RedisCacheManager);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithUnhealthyCache.register(cacheStatsRoutes);

      const response = await appWithUnhealthyCache.inject({
        method: "GET",
        url: "/cache/health",
      });

      expect(response.statusCode).toBe(500);
      await appWithUnhealthyCache.close();
    });
  });

  describe("POST /cache/flush", () => {
    it("should flush cache successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/flush",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.message).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "POST",
        url: "/cache/flush",
      });

      expect(response.statusCode).toBe(503);
      await appWithoutCache.close();
    });

    it("should handle flush failures", async (t) => {
      const appWithFailingFlush = Fastify({ logger: false });
      const failingCache = createMockCacheManager({ flushSuccess: false });
      appWithFailingFlush.decorate("cache", failingCache);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithFailingFlush.register(cacheStatsRoutes);

      const response = await appWithFailingFlush.inject({
        method: "POST",
        url: "/cache/flush",
      });

      expect(response.statusCode).toBe(500);
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

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(typeof body.invalidated === "number").toBeTruthy();
      expect(Array.isArray(body.tags)).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should invalidate cache by patterns", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          patterns: ["user:*", "post:*"],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(typeof body.invalidated === "number").toBeTruthy();
      expect(Array.isArray(body.patterns)).toBeTruthy();
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

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.invalidated > 0).toBeTruthy();
    });

    it("should return 400 when no tags or patterns provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBeTruthy();
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

      expect(response.statusCode).toBe(200);
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

      expect(response.statusCode).toBe(503);
      await appWithoutCache.close();
    });
  });

  describe("GET /cache/hot-keys", () => {
    it("should return top hot keys", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/hot-keys",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.hotKeys)).toBeTruthy();
      expect(typeof body.count === "number").toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should limit hot keys to 50 entries", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/hot-keys",
      });

      const body = JSON.parse(response.body);
      expect(body.hotKeys.length <= 50).toBeTruthy();
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "GET",
        url: "/cache/hot-keys",
      });

      expect(response.statusCode).toBe(503);
      await appWithoutCache.close();
    });
  });

  describe("POST /cache/warm", () => {
    it("should warm cache successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/warm",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(typeof body.warmedCount === "number").toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should return warmed keys count", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/warm",
      });

      const body = JSON.parse(response.body);
      expect(body.warmedCount >= 0).toBeTruthy();
    });

    it("should return 503 when cache manager unavailable", async () => {
      const appWithoutCache = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithoutCache.register(cacheStatsRoutes);

      const response = await appWithoutCache.inject({
        method: "POST",
        url: "/cache/warm",
      });

      expect(response.statusCode).toBe(503);
      await appWithoutCache.close();
    });

    it("should handle warming failures", async (t) => {
      const appWithFailingWarm = Fastify({ logger: false });
      const failingCache = createMockCacheManager({ warmSuccess: false });
      appWithFailingWarm.decorate("cache", failingCache as RedisCacheManager);

      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await appWithFailingWarm.register(cacheStatsRoutes);

      const response = await appWithFailingWarm.inject({
        method: "POST",
        url: "/cache/warm",
      });

      expect(response.statusCode).toBe(500);
      await appWithFailingWarm.close();
    });
  });
});
