/**
 * @file redis-cache-adapter.ts
 * @description CachePort adapter that wraps `RedisCacheManager`. Preserves the
 *              underlying L1 (in-memory LRU) + L2 (Redis) tiering, tag-based
 *              invalidation, metrics, and access-pattern tracking — narrowing
 *              the surface to the canonical `CachePort` contract so callers
 *              don't couple to the manager's full API or its `Result`-typed
 *              returns.
 *
 *              Error policy: cache failures degrade silently for non-blocking
 *              ops (`set`, `delete`, `invalidateByTag`, `has` → log + treat as
 *              best-effort) and for `get` (cache miss semantics on error).
 *              `getOrSet` re-runs the factory if the cached read errored, and
 *              propagates factory errors to the caller (the value, not the
 *              cache, is what they asked for). `claim` is the exception: it has
 *              lock semantics, so a claim Redis cannot decide rejects instead of
 *              degrading.
 * @layer infrastructure
 */

import type { CachePort, CacheWriteOptions } from "@ports/core";
import pino from "pino";
import type { RedisCacheManager } from "./cache-manager.js";

const logger = pino({
  name: "redis-cache-adapter",
  level: process.env.LOG_LEVEL || "info",
});

export class RedisCacheAdapter implements CachePort {
  constructor(private readonly manager: RedisCacheManager) {}

  /**
   * @method get
   * @description Reads a value through the manager; a failed read is logged and treated as a miss.
   * @param key - The key to read.
   * @returns The cached value, or null on a miss or a failed read.
   */
  async get<T>(key: string): Promise<T | null> {
    const result = await this.manager.get<T>(key);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache get failed; treating as miss");
      return null;
    }
    return result.value;
  }

  /**
   * @method set
   * @description Writes a value through the manager, best-effort: a failed write is logged.
   * @param key - The key to write.
   * @param value - The value to store.
   * @param options - TTL in seconds and tags; the manager's defaults apply to what is omitted.
   */
  async set<T>(key: string, value: T, options?: CacheWriteOptions): Promise<void> {
    const managerOptions: { ttl?: number; tags?: string[] } = {};
    if (options?.ttlSeconds !== undefined) {
      managerOptions.ttl = options.ttlSeconds;
    }
    if (options?.tags !== undefined) {
      managerOptions.tags = [...options.tags];
    }
    const result = await this.manager.set(key, value, managerOptions);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache set failed; continuing");
    }
  }

  /**
   * @method getOrSet
   * @description Cache-aside: returns the cached value, or runs `factory` and caches its result.
   *   A failed read counts as a miss, and a failed write of the fresh value is logged.
   * @param key - The key to read and write.
   * @param factory - Produces the value on a miss; its rejection reaches the caller.
   * @param options - TTL in seconds and tags for the write.
   * @returns The cached value, or the factory's value.
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheWriteOptions
  ): Promise<T> {
    const cached = await this.manager.get<T>(key);
    if (cached.ok && cached.value !== null) {
      return cached.value;
    }

    const value = await factory();

    const managerOptions: { ttl?: number; tags?: string[] } = {};
    if (options?.ttlSeconds !== undefined) {
      managerOptions.ttl = options.ttlSeconds;
    }
    if (options?.tags !== undefined) {
      managerOptions.tags = [...options.tags];
    }
    const setResult = await this.manager.set(key, value, managerOptions);
    if (!setResult.ok) {
      logger.warn(
        { key, error: setResult.error },
        "Cache set failed in getOrSet; returning factory value"
      );
    }
    return value;
  }

  /**
   * @method delete
   * @description Removes a key through the manager, best-effort: a failed delete is logged.
   * @param key - The key to remove.
   */
  async delete(key: string): Promise<void> {
    const result = await this.manager.del(key);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache delete failed; continuing");
    }
  }

  /**
   * @method invalidateByTag
   * @description Removes every key tagged with `tag`, best-effort: a failure is logged.
   * @param tag - The tag whose keys are removed.
   */
  async invalidateByTag(tag: string): Promise<void> {
    const result = await this.manager.invalidateByTag(tag);
    if (!result.ok) {
      logger.warn({ tag, error: result.error }, "Cache tag invalidation failed; continuing");
    }
  }

  /**
   * @method has
   * @description Checks whether a key exists; a failed check is logged and treated as absent.
   * @param key - The key to check.
   * @returns True when the key exists, false when it does not or the check failed.
   */
  async has(key: string): Promise<boolean> {
    const result = await this.manager.has(key);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache has() failed; treating as absent");
      return false;
    }
    return result.value;
  }

  /**
   * @method claim
   * @description Creates `key` on Redis for `ttlSeconds` when no entry holds it, through the
   *   manager's single `SET NX EX`. A claim Redis cannot decide rejects: answering false would
   *   hide the outage from the caller, and answering true would let it act without a claim. The
   *   manager has already logged the failure with its key, so the error names neither.
   * @param key - The key to claim.
   * @param ttlSeconds - How long the claim holds, in whole seconds.
   * @returns True when this call created the key, false when an unexpired entry already held it.
   */
  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.manager.claim(key, ttlSeconds);
    if (!result.ok) {
      throw new Error(`The cache could not decide the claim (${result.error})`);
    }
    return result.value;
  }
}
