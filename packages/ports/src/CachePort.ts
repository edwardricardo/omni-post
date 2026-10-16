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
 *              revalidate, jitter) is intentionally NOT part of the
 *              port surface — adding it requires hot-key metrics and
 *              per-policy decisions.
 *
 *              Two kinds of method share the port. `get`, `set`, `getOrSet`,
 *              `delete`, `invalidateByTag` and `has` have cache semantics:
 *              an adapter may absorb a backend failure and answer as if the
 *              key were absent, because a missed cache entry only costs a
 *              recomputation. `claim` has lock semantics: its answer decides
 *              who acts, so it never guesses.
 * @layer domain
 */

/** The write options `set` and `getOrSet` share. */
export interface CacheWriteOptions {
  /** TTL in seconds; when omitted, the adapter's configured default applies. */
  ttlSeconds?: number;
  /** Groups the key for `invalidateByTag`. */
  tags?: readonly string[];
}

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
  set<T>(key: string, value: T, options?: CacheWriteOptions): Promise<void>;

  /**
   * Cache-aside: returns cached value or invokes `factory` + caches
   * the result before returning. The factory runs at most once per
   * call; if concurrent callers race on a missed key, each runs the
   * factory independently (no single-flight protection).
   */
  getOrSet<T>(key: string, factory: () => Promise<T>, options?: CacheWriteOptions): Promise<T>;

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

  /**
   * Atomically creates `key` for `ttlSeconds` if no unexpired entry holds it.
   * Lock semantics, unlike the cache-semantics methods above: among any
   * number of concurrent callers, on any number of instances sharing the
   * backend, exactly one resolves `true`; every other caller resolves
   * `false` until the entry expires. Use it for an exclusive claim, such as
   * a per-key throttle, never for cache-aside.
   *
   * It REJECTS when the claim cannot be decided (the backend is unreachable
   * or refuses the command, or `ttlSeconds` is not a positive whole number
   * of seconds). It never absorbs that failure into `true` or `false`: a
   * caller that treated an outage as a won claim would act without one, and
   * one that treated it as a lost claim would never learn of the outage.
   */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}
