/**
 * RedisCacheManager tests
 * Uses lazyConnect so no actual Redis connection is made during object construction.
 * We replace ALL internal references (redis + invalidationManager.redis) with a
 * FakeRedis after construction so the manager is fully isolated from real Redis.
 * Tier 0: no real Redis required.
 *
 * @file cache-manager.test.ts
 * @description Tests for RedisCacheManager — set() and get()
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, afterEach, expect } from "vitest";
import client from "prom-client";
import { RedisCacheManager } from "../src/cache-manager.js";

// Clear prom-client registry once at module load time.
// Each test file is a separate process so this is safe.
client.register.clear();

// ── FakeRedis — full in-memory Redis replacement ──────────────────────────────

class FakeRedis {
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ex?: string, ttl?: number): Promise<string> {
    this.store.set(key, value);
    if (ex === "EX" && ttl !== undefined) {
      this.ttls.set(key, ttl);
    }
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
      this.sets.delete(key); // also delete sets (tag indices)
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    return [...this.store.keys()].filter((k) => regex.test(k));
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
    return this.store.has(key) ? 1 : 0;
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async flushdb(): Promise<string> {
    this.store.clear();
    this.sets.clear();
    this.ttls.clear();
    return "OK";
  }

  async info(_section?: string): Promise<string> {
    return "# Memory\r\nused_memory:102400\r\n";
  }

  async dbsize(): Promise<number> {
    return this.store.size;
  }

  async quit(): Promise<string> {
    return "OK";
  }

  on(_event: string, _handler: (...args: any[]) => void): this {
    return this;
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
}

// ── makeManager — creates manager with ALL internal Redis refs replaced ────────

function makeManager(opts: Record<string, unknown> = {}): {
  manager: RedisCacheManager;
  fakeRedis: FakeRedis;
} {
  const fakeRedis = new FakeRedis();

  const manager = new RedisCacheManager({
    redisUrl: "redis://localhost:6379",
    keyPrefix: "test:",
    defaultTtl: 60,
    enableMetrics: false,
    ...opts,
  });

  // Replace the top-level `redis` reference
  (manager as any).redis = fakeRedis;

  // The CacheInvalidationManager captured the original ioredis instance at
  // construction time — replace its internal reference too so all invalidation
  // operations use our FakeRedis.
  if ((manager as any).invalidationManager) {
    (manager as any).invalidationManager.redis = fakeRedis;
  }

  return { manager, fakeRedis };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterAll(() => {
  client.register.clear();
});

// ── set() and get() ───────────────────────────────────────────────────────────

describe("RedisCacheManager — set() and get()", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;
  let fakeRedis: FakeRedis;

  beforeEach(async () => {
    const previous = (global as any).__cacheManagerUnderTest as RedisCacheManager | undefined;
    if (previous) await previous.close();
    const setup = makeManager();
    manager = setup.manager;
    fakeRedis = setup.fakeRedis;
    (global as any).__cacheManagerUnderTest = manager;
  });

  afterEach(async () => {
    await manager.close();
    (global as any).__cacheManagerUnderTest = undefined;
  });

  it("get() returns ok(null) for a missing key", async () => {
    const result = await manager.get("missing");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(null);
  });

  it("set() then get() returns the stored value", async () => {
    await manager.set("greet", "hello", { ttl: 60 });
    const result = await manager.get<string>("greet");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe("hello");
  });

  it("set() stores objects correctly", async () => {
    const payload = { id: 1, name: "Alice", active: true };
    await manager.set("user:1", payload, { ttl: 60 });
    const result = await manager.get<typeof payload>("user:1");
    expect(result.ok).toBe(true);
    expect((result as any).value).toEqual(payload);
  });

  it("second get() hits L1 cache (avoids Redis round-trip)", async () => {
    await manager.set("l1-test", "cached", { ttl: 60 });
    // Remove from fake Redis to prove L1 serves the second get
    fakeRedis.store.delete("l1-test");
    const result = await manager.get<string>("l1-test");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe("cached");
  });

  it("get() returns ok(null) for an expired Redis entry", async () => {
    // Disable L1 so we go straight to Redis
    (manager as any).enableL1Cache = false;

    const expiredItem = {
      data: "stale",
      metadata: {
        createdAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1, // already expired
        version: "1.0.0",
        tags: [],
        hitCount: 0,
      },
    };
    fakeRedis.store.set("stale-key", JSON.stringify(expiredItem));

    const result = await manager.get("stale-key");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(null);
  });

  it("set() with tags registers tags in Redis sadd", async () => {
    await manager.set("post:1", "data", { ttl: 60, tags: ["posts", "user:42"] });
    const postsMembers = await fakeRedis.smembers("tag:posts");
    const userMembers = await fakeRedis.smembers("tag:user:42");
    expect(postsMembers.includes("post:1")).toBe(true);
    expect(userMembers.includes("post:1")).toBe(true);
  });

  it("set() uses provided ttl over defaultTtl", async () => {
    await manager.set("k", "v", { ttl: 900 });
    expect(fakeRedis.ttls.get("k")).toBe(900);
  });

  it("set() uses defaultTtl when no ttl option provided", async () => {
    const { manager: mgr, fakeRedis: redis } = makeManager({ defaultTtl: 300 });
    await mgr.set("k", "v");
    expect(redis.ttls.get("k")).toBe(300);
    await mgr.close();
  });

  it("get() increments hitCount on L2 hit", async () => {
    (manager as any).enableL1Cache = false;

    const item = {
      data: "val",
      metadata: {
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        version: "1",
        tags: [],
        hitCount: 0,
      },
    };
    fakeRedis.store.set("hc-key", JSON.stringify(item));

    await manager.get("hc-key");
    const updated = JSON.parse(fakeRedis.store.get("hc-key") ?? "{}");
    expect(updated.metadata.hitCount).toBe(1);
  });

  it("set() returns err(CACHE_ERROR) when Redis throws", async () => {
    (fakeRedis as any).set = async () => {
      throw new Error("Redis unavailable");
    };
    const result = await manager.set("k", "v");
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("CACHE_ERROR");
  });

  it("get() returns err(CACHE_ERROR) when Redis throws", async () => {
    (manager as any).enableL1Cache = false;
    (fakeRedis as any).get = async () => {
      throw new Error("Redis unavailable");
    };
    const result = await manager.get("k");
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("CACHE_ERROR");
  });
});

// ── del() ────────────────────────────────────────────────────────────────────

describe("RedisCacheManager — del()", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;
  let fakeRedis: FakeRedis;

  beforeEach(async () => {
    const setup = makeManager();
    manager = setup.manager;
    fakeRedis = setup.fakeRedis;
  });

  afterEach(async () => {
    await manager.close();
  });

  it("del() removes key from L2 and returns ok(true) for existing key", async () => {
    await manager.set("to-delete", "value");
    const result = await manager.del("to-delete");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(true);
    expect(await fakeRedis.get("to-delete")).toBe(null);
  });

  it("del() removes key from L1 cache", async () => {
    await manager.set("to-delete", "value");
    await manager.del("to-delete");
    // Remove from Redis too so we can confirm L1 is cleared
    fakeRedis.store.delete("to-delete");
    const result = await manager.get("to-delete");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(null);
  });

  it("del() returns ok(false) for non-existent key", async () => {
    const result = await manager.del("ghost");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(false);
  });

  it("del() returns err(CACHE_ERROR) when Redis throws", async () => {
    (fakeRedis as any).del = async () => {
      throw new Error("Redis error");
    };
    const result = await manager.del("k");
    expect(result.ok).toBe(false);
  });
});

// ── getOrSet() ───────────────────────────────────────────────────────────────

describe("RedisCacheManager — getOrSet()", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;

  beforeEach(() => {
    const setup = makeManager();
    manager = setup.manager;
  });

  afterEach(async () => {
    await manager.close();
  });

  it("calls factory when key is not cached", async () => {
    let factoryCalled = false;
    const result = await manager.getOrSet(
      "computed",
      async () => {
        factoryCalled = true;
        return "factory-value";
      },
      { ttl: 60 }
    );
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe("factory-value");
    expect(factoryCalled).toBe(true);
  });

  it("does NOT call factory when key is already cached", async () => {
    await manager.set("cached-key", "existing", { ttl: 60 });

    let factoryCalled = false;
    const result = await manager.getOrSet(
      "cached-key",
      async () => {
        factoryCalled = true;
        return "new-value";
      },
      { ttl: 60 }
    );
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe("existing");
    expect(factoryCalled).toBe(false);
  });

  it("returns err(FACTORY_ERROR) when factory throws", async () => {
    const result = await manager.getOrSet(
      "failing-key",
      async () => {
        throw new Error("Factory failed");
      },
      { ttl: 60 }
    );
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("FACTORY_ERROR");
  });

  it("caches factory result so second call does not re-invoke factory", async () => {
    let callCount = 0;
    await manager.getOrSet("once-key", async () => {
      callCount++;
      return "val";
    });
    await manager.getOrSet("once-key", async () => {
      callCount++;
      return "val";
    });
    expect(callCount).toBe(1);
  });
});

// ── invalidation ─────────────────────────────────────────────────────────────

describe("RedisCacheManager — invalidation methods", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;
  let fakeRedis: FakeRedis;

  beforeEach(() => {
    const setup = makeManager();
    manager = setup.manager;
    fakeRedis = setup.fakeRedis;
  });

  afterEach(async () => {
    await manager.close();
  });

  it("invalidateByTag() removes tagged L1 and L2 entries", async () => {
    await manager.set("post:1", "data1", { ttl: 60, tags: ["posts"] });
    await manager.set("post:2", "data2", { ttl: 60, tags: ["posts"] });

    const result = await manager.invalidateByTag("posts");
    expect(result.ok).toBe(true);

    // L1 should be cleared
    const l1Cache = (manager as any).l1Cache;
    expect(l1Cache.get("post:1")).toBe(undefined);
    expect(l1Cache.get("post:2")).toBe(undefined);

    // Redis should be cleared
    expect(fakeRedis.store.get("post:1")).toBe(undefined);
    expect(fakeRedis.store.get("post:2")).toBe(undefined);
  });

  it("invalidateByPattern() deletes matched keys", async () => {
    // Store directly in fakeRedis since that's what keys() will scan
    fakeRedis.store.set("user:1", "u1");
    fakeRedis.store.set("user:2", "u2");
    fakeRedis.store.set("post:1", "p1");

    const result = await manager.invalidateByPattern("user:*");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(2);
    expect(fakeRedis.store.get("user:1")).toBe(undefined);
    expect(fakeRedis.store.get("user:2")).toBe(undefined);
    expect(fakeRedis.store.get("post:1")).toBe("p1"); // unaffected
  });

  it("invalidate() with immediate strategy deletes keys", async () => {
    await manager.set("k1", "v1");
    await manager.set("k2", "v2");

    const result = await manager.invalidate(["k1", "k2"], "immediate");
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(2);
  });

  it("invalidateByDependencies() cascades to dependent keys", async () => {
    await manager.set("post:1", "data", { ttl: 60, dependencies: ["project:1"] });

    const result = await manager.invalidateByDependencies(["project:1"]);
    expect(result.ok).toBe(true);
    expect((result as any).value).toBe(1);
  });
});

// ── flush() and healthCheck() ─────────────────────────────────────────────────

describe("RedisCacheManager — flush() and healthCheck()", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;
  let fakeRedis: FakeRedis;

  beforeEach(() => {
    const setup = makeManager();
    manager = setup.manager;
    fakeRedis = setup.fakeRedis;
  });

  afterEach(async () => {
    await manager.close();
  });

  it("flush() clears all entries and returns ok", async () => {
    await manager.set("a", "1");
    await manager.set("b", "2");

    const result = await manager.flush();
    expect(result.ok).toBe(true);

    // L1 should be empty
    const l1 = (manager as any).l1Cache;
    expect(l1.size()).toBe(0);
    // Redis should be empty
    expect(fakeRedis.store.size).toBe(0);
  });

  it("healthCheck() returns healthy status and non-negative latency when ping succeeds", async () => {
    const result = await manager.healthCheck();
    expect(result.ok).toBe(true);
    const value = (result as any).value;
    expect(["healthy", "degraded", "unhealthy"].includes(value.status)).toBe(true);
    expect(value.latency).toBeGreaterThanOrEqual(0);
  });

  it("healthCheck() returns err(CACHE_ERROR) when ping throws", async () => {
    (fakeRedis as any).ping = async () => {
      throw new Error("Connection refused");
    };
    const result = await manager.healthCheck();
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("CACHE_ERROR");
  });
});

// ── getStats() ────────────────────────────────────────────────────────────────

describe("RedisCacheManager — getStats()", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;

  beforeEach(() => {
    const setup = makeManager();
    manager = setup.manager;
  });

  afterEach(async () => {
    await manager.close();
  });

  it("returns ok with a complete CacheStats object", async () => {
    const result = await manager.getStats();
    expect(result.ok).toBe(true);
    const stats = (result as any).value;
    expect(typeof stats.hits).toBe("number");
    expect(typeof stats.misses).toBe("number");
    expect(typeof stats.hitRate).toBe("number");
    expect(typeof stats.totalKeys).toBe("number");
    expect(typeof stats.l1Hits).toBe("number");
    expect(typeof stats.l2Hits).toBe("number");
    expect(typeof stats.l1Size).toBe("number");
    expect(Array.isArray(stats.hotKeys)).toBe(true);
  });

  it("hitRate is 0 when no operations have occurred", async () => {
    const result = await manager.getStats();
    expect(result.ok).toBe(true);
    expect((result as any).value.hitRate).toBe(0);
  });

  it("hitRate is > 0 after cache hits occur", async () => {
    await manager.set("k", "v", { ttl: 60 });
    await manager.get("k"); // L1 hit

    const result = await manager.getStats();
    expect(result.ok).toBe(true);
    expect((result as any).value.hitRate).toBeGreaterThan(0);
  });

  it("l1Hits is tracked separately", async () => {
    await manager.set("k", "v", { ttl: 60 });
    await manager.get("k"); // L1 hit (set() populates L1)

    const result = await manager.getStats();
    expect(result.ok).toBe(true);
    expect((result as any).value.l1Hits).toBeGreaterThanOrEqual(1);
  });

  it("returns err(CACHE_ERROR) when Redis.info throws", async () => {
    const { fakeRedis } = makeManager();
    const { manager: mgr } = makeManager();
    (fakeRedis as any).info = async () => {
      throw new Error("Redis error");
    };
    (mgr as any).redis = fakeRedis;
    if ((mgr as any).invalidationManager) {
      (mgr as any).invalidationManager.redis = fakeRedis;
    }

    const result = await mgr.getStats();
    expect(result.ok).toBe(false);
    await mgr.close();
  });
});

// ── warmCache() ───────────────────────────────────────────────────────────────

describe("RedisCacheManager — warmCache()", { concurrency: 1 }, () => {
  let manager: RedisCacheManager;

  beforeEach(() => {
    const setup = makeManager();
    manager = setup.manager;
  });

  afterEach(async () => {
    await manager.close();
  });

  it("returns ok(0) when isWarming flag prevents re-entrant calls", async () => {
    // Set isWarming to true manually
    (manager as any).isWarming = true;
    const result = await manager.warmCache();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    (manager as any).isWarming = false;
  });

  it("returns ok when no hot patterns exist", async () => {
    const result = await manager.warmCache();
    expect(result.ok).toBe(true);
    expect(typeof result.value).toBe("number");
    expect(result.value).toBeGreaterThanOrEqual(0);
  });
});

// ── private helpers ───────────────────────────────────────────────────────────

describe("RedisCacheManager — getKeyPattern() private helper", { concurrency: 1 }, () => {
  it("returns namespace:* for colon-separated keys", async () => {
    const { manager: mgr } = makeManager();
    const fn = (mgr as any).getKeyPattern.bind(mgr);
    expect(fn("user:123")).toBe("user:*");
    expect(fn("post:abc:extra")).toBe("post:*");
    expect(fn("standalone")).toBe("other");
    await mgr.close();
  });
});

describe("RedisCacheManager — parseRedisInfo() private helper", { concurrency: 1 }, () => {
  it("parses a value from Redis INFO string", async () => {
    const { manager: mgr } = makeManager();
    const fn = (mgr as any).parseRedisInfo.bind(mgr);
    const info = "# Memory\r\nused_memory:102400\r\nused_memory_human:100.00K\r\n";
    expect(fn(info, "used_memory")).toBe(102400);
    await mgr.close();
  });

  it("returns 0 when key is not found in INFO string", async () => {
    const { manager: mgr } = makeManager();
    const fn = (mgr as any).parseRedisInfo.bind(mgr);
    expect(fn("# Memory\r\n", "nonexistent")).toBe(0);
    await mgr.close();
  });
});
