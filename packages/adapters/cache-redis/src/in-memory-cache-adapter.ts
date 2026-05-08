/**
 * @file in-memory-cache-adapter.ts
 * @description Pure in-process implementation of `CachePort` — `Map`-backed
 *              storage, per-entry TTL, tag → key reverse index for
 *              `invalidateByTag`, optional periodic cleanup via
 *              `BackgroundTaskScheduler`. No Redis dependency.
 *
 *              Intended uses:
 *                - Unit tests (deterministic, no I/O, no shared state when each
 *                  test instantiates its own adapter).
 *                - Per-process scopes where cross-pod coherence is not a
 *                  requirement (rare — most production callers should use the
 *                  Redis adapter for cross-instance consistency).
 *
 *              Not intended for production cross-pod caching: each process
 *              keeps its own Map, so writes and invalidations do not propagate
 *              across instances.
 * @layer infrastructure
 */

import type { CachePort } from "@ports/core";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

interface Entry<T> {
  value: T;
  expiresAt: number;
  tags: readonly string[];
}

const DEFAULT_TTL_SECONDS = 300;
const CLEANUP_INTERVAL_MS = 60_000;

export interface InMemoryCacheAdapterOptions {
  /**
   * Default TTL applied when callers omit `ttlSeconds`. Defaults to 300s,
   * mirroring the Redis adapter's default, so test behavior matches prod
   * defaults without callers having to specify TTL twice.
   */
  defaultTtlSeconds?: number;

  /**
   * When provided, registers a recurring task that drops expired entries.
   * Without it, expired entries are still treated as misses on read but
   * remain in memory until overwritten or `clear()`-ed (acceptable for
   * tests; pass a scheduler in long-lived per-process scopes).
   */
  scheduler?: BackgroundTaskScheduler;

  /**
   * Stable id for the cleanup task. Defaults to a constant; override only
   * when running multiple adapters in the same scheduler scope (rare).
   */
  cleanupTaskId?: string;
}

export class InMemoryCacheAdapter implements CachePort {
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly defaultTtlSeconds: number;
  private readonly scheduler: BackgroundTaskScheduler | undefined;
  private readonly cleanupTaskId: string;

  constructor(options: InMemoryCacheAdapterOptions = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.scheduler = options.scheduler;
    this.cleanupTaskId = options.cleanupTaskId ?? "in-memory-cache-cleanup";

    if (this.scheduler) {
      this.scheduler.register(this.cleanupTaskId, () => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.dropEntry(key, entry);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number; tags?: readonly string[] }
  ): Promise<void> {
    const ttl = options?.ttlSeconds ?? this.defaultTtlSeconds;
    const tags = options?.tags ?? [];

    const previous = this.store.get(key);
    if (previous) {
      this.removeFromTagIndex(key, previous.tags);
    }

    const entry: Entry<T> = {
      value,
      expiresAt: Date.now() + ttl * 1000,
      tags,
    };
    this.store.set(key, entry);

    for (const tag of tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: { ttlSeconds?: number; tags?: readonly string[] }
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  async delete(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (!entry) return;
    this.dropEntry(key, entry);
  }

  async invalidateByTag(tag: string): Promise<void> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    for (const key of keys) {
      const entry = this.store.get(key);
      if (entry) {
        this.store.delete(key);
        for (const otherTag of entry.tags) {
          if (otherTag === tag) continue;
          const otherKeys = this.tagIndex.get(otherTag);
          if (otherKeys) {
            otherKeys.delete(key);
            if (otherKeys.size === 0) this.tagIndex.delete(otherTag);
          }
        }
      }
    }
    this.tagIndex.delete(tag);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.dropEntry(key, entry);
      return false;
    }
    return true;
  }

  /**
   * Tear down: unregister the cleanup task (if any) and drop all entries.
   * Tests and per-process scopes call this before discarding the instance.
   */
  close(): void {
    if (this.scheduler) {
      this.scheduler.unregister(this.cleanupTaskId);
    }
    this.store.clear();
    this.tagIndex.clear();
  }

  private dropEntry(key: string, entry: Entry<unknown>): void {
    this.store.delete(key);
    this.removeFromTagIndex(key, entry.tags);
  }

  private removeFromTagIndex(key: string, tags: readonly string[]): void {
    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) this.tagIndex.delete(tag);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.dropEntry(key, entry);
      }
    }
  }
}
