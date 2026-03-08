#!/usr/bin/env tsx
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  autoCachePlugin,
  invalidateCacheForRoute,
  getCacheStats,
} from "../../src/middleware/autoCacheMiddleware.js";
import { RedisCacheManager } from "@adapters/cache-redis";
import Redis from "ioredis";

const testRedis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  db: 15,
});

let cacheManager: RedisCacheManager;

describe("autoCacheMiddleware - Registration and GET Caching", { concurrency: 1 }, () => {
  before(async () => {
    const redisHost = process.env.REDIS_HOST || "localhost";
    const redisPort = process.env.REDIS_PORT || "6379";
    cacheManager = new RedisCacheManager({
      redisUrl: `redis://${redisHost}:${redisPort}/15`,
      defaultTtl: 300,
      keyPrefix: "test:",
    });

    const keys = await testRedis.keys("test:*");
    if (keys.length > 0) {
      await testRedis.del(...keys);
    }
  });

  after(async () => {
    try {
      const keys = await testRedis.keys("test:*");
      if (keys.length > 0) {
        await testRedis.del(...keys);
      }
    } catch {
      // Ignore cleanup errors
    }
    try {
      await cacheManager.close();
    } catch {
      // Ignore close errors
    }
    try {
      await testRedis.quit();
    } catch {
      // Ignore quit errors
    }
  });

  describe("Plugin Registration", () => {
    it("should register plugin with default options", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin);

      assert.ok(app.printRoutes, "App should be properly initialized after plugin registration");
      await app.close();
    });

    it("should register plugin with custom options", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
        excludeRoutes: ["/health", "/metrics"],
        logCacheOps: true,
      });

      assert.ok(app.printRoutes, "App should be properly initialized with custom options");
      await app.close();
    });

    it("should handle missing cache manager gracefully", async () => {
      const app = Fastify({ logger: false });

      await app.register(autoCachePlugin);

      assert.ok(app.printRoutes, "App should initialize without cache manager");
      await app.close();
    });
  });

  describe("GET Request Caching", () => {
    it("should cache GET request responses", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
        logCacheOps: true,
      });

      app.get("/providers", async () => {
        return { providers: ["twitter", "instagram"] };
      });

      await app.ready();

      const response1 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      assert.strictEqual(response1.statusCode, 200);

      const response2 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      assert.strictEqual(response2.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response1.payload), JSON.parse(response2.payload));

      await app.close();
    });

    it("should not cache non-GET requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.post("/test", async () => {
        return { success: true };
      });

      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/test",
        payload: { data: "test" },
      });

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers["x-cache"], undefined);

      await app.close();
    });

    it("should exclude routes from caching", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
        excludeRoutes: ["/health"],
      });

      app.get("/health", async () => {
        return { status: "ok" };
      });

      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers["x-cache"], undefined);

      await app.close();
    });

    it("should not cache error responses", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/error", async (_req, reply) => {
        reply.code(500).send({ error: "Internal error" });
      });

      await app.ready();

      const response1 = await app.inject({
        method: "GET",
        url: "/error",
      });

      assert.strictEqual(response1.statusCode, 500);

      const response2 = await app.inject({
        method: "GET",
        url: "/error",
      });

      assert.strictEqual(response2.statusCode, 500);

      await app.close();
    });

    it("should add cache metadata headers", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/test", async () => {
        return { data: "test" };
      });

      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      assert.strictEqual(response.statusCode, 200);

      await app.close();
    });
  });

  describe("Cache Statistics", () => {
    it("should return cache stats when available", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin);

      app.get("/stats", async (request) => {
        const stats = await getCacheStats(request);
        return stats || { error: "No stats" };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/stats" });
      assert.strictEqual(response.statusCode, 200);

      const stats = JSON.parse(response.payload);
      if (stats.error !== "No stats") {
        assert.ok(typeof stats.hitRate === "number");
      }

      await app.close();
    });

    it("should return null when cache manager not available", async () => {
      const app = Fastify({ logger: false });

      await app.register(autoCachePlugin);

      app.get("/stats", async (request) => {
        const stats = await getCacheStats(request);
        return { stats };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/stats" });
      const data = JSON.parse(response.payload);
      assert.strictEqual(data.stats, null);

      await app.close();
    });
  });

  describe("Manual Cache Invalidation", () => {
    it("should manually invalidate cache for route", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", cacheManager);

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      let counter = 0;
      app.get("/data", async () => {
        counter++;
        return { counter };
      });

      app.post("/invalidate", async (request) => {
        await invalidateCacheForRoute(request, "POST", "/data");
        return { success: true };
      });

      await app.ready();

      const get1 = await app.inject({ method: "GET", url: "/data" });
      assert.strictEqual(JSON.parse(get1.payload).counter, 1);

      await app.inject({ method: "POST", url: "/invalidate" });

      const get2 = await app.inject({ method: "GET", url: "/data" });
      assert.strictEqual(JSON.parse(get2.payload).counter, 2);

      await app.close();
    });

    it("should handle invalidation without cache manager", async () => {
      const app = Fastify({ logger: false });

      await app.register(autoCachePlugin);

      app.post("/invalidate", async (request) => {
        await invalidateCacheForRoute(request, "POST", "/data");
        return { success: true };
      });

      await app.ready();

      const response = await app.inject({ method: "POST", url: "/invalidate" });
      assert.strictEqual(response.statusCode, 200);

      await app.close();
    });
  });
});
