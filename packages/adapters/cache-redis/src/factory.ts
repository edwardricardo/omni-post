/**
 * Cache Factory
 * Factory functions for creating and managing global cache instances
 */

import type { CacheConfig } from "./types.js";
import { RedisCacheManager } from "./cache-manager.js";

// Global cache instance
let globalCache: RedisCacheManager | null = null;

export function createCacheManager(config: CacheConfig): RedisCacheManager {
  if (!globalCache) {
    globalCache = new RedisCacheManager(config);
  }
  return globalCache;
}

export function getCacheManager(): RedisCacheManager | null {
  return globalCache;
}

/**
 * Reset the global cache instance.
 * Call this after closing the cache manager to allow creating a new one.
 * Primarily used in tests.
 */
export function resetCacheManager(): void {
  globalCache = null;
}
