/**
 * Redis Cache Adapter — Public API
 *
 * Thin barrel re-exporting from focused modules.
 * Implementation lives in:
 *   types.ts          — interfaces and type aliases
 *   constants.ts      — CacheKeys and CacheTTL
 *   metrics.ts        — Prometheus counters / histograms
 *   l1-cache.ts       — in-memory L1 cache with LRU eviction
 *   access-patterns.ts — access frequency tracking
 *   invalidation.ts   — invalidation strategies (immediate / lazy / scheduled / smart)
 *   cache-manager.ts  — RedisCacheManager (L1 + L2 orchestrator)
 *   factory.ts        — createCacheManager / getCacheManager / resetCacheManager
 *   middleware.ts     — Fastify cachePlugin + CacheInvalidator
 *   events.ts         — domain-event-driven invalidation
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
