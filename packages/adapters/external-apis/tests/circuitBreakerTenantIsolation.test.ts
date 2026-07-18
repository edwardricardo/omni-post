/**
 * @file circuitBreakerTenantIsolation.test.ts
 * @description Tenant-isolation tests for ExternalApiCircuitBreaker (C1 / N-SEC-1 + N-SEC-1b).
 *              Drives the breaker directly with an isolated prom-client registry. Covers the
 *              MERGE-BLOCKING invariants: per-tenant STATE partitioning, the fail-safe cache
 *              default (no discriminant => cache skip), same-tenant cache reuse when a
 *              discriminant is supplied, cross-tenant cache isolation, LRU growth-bounding, and
 *              the write-path fail-fast do-not-regress.
 *
 *              Tier 0: no external services. Each test builds a fresh breaker with its own
 *              registry so opossum rolling counters never leak between tests.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import { ExternalApiCircuitBreaker, DEFAULT_EXTERNAL_API_OPTIONS } from "../src/circuitBreaker.js";

/** Options that keep a breaker from opening on the happy path during a test. */
const LENIENT = {
  errorThresholdPercentage: 100,
  monitoringPeriod: 60_000,
  halfOpenRetries: 100,
  resetTimeout: 60_000,
  fallbackEnabled: false,
  deadLetterEnabled: false,
  maxRetries: 0,
} as const;

/** Options that open a breaker on the first failure (volumeThreshold 0, 100% > 1%). */
const OPEN_FAST = {
  errorThresholdPercentage: 1,
  maxRetries: 0,
  resetTimeout: 60_000,
  monitoringPeriod: 60_000,
  halfOpenRetries: 1,
  fallbackEnabled: false,
  deadLetterEnabled: false,
  cacheEnabled: false,
} as const;

const SVC = "iso-svc";

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────────────────────────────────────────────────────────
 * Circuit STATE is partitioned per tenant  [MERGE-BLOCKING] (Spec C1-R4)
 * ────────────────────────────────────────────────────────────────────── */
describe("circuit STATE partition per tenant", { concurrent: false }, () => {
  it("does not short-circuit tenant B when tenant A's circuit is OPEN, but still short-circuits A", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "state-op";
    const failing = async (): Promise<{ tenant: string }> => {
      throw new Error("provider down");
    };

    // 1. Trip tenant A's circuit OPEN (one failure suffices).
    await assert.rejects(() =>
      cb.call(SVC, op, failing, [], { ...OPEN_FAST, cacheKeyDiscriminant: "tenant-A" })
    );

    // 2. Do-not-regress: tenant A stays short-circuited by its own OPEN circuit.
    let aProbeCalls = 0;
    const aProbe = async (): Promise<{ tenant: string }> => {
      aProbeCalls++;
      return { tenant: "A" };
    };
    await assert.rejects(() =>
      cb.call(SVC, op, aProbe, [], { ...OPEN_FAST, cacheKeyDiscriminant: "tenant-A" })
    );
    assert.strictEqual(
      aProbeCalls,
      0,
      "tenant A must remain short-circuited by its own OPEN circuit"
    );

    // 3. Tenant B (distinct discriminant) must NOT be short-circuited by A's failures.
    let bCalls = 0;
    const bOk = async (): Promise<{ tenant: string }> => {
      bCalls++;
      return { tenant: "B" };
    };
    const bResult = await cb.call(SVC, op, bOk, [], {
      ...OPEN_FAST,
      cacheKeyDiscriminant: "tenant-B",
    });

    assert.strictEqual(
      bCalls,
      1,
      "tenant B's provider call must be attempted (not short-circuited by A)"
    );
    assert.deepStrictEqual(bResult, { tenant: "B" });
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * D8 (Fix B): a shared (discriminant-less) breaker runs the CALLER's own
 * closure — the bound-closure cross-tenant disclosure vector is closed for
 * EVERY call, independent of the discriminant.  [MERGE-BLOCKING]
 * ────────────────────────────────────────────────────────────────────── */
describe("shared breaker runs the caller's own closure (D8)", { concurrent: false }, () => {
  it("serves tenant B its OWN result on a shared discriminant-less op, never tenant A's closure", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    // Uncached (cacheEnabled:false), NO discriminant → both tenants share the
    // legacy `svc:op` breaker key. This isolates the bound-closure vector from
    // the L1/L2 cache vectors (which fail-safe-skip on a missing discriminant).
    const op = "shared-closure-op";

    const aCall = async (): Promise<{ tenant: string }> => ({ tenant: "A" });
    const bCall = async (): Promise<{ tenant: string }> => ({ tenant: "B" });

    // Tenant A fires first, creating the shared `svc:op` breaker.
    const aResult = await cb.call(SVC, op, aCall, [], { ...LENIENT, cacheEnabled: false });
    // Tenant B fires the SAME shared key with its OWN closure. Pre-D8 the breaker
    // ignored the newly-passed apiCall and re-ran A's bound closure → B got A's
    // payload (RED). With the generic dispatcher, B runs bCall (GREEN).
    const bResult = await cb.call(SVC, op, bCall, [], { ...LENIENT, cacheEnabled: false });

    assert.deepStrictEqual(aResult, { tenant: "A" });
    assert.deepStrictEqual(
      bResult,
      { tenant: "B" },
      "shared breaker must run tenant B's own closure (bound-closure disclosure closed)"
    );
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * Cache is fail-safe when no discriminant is supplied  [MERGE-BLOCKING] (Spec C1-R1b)
 * ────────────────────────────────────────────────────────────────────── */
describe("fail-safe cache default (no discriminant => cache skip)", { concurrent: false }, () => {
  it("never serves a shared cache entry across tenants for a discriminant-less op", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "fail-safe-op";
    const payloads = [
      { tenant: "A", secret: "A-token" },
      { tenant: "B", secret: "B-token" },
    ];
    let calls = 0;
    const fetchFresh = async (): Promise<{ tenant: string; secret: string }> => {
      const payload = payloads[calls] ?? { tenant: "?", secret: "?" };
      calls++;
      return payload;
    };

    // No cacheKeyDiscriminant supplied — the breaker must treat both calls as misses.
    const a = await cb.call(SVC, op, fetchFresh, [], {
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT,
    });
    const b = await cb.call(SVC, op, fetchFresh, [], {
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT,
    });

    assert.strictEqual(calls, 2, "tenant B must fetch fresh — a discriminant-less op must skip L1");
    assert.deepStrictEqual(a, { tenant: "A", secret: "A-token" });
    assert.deepStrictEqual(b, { tenant: "B", secret: "B-token" });
    assert.notStrictEqual(b.secret, "A-token");

    // The breaker must store nothing shared a later different-tenant call could hit.
    const shared = cb.getCacheStats().entries.filter((e) => e.key.startsWith(`${SVC}:${op}:`));
    assert.strictEqual(shared.length, 0, "fail-safe default must store no shared cache entry");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * Same-tenant cache reuse + cross-tenant isolation when a discriminant IS supplied
 * ────────────────────────────────────────────────────────────────────── */
describe("discriminant-scoped caching", { concurrent: false }, () => {
  it("serves the same-tenant cache hit within TTL when a discriminant is supplied (no perf regression)", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "same-tenant-op";
    let calls = 0;
    const fetchFresh = async (): Promise<{ tenant: string; n: number }> => {
      calls++;
      return { tenant: "A", n: calls };
    };

    const opts = {
      cacheEnabled: true,
      cacheTtl: 60_000,
      cacheKeyDiscriminant: "tenant-A-hash",
      ...LENIENT,
    };
    const r1 = await cb.call(SVC, op, fetchFresh, [], opts);
    const r2 = await cb.call(SVC, op, fetchFresh, [], opts);

    assert.deepStrictEqual(r1, { tenant: "A", n: 1 });
    assert.deepStrictEqual(
      r2,
      { tenant: "A", n: 1 },
      "second same-tenant call must be served from cache"
    );
    assert.strictEqual(calls, 1, "same-tenant cache hit must not re-invoke the provider");
  });

  it("never serves tenant A's cached payload to tenant B when each carries its own discriminant", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "cross-tenant-op";
    const byTenant: Record<string, { tenant: string; secret: string }> = {
      "disc-A": { tenant: "A", secret: "A-secret" },
      "disc-B": { tenant: "B", secret: "B-secret" },
    };
    let calls = 0;
    const makeFetch = (disc: string) => async (): Promise<{ tenant: string; secret: string }> => {
      calls++;
      return byTenant[disc] ?? { tenant: "?", secret: "?" };
    };

    const a = await cb.call(SVC, op, makeFetch("disc-A"), [], {
      cacheEnabled: true,
      cacheTtl: 60_000,
      cacheKeyDiscriminant: "disc-A",
      ...LENIENT,
    });
    const b = await cb.call(SVC, op, makeFetch("disc-B"), [], {
      cacheEnabled: true,
      cacheTtl: 60_000,
      cacheKeyDiscriminant: "disc-B",
      ...LENIENT,
    });

    assert.strictEqual(calls, 2, "distinct discriminants must not collapse to one cache entry");
    assert.deepStrictEqual(a, { tenant: "A", secret: "A-secret" });
    assert.deepStrictEqual(b, { tenant: "B", secret: "B-secret" });
    assert.notStrictEqual(b.secret, "A-secret");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * LRU growth-bounding (Design D2) — timer-free eviction
 * ────────────────────────────────────────────────────────────────────── */
describe("LRU eviction bounds growth (timer-free)", { concurrent: false }, () => {
  it("evicts the least-recently-used cache entry once the cap is exceeded", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry(), undefined, {
      maxCacheEntries: 3,
    });
    const op = "lru-cache-op";
    const fetchFresh = async (): Promise<{ ok: true }> => ({ ok: true });
    const call = (disc: string) =>
      cb.call(SVC, op, fetchFresh, [], {
        cacheEnabled: true,
        cacheTtl: 60_000,
        cacheKeyDiscriminant: disc,
        ...LENIENT,
      });

    await call("disc-0");
    await call("disc-1");
    await call("disc-2");
    // Touch disc-0 (cache hit) so it becomes most-recently-used.
    await call("disc-0");
    // Overflow: inserting disc-3 must evict the LRU entry (disc-1), not disc-0.
    await call("disc-3");

    const keys = cb.getCacheStats().entries.map((e) => e.key);
    assert.ok(keys.includes(`${SVC}:${op}:disc-0`), "recently-touched disc-0 must survive");
    assert.ok(!keys.includes(`${SVC}:${op}:disc-1`), "LRU disc-1 must be evicted");
    assert.ok(keys.includes(`${SVC}:${op}:disc-2`), "disc-2 must survive");
    assert.ok(keys.includes(`${SVC}:${op}:disc-3`), "newest disc-3 must survive");
  });

  it("does not evict an actively-touched breaker while idle breakers are evicted", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry(), undefined, {
      maxBreakerEntries: 3,
    });
    const ok = async (): Promise<string> => "ok";
    const call = (op: string) => cb.call(SVC, op, ok, [], { ...LENIENT });

    await call("op-0");
    await call("op-1");
    await call("op-2");
    // Touch op-0 so it is most-recently-used among the resident breakers.
    await call("op-0");
    // Overflow: creating op-3 must evict the LRU breaker (op-1), not op-0.
    await call("op-3");

    assert.notStrictEqual(
      cb.getStatus(SVC, "op-0"),
      null,
      "actively-touched op-0 breaker must survive"
    );
    assert.strictEqual(cb.getStatus(SVC, "op-1"), null, "idle LRU op-1 breaker must be evicted");
    assert.notStrictEqual(cb.getStatus(SVC, "op-2"), null, "op-2 breaker must survive");
    assert.notStrictEqual(cb.getStatus(SVC, "op-3"), null, "newest op-3 breaker must survive");
  });

  it("never evicts an OPEN breaker under pressure — a downed provider stays tripped", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry(), undefined, {
      maxBreakerEntries: 2,
    });
    const failing = async (): Promise<never> => {
      throw new Error("provider down");
    };
    const ok = async (): Promise<string> => "ok";

    // 1. Create the OLDEST breaker and trip it OPEN (one failure opens under OPEN_FAST).
    await assert.rejects(() => cb.call(SVC, "op-open", failing, [], { ...OPEN_FAST }));
    assert.strictEqual(
      cb.getStatus(SVC, "op-open")?.state,
      "OPEN",
      "precondition: op-open breaker is OPEN"
    );

    // 2. Create enough CLOSED breakers to exceed the cap. Under the old
    //    unconditional oldest-first eviction, op-open (the oldest key) would be
    //    deleted and a re-created breaker would start CLOSED — re-probing the
    //    downed provider.
    await cb.call(SVC, "op-closed-1", ok, [], { ...LENIENT });
    await cb.call(SVC, "op-closed-2", ok, [], { ...LENIENT });

    // 3. The OPEN breaker MUST survive the eviction pressure and stay OPEN; a
    //    CLOSED breaker is evicted in its place.
    assert.strictEqual(
      cb.getStatus(SVC, "op-open")?.state,
      "OPEN",
      "OPEN breaker must survive LRU pressure and remain OPEN (never evicted + re-probed)"
    );
    assert.strictEqual(
      cb.getStatus(SVC, "op-closed-1"),
      null,
      "the CLOSED LRU breaker must be evicted in place of the OPEN one"
    );
    assert.notStrictEqual(
      cb.getStatus(SVC, "op-closed-2"),
      null,
      "the newest CLOSED breaker survives"
    );
  });

  it("evicts a HALF_OPEN breaker (Tier 2) when over cap and no CLOSED candidate remains", async () => {
    vi.useFakeTimers();
    try {
      const cb = new ExternalApiCircuitBreaker(new client.Registry(), undefined, {
        maxBreakerEntries: 1,
      });
      const op = "half-open-op";
      const failing = async (): Promise<never> => {
        throw new Error("provider down");
      };

      // 1. Trip the OLDEST breaker OPEN, then advance opossum's resetTimeout so it
      //    auto-transitions OPEN -> HALF_OPEN WITHOUT a successful probe (opossum 9.x:
      //    the reset timer half-opens the breaker; it only re-closes on a probe SUCCESS,
      //    which idle traffic never sends — so it stays HALF_OPEN indefinitely).
      await assert.rejects(() =>
        cb.call(SVC, op, failing, [], { ...OPEN_FAST, resetTimeout: 100 })
      );
      assert.strictEqual(cb.getStatus(SVC, op)?.state, "OPEN", "precondition: breaker is OPEN");

      await vi.advanceTimersByTimeAsync(150);
      assert.strictEqual(
        cb.getStatus(SVC, op)?.state,
        "HALF_OPEN",
        "precondition: idle breaker auto-transitioned to HALF_OPEN (no successful probe)"
      );

      // 2. Insert a NEW breaker (distinct op). It is protected as the live call, and the
      //    only other resident breaker is HALF_OPEN (no CLOSED candidate remains), so
      //    Tier 1 finds nothing to evict and Tier 2 must evict the stale HALF_OPEN one —
      //    the cap is enforced without dropping the fresh breaker.
      const ok = async (): Promise<string> => "ok";
      await cb.call(SVC, "fresh-op", ok, [], { ...LENIENT });

      assert.strictEqual(
        cb.getStatus(SVC, op),
        null,
        "the idle HALF_OPEN breaker must be evicted (Tier 2) once no CLOSED candidate remains"
      );
      assert.notStrictEqual(
        cb.getStatus(SVC, "fresh-op"),
        null,
        "the just-inserted breaker (live call) must be retained"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the pool absolutely bounded even when every breaker is OPEN (Tier 3 last resort)", async () => {
    const cap = 2;
    const cb = new ExternalApiCircuitBreaker(new client.Registry(), undefined, {
      maxBreakerEntries: cap,
    });
    const failing = async (): Promise<never> => {
      throw new Error("provider down");
    };

    // Fill well past the cap, tripping each distinct breaker OPEN. Under a policy that
    // permanently exempts non-CLOSED breakers the pool would grow unbounded; Tier 3 evicts
    // the oldest OPEN as a last resort so the cap is NEVER exceeded after any insertion.
    for (let i = 0; i < cap + 5; i++) {
      await assert.rejects(() => cb.call(SVC, `open-op-${i}`, failing, [], { ...OPEN_FAST }));
      assert.ok(
        Object.keys(cb.getAllStatuses()).length <= cap,
        `pool must never exceed cap=${cap} after inserting open-op-${i}`
      );
    }

    // Final state: exactly `cap` breakers resident, and they are the newest OPEN ones.
    const statuses = cb.getAllStatuses();
    assert.strictEqual(
      Object.keys(statuses).length,
      cap,
      "pool settles at exactly the cap under sustained OPEN pressure"
    );
    for (const status of Object.values(statuses)) {
      assert.strictEqual(status?.state, "OPEN", "the surviving breakers are the OPEN ones");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * Write-path fail-fast invariant preserved  [MERGE-BLOCKING] (Spec C1-R5 / Fitness #25 Part A)
 * ────────────────────────────────────────────────────────────────────── */
describe("write-path fail-fast do-not-regress", { concurrent: false }, () => {
  it("keeps DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled false", () => {
    assert.strictEqual(DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled, false);
  });
});
