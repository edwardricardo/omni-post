/**
 * @file circuitBreakerC1bHardening.test.ts
 * @description C1b central-hardening tests for ExternalApiCircuitBreaker:
 *              - W-1: write operations partition circuit STATE per tenant (cacheEnabled:false
 *                stays uncached, but STATE is per-tenant so A's write failures never open B's
 *                write circuit).
 *              - W-2: admin controls (`forceOpen`/`forceClose`/`getStatus`) addressed by the
 *                generic two-part `service:operation` reach the now-partitioned breakers and
 *                aggregate worst-of across partitions, instead of silently no-op'ing / returning
 *                null.
 *              - S-2: an empty or whitespace-only discriminant is treated as ABSENT (fail-safe)
 *                on BOTH the L1 cache decision and the breaker STATE key.
 *
 *              RED without the C1b change: an empty-string discriminant is `!== undefined`, so
 *              pre-fix it keys a shared `service:operation:` entry (B served A's payload); a
 *              two-part `forceOpen`/`getStatus` misses every three-part partition (no-op / null).
 *              GREEN after: blank ⇒ absent, and the admin controls are prefix-aware.
 *
 *              Tier 0: no external services. Each test builds a fresh breaker with its own
 *              registry so opossum rolling counters never leak between tests.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import { ExternalApiCircuitBreaker } from "../src/circuitBreaker.js";

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

const SVC = "c1b-svc";

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────────────────────────────────────────────────────────
 * W-1: write operations partition circuit STATE per tenant
 * ────────────────────────────────────────────────────────────────────── */
describe("W-1: write ops partition circuit STATE per tenant", { concurrent: false }, () => {
  it("tenant A's write failures do not open tenant B's write circuit, and cache nothing", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const writeOp = "post-something"; // write verb; stays cacheEnabled:false
    const failingWrite = async (): Promise<string> => {
      throw new Error("provider write failed");
    };

    // 1. Tenant A trips its own write circuit OPEN.
    await assert.rejects(() =>
      cb.call(SVC, writeOp, failingWrite, [], {
        ...OPEN_FAST,
        cacheEnabled: false,
        cacheKeyDiscriminant: "wtenant-A",
      })
    );

    // 2. Do-not-regress: tenant A's next write is short-circuited by its OWN circuit.
    let aCalls = 0;
    const aWrite = async (): Promise<string> => {
      aCalls++;
      return "ok-A";
    };
    await assert.rejects(() =>
      cb.call(SVC, writeOp, aWrite, [], {
        ...OPEN_FAST,
        cacheEnabled: false,
        cacheKeyDiscriminant: "wtenant-A",
      })
    );
    assert.strictEqual(
      aCalls,
      0,
      "tenant A's write must stay short-circuited by its own OPEN circuit"
    );

    // 3. Tenant B (own discriminant) must NOT be short-circuited by A's failures.
    let bCalls = 0;
    const bWrite = async (): Promise<string> => {
      bCalls++;
      return "ok-B";
    };
    const bResult = await cb.call(SVC, writeOp, bWrite, [], {
      ...OPEN_FAST,
      cacheEnabled: false,
      cacheKeyDiscriminant: "wtenant-B",
    });
    assert.strictEqual(bCalls, 1, "tenant B's write must be attempted (not short-circuited by A)");
    assert.strictEqual(bResult, "ok-B");

    // 4. A cacheEnabled:false write never caches a payload (Fitness #25 posture intact).
    assert.strictEqual(cb.getCacheStats().size, 0, "write op must not cache any payload");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * W-2: admin controls are partition-aware  [MERGE-BLOCKING]
 * ────────────────────────────────────────────────────────────────────── */
describe("W-2: admin controls reach partitioned breakers", { concurrent: false }, () => {
  it("forceOpen/forceClose/getStatus addressed by the 2-part operation reach a 3-part partition", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "w2-op";
    const ok = async (): Promise<string> => "ok";

    // Create a per-tenant partition (3-part key) — no exact 2-part key exists.
    await cb.call(SVC, op, ok, [], { ...LENIENT, cacheKeyDiscriminant: "tenant-A" });
    const keys = Object.keys(cb.getAllStatuses());
    assert.ok(keys.includes(`${SVC}:${op}:tenant-A`), "a 3-part partition breaker exists");
    assert.ok(!keys.includes(`${SVC}:${op}`), "no legacy 2-part breaker exists for this op");

    // forceOpen addressed by the generic 2-part operation must reach the partition.
    assert.strictEqual(
      cb.forceOpen(SVC, op),
      true,
      "forceOpen must match the partition (not a no-op)"
    );

    const opened = cb.getStatus(SVC, op);
    assert.ok(opened !== null, "getStatus must aggregate the partition, not return null");
    assert.strictEqual(opened?.state, "OPEN", "worst-of aggregation reports OPEN");

    // forceClose reaches it too.
    assert.strictEqual(cb.forceClose(SVC, op), true, "forceClose must match the partition");
    assert.strictEqual(cb.getStatus(SVC, op)?.state, "CLOSED");
  });

  it("getStatus returns null only when no partition exists for the operation", () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    assert.strictEqual(cb.getStatus(SVC, "never-called-op"), null);
  });

  it("worst-of aggregation reports OPEN when any one partition is open", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "w2-agg-op";
    const ok = async (): Promise<string> => "ok";
    const failing = async (): Promise<string> => {
      throw new Error("down");
    };

    // Tenant A's partition trips OPEN; tenant B's partition stays CLOSED.
    await assert.rejects(() =>
      cb.call(SVC, op, failing, [], { ...OPEN_FAST, cacheKeyDiscriminant: "A" })
    );
    await cb.call(SVC, op, ok, [], { ...LENIENT, cacheKeyDiscriminant: "B" });

    const status = cb.getStatus(SVC, op);
    assert.strictEqual(status?.state, "OPEN", "one OPEN partition must dominate the aggregate");
  });

  it("prefix match does not bleed across sibling operations sharing a name prefix", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const ok = async (): Promise<string> => "ok";

    // `get-post` and `get-post-comments` share a textual prefix but are distinct ops.
    await cb.call(SVC, "get-post", ok, [], { ...LENIENT, cacheKeyDiscriminant: "A" });
    await cb.call(SVC, "get-post-comments", ok, [], { ...LENIENT, cacheKeyDiscriminant: "A" });

    // Opening `get-post` must NOT open `get-post-comments`.
    cb.forceOpen(SVC, "get-post");
    assert.strictEqual(cb.getStatus(SVC, "get-post")?.state, "OPEN");
    assert.strictEqual(
      cb.getStatus(SVC, "get-post-comments")?.state,
      "CLOSED",
      "sibling op sharing a name prefix must be unaffected"
    );
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * S-2: empty / whitespace discriminant treated as absent (fail-safe)
 * ────────────────────────────────────────────────────────────────────── */
describe("S-2: blank discriminant is treated as absent", { concurrent: false }, () => {
  it("empty-string discriminant never shares an L1 cache entry across tenants", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "s2-empty-op";
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
    const optsFor = () => ({
      cacheEnabled: true,
      cacheTtl: 60_000,
      cacheKeyDiscriminant: "",
      ...LENIENT,
    });

    const a = await cb.call(SVC, op, fetchFresh, [], optsFor());
    const b = await cb.call(SVC, op, fetchFresh, [], optsFor());

    assert.strictEqual(calls, 2, "empty discriminant must be treated as absent — B fetches fresh");
    assert.deepStrictEqual(a, { tenant: "A", secret: "A-token" });
    assert.deepStrictEqual(b, { tenant: "B", secret: "B-token" });
    assert.notStrictEqual(b.secret, "A-token");

    const shared = cb.getCacheStats().entries.filter((e) => e.key.startsWith(`${SVC}:${op}:`));
    assert.strictEqual(shared.length, 0, "no shared cache entry for a blank discriminant");
  });

  it("whitespace-only discriminant does not create a blank STATE partition", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    const op = "s2-ws-op";
    const ok = async (): Promise<string> => "ok";

    await cb.call(SVC, op, ok, [], { ...LENIENT, cacheKeyDiscriminant: "   " });

    const keys = Object.keys(cb.getAllStatuses());
    assert.ok(
      keys.includes(`${SVC}:${op}`),
      "blank discriminant falls back to the legacy 2-part STATE key"
    );
    assert.ok(
      !keys.some((k) => k.startsWith(`${SVC}:${op}:`)),
      "no blank 3-part partition (`service:operation:`) is ever created"
    );
  });
});
