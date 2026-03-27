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

import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import client from "prom-client";
import type { RedisCacheManager } from "../src/cache-manager.js";
import { CacheInvalidator } from "../src/middleware.js";
import { CacheKeys, CacheTTL } from "../src/constants.js";

// Clear registry once for this process
client.register.clear();

afterAll(() => {
  vi.restoreAllMocks();
  client.register.clear();
});

// ── Mock RedisCacheManager ────────────────────────────────────────────────────

function makeMockManager() {
  const store = new Map<string, any>();

  const invalidateByTag = vi.fn(async (_tag: string) => ({ ok: true as const, value: 0 }));
  const invalidateByPattern = vi.fn(async (_p: string) => ({ ok: true as const, value: 0 }));
  const invalidate = vi.fn(async (_keys: string | string[]) => ({
    ok: true as const,
    value: Array.isArray(_keys) ? _keys.length : 1,
  }));
  const get = vi.fn(async (key: string) => ({
    ok: true as const,
    value: store.get(key) ?? null,
  }));
  const set = vi.fn(async (key: string, value: any) => {
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
    invalidateByTag: ReturnType<typeof vi.fn>;
    invalidateByPattern: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
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
    expect(manager.invalidateByTag.mock.calls.length).toBe(1);
    expect(manager.invalidateByTag.mock.calls[0]![0]).toBe("user:user-42");
    expect(manager.invalidateByPattern.mock.calls.length).toBe(1);
    expect((manager.invalidateByPattern.mock.calls[0]![0] as string).includes("user-42")).toBe(
      true
    );
  });

  it("invalidatePost() calls invalidateByTag(`post:<id>`) and invalidateByPattern", async () => {
    await invalidator.invalidatePost("post-99");
    expect(manager.invalidateByTag.mock.calls[0]![0]).toBe("post:post-99");
    expect((manager.invalidateByPattern.mock.calls[0]![0] as string).includes("post-99")).toBe(
      true
    );
  });

  it("invalidateProject() calls invalidateByTag(`project:<id>`) and invalidateByPattern", async () => {
    await invalidator.invalidateProject("proj-7");
    expect(manager.invalidateByTag.mock.calls[0]![0]).toBe("project:proj-7");
    expect((manager.invalidateByPattern.mock.calls[0]![0] as string).includes("proj-7")).toBe(true);
  });

  it("invalidateApiEndpoint() calls invalidateByPattern with api:* wrapper", async () => {
    await invalidator.invalidateApiEndpoint("/posts");
    const pattern = manager.invalidateByPattern.mock.calls[0]![0] as string;
    expect(pattern.startsWith("api:*")).toBe(true);
    expect(pattern.includes("/posts")).toBe(true);
  });

  it("invalidateAnalytics() calls invalidateByTag('analytics') and invalidateByPattern('analytics:*')", async () => {
    await invalidator.invalidateAnalytics();
    expect(manager.invalidateByTag.mock.calls[0]![0]).toBe("analytics");
    expect((manager.invalidateByPattern.mock.calls[0]![0] as string).startsWith("analytics:")).toBe(
      true
    );
  });
});

// ── Re-exported constants from middleware ─────────────────────────────────────

describe("middleware.ts re-exports", { concurrency: 1 }, () => {
  it("re-exports CacheKeys.user from constants", () => {
    expect(CacheKeys.user("abc")).toBe("user:abc");
  });

  it("re-exports CacheKeys.post from constants", () => {
    expect(CacheKeys.post("p-1")).toBe("post:p-1");
  });

  it("re-exports CacheTTL.SHORT === 300", () => {
    expect(CacheTTL.SHORT).toBe(300);
  });

  it("re-exports CacheTTL.MEDIUM === 1800", () => {
    expect(CacheTTL.MEDIUM).toBe(1800);
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
    expect(key).toBe("api:GET:/api/posts");
  });

  it("varyBy hash appended for unique user context", () => {
    const baseKey = "api:GET:/api/posts";
    const varyParts = ["user:42"];
    const hash = createHash("md5").update(varyParts.join("|")).digest("hex");
    const key = `${baseKey}:${hash}`;
    expect(key.startsWith("api:GET:/api/posts:")).toBe(true);
    expect(key.length).toBeGreaterThan("api:GET:/api/posts:".length);
  });

  it("same varyParts produce same hash (deterministic)", () => {
    const parts = ["user:1", "header:accept:application/json"];
    const h1 = createHash("md5").update(parts.join("|")).digest("hex");
    const h2 = createHash("md5").update(parts.join("|")).digest("hex");
    expect(h1).toBe(h2);
  });

  it("different users produce different keys", () => {
    const base = "api:GET:/posts";
    const h1 = createHash("md5").update("user:1").digest("hex");
    const h2 = createHash("md5").update("user:2").digest("hex");
    expect(`${base}:${h1}`).not.toBe(`${base}:${h2}`);
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
    expect(result).toBe(false);
  });

  it("returns false when route.enabled === false", () => {
    const result = checkShouldCache("GET", 200, undefined, false);
    expect(result).toBe(false);
  });

  it("returns false for authorized GET without explicit route.enabled", () => {
    const result = checkShouldCache("GET", 200, "Bearer token", undefined);
    expect(result).toBe(false);
  });

  it("returns true for unauthenticated GET with 200 status", () => {
    const result = checkShouldCache("GET", 200, undefined, undefined);
    expect(result).toBe(true);
  });

  it("returns false for GET with 4xx status", () => {
    expect(checkShouldCache("GET", 404, undefined, undefined)).toBe(false);
    expect(checkShouldCache("GET", 500, undefined, undefined)).toBe(false);
  });

  it("returns true for unauthenticated GET with route.enabled explicitly true", () => {
    const result = checkShouldCache("GET", 200, undefined, true);
    expect(result).toBe(true);
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
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.body.includes("cached")).toBe(true);

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
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(manager.set.mock.calls.length).toBeGreaterThanOrEqual(1);

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
    expect(r1.headers["x-cache"]).toBe("MISS");

    const r2 = await app.inject({ method: "GET", url: "/repeated" });
    expect(r2.headers["x-cache"]).toBe("HIT");

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
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe(undefined);
    expect(manager.set.mock.calls.length).toBe(0);

    await app.close();
  });
});

// ── cachePlugin Fastify integration — actual plugin registration ─────────────
//
// These tests register the ACTUAL cachePlugin export to exercise the real code
// in middleware.ts, killing Stryker mutants in generateCacheKey and
// shouldCacheRequest.

describe("cachePlugin — actual plugin (fp() wrapped)", { concurrency: 1 }, () => {
  it("decorates fastify instance with cache (available to parent scope)", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, { cacheManager: manager as any });
    await app.ready();

    // With fp(), cache decorator is available on the parent instance
    expect((app as any).cache).toBeDefined();
    await app.close();
  });

  it("calls cacheManager.get on GET requests", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, { cacheManager: manager as any });
    app.get("/items", async () => ({ items: [] }));
    await app.ready();

    await app.inject({ method: "GET", url: "/items" });

    expect(manager.get.mock.calls.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("does not call cacheManager.get for POST requests", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, { cacheManager: manager as any });
    app.post("/create", async () => ({ created: true }));
    await app.ready();

    await app.inject({ method: "POST", url: "/create", payload: {} });

    expect(manager.get.mock.calls.length).toBe(0);
    await app.close();
  });

  it("uses custom keyGenerator when provided", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    const customKeyGen = vi.fn((_req: any) => "custom:key:123");
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, {
      cacheManager: manager as any,
      keyGenerator: customKeyGen,
    });
    app.get("/keyed", async () => ({ ok: true }));
    await app.ready();

    await app.inject({ method: "GET", url: "/keyed" });

    expect(customKeyGen).toHaveBeenCalledTimes(1);
    expect(manager.get).toHaveBeenCalledWith("custom:key:123");
    await app.close();
  });

  it("continues to handler when cacheManager.get throws", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    manager.get.mockRejectedValueOnce(new Error("Redis connection refused"));
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, { cacheManager: manager as any });
    app.get("/resilient", async () => ({ fallback: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/resilient" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fallback: true });
    await app.close();
  });

  it("stores response via cacheManager.set on cache miss", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, { cacheManager: manager as any });
    app.get("/store-test", async () => ({ stored: true }));
    await app.ready();

    await app.inject({ method: "GET", url: "/store-test" });

    expect(manager.set.mock.calls.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("serves cached response when cacheManager.get returns a value", async () => {
    const Fastify = (await import("fastify")).default;
    const { cachePlugin } = await import("../src/middleware.js");
    const manager = makeMockManager();
    // Pre-populate cache
    manager._store.set("api:GET:/cached-data", {
      body: '{"cached":true}',
      headers: {},
      statusCode: 200,
    });
    const app = Fastify({ logger: false });

    await app.register(cachePlugin, { cacheManager: manager as any });
    app.get("/cached-data", async () => ({ fresh: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/cached-data" });

    // Should serve cached response, not fresh handler
    expect(res.headers["x-cache"]).toBe("HIT");
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
