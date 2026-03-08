/**
 * Cache Decorators and Helpers for API Routes
 *
 * Provides decorators and utility functions to easily add caching to route handlers
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { RedisCacheManager, CacheOptions } from "@adapters/cache-redis";
import { getInvalidationTags, generateApiCacheKey } from "./cacheConfig.js";
import pino from "pino";

const logger = pino({
  name: "cache-decorators",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Cache decorator options for route handlers
 */
export interface CacheableOptions extends CacheOptions {
  /**
   * Custom key generator function
   */
  keyGenerator?: (request: FastifyRequest) => string;

  /**
   * Custom condition to determine if response should be cached
   */
  shouldCache?: (request: FastifyRequest, reply: FastifyReply, data: any) => boolean;

  /**
   * Transform data before caching
   */
  transformBeforeCache?: (data: any) => any;

  /**
   * Transform data after retrieving from cache
   */
  transformAfterCache?: (data: any) => any;
}

/**
 * Cache a route handler's response
 *
 * Usage:
 * ```typescript
 * const handler = withCache(
 *   async (request, reply) => {
 *     const data = await expensiveOperation();
 *     return data;
 *   },
 *   { ttl: 300, tags: ['providers'] }
 * );
 * ```
 */
export function withCache<T = any>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>,
  options: CacheableOptions = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<T> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T> => {
    const cacheManager = request.server.cache;

    if (!cacheManager) {
      logger.warn("Cache manager not available, executing handler without cache");
      return handler(request, reply);
    }

    try {
      // Generate cache key
      const cacheKey = options.keyGenerator
        ? options.keyGenerator(request)
        : generateDefaultCacheKey(request);

      // Try to get from cache
      const cached = await cacheManager.get<T>(cacheKey);

      if (cached.ok && cached.value !== null) {
        logger.debug(`Cache HIT for key: ${cacheKey}`);
        reply.header("X-Cache", "HIT");
        reply.header("X-Cache-Key", cacheKey);

        // Transform data if needed
        const data = options.transformAfterCache
          ? options.transformAfterCache(cached.value)
          : cached.value;

        return data;
      }

      // Cache miss - execute handler
      logger.debug(`Cache MISS for key: ${cacheKey}`);
      reply.header("X-Cache", "MISS");
      reply.header("X-Cache-Key", cacheKey);

      const result = await handler(request, reply);

      // Check if we should cache this response
      if (options.shouldCache && !options.shouldCache(request, reply, result)) {
        return result;
      }

      // Transform before caching if needed
      const dataToCache = options.transformBeforeCache
        ? options.transformBeforeCache(result)
        : result;

      // Cache the result
      const cacheOptions: CacheOptions = {
        ...(options.ttl !== undefined && { ttl: options.ttl }),
        ...(options.tags !== undefined && { tags: options.tags }),
        ...(options.version !== undefined && { version: options.version }),
      };

      await cacheManager.set(cacheKey, dataToCache, cacheOptions);

      return result;
    } catch (error: unknown) {
      logger.error(`Cache operation failed: ${error}`);
      // Fall back to executing handler without cache
      return handler(request, reply);
    }
  };
}

/**
 * Invalidate cache when a mutation occurs
 *
 * Usage:
 * ```typescript
 * const handler = withInvalidation(
 *   async (request, reply) => {
 *     await updateResource();
 *     return { success: true };
 *   },
 *   { tags: ['posts', 'dashboard'] }
 * );
 * ```
 */
export function withInvalidation<T = any>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>,
  options: {
    tags?: string[];
    patterns?: string[];
    customInvalidation?: (request: FastifyRequest) => Promise<void>;
  } = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<T> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T> => {
    // Execute the handler first
    const result = await handler(request, reply);

    const cacheManager = request.server.cache;

    if (!cacheManager) {
      return result;
    }

    try {
      // Custom invalidation logic
      if (options.customInvalidation) {
        await options.customInvalidation(request);
      }

      // Invalidate by tags
      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await cacheManager.invalidateByTag(tag);
          logger.info(`Invalidated cache tag: ${tag}`);
        }
      }

      // Invalidate by patterns
      if (options.patterns && options.patterns.length > 0) {
        for (const pattern of options.patterns) {
          await cacheManager.invalidateByPattern(pattern);
          logger.info(`Invalidated cache pattern: ${pattern}`);
        }
      }

      // Auto-invalidate based on route configuration
      const method = request.method;
      const route = request.routeOptions.url || request.url;
      const autoTags = getInvalidationTags(method, route);

      if (autoTags.length > 0) {
        for (const tag of autoTags) {
          await cacheManager.invalidateByTag(tag);
          logger.info(`Auto-invalidated cache tag: ${tag}`);
        }
      }
    } catch (error: unknown) {
      logger.error(`Cache invalidation failed: ${error}`);
      // Don't fail the request if cache invalidation fails
    }

    return result;
  };
}

/**
 * Combine caching and invalidation
 *
 * Useful for endpoints that both read and write
 */
export function withCacheAndInvalidation<T = any>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>,
  cacheOptions: CacheableOptions = {},
  invalidationOptions: {
    tags?: string[];
    patterns?: string[];
  } = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<T> {
  const cachedHandler = withCache(handler, cacheOptions);
  return withInvalidation(cachedHandler, invalidationOptions);
}

/**
 * Generate default cache key from request
 */
export function generateDefaultCacheKey(request: FastifyRequest): string {
  const method = request.method;
  const route = request.routeOptions.url || request.url;
  const params = request.params as Record<string, any>;
  const query = request.query as Record<string, any>;
  const headers = request.headers as Record<string, string>;
  const userId = request.user?.id;

  return generateApiCacheKey(method, route, params, query, headers, userId);
}

/**
 * Cache helper for getOrSet pattern
 *
 * Usage:
 * ```typescript
 * const data = await cacheGetOrSet(
 *   cacheManager,
 *   'my-key',
 *   async () => await fetchData(),
 *   { ttl: 300 }
 * );
 * ```
 */
export async function cacheGetOrSet<T>(
  cacheManager: RedisCacheManager,
  key: string,
  factory: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const result = await cacheManager.getOrSet(key, factory, options);

  if (!result.ok) {
    throw new Error(`Cache operation failed: ${result.error}`);
  }

  return result.value;
}

/**
 * Batch cache invalidation helper
 *
 * Efficiently invalidates multiple cache keys/tags
 */
export async function batchInvalidate(
  cacheManager: RedisCacheManager,
  options: {
    tags?: string[];
    patterns?: string[];
    keys?: string[];
  }
): Promise<{ invalidatedCount: number }> {
  let invalidatedCount = 0;

  try {
    // Invalidate by tags
    if (options.tags) {
      for (const tag of options.tags) {
        const result = await cacheManager.invalidateByTag(tag);
        if (result.ok) {
          invalidatedCount += result.value;
        }
      }
    }

    // Invalidate by patterns
    if (options.patterns) {
      for (const pattern of options.patterns) {
        const result = await cacheManager.invalidateByPattern(pattern);
        if (result.ok) {
          invalidatedCount += result.value;
        }
      }
    }

    // Invalidate specific keys
    if (options.keys) {
      for (const key of options.keys) {
        await cacheManager.del(key);
        invalidatedCount++;
      }
    }

    logger.info(`Batch invalidation completed: ${invalidatedCount} cache entries invalidated`);

    return { invalidatedCount };
  } catch (error: unknown) {
    logger.error(`Batch invalidation failed: ${error}`);
    return { invalidatedCount };
  }
}

/**
 * Cache warming helper
 *
 * Pre-populate cache with frequently accessed data
 */
export async function warmCache(
  cacheManager: RedisCacheManager,
  warmupFunctions: Array<{
    key: string;
    factory: () => Promise<any>;
    options?: CacheOptions;
  }>
): Promise<{ warmedCount: number; failedCount: number }> {
  let warmedCount = 0;
  let failedCount = 0;

  for (const { key, factory, options } of warmupFunctions) {
    try {
      const result = await cacheManager.getOrSet(key, factory, options);
      if (result.ok) {
        warmedCount++;
        logger.debug(`Cache warmed for key: ${key}`);
      } else {
        failedCount++;
        logger.warn(`Cache warming failed for key: ${key}`);
      }
    } catch (error: unknown) {
      failedCount++;
      logger.error(`Cache warming error for key ${key}: ${error}`);
    }
  }

  logger.info(`Cache warming completed: ${warmedCount} succeeded, ${failedCount} failed`);

  return { warmedCount, failedCount };
}

/**
 * Get cache statistics helper
 */
export async function getCacheStatistics(cacheManager: RedisCacheManager): Promise<{
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
  l1Hits: number;
  l2Hits: number;
  hotKeys: Array<{ key: string; hits: number }>;
}> {
  const statsResult = await cacheManager.getStats();

  if (!statsResult.ok) {
    throw new Error("Failed to get cache statistics");
  }

  const stats = statsResult.value;

  return {
    hitRate: stats.hitRate,
    totalKeys: stats.totalKeys,
    memoryUsage: stats.memoryUsage,
    l1Hits: stats.l1Hits,
    l2Hits: stats.l2Hits,
    hotKeys: stats.hotKeys,
  };
}

/**
 * Create a cache invalidation middleware
 *
 * Automatically invalidates cache based on HTTP method
 */
export function createInvalidationMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Only invalidate on mutation methods
    if (!["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
      return;
    }

    const cacheManager = request.server.cache;

    if (!cacheManager) {
      return;
    }

    // Store original send function
    const originalSend = reply.send.bind(reply);

    // Override send to invalidate cache after successful response

    (reply as any).send = function (payload: unknown) {
      // Only invalidate on successful responses (2xx)
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        const method = request.method;
        const route = request.routeOptions.url || request.url;
        const tags = getInvalidationTags(method, route);

        if (tags.length > 0) {
          // Invalidate asynchronously (don't block response)
          Promise.all(tags.map((tag) => cacheManager.invalidateByTag(tag))).catch(
            (error: unknown) => {
              logger.error(`Auto-invalidation failed: ${error}`);
            }
          );
        }
      }

      return originalSend(payload);
    };
  };
}
