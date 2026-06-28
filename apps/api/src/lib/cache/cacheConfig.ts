/**
 * @file cacheConfig.ts
 * @description Defines per-endpoint caching strategies (TTL, tags, varyBy) for API
 *              response caching via Redis. Includes cache key generation and invalidation helpers.
 * @layer infrastructure
 */

import { CacheTTL, type CacheOptions } from "@adapters/cache-redis";

/**
 * Per-route cache options consumed by `autoCacheMiddleware`. Extends the
 * package's `CacheOptions` with route-level toggles (enable/disable, custom
 * key pattern, vary-by parameters, invalidation triggers).
 */
export interface RouteCacheOptions extends CacheOptions {
  enabled?: boolean;
  keyPattern?: string;
  varyBy?: string[];
  invalidateOn?: string[];
  /**
   * Whether the cached response is scoped to a single tenant (account).
   *
   * SECURITY (CWE-639): defaults to tenant-scoped. A tenant-scoped route's
   * cache key MUST include the verified `accountId` (see
   * `generateApiCacheKey`), and the auto-cache hook FAILS CLOSED — it bypasses
   * the cache entirely when no tenant can be resolved, never serving or storing
   * under a tenant-agnostic shared key. Set `tenantScoped: false` ONLY for
   * genuinely global, tenant-neutral data (e.g. the provider catalog or the
   * RBAC role/permission catalog) where every tenant receives identical bytes.
   */
  tenantScoped?: boolean;
}

/**
 * Cache configuration for specific API endpoints
 */
export const CACHE_CONFIG: Record<string, RouteCacheOptions> = {
  // Provider endpoints (rarely change, cache aggressively). The provider
  // catalog is GLOBAL — identical bytes for every tenant — so it is explicitly
  // tenant-neutral and cached under a shared key (no accountId segment).
  "GET:/providers": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [],
    tenantScoped: false,
  },
  "GET:/providers/active": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [],
    tenantScoped: false,
  },
  "GET:/providers/by-capability/:capability": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: ["capability"],
    tenantScoped: false,
  },
  "GET:/providers/:id": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: ["id"],
    tenantScoped: false,
  },
  "GET:/providers/health/all": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes (health status changes)
    tags: ["providers", "health"],
    varyBy: [],
    tenantScoped: false,
  },

  // Template endpoints (moderate change frequency)
  "GET:/templates": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["templates"],
    varyBy: ["query:projectId", "query:limit", "query:offset"],
  },
  "GET:/templates/:id": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["templates"],
    varyBy: ["id"],
  },

  // Analytics endpoints (expensive queries, moderate freshness needs)
  "GET:/analytics/dashboard": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["analytics", "dashboard"],
    varyBy: ["query:projectId", "query:timeRange", "query:metrics"],
  },
  "GET:/analytics/posts/:postId": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["analytics", "posts"],
    varyBy: ["postId", "query:timeRange"],
  },
  "GET:/analytics/realtime": {
    enabled: true,
    ttl: 60, // 1 minute (realtime needs fresher data)
    tags: ["analytics", "realtime"],
    varyBy: ["query:projectId"],
  },

  // User endpoints (authenticated, vary by user)
  "GET:/users/me": {
    enabled: true,
    ttl: 600, // 10 minutes
    tags: ["users"],
    varyBy: ["header:authorization"],
  },
  "GET:/users/:id": {
    enabled: true,
    ttl: 600, // 10 minutes
    tags: ["users"],
    varyBy: ["id"],
  },

  // Post endpoints (frequently accessed, moderate changes)
  "GET:/posts": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["posts"],
    varyBy: ["query:projectId", "query:status", "query:limit", "query:offset", "query:sortBy"],
  },
  "GET:/posts/:id": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["posts"],
    varyBy: ["id"],
  },

  // Project endpoints
  "GET:/projects": {
    enabled: true,
    ttl: 600, // 10 minutes
    tags: ["projects"],
    varyBy: ["header:authorization"],
  },
  "GET:/projects/:id": {
    enabled: true,
    ttl: 600, // 10 minutes
    tags: ["projects"],
    varyBy: ["id"],
  },

  // Channel endpoints
  "GET:/channels": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["channels"],
    varyBy: ["query:projectId"],
  },
  "GET:/channels/:id": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["channels"],
    varyBy: ["id"],
  },

  // Audit endpoints (append-only, safe to cache)
  "GET:/audit/logs": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["audit"],
    varyBy: ["query:userId", "query:action", "query:limit", "query:offset"],
  },

  // MFA endpoints (security-sensitive, short cache)
  "GET:/mfa/status": {
    enabled: true,
    ttl: 120, // 2 minutes
    tags: ["mfa", "security"],
    varyBy: ["header:authorization"],
  },

  // RBAC endpoints (permissions change infrequently). The role/permission
  // catalog is GLOBAL (the same definitions for every tenant), so it is
  // explicitly tenant-neutral and cached under a shared key.
  "GET:/rbac/roles": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["rbac", "roles"],
    varyBy: [],
    tenantScoped: false,
  },
  "GET:/rbac/permissions": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["rbac", "permissions"],
    varyBy: ["query:roleId"],
    tenantScoped: false,
  },
};

/**
 * Cache invalidation rules
 *
 * Maps mutation operations to cache tags that should be invalidated
 */
export const CACHE_INVALIDATION_RULES: Record<string, string[]> = {
  // Post mutations
  "POST:/posts": ["posts", "dashboard", "analytics"],
  "PUT:/posts/:id": ["posts", "dashboard", "analytics"],
  "DELETE:/posts/:id": ["posts", "dashboard", "analytics"],

  // Template mutations
  "POST:/templates": ["templates"],
  "PUT:/templates/:id": ["templates"],
  "DELETE:/templates/:id": ["templates"],

  // Project mutations
  "POST:/projects": ["projects", "dashboard"],
  "PUT:/projects/:id": ["projects", "dashboard"],
  "DELETE:/projects/:id": ["projects", "posts", "dashboard"],

  // Channel mutations
  "POST:/channels": ["channels", "dashboard"],
  "PUT:/channels/:id": ["channels"],
  "DELETE:/channels/:id": ["channels", "dashboard"],

  // User mutations
  "PUT:/users/:id": ["users"],
  "DELETE:/users/:id": ["users"],

  // RBAC mutations
  "POST:/rbac/roles": ["rbac", "roles", "permissions"],
  "PUT:/rbac/roles/:id": ["rbac", "roles", "permissions"],
  "DELETE:/rbac/roles/:id": ["rbac", "roles", "permissions"],
  "POST:/rbac/permissions": ["rbac", "permissions"],
  "PUT:/rbac/permissions/:id": ["rbac", "permissions"],
  "DELETE:/rbac/permissions/:id": ["rbac", "permissions"],

  // MFA mutations
  "POST:/mfa/enable": ["mfa", "security"],
  "POST:/mfa/disable": ["mfa", "security"],

  // Analytics refresh (manual refresh)
  "POST:/analytics/refresh": ["analytics", "realtime", "dashboard"],
};

/**
 * Get cache configuration for a route
 */
export function getCacheConfig(method: string, route: string): RouteCacheOptions | undefined {
  const key = `${method}:${route}`;
  return CACHE_CONFIG[key];
}

/**
 * Get cache invalidation tags for a mutation operation
 */
export function getInvalidationTags(method: string, route: string): string[] {
  const key = `${method}:${route}`;
  return CACHE_INVALIDATION_RULES[key] || [];
}

/**
 * Whether a cached route is scoped to a single tenant (account).
 *
 * SECURITY (CWE-639): tenant-scoped is the FAIL-SAFE default — any route with a
 * cache config that does not explicitly opt out (`tenantScoped: false`) is
 * treated as tenant-scoped. Routes with no cache config return `false` (they
 * are not cached at all, so the question is moot).
 */
export function isTenantScopedRoute(method: string, route: string): boolean {
  const config = getCacheConfig(method, route);
  if (!config) {
    return false;
  }
  return config.tenantScoped !== false;
}

/**
 * Check if a route should be cached
 */
export function shouldCacheRoute(method: string, route: string): boolean {
  // Only cache GET requests
  if (method !== "GET") {
    return false;
  }

  const config = getCacheConfig(method, route);
  return config?.enabled === true;
}

/**
 * Cache key generator for API responses
 *
 * Generates unique cache keys based on:
 * - HTTP method
 * - Route path
 * - Tenant context (verified accountId) — ALWAYS for tenant-scoped responses (CWE-639)
 * - Query parameters (if specified in varyBy)
 * - Headers (if specified in varyBy)
 * - User context (included for authenticated requests, intra-tenant separation)
 *
 * SECURITY (CWE-639, cross-tenant cache collision): when `accountId` is
 * supplied it is namespaced into the key as an `acct=<accountId>` segment so a
 * tenant-scoped response can never be served to another tenant. The auto-cache
 * hook resolves and verifies the tenant from the bearer token BEFORE calling
 * this function for tenant-scoped routes, and fails closed (bypasses the cache)
 * when no tenant can be resolved — so a tenant-scoped key without `acct=` is
 * never written or read.
 */
export function generateApiCacheKey(
  method: string,
  route: string,
  params: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  userId?: string,
  accountId?: string
): string {
  const config = getCacheConfig(method, route);

  if (!config) {
    return `api:${method}:${route}`;
  }

  const keyParts: string[] = [`api`, method, route];

  // Tenant boundary segment FIRST — the verified accountId namespaces every
  // tenant-scoped cached response so tenants cannot collide on identical
  // route+params (CWE-639). Tenant-neutral routes pass no accountId, so the
  // segment is omitted and the entry stays shared.
  if (accountId) {
    keyParts.push(`acct=${accountId}`);
  }

  // Add vary-by parameters
  if (config.varyBy) {
    for (const varyParam of config.varyBy) {
      if (varyParam.startsWith("query:")) {
        const queryParam = varyParam.replace("query:", "");
        const value = query[queryParam];
        if (value) {
          keyParts.push(`${queryParam}=${value}`);
        }
      } else if (varyParam.startsWith("header:")) {
        const headerName = varyParam.replace("header:", "");
        const value = headers[headerName];
        if (value) {
          keyParts.push(`${headerName}=${value}`);
        }
      } else if (params[varyParam]) {
        // Path parameter
        keyParts.push(`${varyParam}=${params[varyParam]}`);
      }
    }
  }

  // Include user ID for authenticated requests (intra-tenant user separation)
  if (userId) {
    keyParts.push(`user=${userId}`);
  }

  return keyParts.join(":");
}

/**
 * Default cache TTL by endpoint type
 */
export const DEFAULT_TTL_BY_TYPE = {
  static: CacheTTL.LONG, // 1 hour - providers, capabilities
  moderate: CacheTTL.MEDIUM, // 30 minutes - templates, channels
  dynamic: CacheTTL.SHORT, // 5 minutes - posts, analytics
  realtime: 60, // 1 minute - live data
} as const;

/**
 * Cache statistics configuration
 */
export const CACHE_STATS_CONFIG = {
  trackHotKeys: true,
  hotKeyThreshold: 10, // Keys accessed 10+ times are considered hot
  statsCollectionInterval: 60000, // Collect stats every minute
  maxHotKeys: 100, // Track top 100 hot keys
} as const;
