/**
 * @file cacheConfig.ts
 * @description Defines per-endpoint caching strategies (TTL, tags, varyBy) for API
 *              response caching via Redis. Includes cache key generation and invalidation helpers.
 * @layer infrastructure
 */

import { createHash } from "node:crypto";
import { CacheTTL, type CacheOptions } from "@adapters/cache-redis";

/**
 * The vary parameter that names the caller in a cache key. Every authenticating
 * hook of this API (`requireClientAuth`, `requireAdminAuth`,
 * `requireCustomerOrAdminAuth`, the integration-key hooks) reads the caller's
 * credential from the `Authorization` header, so this is the one value that
 * tells two callers apart before any of them has run.
 */
export const PRINCIPAL_VARY_PARAM = "header:authorization";

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
   * Declares that the route serves the same response to every caller, with or
   * without credentials, so its key may leave the caller out. A cached GET rule
   * that does not vary by `PRINCIPAL_VARY_PARAM` must declare it, and the boot
   * guard in `cacheRouteCoverage.ts` refuses the declaration on a route that
   * carries an authenticating hook.
   */
  public?: boolean;
}

/**
 * Cache configuration for specific API endpoints.
 *
 * The cache answers a HIT from a global `onRequest` hook, so on a hit no route
 * hook runs: not `requireClientAuth`, not `requireAdminAuth`, not the ownership
 * check of the handler. A rule whose route authenticates MUST therefore carry
 * `PRINCIPAL_VARY_PARAM` (`header:authorization`) in its `varyBy` (CWE-639,
 * CWE-306): it is the only caller-discriminating value available before those
 * hooks parse the principal, and without it the key is caller-agnostic, so the
 * first caller's response is served to every other caller sending the same
 * request, another tenant or one with no credentials. A rule without it must
 * declare `public: true`. `assertCachedResponsesVaryByPrincipal` enforces both at
 * boot, and `generateApiCacheKey` stores a digest of the header, never its value.
 */
export const CACHE_CONFIG: Record<string, RouteCacheOptions> = {
  // Provider endpoints (rarely change, cache aggressively). `/providers` is the
  // one public route here; the others sit behind `requireClientAuth`.
  "GET:/providers": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [],
    public: true,
  },
  "GET:/providers/active": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [PRINCIPAL_VARY_PARAM],
  },
  "GET:/providers/by-capability/:capability": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [PRINCIPAL_VARY_PARAM, "capability"],
  },
  "GET:/providers/:id": {
    enabled: true,
    ttl: CacheTTL.LONG, // 1 hour
    tags: ["providers", "static"],
    varyBy: [PRINCIPAL_VARY_PARAM, "id"],
  },
  "GET:/providers/health/all": {
    enabled: true,
    ttl: CacheTTL.SHORT, // 5 minutes (health status changes)
    tags: ["providers", "health"],
    varyBy: [PRINCIPAL_VARY_PARAM],
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
    varyBy: [PRINCIPAL_VARY_PARAM, "query:projectId", "query:timeRange", "query:metrics"],
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

  // Post endpoints (frequently accessed, moderate changes). Behind
  // `requireClientAuth`, so the caller is part of the key (see above).
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
 * @method getCacheConfig
 * @description Looks up the cache rule of a route by its method and registered pattern.
 * @param method - The HTTP method
 * @param route - The route pattern as Fastify registered it
 * @returns The rule, or `undefined` when the route has none
 */
export function getCacheConfig(method: string, route: string): RouteCacheOptions | undefined {
  const key = `${method}:${route}`;
  return CACHE_CONFIG[key];
}

/**
 * @method getInvalidationTags
 * @description Looks up the cache tags a successful mutation of a route invalidates.
 * @param method - The HTTP method of the mutation
 * @param route - The route pattern as Fastify registered it
 * @returns The tags to invalidate, empty when the mutation has no rule
 */
export function getInvalidationTags(method: string, route: string): string[] {
  const key = `${method}:${route}`;
  return CACHE_INVALIDATION_RULES[key] || [];
}

/**
 * @method shouldCacheRoute
 * @description Tells whether the responses of a route are cached: only a GET route with an
 *   enabled rule is.
 * @param method - The HTTP method
 * @param route - The route pattern as Fastify registered it
 * @returns True when the route has an enabled GET rule
 */
export function shouldCacheRoute(method: string, route: string): boolean {
  // Only cache GET requests
  if (method !== "GET") {
    return false;
  }

  const config = getCacheConfig(method, route);
  return config?.enabled === true;
}

/** Hex characters of the sha256 digest a header value is reduced to in a key. */
const HEADER_DIGEST_HEX_LENGTH = 32;

/** The key segment value of a vary header the request did not send. */
const ABSENT_HEADER_MARK = "absent";

/**
 * @method digestHeaderValue
 * @description Reduces a header value to the form a cache key may carry. The key is a
 *   Redis key name, is echoed in `X-Cache-Key` and is listed by `GET /cache/hot-keys`,
 *   so a credential written into it verbatim is a credential published to everyone who
 *   can read any of the three. An unsalted digest is enough because the values hashed
 *   here are bearer tokens, high-entropy signed strings nobody can enumerate; 32 hex
 *   characters (128 bits) keep two callers' keys apart while keeping key names short.
 *   The `sha256-` prefix names the scheme and holds no key delimiter.
 * @param value - The raw header value
 * @returns `sha256-` followed by the first 32 hex characters of the value's sha256 digest
 */
function digestHeaderValue(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256-${digest.slice(0, HEADER_DIGEST_HEX_LENGTH)}`;
}

/**
 * @method encodeKeyValue
 * @description Escapes a caller-supplied query or path value before it enters a key, so
 *   a value carrying the `:` delimiter or `=` cannot pose as further key segments and
 *   make two different requests share one cache entry.
 * @param value - The raw query or path parameter value
 * @returns The value, URI-component encoded
 */
function encodeKeyValue(value: unknown): string {
  return encodeURIComponent(String(value));
}

/**
 * @method generateApiCacheKey
 * @description Builds the cache key of a GET response from its method, its route
 *   pattern, the vary parameters of its rule and the user context. A query or path value
 *   enters URI-encoded; a header enters as a sha256 digest of its value, or as `absent`
 *   when the request did not send it, so a request without credentials never shares a
 *   key with one that sent some.
 * @param method - The HTTP method
 * @param route - The route pattern as Fastify registered it
 * @param params - The parsed path parameters
 * @param query - The parsed query string
 * @param headers - The request headers, names lowercased as Node delivers them
 * @param userId - The authenticated user id, when the caller already resolved one
 * @returns The cache key; `api:<method>:<route>` for a route with no cache rule
 */
export function generateApiCacheKey(
  method: string,
  route: string,
  params: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
  headers: Readonly<Record<string, string | string[] | undefined>> = {},
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
          keyParts.push(`${queryParam}=${encodeKeyValue(value)}`);
        }
      } else if (varyParam.startsWith("header:")) {
        const headerName = varyParam.replace("header:", "");
        const raw = headers[headerName];
        const value = Array.isArray(raw) ? raw.join(",") : raw;
        keyParts.push(`${headerName}=${value ? digestHeaderValue(value) : ABSENT_HEADER_MARK}`);
      } else if (params[varyParam]) {
        // Path parameter
        keyParts.push(`${varyParam}=${encodeKeyValue(params[varyParam])}`);
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
