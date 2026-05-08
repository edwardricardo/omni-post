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
 *              cache, is what they asked for).
 * @layer infrastructure
 */

import type { CachePort } from "@ports/core";
import pino from "pino";
import type { RedisCacheManager } from "./cache-manager.js";

const logger = pino({
  name: "redis-cache-adapter",
  level: process.env.LOG_LEVEL || "info",
});

export class RedisCacheAdapter implements CachePort {
  constructor(private readonly manager: RedisCacheManager) {}

  async get<T>(key: string): Promise<T | null> {
    const result = await this.manager.get<T>(key);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache get failed; treating as miss");
      return null;
    }
    return result.value;
  }

  async set<T>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number; tags?: readonly string[] }
  ): Promise<void> {
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

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: { ttlSeconds?: number; tags?: readonly string[] }
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

  async delete(key: string): Promise<void> {
    const result = await this.manager.del(key);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache delete failed; continuing");
    }
  }

  async invalidateByTag(tag: string): Promise<void> {
    const result = await this.manager.invalidateByTag(tag);
    if (!result.ok) {
      logger.warn({ tag, error: result.error }, "Cache tag invalidation failed; continuing");
    }
  }

  async has(key: string): Promise<boolean> {
    const result = await this.manager.has(key);
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Cache has() failed; treating as absent");
      return false;
    }
    return result.value;
  }
}
