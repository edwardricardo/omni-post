/**
 * Cache factory tests
 * Tests the singleton factory pattern — no Redis connection made
 * because RedisCacheManager uses lazyConnect: true.
 * Tier 0: no DB, no Redis connectivity.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import client from "prom-client";
import { createCacheManager, getCacheManager, resetCacheManager } from "../src/factory.js";
import { RedisCacheManager } from "../src/cache-manager.js";

// Clear prom-client registry before module imports to avoid "Duplicated metrics" if any
// other file has already loaded metrics.ts in this process. Since each test file runs
// in its own process this is a safety measure only.
before(() => {
  client.register.clear();
});

after(async () => {
  // Cleanup: close any manager created during tests and reset singleton
  const mgr = getCacheManager();
  if (mgr) {
    await mgr.close();
  }
  resetCacheManager();
  client.register.clear();
});

describe("createCacheManager()", { concurrency: 1 }, () => {
  beforeEach(async () => {
    // Ensure a clean singleton state before each test
    const existing = getCacheManager();
    if (existing) {
      await existing.close();
      resetCacheManager();
    }
  });

  it("returns a RedisCacheManager instance", () => {
    const mgr = createCacheManager({ redisUrl: "redis://localhost:6379" });
    assert.ok(mgr instanceof RedisCacheManager, "should return a RedisCacheManager");
  });

  it("is idempotent — returns the SAME instance on repeated calls", () => {
    const mgr1 = createCacheManager({ redisUrl: "redis://localhost:6379" });
    const mgr2 = createCacheManager({ redisUrl: "redis://different-host:6379" });
    assert.strictEqual(mgr1, mgr2, "should return the same singleton instance");
  });

  it("creates manager with provided config values", () => {
    const mgr = createCacheManager({
      redisUrl: "redis://localhost:6379",
      keyPrefix: "myapp:",
      defaultTtl: 900,
    });
    assert.ok(mgr instanceof RedisCacheManager);
  });
});

describe("getCacheManager()", { concurrency: 1 }, () => {
  beforeEach(async () => {
    const existing = getCacheManager();
    if (existing) {
      await existing.close();
      resetCacheManager();
    }
  });

  it("returns null when no manager has been created yet", () => {
    assert.strictEqual(getCacheManager(), null);
  });

  it("returns the manager after createCacheManager() is called", () => {
    const created = createCacheManager({ redisUrl: "redis://localhost:6379" });
    const retrieved = getCacheManager();
    assert.strictEqual(retrieved, created);
  });
});

describe("resetCacheManager()", { concurrency: 1 }, () => {
  beforeEach(async () => {
    const existing = getCacheManager();
    if (existing) {
      await existing.close();
      resetCacheManager();
    }
  });

  it("resets the singleton so getCacheManager() returns null", async () => {
    createCacheManager({ redisUrl: "redis://localhost:6379" });
    assert.ok(getCacheManager() !== null, "should have a manager before reset");

    const mgr = getCacheManager()!;
    await mgr.close();
    resetCacheManager();

    assert.strictEqual(getCacheManager(), null);
  });

  it("allows a new instance to be created after reset", async () => {
    const first = createCacheManager({ redisUrl: "redis://localhost:6379" });
    await first.close();
    resetCacheManager();

    const second = createCacheManager({ redisUrl: "redis://localhost:6379" });
    assert.notStrictEqual(first, second, "should create a fresh instance after reset");
  });

  it("resetCacheManager() is safe to call multiple times", () => {
    resetCacheManager();
    resetCacheManager();
    assert.strictEqual(getCacheManager(), null);
  });
});

describe("RedisCacheManager — lazyConnect (no actual Redis needed)", { concurrency: 1 }, () => {
  let mgr: RedisCacheManager;

  before(async () => {
    const existing = getCacheManager();
    if (existing) {
      await existing.close();
      resetCacheManager();
    }
    mgr = createCacheManager({
      redisUrl: "redis://localhost:6379",
      keyPrefix: "test:",
      defaultTtl: 60,
      enableMetrics: false, // Avoid double-registration issues
    });
  });

  after(async () => {
    await mgr.close();
    resetCacheManager();
  });

  it("close() resolves without error even when never connected", async () => {
    // A separate manager that was never connected should close cleanly.
    // We test with a fresh instance rather than the shared one.
    const existing = getCacheManager();
    if (existing) {
      await existing.close();
      resetCacheManager();
    }

    const isolated = createCacheManager({ redisUrl: "redis://localhost:9999" });
    await assert.doesNotReject(() => isolated.close());
    resetCacheManager();
  });
});
