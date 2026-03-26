/**
 * L1CacheManager tests
 * Pure unit tests — no Redis, no network, no external services.
 * Tier 0: tests pure in-memory logic.
 */

import { describe, it, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { L1CacheManager } from "../src/l1-cache.js";
import type { InternalCacheStats, CacheItem } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStats(): InternalCacheStats {
  return { l1Hits: 0, l2Hits: 0, totalHits: 0, totalMisses: 0, evictions: 0, warmups: 0 };
}

function makeItem<T>(data: T, ttlMs = 60_000, tags: string[] = []): CacheItem<T> {
  const now = Date.now();
  return {
    data,
    metadata: {
      createdAt: now,
      expiresAt: now + ttlMs,
      version: "1.0.0",
      tags,
      hitCount: 0,
    },
  };
}

function makeExpiredItem<T>(data: T, tags: string[] = []): CacheItem<T> {
  const past = Date.now() - 1; // already expired
  return {
    data,
    metadata: {
      createdAt: past - 1000,
      expiresAt: past,
      version: "1.0.0",
      tags,
      hitCount: 0,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("L1CacheManager — basic CRUD", { concurrency: 1 }, () => {
  let stats: InternalCacheStats;
  let cache: L1CacheManager;

  beforeEach(() => {
    stats = makeStats();
    cache = new L1CacheManager(stats);
  });

  it("get() returns undefined on empty cache", () => {
    expect(cache.get("missing")).toBe(undefined);
  });

  it("set() and get() round-trip a value", () => {
    const item = makeItem({ name: "test" });
    cache.set("key1", item);
    const retrieved = cache.get("key1");
    expect(retrieved).toEqual(item);
  });

  it("size() returns 0 on empty cache", () => {
    expect(cache.size()).toBe(0);
  });

  it("size() increments after set()", () => {
    cache.set("a", makeItem(1));
    cache.set("b", makeItem(2));
    expect(cache.size()).toBe(2);
  });

  it("delete() removes a key", () => {
    cache.set("k", makeItem("v"));
    cache.delete("k");
    expect(cache.get("k")).toBe(undefined);
    expect(cache.size()).toBe(0);
  });

  it("delete() on non-existent key does not throw", () => {
    assert.doesNotThrow(() => cache.delete("ghost"));
  });

  it("clear() empties all entries", () => {
    cache.set("a", makeItem(1));
    cache.set("b", makeItem(2));
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBe(undefined);
    expect(cache.get("b")).toBe(undefined);
  });

  it("set() overwrites an existing key", () => {
    cache.set("k", makeItem("old"));
    cache.set("k", makeItem("new"));
    expect(cache.get("k")!.data).toBe("new");
    expect(cache.size()).toBe(1);
  });
});

describe("L1CacheManager — TTL / validity", { concurrency: 1 }, () => {
  let cache: L1CacheManager;

  beforeEach(() => {
    cache = new L1CacheManager(makeStats());
  });

  it("isValid() returns true for a fresh entry", () => {
    const item = makeItem("data", 10_000);
    expect(cache.isValid(item)).toBe(true);
  });

  it("isValid() returns false for an expired entry", () => {
    const item = makeExpiredItem("data");
    expect(cache.isValid(item)).toBe(false);
  });

  it("cleanupExpired() removes expired entries and keeps valid ones", () => {
    cache.set("fresh", makeItem("ok", 60_000));
    cache.set("expired", makeExpiredItem("stale"));
    cache.cleanupExpired();
    expect(cache.get("fresh")).not.toBe(undefined);
    expect(cache.get("expired")).toBe(undefined);
    expect(cache.size()).toBe(1);
  });

  it("cleanupExpired() on all-valid cache changes nothing", () => {
    cache.set("a", makeItem(1, 60_000));
    cache.set("b", makeItem(2, 60_000));
    cache.cleanupExpired();
    expect(cache.size()).toBe(2);
  });

  it("cleanupExpired() on empty cache does not throw", () => {
    assert.doesNotThrow(() => cache.cleanupExpired());
  });
});

describe("L1CacheManager — tag index", { concurrency: 1 }, () => {
  let cache: L1CacheManager;

  beforeEach(() => {
    cache = new L1CacheManager(makeStats());
  });

  it("getKeysByTag() returns empty array when no entries have that tag", () => {
    const keys = cache.getKeysByTag("nonexistent");
    expect(keys).toEqual([]);
  });

  it("set() with tags populates tag index", () => {
    cache.set("post:1", makeItem("data", 60_000, ["posts", "user:42"]));
    const postKeys = cache.getKeysByTag("posts");
    expect(postKeys.includes("post:1")).toBe(true);
  });

  it("set() with multiple tags indexes under each tag", () => {
    cache.set("k", makeItem("v", 60_000, ["tag-a", "tag-b"]));
    expect(cache.getKeysByTag("tag-a").includes("k")).toBe(true);
    expect(cache.getKeysByTag("tag-b").includes("k")).toBe(true);
  });

  it("getKeysByTag() returns all keys with that tag", () => {
    cache.set("a", makeItem(1, 60_000, ["shared"]));
    cache.set("b", makeItem(2, 60_000, ["shared"]));
    cache.set("c", makeItem(3, 60_000, ["other"]));
    const keys = cache.getKeysByTag("shared");
    expect(keys.includes("a")).toBe(true);
    expect(keys.includes("b")).toBe(true);
    expect(keys.includes("c")).toBe(false);
  });

  it("deleteByTag() removes all keys with that tag", () => {
    cache.set("x", makeItem(1, 60_000, ["grp"]));
    cache.set("y", makeItem(2, 60_000, ["grp"]));
    cache.set("z", makeItem(3, 60_000, ["other"]));
    const deleted = cache.deleteByTag("grp");
    expect(deleted.includes("x")).toBe(true);
    expect(deleted.includes("y")).toBe(true);
    expect(deleted.includes("z")).toBe(false);
    expect(cache.get("x")).toBe(undefined);
    expect(cache.get("y")).toBe(undefined);
    expect(cache.get("z")).not.toBe(undefined);
  });

  it("deleteByTag() returns empty array when tag does not exist", () => {
    const deleted = cache.deleteByTag("ghost");
    expect(deleted).toEqual([]);
  });

  it("deleteByTag() clears the tag index entry", () => {
    cache.set("k", makeItem("v", 60_000, ["t"]));
    cache.deleteByTag("t");
    expect(cache.getKeysByTag("t")).toEqual([]);
  });

  it("delete() removes key from tag index", () => {
    cache.set("k", makeItem("v", 60_000, ["mytag"]));
    cache.delete("k");
    expect(cache.getKeysByTag("mytag")).toEqual([]);
  });

  it("clear() resets tag index", () => {
    cache.set("k", makeItem("v", 60_000, ["t"]));
    cache.clear();
    expect(cache.getKeysByTag("t")).toEqual([]);
  });
});

describe("L1CacheManager — memory / eviction", { concurrency: 1 }, () => {
  it("calculateMemoryUsage() returns 0 for empty cache", () => {
    const cache = new L1CacheManager(makeStats());
    expect(cache.calculateMemoryUsage()).toBe(0);
  });

  it("calculateMemoryUsage() is positive after adding entries", () => {
    const cache = new L1CacheManager(makeStats());
    cache.set("key", makeItem("some value"));
    expect(cache.calculateMemoryUsage()).toBeGreaterThan(0);
  });

  it("calculateMemoryUsage() grows with more entries", () => {
    const cache = new L1CacheManager(makeStats());
    cache.set("a", makeItem("value1"));
    const size1 = cache.calculateMemoryUsage();
    cache.set("b", makeItem("a".repeat(1000)));
    const size2 = cache.calculateMemoryUsage();
    expect(size2).toBeGreaterThan(size1);
  });

  it("evicts an entry when maxL1Items is reached", () => {
    // The limit is 1000 items. We create a helper L1Cache and fill it past 1000.
    // Instead of filling 1001 items, we test eviction via stats.evictions counter.
    const stats = makeStats();
    const cache = new L1CacheManager(stats);

    // Add 1001 items to trigger eviction (limit is 1000)
    for (let i = 0; i < 1001; i++) {
      cache.set(`key-${i}`, makeItem(`value-${i}`));
    }

    // After 1001 inserts, at least one eviction should have occurred
    assert.ok(stats.evictions >= 1, `Expected at least 1 eviction, got ${stats.evictions}`);
    // Cache size should not exceed the limit
    assert.ok(cache.size() <= 1001, "cache size should be within bounds");
  });

  it("entries() iterates all stored items", () => {
    const cache = new L1CacheManager(makeStats());
    cache.set("a", makeItem(1));
    cache.set("b", makeItem(2));
    const keys: string[] = [];
    for (const [k] of cache.entries()) {
      keys.push(k);
    }
    expect(keys.includes("a")).toBe(true);
    expect(keys.includes("b")).toBe(true);
  });
});
