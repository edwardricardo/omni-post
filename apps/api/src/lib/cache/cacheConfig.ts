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
}

/**
 * Cache configuration for specific API endpoints
 */
export const CACHE_CONFIG: Record<string, RouteCacheOptions> = {
  // Provider endpoints (rarely change, cache aggressively)
  "GET:/providers": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [],
  },
  "GET:/providers/active": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [],
  },
  "GET:/providers/by-capability/:capability": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: ["capability"],
  },
  "GET:/providers/:id": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: ["id"],
  },
  "GET:/providers/health/all": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes (health status changes)
    tags: ["providers", "health"],
    varyBy: [],
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

  // Post endpoints (frequently accessed, moderate changes).
  // `header:authorization` is REQUIRED in varyBy (CWE-639): the cache-read hook
  // runs on `onRequest`, before `requireClientAuth` parses the principal, so the
  // only account-discriminating value available is the raw bearer token. Without
  // it the cache key is account-agnostic and the owner's cached response leaks to
  // (and is served without re-auth to) any caller requesting the same id — which
  // would defeat the ownership gate enforced in the query layer.
  "GET:/posts": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["posts"],
    varyBy: [
      "header:authorization",
      "query:projectId",
      "query:status",
      "query:limit",
      "query:offset",
      "query:sortBy",
    ],
  },
  "GET:/posts/:id": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes
    tags: ["posts"],
    varyBy: ["header:authorization", "id"],
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

  // RBAC endpoints (permissions change infrequently)
  "GET:/rbac/roles": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["rbac", "roles"],
    varyBy: [],
  },
  "GET:/rbac/permissions": {
    enabled: true,
    ttl: CacheTTL.MEDIUM, // 30 minutes
    tags: ["rbac", "permissions"],
    varyBy: ["query:roleId"],
  },
};

/**
 * Cache invalidation rules
 *
 * Maps mutation operations to cache tags that should be invalidated.
 *
 * EVERY KEY MUST BE SPELLED THE WAY THE ROUTE IS REGISTERED, parameter names
 * included: the lookup is an exact `Record` hit on `request.routeOptions.url`,
 * so `DELETE:/projects/:id` against a route registered as
 * `/projects/:projectId` returns no tags, invalidates nothing, and looks
 * correct in every place a reader would check. `cacheRouteCoverage.ts` asserts
 * this at boot; it is not left to review.
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

  // Project mutations. Keyed to the spellings projectRoutes.ts registers
  // (`/accounts/:accountId/projects`, `/projects/:projectId`) — the previous
  // flat `/projects/:id` keys matched nothing, so a deleted project's posts
  // kept being served from the cached feed for a full TTL. There is no PUT
  // project route, so the rule that claimed to cover one is gone rather than
  // renamed.
  "POST:/accounts/:accountId/projects": ["projects", "dashboard"],
  "DELETE:/projects/:projectId": ["projects", "posts", "dashboard"],
  // The irreversible path destroys the same rows the soft delete hides, so it
  // leaves the same feed stale and needs the same sweep.
  "DELETE:/projects/:projectId/hard": ["projects", "posts", "dashboard"],

  // Account mutations. An account delete is the BROADEST tenant mutation —
  // every project, and therefore every post, channel and template under it
  // leaves the caller's view at once — so it invalidates the union of the
  // tenant-scoped tags rather than a subset. The global tags (`providers`,
  // `static`, `rbac`, `roles`, `permissions`, `mfa`, `security`, `audit`,
  // `health`) are deliberately excluded: they describe surfaces that are not
  // owned by an account, so sweeping them would evict other tenants' entries
  // to no purpose. Several of these tags reach no live cache key today because
  // their GET configs are themselves unregistered (see
  // KNOWN_UNREGISTERED_CACHE_KEYS); listing them costs a no-op sweep now and is
  // already correct on the day those configs are fixed.
  "DELETE:/accounts/:accountId": [
    "projects",
    "posts",
    "channels",
    "templates",
    "users",
    "analytics",
    "realtime",
    "dashboard",
  ],
  "DELETE:/accounts/:accountId/hard": [
    "projects",
    "posts",
    "channels",
    "templates",
    "users",
    "analytics",
    "realtime",
    "dashboard",
  ],

  // Channel mutations
  "POST:/channels": ["channels", "dashboard"],
  "PUT:/channels/:channelId": ["channels"],
  "DELETE:/channels/:channelId": ["channels", "dashboard"],

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
 * - Query parameters (if specified in varyBy)
 * - Headers (if specified in varyBy)
 * - User context (always included for authenticated requests)
 */
export function generateApiCacheKey(
  method: string,
  route: string,
  params: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  userId?: string
): string {
  const config = getCacheConfig(method, route);

  if (!config) {
    return `api:${method}:${route}`;
  }

  const keyParts: string[] = [`api`, method, route];

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

  // Always include user ID for authenticated requests
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
