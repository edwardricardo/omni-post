/**
 * @file autoCacheMiddleware.ts
 * @description Fastify plugin that automatically applies caching to GET requests and
 *              cache invalidation to mutations based on route-level cache configuration.
 *              Consumes the canonical `CachePort` (not the concrete RedisCacheManager) so
 *              the application-tier surface matches the rest of the repo.
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { CachePort } from "@ports/core";
import {
  CACHE_CONFIG,
  getCacheConfig,
  getInvalidationTags,
  generateApiCacheKey,
} from "../lib/cache/cacheConfig.js";
import {
  assertCacheRoutesCovered,
  assertCachedResponsesVaryByPrincipal,
  cacheRuleKeysByMap,
  KNOWN_UNREGISTERED_CACHE_KEYS,
  type RegisteredRoute,
} from "../lib/cache/cacheRouteCoverage.js";
import { createLogger } from "../lib/logger.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { requireCustomerOrAdminAuth } from "../auth/customerOrAdminAuth.js";
import { integrationAuthBind, integrationAuthResolve } from "../auth/integrationAuthMiddleware.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";

const logger = createLogger("auto-cache-middleware");

/**
 * The hooks that authenticate a caller, compared by identity. A route that
 * carries one of them answers each caller with that caller's data, so its cached
 * response must be keyed by the caller: a HIT is sent before the route's handler
 * runs, and with it every check the handler makes, such as the ownership of the
 * resource, is skipped.
 */
const AUTHENTICATING_HOOKS: ReadonlySet<unknown> = new Set<unknown>([
  requireClientAuth,
  requireAdminAuth,
  requireCustomerOrAdminAuth,
  integrationAuthResolve,
  integrationAuthBind,
]);

/** The route lifecycle stages that run before the handler and may authenticate. */
const PRE_HANDLER_STAGES = ["onRequest", "preParsing", "preValidation", "preHandler"] as const;

/** The part of a route's options this plugin reads: its own pre-handler hooks. */
type RoutePreHandlerHooks = Partial<Record<(typeof PRE_HANDLER_STAGES)[number], unknown>>;

/**
 * @method carriesAuthenticatingHook
 * @description Reads a route's own pre-handler hooks, as `onRoute` receives them, and
 *   reports whether one of them is an authenticating hook.
 * @param routeOptions - The options of the route being registered
 * @returns True when a route-level hook authenticates the caller
 */
function carriesAuthenticatingHook(routeOptions: RoutePreHandlerHooks): boolean {
  return PRE_HANDLER_STAGES.some((stage) => {
    const hooks: unknown = routeOptions[stage];
    const list: readonly unknown[] = Array.isArray(hooks)
      ? hooks
      : hooks === undefined
        ? []
        : [hooks];
    return list.some((hook) => AUTHENTICATING_HOOKS.has(hook));
  });
}

/** A response as the `onSend` hook stores it under its cache key. */
interface CachedResponse {
  body: unknown;
  headers?: Record<string, string>;
  statusCode?: number;
}

/**
 * Headers a HIT never copies from the cached response: a cookie belongs to the
 * response that set it, never to a later one.
 */
const NEVER_REPLAYED_HEADERS: ReadonlySet<string> = new Set(["set-cookie"]);

/**
 * @method servesFromCache
 * @description Tells whether the GET responses of a route are read from the cache: the
 *   route has an enabled GET rule and no excluded fragment appears in its pattern.
 * @param url - The route pattern as Fastify registers it
 * @param excludeRoutes - The route fragments the plugin never caches
 * @returns True when the route's GET responses are read from the cache
 */
function servesFromCache(url: string, excludeRoutes: readonly string[]): boolean {
  if (excludeRoutes.some((excluded) => url.includes(excluded))) {
    return false;
  }
  return getCacheConfig("GET", url)?.enabled === true;
}

/**
 * @method withHookAppended
 * @description Returns a route's hook list with one hook added at its end, whatever form
 *   the route declared it in: absent, one function or an array.
 * @param existing - The route's own hooks for one lifecycle stage
 * @param hook - The hook to run after them
 * @returns The new hook list, the given hook last
 */
function withHookAppended<T>(existing: T | readonly T[] | undefined, hook: T): T[] {
  if (existing === undefined) {
    return [hook];
  }
  return Array.isArray(existing) ? [...(existing as readonly T[]), hook] : [existing as T, hook];
}

/**
 * @method createCacheReadHook
 * @description Builds the pre-handler that answers a GET request from the cache. On a HIT
 *   it replays the cached status, body and those cached headers the current reply does not
 *   already carry, so the headers of this request (its correlation id, its rate-limit
 *   state) are never replaced by the ones of the request that filled the cache. On a MISS
 *   it leaves the key on the request for the `onSend` hook to store the response under.
 *   Exported for its unit tests; the plugin is its only production caller.
 * @param cache - The cache port to read from
 * @param logCacheOps - Whether to log hits and read errors
 * @returns The pre-handler hook
 */
export function createCacheReadHook(
  cache: CachePort,
  logCacheOps: boolean
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  return async (request, reply) => {
    if (request.method !== "GET") {
      return undefined;
    }

    // Without a route pattern there is no rule to look up, and the raw path would build a
    // different key, so the request is answered as uncached.
    const route = request.routeOptions.url;
    if (route === undefined) {
      return undefined;
    }
    const config = getCacheConfig("GET", route);
    if (!config || !config.enabled) {
      return undefined;
    }

    try {
      const params = request.params as Record<string, unknown>;
      const query = request.query as Record<string, unknown>;
      const userId = request.user?.id;

      const cacheKey = generateApiCacheKey("GET", route, params, query, request.headers, userId);

      // CachePort.get returns `T | null`; null is a miss.
      const cached = await cache.get<CachedResponse>(cacheKey);

      if (cached === null) {
        request._cacheKey = cacheKey;
        request._cacheConfig = config;
        return undefined;
      }

      if (logCacheOps) {
        logger.debug(`Cache HIT: ${cacheKey}`);
      }

      for (const [name, value] of Object.entries(cached.headers ?? {})) {
        if (!NEVER_REPLAYED_HEADERS.has(name.toLowerCase()) && !reply.hasHeader(name)) {
          reply.header(name, value);
        }
      }
      reply.header("X-Cache", "HIT");
      reply.header("X-Cache-Key", cacheKey);
      reply.header("X-Cache-Tags", config.tags?.join(",") || "");

      return reply.code(cached.statusCode || 200).send(cached.body);
    } catch (error: unknown) {
      // A cache that cannot be read is a MISS: the route answers as if uncached.
      if (logCacheOps) {
        logger.debug(`Cache read error: ${error}`);
      }
      return undefined;
    }
  };
}

/**
 * Auto-cache plugin options
 */
export interface AutoCacheOptions {
  /**
   * Cache port instance to use for caching operations.
   * If not provided, the plugin reads from `fastify.cache` (decorated at app
   * boot from the DI container's `TOKENS.CachePort`).
   */
  cache?: CachePort;

  /**
   * Enable automatic caching for GET requests
   */
  enableCaching?: boolean;

  /**
   * Enable automatic invalidation for mutations
   */
  enableInvalidation?: boolean;

  /**
   * Custom routes to exclude from auto-caching
   */
  excludeRoutes?: string[];

  /**
   * Log cache operations
   */
  logCacheOps?: boolean;

  /**
   * Declares that this app mounts the COMPLETE route surface, which lets the
   * boot-time guard also reject rule keys that match no route under any
   * spelling. Only the composition root can make that claim; a partial test app
   * legitimately mounts a handful of routes, and treating its absent routes as
   * dead rules would be a false positive.
   *
   * The parameter-rename half of the guard runs regardless — it fires only when
   * a colliding route proves the endpoint exists, so it is sound everywhere.
   */
  assertRuleCoverage?: boolean;
}

/**
 * Fastify plugin for automatic caching
 *
 * Automatically caches GET requests and invalidates cache on mutations
 * based on the cache configuration in cacheConfig.ts
 */
const autoCachePluginImpl: FastifyPluginAsync<AutoCacheOptions> = async (fastify, options) => {
  const {
    enableCaching = true,
    enableInvalidation = true,
    excludeRoutes = [],
    logCacheOps = false,
    assertRuleCoverage = false,
  } = options;

  const cache = options.cache ?? fastify.cache;

  // The cache read, built only when there is a cache to read. `onRoute` appends it
  // as the LAST pre-handler of every route a GET rule caches, so a HIT is sent only
  // after every hook the route runs has admitted the request: its authentication,
  // its schema validation, the rate limit, the audit. A global `onRequest` read
  // would answer before all of them, which is how a cached response once reached
  // callers the route refuses.
  const readFromCache =
    enableCaching && cache !== undefined ? createCacheReadHook(cache, logCacheOps) : undefined;

  // Structural guards, wired BEFORE the cache check so they still run when caching
  // is unavailable: whether the rule keys describe real routes is a property of
  // the configuration, not of Redis being up.
  //
  // `onRoute` sees every route registered AFTER this plugin. That is the whole
  // business surface: the plugin is registered in `createApp` ahead of every
  // route plugin, and it reads the same `routeOptions.url` spelling the
  // invalidation hook looks rules up by — so the guard compares the exact
  // strings that decide, at request time, whether a mutation invalidates
  // anything at all. A route registered before the plugin is neither checked nor
  // read from the cache; the orphan check of `createApp` proves no cached rule's
  // route is one of them.
  const registeredRoutes: RegisteredRoute[] = [];

  fastify.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    const authenticated = carriesAuthenticatingHook(routeOptions);
    for (const method of methods) {
      registeredRoutes.push({ method, url: routeOptions.url, authenticated });
    }

    if (
      readFromCache !== undefined &&
      methods.includes("GET") &&
      servesFromCache(routeOptions.url, excludeRoutes)
    ) {
      routeOptions.preHandler = withHookAppended(routeOptions.preHandler, readFromCache);
    }
  });

  // The principal guard runs on every app, partial or complete: a rule whose
  // route this app registers caches that route's responses here, so whether the
  // key names the caller is decidable without the rest of the surface.
  fastify.addHook("onReady", async () => {
    assertCacheRoutesCovered({
      registered: registeredRoutes,
      keysByMap: cacheRuleKeysByMap(),
      baseline: KNOWN_UNREGISTERED_CACHE_KEYS,
      checkOrphans: assertRuleCoverage,
    });
    assertCachedResponsesVaryByPrincipal({ registered: registeredRoutes, rules: CACHE_CONFIG });
  });

  if (!cache) {
    logger.warn("Cache port not available, auto-cache plugin disabled");
    return;
  }

  logger.info(
    `Auto-cache plugin enabled (caching: ${enableCaching}, invalidation: ${enableInvalidation})`
  );

  if (enableCaching) {
    /**
     * Response hook for caching successful GET responses.
     * Uses callback-based onSend (NOT async) to avoid Fastify 5 wrapThenable race.
     */
    fastify.addHook(
      "onSend",
      (
        request: FastifyRequest,
        reply: FastifyReply,
        payload: unknown,
        done: (err?: Error | null, value?: unknown) => void
      ) => {
        const cacheKey = request._cacheKey;
        const config = request._cacheConfig;

        if (!cacheKey || !config) {
          done(null, payload);
          return;
        }

        // Only cache successful responses
        if (reply.statusCode < 200 || reply.statusCode >= 300) {
          done(null, payload);
          return;
        }

        // Add cache metadata headers BEFORE calling done (headers must be set before the response is sent)
        reply.header("X-Cache", "MISS");
        reply.header("X-Cache-Key", cacheKey);
        reply.header("X-Cache-Tags", config.tags?.join(",") || "");

        // Prepare cache data
        const cacheData = {
          body: payload,
          headers: reply.getHeaders(),
          statusCode: reply.statusCode,
        };

        // Cache the response in the background (fire-and-forget) — do NOT block done()
        cache
          .set(cacheKey, cacheData, {
            ...(config.ttl !== undefined && { ttlSeconds: config.ttl }),
            ...(config.tags !== undefined && { tags: config.tags }),
          })
          .then(() => {
            if (logCacheOps) {
              logger.debug(
                `Cache MISS (cached): ${cacheKey} (ttl: ${config.ttl}, tags: ${config.tags?.join(",")})`
              );
            }
          })
          .catch((error: unknown) => {
            logger.error(`Cache write error: ${error}`);
          });

        // Call done immediately — headers are already set above
        done(null, payload);
        return;
      }
    );
  }

  /**
   * Response hook for invalidating cache on mutations
   */
  if (enableInvalidation) {
    fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
      // Only invalidate on mutation methods
      if (!["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
        return;
      }

      // Only invalidate on successful responses
      if (reply.statusCode < 200 || reply.statusCode >= 300) {
        return;
      }

      const route = request.routeOptions.url || request.url;
      const tags = getInvalidationTags(request.method, route);

      if (tags.length === 0) {
        return;
      }

      try {
        // Invalidate asynchronously (don't block response)
        const invalidationPromises = tags.map((tag) => cache.invalidateByTag(tag));

        await Promise.all(invalidationPromises);

        if (logCacheOps) {
          logger.info(
            `Cache invalidated: ${tags.join(", ")} (method: ${request.method}, route: ${route})`
          );
        }
      } catch (error: unknown) {
        logger.error(`Cache invalidation error: ${error}`);
        // Don't fail the request if invalidation fails
      }
    });
  }
};

// Wrap with fastify-plugin to break encapsulation and make hooks apply globally
export const autoCachePlugin = fp(autoCachePluginImpl, {
  name: "auto-cache-plugin",
});
