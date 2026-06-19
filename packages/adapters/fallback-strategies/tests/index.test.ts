/**
 * @file Fallback Strategies — unit tests
 *
 * Tier 0: No Redis connectivity.
 * ioredis is mocked via vi.mock() before importing the source module.
 *
 * Framework: Vitest
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";

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

// ioredis exposes Redis both as the default export and as a named export.
// The source imports the named `{ Redis }` (ADR-0017 §1), so the mock MUST
// return it under that name too — not only `default`.
class MockRedis {
  constructor() {
    return mockRedisInstance as unknown as MockRedis;
  }
}

vi.mock("ioredis", () => ({
  default: MockRedis,
  Redis: MockRedis,
}));

vi.mock("pino", () => ({
  default: () => ({
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
}));

// ── Now import the source (mocks are in place) ──────────────────────────────

let createFallbackManager: typeof import("../src/index.js").createFallbackManager;
let getFallbackManager: typeof import("../src/index.js").getFallbackManager;
let resetFallbackManager: typeof import("../src/index.js").resetFallbackManager;
let FallbackManager: typeof import("../src/index.js").FallbackManager;
let CommonFallbackStrategies: typeof import("../src/index.js").CommonFallbackStrategies;

beforeAll(async () => {
  const mod = await import("../src/index.js");
  createFallbackManager = mod.createFallbackManager;
  getFallbackManager = mod.getFallbackManager;
  resetFallbackManager = mod.resetFallbackManager;
  FallbackManager = mod.FallbackManager;
  CommonFallbackStrategies = mod.CommonFallbackStrategies;
});

afterAll(() => {
  resetFallbackManager?.();
  redisStore.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Factory / Singleton tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createFallbackManager()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFallbackManager();
  });

  afterAll(() => {
    resetFallbackManager();
  });

  it("creates a FallbackManager instance", () => {
    const mgr = createFallbackManager("redis://localhost:6379");
    expect(mgr instanceof FallbackManager).toBeTruthy();
  });

  it("is idempotent — returns the SAME instance on repeated calls", () => {
    const mgr1 = createFallbackManager("redis://localhost:6379");
    const mgr2 = createFallbackManager("redis://other-host:6379");
    expect(mgr1).toBe(mgr2);
  });

  it("creates manager without redisUrl (no Redis fallback cache)", () => {
    const mgr = createFallbackManager();
    expect(mgr instanceof FallbackManager).toBeTruthy();
  });
});

describe("getFallbackManager()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFallbackManager();
  });

  afterAll(() => {
    resetFallbackManager();
  });

  it("returns null when no manager has been created yet", () => {
    expect(getFallbackManager()).toBe(null);
  });

  it("returns the manager after createFallbackManager() is called", () => {
    const created = createFallbackManager("redis://localhost:6379");
    const retrieved = getFallbackManager();
    expect(retrieved).toBe(created);
  });
});

describe("resetFallbackManager()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFallbackManager();
  });

  it("resets the singleton so getFallbackManager() returns null", () => {
    createFallbackManager("redis://localhost:6379");
    expect(getFallbackManager()).not.toBe(null);
    resetFallbackManager();
    expect(getFallbackManager()).toBe(null);
  });

  it("allows a new instance to be created after reset", () => {
    const first = createFallbackManager("redis://localhost:6379");
    resetFallbackManager();
    const second = createFallbackManager("redis://localhost:6379");
    expect(first).not.toBe(second);
  });

  it("is safe to call multiple times", () => {
    resetFallbackManager();
    resetFallbackManager();
    expect(getFallbackManager()).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeFallback — strategy execution
// ─────────────────────────────────────────────────────────────────────────────

describe("FallbackManager.executeFallback()", () => {
  let mgr: InstanceType<typeof FallbackManager>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe("STATIC_RESPONSE strategy", () => {
    it("returns static response from config when primary fails", async () => {
      const staticData = { items: [], total: 0 };
      const result = await mgr.executeFallback(
        { strategy: "STATIC_RESPONSE", staticResponse: staticData },
        baseContext()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(staticData);
      }
    });

    it("returns static response from registered fallback", async () => {
      const staticData = { cached: true };
      mgr.registerStaticFallback("test-service", "test-op", staticData);

      const result = await mgr.executeFallback({ strategy: "STATIC_RESPONSE" }, baseContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(staticData);
      }
    });

    it("returns FALLBACK_FAILED when no static response is configured", async () => {
      const result = await mgr.executeFallback(
        { strategy: "STATIC_RESPONSE" },
        { ...baseContext(), service: "unknown", operation: "unknown" }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("FALLBACK_FAILED");
      }
    });
  });

  describe("CACHED_RESPONSE strategy", () => {
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ data: [1, 2, 3] });
      }
    });

    it("returns FALLBACK_FAILED when cache is empty", async () => {
      const result = await mgr.executeFallback({ strategy: "CACHED_RESPONSE" }, baseContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("FALLBACK_FAILED");
      }
    });

    it("returns FALLBACK_FAILED when Redis is not configured", async () => {
      const noRedisMgr = new FallbackManager(); // No redisUrl
      const result = await noRedisMgr.executeFallback(
        { strategy: "CACHED_RESPONSE" },
        baseContext()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("FALLBACK_FAILED");
      }
    });
  });

  describe("DEGRADED_SERVICE strategy", () => {
    it("returns a degraded response for known service:operation", async () => {
      const result = await mgr.executeFallback(
        { strategy: "DEGRADED_SERVICE" },
        {
          ...baseContext(),
          service: "x-api",
          operation: "get-analytics",
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const value = result.value as { degraded: boolean; metrics: unknown };
        expect(value.degraded).toBe(true);
        expect(value.metrics !== undefined).toBeTruthy();
      }
    });

    it("returns a generic degraded response for unknown service:operation", async () => {
      const result = await mgr.executeFallback({ strategy: "DEGRADED_SERVICE" }, baseContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const value = result.value as { degraded: boolean; success: boolean };
        expect(value.degraded).toBe(true);
        expect(value.success).toBe(false);
      }
    });
  });

  describe("FAIL_GRACEFULLY strategy", () => {
    it("returns a graceful failure response with custom message", async () => {
      const result = await mgr.executeFallback(
        {
          strategy: "FAIL_GRACEFULLY",
          gracefulMessage: "Service is under maintenance",
        },
        baseContext()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const value = result.value as { success: boolean; message: string; fallback: boolean };
        expect(value.success).toBe(false);
        expect(value.message).toBe("Service is under maintenance");
        expect(value.fallback).toBe(true);
      }
    });

    it("returns a graceful failure response with default message", async () => {
      const result = await mgr.executeFallback({ strategy: "FAIL_GRACEFULLY" }, baseContext());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const value = result.value as { success: boolean; message: string; fallback: boolean };
        expect(value.success).toBe(false);
        expect(value.message).toContain("test-service");
        expect(value.fallback).toBe(true);
      }
    });
  });

  describe("RETRY_ALTERNATIVE strategy", () => {
    it("returns alternative response when endpoint is configured", async () => {
      const result = await mgr.executeFallback(
        {
          strategy: "RETRY_ALTERNATIVE",
          alternativeEndpoint: "https://backup.api.com/v2",
        },
        baseContext()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const value = result.value as { source: string };
        expect(value.source).toBe("alternative");
      }
    });

    it("returns FALLBACK_FAILED when no alternative endpoint is configured", async () => {
      const result = await mgr.executeFallback({ strategy: "RETRY_ALTERNATIVE" }, baseContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("FALLBACK_FAILED");
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategies run in order — execute primary -> cache -> default
// ─────────────────────────────────────────────────────────────────────────────

describe("Fallback strategy chain execution", () => {
  let mgr: InstanceType<typeof FallbackManager>;

  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(executionOrder).toEqual(["cache:false", "static:false", "graceful:true"]);
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
    expect(result1.ok).toBe(false);

    const result2 = await noRedisMgr.executeFallback(
      { strategy: "STATIC_RESPONSE" },
      {
        service: "unregistered",
        operation: "unregistered",
        originalError: new Error("fail"),
        attempt: 2,
      }
    );
    expect(result2.ok).toBe(false);

    const result3 = await noRedisMgr.executeFallback(
      { strategy: "RETRY_ALTERNATIVE" },
      {
        service: "svc",
        operation: "op",
        originalError: new Error("fail"),
        attempt: 3,
      }
    );
    expect(result3.ok).toBe(false);

    // All three returned error — the error is properly propagated
    if (!result1.ok) expect(result1.error).toBe("FALLBACK_FAILED");
    if (!result2.ok) expect(result2.error).toBe("FALLBACK_FAILED");
    if (!result3.ok) expect(result3.error).toBe("FALLBACK_FAILED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CommonFallbackStrategies pre-built configs
// ─────────────────────────────────────────────────────────────────────────────

describe("CommonFallbackStrategies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has ANALYTICS_FALLBACK config", () => {
    expect(CommonFallbackStrategies.ANALYTICS_FALLBACK).toBeTruthy();
    expect(CommonFallbackStrategies.ANALYTICS_FALLBACK.strategy).toBe("CACHED_RESPONSE");
    expect(CommonFallbackStrategies.ANALYTICS_FALLBACK.cacheTtl).toBe(1800000); // 30 minutes
  });

  it("has UPLOAD_FALLBACK config", () => {
    expect(CommonFallbackStrategies.UPLOAD_FALLBACK).toBeTruthy();
    expect(CommonFallbackStrategies.UPLOAD_FALLBACK.strategy).toBe("DEGRADED_SERVICE");
  });

  it("has METADATA_FALLBACK config", () => {
    expect(CommonFallbackStrategies.METADATA_FALLBACK).toBeTruthy();
    expect(CommonFallbackStrategies.METADATA_FALLBACK.strategy).toBe("CACHED_RESPONSE");
    expect(CommonFallbackStrategies.METADATA_FALLBACK.cacheTtl).toBe(3600000); // 1 hour
  });

  it("has exactly 3 pre-built strategies", () => {
    const keys = Object.keys(CommonFallbackStrategies);
    expect(keys.length).toBe(3);
    expect(keys.sort()).toEqual(["ANALYTICS_FALLBACK", "METADATA_FALLBACK", "UPLOAD_FALLBACK"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cacheSuccessfulResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("FallbackManager.cacheSuccessfulResponse()", () => {
  let mgr: InstanceType<typeof FallbackManager>;

  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ views: 100 });
    }
  });

  it("does nothing when Redis is not configured", async () => {
    const noRedisMgr = new FallbackManager();
    // Should not throw
    await noRedisMgr.cacheSuccessfulResponse("svc", "op", { data: 1 });
    expect(true).toBeTruthy();
  });
});
