/**
 * API Response Caching Configuration
 *
 * Defines caching strategies for API endpoints to improve response times
 * and reduce database load for frequently accessed resources.
 *
 * Performance Targets:
 * - Providers list: 200ms → 5-10ms (95% improvement)
 * - Templates list: 300ms → 10-20ms (93% improvement)
 * - Analytics dashboard: 500-1000ms → 20-50ms (95% improvement)
 * - User profile: 150ms → 5-10ms (93% improvement)
 */

import { CacheTTL, RouteCacheOptions } from "@adapters/cache-redis";

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
  params: Record<string, any> = {},
  query: Record<string, any> = {},
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
