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
  getCacheConfig,
  getInvalidationTags,
  generateApiCacheKey,
} from "../lib/cache/cacheConfig.js";
import {
  assertCacheRoutesCovered,
  cacheRuleKeysByMap,
  KNOWN_UNREGISTERED_CACHE_KEYS,
  type RegisteredRoute,
} from "../lib/cache/cacheRouteCoverage.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("auto-cache-middleware");

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

  // Structural guard, wired BEFORE the cache check so it still runs when caching
  // is unavailable: whether the rule keys describe real routes is a property of
  // the configuration, not of Redis being up.
  //
  // `onRoute` sees every route registered AFTER this plugin. That is the whole
  // business surface: the plugin is registered in `createApp` ahead of every
  // route plugin, and it reads the same `routeOptions.url` spelling the
  // invalidation hook looks rules up by — so the guard compares the exact
  // strings that decide, at request time, whether a mutation invalidates
  // anything at all.
  const registeredRoutes: RegisteredRoute[] = [];

  fastify.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      registeredRoutes.push({ method, url: routeOptions.url });
    }
  });

  fastify.addHook("onReady", async () => {
    assertCacheRoutesCovered({
      registered: registeredRoutes,
      keysByMap: cacheRuleKeysByMap(),
      baseline: KNOWN_UNREGISTERED_CACHE_KEYS,
      checkOrphans: assertRuleCoverage,
    });
  });

  const cache = options.cache ?? fastify.cache;

  if (!cache) {
    logger.warn("Cache port not available, auto-cache plugin disabled");
    return;
  }

  logger.info(
    `Auto-cache plugin enabled (caching: ${enableCaching}, invalidation: ${enableInvalidation})`
  );

  /**
   * Pre-handler hook for caching GET requests
   */
  if (enableCaching) {
    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      // Only cache GET requests
      if (request.method !== "GET") {
        return;
      }

      const route = request.routeOptions.url || request.url;

      // Check if route is excluded
      if (excludeRoutes.some((excluded) => route.includes(excluded))) {
        return;
      }

      // Get cache configuration
      const config = getCacheConfig("GET", route);

      if (!config || !config.enabled) {
        return;
      }

      try {
        // Generate cache key
        const params = request.params as Record<string, unknown>;
        const query = request.query as Record<string, unknown>;
        const headers = request.headers as Record<string, string>;
        const userId = request.user?.id;

        const cacheKey = generateApiCacheKey("GET", route, params, query, headers, userId);

        // Try to get from cache. CachePort.get returns `T | null` — null is a miss.
        const cached = await cache.get<{
          body: unknown;
          headers?: Record<string, string>;
          statusCode?: number;
        }>(cacheKey);

        if (cached !== null) {
          if (logCacheOps) {
            logger.debug(`Cache HIT: ${cacheKey}`);
          }

          const { body, headers: cachedHeaders, statusCode } = cached;

          // Set cached headers
          if (cachedHeaders) {
            for (const [key, value] of Object.entries(cachedHeaders)) {
              reply.header(key, value as string);
            }
          }

          // Add cache metadata headers
          reply.header("X-Cache", "HIT");
          reply.header("X-Cache-Key", cacheKey);
          reply.header("X-Cache-Tags", config.tags?.join(",") || "");

          // Send cached response
          reply.code(statusCode || 200).send(body);
          return;
        }

        // Cache miss — store key for use in response hook
        request._cacheKey = cacheKey;
        request._cacheConfig = config;
      } catch (error: unknown) {
        // Continue without cache on error
        if (logCacheOps) {
          logger.debug(`Cache read error: ${error}`);
        }
      }
    });

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
