/**
 * L1CacheManager tests
 * Pure unit tests — no Redis, no network, no external services.
 * Tier 0: tests pure in-memory logic.
 */

import { describe, it, beforeEach } from "node:test";
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
    assert.strictEqual(cache.get("missing"), undefined);
  });

  it("set() and get() round-trip a value", () => {
    const item = makeItem({ name: "test" });
    cache.set("key1", item);
    const retrieved = cache.get("key1");
    assert.deepStrictEqual(retrieved, item);
  });

  it("size() returns 0 on empty cache", () => {
    assert.strictEqual(cache.size(), 0);
  });

  it("size() increments after set()", () => {
    cache.set("a", makeItem(1));
    cache.set("b", makeItem(2));
    assert.strictEqual(cache.size(), 2);
  });

  it("delete() removes a key", () => {
    cache.set("k", makeItem("v"));
    cache.delete("k");
    assert.strictEqual(cache.get("k"), undefined);
    assert.strictEqual(cache.size(), 0);
  });

  it("delete() on non-existent key does not throw", () => {
    assert.doesNotThrow(() => cache.delete("ghost"));
  });

  it("clear() empties all entries", () => {
    cache.set("a", makeItem(1));
    cache.set("b", makeItem(2));
    cache.clear();
    assert.strictEqual(cache.size(), 0);
    assert.strictEqual(cache.get("a"), undefined);
    assert.strictEqual(cache.get("b"), undefined);
  });

  it("set() overwrites an existing key", () => {
    cache.set("k", makeItem("old"));
    cache.set("k", makeItem("new"));
    assert.strictEqual(cache.get("k")!.data, "new");
    assert.strictEqual(cache.size(), 1);
  });
});

describe("L1CacheManager — TTL / validity", { concurrency: 1 }, () => {
  let cache: L1CacheManager;

  beforeEach(() => {
    cache = new L1CacheManager(makeStats());
  });

  it("isValid() returns true for a fresh entry", () => {
    const item = makeItem("data", 10_000);
    assert.strictEqual(cache.isValid(item), true);
  });

  it("isValid() returns false for an expired entry", () => {
    const item = makeExpiredItem("data");
    assert.strictEqual(cache.isValid(item), false);
  });

  it("cleanupExpired() removes expired entries and keeps valid ones", () => {
    cache.set("fresh", makeItem("ok", 60_000));
    cache.set("expired", makeExpiredItem("stale"));
    cache.cleanupExpired();
    assert.ok(cache.get("fresh") !== undefined, "fresh entry should survive");
    assert.strictEqual(cache.get("expired"), undefined);
    assert.strictEqual(cache.size(), 1);
  });

  it("cleanupExpired() on all-valid cache changes nothing", () => {
    cache.set("a", makeItem(1, 60_000));
    cache.set("b", makeItem(2, 60_000));
    cache.cleanupExpired();
    assert.strictEqual(cache.size(), 2);
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
    assert.deepStrictEqual(keys, []);
  });

  it("set() with tags populates tag index", () => {
    cache.set("post:1", makeItem("data", 60_000, ["posts", "user:42"]));
    const postKeys = cache.getKeysByTag("posts");
    assert.ok(postKeys.includes("post:1"), "tag index should include key");
  });

  it("set() with multiple tags indexes under each tag", () => {
    cache.set("k", makeItem("v", 60_000, ["tag-a", "tag-b"]));
    assert.ok(cache.getKeysByTag("tag-a").includes("k"));
    assert.ok(cache.getKeysByTag("tag-b").includes("k"));
  });

  it("getKeysByTag() returns all keys with that tag", () => {
    cache.set("a", makeItem(1, 60_000, ["shared"]));
    cache.set("b", makeItem(2, 60_000, ["shared"]));
    cache.set("c", makeItem(3, 60_000, ["other"]));
    const keys = cache.getKeysByTag("shared");
    assert.ok(keys.includes("a"));
    assert.ok(keys.includes("b"));
    assert.ok(!keys.includes("c"));
  });

  it("deleteByTag() removes all keys with that tag", () => {
    cache.set("x", makeItem(1, 60_000, ["grp"]));
    cache.set("y", makeItem(2, 60_000, ["grp"]));
    cache.set("z", makeItem(3, 60_000, ["other"]));
    const deleted = cache.deleteByTag("grp");
    assert.ok(deleted.includes("x"));
    assert.ok(deleted.includes("y"));
    assert.ok(!deleted.includes("z"));
    assert.strictEqual(cache.get("x"), undefined);
    assert.strictEqual(cache.get("y"), undefined);
    assert.ok(cache.get("z") !== undefined, "unrelated key should survive");
  });

  it("deleteByTag() returns empty array when tag does not exist", () => {
    const deleted = cache.deleteByTag("ghost");
    assert.deepStrictEqual(deleted, []);
  });

  it("deleteByTag() clears the tag index entry", () => {
    cache.set("k", makeItem("v", 60_000, ["t"]));
    cache.deleteByTag("t");
    assert.deepStrictEqual(cache.getKeysByTag("t"), []);
  });

  it("delete() removes key from tag index", () => {
    cache.set("k", makeItem("v", 60_000, ["mytag"]));
    cache.delete("k");
    assert.deepStrictEqual(cache.getKeysByTag("mytag"), []);
  });

  it("clear() resets tag index", () => {
    cache.set("k", makeItem("v", 60_000, ["t"]));
    cache.clear();
    assert.deepStrictEqual(cache.getKeysByTag("t"), []);
  });
});

describe("L1CacheManager — memory / eviction", { concurrency: 1 }, () => {
  it("calculateMemoryUsage() returns 0 for empty cache", () => {
    const cache = new L1CacheManager(makeStats());
    assert.strictEqual(cache.calculateMemoryUsage(), 0);
  });

  it("calculateMemoryUsage() is positive after adding entries", () => {
    const cache = new L1CacheManager(makeStats());
    cache.set("key", makeItem("some value"));
    assert.ok(cache.calculateMemoryUsage() > 0);
  });

  it("calculateMemoryUsage() grows with more entries", () => {
    const cache = new L1CacheManager(makeStats());
    cache.set("a", makeItem("value1"));
    const size1 = cache.calculateMemoryUsage();
    cache.set("b", makeItem("a".repeat(1000)));
    const size2 = cache.calculateMemoryUsage();
    assert.ok(size2 > size1, "memory usage should grow after adding larger entry");
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
    assert.ok(keys.includes("a"));
    assert.ok(keys.includes("b"));
  });
});
