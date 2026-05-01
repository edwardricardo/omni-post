/**
 * @file index.ts
 * @description Barrel re-exports for the Redis cache adapter — types, constants,
 *              metrics, L1 cache, access patterns, invalidation, cache manager,
 *              and factory. HTTP-level caching middleware lives app-local
 *              (`apps/api/src/middleware/autoCacheMiddleware.ts`) so this
 *              package stays Fastify-free.
 * @layer infrastructure
 */

// Types
export type {
  CacheConfig,
  CacheItem,
  CacheOptions,
  CacheStats,
  AccessPattern,
  CacheInvalidationStrategy,
  InternalCacheStats,
} from "./types.js";

// Constants
export { CacheKeys, CacheTTL } from "./constants.js";

// Core cache manager
export { RedisCacheManager } from "./cache-manager.js";

// CachePort adapters
export { RedisCacheAdapter } from "./redis-cache-adapter.js";
export { InMemoryCacheAdapter } from "./in-memory-cache-adapter.js";
export type { InMemoryCacheAdapterOptions } from "./in-memory-cache-adapter.js";

// Factory helpers
export { createCacheManager, getCacheManager, resetCacheManager } from "./factory.js";
