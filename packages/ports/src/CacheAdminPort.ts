/**
 * @file CacheAdminPort.ts
 * @description Technology-free port for operating the application-wide cache as a whole:
 *              reading its statistics and its health, and the administrative writes an
 *              operator runs against it (flush, invalidation by tag or by key pattern,
 *              warm-up). Every operation spans every tenant and every pod, so only the
 *              admin system-operations surface takes this port. Application code reads and
 *              writes the cache through `CachePort` instead, whose `invalidateByTag`
 *              reports no count and whose surface has none of the operations below.
 *
 *              The composition root passes the Redis-backed cache manager, which
 *              implements this port as it stands. Each operation returns a `Result`, so a
 *              cache outage reaches the caller as a value it maps to a response.
 * @layer domain
 */
import type { Result } from "@shared/types";

/** The one failure a cache administration operation reports. */
export type CacheAdminError = "CACHE_ERROR";

/** Counters and sizes of the cache, across its in-process (L1) and shared (L2) tiers. */
export interface CacheStatistics {
  hits: number;
  misses: number;
  /** `hits / (hits + misses)`, from 0 to 1, and 0 before the first read. */
  hitRate: number;
  /** Keys held by the shared tier. */
  totalKeys: number;
  /** Bytes used by the shared tier. */
  memoryUsage: number;
  avgTtl: number;
  l1Hits: number;
  l2Hits: number;
  /** Entries held by the in-process tier. */
  l1Size: number;
  /** The most read keys, most read first. */
  hotKeys: ReadonlyArray<{ key: string; hits: number; frequency: number }>;
}

/** How the shared tier answered a probe. */
export interface CacheHealth {
  status: "healthy" | "degraded" | "unhealthy";
  /** Round trip of the probe, in milliseconds. */
  latency: number;
}

export interface CacheAdminPort {
  /**
   * Read the cache's counters and sizes.
   *
   * @returns The statistics, or `CACHE_ERROR` when the shared tier cannot be read.
   */
  getStats(): Promise<Result<CacheStatistics, CacheAdminError>>;

  /**
   * Probe the shared tier and time its answer.
   *
   * @returns The probe's verdict and latency, or `CACHE_ERROR` when the probe failed.
   */
  healthCheck(): Promise<Result<CacheHealth, CacheAdminError>>;

  /**
   * Remove every entry from both tiers, for every tenant.
   *
   * @returns Nothing on success, or `CACHE_ERROR` when the shared tier refused the flush.
   */
  flush(): Promise<Result<void, CacheAdminError>>;

  /**
   * Remove every entry carrying a tag.
   *
   * @param tag - The tag the entries were written with.
   * @returns The number of entries removed, or `CACHE_ERROR`.
   */
  invalidateByTag(tag: string): Promise<Result<number, CacheAdminError>>;

  /**
   * Remove every entry whose key matches a pattern.
   *
   * @param pattern - A key pattern such as `user:*`.
   * @returns The number of entries removed, or `CACHE_ERROR`.
   */
  invalidateByPattern(pattern: string): Promise<Result<number, CacheAdminError>>;

  /**
   * Warm the cache from its recent access patterns.
   *
   * @returns The number of keys warmed, or `CACHE_ERROR`.
   */
  warmCache(): Promise<Result<number, CacheAdminError>>;
}
