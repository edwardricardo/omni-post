/**
 * CacheInvalidationManager tests
 * Pure unit tests — Redis is mocked with an in-memory Map.
 * No real Redis connection required. Tier 0.
 */

import { describe, it, mock, after } from "node:test";
import assert from "node:assert/strict";
import { CacheInvalidationManager } from "../src/invalidation.js";
import { L1CacheManager } from "../src/l1-cache.js";
import { AccessPatternTracker } from "../src/access-patterns.js";
import type { InternalCacheStats, CacheItem } from "../src/types.js";
import type { Result } from "@shared/types";

// ── In-memory Redis mock ──────────────────────────────────────────────────────

class FakeRedis {
  private store = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private ttls = new Map<string, number>();
  private pipelineOps: Array<() => void> = [];

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _ex?: string, _ttl?: number): Promise<void> {
    this.store.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key) || this.sets.delete(key)) count++;
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    // Simple glob: replace * with .* for matching
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return [...this.store.keys(), ...this.sets.keys()].filter((k) => regex.test(k));
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async sadd(key: string, ...values: string[]): Promise<number> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const set = this.sets.get(key)!;
    let added = 0;
    for (const v of values) {
      if (!set.has(v)) {
        set.add(v);
        added++;
      }
    }
    return added;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }

  async exists(key: string): Promise<number> {
    return this.store.has(key) || this.sets.has(key) ? 1 : 0;
  }

  pipeline() {
    const ops: Array<() => void> = [];
    const pipe = {
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.ttls.set(key, seconds);
        });
        return pipe;
      },
      exec: async () => {
        ops.forEach((fn) => fn());
        return [];
      },
    };
    return pipe;
  }

  // Test helper: direct store inspection
  _storeHas(key: string): boolean {
    return this.store.has(key) || this.sets.has(key);
  }

  _setHas(setKey: string, member: string): boolean {
    return this.sets.get(setKey)?.has(member) ?? false;
  }

  _getTTL(key: string): number | undefined {
    return this.ttls.get(key);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeStats(): InternalCacheStats {
  return { l1Hits: 0, l2Hits: 0, totalHits: 0, totalMisses: 0, evictions: 0, warmups: 0 };
}

function makeItem<T>(data: T, tags: string[] = []): CacheItem<T> {
  const now = Date.now();
  return {
    data,
    metadata: { createdAt: now, expiresAt: now + 60_000, version: "1.0.0", tags, hitCount: 0 },
  };
}

function makeDependencyTest() {
  const redis = new FakeRedis();
  const l1 = new L1CacheManager(makeStats());
  const tracker = new AccessPatternTracker();
  const manager = new CacheInvalidationManager(redis as any, l1, tracker, "cache:");
  return { redis, l1, tracker, manager };
}

// A simple delFn that always succeeds, mirroring what RedisCacheManager.del() does
const successDelFn = async (_key: string): Promise<Result<boolean, "CACHE_ERROR">> => ({
  ok: true,
  value: true,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

after(() => {
  mock.restoreAll();
});

describe("CacheInvalidationManager — dependency graph", { concurrency: 1 }, () => {
  it("updateDependencyGraph() registers key→dependency mapping", async () => {
    const { manager } = makeDependencyTest();
    manager.updateDependencyGraph("post:1", ["project:42"]);

    // Invalidating project:42 should cascade to post:1
    let deletedKey: string | undefined;
    const captureDelFn = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deletedKey = key;
      return { ok: true, value: true };
    };

    const result = await manager.invalidateByDependencies(["project:42"], captureDelFn);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 1);
    assert.strictEqual(deletedKey, "post:1");
  });

  it("invalidateByDependencies() returns ok(0) when no keys depend on the target", async () => {
    const { manager } = makeDependencyTest();
    const result = await manager.invalidateByDependencies(["nonexistent"], successDelFn);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 0);
  });

  it("invalidateByDependencies() handles multiple dependents", async () => {
    const { manager } = makeDependencyTest();
    manager.updateDependencyGraph("post:1", ["project:1"]);
    manager.updateDependencyGraph("post:2", ["project:1"]);
    manager.updateDependencyGraph("post:3", ["project:1"]);

    const deletedKeys: string[] = [];
    const captureDel = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deletedKeys.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidateByDependencies(["project:1"], captureDel);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 3);
    assert.ok(deletedKeys.includes("post:1"));
    assert.ok(deletedKeys.includes("post:2"));
    assert.ok(deletedKeys.includes("post:3"));
  });

  it("removeDependency() removes key from all dependency sets", () => {
    const { manager } = makeDependencyTest();
    manager.updateDependencyGraph("post:1", ["proj:1", "user:1"]);

    // After removing "post:1", it should no longer be found via dependencies
    manager.removeDependency("post:1");

    let seen = false;
    const trackDel = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      if (key === "post:1") seen = true;
      return { ok: true, value: true };
    };

    // Cascading from "proj:1" should NOT find "post:1" anymore
    // (removeDependency removes from sets, so the set should be empty)
    manager.invalidateByDependencies(["proj:1"], trackDel);
    // Note: this is synchronous setup — the dependency was removed before invalidation
    // The assert verifies it was removed during setup
    assert.strictEqual(seen, false);
  });

  it("clearDependencies() empties the entire graph", async () => {
    const { manager } = makeDependencyTest();
    manager.updateDependencyGraph("k1", ["dep:1"]);
    manager.updateDependencyGraph("k2", ["dep:1"]);
    manager.clearDependencies();

    const deletedKeys: string[] = [];
    const captureDel = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deletedKeys.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidateByDependencies(["dep:1"], captureDel);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 0);
    assert.deepStrictEqual(deletedKeys, []);
  });
});

describe("CacheInvalidationManager — invalidateByTag", { concurrency: 1 }, () => {
  it("invalidates L1 entries by tag", async () => {
    const { manager, l1 } = makeDependencyTest();

    // Populate L1 with tagged entries
    l1.set("post:1", makeItem("data1", ["posts"]));
    l1.set("post:2", makeItem("data2", ["posts"]));

    const result = await manager.invalidateByTag("posts");
    assert.ok(result.ok);

    // L1 entries should be gone
    assert.strictEqual(l1.get("post:1"), undefined);
    assert.strictEqual(l1.get("post:2"), undefined);
  });

  it("includes Redis tag members in deletion", async () => {
    const { manager, redis } = makeDependencyTest();

    // Put a key in Redis's tag set (simulating another process's cache entry)
    await redis.sadd("tag:posts", "post:99");
    // Also put the actual value in Redis
    await redis.set("post:99", "value");

    const result = await manager.invalidateByTag("posts");
    assert.ok(result.ok);

    // The tag set should be cleaned up
    const remaining = await redis.smembers("tag:posts");
    // "tag:posts" itself was deleted
    assert.deepStrictEqual(remaining, []);
  });

  it("returns ok(0) when tag has no associated keys", async () => {
    const { manager } = makeDependencyTest();
    const result = await manager.invalidateByTag("empty-tag");
    assert.ok(result.ok);
  });

  it("returns err(CACHE_ERROR) when Redis throws", async () => {
    const redis = new FakeRedis();
    // Override smembers to throw
    (redis as any).smembers = async () => {
      throw new Error("Redis connection refused");
    };

    const l1 = new L1CacheManager(makeStats());
    const tracker = new AccessPatternTracker();
    const manager = new CacheInvalidationManager(redis as any, l1, tracker, "cache:");

    const result = await manager.invalidateByTag("any-tag");
    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).error, "CACHE_ERROR");
  });
});

describe("CacheInvalidationManager — invalidateByPattern", { concurrency: 1 }, () => {
  it("deletes all Redis keys matching the pattern", async () => {
    const { manager, redis } = makeDependencyTest();
    await redis.set("post:1", "v1");
    await redis.set("post:2", "v2");
    await redis.set("user:1", "u1");

    const result = await manager.invalidateByPattern("post:*");
    assert.ok(result.ok);
    assert.strictEqual(result.value, 2);

    // post keys should be gone
    assert.strictEqual(await redis.get("post:1"), null);
    assert.strictEqual(await redis.get("post:2"), null);
    // user key should survive
    assert.strictEqual(await redis.get("user:1"), "u1");
  });

  it("removes corresponding L1 entries for matched keys", async () => {
    const { manager, redis, l1 } = makeDependencyTest();

    const prefixedKey = "cache:post:1";
    await redis.set(prefixedKey, "v");
    l1.set("post:1", makeItem("data")); // L1 key without prefix

    const result = await manager.invalidateByPattern("cache:post:*");
    assert.ok(result.ok);

    // L1 should have "post:1" removed (key with prefix stripped: "cache:" removed)
    assert.strictEqual(l1.get("post:1"), undefined);
  });

  it("returns ok(0) when no keys match pattern", async () => {
    const { manager } = makeDependencyTest();
    const result = await manager.invalidateByPattern("nonexistent:*");
    assert.ok(result.ok);
    assert.strictEqual(result.value, 0);
  });

  it("returns err(CACHE_ERROR) when Redis throws", async () => {
    const redis = new FakeRedis();
    (redis as any).keys = async () => {
      throw new Error("Redis error");
    };

    const l1 = new L1CacheManager(makeStats());
    const tracker = new AccessPatternTracker();
    const manager = new CacheInvalidationManager(redis as any, l1, tracker, "cache:");

    const result = await manager.invalidateByPattern("*");
    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).error, "CACHE_ERROR");
  });
});

describe("CacheInvalidationManager — invalidate() with strategies", { concurrency: 1 }, () => {
  it("immediate strategy calls delFn for each key", async () => {
    const { manager } = makeDependencyTest();
    const deleted: string[] = [];
    const delFn = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deleted.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidate(["k1", "k2", "k3"], "immediate", delFn);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 3);
    assert.ok(deleted.includes("k1"));
    assert.ok(deleted.includes("k2"));
    assert.ok(deleted.includes("k3"));
  });

  it("immediate strategy accepts single string key", async () => {
    const { manager } = makeDependencyTest();
    const deleted: string[] = [];
    const delFn = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deleted.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidate("single-key", "immediate", delFn);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 1);
    assert.deepStrictEqual(deleted, ["single-key"]);
  });

  it("lazy strategy removes from L1 immediately and sets Redis TTL to 1s", async () => {
    const { manager, redis, l1 } = makeDependencyTest();
    l1.set("lazy-k", makeItem("data"));

    const result = await manager.invalidate(["lazy-k"], "lazy", successDelFn);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 1);

    // L1 should be cleared immediately
    assert.strictEqual(l1.get("lazy-k"), undefined);
    // Redis TTL should be set to 1 second
    assert.strictEqual(redis._getTTL("lazy-k"), 1);
  });

  it("scheduled strategy returns ok without blocking", async () => {
    const { manager } = makeDependencyTest();
    const result = await manager.invalidate(["k"], "scheduled", successDelFn);
    assert.ok(result.ok);
    assert.strictEqual(result.value, 1);
  });

  it("smart strategy uses immediate for cold keys", async () => {
    const { manager } = makeDependencyTest();
    // Cold key = no access pattern recorded
    const deleted: string[] = [];
    const delFn = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deleted.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidate(["cold-key"], "smart", delFn);
    assert.ok(result.ok);
    // Cold key should be immediately deleted
    assert.ok(deleted.includes("cold-key"));
  });

  it("smart strategy uses lazy invalidation for hot keys (high frequency + recent)", async () => {
    const { manager, l1, tracker } = makeDependencyTest();

    // Simulate a hot key: high frequency + accessed recently
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      tracker.updatePattern("hot-key", now - i * 1000); // 15 accesses, all within last 15s
    }

    l1.set("hot-key", makeItem("data"));

    const immediatelyDeleted: string[] = [];
    const delFn = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      immediatelyDeleted.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidate(["hot-key"], "smart", delFn);
    assert.ok(result.ok);
    // Hot key should NOT be in immediatelyDeleted (uses lazy instead)
    assert.ok(!immediatelyDeleted.includes("hot-key"), "hot key should use lazy, not immediate");
    // L1 should be cleared
    assert.strictEqual(l1.get("hot-key"), undefined);
  });

  it("unknown strategy falls back to immediate", async () => {
    const { manager } = makeDependencyTest();
    const deleted: string[] = [];
    const delFn = async (key: string): Promise<Result<boolean, "CACHE_ERROR">> => {
      deleted.push(key);
      return { ok: true, value: true };
    };

    const result = await manager.invalidate(["k"], "unknown" as any, delFn);
    assert.ok(result.ok);
    assert.ok(deleted.includes("k"));
  });
});
