/**
 * @file CachePort.ts
 * @description Application-layer port for cache-aside operations. Adapters
 *              live in `@adapters/cache-redis` (Redis-backed L1+L2 wrapper
 *              and an in-memory variant for tests + per-process scope).
 *
 *              Canonical API surface follows the consensus across BentoCache,
 *              PettyCache, OneUptime's multi-layer guide, and cache-flow:
 *              `getOrSet(key, factory, ttl)` is the primary cache-aside
 *              entry point; raw `get`/`set` are for callers that compose
 *              their own flow.
 *
 *              Stampede protection (single-flight, XFetch, stale-while-
 *              revalidate, jitter) is intentionally NOT in the port surface
 *              yet — adding it requires hot-key metrics and per-policy
 *              decisions. Tracked separately in the backlog.
 * @layer domain
 */

export interface CachePort {
  /**
   * Read a cached value. Returns null on miss (not undefined — callers
   * destructure `null | T` reliably).
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Write a value with optional TTL (seconds). Omitting TTL applies the
   * adapter's configured default (`CACHE_TTL_DEFAULT` for Redis-backed,
   * 300s for InMemory).
   *
   * `tags` opt-in: groups keys for `invalidateByTag`. Tags are O(1) at
   * write-time; invalidation is O(N) over the tag set on the adapter side.
   */
  set<T>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number; tags?: readonly string[] }
  ): Promise<void>;

  /**
   * Cache-aside: returns cached value or invokes `factory` + caches the
   * result before returning. The factory runs at most once per call; if
   * concurrent callers race on a missed key, each runs the factory
   * independently (no single-flight protection — see PR-29 backlog for
   * stampede mitigation work).
   */
  getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: { ttlSeconds?: number; tags?: readonly string[] }
  ): Promise<T>;

  /**
   * Remove a key. No-op if the key is absent (does not throw).
   */
  delete(key: string): Promise<void>;

  /**
   * Invalidate every key tagged with `tag`. Tags are attached at write
   * time via `set({ tags })` or `getOrSet({ tags })`.
   */
  invalidateByTag(tag: string): Promise<void>;

  /**
   * True if the key has a non-expired entry. Cheaper than `get` on
   * adapters that don't need to decode the payload (Redis EXISTS).
   */
  has(key: string): Promise<boolean>;
}
