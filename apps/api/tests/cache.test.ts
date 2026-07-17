/**
 * API Response Caching Tests
 *
 * Tests the cache middleware, decorators, and configuration
 *
 * @file cache.test.ts
 * @description Tests for API Response Caching
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FastifyInstance } from "fastify";
import { createApp } from "../src/index.js";
import { createCacheManager, resetCacheManager, RedisCacheManager } from "@adapters/cache-redis";
import { TOKENS } from "../src/infrastructure/container/types.js";
import { signCustomerAccessToken } from "../src/auth/customerJwt.js";
import {
  getCacheConfig,
  getInvalidationTags,
  generateApiCacheKey,
} from "../src/lib/cache/cacheConfig.js";

/**
 * Customer Bearer header for cache-behavior tests that hit auth-gated GET routes
 * (`/posts`). The `/posts` cache key now varies by `header:authorization` (the
 * CWE-639 account-isolation fix), so each account gets its own entry — but a
 * single static token still exercises MISS/HIT/invalidation deterministically
 * (same token → same key) while `requireClientAuth` returns 200. The `accountId`
 * MUST be a valid UUID: the read use cases parse it via `AccountId.fromString`,
 * which rejects a non-UUID with a 400 (Validation failed) before caching runs.
 */
const AUTH_HEADER = `Bearer ${signCustomerAccessToken({
  sub: "cache-test-user",
  accountId: "00000000-0000-4000-8000-000000000001",
  roleId: "role-test",
  roleName: "OWNER",
  permissions: [],
})}`;

describe("API Response Caching", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let cacheManager: RedisCacheManager;

  beforeEach(async () => {
    // Reset singleton so each app gets a fresh cache manager
    resetCacheManager();
    app = await createApp();
    // Resolve the concrete RedisCacheManager from the DI container — the app
    // decorates only `cache` (the CachePort); the concrete manager (with
    // `flush`/`getStats`/`invalidateByTag`) is resolved from the container,
    // mirroring how ops tooling (cacheStatsRoutes) obtains it.
    const container = app.container;
    assert.ok(container, "DI container should be decorated on the app");
    cacheManager = container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager);
    // Clear cache before each test
    await cacheManager.flush();
  });

  afterEach(async () => {
    try {
      await app.close();
    } catch {
      // Ignore close errors during cleanup
    }
    // Reset singleton so next beforeEach creates a fresh one
    resetCacheManager();
  });

  describe("Cache Configuration", () => {
    it("should have cache config for provider endpoints", () => {
      const config = getCacheConfig("GET", "/providers");
      assert.ok(config, "Cache config should be defined");
      assert.equal(config?.enabled, true, "Cache should be enabled");
      assert.equal(config?.ttl, 3600, "TTL should be 1 hour");
      assert.ok(config?.tags?.includes("providers"), "Should have providers tag");
    });

    it("should have cache config for analytics endpoints", () => {
      const config = getCacheConfig("GET", "/analytics/dashboard");
      assert.ok(config, "Cache config should be defined");
      assert.equal(config?.enabled, true, "Cache should be enabled");
      assert.equal(config?.ttl, 300, "TTL should be 5 minutes");
      assert.ok(config?.tags?.includes("analytics"), "Should have analytics tag");
    });

    it("should return undefined for unconfigured routes", () => {
      const config = getCacheConfig("GET", "/nonexistent");
      assert.equal(config, undefined, "Should return undefined for unconfigured routes");
    });

    it("should not cache POST/PUT/DELETE by default", () => {
      const config = getCacheConfig("POST", "/providers");
      assert.equal(config, undefined, "Should not cache POST by default");
    });
  });

  describe("Cache Invalidation Rules", () => {
    it("should have invalidation rules for post mutations", () => {
      const tags = getInvalidationTags("POST", "/posts");
      assert.ok(tags.includes("posts"), "Should include posts tag");
      assert.ok(tags.includes("dashboard"), "Should include dashboard tag");
      assert.ok(tags.includes("analytics"), "Should include analytics tag");
    });

    it("should have invalidation rules for template mutations", () => {
      const tags = getInvalidationTags("PUT", "/templates/:id");
      assert.ok(tags.includes("templates"), "Should include templates tag");
    });

    it("should have invalidation rules for project mutations", () => {
      const tags = getInvalidationTags("DELETE", "/projects/:id");
      assert.ok(tags.includes("projects"), "Should include projects tag");
      assert.ok(tags.includes("posts"), "Should include posts tag");
      assert.ok(tags.includes("dashboard"), "Should include dashboard tag");
    });
  });

  describe("Cache Key Generation", () => {
    it("should generate unique keys based on route", () => {
      const key1 = generateApiCacheKey("GET", "/providers", {}, {}, {});
      const key2 = generateApiCacheKey("GET", "/templates", {}, {}, {});

      assert.notEqual(key1, key2, "Keys should be unique for different routes");
      assert.ok(key1.includes("providers"), "Key should contain route path");
      assert.ok(key2.includes("templates"), "Key should contain route path");
    });

    it("should vary cache by query parameters", () => {
      const key1 = generateApiCacheKey("GET", "/posts", {}, { projectId: "123", limit: "10" }, {});
      const key2 = generateApiCacheKey("GET", "/posts", {}, { projectId: "456", limit: "20" }, {});

      assert.notEqual(key1, key2, "Keys should vary by query parameters");
    });

    it("should vary cache by path parameters", () => {
      const key1 = generateApiCacheKey("GET", "/providers/:id", { id: "x" }, {}, {});
      const key2 = generateApiCacheKey("GET", "/providers/:id", { id: "instagram" }, {}, {});

      assert.notEqual(key1, key2, "Keys should vary by path parameters");
    });

    it("should vary cache by user ID", () => {
      const key1 = generateApiCacheKey("GET", "/users/me", {}, {}, {}, "user1");
      const key2 = generateApiCacheKey("GET", "/users/me", {}, {}, {}, "user2");

      assert.notEqual(key1, key2, "Keys should vary by user ID");
      assert.ok(key1.includes("user1"), "Key should include user ID");
      assert.ok(key2.includes("user2"), "Key should include user ID");
    });
  });

  describe("Cache Hit/Miss Behavior", () => {
    it("should return cache MISS on first request", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/providers",
      });

      assert.equal(response.statusCode, 200, "Should return 200 status");
      assert.equal(response.headers["x-cache"], "MISS", "Should be a cache MISS");
      assert.ok(response.headers["x-cache-key"], "Should have cache key header");
    });

    it("should return cache HIT on second request", async () => {
      // First request - cache miss
      const response1 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      assert.equal(response1.headers["x-cache"], "MISS", "First request should be cache MISS");

      // Wait for fire-and-forget cache.set() to complete before next request
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 50);
        t.unref();
      });

      // Second request - cache hit
      const response2 = await app.inject({
        method: "GET",
        url: "/providers",
      });

      assert.equal(response2.statusCode, 200, "Should return 200 status");
      assert.equal(response2.headers["x-cache"], "HIT", "Second request should be cache HIT");

      // Data should be identical
      assert.deepEqual(response2.json(), response1.json(), "Data should be identical");
    });

    it("should have different cache for different query parameters", async () => {
      // Use status query param (valid enum values) to vary cache keys.
      // `/posts` sits behind requireClientAuth — supply a Bearer so the route
      // returns 200 and the cache headers are emitted.
      const response1 = await app.inject({
        method: "GET",
        url: "/posts?status=DRAFT",
        headers: { authorization: AUTH_HEADER },
      });

      const response2 = await app.inject({
        method: "GET",
        url: "/posts?status=PUBLISHED",
        headers: { authorization: AUTH_HEADER },
      });

      // Both should be cache misses (different cache keys)
      assert.equal(response1.headers["x-cache"], "MISS", "Should be cache MISS");
      assert.equal(response2.headers["x-cache"], "MISS", "Should be cache MISS");

      // Cache keys should be different
      assert.notEqual(
        response1.headers["x-cache-key"],
        response2.headers["x-cache-key"],
        "Cache keys should be different"
      );
    });
  });

  // Helper: small delay to let fire-and-forget cache.set() complete before next request
  const waitForCacheWrite = () =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, 50);
      t.unref();
    });

  describe("Cache Invalidation", { concurrency: 1 }, () => {
    it("should invalidate cache after tag invalidation", async () => {
      // First GET request - cache miss
      const getResponse1 = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      assert.equal(getResponse1.headers["x-cache"], "MISS", "Should be cache MISS");
      await waitForCacheWrite();

      // Second GET request - cache hit
      const getResponse2 = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      assert.equal(getResponse2.headers["x-cache"], "HIT", "Should be cache HIT");

      // Directly invalidate "posts" cache tag
      await cacheManager.invalidateByTag("posts");

      // GET request after invalidation - cache miss again
      const getResponse3 = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      assert.equal(
        getResponse3.headers["x-cache"],
        "MISS",
        "Should be cache MISS after tag invalidation"
      );
    });

    it("should invalidate cache by provider tag", async () => {
      // Cache providers endpoint
      const getResponse1 = await app.inject({
        method: "GET",
        url: "/providers",
      });
      assert.equal(getResponse1.headers["x-cache"], "MISS", "Should be cache MISS");
      await waitForCacheWrite();

      const getResponse2 = await app.inject({
        method: "GET",
        url: "/providers",
      });
      assert.equal(getResponse2.headers["x-cache"], "HIT", "Should be cache HIT");

      // Invalidate "providers" tag directly
      await cacheManager.invalidateByTag("providers");

      // Cache should be invalidated
      const getResponse3 = await app.inject({
        method: "GET",
        url: "/providers",
      });
      assert.equal(
        getResponse3.headers["x-cache"],
        "MISS",
        "Should be cache MISS after tag invalidation"
      );
    });

    it("should invalidate only the matching tag, not unrelated caches", async () => {
      // Cache both providers and posts (with waits to ensure fire-and-forget completes)
      await app.inject({ method: "GET", url: "/providers" });
      await waitForCacheWrite();
      await app.inject({ method: "GET", url: "/posts", headers: { authorization: AUTH_HEADER } });
      await waitForCacheWrite();

      const providerRes = await app.inject({ method: "GET", url: "/providers" });
      const postsRes = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      assert.equal(providerRes.headers["x-cache"], "HIT", "providers should be HIT");
      assert.equal(postsRes.headers["x-cache"], "HIT", "posts should be HIT");

      // Only invalidate "posts" tag
      await cacheManager.invalidateByTag("posts");

      // providers cache should still be HIT
      const providerResAfter = await app.inject({ method: "GET", url: "/providers" });
      assert.equal(providerResAfter.headers["x-cache"], "HIT", "providers should still be HIT");

      // posts cache should be MISS
      const postsResAfter = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      assert.equal(
        postsResAfter.headers["x-cache"],
        "MISS",
        "posts should be MISS after invalidation"
      );
    });
  });

  describe("Cache TTL", () => {
    it("should expire cache after TTL", async () => {
      // Create a standalone cache manager with very short TTL for testing
      resetCacheManager();
      const shortTtlCache = createCacheManager({
        redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
        keyPrefix: "test-ttl:",
        defaultTtl: 1, // 1 second
        enableMetrics: false,
      });

      const testKey = "test-expiry";
      await shortTtlCache.set(testKey, { data: "test" }, { ttl: 1 });

      // Immediately retrieve - should exist
      const result1 = await shortTtlCache.get(testKey);
      assert.equal(result1.ok, true, "Should retrieve successfully");
      assert.deepEqual(result1.value, { data: "test" }, "Should return correct data");

      // Wait for TTL to expire
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 1500);
        t.unref();
      });

      // Should be expired now
      const result2 = await shortTtlCache.get(testKey);
      assert.equal(result2.ok, true, "Get operation should succeed");
      assert.equal(result2.value, null, "Value should be null after expiry");

      await shortTtlCache.close();
      resetCacheManager();
    });
  });

  describe("Cache Performance", () => {
    it("should return cache HIT on repeated requests to the same endpoint", async () => {
      // First request - uncached (MISS)
      const response1 = await app.inject({
        method: "GET",
        url: "/providers",
      });
      assert.equal(response1.headers["x-cache"], "MISS", "First request should be cache MISS");

      // Wait for fire-and-forget cache.set() to complete
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 50);
        t.unref();
      });

      // Second request - cached (HIT)
      const response2 = await app.inject({
        method: "GET",
        url: "/providers",
      });
      assert.equal(response2.headers["x-cache"], "HIT", "Second request should be cache HIT");
    });
  });

  describe("Cache Statistics", () => {
    it("should track cache hits and misses", async () => {
      // Make several requests
      await app.inject({ method: "GET", url: "/providers" }); // Miss
      await app.inject({ method: "GET", url: "/providers" }); // Hit
      await app.inject({ method: "GET", url: "/providers" }); // Hit
      await app.inject({ method: "GET", url: "/templates" }); // Miss

      const stats = await cacheManager.getStats();

      assert.equal(stats.ok, true, "Stats should be retrieved successfully");
      if (stats.ok) {
        assert.ok(stats.value.hits > 0, "Should have cache hits");
        assert.ok(stats.value.misses > 0, "Should have cache misses");
        assert.ok(stats.value.hitRate > 0, "Should have hit rate");
      }
    });

    it("should track hot keys", async () => {
      // Make multiple requests to same endpoint
      for (let i = 0; i < 15; i++) {
        await app.inject({ method: "GET", url: "/providers" });
      }

      const stats = await cacheManager.getStats();

      assert.equal(stats.ok, true, "Stats should be retrieved successfully");
      if (stats.ok) {
        assert.ok(stats.value.hotKeys.length > 0, "Should have hot keys");
      }
    });
  });

  describe("Cache Error Handling", () => {
    it("should handle cache failures gracefully", async () => {
      // Close cache manager to simulate failure
      await cacheManager.close();
      resetCacheManager();

      // Request should still work without cache
      const response = await app.inject({
        method: "GET",
        url: "/providers",
      });

      // Graceful degradation: the route still returns 200 even though the cache
      // backend is closed. The autoCache middleware degrades to "always miss"
      // (it never serves a HIT from a dead cache and never fails the request),
      // so x-cache is MISS — never HIT — when caching is unavailable.
      assert.equal(response.statusCode, 200, "Should still return 200 status");
      assert.notEqual(
        response.headers["x-cache"],
        "HIT",
        "Should never serve a cache HIT when the backend is unavailable"
      );
    });
  });

  describe("Cache Headers", () => {
    it("should include cache control headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/providers",
      });

      assert.ok(response.headers["x-cache"], "Should have x-cache header");
      assert.ok(response.headers["x-cache-key"], "Should have x-cache-key header");
    });

    it("should not include cache headers for non-cacheable requests", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/posts",
        payload: { content: "test" },
      });

      assert.equal(
        response.headers["x-cache"],
        undefined,
        "Should not have x-cache header for POST"
      );
    });
  });

  describe("Batch Invalidation", () => {
    it("should invalidate multiple tags at once", async () => {
      // Cache multiple endpoints with different tags, waiting for fire-and-forget to complete
      await app.inject({ method: "GET", url: "/posts", headers: { authorization: AUTH_HEADER } });
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 50);
        t.unref();
      });
      await app.inject({
        method: "GET",
        url: "/posts?status=DRAFT",
        headers: { authorization: AUTH_HEADER },
      });
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 50);
        t.unref();
      });
      await app.inject({ method: "GET", url: "/providers" });
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 50);
        t.unref();
      });

      // All should be cache hits now
      const response1 = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      const response2 = await app.inject({ method: "GET", url: "/providers" });

      assert.equal(response1.headers["x-cache"], "HIT", "Should be cache HIT");
      assert.equal(response2.headers["x-cache"], "HIT", "Should be cache HIT");

      // Invalidate both posts and providers caches
      await cacheManager.invalidateByTag("posts");
      await cacheManager.invalidateByTag("providers");

      // Both should be cache misses now
      const response3 = await app.inject({
        method: "GET",
        url: "/posts",
        headers: { authorization: AUTH_HEADER },
      });
      const response4 = await app.inject({ method: "GET", url: "/providers" });

      assert.equal(response3.headers["x-cache"], "MISS", "Should be cache MISS after invalidation");
      assert.equal(response4.headers["x-cache"], "MISS", "Should be cache MISS after invalidation");
    });
  });
});

describe("Cache Configuration Completeness", () => {
  it("should have cache config for all critical endpoints", () => {
    const criticalEndpoints = [
      "GET:/providers",
      "GET:/providers/active",
      "GET:/templates",
      "GET:/analytics/dashboard",
      "GET:/users/me",
      "GET:/posts",
      "GET:/projects",
    ];

    for (const endpoint of criticalEndpoints) {
      const colonIdx = endpoint.indexOf(":");
      const method = endpoint.substring(0, colonIdx);
      const route = endpoint.substring(colonIdx + 1);
      const config = getCacheConfig(method as "GET", route);
      assert.ok(config, `Config should exist for ${endpoint}`);
      assert.equal(config?.enabled, true, `Cache should be enabled for ${endpoint}`);
    }
  });

  it("should have invalidation rules for all mutation endpoints", () => {
    const mutationEndpoints = [
      "POST:/posts",
      "PUT:/posts/:id",
      "DELETE:/posts/:id",
      "POST:/templates",
      "PUT:/templates/:id",
      "DELETE:/templates/:id",
      "POST:/projects",
      "PUT:/projects/:id",
      "DELETE:/projects/:id",
    ];

    for (const endpoint of mutationEndpoints) {
      const colonIdx = endpoint.indexOf(":");
      const method = endpoint.substring(0, colonIdx);
      const route = endpoint.substring(colonIdx + 1);
      const tags = getInvalidationTags(method, route);
      assert.ok(tags.length > 0, `Should have invalidation tags for ${endpoint}`);
    }
  });
});
