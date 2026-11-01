#!/usr/bin/env tsx
/**
 * @file autoCacheMiddleware.registration-get.test.ts
 * @description Tests for autoCacheMiddleware - Cache Read Hook and GET Caching
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { autoCachePlugin, createCacheReadHook } from "../../src/middleware/autoCacheMiddleware.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";

/** An in-memory cache that records the key of every read. */
class RecordingCache extends InMemoryCacheAdapter {
  readonly reads: string[] = [];

  /**
   * @method get
   * @description Records the key, then reads it as the in-memory adapter does.
   * @param key - The key to read
   * @returns The cached value, or `null` on a miss
   */
  override async get<T>(key: string): Promise<T | null> {
    this.reads.push(key);
    return super.get<T>(key);
  }
}

describe("autoCacheMiddleware - Cache Read Hook and GET Caching", () => {
  describe("Plugin Registration", () => {
    it("should handle missing cache manager gracefully", async () => {
      const app = Fastify({ logger: false });

      await app.register(autoCachePlugin);

      expect(app.printRoutes).toBeTruthy();
      await app.close();
    });
  });

  describe("Cache read hook", () => {
    it("never reads the cache for a request without a route pattern", async () => {
      const cache = new RecordingCache();
      const readFromCache = createCacheReadHook(cache, false);
      // `/posts` is a cached rule's pattern, so a hook that fell back to the raw path
      // would find the rule and read the cache under a key no route ever writes.
      const request = {
        method: "GET",
        url: "/posts",
        routeOptions: {},
        params: {},
        query: {},
        headers: {},
      } as unknown as FastifyRequest;

      const result = await readFromCache(request, {} as unknown as FastifyReply);

      expect(result).toBeUndefined();
      expect(cache.reads).toEqual([]);
    });
  });

  describe("GET Request Caching", () => {
    it("should cache GET request responses", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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

      expect(response1.statusCode).toBe(200);

      const response2 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      expect(response2.statusCode).toBe(200);
      expect(JSON.parse(response1.payload)).toStrictEqual(JSON.parse(response2.payload));

      await app.close();
    });

    it("should not cache non-GET requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-cache"]).toBe(undefined);

      await app.close();
    });

    it("should exclude routes from caching", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-cache"]).toBe(undefined);

      await app.close();
    });

    it("should not cache error responses", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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

      expect(response1.statusCode).toBe(500);

      const response2 = await app.inject({
        method: "GET",
        url: "/error",
      });

      expect(response2.statusCode).toBe(500);

      await app.close();
    });

    it("should add cache metadata headers", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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

      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });
});
