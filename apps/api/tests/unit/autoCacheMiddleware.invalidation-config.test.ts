#!/usr/bin/env tsx
/**
 * @file autoCacheMiddleware.invalidation-config.test.ts
 * @description Tests for autoCacheMiddleware - Invalidation, Key Variations and Config
 * @layer infrastructure
 */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import Fastify, { type LightMyRequestResponse } from "fastify";
import { until } from "@packages/vitest-shared/determinism";
import { autoCachePlugin } from "../../src/middleware/autoCacheMiddleware.js";
import { generateApiCacheKey } from "../../src/lib/cache/cacheConfig.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";

/** The key segment a caller's credential must reduce to: a sha256 digest, never the value. */
const principalSegment = (authorization: string): string =>
  `authorization=sha256-${createHash("sha256").update(authorization).digest("hex").slice(0, 32)}`;

/**
 * @param response - A response the plugin cached, which says so in its X-Cache-Key header.
 * @returns The key the onSend hook stored the response under.
 */
function cacheKeyOf(response: LightMyRequestResponse): string {
  const key = response.headers["x-cache-key"];
  if (typeof key !== "string") {
    throw new Error(`the response carries no X-Cache-Key header (status ${response.statusCode})`);
  }
  return key;
}

/**
 * Waits until `response` is in the cache. The onSend hook starts the write and sends the reply
 * without waiting for it, so the next request can only HIT once the write has landed.
 * @param cache - The cache the plugin writes to.
 * @param response - The response the plugin is storing.
 */
async function untilCached(
  cache: InMemoryCacheAdapter,
  response: LightMyRequestResponse
): Promise<void> {
  const key = cacheKeyOf(response);
  await until(() => cache.has(key), { description: `the response to be cached under ${key}` });
}

/**
 * Waits until the entry under `key` is gone. The onResponse hook invalidates after the
 * mutation's reply has been sent, so the request that answered does not show it.
 * @param cache - The cache the plugin invalidates.
 * @param key - The key of the entry the mutation invalidates.
 */
async function untilInvalidated(cache: InMemoryCacheAdapter, key: string): Promise<void> {
  await until(async () => !(await cache.has(key)), {
    description: `the entry under ${key} to be invalidated`,
  });
}

describe("autoCacheMiddleware - Invalidation, Key Variations and Config", () => {
  describe("Cache Invalidation", () => {
    it("should invalidate cache on POST requests", async () => {
      const app = Fastify({ logger: false });
      const cache = new InMemoryCacheAdapter();
      app.decorate("cache", cache);

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
      await untilCached(cache, get1);

      const get2 = await app.inject({ method: "GET", url: "/posts" });
      expect(JSON.parse(get2.payload).count).toBe(1);

      await app.inject({ method: "POST", url: "/posts", payload: {} });
      await untilInvalidated(cache, cacheKeyOf(get1));

      const get3 = await app.inject({ method: "GET", url: "/posts" });
      expect(JSON.parse(get3.payload).count).toBe(2);

      await app.close();
    });

    it("should invalidate cache on PUT requests", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      const cache = new InMemoryCacheAdapter();
      app.decorate("cache", cache);

      await app.register(autoCachePlugin, {
        enableCaching: true,
      });

      // `/providers/:id` is a cached rule that varies by its path parameter, so a key
      // that ignored `id` would hand provider 1's response to the request for provider 2.
      app.get("/providers/:id", async (request) => {
        const id = (request.params as any).id;
        return { id, name: `User ${id}` };
      });

      await app.ready();

      const response1 = await app.inject({ method: "GET", url: "/providers/1" });
      await untilCached(cache, response1);
      const response2 = await app.inject({ method: "GET", url: "/providers/2" });

      const data1 = JSON.parse(response1.payload);
      const data2 = JSON.parse(response2.payload);

      expect(data1.id).toBe("1");
      expect(data2.id).toBe("2");

      await app.close();
    });

    it("should vary cache by user when authenticated", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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

    it("keys a caller by a digest of the authorization value and never by the value itself", () => {
      const authorization = "Bearer header.payload-of-account-a.signature";

      const key = generateApiCacheKey("GET", "/posts", {}, {}, { authorization });

      expect(key).not.toContain("payload-of-account-a");
      expect(key).not.toContain("Bearer");
      expect(key).toContain(principalSegment(authorization));
    });

    it("gives two different bearer tokens two different keys", () => {
      const query = { projectId: "p1" };
      const keyA = generateApiCacheKey("GET", "/analytics/dashboard", {}, query, {
        authorization: "Bearer token-of-account-a",
      });
      const keyB = generateApiCacheKey("GET", "/analytics/dashboard", {}, query, {
        authorization: "Bearer token-of-account-b",
      });

      expect(keyA).not.toBe(keyB);
      expect(keyA).toContain(principalSegment("Bearer token-of-account-a"));
      expect(keyB).toContain(principalSegment("Bearer token-of-account-b"));
    });

    it("keys a request without credentials apart from every caller that sent some", () => {
      const anonymous = generateApiCacheKey("GET", "/analytics/dashboard", {}, { projectId: "p1" });
      const authenticated = generateApiCacheKey(
        "GET",
        "/analytics/dashboard",
        {},
        { projectId: "p1" },
        { authorization: "Bearer token-of-account-a" }
      );

      expect(anonymous).toContain("authorization=absent");
      expect(anonymous).not.toBe(authenticated);
    });

    it("escapes the key delimiter in caller-supplied values so one query cannot pose as another", () => {
      const headers = { authorization: "Bearer token-of-account-a" };
      const twoParams = generateApiCacheKey(
        "GET",
        "/analytics/dashboard",
        {},
        { projectId: "p1", timeRange: "7d" },
        headers
      );
      const oneSmuggledParam = generateApiCacheKey(
        "GET",
        "/analytics/dashboard",
        {},
        { projectId: "p1:timeRange=7d" },
        headers
      );

      expect(oneSmuggledParam).not.toBe(twoParams);
      expect(oneSmuggledParam).toContain("projectId=p1%3AtimeRange%3D7d");
    });

    it("never echoes the bearer token in the X-Cache-Key response header", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());
      await app.register(autoCachePlugin, { enableCaching: true });
      app.get("/posts", async () => ({ posts: [] }));
      await app.ready();

      const authorization = "Bearer header.payload-of-account-a.signature";
      const response = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization },
      });

      expect(response.headers["x-cache"]).toBe("MISS");
      expect(response.headers["x-cache-key"]).not.toContain("payload-of-account-a");
      expect(response.headers["x-cache-key"]).toContain(principalSegment(authorization));

      await app.close();
    });
  });

  describe("Cache reads after the route's own hooks", () => {
    it("serves a HIT only after the route's own preHandler admits the request", async () => {
      const app = Fastify({ logger: false });
      const cache = new InMemoryCacheAdapter();
      app.decorate("cache", cache);
      await app.register(autoCachePlugin, { enableCaching: true });

      let revoked = false;
      let gateRuns = 0;
      app.get(
        "/posts",
        {
          preHandler: [
            async (_request, reply) => {
              gateRuns += 1;
              if (revoked) {
                return reply.code(403).send({ error: "access revoked" });
              }
              return undefined;
            },
          ],
        },
        async () => ({ posts: ["owned by the caller"] })
      );
      await app.ready();
      const headers = { authorization: "Bearer token-of-account-a" };

      const miss = await app.inject({ method: "GET", url: "/posts", headers });
      await untilCached(cache, miss);
      const hit = await app.inject({ method: "GET", url: "/posts", headers });
      revoked = true;
      const afterRevocation = await app.inject({ method: "GET", url: "/posts", headers });

      expect(miss.headers["x-cache"]).toBe("MISS");
      expect(hit.headers["x-cache"]).toBe("HIT");
      expect(hit.payload).toBe(miss.payload);
      expect(afterRevocation.statusCode).toBe(403);
      expect(afterRevocation.headers["x-cache"]).not.toBe("HIT");
      expect(gateRuns).toBe(3);

      await app.close();
    });

    it("keeps the current request's headers on a HIT instead of the ones cached with it", async () => {
      const app = Fastify({ logger: false });
      const cache = new InMemoryCacheAdapter();
      app.decorate("cache", cache);
      await app.register(autoCachePlugin, { enableCaching: true });

      let requestNumber = 0;
      app.addHook("onRequest", async (_request, reply) => {
        requestNumber += 1;
        reply.header("x-request-number", String(requestNumber));
      });
      app.get("/posts", async () => ({ posts: [] }));
      await app.ready();
      const headers = { authorization: "Bearer token-of-account-a" };

      const miss = await app.inject({ method: "GET", url: "/posts", headers });
      await untilCached(cache, miss);
      const hit = await app.inject({ method: "GET", url: "/posts", headers });

      expect(hit.headers["x-cache"]).toBe("HIT");
      expect(hit.headers["x-request-number"]).toBe("2");
      expect(hit.headers["content-type"]).toContain("application/json");

      await app.close();
    });
  });

  describe("Error Handling", () => {
    it("should not cache on Redis errors", async () => {
      const failing = new Error("cache backend unavailable");
      const brokenCache = {
        get: async () => {
          throw failing;
        },
        set: async () => {
          throw failing;
        },
        getOrSet: async () => {
          throw failing;
        },
        delete: async () => {
          throw failing;
        },
        invalidateByTag: async () => {
          throw failing;
        },
        has: async () => {
          throw failing;
        },
      };

      const app = Fastify({ logger: false });
      app.decorate("cache", brokenCache as unknown as InMemoryCacheAdapter);

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

    it("should handle cache read errors gracefully", async () => {
      const app = Fastify({ logger: false });
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
      app.decorate("cache", new InMemoryCacheAdapter());

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
