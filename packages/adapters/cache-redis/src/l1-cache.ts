/**
 * L1 Cache Manager
 * In-memory cache layer with LRU eviction and memory management
 */

import pino from "pino";
import type { CacheItem, InternalCacheStats } from "./types.js";

const logger = pino({
  name: "redis-cache:l1",
  level: process.env.LOG_LEVEL || "info",
});

export class L1CacheManager {
  private l1Cache = new Map<string, CacheItem>();
  private tagIndex = new Map<string, Set<string>>();
  private maxL1Items = 1000;
  private maxL1MemoryBytes = 50 * 1024 * 1024; // 50MB
  private stats: InternalCacheStats;

  constructor(stats: InternalCacheStats) {
    this.stats = stats;
  }

  get(key: string): CacheItem | undefined {
    return this.l1Cache.get(key);
  }

  set(key: string, item: CacheItem): void {
    // Check memory limits before adding
    if (this.l1Cache.size >= this.maxL1Items) {
      this.evictLRU();
    }

    const estimatedSize = JSON.stringify(item).length * 2; // UTF-16
    if (this.calculateMemoryUsage() + estimatedSize > this.maxL1MemoryBytes) {
      this.evictLRU();
    }

    this.l1Cache.set(key, item);

    // Track tag-to-key mappings in memory for fast invalidation
    if (item.metadata.tags) {
      for (const tag of item.metadata.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(key);
      }
    }
  }

  delete(key: string): void {
    // Remove from tag index before deleting
    const item = this.l1Cache.get(key);
    if (item?.metadata.tags) {
      for (const tag of item.metadata.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }
    this.l1Cache.delete(key);
  }

  /**
   * Get all keys associated with a tag (without deleting them).
   */
  getKeysByTag(tag: string): string[] {
    const keys = this.tagIndex.get(tag);
    return keys ? [...keys] : [];
  }

  /**
   * Delete all L1 entries associated with a tag.
   * Uses the in-memory tag index — no Redis dependency.
   * Returns the deleted keys so callers can also clear them from L2.
   */
  deleteByTag(tag: string): string[] {
    const keys = this.tagIndex.get(tag);
    if (!keys || keys.size === 0) return [];

    const deletedKeys: string[] = [];
    for (const key of keys) {
      this.l1Cache.delete(key);
      deletedKeys.push(key);
    }
    this.tagIndex.delete(tag);
    return deletedKeys;
  }

  clear(): void {
    this.l1Cache.clear();
    this.tagIndex.clear();
  }

  size(): number {
    return this.l1Cache.size;
  }

  isValid(entry: CacheItem): boolean {
    return entry.metadata.expiresAt > Date.now();
  }

  calculateMemoryUsage(): number {
    let total = 0;
    for (const [key, entry] of this.l1Cache.entries()) {
      total += key.length * 2 + JSON.stringify(entry).length * 2;
    }
    return total;
  }

  private evictLRU(): void {
    let oldestKey = "";
    let oldestTime = Date.now();

    for (const [key, entry] of this.l1Cache.entries()) {
      const lastAccess = entry.metadata.hitCount === 0 ? entry.metadata.createdAt : Date.now();
      if (lastAccess < oldestTime) {
        oldestTime = lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.l1Cache.delete(oldestKey);
      this.stats.evictions++;
      logger.debug(`Evicted LRU cache entry: ${oldestKey}`);
    }
  }

  cleanupExpired(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.l1Cache.entries()) {
      if (entry.metadata.expiresAt < now) {
        this.l1Cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired L1 cache entries`);
    }
  }

  entries(): IterableIterator<[string, CacheItem]> {
    return this.l1Cache.entries();
  }
}
