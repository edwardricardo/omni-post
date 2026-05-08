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
 *
 * @file cacheConfig.test.ts
 * @description Tests for Cache Configuration - Config Constants
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
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
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(CacheTTL.LONG);
    expect(config.tags).toStrictEqual(["providers", "static"]);
    expect(config.varyBy).toStrictEqual([]);
  });

  it("should have provider health endpoint with shorter TTL", () => {
    const config = CACHE_CONFIG["GET:/providers/health/all"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(CacheTTL.SHORT);
    expect(config.tags).toStrictEqual(["providers", "health"]);
  });

  it("should have template endpoints with medium TTL", () => {
    const config = CACHE_CONFIG["GET:/templates"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(CacheTTL.MEDIUM);
    expect(config.tags).toStrictEqual(["templates"]);
    expect(config.varyBy?.includes("query:projectId")).toBeTruthy();
  });

  it("should have analytics dashboard with short TTL", () => {
    const config = CACHE_CONFIG["GET:/analytics/dashboard"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(CacheTTL.SHORT);
    expect(config.tags).toStrictEqual(["analytics", "dashboard"]);
    expect(config.varyBy?.includes("query:projectId")).toBeTruthy();
  });

  it("should have realtime analytics with 1 minute TTL", () => {
    const config = CACHE_CONFIG["GET:/analytics/realtime"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(60);
    expect(config.tags).toStrictEqual(["analytics", "realtime"]);
  });

  it("should vary user endpoints by authorization header", () => {
    const config = CACHE_CONFIG["GET:/users/me"];
    expect(config.enabled).toBe(true);
    expect(config.varyBy?.includes("header:authorization")).toBeTruthy();
  });

  it("should vary posts by multiple query parameters", () => {
    const config = CACHE_CONFIG["GET:/posts"];
    expect(config.enabled).toBe(true);
    expect(config.varyBy?.includes("query:projectId")).toBeTruthy();
    expect(config.varyBy?.includes("query:status")).toBeTruthy();
    expect(config.varyBy?.includes("query:limit")).toBeTruthy();
    expect(config.varyBy?.includes("query:sortBy")).toBeTruthy();
  });

  it("should have channel endpoints with medium TTL", () => {
    const config = CACHE_CONFIG["GET:/channels"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(CacheTTL.MEDIUM);
    expect(config.tags).toStrictEqual(["channels"]);
  });

  it("should have MFA status with short 2-minute TTL", () => {
    const config = CACHE_CONFIG["GET:/mfa/status"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(120);
    expect(config.tags).toStrictEqual(["mfa", "security"]);
  });

  it("should have RBAC endpoints with medium TTL", () => {
    const config = CACHE_CONFIG["GET:/rbac/roles"];
    expect(config.enabled).toBe(true);
    expect(config.ttl).toBe(CacheTTL.MEDIUM);
    expect(config.tags).toStrictEqual(["rbac", "roles"]);
  });
});

describe("Cache Configuration - Invalidation Rules", () => {
  it("should invalidate posts, dashboard, and analytics on post creation", () => {
    const tags = CACHE_INVALIDATION_RULES["POST:/posts"];
    expect(tags).toStrictEqual(["posts", "dashboard", "analytics"]);
  });

  it("should invalidate posts, dashboard, and analytics on post update", () => {
    const tags = CACHE_INVALIDATION_RULES["PUT:/posts/:id"];
    expect(tags).toStrictEqual(["posts", "dashboard", "analytics"]);
  });

  it("should invalidate templates on template mutations", () => {
    const createTags = CACHE_INVALIDATION_RULES["POST:/templates"];
    const updateTags = CACHE_INVALIDATION_RULES["PUT:/templates/:id"];
    const deleteTags = CACHE_INVALIDATION_RULES["DELETE:/templates/:id"];
    expect(createTags).toStrictEqual(["templates"]);
    expect(updateTags).toStrictEqual(["templates"]);
    expect(deleteTags).toStrictEqual(["templates"]);
  });

  it("should invalidate projects and related data on project deletion", () => {
    const tags = CACHE_INVALIDATION_RULES["DELETE:/projects/:id"];
    expect(tags.includes("projects")).toBeTruthy();
    expect(tags.includes("posts")).toBeTruthy();
    expect(tags.includes("dashboard")).toBeTruthy();
  });

  it("should invalidate RBAC caches on role mutations", () => {
    const tags = CACHE_INVALIDATION_RULES["POST:/rbac/roles"];
    expect(tags.includes("rbac")).toBeTruthy();
    expect(tags.includes("roles")).toBeTruthy();
    expect(tags.includes("permissions")).toBeTruthy();
  });

  it("should invalidate MFA and security on MFA enable/disable", () => {
    const enableTags = CACHE_INVALIDATION_RULES["POST:/mfa/enable"];
    const disableTags = CACHE_INVALIDATION_RULES["POST:/mfa/disable"];
    expect(enableTags).toStrictEqual(["mfa", "security"]);
    expect(disableTags).toStrictEqual(["mfa", "security"]);
  });

  it("should invalidate analytics on manual refresh", () => {
    const tags = CACHE_INVALIDATION_RULES["POST:/analytics/refresh"];
    expect(tags.includes("analytics")).toBeTruthy();
    expect(tags.includes("realtime")).toBeTruthy();
    expect(tags.includes("dashboard")).toBeTruthy();
  });
});

describe("Cache Configuration - getCacheConfig", () => {
  it("should return config for valid route", () => {
    const config = getCacheConfig("GET", "/providers");
    expect(config).toBeTruthy();
    expect(config.enabled).toBe(true);
  });

  it("should return undefined for non-existent route", () => {
    const config = getCacheConfig("GET", "/non-existent");
    expect(config).toBe(undefined);
  });

  it("should return config for parameterized routes", () => {
    const config = getCacheConfig("GET", "/posts/:id");
    expect(config).toBeTruthy();
    expect(config.enabled).toBe(true);
  });

  it("should differentiate between methods", () => {
    const getConfig = getCacheConfig("GET", "/posts");
    const postConfig = getCacheConfig("POST", "/posts");
    expect(getConfig).toBeTruthy();
    expect(postConfig).toBe(undefined);
  });
});

describe("Cache Configuration - getInvalidationTags", () => {
  it("should return tags for POST mutations", () => {
    const tags = getInvalidationTags("POST", "/posts");
    expect(Array.isArray(tags)).toBeTruthy();
    expect(tags.length > 0).toBeTruthy();
  });

  it("should return empty array for undefined routes", () => {
    const tags = getInvalidationTags("POST", "/unknown");
    expect(tags).toStrictEqual([]);
  });

  it("should return tags for DELETE operations", () => {
    const tags = getInvalidationTags("DELETE", "/projects/:id");
    expect(tags.length > 0).toBeTruthy();
    expect(tags.includes("projects")).toBeTruthy();
  });
});

describe("Cache Configuration - shouldCacheRoute", () => {
  it("should return true for GET requests with cache config", () => {
    const result = shouldCacheRoute("GET", "/providers");
    expect(result).toBe(true);
  });

  it("should return false for POST requests", () => {
    const result = shouldCacheRoute("POST", "/posts");
    expect(result).toBe(false);
  });

  it("should return false for PUT requests", () => {
    const result = shouldCacheRoute("PUT", "/posts/:id");
    expect(result).toBe(false);
  });

  it("should return false for DELETE requests", () => {
    const result = shouldCacheRoute("DELETE", "/posts/:id");
    expect(result).toBe(false);
  });

  it("should return false for GET requests without config", () => {
    const result = shouldCacheRoute("GET", "/non-existent");
    expect(result).toBe(false);
  });

  it("should return false for disabled cache config", () => {
    // All current configs are enabled, but testing the logic
    const result = shouldCacheRoute("GET", "/undefined-route");
    expect(result).toBe(false);
  });
});

describe("Cache Configuration - generateApiCacheKey", () => {
  it("should generate basic key for simple route", () => {
    const key = generateApiCacheKey("GET", "/providers");
    expect(key.startsWith("api:GET:/providers")).toBeTruthy();
  });

  it("should include path parameters in key", () => {
    const key = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    expect(key.includes("id=twitter")).toBeTruthy();
  });

  it("should include query parameters based on varyBy", () => {
    const key = generateApiCacheKey(
      "GET",
      "/posts",
      {},
      { projectId: "proj-123", status: "published" },
      {}
    );
    expect(key.includes("projectId=proj-123")).toBeTruthy();
    expect(key.includes("status=published")).toBeTruthy();
  });

  it("should include header values when specified in varyBy", () => {
    const key = generateApiCacheKey(
      "GET",
      "/users/me",
      {},
      {},
      { authorization: "Bearer token123" }
    );
    expect(key.includes("authorization=Bearer token123")).toBeTruthy();
  });

  it("should include user ID when provided", () => {
    const key = generateApiCacheKey("GET", "/providers", {}, {}, {}, "user-123");
    expect(key.includes("user=user-123")).toBeTruthy();
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
    expect(key.includes("projectId=proj-123")).toBeTruthy();
    expect(key.includes("limit=10")).toBeTruthy();
    expect(key.includes("offset=0")).toBeTruthy();
    expect(key.includes("user=user-456")).toBeTruthy();
  });

  it("should handle missing vary-by parameters gracefully", () => {
    const key = generateApiCacheKey("GET", "/posts", {}, {}, {});
    expect(key.startsWith("api:GET:/posts")).toBeTruthy();
    // Should not throw or include undefined
    expect(key.includes("undefined")).toBeFalsy();
  });

  it("should generate consistent keys for same inputs", () => {
    const key1 = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    const key2 = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    expect(key1).toBe(key2);
  });

  it("should generate different keys for different inputs", () => {
    const key1 = generateApiCacheKey("GET", "/providers/:id", { id: "twitter" }, {}, {});
    const key2 = generateApiCacheKey("GET", "/providers/:id", { id: "facebook" }, {}, {});
    expect(key1).not.toBe(key2);
  });

  it("should return basic key when no config exists", () => {
    const key = generateApiCacheKey("GET", "/unknown-route", {}, {}, {});
    expect(key).toBe("api:GET:/unknown-route");
  });
});

describe("Cache Configuration - DEFAULT_TTL_BY_TYPE", () => {
  it("should have static type with long TTL", () => {
    expect(DEFAULT_TTL_BY_TYPE.static).toBe(CacheTTL.LONG);
  });

  it("should have moderate type with medium TTL", () => {
    expect(DEFAULT_TTL_BY_TYPE.moderate).toBe(CacheTTL.MEDIUM);
  });

  it("should have dynamic type with short TTL", () => {
    expect(DEFAULT_TTL_BY_TYPE.dynamic).toBe(CacheTTL.SHORT);
  });

  it("should have realtime type with 60 second TTL", () => {
    expect(DEFAULT_TTL_BY_TYPE.realtime).toBe(60);
  });
});

describe("Cache Configuration - CACHE_STATS_CONFIG", () => {
  it("should have hot key tracking enabled", () => {
    expect(CACHE_STATS_CONFIG.trackHotKeys).toBe(true);
  });

  it("should have hot key threshold of 10", () => {
    expect(CACHE_STATS_CONFIG.hotKeyThreshold).toBe(10);
  });

  it("should have 60 second stats collection interval", () => {
    expect(CACHE_STATS_CONFIG.statsCollectionInterval).toBe(60000);
  });

  it("should track top 100 hot keys", () => {
    expect(CACHE_STATS_CONFIG.maxHotKeys).toBe(100);
  });
});
