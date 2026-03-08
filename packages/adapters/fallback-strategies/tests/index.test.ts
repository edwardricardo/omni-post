/**
 * @file Fallback Strategies — unit tests
 *
 * Tier 0: No Redis connectivity.
 * ioredis is mocked via mock.module() before importing the source module.
 *
 * Framework: node:test + node:assert/strict
 */

import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mock infrastructure modules BEFORE importing the source ──────────────────

// In-memory store to simulate Redis get/setex/keys/del
const redisStore = new Map<string, { value: string; expiresAt: number }>();

const mockRedisInstance = {
  on: () => mockRedisInstance,
  quit: async () => "OK",
  disconnect: () => undefined,
  get: async (key: string) => {
    const entry = redisStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      redisStore.delete(key);
      return null;
    }
    return entry.value;
  },
  setex: async (key: string, ttlSeconds: number, value: string) => {
    redisStore.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return "OK";
  },
  keys: async (pattern: string) => {
    const prefix = pattern.replace("*", "");
    return [...redisStore.keys()].filter((k) => k.startsWith(prefix));
  },
  del: async (...keys: string[]) => {
    let count = 0;
    for (const key of keys) {
      if (redisStore.delete(key)) count++;
    }
    return count;
  },
};

mock.module("ioredis", {
  defaultExport: class MockRedis {
    constructor() {
      return mockRedisInstance as any;
    }
  },
});

mock.module("pino", {
  defaultExport: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    }),
  }),
});

// ── Now import the source (mocks are in place) ──────────────────────────────

let createFallbackManager: typeof import("../src/index.js").createFallbackManager;
let getFallbackManager: typeof import("../src/index.js").getFallbackManager;
let resetFallbackManager: typeof import("../src/index.js").resetFallbackManager;
let FallbackManager: typeof import("../src/index.js").FallbackManager;
let CommonFallbackStrategies: typeof import("../src/index.js").CommonFallbackStrategies;

before(async () => {
  const mod = await import("../src/index.js");
  createFallbackManager = mod.createFallbackManager;
  getFallbackManager = mod.getFallbackManager;
  resetFallbackManager = mod.resetFallbackManager;
  FallbackManager = mod.FallbackManager;
  CommonFallbackStrategies = mod.CommonFallbackStrategies;
});

after(() => {
  resetFallbackManager?.();
  redisStore.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Factory / Singleton tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createFallbackManager()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetFallbackManager();
  });

  after(() => {
    resetFallbackManager();
  });

  it("creates a FallbackManager instance", () => {
    const mgr = createFallbackManager("redis://localhost:6379");
    assert.ok(mgr instanceof FallbackManager, "should return a FallbackManager");
  });

  it("is idempotent — returns the SAME instance on repeated calls", () => {
    const mgr1 = createFallbackManager("redis://localhost:6379");
    const mgr2 = createFallbackManager("redis://other-host:6379");
    assert.strictEqual(mgr1, mgr2, "should return the same singleton instance");
  });

  it("creates manager without redisUrl (no Redis fallback cache)", () => {
    const mgr = createFallbackManager();
    assert.ok(mgr instanceof FallbackManager);
  });
});

describe("getFallbackManager()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetFallbackManager();
  });

  after(() => {
    resetFallbackManager();
  });

  it("returns null when no manager has been created yet", () => {
    assert.strictEqual(getFallbackManager(), null);
  });

  it("returns the manager after createFallbackManager() is called", () => {
    const created = createFallbackManager("redis://localhost:6379");
    const retrieved = getFallbackManager();
    assert.strictEqual(retrieved, created);
  });
});

describe("resetFallbackManager()", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetFallbackManager();
  });

  it("resets the singleton so getFallbackManager() returns null", () => {
    createFallbackManager("redis://localhost:6379");
    assert.ok(getFallbackManager() !== null, "should have a manager before reset");
    resetFallbackManager();
    assert.strictEqual(getFallbackManager(), null);
  });

  it("allows a new instance to be created after reset", () => {
    const first = createFallbackManager("redis://localhost:6379");
    resetFallbackManager();
    const second = createFallbackManager("redis://localhost:6379");
    assert.notStrictEqual(first, second, "should create a fresh instance after reset");
  });

  it("is safe to call multiple times", () => {
    resetFallbackManager();
    resetFallbackManager();
    assert.strictEqual(getFallbackManager(), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeFallback — strategy execution
// ─────────────────────────────────────────────────────────────────────────────

describe("FallbackManager.executeFallback()", { concurrency: 1 }, () => {
  let mgr: InstanceType<typeof FallbackManager>;

  beforeEach(() => {
    resetFallbackManager();
    redisStore.clear();
    // Create a fresh manager with Redis for cache-based tests
    mgr = new FallbackManager("redis://localhost:6379");
  });

  const baseContext = () => ({
    service: "test-service",
    operation: "test-op",
    originalError: new Error("primary failed"),
    attempt: 1,
  });

  describe("STATIC_RESPONSE strategy", { concurrency: 1 }, () => {
    it("returns static response from config when primary fails", async () => {
      const staticData = { items: [], total: 0 };
      const result = await mgr.executeFallback(
        { strategy: "STATIC_RESPONSE", staticResponse: staticData },
        baseContext()
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.value, staticData);
      }
    });

    it("returns static response from registered fallback", async () => {
      const staticData = { cached: true };
      mgr.registerStaticFallback("test-service", "test-op", staticData);

      const result = await mgr.executeFallback({ strategy: "STATIC_RESPONSE" }, baseContext());

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.value, staticData);
      }
    });

    it("returns FALLBACK_FAILED when no static response is configured", async () => {
      const result = await mgr.executeFallback(
        { strategy: "STATIC_RESPONSE" },
        { ...baseContext(), service: "unknown", operation: "unknown" }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "FALLBACK_FAILED");
      }
    });
  });

  describe("CACHED_RESPONSE strategy", { concurrency: 1 }, () => {
    it("returns cached response when available", async () => {
      // Pre-populate the mock Redis with a cached response
      const cacheKey = "fallback:test-service:test-op";
      const cachedData = {
        response: { data: [1, 2, 3] },
        timestamp: Date.now(),
        service: "test-service",
        operation: "test-op",
      };
      redisStore.set(cacheKey, {
        value: JSON.stringify(cachedData),
        expiresAt: Date.now() + 300000,
      });

      const result = await mgr.executeFallback({ strategy: "CACHED_RESPONSE" }, baseContext());

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.value, { data: [1, 2, 3] });
      }
    });

    it("returns FALLBACK_FAILED when cache is empty", async () => {
      const result = await mgr.executeFallback({ strategy: "CACHED_RESPONSE" }, baseContext());

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "FALLBACK_FAILED");
      }
    });

    it("returns FALLBACK_FAILED when Redis is not configured", async () => {
      const noRedisMgr = new FallbackManager(); // No redisUrl
      const result = await noRedisMgr.executeFallback(
        { strategy: "CACHED_RESPONSE" },
        baseContext()
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "FALLBACK_FAILED");
      }
    });
  });

  describe("DEGRADED_SERVICE strategy", { concurrency: 1 }, () => {
    it("returns a degraded response for known service:operation", async () => {
      const result = await mgr.executeFallback(
        { strategy: "DEGRADED_SERVICE" },
        {
          ...baseContext(),
          service: "x-api",
          operation: "get-analytics",
        }
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const value = result.value as any;
        assert.strictEqual(value.degraded, true);
        assert.ok(value.metrics !== undefined, "should have analytics metrics");
      }
    });

    it("returns a generic degraded response for unknown service:operation", async () => {
      const result = await mgr.executeFallback({ strategy: "DEGRADED_SERVICE" }, baseContext());

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const value = result.value as any;
        assert.strictEqual(value.degraded, true);
        assert.strictEqual(value.success, false);
      }
    });
  });

  describe("FAIL_GRACEFULLY strategy", { concurrency: 1 }, () => {
    it("returns a graceful failure response with custom message", async () => {
      const result = await mgr.executeFallback(
        {
          strategy: "FAIL_GRACEFULLY",
          gracefulMessage: "Service is under maintenance",
        },
        baseContext()
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const value = result.value as any;
        assert.strictEqual(value.success, false);
        assert.strictEqual(value.message, "Service is under maintenance");
        assert.strictEqual(value.fallback, true);
      }
    });

    it("returns a graceful failure response with default message", async () => {
      const result = await mgr.executeFallback({ strategy: "FAIL_GRACEFULLY" }, baseContext());

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const value = result.value as any;
        assert.strictEqual(value.success, false);
        assert.ok(value.message.includes("test-service"));
        assert.strictEqual(value.fallback, true);
      }
    });
  });

  describe("RETRY_ALTERNATIVE strategy", { concurrency: 1 }, () => {
    it("returns alternative response when endpoint is configured", async () => {
      const result = await mgr.executeFallback(
        {
          strategy: "RETRY_ALTERNATIVE",
          alternativeEndpoint: "https://backup.api.com/v2",
        },
        baseContext()
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const value = result.value as any;
        assert.strictEqual(value.source, "alternative");
      }
    });

    it("returns FALLBACK_FAILED when no alternative endpoint is configured", async () => {
      const result = await mgr.executeFallback({ strategy: "RETRY_ALTERNATIVE" }, baseContext());

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "FALLBACK_FAILED");
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategies run in order — execute primary -> cache -> default
// ─────────────────────────────────────────────────────────────────────────────

describe("Fallback strategy chain execution", { concurrency: 1 }, () => {
  let mgr: InstanceType<typeof FallbackManager>;

  beforeEach(() => {
    resetFallbackManager();
    redisStore.clear();
    mgr = new FallbackManager("redis://localhost:6379");
  });

  it("falls back through strategies in order until one succeeds", async () => {
    const executionOrder: string[] = [];

    // 1. CACHED_RESPONSE will fail (no cache)
    const cacheResult = await mgr.executeFallback(
      { strategy: "CACHED_RESPONSE" },
      {
        service: "test-service",
        operation: "test-op",
        originalError: new Error("primary failed"),
        attempt: 1,
      }
    );
    executionOrder.push(`cache:${cacheResult.ok}`);

    // 2. STATIC_RESPONSE will fail (no static registered)
    const staticResult = await mgr.executeFallback(
      { strategy: "STATIC_RESPONSE" },
      {
        service: "unregistered-service",
        operation: "unregistered-op",
        originalError: new Error("cache failed"),
        attempt: 2,
      }
    );
    executionOrder.push(`static:${staticResult.ok}`);

    // 3. FAIL_GRACEFULLY always succeeds
    const gracefulResult = await mgr.executeFallback(
      { strategy: "FAIL_GRACEFULLY", gracefulMessage: "Service down" },
      {
        service: "test-service",
        operation: "test-op",
        originalError: new Error("everything else failed"),
        attempt: 3,
      }
    );
    executionOrder.push(`graceful:${gracefulResult.ok}`);

    assert.deepStrictEqual(
      executionOrder,
      ["cache:false", "static:false", "graceful:true"],
      "strategies should execute in order, first two fail, last succeeds"
    );
  });

  it("all strategies failing propagates error correctly", async () => {
    // CACHED_RESPONSE with no Redis manager will fail
    const noRedisMgr = new FallbackManager();

    const result1 = await noRedisMgr.executeFallback(
      { strategy: "CACHED_RESPONSE" },
      {
        service: "svc",
        operation: "op",
        originalError: new Error("fail"),
        attempt: 1,
      }
    );
    assert.strictEqual(result1.ok, false, "CACHED_RESPONSE should fail without Redis");

    const result2 = await noRedisMgr.executeFallback(
      { strategy: "STATIC_RESPONSE" },
      {
        service: "unregistered",
        operation: "unregistered",
        originalError: new Error("fail"),
        attempt: 2,
      }
    );
    assert.strictEqual(result2.ok, false, "STATIC_RESPONSE should fail without config");

    const result3 = await noRedisMgr.executeFallback(
      { strategy: "RETRY_ALTERNATIVE" },
      {
        service: "svc",
        operation: "op",
        originalError: new Error("fail"),
        attempt: 3,
      }
    );
    assert.strictEqual(result3.ok, false, "RETRY_ALTERNATIVE should fail without endpoint");

    // All three returned error — the error is properly propagated
    if (!result1.ok) assert.strictEqual(result1.error, "FALLBACK_FAILED");
    if (!result2.ok) assert.strictEqual(result2.error, "FALLBACK_FAILED");
    if (!result3.ok) assert.strictEqual(result3.error, "FALLBACK_FAILED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CommonFallbackStrategies pre-built configs
// ─────────────────────────────────────────────────────────────────────────────

describe("CommonFallbackStrategies", { concurrency: 1 }, () => {
  it("has ANALYTICS_FALLBACK config", () => {
    assert.ok(CommonFallbackStrategies.ANALYTICS_FALLBACK, "should exist");
    assert.strictEqual(CommonFallbackStrategies.ANALYTICS_FALLBACK.strategy, "CACHED_RESPONSE");
    assert.strictEqual(
      CommonFallbackStrategies.ANALYTICS_FALLBACK.cacheTtl,
      1800000, // 30 minutes
      "cacheTtl should be 30 minutes"
    );
  });

  it("has UPLOAD_FALLBACK config", () => {
    assert.ok(CommonFallbackStrategies.UPLOAD_FALLBACK, "should exist");
    assert.strictEqual(CommonFallbackStrategies.UPLOAD_FALLBACK.strategy, "DEGRADED_SERVICE");
  });

  it("has SOCIAL_POST_FALLBACK config", () => {
    assert.ok(CommonFallbackStrategies.SOCIAL_POST_FALLBACK, "should exist");
    assert.strictEqual(CommonFallbackStrategies.SOCIAL_POST_FALLBACK.strategy, "STATIC_RESPONSE");
    assert.ok(
      CommonFallbackStrategies.SOCIAL_POST_FALLBACK.staticResponse,
      "should have a staticResponse"
    );
    const resp = CommonFallbackStrategies.SOCIAL_POST_FALLBACK.staticResponse as any;
    assert.strictEqual(resp.queued, true, "static response should indicate queued");
  });

  it("has METADATA_FALLBACK config", () => {
    assert.ok(CommonFallbackStrategies.METADATA_FALLBACK, "should exist");
    assert.strictEqual(CommonFallbackStrategies.METADATA_FALLBACK.strategy, "CACHED_RESPONSE");
    assert.strictEqual(
      CommonFallbackStrategies.METADATA_FALLBACK.cacheTtl,
      3600000, // 1 hour
      "cacheTtl should be 1 hour"
    );
  });

  it("has exactly 4 pre-built strategies", () => {
    const keys = Object.keys(CommonFallbackStrategies);
    assert.strictEqual(keys.length, 4, "should have 4 pre-built strategies");
    assert.deepStrictEqual(keys.sort(), [
      "ANALYTICS_FALLBACK",
      "METADATA_FALLBACK",
      "SOCIAL_POST_FALLBACK",
      "UPLOAD_FALLBACK",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cacheSuccessfulResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("FallbackManager.cacheSuccessfulResponse()", { concurrency: 1 }, () => {
  let mgr: InstanceType<typeof FallbackManager>;

  beforeEach(() => {
    resetFallbackManager();
    redisStore.clear();
    mgr = new FallbackManager("redis://localhost:6379");
  });

  it("caches a response that can be retrieved as fallback", async () => {
    // Cache a successful response
    await mgr.cacheSuccessfulResponse("analytics", "get-metrics", { views: 100 }, 60000);

    // Now use CACHED_RESPONSE to retrieve it
    const result = await mgr.executeFallback(
      { strategy: "CACHED_RESPONSE" },
      {
        service: "analytics",
        operation: "get-metrics",
        originalError: new Error("primary failed"),
        attempt: 1,
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.value, { views: 100 });
    }
  });

  it("does nothing when Redis is not configured", async () => {
    const noRedisMgr = new FallbackManager();
    // Should not throw
    await noRedisMgr.cacheSuccessfulResponse("svc", "op", { data: 1 });
    assert.ok(true, "should not throw");
  });
});
