/**
 * @file invalidation.ts
 * @description Cache invalidation manager supporting immediate, lazy, scheduled, and smart
 *              invalidation strategies with dependency graph tracking.
 * @layer infrastructure
 */

import pino from "pino";
import type { Redis } from "ioredis";
import type { Result } from "@shared/types";
import { ok, err } from "@shared/types";
import type { CacheInvalidationStrategy } from "./types.js";
import type { L1CacheManager } from "./l1-cache.js";
import type { AccessPatternTracker } from "./access-patterns.js";

const logger = pino({
  name: "redis-cache:invalidation",
  level: process.env.LOG_LEVEL || "info",
});

export class CacheInvalidationManager {
  private dependencyGraph = new Map<string, Set<string>>();

  constructor(
    private redis: Redis,
    private l1Cache: L1CacheManager,
    private accessTracker: AccessPatternTracker,
    private keyPrefix: string
  ) {}

  /**
   * Update dependency graph for cache invalidation
   */
  updateDependencyGraph(key: string, dependencies: string[]): void {
    for (const dependency of dependencies) {
      if (!this.dependencyGraph.has(dependency)) {
        this.dependencyGraph.set(dependency, new Set());
      }
      this.dependencyGraph.get(dependency)!.add(key);
    }
  }

  /**
   * Remove key from dependency graph
   */
  removeDependency(key: string): void {
    this.dependencyGraph.forEach((deps) => {
      deps.delete(key);
    });
  }

  /**
   * Clear all dependencies
   */
  clearDependencies(): void {
    this.dependencyGraph.clear();
  }

  /**
   * Invalidate cache by tag
   */
  async invalidateByTag(tag: string): Promise<Result<number, "CACHE_ERROR">> {
    try {
      // 1) Clear L1 via in-memory tag index (synchronous, always consistent).
      //    L1 is populated first in set(), so its tag index is always up to
      //    date even when Redis tag writes are still in flight.
      //    Returns the deleted keys so we can also clear them from Redis.
      const l1DeletedKeys = this.l1Cache.deleteByTag(tag);

      // 2) Also get keys from Redis tag index (may have additional entries
      //    from other processes or entries evicted from L1).
      const redisTagKeys = await this.redis.smembers(`tag:${tag}`);

      // 3) Combine L1 keys + Redis tag keys for comprehensive L2 cleanup.
      //    L1 keys cover the case where Redis tag writes haven't completed.
      //    Redis tag keys cover cross-process and evicted entries.
      const allKeys = new Set([...l1DeletedKeys, ...redisTagKeys]);
      let redisDeleted = 0;

      if (allKeys.size > 0) {
        redisDeleted = await this.redis.del(...allKeys);
      }
      // Always clean the tag set itself
      await this.redis.del(`tag:${tag}`);

      const totalDeleted = l1DeletedKeys.length + redisDeleted;
      logger.info(`Invalidated tag: ${tag} (L1: ${l1DeletedKeys.length}, L2: ${redisDeleted})`);
      return ok(totalDeleted);
    } catch (error: unknown) {
      logger.error(`Cache invalidation error for tag ${tag}: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidateByPattern(pattern: string): Promise<Result<number, "CACHE_ERROR">> {
    try {
      const keys = await this.redis.keys(pattern);
      let deletedCount = 0;

      if (keys.length > 0) {
        // Remove from L1 cache
        for (const key of keys) {
          const cleanKey = key.replace(this.keyPrefix, "");
          this.l1Cache.delete(cleanKey);
        }

        deletedCount = await this.redis.del(...keys);
      }

      logger.info(`Invalidated ${deletedCount} keys with pattern: ${pattern}`);
      return ok(deletedCount);
    } catch (error: unknown) {
      logger.error(`Cache pattern invalidation error for pattern ${pattern}: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Invalidate cache by dependencies
   */
  async invalidateByDependencies(
    dependencies: string[],
    delFn: (key: string) => Promise<Result<boolean, "CACHE_ERROR">>
  ): Promise<Result<number, "CACHE_ERROR">> {
    try {
      const keysToInvalidate = new Set<string>();

      for (const dependency of dependencies) {
        const dependentKeys = this.dependencyGraph.get(dependency);
        if (dependentKeys) {
          dependentKeys.forEach((key) => keysToInvalidate.add(key));
        }
      }

      if (keysToInvalidate.size === 0) {
        return ok(0);
      }

      // Invalidate all dependent keys
      const promises = Array.from(keysToInvalidate).map((key) => delFn(key));
      await Promise.all(promises);

      logger.info(
        `Invalidated ${keysToInvalidate.size} keys by dependencies: ${dependencies.join(", ")}`
      );
      return ok(keysToInvalidate.size);
    } catch (error: unknown) {
      logger.error(`Cache dependency invalidation error: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Invalidate with strategy selection
   */
  async invalidate(
    keys: string | string[],
    strategy: CacheInvalidationStrategy,
    delFn: (key: string) => Promise<Result<boolean, "CACHE_ERROR">>
  ): Promise<Result<number, "CACHE_ERROR">> {
    const keyList = Array.isArray(keys) ? keys : [keys];

    switch (strategy) {
      case "immediate":
        return this.immediateInvalidation(keyList, delFn);
      case "lazy":
        return this.lazyInvalidation(keyList);
      case "scheduled":
        return this.scheduledInvalidation(keyList, delFn);
      case "smart":
        return this.smartInvalidation(keyList, delFn);
      default:
        return this.immediateInvalidation(keyList, delFn);
    }
  }

  /**
   * Immediate invalidation - delete keys right away
   */
  private async immediateInvalidation(
    keys: string[],
    delFn: (key: string) => Promise<Result<boolean, "CACHE_ERROR">>
  ): Promise<Result<number, "CACHE_ERROR">> {
    try {
      const promises = keys.map((key) => delFn(key));
      await Promise.all(promises);
      return ok(keys.length);
    } catch (error: unknown) {
      logger.error(`Immediate invalidation failed: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Lazy invalidation - mark for expiry soon
   */
  private async lazyInvalidation(keys: string[]): Promise<Result<number, "CACHE_ERROR">> {
    try {
      // Mark entries as expiring soon but don't remove immediately
      const pipeline = this.redis.pipeline();

      for (const key of keys) {
        pipeline.expire(key, 1); // Expire in 1 second
        // Remove from L1 immediately
        this.l1Cache.delete(key);
      }

      await pipeline.exec();
      return ok(keys.length);
    } catch (error: unknown) {
      logger.error(`Lazy invalidation failed: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Scheduled invalidation - invalidate at off-peak hours
   */
  private async scheduledInvalidation(
    keys: string[],
    delFn: (key: string) => Promise<Result<boolean, "CACHE_ERROR">>
  ): Promise<Result<number, "CACHE_ERROR">> {
    // Schedule invalidation for off-peak hours (e.g., 2 AM)
    const now = new Date();
    const twoAM = new Date();
    twoAM.setHours(2, 0, 0, 0);

    if (twoAM < now) {
      twoAM.setDate(twoAM.getDate() + 1);
    }

    const delay = twoAM.getTime() - now.getTime();

    setTimeout(async () => {
      await this.immediateInvalidation(keys, delFn);
    }, delay).unref();

    logger.info(`Scheduled invalidation of ${keys.length} keys for 2 AM`);
    return ok(keys.length);
  }

  /**
   * Smart invalidation - analyze patterns to choose strategy
   */
  private async smartInvalidation(
    keys: string[],
    delFn: (key: string) => Promise<Result<boolean, "CACHE_ERROR">>
  ): Promise<Result<number, "CACHE_ERROR">> {
    // Analyze access patterns to determine best invalidation strategy
    const hotKeys: string[] = [];
    const coldKeys: string[] = [];

    for (const key of keys) {
      const pattern = this.accessTracker.getPattern(key);
      const isHot = pattern && pattern.frequency > 10 && Date.now() - pattern.lastAccess < 300000; // 5 min

      if (isHot) {
        hotKeys.push(key);
      } else {
        coldKeys.push(key);
      }
    }

    // Immediate invalidation for cold keys
    if (coldKeys.length > 0) {
      await this.immediateInvalidation(coldKeys, delFn);
    }

    // Lazy invalidation for hot keys to avoid cache stampede
    if (hotKeys.length > 0) {
      await this.lazyInvalidation(hotKeys);
    }

    logger.info(
      `Smart invalidation: ${coldKeys.length} cold keys (immediate), ${hotKeys.length} hot keys (lazy)`
    );
    return ok(keys.length);
  }
}
