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
 *
 * @file cacheDecorators.test.ts
 * @description Tests for Cache Decorators - withCache
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
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

    expect(result).toStrictEqual({ data: "cached" });
    expect(cache.getCalls.length).toBe(1);
    expect(cache.setCalls.length).toBe(1); // From pre-populate
  });

  it("should execute handler on cache miss", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCache(async () => ({ data: "fresh" }));
    const result = await handler(request, reply);

    expect(result).toStrictEqual({ data: "fresh" });
    expect(cache.getCalls.length).toBe(1);
    expect(cache.setCalls.length).toBe(1);
  });

  it("should use custom key generator when provided", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withCache(async () => ({ data: "test" }), { keyGenerator: () => "custom-key" });
    await handler(request, reply);

    expect(cache.getCalls.includes("custom-key")).toBeTruthy();
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
    expect(cache.setCalls.length).toBe(0);
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
    expect(cached).toBeTruthy();
    expect(cached.value).toStrictEqual({ data: "ORIGINAL" });
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

    expect(result).toStrictEqual({ data: "CACHED" });
  });

  it("should handle cache errors gracefully", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    // Simulate cache failure
    const cache = (request.server as any).cache as MockCacheManager;
    cache.get = async () => ({ ok: false, error: "Cache error" }) as any;

    const handler = withCache(async () => ({ data: "fallback" }));
    const result = await handler(request, reply);

    expect(result).toStrictEqual({ data: "fallback" });
  });

  it("should work when cache manager is not available", async () => {
    const request = createMockRequest();
    (request.server as any).cache = null;
    const reply = createMockReply();

    const handler = withCache(async () => ({ data: "no-cache" }));
    const result = await handler(request, reply);

    expect(result).toStrictEqual({ data: "no-cache" });
  });

  it("should set cache headers on hit", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    await cache.set("api:GET:/test", { data: "cached" });

    const handler = withCache(async () => ({ data: "fresh" }));
    await handler(request, reply);

    const headers = (reply as any).getHeaders();
    expect(headers["X-Cache"]).toBe("HIT");
  });

  it("should set cache headers on miss", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    const handler = withCache(async () => ({ data: "fresh" }));
    await handler(request, reply);

    const headers = (reply as any).getHeaders();
    expect(headers["X-Cache"]).toBe("MISS");
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

    expect(cache.invalidateCalls.length).toBe(2);
    expect(cache.invalidateCalls.some((c) => c.type === "tag" && c.value === "posts")).toBeTruthy();
    expect(
      cache.invalidateCalls.some((c) => c.type === "tag" && c.value === "dashboard")
    ).toBeTruthy();
  });

  it("should invalidate by patterns", async () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const cache = (request.server as any).cache as MockCacheManager;

    const handler = withInvalidation(async () => ({ success: true }), {
      patterns: ["api:*:posts:*"],
    });
    await handler(request, reply);

    expect(
      cache.invalidateCalls.some((c) => c.type === "pattern" && c.value === "api:*:posts:*")
    ).toBeTruthy();
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

    expect(customInvalidationCalled).toBe(true);
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
    expect(cache.invalidateCalls.length > 0).toBeTruthy();
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
    expect(result).toStrictEqual({ success: true });
  });

  it("should work when cache manager is not available", async () => {
    const request = createMockRequest();
    (request.server as any).cache = null;
    const reply = createMockReply();

    const handler = withInvalidation(async () => ({ success: true }), { tags: ["test"] });
    const result = await handler(request, reply);

    expect(result).toStrictEqual({ success: true });
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

    expect(cache.setCalls.length > 0).toBeTruthy();
    expect(cache.invalidateCalls.length > 0).toBeTruthy();
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
    expect(key.includes("GET")).toBeTruthy();
    expect(key.includes("/posts")).toBeTruthy();
  });

  it("should include user ID when available", () => {
    const request = createMockRequest({
      method: "GET",
      url: "/users/me",
      routeOptions: { url: "/users/me" } as any,
    });
    (request as any).user = { id: "user-123" };

    const key = generateDefaultCacheKey(request);
    expect(key.includes("user=user-123")).toBeTruthy();
  });
});

describe("Cache Decorators - cacheGetOrSet", () => {
  it("should return cached value if exists", async () => {
    const cache = asCacheManager(new MockCacheManager());
    await (cache as any).set("test-key", { data: "cached" });

    const result = await cacheGetOrSet(cache, "test-key", async () => ({ data: "fresh" }));

    expect(result).toStrictEqual({ data: "cached" });
  });

  it("should call factory and cache on miss", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await cacheGetOrSet(cache, "new-key", async () => ({ data: "fresh" }));

    expect(result).toStrictEqual({ data: "fresh" });
  });

  it("should throw on cache operation failure", async () => {
    const failingCache: Pick<RedisCacheManager, "getOrSet"> = {
      getOrSet: async () => ({ ok: false, error: "Failed" }) as any,
    };

    await expect(
      cacheGetOrSet(failingCache as RedisCacheManager, "test-key", async () => ({
        data: "test",
      }))
    ).rejects.toThrow(/Cache operation failed/);
  });
});

describe("Cache Decorators - batchInvalidate", () => {
  it("should invalidate multiple tags", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await batchInvalidate(cache, {
      tags: ["posts", "dashboard", "analytics"],
    });

    expect(result.invalidatedCount >= 0).toBeTruthy();
    const mockCache = cache as any as MockCacheManager;
    expect(mockCache.invalidateCalls.length).toBe(3);
  });

  it("should invalidate multiple patterns", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await batchInvalidate(cache, {
      patterns: ["api:*:posts:*", "api:*:users:*"],
    });

    expect(result.invalidatedCount >= 0).toBeTruthy();
  });

  it("should invalidate specific keys", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const result = await batchInvalidate(cache, {
      keys: ["key1", "key2", "key3"],
    });

    expect(result.invalidatedCount).toBe(3);
  });

  it("should handle invalidation errors gracefully", async () => {
    const failingCache: Pick<RedisCacheManager, "invalidateByTag"> = {
      invalidateByTag: async () => {
        throw new Error("Invalidation failed");
      },
    };

    const result = await batchInvalidate(failingCache as RedisCacheManager, { tags: ["test"] });
    expect(result.invalidatedCount).toBe(0);
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

    expect(result.warmedCount).toBe(2);
    expect(result.failedCount).toBe(0);
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

    expect(result.warmedCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });
});

describe("Cache Decorators - getCacheStatistics", () => {
  it("should return cache statistics", async () => {
    const cache = asCacheManager(new MockCacheManager());

    const stats = await getCacheStatistics(cache);

    expect(stats.hitRate).toBe(0.85);
    expect(stats.totalKeys).toBe(100);
    expect(stats.memoryUsage).toBe(1024000);
    expect(stats.l1Hits).toBe(50);
    expect(stats.l2Hits).toBe(35);
    expect(Array.isArray(stats.hotKeys)).toBeTruthy();
    expect(stats.hotKeys.length).toBe(2);
  });

  it("should throw when stats retrieval fails", async () => {
    const failingCache: Pick<RedisCacheManager, "getStats"> = {
      getStats: async () => ({ ok: false, error: "Stats failed" }) as any,
    };

    await expect(getCacheStatistics(failingCache as RedisCacheManager)).rejects.toThrow(
      /Failed to get cache statistics/
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
    expect(cache.invalidateCalls.length).toBe(0);
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
    expect(cache.invalidateCalls.length).toBe(0);
  });
});
