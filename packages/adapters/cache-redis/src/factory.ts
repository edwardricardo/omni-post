/**
 * @file factory.ts
 * @description Factory functions (createCacheManager, getCacheManager, resetCacheManager) for
 *              creating and managing the global RedisCacheManager instance.
 * @layer infrastructure
 */

import type { CacheConfig } from "./types.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { RedisCacheManager } from "./cache-manager.js";

// Global cache instance
let globalCache: RedisCacheManager | null = null;

export function createCacheManager(
  config: CacheConfig,
  scheduler?: BackgroundTaskScheduler
): RedisCacheManager {
  if (!globalCache) {
    globalCache = new RedisCacheManager(config, scheduler);
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
