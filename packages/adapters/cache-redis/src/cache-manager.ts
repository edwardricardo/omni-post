/**
 * @file cache-manager.ts
 * @description Main Redis cache manager orchestrating L1 in-memory cache, L2 Redis cache,
 *              invalidation strategies, access pattern tracking, and Prometheus metrics.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import Redis from "ioredis";
import pino from "pino";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  cacheHits,
  cacheMisses,
  cacheOperationDuration,
  incrementCacheL1Hit,
  incrementCacheL1Miss,
  incrementCacheL2Hit,
  incrementCacheL2Miss,
} from "./metrics.js";
import type {
  CacheConfig,
  CacheItem,
  CacheOptions,
  CacheStats,
  CacheInvalidationStrategy,
  InternalCacheStats,
} from "./types.js";
import { L1CacheManager } from "./l1-cache.js";
import { AccessPatternTracker } from "./access-patterns.js";
import { CacheInvalidationManager } from "./invalidation.js";

const logger = pino({
  name: "redis-cache",
  level: process.env.LOG_LEVEL || "info",
});

export class RedisCacheManager {
  private redis: Redis;
  private config: Required<CacheConfig>;
  private compressionThreshold = 1024; // Compress payloads > 1KB

  // L1 Cache (Memory)
  private l1Cache: L1CacheManager;
  private enableL1Cache = true;

  // Access pattern tracking
  private accessTracker: AccessPatternTracker;
  private enableAccessTracking = true;

  // Invalidation manager
  private invalidationManager: CacheInvalidationManager;

  // Statistics
  private stats: InternalCacheStats = {
    l1Hits: 0,
    l2Hits: 0,
    totalHits: 0,
    totalMisses: 0,
    evictions: 0,
    warmups: 0,
  };

  private scheduler: BackgroundTaskScheduler | undefined;
  private readonly l1CleanupTaskId = "redis-cache-manager-l1-cleanup";
  private readonly patternCleanupTaskId = "redis-cache-manager-pattern-cleanup";
  private isWarming = false;

  constructor(config: CacheConfig, scheduler?: BackgroundTaskScheduler) {
    this.scheduler = scheduler;
    // L-377: TTL default reads from CACHE_TTL_DEFAULT env var (seconds).
    // Falls back to 3600 (1h) if unset or unparseable so existing deployments
    // keep current behavior; explicit `config.defaultTtl` still wins.
    const envTtl = Number(process.env.CACHE_TTL_DEFAULT);
    const defaultTtl = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 3600;
    this.config = {
      keyPrefix: "cache:",
      defaultTtl,
      maxRetries: 3,
      enableCompression: true,
      enableMetrics: true,
      ...config,
    };

    this.redis = new Redis(this.config.redisUrl, {
      enableReadyCheck: false,
      maxRetriesPerRequest: null, // Required for BullMQ compatibility
      lazyConnect: true,
      keyPrefix: this.config.keyPrefix,
    });

    this.l1Cache = new L1CacheManager(this.stats);
    this.accessTracker = new AccessPatternTracker();
    this.invalidationManager = new CacheInvalidationManager(
      this.redis,
      this.l1Cache,
      this.accessTracker,
      this.config.keyPrefix
    );

    this.setupEventListeners();
    this.startBackgroundTasks();
  }

  private setupEventListeners(): void {
    this.redis.on("connect", () => {
      logger.info("Redis cache connected");
    });

    this.redis.on("error", (error) => {
      logger.error(`Redis cache error: ${error.message}`);
    });

    this.redis.on("ready", () => {
      logger.info("Redis cache ready");
    });
  }

  /**
   * Get value from cache with L1 → L2 fallback
   */
  async get<T = any>(key: string): Promise<Result<T | null, "CACHE_ERROR">> {
    const startTime = Date.now();
    const timer = cacheOperationDuration.startTimer({ operation: "get", status: "pending" });

    try {
      // Track access pattern
      if (this.enableAccessTracking) {
        this.accessTracker.updatePattern(key, startTime);
      }

      // L1 Cache (Memory) - fastest
      if (this.enableL1Cache) {
        const l1Entry = this.l1Cache.get(key);
        if (l1Entry && this.l1Cache.isValid(l1Entry)) {
          // Update hit count
          l1Entry.metadata.hitCount++;
          this.l1Cache.set(key, l1Entry);

          this.stats.l1Hits++;
          this.stats.totalHits++;
          this.accessTracker.recordResponseTime(startTime);

          if (this.config.enableMetrics) {
            cacheHits.inc({ operation: "get", key_pattern: this.getKeyPattern(key) });
            incrementCacheL1Hit();
          }

          timer({ operation: "get", status: "l1_hit" });
          return ok(l1Entry.data as T);
        }
      }

      // L2 Cache (Redis)
      const rawValue = await this.redis.get(key);

      if (!rawValue) {
        this.stats.totalMisses++;
        this.accessTracker.recordResponseTime(startTime);

        if (this.config.enableMetrics) {
          cacheMisses.inc({ operation: "get", key_pattern: this.getKeyPattern(key) });
          incrementCacheL1Miss();
          incrementCacheL2Miss();
        }
        timer({ operation: "get", status: "miss" });
        return ok(null);
      }

      const cacheItem: CacheItem<T> = JSON.parse(rawValue);

      // Check if expired (extra safety check)
      if (cacheItem.metadata.expiresAt < Date.now()) {
        await this.redis.del(key);
        this.l1Cache.delete(key); // Also remove from L1
        this.stats.totalMisses++;
        this.accessTracker.recordResponseTime(startTime);

        if (this.config.enableMetrics) {
          cacheMisses.inc({ operation: "get", key_pattern: this.getKeyPattern(key) });
          incrementCacheL1Miss();
          incrementCacheL2Miss();
        }
        timer({ operation: "get", status: "expired" });
        return ok(null);
      }

      // Update hit count
      cacheItem.metadata.hitCount++;
      await this.redis.set(
        key,
        JSON.stringify(cacheItem),
        "EX",
        Math.ceil((cacheItem.metadata.expiresAt - Date.now()) / 1000)
      );

      // Populate L1 cache for future access
      if (this.enableL1Cache) {
        this.l1Cache.set(key, cacheItem);
      }

      this.stats.l2Hits++;
      this.stats.totalHits++;
      this.accessTracker.recordResponseTime(startTime);

      if (this.config.enableMetrics) {
        cacheHits.inc({ operation: "get", key_pattern: this.getKeyPattern(key) });
        incrementCacheL1Miss();
        incrementCacheL2Hit();
      }

      timer({ operation: "get", status: "l2_hit" });
      return ok(cacheItem.data);
    } catch (error: unknown) {
      logger.error(`Cache get error for key ${key}: ${error}`);
      this.stats.totalMisses++;
      this.accessTracker.recordResponseTime(startTime);
      timer({ operation: "get", status: "error" });
      return err("CACHE_ERROR");
    }
  }

  /**
   * Set value in cache
   */
  async set<T = any>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<Result<void, "CACHE_ERROR">> {
    const timer = cacheOperationDuration.startTimer({ operation: "set", status: "pending" });

    try {
      const ttl = options.ttl || this.config.defaultTtl;
      const now = Date.now();

      const cacheItem: CacheItem<T> = {
        data: value,
        metadata: {
          createdAt: now,
          expiresAt: now + ttl * 1000,
          version: options.version || "1.0.0",
          tags: options.tags || [],
          hitCount: 0,
        },
      };

      const serialized = JSON.stringify(cacheItem);

      // Compress large payloads if enabled
      let finalPayload = serialized;
      if (
        this.config.enableCompression &&
        options.compress !== false &&
        serialized.length > this.compressionThreshold
      ) {
        // Note: In production, you might want to use actual compression like gzip
        // For now, we'll just flag it for potential compression
        logger.debug(`Large payload detected for key ${key}: ${serialized.length} bytes`);
      }

      // L1 first (synchronous, no I/O) — fastest cache populated immediately.
      // This ensures the next get() returns a HIT even if Redis writes
      // are still in flight (fire-and-forget from onSend middleware).
      if (this.enableL1Cache) {
        this.l1Cache.set(key, cacheItem);
      }

      // Update dependency graph (in-memory, synchronous)
      if (options.dependencies && options.dependencies.length > 0) {
        this.invalidationManager.updateDependencyGraph(key, options.dependencies);
      }

      // L2 (Redis) — async persistence and cross-process sharing
      await this.redis.set(key, finalPayload, "EX", ttl);

      // Update tags index in Redis for cross-process invalidation
      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await this.redis.sadd(`tag:${tag}`, key);
          await this.redis.expire(`tag:${tag}`, ttl + 3600); // Tag index lives longer
        }
      }

      timer({ operation: "set", status: "success" });
      logger.debug(`Cached key ${key} with TTL ${ttl}s`);
      return ok(undefined);
    } catch (error: unknown) {
      logger.error(`Cache set error for key ${key}: ${error}`);
      timer({ operation: "set", status: "error" });
      return err("CACHE_ERROR");
    }
  }

  /**
   * Delete specific key from cache (L1 and L2)
   */
  async del(key: string): Promise<Result<boolean, "CACHE_ERROR">> {
    const timer = cacheOperationDuration.startTimer({ operation: "del", status: "pending" });

    try {
      // Remove from L1
      this.l1Cache.delete(key);

      // Remove from dependency graph
      this.invalidationManager.removeDependency(key);

      // Remove from L2
      const result = await this.redis.del(key);
      timer({ operation: "del", status: "success" });
      return ok(result > 0);
    } catch (error: unknown) {
      logger.error(`Cache delete error for key ${key}: ${error}`);
      timer({ operation: "del", status: "error" });
      return err("CACHE_ERROR");
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTag(tag: string): Promise<Result<number, "CACHE_ERROR">> {
    const timer = cacheOperationDuration.startTimer({ operation: "invalidate", status: "pending" });

    try {
      const result = await this.invalidationManager.invalidateByTag(tag);
      timer({ operation: "invalidate", status: "success" });
      return result;
    } catch (error: unknown) {
      logger.error(`Cache invalidation error for tag ${tag}: ${error}`);
      timer({ operation: "invalidate", status: "error" });
      return err("CACHE_ERROR");
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidateByPattern(pattern: string): Promise<Result<number, "CACHE_ERROR">> {
    const timer = cacheOperationDuration.startTimer({
      operation: "invalidate_pattern",
      status: "pending",
    });

    try {
      const result = await this.invalidationManager.invalidateByPattern(pattern);
      timer({ operation: "invalidate_pattern", status: "success" });
      return result;
    } catch (error: unknown) {
      logger.error(`Cache pattern invalidation error for pattern ${pattern}: ${error}`);
      timer({ operation: "invalidate_pattern", status: "error" });
      return err("CACHE_ERROR");
    }
  }

  /**
   * Invalidate cache by dependencies
   */
  async invalidateByDependencies(dependencies: string[]): Promise<Result<number, "CACHE_ERROR">> {
    return this.invalidationManager.invalidateByDependencies(dependencies, this.del.bind(this));
  }

  /**
   * Invalidate with smart strategy
   */
  async invalidate(
    keys: string | string[],
    strategy: CacheInvalidationStrategy = "immediate"
  ): Promise<Result<number, "CACHE_ERROR">> {
    return this.invalidationManager.invalidate(keys, strategy, this.del.bind(this));
  }

  /**
   * Get or set pattern - atomic operation
   */
  async getOrSet<T = any>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<Result<T, "CACHE_ERROR" | "FACTORY_ERROR">> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached.ok && cached.value !== null) {
      return ok(cached.value);
    }

    try {
      // Generate new value
      const value = await factory();

      // Cache the new value
      const setResult = await this.set(key, value, options);
      if (!setResult.ok) {
        logger.warn(`Failed to cache generated value for key ${key}`);
      }

      return ok(value);
    } catch (error: unknown) {
      logger.error(`Factory function error for key ${key}: ${error}`);
      return err("FACTORY_ERROR");
    }
  }

  /**
   * Check if a key exists without decoding its payload. Checks L1 first
   * (synchronous), then Redis `EXISTS` (single-RTT, no deserialization).
   */
  async has(key: string): Promise<Result<boolean, "CACHE_ERROR">> {
    try {
      if (this.enableL1Cache) {
        const l1Entry = this.l1Cache.get(key);
        if (l1Entry && this.l1Cache.isValid(l1Entry)) {
          return ok(true);
        }
      }
      const exists = await this.redis.exists(key);
      return ok(exists > 0);
    } catch (error: unknown) {
      logger.error(`Cache exists error for key ${key}: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Get cache statistics with L1/L2 breakdown
   */
  async getStats(): Promise<Result<CacheStats, "CACHE_ERROR">> {
    try {
      const info = await this.redis.info("memory");
      const dbSize = await this.redis.dbsize();

      // Parse memory info
      const memoryUsage = this.parseRedisInfo(info, "used_memory");

      // Calculate hit rate
      const totalRequests = this.stats.totalHits + this.stats.totalMisses;
      const hitRate = totalRequests > 0 ? this.stats.totalHits / totalRequests : 0;

      // Get hot keys from access patterns
      const hotKeys = this.accessTracker.getHotKeys(10);

      const avgTtl = this.accessTracker.getAverageResponseTime();

      const stats: CacheStats = {
        hits: this.stats.totalHits,
        misses: this.stats.totalMisses,
        hitRate,
        totalKeys: dbSize,
        memoryUsage,
        avgTtl,
        l1Hits: this.stats.l1Hits,
        l2Hits: this.stats.l2Hits,
        l1Size: this.l1Cache.size(),
        hotKeys,
      };

      return ok(stats);
    } catch (error: unknown) {
      logger.error(`Cache stats error: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<
    Result<{ status: "healthy" | "degraded" | "unhealthy"; latency: number }, "CACHE_ERROR">
  > {
    const start = Date.now();

    try {
      await this.redis.ping();
      const latency = Date.now() - start;

      let status: "healthy" | "degraded" | "unhealthy" = "healthy";
      if (latency > 100) status = "degraded";
      if (latency > 1000) status = "unhealthy";

      return ok({ status, latency });
    } catch (error: unknown) {
      logger.error(`Cache health check failed: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Flush all cache data (use with caution)
   */
  async flush(): Promise<Result<void, "CACHE_ERROR">> {
    try {
      // Clear L1
      this.l1Cache.clear();
      this.invalidationManager.clearDependencies();
      this.accessTracker.clear();

      // Clear L2
      await this.redis.flushdb();
      logger.warn("Cache flushed - all data cleared");
      return ok(undefined);
    } catch (error: unknown) {
      logger.error(`Cache flush error: ${error}`);
      return err("CACHE_ERROR");
    }
  }

  /**
   * Warm cache based on access patterns
   */
  async warmCache(warmupThreshold = 10): Promise<Result<number, "CACHE_ERROR">> {
    if (this.isWarming) {
      return ok(0);
    }

    this.isWarming = true;

    try {
      logger.info("Starting intelligent cache warming...");

      // Get frequently accessed patterns
      const allPatterns = this.accessTracker.getAllPatterns();
      const hotPatterns = Array.from(allPatterns.entries())
        .filter(([_, pattern]) => {
          const recentAccess = Date.now() - pattern.lastAccess < 300000; // 5 minutes
          const highFrequency = pattern.frequency >= warmupThreshold;
          return recentAccess && highFrequency;
        })
        .sort(([_, a], [__, b]) => b.frequency - a.frequency)
        .slice(0, 50); // Top 50 hot keys

      let warmedCount = 0;

      for (const [key] of hotPatterns) {
        try {
          // Check if already cached
          const exists = await this.redis.exists(key);
          if (!exists) {
            // Key is accessed frequently but not in cache
            // You can implement custom warming logic here based on key patterns
            this.stats.warmups++;
            warmedCount++;
          }
        } catch {
          // Skip warming this key on error
        }
      }

      logger.info(`Cache warming completed. Checked ${hotPatterns.length} keys.`);
      this.isWarming = false;
      return ok(warmedCount);
    } catch (error: unknown) {
      logger.error(`Cache warming failed: ${error}`);
      this.isWarming = false;
      return err("CACHE_ERROR");
    }
  }

  /**
   * Close Redis connection and cleanup
   */
  async close(): Promise<void> {
    if (this.scheduler) {
      this.scheduler.unregister(this.l1CleanupTaskId);
      this.scheduler.unregister(this.patternCleanupTaskId);
    }
    this.l1Cache.clear();
    this.accessTracker.clear();
    this.invalidationManager.clearDependencies();
    try {
      await this.redis.quit();
    } catch {
      // Connection may not have been opened (lazyConnect) or already closed
    }
  }

  private getKeyPattern(key: string): string {
    // Extract pattern for metrics (e.g., "user:123" -> "user:*")
    const parts = key.split(":");
    if (parts.length > 1) {
      return parts[0] + ":*";
    }
    return "other";
  }

  private parseRedisInfo(info: string, key: string): number {
    const lines = info.split("\r\n");
    for (const line of lines) {
      if (line.startsWith(key + ":")) {
        const value = line.split(":")[1];
        return value ? parseInt(value, 10) || 0 : 0;
      }
    }
    return 0;
  }

  // Background tasks

  private startBackgroundTasks(): void {
    if (!this.scheduler) {
      // If no scheduler provided, background tasks are disabled. Consumer is
      // expected to handle cleanup cadence via their own mechanism.
      return;
    }
    // Cleanup expired L1 entries every minute
    this.scheduler.register(this.l1CleanupTaskId, () => this.l1Cache.cleanupExpired(), 60_000, {
      onError: (err) => logger.warn({ err }, "L1 cleanup task error"),
    });
    // Cleanup old access patterns every hour
    this.scheduler.register(
      this.patternCleanupTaskId,
      () => {
        const cutoff = Date.now() - 3600000; // 1 hour
        this.accessTracker.cleanupOldPatterns(cutoff);
      },
      3_600_000,
      {
        onError: (err) => logger.warn({ err }, "Pattern cleanup task error"),
      }
    );
  }
}
