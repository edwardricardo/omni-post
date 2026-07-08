/**
 * @file index.ts
 * @description Fallback strategy manager providing CACHED_RESPONSE, STATIC_RESPONSE,
 *              DEGRADED_SERVICE, FAIL_GRACEFULLY, and RETRY_ALTERNATIVE strategies with Redis backing.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import pino from "pino";
import { Redis } from "ioredis";

const logger = pino({
  name: "fallback-strategies",
  level: process.env.LOG_LEVEL || "info",
});

export type FallbackStrategy =
  | "CACHED_RESPONSE"
  | "STATIC_RESPONSE"
  | "DEGRADED_SERVICE"
  | "FAIL_GRACEFULLY"
  | "RETRY_ALTERNATIVE";

export interface FallbackConfig {
  strategy: FallbackStrategy;
  cacheKey?: string;
  cacheTtl?: number; // milliseconds
  staticResponse?: unknown;
  alternativeEndpoint?: string;
  gracefulMessage?: string;
}

export interface FallbackContext {
  service: string;
  operation: string;
  originalError: Error;
  attempt: number;
  lastSuccessfulResponse?: unknown;
  /**
   * Opaque per-tenant/credential discriminant that scopes the L2 fallback store
   * key. PRESENT ⇒ the read is keyed `fallback:service:operation:<discriminant>`,
   * so one tenant's cached fallback payload is never served to another. ABSENT ⇒
   * the read is a fail-safe miss (no shared/legacy-key read), mirroring the L1
   * cache default in the circuit breaker.
   */
  discriminant?: string;
}

export class FallbackManager {
  private redis: Redis | null = null;
  private staticResponses: Map<string, unknown> = new Map();

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 3) return null; // Stop retrying after 3 attempts
          return Math.min(times * 100, 1000); // Exponential backoff with max 1s
        },
        enableReadyCheck: false,
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        // ioredis defaults: commandTimeout = null (forever), connectTimeout = 10000.
        // 5 s on each so a hung Redis fails fast instead of stalling fallback
        // lookups (which themselves run inside an already-degraded request).
        commandTimeout: 5_000,
        connectTimeout: 5_000,
      });

      this.redis.on("error", (error) => {
        logger.warn({ error: error.message }, "Redis connection error for fallback cache");
      });
    }
  }

  /**
   * Register a static fallback response for a specific operation
   */
  registerStaticFallback(service: string, operation: string, response: unknown): void {
    const key = `${service}:${operation}`;
    this.staticResponses.set(key, response);
    logger.info(`Registered static fallback for ${key}`);
  }

  /**
   * Execute fallback strategy based on configuration
   */
  async executeFallback<T>(
    config: FallbackConfig,
    context: FallbackContext
  ): Promise<Result<T, "FALLBACK_FAILED">> {
    const { service, operation, originalError } = context;

    logger.warn(
      {
        error: originalError.message,
        attempt: context.attempt,
      },
      `Executing fallback strategy ${config.strategy} for ${service}:${operation}`
    );

    try {
      switch (config.strategy) {
        case "CACHED_RESPONSE":
          return await this.getCachedResponse<T>(config, context);

        case "STATIC_RESPONSE":
          return this.getStaticResponse<T>(config, context);

        case "DEGRADED_SERVICE":
          return this.getDegradedResponse<T>(config, context);

        case "FAIL_GRACEFULLY":
          return this.failGracefully<T>(config, context);

        case "RETRY_ALTERNATIVE":
          return await this.retryAlternative<T>(config, context);

        default:
          logger.error(`Unknown fallback strategy: ${config.strategy}`);
          return err("FALLBACK_FAILED");
      }
    } catch (error: unknown) {
      logger.error({ error }, "Fallback strategy execution failed");
      return err("FALLBACK_FAILED");
    }
  }

  /**
   * @method cacheSuccessfulResponse
   * @description Persists a successful response to the L2 fallback store for later
   *   fallback use, keyed by the caller's tenant/credential discriminant. Fail-safe
   *   symmetry with the L1 breaker cache: a call WITHOUT a discriminant stores
   *   NOTHING — writing a shared `fallback:service:operation` entry would let one
   *   tenant's cached payload be served to another on the fallback path
   *   (cross-tenant disclosure). No discriminant ⇒ no write.
   * @param service - Provider/service name.
   * @param operation - Operation name.
   * @param response - The successful payload to cache.
   * @param ttl - Time-to-live in milliseconds (default 5 minutes).
   * @param discriminant - Opaque per-tenant/credential scope; omit ⇒ no write.
   * @returns Nothing; a no-op when Redis is unavailable or no discriminant is given.
   */
  async cacheSuccessfulResponse(
    service: string,
    operation: string,
    response: unknown,
    ttl: number = 300000, // 5 minutes default
    discriminant?: string
  ): Promise<void> {
    if (!this.redis) return;
    if (discriminant === undefined) return;

    const key = this.getCacheKey(service, operation, discriminant);
    const data = {
      response,
      timestamp: Date.now(),
      service,
      operation,
    };

    try {
      await this.redis.setex(key, Math.floor(ttl / 1000), JSON.stringify(data));
      logger.debug(`Cached successful response for ${service}:${operation}`);
    } catch (error: unknown) {
      logger.warn({ error }, "Failed to cache response");
    }
  }

  private async getCachedResponse<T>(
    config: FallbackConfig,
    context: FallbackContext
  ): Promise<Result<T, "FALLBACK_FAILED">> {
    if (!this.redis) {
      logger.warn("Redis not available for cached fallback");
      return err("FALLBACK_FAILED");
    }

    // Fail-safe symmetry with the write path: with no explicit key and no tenant
    // discriminant, treat the read as a MISS rather than reading a shared
    // `fallback:service:operation` key — that legacy key could hold another
    // tenant's payload (cross-tenant disclosure). No discriminant ⇒ fetch fresh.
    const key =
      config.cacheKey ??
      (context.discriminant !== undefined
        ? this.getCacheKey(context.service, context.operation, context.discriminant)
        : undefined);

    if (key === undefined) {
      logger.warn(
        `No discriminant for cached fallback ${context.service}:${context.operation} — skipping (fail-safe)`
      );
      return err("FALLBACK_FAILED");
    }

    try {
      const cached = await this.redis.get(key);
      if (!cached) {
        logger.warn(`No cached response found for ${key}`);
        return err("FALLBACK_FAILED");
      }

      const data = JSON.parse(cached);
      const age = Date.now() - data.timestamp;

      logger.info(
        `Using cached fallback response (age: ${age}ms) for ${context.service}:${context.operation}`
      );

      return ok(data.response as T);
    } catch (error: unknown) {
      logger.error({ error }, "Failed to retrieve cached fallback");
      return err("FALLBACK_FAILED");
    }
  }

  private getStaticResponse<T>(
    config: FallbackConfig,
    context: FallbackContext
  ): Result<T, "FALLBACK_FAILED"> {
    const staticResponse =
      config.staticResponse || this.staticResponses.get(`${context.service}:${context.operation}`);

    if (!staticResponse) {
      logger.warn(`No static fallback configured for ${context.service}:${context.operation}`);
      return err("FALLBACK_FAILED");
    }

    logger.info(`Using static fallback response for ${context.service}:${context.operation}`);
    return ok(staticResponse as T);
  }

  private getDegradedResponse<T>(
    config: FallbackConfig,
    context: FallbackContext
  ): Result<T, "FALLBACK_FAILED"> {
    // Return a minimal/degraded version of the expected response
    const degradedResponse = this.createDegradedResponse(context);

    if (!degradedResponse) {
      return err("FALLBACK_FAILED");
    }

    logger.info(`Using degraded service response for ${context.service}:${context.operation}`);
    return ok(degradedResponse as T);
  }

  private failGracefully<T>(
    config: FallbackConfig,
    context: FallbackContext
  ): Result<T, "FALLBACK_FAILED"> {
    const message = config.gracefulMessage || `Service temporarily unavailable: ${context.service}`;

    logger.info(`Failing gracefully for ${context.service}:${context.operation}: ${message}`);

    // Return a response that indicates graceful failure
    const gracefulResponse = {
      success: false,
      message,
      service: context.service,
      operation: context.operation,
      fallback: true,
    };

    return ok(gracefulResponse as T);
  }

  private async retryAlternative<T>(
    config: FallbackConfig,
    context: FallbackContext
  ): Promise<Result<T, "FALLBACK_FAILED">> {
    if (!config.alternativeEndpoint) {
      logger.warn(`No alternative endpoint configured for ${context.service}:${context.operation}`);
      return err("FALLBACK_FAILED");
    }

    try {
      logger.info(`Trying alternative endpoint for ${context.service}:${context.operation}`);

      // This would typically make a request to the alternative endpoint
      // For now, we'll return a placeholder response
      const alternativeResponse = {
        data: null,
        source: "alternative",
        message: "Retrieved from alternative endpoint",
      };

      return ok(alternativeResponse as T);
    } catch (error: unknown) {
      logger.error({ error }, "Alternative endpoint also failed");
      return err("FALLBACK_FAILED");
    }
  }

  private createDegradedResponse(context: FallbackContext): unknown {
    const { service, operation } = context;

    // Create operation-specific degraded responses
    switch (`${service}:${operation}`) {
      case "x-api:get-analytics":
        return {
          data: [],
          metrics: {
            views: 0,
            likes: 0,
            shares: 0,
            comments: 0,
          },
          degraded: true,
          message: "Analytics temporarily unavailable",
        };

      case "x-api:post-tweet":
        return {
          data: {
            id: "fallback-" + Date.now(),
            text: "Tweet queued for retry",
          },
          queued: true,
          degraded: true,
        };

      case "s3-storage:generate-upload-signature":
        return {
          url: "/fallback/upload",
          fields: {},
          expiresAt: new Date(Date.now() + 900000), // 15 minutes
          degraded: true,
          message: "Using local upload fallback",
        };

      case "cloudinary-storage:generate-upload-signature":
        return {
          url: "/fallback/cloudinary-upload",
          fields: {},
          expiresAt: new Date(Date.now() + 900000),
          degraded: true,
          message: "Using fallback upload service",
        };

      default:
        return {
          success: false,
          degraded: true,
          message: `${service} temporarily unavailable`,
          operation,
        };
    }
  }

  /**
   * @method getCacheKey
   * @description Builds the tenant-scoped L2 fallback store key. The `fallback:`
   *   prefix is retained so `redis.keys("fallback:*")` enumeration and clear keep
   *   working; the trailing discriminant scopes the entry per tenant/credential so
   *   distinct tenants never collide on a shared key.
   * @param service - Provider/service name.
   * @param operation - Operation name.
   * @param discriminant - Opaque per-tenant/credential scope.
   * @returns The tenant-scoped fallback cache key.
   */
  private getCacheKey(service: string, operation: string, discriminant: string): string {
    return `fallback:${service}:${operation}:${discriminant}`;
  }

  /**
   * Get fallback statistics
   */
  async getFallbackStats(): Promise<{
    cachedResponses: number;
    staticResponses: number;
    cacheHitRate?: number;
  }> {
    const stats = {
      cachedResponses: 0,
      staticResponses: this.staticResponses.size,
    };

    if (this.redis) {
      try {
        const keys = await this.redis.keys("fallback:*");
        stats.cachedResponses = keys.length;
      } catch (error: unknown) {
        logger.warn({ error }, "Failed to get cache stats");
      }
    }

    return stats;
  }

  /**
   * Clear all fallback caches
   */
  async clearFallbackCache(): Promise<void> {
    if (this.redis) {
      try {
        const keys = await this.redis.keys("fallback:*");
        if (keys.length > 0) {
          await this.redis.del(...keys);
          logger.info(`Cleared ${keys.length} fallback cache entries`);
        }
      } catch (error: unknown) {
        logger.error({ error }, "Failed to clear fallback cache");
      }
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}

// Global fallback manager instance
let globalFallbackManager: FallbackManager | null = null;

export function createFallbackManager(redisUrl?: string): FallbackManager {
  if (!globalFallbackManager) {
    globalFallbackManager = new FallbackManager(redisUrl);
  }
  return globalFallbackManager;
}

export function getFallbackManager(): FallbackManager | null {
  return globalFallbackManager;
}

export function resetFallbackManager(): void {
  globalFallbackManager = null;
}

// Pre-configured fallback strategies for common scenarios
export const CommonFallbackStrategies = {
  ANALYTICS_FALLBACK: {
    strategy: "CACHED_RESPONSE" as FallbackStrategy,
    cacheTtl: 1800000, // 30 minutes
  },

  UPLOAD_FALLBACK: {
    strategy: "DEGRADED_SERVICE" as FallbackStrategy,
  },

  METADATA_FALLBACK: {
    strategy: "CACHED_RESPONSE" as FallbackStrategy,
    cacheTtl: 3600000, // 1 hour
  },
};
