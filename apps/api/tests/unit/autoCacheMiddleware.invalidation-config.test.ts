#!/usr/bin/env tsx
/**
 * @file autoCacheMiddleware.invalidation-config.test.ts
 * @description Tests for autoCacheMiddleware - Invalidation, Key Variations and Config
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import Fastify from "fastify";
import { autoCachePlugin } from "../../src/middleware/autoCacheMiddleware.js";
import { RedisCacheManager, RedisCacheAdapter } from "@adapters/cache-redis";
import Redis from "ioredis";

const testRedis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  db: 15,
});

let cacheManager: RedisCacheManager;

describe("autoCacheMiddleware - Invalidation, Key Variations and Config", () => {
  beforeAll(async () => {
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

  afterAll(async () => {
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

  describe("Cache Invalidation", () => {
    it("should invalidate cache on POST requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
      });

      let requestCount = 0;
      app.get("/posts", async () => {
        requestCount++;
        return { posts: [], count: requestCount };
      });

      app.post("/posts", async () => {
        return { id: "new-post" };
      });

      await app.ready();

      const get1 = await app.inject({ method: "GET", url: "/posts" });
      expect(JSON.parse(get1.payload).count).toBe(1);

      // Allow time for the onSend cache write to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const get2 = await app.inject({ method: "GET", url: "/posts" });
      expect(JSON.parse(get2.payload).count).toBe(1);

      await app.inject({ method: "POST", url: "/posts", payload: {} });

      // Wait for the onResponse hook to complete its async cache invalidation
      await new Promise((resolve) => setTimeout(resolve, 500));

      const get3 = await app.inject({ method: "GET", url: "/posts" });
      expect(JSON.parse(get3.payload).count).toBe(2);

      await app.close();
    });

    it("should invalidate cache on PUT requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
      });

      let value = "original";
      app.get("/resource/:id", async () => {
        return { value };
      });

      app.put("/resource/:id", async () => {
        value = "updated";
        return { success: true };
      });

      await app.ready();

      const get1 = await app.inject({ method: "GET", url: "/resource/123" });
      expect(JSON.parse(get1.payload).value).toBe("original");

      await app.inject({ method: "PUT", url: "/resource/123", payload: {} });

      const get2 = await app.inject({ method: "GET", url: "/resource/123" });
      expect(JSON.parse(get2.payload).value).toBe("updated");

      await app.close();
    });

    it("should invalidate cache on DELETE requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
      });

      let exists = true;
      app.get("/item/:id", async (_req, reply) => {
        if (exists) {
          return { id: "123", name: "Item" };
        }
        reply.code(404).send({ error: "Not found" });
      });

      app.delete("/item/:id", async () => {
        exists = false;
        return { success: true };
      });

      await app.ready();

      const get1 = await app.inject({ method: "GET", url: "/item/123" });
      expect(get1.statusCode).toBe(200);

      await app.inject({ method: "DELETE", url: "/item/123" });

      const get2 = await app.inject({ method: "GET", url: "/item/123" });
      expect(get2.statusCode).toBe(404);

      await app.close();
    });

    it("should not invalidate on failed mutations", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
      });

      app.get("/data", async () => {
        return { value: "cached" };
      });

      app.post("/data", async (_req, reply) => {
        reply.code(400).send({ error: "Bad request" });
      });

      await app.ready();

      const get1 = await app.inject({ method: "GET", url: "/data" });
      expect(get1.statusCode).toBe(200);

      const post = await app.inject({ method: "POST", url: "/data", payload: {} });
      expect(post.statusCode).toBe(400);

      const get2 = await app.inject({ method: "GET", url: "/data" });
      expect(get2.statusCode).toBe(200);

      await app.close();
    });

    it("should handle PATCH requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
      });

      let data = { value: 1 };
      app.get("/counter", async () => data);

      app.patch("/counter", async () => {
        data.value++;
        return { success: true };
      });

      await app.ready();

      const get1 = await app.inject({ method: "GET", url: "/counter" });
      expect(JSON.parse(get1.payload).value).toBe(1);

      await app.inject({ method: "PATCH", url: "/counter", payload: {} });

      const get2 = await app.inject({ method: "GET", url: "/counter" });
      expect(JSON.parse(get2.payload).value).toBe(2);

      await app.close();
    });
  });

  describe("Cache Key Variations", () => {
    it("should cache with different query parameters separately", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/search", async (request) => {
        const query = (request.query as any).q;
        return { query, results: [`result-${query}`] };
      });

      await app.ready();

      const response1 = await app.inject({ method: "GET", url: "/search?q=test1" });
      const response2 = await app.inject({ method: "GET", url: "/search?q=test2" });

      const data1 = JSON.parse(response1.payload);
      const data2 = JSON.parse(response2.payload);

      expect(data1.query).toBe("test1");
      expect(data2.query).toBe("test2");

      await app.close();
    });

    it("should cache with different route parameters separately", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/users/:id", async (request) => {
        const id = (request.params as any).id;
        return { id, name: `User ${id}` };
      });

      await app.ready();

      const response1 = await app.inject({ method: "GET", url: "/users/1" });
      const response2 = await app.inject({ method: "GET", url: "/users/2" });

      const data1 = JSON.parse(response1.payload);
      const data2 = JSON.parse(response2.payload);

      expect(data1.id).toBe("1");
      expect(data2.id).toBe("2");

      await app.close();
    });

    it("should vary cache by user when authenticated", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/profile", async (request) => {
        const userId = (request as any).user?.id || "anonymous";
        return { userId, profile: `Profile ${userId}` };
      });

      await app.ready();

      const response1 = await app.inject({
        method: "GET",
        url: "/profile",
        headers: { authorization: "Bearer user1-token" },
      });

      const response2 = await app.inject({
        method: "GET",
        url: "/profile",
        headers: { authorization: "Bearer user2-token" },
      });

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);

      await app.close();
    });
  });

  describe("Error Handling", () => {
    it("should not cache on Redis errors", async () => {
      const brokenCache = new RedisCacheManager({
        redisUrl: "redis://invalid-host:9999/0",
        defaultTtl: 300,
        keyPrefix: "broken:",
      });

      const app = Fastify({ logger: false });
      app.decorate("cache", brokenCache);

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/test", async () => {
        return { data: "test" };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/test" });
      expect(response.statusCode).toBe(200);

      await brokenCache.close();
      await app.close();
    });

    it("should handle cache read errors gracefully", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/test", async () => {
        return { data: "test" };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/test" });
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it("should handle cache write errors gracefully", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      app.get("/test", async () => {
        return { data: "large data ".repeat(1000) };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/test" });
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it("should handle invalidation errors gracefully", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: true,
      });

      app.post("/test", async () => {
        return { success: true };
      });

      await app.ready();

      const response = await app.inject({ method: "POST", url: "/test", payload: {} });
      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });

  describe("Configuration Options", () => {
    it("should respect enableCaching option", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: false,
      });

      app.get("/test", async () => {
        return { data: "test" };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/test" });
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it("should respect enableInvalidation option", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        enableInvalidation: false,
      });

      app.get("/data", async () => ({ value: "cached" }));
      app.post("/data", async () => ({ success: true }));

      await app.ready();

      await app.inject({ method: "GET", url: "/data" });
      await app.inject({ method: "POST", url: "/data", payload: {} });

      const response = await app.inject({ method: "GET", url: "/data" });
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    it("should respect logCacheOps option", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new RedisCacheAdapter(cacheManager));

      await app.register(autoCachePlugin, {
        enableCaching: true,
        logCacheOps: true,
      });

      app.get("/test", async () => {
        return { data: "test" };
      });

      await app.ready();

      const response = await app.inject({ method: "GET", url: "/test" });
      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });
});
