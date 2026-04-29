/**
 * @file autoCacheMiddleware.ts
 * @description Fastify plugin that automatically applies caching to GET requests and
 *              cache invalidation to mutations based on route-level cache configuration.
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { RedisCacheManager } from "@adapters/cache-redis";
import {
  getCacheConfig,
  getInvalidationTags,
  generateApiCacheKey,
} from "../lib/cache/cacheConfig.js";
import pino from "pino";

const logger = pino({
  name: "auto-cache-middleware",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Auto-cache plugin options
 */
export interface AutoCacheOptions {
  /**
   * Cache manager instance to use for caching operations.
   * If not provided, the plugin will attempt to read from fastify.cacheManager.
   */
  cacheManager?: RedisCacheManager;

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
  } = options;

  const cacheManager = options.cacheManager ?? fastify.cacheManager ?? fastify.cache;

  if (!cacheManager) {
    logger.warn("Cache manager not available, auto-cache plugin disabled");
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

      // Skip if cache manager is unavailable (closed/disconnected)
      if (
        "isAvailable" in cacheManager &&
        typeof cacheManager.isAvailable === "function" &&
        !cacheManager.isAvailable()
      ) {
        return;
      }

      try {
        // Generate cache key
        const params = request.params as Record<string, unknown>;
        const query = request.query as Record<string, unknown>;
        const headers = request.headers as Record<string, string>;
        const userId = request.user?.id;

        const cacheKey = generateApiCacheKey("GET", route, params, query, headers, userId);

        // Try to get from cache
        const cached = await cacheManager.get(cacheKey);

        if (!cached.ok) {
          // Cache error - continue without cache, do NOT set _cacheKey
          if (logCacheOps) {
            logger.debug(`Cache error for key ${cacheKey}: ${cached.error}`);
          }
          return;
        }

        if (cached.value !== null) {
          // Cache hit
          if (logCacheOps) {
            logger.debug(`Cache HIT: ${cacheKey}`);
          }

          const {
            body,
            headers: cachedHeaders,
            statusCode,
          } = cached.value as {
            body: unknown;
            headers?: Record<string, string>;
            statusCode?: number;
          };

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

        // Cache miss (ok=true, value=null) - store key for use in response hook
        request._cacheKey = cacheKey;
        request._cacheConfig = config;
      } catch (error: unknown) {
        logger.error(`Cache read error: ${error}`);
        // Continue without cache on error
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
        cacheManager
          .set(cacheKey, cacheData, {
            ...(config.ttl !== undefined && { ttl: config.ttl }),
            ...(config.tags !== undefined && { tags: config.tags }),
            ...(config.version !== undefined && { version: config.version }),
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
        const invalidationPromises = tags.map((tag) => cacheManager.invalidateByTag(tag));

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

/**
 * Manual cache invalidation helper for use in route handlers
 *
 * Usage:
 * ```typescript
 * await invalidateCacheForRoute(request, 'POST', '/posts');
 * ```
 */
export async function invalidateCacheForRoute(
  request: FastifyRequest,
  method: string,
  route: string
): Promise<void> {
  const cacheManager = request.server.cache;

  if (!cacheManager) {
    logger.warn("Cache manager not available for invalidation");
    return;
  }

  const tags = getInvalidationTags(method, route);

  if (tags.length === 0) {
    return;
  }

  try {
    const invalidationPromises = tags.map((tag) => cacheManager.invalidateByTag(tag));
    await Promise.all(invalidationPromises);

    logger.info(`Manual cache invalidation: ${tags.join(", ")}`);
  } catch (error: unknown) {
    logger.error(`Manual cache invalidation failed: ${error}`);
  }
}

/**
 * Get current cache statistics
 */
export async function getCacheStats(request: FastifyRequest): Promise<{
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
  l1Hits: number;
  l2Hits: number;
} | null> {
  const cacheManager = request.server.cache;

  if (!cacheManager) {
    return null;
  }

  try {
    const statsResult = await cacheManager.getStats();

    if (!statsResult.ok) {
      return null;
    }

    const stats = statsResult.value;

    return {
      hitRate: stats.hitRate,
      totalKeys: stats.totalKeys,
      memoryUsage: stats.memoryUsage,
      l1Hits: stats.l1Hits,
      l2Hits: stats.l2Hits,
    };
  } catch (error: unknown) {
    logger.error(`Failed to get cache stats: ${error}`);
    return null;
  }
}
