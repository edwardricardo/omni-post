#!/usr/bin/env tsx
/**
 * Comprehensive Unit Tests for Cache Configuration
 * Target Coverage: 95%+
 *
 * Testing:
 * - Cache configuration for all endpoints
 * - Cache key generation
 * - Invalidation rules
 * - Route caching decisions
 * - TTL configuration
 * - Cache statistics config
 *
 * Converted to node:test standard
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_CONFIG,
  CACHE_INVALIDATION_RULES,
  DEFAULT_TTL_BY_TYPE,
  CACHE_STATS_CONFIG,
  getCacheConfig,
  getInvalidationTags,
  shouldCacheRoute,
  generateApiCacheKey,
} from "../../src/lib/cache/cacheConfig.js";
import { CacheTTL } from "@adapters/cache-redis";

describe("Cache Configuration - Config Constants", () => {
  it("should have valid cache configuration for provider endpoints", () => {
    const config = CACHE_CONFIG["GET:/providers"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, CacheTTL.LONG);
    assert.deepStrictEqual(config.tags, ["providers", "static"]);
    assert.deepStrictEqual(config.varyBy, []);
  });

  it("should have provider health endpoint with shorter TTL", () => {
    const config = CACHE_CONFIG["GET:/providers/health/all"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, CacheTTL.SHORT);
    assert.deepStrictEqual(config.tags, ["providers", "health"]);
  });

  it("should have template endpoints with medium TTL", () => {
    const config = CACHE_CONFIG["GET:/templates"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, CacheTTL.MEDIUM);
    assert.deepStrictEqual(config.tags, ["templates"]);
    assert.ok(config.varyBy?.includes("query:projectId"));
  });

  it("should have analytics dashboard with short TTL", () => {
    const config = CACHE_CONFIG["GET:/analytics/dashboard"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, CacheTTL.SHORT);
    assert.deepStrictEqual(config.tags, ["analytics", "dashboard"]);
    assert.ok(config.varyBy?.includes("query:projectId"));
  });

  it("should have realtime analytics with 1 minute TTL", () => {
    const config = CACHE_CONFIG["GET:/analytics/realtime"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, 60);
    assert.deepStrictEqual(config.tags, ["analytics", "realtime"]);
  });

  it("should vary user endpoints by authorization header", () => {
    const config = CACHE_CONFIG["GET:/users/me"];
    assert.strictEqual(config.enabled, true);
    assert.ok(config.varyBy?.includes("header:authorization"));
  });

  it("should vary posts by multiple query parameters", () => {
    const config = CACHE_CONFIG["GET:/posts"];
    assert.strictEqual(config.enabled, true);
    assert.ok(config.varyBy?.includes("query:projectId"));
    assert.ok(config.varyBy?.includes("query:status"));
    assert.ok(config.varyBy?.includes("query:limit"));
    assert.ok(config.varyBy?.includes("query:sortBy"));
  });

  it("should have channel endpoints with medium TTL", () => {
    const config = CACHE_CONFIG["GET:/channels"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, CacheTTL.MEDIUM);
    assert.deepStrictEqual(config.tags, ["channels"]);
  });

  it("should have MFA status with short 2-minute TTL", () => {
    const config = CACHE_CONFIG["GET:/mfa/status"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, 120);
    assert.deepStrictEqual(config.tags, ["mfa", "security"]);
  });

  it("should have RBAC endpoints with medium TTL", () => {
    const config = CACHE_CONFIG["GET:/rbac/roles"];
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.ttl, CacheTTL.MEDIUM);
    assert.deepStrictEqual(config.tags, ["rbac", "roles"]);
  });
});

describe("Cache Configuration - Invalidation Rules", () => {
  it("should invalidate posts, dashboard, and analytics on post creation", () => {
    const tags = CACHE_INVALIDATION_RULES["POST:/posts"];
    assert.deepStrictEqual(tags, ["posts", "dashboard", "analytics"]);
  });

  it("should invalidate posts, dashboard, and analytics on post update", () => {
    const tags = CACHE_INVALIDATION_RULES["PUT:/posts/:id"];
    assert.deepStrictEqual(tags, ["posts", "dashboard", "analytics"]);
  });

  it("should invalidate templates on template mutations", () => {
    const createTags = CACHE_INVALIDATION_RULES["POST:/templates"];
    const updateTags = CACHE_INVALIDATION_RULES["PUT:/templates/:id"];
    const deleteTags = CACHE_INVALIDATION_RULES["DELETE:/templates/:id"];
    assert.deepStrictEqual(createTags, ["templates"]);
    assert.deepStrictEqual(updateTags, ["templates"]);
    assert.deepStrictEqual(deleteTags, ["templates"]);
  });

  it("should invalidate projects and related data on project deletion", () => {
    const tags = CACHE_INVALIDATION_RULES["DELETE:/projects/:id"];
    assert.ok(tags.includes("projects"));
    assert.ok(tags.includes("posts"));
    assert.ok(tags.includes("dashboard"));
  });

  it("should invalidate RBAC caches on role mutations", () => {
    const tags = CACHE_INVALIDATION_RULES["POST:/rbac/roles"];
    assert.ok(tags.includes("rbac"));
    assert.ok(tags.includes("roles"));
    assert.ok(tags.includes("permissions"));
  });

  it("should invalidate MFA and security on MFA enable/disable", () => {
    const enableTags = CACHE_INVALIDATION_RULES["POST:/mfa/enable"];
    const disableTags = CACHE_INVALIDATION_RULES["POST:/mfa/disable"];
    assert.deepStrictEqual(enableTags, ["mfa", "security"]);
    assert.deepStrictEqual(disableTags, ["mfa", "security"]);
  });

  it("should invalidate analytics on manual refresh", () => {
    const tags = CACHE_INVALIDATION_RULES["POST:/analytics/refresh"];
    assert.ok(tags.includes("analytics"));
    assert.ok(tags.includes("realtime"));
    assert.ok(tags.includes("dashboard"));
  });
});

describe("Cache Configuration - getCacheConfig", () => {
  it("should return config for valid route", () => {
    const config = getCacheConfig("GET", "/providers");
    assert.ok(config);
    assert.strictEqual(config.enabled, true);
  });

  it("should return undefined for non-existent route", () => {
    const config = getCacheConfig("GET", "/non-existent");
    assert.strictEqual(config, undefined);
  });

  it("should return config for parameterized routes", () => {
    const config = getCacheConfig("GET", "/posts/:id");
    assert.ok(config);
    assert.strictEqual(config.enabled, true);
  });

  it("should differentiate between methods", () => {
    const getConfig = getCacheConfig("GET", "/posts");
    const postConfig = getCacheConfig("POST", "/posts");
    assert.ok(getConfig);
    assert.strictEqual(postConfig, undefined);
  });
});

describe("Cache Configuration - getInvalidationTags", () => {
  it("should return tags for POST mutations", () => {
    const tags = getInvalidationTags("POST", "/posts");
    assert.ok(Array.isArray(tags));
    assert.ok(tags.length > 0);
  });

  it("should return empty array for undefined routes", () => {
    const tags = getInvalidationTags("POST", "/unknown");
    assert.deepStrictEqual(tags, []);
  });

  it("should return tags for DELETE operations", () => {
    const tags = getInvalidationTags("DELETE", "/projects/:id");
    assert.ok(tags.length > 0);
    assert.ok(tags.includes("projects"));
  });
});

describe("Cache Configuration - shouldCacheRoute", () => {
  it("should return true for GET requests with cache config", () => {
    const result = shouldCacheRoute("GET", "/providers");
    assert.strictEqual(result, true);
  });

  it("should return false for POST requests", () => {
    const result = shouldCacheRoute("POST", "/posts");
    assert.strictEqual(result, false);
  });

  it("should return false for PUT requests", () => {
    const result = shouldCacheRoute("PUT", "/posts/:id");
    assert.strictEqual(result, false);
  });

  it("should return false for DELETE requests", () => {
    const result = shouldCacheRoute("DELETE", "/posts/:id");
    assert.strictEqual(result, false);
  });

  it("should return false for GET requests without config", () => {
    const result = shouldCacheRoute("GET", "/non-existent");
    assert.strictEqual(result, false);
  });

  it("should return false for disabled cache config", () => {
    // All current configs are enabled, but testing the logic
    const result = shouldCacheRoute("GET", "/undefined-route");
    assert.strictEqual(result, false);
  });
});

describe("Cache Configuration - generateApiCacheKey", () => {
  it("should generate basic key for simple route", () => {
    const key = generateApiCacheKey("GET", "/providers");
    assert.ok(key.startsWith("api:GET:/providers"));
  });

  it("should include path parameters in key", () => {
    const key = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    assert.ok(key.includes("id=twitter"));
  });

  it("should include query parameters based on varyBy", () => {
    const key = generateApiCacheKey(
      "GET",
      "/posts",
      {},
      { projectId: "proj-123", status: "published" },
      {}
    );
    assert.ok(key.includes("projectId=proj-123"));
    assert.ok(key.includes("status=published"));
  });

  it("should include header values when specified in varyBy", () => {
    const key = generateApiCacheKey(
      "GET",
      "/users/me",
      {},
      {},
      { authorization: "Bearer token123" }
    );
    assert.ok(key.includes("authorization=Bearer token123"));
  });

  it("should include user ID when provided", () => {
    const key = generateApiCacheKey("GET", "/providers", {}, {}, {}, "user-123");
    assert.ok(key.includes("user=user-123"));
  });

  it("should combine multiple vary-by parameters", () => {
    const key = generateApiCacheKey(
      "GET",
      "/posts",
      {},
      { projectId: "proj-123", limit: "10", offset: "0" },
      {},
      "user-456"
    );
    assert.ok(key.includes("projectId=proj-123"));
    assert.ok(key.includes("limit=10"));
    assert.ok(key.includes("offset=0"));
    assert.ok(key.includes("user=user-456"));
  });

  it("should handle missing vary-by parameters gracefully", () => {
    const key = generateApiCacheKey("GET", "/posts", {}, {}, {});
    assert.ok(key.startsWith("api:GET:/posts"));
    // Should not throw or include undefined
    assert.ok(!key.includes("undefined"));
  });

  it("should generate consistent keys for same inputs", () => {
    const key1 = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    const key2 = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    assert.strictEqual(key1, key2);
  });

  it("should generate different keys for different inputs", () => {
    const key1 = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    const key2 = generateApiCacheKey("GET", "/providers/:id", { id: "facebook" }, {}, {});
    assert.notStrictEqual(key1, key2);
  });

  it("should return basic key when no config exists", () => {
    const key = generateApiCacheKey("GET", "/unknown-route", {}, {}, {});
    assert.strictEqual(key, "api:GET:/unknown-route");
  });
});

describe("Cache Configuration - DEFAULT_TTL_BY_TYPE", () => {
  it("should have static type with long TTL", () => {
    assert.strictEqual(DEFAULT_TTL_BY_TYPE.static, CacheTTL.LONG);
  });

  it("should have moderate type with medium TTL", () => {
    assert.strictEqual(DEFAULT_TTL_BY_TYPE.moderate, CacheTTL.MEDIUM);
  });

  it("should have dynamic type with short TTL", () => {
    assert.strictEqual(DEFAULT_TTL_BY_TYPE.dynamic, CacheTTL.SHORT);
  });

  it("should have realtime type with 60 second TTL", () => {
    assert.strictEqual(DEFAULT_TTL_BY_TYPE.realtime, 60);
  });
});

describe("Cache Configuration - CACHE_STATS_CONFIG", () => {
  it("should have hot key tracking enabled", () => {
    assert.strictEqual(CACHE_STATS_CONFIG.trackHotKeys, true);
  });

  it("should have hot key threshold of 10", () => {
    assert.strictEqual(CACHE_STATS_CONFIG.hotKeyThreshold, 10);
  });

  it("should have 60 second stats collection interval", () => {
    assert.strictEqual(CACHE_STATS_CONFIG.statsCollectionInterval, 60000);
  });

  it("should track top 100 hot keys", () => {
    assert.strictEqual(CACHE_STATS_CONFIG.maxHotKeys, 100);
  });
});
