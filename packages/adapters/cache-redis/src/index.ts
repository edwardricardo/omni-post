/**
 * @file index.ts
 * @description Barrel re-exports for the Redis cache adapter — types, constants, metrics,
 *              L1 cache, access patterns, invalidation, cache manager, factory, and middleware.
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

// Factory helpers
export { createCacheManager, getCacheManager, resetCacheManager } from "./factory.js";

// Fastify middleware and invalidation helpers
export {
  cachePlugin,
  CacheInvalidator,
  type CacheMiddlewareOptions,
  type RouteCacheOptions,
} from "./middleware.js";

// Event-driven cache invalidation
export {
  CacheEventManager,
  createCacheEventManager,
  CacheInvalidationPatterns,
  type CacheEventHandler,
  type DomainEvent,
  type EntityCacheOptions,
} from "./events.js";
