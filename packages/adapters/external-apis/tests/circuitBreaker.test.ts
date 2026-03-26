/**
 * ExternalApiCircuitBreaker tests
 *
 * Tier 0: no external services needed.
 * Tests the circuit breaker class directly using an isolated prom-client
 * registry. The underlying opossum library is a real dependency (pure JS,
 * no network), so no mocking is required for the breaker itself.
 *
 * Fallback and dead-letter integrations are tested only through the
 * constructor path -- since no Redis URL is provided, they degrade
 * gracefully to no-ops.
 *
 * IMPORTANT: Each describe block creates a fresh ExternalApiCircuitBreaker
 * with its own prom-client.Registry to prevent breaker state leaking
 * between test groups. Opossum's internal rolling counters can cause
 * a breaker to open unexpectedly if error counts accumulate across tests.
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import { ExternalApiCircuitBreaker, DEFAULT_EXTERNAL_API_OPTIONS } from "../src/circuitBreaker.js";

/** Options that prevent the circuit from opening prematurely during tests */
const LENIENT_BREAKER_OPTS = {
  errorThresholdPercentage: 100,
  monitoringPeriod: 60_000,
  halfOpenRetries: 100,
  resetTimeout: 60_000,
  fallbackEnabled: false,
  deadLetterEnabled: false,
} as const;

beforeAll(() => {
  client.register.clear();
});

afterAll(() => {
  client.register.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────────────────────────────────────────────────────────
 * 1. DEFAULT_EXTERNAL_API_OPTIONS
 * ────────────────────────────────────────────────────────────────────── */
describe("DEFAULT_EXTERNAL_API_OPTIONS", { concurrent: false }, () => {
  it("has correct timeout value (10 seconds)", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.timeout).toBe(10_000);
  });

  it("has correct error threshold percentage", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.errorThresholdPercentage).toBe(50);
  });

  it("has correct reset timeout (30 seconds)", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.resetTimeout).toBe(30_000);
  });

  it("has correct monitoring period (10 seconds)", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.monitoringPeriod).toBe(10_000);
  });

  it("has correct half-open retries", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.halfOpenRetries).toBe(3);
  });

  it("has correct max retries", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.maxRetries).toBe(3);
  });

  it("has correct base delay (1 second)", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.baseDelay).toBe(1_000);
  });

  it("has correct max delay (30 seconds)", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.maxDelay).toBe(30_000);
  });

  it("has correct backoff multiplier", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.backoffMultiplier).toBe(2);
  });

  it("has jitter enabled by default", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.jitterEnabled).toBe(true);
  });

  it("has correct cache TTL (5 minutes)", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.cacheTtl).toBe(300_000);
  });

  it("has fallback enabled by default", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled).toBe(true);
  });

  it("has dead letter enabled by default", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.deadLetterEnabled).toBe(true);
  });

  it("has normal dead letter priority by default", () => {
    expect(DEFAULT_EXTERNAL_API_OPTIONS.deadLetterPriority).toBe("normal");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 2. Constructor & creation
 * ────────────────────────────────────────────────────────────────────── */
describe("ExternalApiCircuitBreaker -- constructor", { concurrent: false }, () => {
  it("creates an instance without throwing", () => {
    const reg = new client.Registry();
    assert.doesNotThrow(() => {
      new ExternalApiCircuitBreaker(reg);
    });
  });

  it("creates an instance without a Redis URL (fallback/DLQ disabled)", () => {
    const reg = new client.Registry();
    const instance = new ExternalApiCircuitBreaker(reg);
    expect(instance).toBeTruthy();
  });

  it("registers prometheus metrics in the given registry", async () => {
    const reg = new client.Registry();
    new ExternalApiCircuitBreaker(reg);

    const metrics = await reg.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);

    const expectedNames = [
      "circuit_breaker_requests_total",
      "circuit_breaker_failures_total",
      "circuit_breaker_successes_total",
      "circuit_breaker_timeouts_total",
      "circuit_breaker_fallbacks_total",
      "circuit_breaker_state_changes_total",
      "external_api_request_duration_seconds",
      "external_api_requests_in_flight",
      "external_api_retry_attempts_total",
      "external_api_cache_hits_total",
      "external_api_cache_misses_total",
      "external_api_cache_errors_total",
    ];

    for (const expected of expectedNames) {
      assert.ok(names.includes(expected), `should have metric: ${expected}`);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 3. Successful calls pass through correctly
 * ────────────────────────────────────────────────────────────────────── */
describe("ExternalApiCircuitBreaker -- successful calls", { concurrent: false }, () => {
  let cb: ExternalApiCircuitBreaker;

  beforeAll(() => {
    cb = new ExternalApiCircuitBreaker(new client.Registry());
  });

  it("passes through a successful async call and returns its result", async () => {
    const operation = async () => ({ data: "hello" });

    const result = await cb.call("suc-svc", "op-pass", operation, [], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result).toEqual({ data: "hello" });
  });

  it("passes arguments to the underlying function", async () => {
    const operation = async (a: number, b: number) => a + b;

    const result = await cb.call("suc-svc", "op-args", operation, [3, 7], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result).toBe(10);
  });

  it("returns cached result on cache hit", async () => {
    let callCount = 0;
    const operation = async () => {
      callCount++;
      return { count: callCount };
    };

    // First call -- cache miss
    const result1 = await cb.call("suc-svc", "op-cached", operation, [], {
      maxRetries: 0,
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result1).toEqual({ count: 1 });

    // Second call -- should be served from cache
    const result2 = await cb.call("suc-svc", "op-cached", operation, [], {
      maxRetries: 0,
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result2).toEqual({ count: 1 });
    expect(callCount).toBe(1);
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 4. Failed calls and retries
 *
 * Each test gets a fresh ExternalApiCircuitBreaker so opossum
 * error counters never accumulate and trigger an early circuit open.
 * ────────────────────────────────────────────────────────────────────── */
describe("ExternalApiCircuitBreaker -- failed calls", { concurrent: false }, () => {
  it("throws on non-retryable error without retrying", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    let callCount = 0;
    const operation = async () => {
      callCount++;
      const error = new Error("Bad request");
      (error as unknown as { status: number }).status = 400;
      throw error;
    };

    await assert.rejects(
      () =>
        cb.call("fail-svc", "op-400", operation, [], {
          maxRetries: 3,
          baseDelay: 1,
          maxDelay: 5,
          ...LENIENT_BREAKER_OPTS,
        }),
      { message: "Bad request" }
    );

    // Non-retryable 400 error: first attempt fails, no retries
    expect(callCount).toBe(1);
  });

  it("retries on retryable errors (5xx) up to maxRetries", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    let callCount = 0;
    const operation = async () => {
      callCount++;
      const error = new Error("Server error");
      (error as unknown as { code: number }).code = 500;
      throw error;
    };

    await assert.rejects(
      () =>
        cb.call("fail-svc", "op-500", operation, [], {
          maxRetries: 2,
          baseDelay: 1,
          maxDelay: 5,
          jitterEnabled: false,
          ...LENIENT_BREAKER_OPTS,
        }),
      (thrown: unknown) => {
        // Could be "Server error" or "Breaker is open" depending on timing
        assert.ok(thrown instanceof Error, "should throw an Error");
        return true;
      }
    );

    // With errorThresholdPercentage: 100, opossum should not open the circuit,
    // so we expect: 1 initial + 2 retries = 3 calls
    expect(callCount).toBe(3);
  });

  it("retries on network errors (ECONNRESET) and recovers", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    let callCount = 0;
    const operation = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("ECONNRESET");
      }
      return { recovered: true };
    };

    const result = await cb.call("fail-svc", "op-connreset", operation, [], {
      maxRetries: 3,
      baseDelay: 1,
      maxDelay: 5,
      jitterEnabled: false,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result).toEqual({ recovered: true });
    expect(callCount).toBe(3);
  });

  it("retries on 429 Too Many Requests and recovers", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    let callCount = 0;
    const operation = async () => {
      callCount++;
      if (callCount < 2) {
        const error = new Error("Too many requests");
        (error as unknown as { code: number }).code = 429;
        throw error;
      }
      return { ok: true };
    };

    const result = await cb.call("fail-svc", "op-429", operation, [], {
      maxRetries: 3,
      baseDelay: 1,
      maxDelay: 5,
      jitterEnabled: false,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  it("retries on 408 Request Timeout", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    let callCount = 0;
    const operation = async () => {
      callCount++;
      if (callCount < 2) {
        const error = new Error("Request Timeout");
        (error as unknown as { code: number }).code = 408;
        throw error;
      }
      return { ok: true };
    };

    const result = await cb.call("fail-svc", "op-408", operation, [], {
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 5,
      jitterEnabled: false,
      ...LENIENT_BREAKER_OPTS,
    });

    expect(result).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  it("does not retry on 501 Not Implemented", async () => {
    const cb = new ExternalApiCircuitBreaker(new client.Registry());
    let callCount = 0;
    const operation = async () => {
      callCount++;
      const error = new Error("Not Implemented");
      (error as unknown as { code: number }).code = 501;
      throw error;
    };

    await assert.rejects(
      () =>
        cb.call("fail-svc", "op-501", operation, [], {
          maxRetries: 3,
          baseDelay: 1,
          maxDelay: 5,
          ...LENIENT_BREAKER_OPTS,
        }),
      { message: "Not Implemented" }
    );

    expect(callCount).toBe(1);
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 5. Circuit breaker status management
 * ────────────────────────────────────────────────────────────────────── */
describe("ExternalApiCircuitBreaker -- status & management", { concurrent: false }, () => {
  let cb: ExternalApiCircuitBreaker;

  beforeAll(() => {
    cb = new ExternalApiCircuitBreaker(new client.Registry());
  });

  it("getStatus returns null for unknown service/operation", () => {
    const status = cb.getStatus("unknown", "unknown");
    expect(status).toBe(null);
  });

  it("getStatus returns CLOSED state after successful call", async () => {
    const operation = async () => "ok";

    await cb.call("stat-svc", "stat-op", operation, [], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });

    const status = cb.getStatus("stat-svc", "stat-op");
    expect(status).toBeTruthy();
    expect(status!.state).toBe("CLOSED");
  });

  it("getAllStatuses returns all registered breakers", async () => {
    const operation = async () => "ok";

    await cb.call("all-a", "op-a", operation, [], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });
    await cb.call("all-b", "op-b", operation, [], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });

    const statuses = cb.getAllStatuses();
    assert.ok("all-a:op-a" in statuses, "should contain all-a:op-a");
    assert.ok("all-b:op-b" in statuses, "should contain all-b:op-b");
  });

  it("forceOpen returns false for unknown breaker", () => {
    expect(cb.forceOpen("nope", "nope")).toBe(false);
  });

  it("forceOpen opens a known breaker", async () => {
    const operation = async () => "ok";

    await cb.call("force-svc", "force-op", operation, [], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });

    const opened = cb.forceOpen("force-svc", "force-op");
    expect(opened).toBe(true);

    const status = cb.getStatus("force-svc", "force-op");
    expect(status).toBeTruthy();
    expect(status!.state).toBe("OPEN");
  });

  it("forceClose returns false for unknown breaker", () => {
    expect(cb.forceClose("nope2", "nope2")).toBe(false);
  });

  it("forceClose closes a known breaker", async () => {
    const operation = async () => "ok";

    await cb.call("close-svc", "close-op", operation, [], {
      maxRetries: 0,
      ...LENIENT_BREAKER_OPTS,
    });

    cb.forceOpen("close-svc", "close-op");
    const closed = cb.forceClose("close-svc", "close-op");
    expect(closed).toBe(true);

    const status = cb.getStatus("close-svc", "close-op");
    expect(status).toBeTruthy();
    expect(status!.state).toBe("CLOSED");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 6. Cache management
 * ────────────────────────────────────────────────────────────────────── */
describe("ExternalApiCircuitBreaker -- cache management", { concurrent: false }, () => {
  let cb: ExternalApiCircuitBreaker;

  beforeAll(() => {
    cb = new ExternalApiCircuitBreaker(new client.Registry());
  });

  it("getCacheStats returns size 0 on fresh instance", () => {
    const stats = cb.getCacheStats();
    expect(stats.size).toBe(0);
    assert.ok(Array.isArray(stats.entries), "entries should be an array");
  });

  it("getCacheStats shows cached entries after a cached call", async () => {
    const operation = async () => ({ cached: true });

    await cb.call("cch-svc", "cch-op", operation, [], {
      maxRetries: 0,
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT_BREAKER_OPTS,
    });

    const stats = cb.getCacheStats();
    expect(stats.size >= 1).toBeTruthy();
  });

  it("clearCache removes all entries when called without arguments", async () => {
    const operation = async () => ({ cached: true });

    await cb.call("cch-svc", "cch-clear", operation, [], {
      maxRetries: 0,
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT_BREAKER_OPTS,
    });

    cb.clearCache();
    const stats = cb.getCacheStats();
    expect(stats.size).toBe(0);
  });

  it("clearCache with service/operation only removes matching entries", async () => {
    const operation = async () => ({ cached: true });

    await cb.call("svc-x", "op-x", operation, [], {
      maxRetries: 0,
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT_BREAKER_OPTS,
    });

    await cb.call("svc-y", "op-y", operation, [], {
      maxRetries: 0,
      cacheEnabled: true,
      cacheTtl: 60_000,
      ...LENIENT_BREAKER_OPTS,
    });

    const beforeClear = cb.getCacheStats().size;
    expect(beforeClear >= 2).toBeTruthy();

    cb.clearCache("svc-x", "op-x");
    const afterClear = cb.getCacheStats();

    // svc-y:op-y should still be cached
    const hasY = afterClear.entries.some((e) => e.key.startsWith("svc-y:op-y:"));
    expect(hasY).toBeTruthy();
  });
});
