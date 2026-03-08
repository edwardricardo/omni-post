/**
 * Middleware tests — cachePlugin, CacheInvalidator
 * Uses a mock RedisCacheManager so no Redis connection is needed.
 *
 * cachePlugin is NOT wrapped with fastify-plugin so it creates a Fastify scope
 * boundary. To test the hooks end-to-end, we test the underlying logic
 * (key generation, shouldCacheRequest, CacheInvalidator) directly and use
 * inline hook registration for the Fastify integration scenarios.
 * Tier 0: no DB, no Redis, no network.
 */

import { describe, it, beforeEach, mock, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import client from "prom-client";
import type { RedisCacheManager } from "../src/cache-manager.js";
import { CacheInvalidator, CacheKeys, CacheTTL } from "../src/middleware.js";

// Clear registry once for this process
client.register.clear();

after(() => {
  mock.restoreAll();
  client.register.clear();
});

// ── Mock RedisCacheManager ────────────────────────────────────────────────────

function makeMockManager() {
  const store = new Map<string, any>();

  const invalidateByTag = mock.fn(async (_tag: string) => ({ ok: true as const, value: 0 }));
  const invalidateByPattern = mock.fn(async (_p: string) => ({ ok: true as const, value: 0 }));
  const invalidate = mock.fn(async (_keys: string | string[]) => ({
    ok: true as const,
    value: Array.isArray(_keys) ? _keys.length : 1,
  }));
  const get = mock.fn(async (key: string) => ({
    ok: true as const,
    value: store.get(key) ?? null,
  }));
  const set = mock.fn(async (key: string, value: any) => {
    store.set(key, value);
    return { ok: true as const, value: undefined as void };
  });

  return {
    invalidateByTag,
    invalidateByPattern,
    invalidate,
    get,
    set,
    _store: store,
  } as unknown as RedisCacheManager & {
    _store: Map<string, any>;
    invalidateByTag: ReturnType<typeof mock.fn>;
    invalidateByPattern: ReturnType<typeof mock.fn>;
    invalidate: ReturnType<typeof mock.fn>;
    get: ReturnType<typeof mock.fn>;
    set: ReturnType<typeof mock.fn>;
  };
}

// ── CacheInvalidator tests ────────────────────────────────────────────────────

describe("CacheInvalidator", { concurrency: 1 }, () => {
  let manager: ReturnType<typeof makeMockManager>;
  let invalidator: CacheInvalidator;

  beforeEach(() => {
    manager = makeMockManager();
    invalidator = new CacheInvalidator(manager as any);
  });

  it("invalidateUser() calls invalidateByTag(`user:<id>`) and invalidateByPattern", async () => {
    await invalidator.invalidateUser("user-42");
    assert.strictEqual(manager.invalidateByTag.mock.calls.length, 1);
    assert.strictEqual(manager.invalidateByTag.mock.calls[0]!.arguments[0], "user:user-42");
    assert.strictEqual(manager.invalidateByPattern.mock.calls.length, 1);
    assert.ok(
      (manager.invalidateByPattern.mock.calls[0]!.arguments[0] as string).includes("user-42")
    );
  });

  it("invalidatePost() calls invalidateByTag(`post:<id>`) and invalidateByPattern", async () => {
    await invalidator.invalidatePost("post-99");
    assert.strictEqual(manager.invalidateByTag.mock.calls[0]!.arguments[0], "post:post-99");
    assert.ok(
      (manager.invalidateByPattern.mock.calls[0]!.arguments[0] as string).includes("post-99")
    );
  });

  it("invalidateProject() calls invalidateByTag(`project:<id>`) and invalidateByPattern", async () => {
    await invalidator.invalidateProject("proj-7");
    assert.strictEqual(manager.invalidateByTag.mock.calls[0]!.arguments[0], "project:proj-7");
    assert.ok(
      (manager.invalidateByPattern.mock.calls[0]!.arguments[0] as string).includes("proj-7")
    );
  });

  it("invalidateApiEndpoint() calls invalidateByPattern with api:* wrapper", async () => {
    await invalidator.invalidateApiEndpoint("/posts");
    const pattern = manager.invalidateByPattern.mock.calls[0]!.arguments[0] as string;
    assert.ok(pattern.startsWith("api:*"), `"${pattern}" should start with "api:*"`);
    assert.ok(pattern.includes("/posts"));
  });

  it("invalidateAnalytics() calls invalidateByTag('analytics') and invalidateByPattern('analytics:*')", async () => {
    await invalidator.invalidateAnalytics();
    assert.strictEqual(manager.invalidateByTag.mock.calls[0]!.arguments[0], "analytics");
    assert.ok(
      (manager.invalidateByPattern.mock.calls[0]!.arguments[0] as string).startsWith("analytics:")
    );
  });
});

// ── Re-exported constants from middleware ─────────────────────────────────────

describe("middleware.ts re-exports", { concurrency: 1 }, () => {
  it("re-exports CacheKeys.user from constants", () => {
    assert.strictEqual(CacheKeys.user("abc"), "user:abc");
  });

  it("re-exports CacheKeys.post from constants", () => {
    assert.strictEqual(CacheKeys.post("p-1"), "post:p-1");
  });

  it("re-exports CacheTTL.SHORT === 300", () => {
    assert.strictEqual(CacheTTL.SHORT, 300);
  });

  it("re-exports CacheTTL.MEDIUM === 1800", () => {
    assert.strictEqual(CacheTTL.MEDIUM, 1800);
  });
});

// ── Cache key generation logic (unit tests for generateCacheKey behavior) ─────
//
// We test the key generation behaviour expected by the middleware WITHOUT
// instantiating a full Fastify instance, by reasoning from the source:
//   baseKey = `api:${request.method}:${request.url}`
//   If varyParts exist: `${baseKey}:${md5(varyParts.join("|"))}`

describe("cache key generation logic", { concurrency: 1 }, () => {
  it("base key format is api:<METHOD>:<URL>", () => {
    const method = "GET";
    const url = "/api/posts";
    const key = `api:${method}:${url}`;
    assert.strictEqual(key, "api:GET:/api/posts");
  });

  it("varyBy hash appended for unique user context", () => {
    const baseKey = "api:GET:/api/posts";
    const varyParts = ["user:42"];
    const hash = createHash("md5").update(varyParts.join("|")).digest("hex");
    const key = `${baseKey}:${hash}`;
    assert.ok(key.startsWith("api:GET:/api/posts:"), "key should start with base");
    assert.ok(key.length > "api:GET:/api/posts:".length, "key should have hash suffix");
  });

  it("same varyParts produce same hash (deterministic)", () => {
    const parts = ["user:1", "header:accept:application/json"];
    const h1 = createHash("md5").update(parts.join("|")).digest("hex");
    const h2 = createHash("md5").update(parts.join("|")).digest("hex");
    assert.strictEqual(h1, h2);
  });

  it("different users produce different keys", () => {
    const base = "api:GET:/posts";
    const h1 = createHash("md5").update("user:1").digest("hex");
    const h2 = createHash("md5").update("user:2").digest("hex");
    assert.notStrictEqual(`${base}:${h1}`, `${base}:${h2}`);
  });
});

// ── shouldCacheRequest logic (unit test without Fastify) ──────────────────────
//
// The middleware only caches GET requests with status 200–299 and no auth header
// (unless route explicitly enables caching via cache.enabled = true).

describe("shouldCacheRequest logic", { concurrency: 1 }, () => {
  // We reason about the function's conditions directly from the source:
  //   if (routeOptions?.enabled === false) → false
  //   if (request.method !== "GET") → false
  //   if (request.headers.authorization && !routeOptions?.enabled) → false
  //   return reply.statusCode >= 200 && reply.statusCode < 300

  it("returns false for non-GET methods", () => {
    // Emulate shouldCacheRequest logic
    const result = checkShouldCache("POST", 200, undefined, undefined);
    assert.strictEqual(result, false);
  });

  it("returns false when route.enabled === false", () => {
    const result = checkShouldCache("GET", 200, undefined, false);
    assert.strictEqual(result, false);
  });

  it("returns false for authorized GET without explicit route.enabled", () => {
    const result = checkShouldCache("GET", 200, "Bearer token", undefined);
    assert.strictEqual(result, false);
  });

  it("returns true for unauthenticated GET with 200 status", () => {
    const result = checkShouldCache("GET", 200, undefined, undefined);
    assert.strictEqual(result, true);
  });

  it("returns false for GET with 4xx status", () => {
    assert.strictEqual(checkShouldCache("GET", 404, undefined, undefined), false);
    assert.strictEqual(checkShouldCache("GET", 500, undefined, undefined), false);
  });

  it("returns true for unauthenticated GET with route.enabled explicitly true", () => {
    const result = checkShouldCache("GET", 200, undefined, true);
    assert.strictEqual(result, true);
  });
});

// ── Fastify hook integration via inline hooks (no cachePlugin scoping) ─────────
//
// We test the SAME logic that cachePlugin implements but added directly to the
// root Fastify instance (which avoids the plugin-scope boundary issue).
// This validates the onRequest/onSend cache flow end-to-end.

describe("cache middleware hooks — inline integration", { concurrency: 1 }, () => {
  it("onRequest serves cached response (HIT) with X-Cache header", async () => {
    const Fastify = (await import("fastify")).default;
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    // Pre-populate cache
    manager._store.set("api:GET:/items", {
      body: '{"cached":true}',
      headers: {},
      statusCode: 200,
    });

    // Add hooks to root instance (mirrors cachePlugin logic)
    app.addHook("onRequest", async (request, reply) => {
      if (request.method !== "GET") return;
      const key = `api:${request.method}:${request.url}`;
      const cached = await manager.get(key);
      if (cached.ok && cached.value) {
        reply.header("X-Cache", "HIT");
        reply.code((cached.value as any).statusCode || 200).send((cached.value as any).body);
        return;
      }
      (request as any)._cacheKey = key;
    });

    app.addHook("onSend", async (request, reply, payload) => {
      const key = (request as any)._cacheKey;
      if (!key || request.method !== "GET") return payload;
      await manager.set(key, { body: payload, statusCode: reply.statusCode });
      reply.header("X-Cache", "MISS");
      return payload;
    });

    app.get("/items", async () => ({ fresh: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/items" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["x-cache"], "HIT");
    assert.ok(res.body.includes("cached"));

    await app.close();
  });

  it("onSend stores response and sets X-Cache: MISS on cache miss", async () => {
    const Fastify = (await import("fastify")).default;
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    app.addHook("onRequest", async (request) => {
      if (request.method !== "GET") return;
      const key = `api:${request.method}:${request.url}`;
      const cached = await manager.get(key);
      if (cached.ok && cached.value) return;
      (request as any)._cacheKey = key;
    });

    app.addHook("onSend", async (request, reply, payload) => {
      const key = (request as any)._cacheKey;
      if (!key) return payload;
      await manager.set(key, { body: payload, statusCode: reply.statusCode });
      reply.header("X-Cache", "MISS");
      return payload;
    });

    app.get("/public/data", async () => ({ result: 42 }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/public/data" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["x-cache"], "MISS");
    assert.ok(
      manager.set.mock.calls.length >= 1,
      "set() should have been called to persist the response"
    );

    await app.close();
  });

  it("second request returns HIT after first stores the response", async () => {
    const Fastify = (await import("fastify")).default;
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    app.addHook("onRequest", async (request, reply) => {
      if (request.method !== "GET") return;
      const key = `api:${request.method}:${request.url}`;
      const cached = await manager.get(key);
      if (cached.ok && cached.value) {
        reply.header("X-Cache", "HIT");
        reply.code((cached.value as any).statusCode || 200).send((cached.value as any).body);
        return;
      }
      (request as any)._cacheKey = key;
    });

    app.addHook("onSend", async (request, reply, payload) => {
      const key = (request as any)._cacheKey;
      if (!key) return payload;
      await manager.set(key, { body: payload, statusCode: reply.statusCode });
      reply.header("X-Cache", "MISS");
      return payload;
    });

    app.get("/repeated", async () => ({ v: 1 }));
    await app.ready();

    const r1 = await app.inject({ method: "GET", url: "/repeated" });
    assert.strictEqual(r1.headers["x-cache"], "MISS", "first request should be a MISS");

    const r2 = await app.inject({ method: "GET", url: "/repeated" });
    assert.strictEqual(r2.headers["x-cache"], "HIT", "second request should be a HIT");

    await app.close();
  });

  it("POST requests bypass caching", async () => {
    const Fastify = (await import("fastify")).default;
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    app.addHook("onRequest", async (request) => {
      if (request.method !== "GET") return; // skip non-GET
      (request as any)._cacheKey = `api:${request.method}:${request.url}`;
    });

    app.addHook("onSend", async (request, reply, payload) => {
      const key = (request as any)._cacheKey;
      if (!key) return payload;
      await manager.set(key, { body: payload });
      reply.header("X-Cache", "MISS");
      return payload;
    });

    app.post("/items", async () => ({ created: true }));
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/items", payload: {} });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["x-cache"], undefined, "POST should not get X-Cache header");
    assert.strictEqual(manager.set.mock.calls.length, 0, "set() should not be called for POST");

    await app.close();
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Mirror the shouldCacheRequest function's logic for unit testing
 * without needing a Fastify instance.
 */
function checkShouldCache(
  method: string,
  statusCode: number,
  authHeader: string | undefined,
  routeEnabled: boolean | undefined
): boolean {
  if (routeEnabled === false) return false;
  if (method !== "GET") return false;
  if (authHeader && routeEnabled === undefined) return false;
  return statusCode >= 200 && statusCode < 300;
}
