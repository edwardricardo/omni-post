/**
 * Cache Type Definitions
 * All TypeScript interfaces and types for the Redis cache adapter
 */

export interface CacheConfig {
  redisUrl: string;
  keyPrefix?: string;
  defaultTtl?: number; // seconds
  maxRetries?: number;
  enableCompression?: boolean;
  enableMetrics?: boolean;
}

export interface CacheItem<T = any> {
  data: T;
  metadata: {
    createdAt: number;
    expiresAt: number;
    version: string;
    tags: string[];
    hitCount: number;
  };
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for cache invalidation
  version?: string; // Version for cache invalidation
  compress?: boolean; // Enable compression for large payloads
  dependencies?: string[]; // Keys that this cache entry depends on
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
  avgTtl: number;
  l1Hits: number;
  l2Hits: number;
  l1Size: number;
  hotKeys: Array<{ key: string; hits: number; frequency: number }>;
}

export interface AccessPattern {
  key: string;
  frequency: number;
  lastAccess: number;
  avgResponseTime: number;
}

export type CacheInvalidationStrategy = "immediate" | "lazy" | "scheduled" | "smart";

export interface InternalCacheStats {
  l1Hits: number;
  l2Hits: number;
  totalHits: number;
  totalMisses: number;
  evictions: number;
  warmups: number;
}
