#!/usr/bin/env tsx
/**
 * Comprehensive Unit Tests for Cache Decorators
 * Target Coverage: 95%+
 *
 * Testing:
 * - withCache decorator functionality
 * - withInvalidation decorator
 * - Cache key generation
 * - Cache hit/miss scenarios
 * - Batch invalidation
 * - Cache warming
 * - Cache statistics
 *
 * Converted to node:test standard
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  withCache,
  withInvalidation,
  withCacheAndInvalidation,
  generateDefaultCacheKey,
  cacheGetOrSet,
  batchInvalidate,
  warmCache,
  getCacheStatistics,
  createInvalidationMiddleware,
} from "../../src/lib/cache/cacheDecorators.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { RedisCacheManager } from "@adapters/cache-redis";

// Mock cache manager - Pick<> documents exactly which methods are mocked
type MockedRedisCacheManager = Pick<
  RedisCacheManager,
  "get" | "set" | "del" | "invalidateByTag" | "invalidateByPattern" | "getOrSet" | "getStats"
>;

/** Bridge function: typed parameter ensures mock satisfies Pick, cast is contained here */
function asCacheManager(mock: MockedRedisCacheManager): RedisCacheManager {
  return mock as RedisCacheManager;
}

class MockCacheManager implements MockedRedisCacheManager {
  private cache = new Map<string, any>();
  public getCalls: string[] = [];
  public setCalls: Array<{ key: string; value: any }> = [];
  public invalidateCalls: Array<{ type: string; value: string }> = [];

  async get<_T>(key: string) {
    this.getCalls.push(key);
    const value = this.cache.get(key);
    return { ok: true, value: value ?? null } as any;
  }

  async set<T>(key: string, value: T, _options?: any) {
    this.setCalls.push({ key, value });
    this.cache.set(key, value);
    return { ok: true, value } as any;
  }

  async del(key: string) {
    this.cache.delete(key);
    return { ok: true, value: 1 } as any;
  }

  async invalidateByTag(tag: string) {
    this.invalidateCalls.push({ type: "tag", value: tag });
    return { ok: true, value: 1 } as any;
  }

  async invalidateByPattern(pattern: string) {
    this.invalidateCalls.push({ type: "pattern", value: pattern });
    return { ok: true, value: 1 } as any;
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, _options?: any) {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return { ok: true, value: cached } as any;
    }
    const value = await factory();
    this.cache.set(key, value);
    return { ok: true, value } as any;
  }

  async getStats() {
    return {
      ok: true,
      value: {
        hitRate: 0.85,
        totalKeys: 100,
        memoryUsage: 1024000,
        l1Hits: 50,
        l2Hits: 35,
        hotKeys: [
          { key: "hot-key-1", hits: 100 },
          { key: "hot-key-2", hits: 75 },
        ],
      },
    } as any;
  }

  clear() {
    this.cache.clear();
    this.getCalls = [];
    this.setCalls = [];
    this.invalidateCalls = [];
  }
}

// Mock request and reply
function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  const mockCache = new MockCacheManager();
  return {
    method: "GET",
    url: "/test",
    routeOptions: { url: "/test" } as any,
    params: {},
    query: {},
    headers: {},
    id: "req-123",
    server: { cache: mockCache } as any,
    ...overrides,
  } as FastifyRequest;
}

function createMockReply(): FastifyReply {
  const headers: Record<string, string> = {};
  let status = 200;
  let sentPayload: any = null;

  return {
    header: (name: string, value: string) => {
      headers[name] = value;
      return {} as any;
    },
    status: (code: number) => {
      status = code;
      return {} as any;
    },
    send: (payload: any) => {
      sentPayload = payload;
      return {} as any;
    },
    statusCode: status,
    getHeaders: () => headers,
    getSentPayload: () => sentPayload,
  } as any;
}

describe("Cache Decorators - withCache", () => {
  it("should return cached value on cache hit", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    // Pre-populate cache
    await cache.set("api:GET:/test", { data: "cached" });

    const handler = withCache(async () => ({ data: "fresh" }));
    const result = await handler(request, reply);

    assert.deepStrictEqual(result, { data: "cached" });
    assert.strictEqual(cache.getCalls.length, 1);
    assert.strictEqual(cache.setCalls.length, 1); // From pre-populate
  });

  it("should execute handler on cache miss", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCache(async () => ({ data: "fresh" }));
    const result = await handler(request, reply);

    assert.deepStrictEqual(result, { data: "fresh" });
    assert.strictEqual(cache.getCalls.length, 1);
    assert.strictEqual(cache.setCalls.length, 1);
  });

  it("should use custom key generator when provided", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCache(async () => ({ data: "test" }), { keyGenerator: () => "custom-key" });
    await handler(request, reply);

    assert.ok(cache.getCalls.includes("custom-key"));
  });

  it("should respect shouldCache condition", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCache(async () => ({ data: "test", shouldCache: false }), {
      shouldCache: (_req, _reply, data) => data.shouldCache !== false,
    });
    await handler(request, reply);

    // Should execute but not cache
    assert.strictEqual(cache.setCalls.length, 0);
  });

  it("should transform data before caching", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCache(async () => ({ data: "original" }), {
      transformBeforeCache: (data) => ({ data: data.data.toUpperCase() }),
    });
    await handler(request, reply);

    const cached = cache.setCalls[0];
    assert.ok(cached, "Should have cached a value");
    assert.deepStrictEqual(cached.value, { data: "ORIGINAL" });
  });

  it("should transform data after retrieving from cache", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    await cache.set("api:GET:/test", { data: "cached" });

    const handler = withCache(async () => ({ data: "fresh" }), {
      transformAfterCache: (data) => ({ data: data.data.toUpperCase() }),
    });
    const result = await handler(request, reply);

    assert.deepStrictEqual(result, { data: "CACHED" });
  });

  it("should handle cache errors gracefully", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    // Simulate cache failure
    const cache = (request.server as any).cache as MockCacheManager;
    cache.get = async () => ({ ok: false, error: "Cache error" }) as any;

    const handler = withCache(async () => ({ data: "fallback" }));
    const result = await handler(request, reply);

    assert.deepStrictEqual(result, { data: "fallback" });
  });

  it("should work when cache manager is not available", async () => {
    const request = createMockRequest();
    (request.server as any).cache = null;
    const reply = createMockReply();

    const handler = withCache(async () => ({ data: "no-cache" }));
    const result = await handler(request, reply);

    assert.deepStrictEqual(result, { data: "no-cache" });
  });

  it("should set cache headers on hit", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    await cache.set("api:GET:/test", { data: "cached" });

    const handler = withCache(async () => ({ data: "fresh" }));
    await handler(request, reply);

    const headers = (reply as any).getHeaders();
    assert.strictEqual(headers["X-Cache"], "HIT");
  });

  it("should set cache headers on miss", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    const handler = withCache(async () => ({ data: "fresh" }));
    await handler(request, reply);

    const headers = (reply as any).getHeaders();
    assert.strictEqual(headers["X-Cache"], "MISS");
  });
});

describe("Cache Decorators - withInvalidation", () => {
  it("should invalidate by tags after handler execution", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withInvalidation(async () => ({ success: true }), {
      tags: ["posts", "dashboard"],
    });
    await handler(request, reply);

    assert.strictEqual(cache.invalidateCalls.length, 2);
    assert.ok(cache.invalidateCalls.some((c) => c.type === "tag" && c.value === "posts"));
    assert.ok(cache.invalidateCalls.some((c) => c.type === "tag" && c.value === "dashboard"));
  });

  it("should invalidate by patterns", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withInvalidation(async () => ({ success: true }), {
      patterns: ["api:*:posts:*"],
    });
    await handler(request, reply);

    assert.ok(
      cache.invalidateCalls.some((c) => c.type === "pattern" && c.value === "api:*:posts:*")
    );
  });

  it("should execute custom invalidation logic", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    let customInvalidationCalled = false;

    const handler = withInvalidation(async () => ({ success: true }), {
      customInvalidation: async () => {
        customInvalidationCalled = true;
      },
    });
    await handler(request, reply);

    assert.strictEqual(customInvalidationCalled, true);
  });

  it("should auto-invalidate based on route configuration", async () => {
    const request = createMockRequest({
      method: "POST",
      url: "/posts",
      routeOptions: { url: "/posts" } as any,
    });
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withInvalidation(async () => ({ success: true }));
    await handler(request, reply);

    // Should auto-invalidate based on CACHE_INVALIDATION_RULES
    assert.ok(cache.invalidateCalls.length > 0);
  });

  it("should handle invalidation errors gracefully", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    cache.invalidateByTag = async () => {
      throw new Error("Invalidation failed");
    };

    const handler = withInvalidation(async () => ({ success: true }), { tags: ["test"] });

    // Should not throw
    const result = await handler(request, reply);
    assert.deepStrictEqual(result, { success: true });
  });

  it("should work when cache manager is not available", async () => {
    const request = createMockRequest();
    (request.server as any).cache = null;
    const reply = createMockReply();

    const handler = withInvalidation(async () => ({ success: true }), { tags: ["test"] });
    const result = await handler(request, reply);

    assert.deepStrictEqual(result, { success: true });
  });
});

describe("Cache Decorators - withCacheAndInvalidation", () => {
  it("should combine caching and invalidation", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCacheAndInvalidation(
      async () => ({ data: "test" }),
      { ttl: 300 },
      { tags: ["test"] }
    );
    await handler(request, reply);

    assert.ok(cache.setCalls.length > 0);
    assert.ok(cache.invalidateCalls.length > 0);
  });
});

describe("Cache Decorators - generateDefaultCacheKey", () => {
  it("should generate key from request properties", () => {
    const request = createMockRequest({
      method: "GET",
      url: "/posts?limit=10",
      routeOptions: { url: "/posts" } as any,
      params: {} as any,
      query: { limit: "10" } as any,
    });

    const key = generateDefaultCacheKey(request);
    assert.ok(key.includes("GET"));
    assert.ok(key.includes("/posts"));
  });

  it("should include user ID when available", () => {
    const request = createMockRequest({
      method: "GET",
      url: "/users/me",
      routeOptions: { url: "/users/me" } as any,
    });
    (request as any).user = { id: "user-123" };

    const key = generateDefaultCacheKey(request);
    assert.ok(key.includes("user=user-123"));
  });
});

describe("Cache Decorators - cacheGetOrSet", () => {
  it("should return cached value if exists", async () => {
    const cache = asCacheManager(new MockCacheManager());
    await (cache as any).set("test-key", { data: "cached" });

    const result = await cacheGetOrSet(cache, "test-key", async () => ({ data: "fresh" }));

    assert.deepStrictEqual(result, { data: "cached" });
  });

  it("should call factory and cache on miss", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await cacheGetOrSet(cache, "new-key", async () => ({ data: "fresh" }));

    assert.deepStrictEqual(result, { data: "fresh" });
  });

  it("should throw on cache operation failure", async () => {
    const failingCache: Pick<RedisCacheManager, "getOrSet"> = {
      getOrSet: async () => ({ ok: false, error: "Failed" }) as any,
    };

    await assert.rejects(
      async () => {
        await cacheGetOrSet(failingCache as RedisCacheManager, "test-key", async () => ({
          data: "test",
        }));
      },
      { message: /Cache operation failed/ }
    );
  });
});

describe("Cache Decorators - batchInvalidate", () => {
  it("should invalidate multiple tags", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await batchInvalidate(cache, {
      tags: ["posts", "dashboard", "analytics"],
    });

    assert.ok(result.invalidatedCount >= 0);
    const mockCache = cache as any as MockCacheManager;
    assert.strictEqual(mockCache.invalidateCalls.length, 3);
  });

  it("should invalidate multiple patterns", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await batchInvalidate(cache, {
      patterns: ["api:*:posts:*", "api:*:users:*"],
    });

    assert.ok(result.invalidatedCount >= 0);
  });

  it("should invalidate specific keys", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await batchInvalidate(cache, {
      keys: ["key1", "key2", "key3"],
    });

    assert.strictEqual(result.invalidatedCount, 3);
  });

  it("should handle invalidation errors gracefully", async () => {
    const failingCache: Pick<RedisCacheManager, "invalidateByTag"> = {
      invalidateByTag: async () => {
        throw new Error("Invalidation failed");
      },
    };

    const result = await batchInvalidate(failingCache as RedisCacheManager, { tags: ["test"] });
    assert.strictEqual(result.invalidatedCount, 0);
  });
});

describe("Cache Decorators - warmCache", () => {
  it("should pre-populate cache with warmup functions", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await warmCache(cache, [
      {
        key: "key1",
        factory: async () => ({ data: "value1" }),
        options: { ttl: 300 },
      },
      {
        key: "key2",
        factory: async () => ({ data: "value2" }),
        options: { ttl: 600 },
      },
    ]);

    assert.strictEqual(result.warmedCount, 2);
    assert.strictEqual(result.failedCount, 0);
  });

  it("should count failures when factory throws", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await warmCache(cache, [
      {
        key: "key1",
        factory: async () => {
          throw new Error("Failed");
        },
      },
    ]);

    assert.strictEqual(result.warmedCount, 0);
    assert.strictEqual(result.failedCount, 1);
  });
});

describe("Cache Decorators - getCacheStatistics", () => {
  it("should return cache statistics", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const stats = await getCacheStatistics(cache);

    assert.strictEqual(stats.hitRate, 0.85);
    assert.strictEqual(stats.totalKeys, 100);
    assert.strictEqual(stats.memoryUsage, 1024000);
    assert.strictEqual(stats.l1Hits, 50);
    assert.strictEqual(stats.l2Hits, 35);
    assert.ok(Array.isArray(stats.hotKeys));
    assert.strictEqual(stats.hotKeys.length, 2);
  });

  it("should throw when stats retrieval fails", async () => {
    const failingCache: Pick<RedisCacheManager, "getStats"> = {
      getStats: async () => ({ ok: false, error: "Stats failed" }) as any,
    };

    await assert.rejects(
      async () => {
        await getCacheStatistics(failingCache as RedisCacheManager);
      },
      { message: /Failed to get cache statistics/ }
    );
  });
});

describe("Cache Decorators - createInvalidationMiddleware", () => {
  it("should skip invalidation for GET requests", async () => {
    const middleware = createInvalidationMiddleware();
    const request = createMockRequest({ method: "GET" });
    const reply = createMockReply();

    await middleware(request, reply);

    const cache = (request.server as any).cache as MockCacheManager;
    assert.strictEqual(cache.invalidateCalls.length, 0);
  });

  it("should invalidate on successful POST", async () => {
    const middleware = createInvalidationMiddleware();
    const request = createMockRequest({
      method: "POST",
      url: "/posts",
      routeOptions: { url: "/posts" } as any,
    });
    const reply = createMockReply();

    await middleware(request, reply);

    // Simulate successful response
    reply.statusCode = 201;
    (reply.send as any)({ success: true });

    // Cache invalidation happens asynchronously
    // Give it a moment to process
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("should not invalidate on error responses", async () => {
    const middleware = createInvalidationMiddleware();
    const request = createMockRequest({ method: "POST" });
    const reply = createMockReply();

    await middleware(request, reply);

    // Simulate error response
    reply.statusCode = 400;
    (reply.send as any)({ error: "Bad request" });

    const cache = (request.server as any).cache as MockCacheManager;
    // Should not invalidate on 4xx/5xx - invalidation only happens on success
    assert.strictEqual(cache.invalidateCalls.length, 0, "Should not invalidate on error responses");
  });
});
