/**
 * @file fallbackTenantIsolation.test.ts
 * @description Cross-tenant isolation tests for the L2 Redis fallback store (finding C-1,
 *              Spec "Fallback (L2) cache is tenant-scoped and fail-safe" [MERGE-BLOCKING]).
 *              The `fallbackEnabled: true` presets persist each successful response and serve
 *              "the most-recent cached response" back on provider failure. Before the fix the
 *              store key `fallback:service:operation` carried NO tenant discriminant, so tenant
 *              A's cached PII payload was served to tenant B. These tests drive the
 *              FallbackManager directly with an in-memory Redis double (no live Redis) and prove:
 *              (1) tenant B is never served tenant A's fallback payload when each carries its own
 *              discriminant, (2) a discriminant-less op writes and reads nothing shared
 *              (fail-safe), (3) the same-tenant fallback hit is preserved, and (4) the
 *              `fallback:` key prefix is retained so enumeration/clear still work.
 *
 *              Tier 0: no external services. ioredis is mocked before importing the source.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, vi, expect } from "vitest";
import assert from "node:assert/strict";

// ── In-memory Redis double (mirrors the existing index.test.ts pattern) ───────
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
    redisStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
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

class MockRedis {
  constructor() {
    return mockRedisInstance as unknown as MockRedis;
  }
}

vi.mock("ioredis", () => ({ default: MockRedis, Redis: MockRedis }));

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

let FallbackManager: typeof import("../src/index.js").FallbackManager;

/** Analytics payload carrying a per-tenant discriminating field (PII proxy). */
interface AnalyticsPayload {
  tenant: string;
  token: string;
}

const SVC = "x-api";
const OP = "get-analytics";

beforeEach(async () => {
  vi.clearAllMocks();
  redisStore.clear();
  const mod = await import("../src/index.js");
  FallbackManager = mod.FallbackManager;
});

afterAll(() => {
  redisStore.clear();
});

/* ──────────────────────────────────────────────────────────────────────
 * Cross-tenant isolation of the L2 fallback store  [MERGE-BLOCKING] (anchor)
 * ────────────────────────────────────────────────────────────────────── */
describe("L2 fallback store cross-tenant isolation", { concurrent: false }, () => {
  it("never serves tenant A's fallback-cached payload to tenant B when each carries its own discriminant", async () => {
    const mgr = new FallbackManager("redis://localhost:6379");

    // Tenant A's successful analytics response is persisted to the fallback store.
    await mgr.cacheSuccessfulResponse(
      SVC,
      OP,
      { tenant: "A", token: "A-token" } satisfies AnalyticsPayload,
      60_000,
      "disc-A"
    );

    // The provider then fails for tenant B; B falls back carrying B's OWN discriminant.
    const bResult = await mgr.executeFallback<AnalyticsPayload>(
      { strategy: "CACHED_RESPONSE" },
      {
        service: SVC,
        operation: OP,
        originalError: new Error("provider down for B"),
        attempt: 1,
        discriminant: "disc-B",
      }
    );

    // B must NOT receive A's payload — B has no entry of its own, so it fetches fresh (miss).
    assert.strictEqual(
      bResult.ok,
      false,
      "tenant B must never be served tenant A's fallback payload"
    );

    // Same-tenant is preserved: A's own fallback still returns A's payload.
    const aResult = await mgr.executeFallback<AnalyticsPayload>(
      { strategy: "CACHED_RESPONSE" },
      {
        service: SVC,
        operation: OP,
        originalError: new Error("provider down for A"),
        attempt: 1,
        discriminant: "disc-A",
      }
    );
    assert.strictEqual(aResult.ok, true, "tenant A's own fallback entry must still be served");
    if (aResult.ok) {
      assert.strictEqual(aResult.value.token, "A-token");
    }
  });

  it("keeps distinct tenants' fallback entries under distinct keys", async () => {
    const mgr = new FallbackManager("redis://localhost:6379");

    await mgr.cacheSuccessfulResponse(SVC, OP, { tenant: "A", token: "A-token" }, 60_000, "disc-A");
    await mgr.cacheSuccessfulResponse(SVC, OP, { tenant: "B", token: "B-token" }, 60_000, "disc-B");

    const keys = [...redisStore.keys()];
    assert.ok(
      keys.includes(`fallback:${SVC}:${OP}:disc-A`),
      "A's entry must be under its own discriminant key"
    );
    assert.ok(
      keys.includes(`fallback:${SVC}:${OP}:disc-B`),
      "B's entry must be under its own discriminant key"
    );
    assert.ok(!keys.includes(`fallback:${SVC}:${OP}`), "no un-scoped shared key may exist");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * Fail-safe when no discriminant is supplied  [MERGE-BLOCKING]
 * ────────────────────────────────────────────────────────────────────── */
describe(
  "L2 fallback store fail-safe (no discriminant => no shared entry)",
  { concurrent: false },
  () => {
    it("writes nothing when no discriminant is supplied", async () => {
      const mgr = new FallbackManager("redis://localhost:6379");

      // No discriminant — must store nothing shared.
      await mgr.cacheSuccessfulResponse(SVC, OP, { tenant: "A", token: "A-token" }, 60_000);

      const stats = await mgr.getFallbackStats();
      assert.strictEqual(
        stats.cachedResponses,
        0,
        "a discriminant-less fallback write must store nothing shared"
      );
      assert.strictEqual(
        redisStore.size,
        0,
        "no fallback key may be persisted without a discriminant"
      );
    });

    it("reads a miss (fetch fresh) when no discriminant is supplied, even if a legacy shared key exists", async () => {
      const mgr = new FallbackManager("redis://localhost:6379");

      // Simulate a stale, pre-fix un-scoped entry left in the store.
      redisStore.set(`fallback:${SVC}:${OP}`, {
        value: JSON.stringify({
          response: { tenant: "A", token: "A-token" },
          timestamp: Date.now(),
          service: SVC,
          operation: OP,
        }),
        expiresAt: Date.now() + 60_000,
      });

      // Tenant B falls back with no discriminant — must NOT read the shared legacy key.
      const bResult = await mgr.executeFallback<AnalyticsPayload>(
        { strategy: "CACHED_RESPONSE" },
        {
          service: SVC,
          operation: OP,
          originalError: new Error("provider down for B"),
          attempt: 1,
        }
      );

      assert.strictEqual(
        bResult.ok,
        false,
        "a discriminant-less fallback read must be a miss, never a shared legacy-key hit"
      );
    });
  }
);

/* ──────────────────────────────────────────────────────────────────────
 * Same-tenant hit + prefix retention (do-not-regress)
 * ────────────────────────────────────────────────────────────────────── */
describe("L2 fallback store same-tenant hit and prefix retention", { concurrent: false }, () => {
  it("serves the same-tenant fallback hit within TTL when a discriminant is supplied", async () => {
    const mgr = new FallbackManager("redis://localhost:6379");

    await mgr.cacheSuccessfulResponse(SVC, OP, { tenant: "A", token: "A-token" }, 60_000, "disc-A");

    const result = await mgr.executeFallback<AnalyticsPayload>(
      { strategy: "CACHED_RESPONSE" },
      {
        service: SVC,
        operation: OP,
        originalError: new Error("provider down"),
        attempt: 1,
        discriminant: "disc-A",
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ tenant: "A", token: "A-token" });
    }
  });

  it("retains the `fallback:` key prefix so enumeration and clear still work", async () => {
    const mgr = new FallbackManager("redis://localhost:6379");

    await mgr.cacheSuccessfulResponse(SVC, OP, { tenant: "A", token: "A-token" }, 60_000, "disc-A");

    const before = await mgr.getFallbackStats();
    assert.strictEqual(
      before.cachedResponses,
      1,
      "enumeration via `fallback:*` must count the scoped key"
    );

    await mgr.clearFallbackCache();
    const after = await mgr.getFallbackStats();
    assert.strictEqual(
      after.cachedResponses,
      0,
      "clear via `fallback:*` must purge the scoped key"
    );
  });
});
