import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { RedisCacheManager } from "./cache-manager.js";
import type { CacheOptions } from "./types.js";
import { CacheTTL } from "./constants.js";
import { createHash } from "crypto";
import pino from "pino";

const logger = pino({
  name: "cache-middleware",
  level: process.env.LOG_LEVEL || "info",
});

export interface CacheMiddlewareOptions {
  cacheManager: RedisCacheManager;
  defaultTtl?: number;
  keyGenerator?: (request: FastifyRequest) => string;
  shouldCache?: (request: FastifyRequest, reply: FastifyReply) => boolean;
  varyHeaders?: string[]; // Headers to include in cache key
}

export interface RouteCacheOptions extends CacheOptions {
  enabled?: boolean;
  keyPattern?: string;
  varyBy?: string[]; // Query params or headers to vary cache by
  invalidateOn?: string[]; // Events that should invalidate this cache
}

/**
 * Generate cache key for HTTP request
 */
function generateCacheKey(
  request: FastifyRequest,
  options: CacheMiddlewareOptions,
  routeOptions?: RouteCacheOptions
): string {
  if (options.keyGenerator) {
    return options.keyGenerator(request);
  }

  // Base key from route
  let baseKey = `api:${request.method}:${request.url}`;

  if (routeOptions?.keyPattern) {
    baseKey = routeOptions.keyPattern
      .replace(":method", request.method)
      .replace(":url", request.url)
      .replace(":route", request.routeOptions.url || request.url);
  }

  // Add vary-by parameters
  const varyParts: string[] = [];

  if (routeOptions?.varyBy) {
    for (const param of routeOptions.varyBy) {
      if (param.startsWith("header:")) {
        const headerName = param.replace("header:", "");
        const headerValue = request.headers[headerName];
        if (headerValue) {
          varyParts.push(`${param}:${headerValue}`);
        }
      } else if (param.startsWith("query:")) {
        const queryName = param.replace("query:", "");
        const queryValue = (request.query as Record<string, string | undefined>)?.[queryName];
        if (queryValue) {
          varyParts.push(`${param}:${queryValue}`);
        }
      } else {
        // Assume it's a query parameter
        const queryValue = (request.query as Record<string, string | undefined>)?.[param];
        if (queryValue) {
          varyParts.push(`${param}:${queryValue}`);
        }
      }
    }
  }

  // Add vary headers from middleware options
  if (options.varyHeaders) {
    for (const headerName of options.varyHeaders) {
      const headerValue = request.headers[headerName];
      if (headerValue) {
        varyParts.push(`header:${headerName}:${headerValue}`);
      }
    }
  }

  // Add user context if available
  if (request.user?.id) {
    varyParts.push(`user:${request.user.id}`);
  }

  // Create final key
  if (varyParts.length > 0) {
    const varyHash = createHash("md5").update(varyParts.join("|")).digest("hex");
    return `${baseKey}:${varyHash}`;
  }

  return baseKey;
}

/**
 * Check if request should be cached
 */
function shouldCacheRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: CacheMiddlewareOptions,
  routeOptions?: RouteCacheOptions
): boolean {
  // Check route-specific cache enabled flag
  if (routeOptions?.enabled === false) {
    return false;
  }

  // Only cache GET requests by default
  if (request.method !== "GET") {
    return false;
  }

  // Don't cache if there's an authorization header (unless specifically allowed)
  if (request.headers.authorization && !routeOptions?.enabled) {
    return false;
  }

  // Check custom shouldCache function
  if (options.shouldCache) {
    return options.shouldCache(request, reply);
  }

  // Cache successful responses by default
  return reply.statusCode >= 200 && reply.statusCode < 300;
}

/**
 * Fastify plugin for response caching.
 * Wrapped with fastify-plugin to remove encapsulation scope — hooks and
 * decorators are available to the parent Fastify instance and all routes.
 */
const cachePluginImpl: FastifyPluginAsync<CacheMiddlewareOptions> = async (fastify, options) => {
  const { cacheManager } = options;

  // Add cache manager to fastify instance
  fastify.decorate("cache", cacheManager);

  // Add route-level cache decorator
  fastify.addHook("onRoute", (routeOptions) => {
    const cacheOptions = (routeOptions as { cache?: RouteCacheOptions }).cache;
    if (cacheOptions) {
      (routeOptions as { _cacheOptions?: RouteCacheOptions })._cacheOptions = cacheOptions;
    }
  });

  // Add caching hooks
  fastify.addHook("onRequest", async (request, reply) => {
    const routeCacheOptions = (request.routeOptions as { _cacheOptions?: RouteCacheOptions })
      ?._cacheOptions;

    // Skip if caching is disabled for this route
    if (routeCacheOptions?.enabled === false) {
      return;
    }

    // Only handle GET requests
    if (request.method !== "GET") {
      return;
    }

    try {
      const cacheKey = generateCacheKey(request, options, routeCacheOptions);
      const cached = await cacheManager.get(cacheKey);

      if (cached.ok && cached.value) {
        const { body, headers, statusCode } = cached.value;

        // Set cached headers
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            reply.header(key, value);
          }
        }

        // Add cache hit header
        reply.header("X-Cache", "HIT");
        reply.header("X-Cache-Key", cacheKey);

        // Send cached response
        reply.code(statusCode || 200).send(body);
        return;
      }

      // Store cache key for use in response hook
      request._cacheKey = cacheKey;
      request._routeCacheOptions = routeCacheOptions;
    } catch (error: unknown) {
      logger.error(`Cache read error: ${error}`);
      // Continue without cache on error
    }
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
    const cacheKey = request._cacheKey;
    const routeCacheOptions = request._routeCacheOptions as RouteCacheOptions | undefined;

    // Skip if no cache key or caching not applicable
    if (!cacheKey || !shouldCacheRequest(request, reply, options, routeCacheOptions)) {
      return payload;
    }

    try {
      // Prepare cache data
      const cacheData = {
        body: payload,
        headers: reply.getHeaders(),
        statusCode: reply.statusCode,
      };

      // Determine TTL
      const ttl = routeCacheOptions?.ttl || options.defaultTtl || CacheTTL.MEDIUM;

      // Cache the response
      const cacheOptions: CacheOptions = {
        ttl,
        ...(routeCacheOptions?.tags ? { tags: routeCacheOptions.tags } : {}),
        ...(routeCacheOptions?.version ? { version: routeCacheOptions.version } : {}),
      };

      await cacheManager.set(cacheKey, cacheData, cacheOptions);

      // Add cache miss header
      reply.header("X-Cache", "MISS");
      reply.header("X-Cache-Key", cacheKey);

      logger.debug(`Cached response for key: ${cacheKey} (TTL: ${ttl}s)`);
    } catch (error: unknown) {
      logger.error(`Cache write error: ${error}`);
      // Continue without caching on error
    }

    return payload;
  });
};

// fp() removes encapsulation — hooks become available to parent scope
export const cachePlugin = fp(cachePluginImpl, {
  name: "omnipost-cache",
  fastify: "5.x",
});

/**
 * Cache invalidation helpers
 */
export class CacheInvalidator {
  constructor(private cacheManager: RedisCacheManager) {}

  /**
   * Invalidate cache for specific user
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.cacheManager.invalidateByTag(`user:${userId}`);
    await this.cacheManager.invalidateByPattern(`*user:${userId}*`);
  }

  /**
   * Invalidate cache for specific post
   */
  async invalidatePost(postId: string): Promise<void> {
    await this.cacheManager.invalidateByTag(`post:${postId}`);
    await this.cacheManager.invalidateByPattern(`*post:${postId}*`);
  }

  /**
   * Invalidate cache for specific project
   */
  async invalidateProject(projectId: string): Promise<void> {
    await this.cacheManager.invalidateByTag(`project:${projectId}`);
    await this.cacheManager.invalidateByPattern(`*project:${projectId}*`);
  }

  /**
   * Invalidate API cache by endpoint pattern
   */
  async invalidateApiEndpoint(pattern: string): Promise<void> {
    await this.cacheManager.invalidateByPattern(`api:*${pattern}*`);
  }

  /**
   * Invalidate all analytics cache
   */
  async invalidateAnalytics(): Promise<void> {
    await this.cacheManager.invalidateByTag("analytics");
    await this.cacheManager.invalidateByPattern("analytics:*");
  }
}

// Type augmentation for Fastify
declare module "fastify" {
  interface FastifyInstance {
    cache?: RedisCacheManager;
  }

  interface RouteShorthandOptions {
    cache?: RouteCacheOptions;
  }
}
