/**
 * @file cacheStatsRoutes.ts
 * @description REST API endpoints for monitoring cache performance, hit rates, and
 *              invalidation operations. Resolves the concrete `RedisCacheManager`
 *              from the DI container — `getStats`, `flush`, `warmCache`,
 *              `healthCheck`, and `invalidateByPattern` are ops-tier concerns that
 *              live outside the application `CachePort` surface.
 *
 *              The `RedisCacheManager` is a GLOBAL, cross-tenant, cross-pod
 *              instance, so these routes are admin system-ops — not customer
 *              endpoints. They are guarded by admin auth plus a system permission:
 *              reads require `SYSTEM_MONITOR`, destructive operations (flush,
 *              invalidate, warm) require `SYSTEM_CONFIGURE`. Guarding them with
 *              customer auth would let any authenticated tenant flush or inspect
 *              every other tenant's cache namespace.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { RedisCacheManager } from "@adapters/cache-redis";
import { createLogger } from "../lib/logger.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../infrastructure/container/types.js";

const logger = createLogger("cache-stats-routes");

/**
 * Cache statistics routes
 */
export const cacheStatsRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  const cacheManager = container?.resolve<RedisCacheManager>(TOKENS.RedisCacheManager);

  if (!cacheManager) {
    fastify.log.warn("DI container or RedisCacheManager unavailable — cache stats routes disabled");
    return;
  }

  /**
   * GET /cache/stats - Get comprehensive cache statistics
   */
  fastify.get(
    "/cache/stats",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)],
      schema: { tags: ["Cache"], summary: "Get comprehensive cache statistics" },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const statsResult = await cacheManager.getStats();

        if (!statsResult.ok) {
          return reply.status(500).send({
            ok: false,
            error: "Failed to get cache statistics",
          });
        }

        const stats = statsResult.value;

        return reply.send({
          ok: true,
          stats: {
            // Hit/Miss metrics
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hitRate,
            hitRatePercentage: (stats.hitRate * 100).toFixed(2) + "%",

            // Cache size
            totalKeys: stats.totalKeys,
            memoryUsage: stats.memoryUsage,
            memoryUsageMB: (stats.memoryUsage / 1024 / 1024).toFixed(2) + " MB",

            // L1/L2 cache breakdown
            l1Hits: stats.l1Hits,
            l2Hits: stats.l2Hits,
            l1Size: stats.l1Size,

            // Performance metrics
            avgTtl: stats.avgTtl,

            // Hot keys
            hotKeys: stats.hotKeys.slice(0, 10), // Top 10 hot keys
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        logger.error(`Failed to get cache stats: ${error}`);
        return reply.status(500).send({
          ok: false,
          error: "Internal server error",
        });
      }
    }
  );

  /**
   * GET /cache/health - Check cache health
   */
  fastify.get(
    "/cache/health",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)],
      schema: { tags: ["Cache"], summary: "Check cache health status" },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const healthResult = await cacheManager.healthCheck();

        if (!healthResult.ok) {
          return reply.status(500).send({
            ok: false,
            error: "Cache health check failed",
          });
        }

        const health = healthResult.value;

        return reply.send({
          ok: true,
          health: {
            status: health.status,
            latency: health.latency,
            latencyMs: health.latency + "ms",
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        logger.error(`Cache health check failed: ${error}`);
        return reply.status(500).send({
          ok: false,
          error: "Internal server error",
        });
      }
    }
  );

  /**
   * POST /cache/flush - Flush all cache (admin only)
   */
  fastify.post(
    "/cache/flush",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)],
      schema: { tags: ["Cache"], summary: "Flush all cache entries" },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const flushResult = await cacheManager.flush();

        if (!flushResult.ok) {
          return reply.status(500).send({
            ok: false,
            error: "Cache flush failed",
          });
        }

        logger.warn("Cache manually flushed via API");

        return reply.send({
          ok: true,
          message: "Cache flushed successfully",
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        logger.error(`Cache flush failed: ${error}`);
        return reply.status(500).send({
          ok: false,
          error: "Internal server error",
        });
      }
    }
  );

  /**
   * POST /cache/invalidate - Invalidate specific cache tags
   */
  fastify.post<{
    Body: { tags?: string[]; patterns?: string[] };
  }>(
    "/cache/invalidate",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)],
      schema: { tags: ["Cache"], summary: "Invalidate cache by tags or patterns" },
    },
    async (request, reply) => {
      const { tags = [], patterns = [] } = request.body;

      if (tags.length === 0 && patterns.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: "At least one tag or pattern must be provided",
        });
      }

      try {
        let totalInvalidated = 0;

        // Invalidate by tags
        for (const tag of tags) {
          const result = await cacheManager.invalidateByTag(tag);
          if (result.ok) {
            totalInvalidated += result.value;
          }
        }

        // Invalidate by patterns
        for (const pattern of patterns) {
          const result = await cacheManager.invalidateByPattern(pattern);
          if (result.ok) {
            totalInvalidated += result.value;
          }
        }

        logger.info(
          `Cache manually invalidated: ${totalInvalidated} entries (tags: ${tags.join(", ")}, patterns: ${patterns.join(", ")})`
        );

        return reply.send({
          ok: true,
          invalidated: totalInvalidated,
          tags,
          patterns,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        logger.error(`Cache invalidation failed: ${error}`);
        return reply.status(500).send({
          ok: false,
          error: "Internal server error",
        });
      }
    }
  );

  /**
   * GET /cache/hot-keys - Get most frequently accessed cache keys
   */
  fastify.get(
    "/cache/hot-keys",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)],
      schema: { tags: ["Cache"], summary: "Get most frequently accessed cache keys" },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const statsResult = await cacheManager.getStats();

        if (!statsResult.ok) {
          return reply.status(500).send({
            ok: false,
            error: "Failed to get hot keys",
          });
        }

        const stats = statsResult.value;

        return reply.send({
          ok: true,
          hotKeys: stats.hotKeys.slice(0, 50), // Top 50 hot keys
          count: stats.hotKeys.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        logger.error(`Failed to get hot keys: ${error}`);
        return reply.status(500).send({
          ok: false,
          error: "Internal server error",
        });
      }
    }
  );

  /**
   * POST /cache/warm - Warm cache with frequently accessed data
   */
  fastify.post(
    "/cache/warm",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)],
      schema: { tags: ["Cache"], summary: "Warm cache with frequently accessed data" },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const warmResult = await cacheManager.warmCache();

        if (!warmResult.ok) {
          return reply.status(500).send({
            ok: false,
            error: "Cache warming failed",
          });
        }

        logger.info(`Cache warming completed: ${warmResult.value} keys warmed`);

        return reply.send({
          ok: true,
          warmedCount: warmResult.value,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        logger.error(`Cache warming failed: ${error}`);
        return reply.status(500).send({
          ok: false,
          error: "Internal server error",
        });
      }
    }
  );
};
