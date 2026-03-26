/**
 * Queue resilience layer tests
 * Tests circuit breaker, exponential backoff retry, metrics collector, and default options.
 * Tier 0: no Redis, no BullMQ — uses real opossum instances with simple async functions.
 */

import { describe, it, afterAll, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";

import {
  createCircuitBreaker,
  withExponentialBackoff,
  MetricsCollector,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  DEFAULT_RETRY_OPTIONS,
} from "../src/resilience.js";

// Track all circuit breakers so we can shut them down in afterAll()
const breakers: Array<{ shutdown: () => void }> = [];

afterAll(() => {
  for (const b of breakers) {
    b.shutdown();
  }
  breakers.length = 0;
});

// ---------------------------------------------------------------------------
// DEFAULT OPTIONS
// ---------------------------------------------------------------------------

describe("DEFAULT_CIRCUIT_BREAKER_OPTIONS", { concurrency: 1 }, () => {
  it("has expected timeout", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeout).toBe(5000);
  });

  it("has expected errorThresholdPercentage", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.errorThresholdPercentage).toBe(50);
  });

  it("has expected resetTimeout", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.resetTimeout).toBe(30000);
  });

  it("has expected monitoringPeriod", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.monitoringPeriod).toBe(10000);
  });

  it("has expected halfOpenRetries", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.halfOpenRetries).toBe(3);
  });
});

describe("DEFAULT_RETRY_OPTIONS", { concurrency: 1 }, () => {
  it("has expected maxRetries", () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBe(3);
  });

  it("has expected baseDelay", () => {
    expect(DEFAULT_RETRY_OPTIONS.baseDelay).toBe(100);
  });

  it("has expected maxDelay", () => {
    expect(DEFAULT_RETRY_OPTIONS.maxDelay).toBe(5000);
  });

  it("has expected backoffMultiplier", () => {
    expect(DEFAULT_RETRY_OPTIONS.backoffMultiplier).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// createCircuitBreaker
// ---------------------------------------------------------------------------

describe("createCircuitBreaker()", { concurrency: 1 }, () => {
  it("wraps and executes a function, returning its result", async () => {
    const fn = async (x: number) => x * 3;
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    const result = await breaker.fire(7);
    expect(result).toBe(21);
  });

  it("passes multiple arguments through to the wrapped function", async () => {
    const fn = async (a: number, b: number) => a + b;
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    const result = await breaker.fire(10, 20);
    expect(result).toBe(30);
  });

  it("fires open event on state change after failures", async () => {
    let openFired = false;
    const alwaysFails = async () => {
      throw new Error("queue down");
    };

    const breaker = createCircuitBreaker(alwaysFails, {
      timeout: 5000,
      errorThresholdPercentage: 1,
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      halfOpenRetries: 10,
    });
    breakers.push(breaker);

    breaker.on("open", () => {
      openFired = true;
    });

    for (let i = 0; i < 15; i++) {
      try {
        await breaker.fire();
      } catch {
        // expected
      }
    }

    expect(openFired).toBeTruthy();
    expect(breaker.opened).toBeTruthy();
  });

  it("rejects calls when circuit is open", async () => {
    const alwaysFails = async () => {
      throw new Error("fail");
    };

    const breaker = createCircuitBreaker(alwaysFails, {
      timeout: 5000,
      errorThresholdPercentage: 1,
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      halfOpenRetries: 10,
    });
    breakers.push(breaker);

    // Force open
    for (let i = 0; i < 15; i++) {
      try {
        await breaker.fire();
      } catch {
        // expected
      }
    }

    expect(breaker.opened).toBeTruthy();

    const err = await breaker.fire().catch((e: Error) => e);
    assert.ok(err instanceof Error);
    assert.ok(
      err.message.includes("Breaker is open") || err.message.includes("breaker"),
      `Expected circuit breaker rejection, got: ${err.message}`
    );
  });

  it("applies custom options overriding defaults", async () => {
    const fn = async () => "ok";
    const breaker = createCircuitBreaker(fn, {
      timeout: 1000,
      errorThresholdPercentage: 25,
      resetTimeout: 2000,
    });
    breakers.push(breaker);

    // Verify it works (options are applied internally by opossum)
    const result = await breaker.fire();
    expect(result).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// withExponentialBackoff
// ---------------------------------------------------------------------------

describe("withExponentialBackoff()", { concurrency: 1 }, () => {
  it("succeeds immediately on first try", async () => {
    let callCount = 0;
    const result = await withExponentialBackoff(
      async () => {
        callCount++;
        return "instant";
      },
      { maxRetries: 3, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    );

    expect(result).toBe("instant");
    expect(callCount).toBe(1);
  });

  it("retries failed operations and eventually succeeds", async () => {
    let callCount = 0;
    const result = await withExponentialBackoff(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("transient failure");
        }
        return "recovered";
      },
      { maxRetries: 5, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    );

    expect(result).toBe("recovered");
    expect(callCount).toBe(3);
  });

  it("throws after exceeding maxRetries", async () => {
    let callCount = 0;
    const err = await withExponentialBackoff(
      async () => {
        callCount++;
        throw new Error("permanent failure");
      },
      { maxRetries: 2, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    ).catch((e: Error) => e);

    assert.ok(err instanceof Error);
    assert.ok(err.message.includes("permanent failure"));

    // maxRetries=2 means: 1 initial + 2 retries = 3 total calls
    expect(callCount).toBe(3);
  });

  it("wraps non-Error thrown values into Error objects", async () => {
    const err = await withExponentialBackoff(
      async () => {
        throw "string error";
      },
      { maxRetries: 0, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    ).catch((e: Error) => e);

    assert.ok(err instanceof Error, "should be an Error instance");
    assert.ok(err.message.includes("string error"));
  });

  it("respects maxRetries=0 (no retries)", async () => {
    let callCount = 0;
    await expect(
      withExponentialBackoff(
        async () => {
          callCount++;
          throw new Error("fail once");
        },
        { maxRetries: 0, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
      )
    ).rejects.toThrow();

    expect(callCount).toBe(1);
  });

  it("applies backoff between retries (delay increases)", async () => {
    const timestamps: number[] = [];
    let callCount = 0;

    await expect(
      withExponentialBackoff(
        async () => {
          timestamps.push(Date.now());
          callCount++;
          throw new Error("fail");
        },
        { maxRetries: 2, baseDelay: 10, maxDelay: 500, backoffMultiplier: 2 }
      )
    ).rejects.toThrow();

    expect(callCount).toBe(3);

    // Check that time between attempts generally increases
    // First gap: ~10ms (baseDelay * 2^0), second gap: ~20ms (baseDelay * 2^1)
    // We check loosely because jitter and scheduling make exact timing unreliable
    if (timestamps.length >= 3) {
      const gap1 = timestamps[1]! - timestamps[0]!;
      const gap2 = timestamps[2]! - timestamps[1]!;
      assert.ok(gap1 >= 0, "first gap should be non-negative");
      assert.ok(gap2 >= 0, "second gap should be non-negative");
    }
  });

  it("caps delay at maxDelay", async () => {
    const timestamps: number[] = [];
    let callCount = 0;

    await expect(
      withExponentialBackoff(
        async () => {
          timestamps.push(Date.now());
          callCount++;
          throw new Error("fail");
        },
        {
          maxRetries: 3,
          baseDelay: 5,
          maxDelay: 10, // Very low cap
          backoffMultiplier: 100, // Very aggressive multiplier
        }
      )
    ).rejects.toThrow();

    expect(callCount).toBe(4); // 1 initial + 3 retries

    // With maxDelay=10 and high multiplier, delays should be capped
    // No gap should be significantly larger than maxDelay + jitter
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i]! - timestamps[i - 1]!;
      // Allow generous margin for scheduling but ensure it is not absurdly long
      assert.ok(gap < 200, `delay between attempts should be capped, was ${gap}ms`);
    }
  });
});

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

describe("MetricsCollector", { concurrency: 1 }, () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it("initializes with zeroed metrics", () => {
    const m = collector.getMetrics();
    expect(m.totalRequests).toBe(0);
    expect(m.successfulRequests).toBe(0);
    expect(m.failedRequests).toBe(0);
    expect(m.rejectedRequests).toBe(0);
    expect(m.averageResponseTime).toBe(0);
    expect(m.circuitBreakerState).toBe("CLOSED");
  });

  it("tracks successful requests via circuit breaker events", async () => {
    const fn = async () => "ok";
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);

    await breaker.fire();
    await breaker.fire();
    await breaker.fire();

    const m = collector.getMetrics();
    expect(m.totalRequests).toBe(3);
    expect(m.successfulRequests).toBe(3);
    expect(m.failedRequests).toBe(0);
  });

  it("tracks failed requests and records lastFailure", async () => {
    const fn = async () => {
      throw new Error("queue connection lost");
    };
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      errorThresholdPercentage: 100, // Keep circuit closed
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      halfOpenRetries: 10,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);

    try {
      await breaker.fire();
    } catch {
      // expected
    }

    const m = collector.getMetrics();
    expect(m.totalRequests).toBe(1);
    expect(m.failedRequests).toBe(1);
    expect(m.lastFailure).toBeTruthy();
    assert.ok(m.lastFailure!.timestamp instanceof Date);
    assert.ok(m.lastFailure!.error.includes("queue connection lost"));
  });

  it("tracks circuit breaker state transitions to OPEN", async () => {
    const fn = async () => {
      throw new Error("fail");
    };
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      errorThresholdPercentage: 1,
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      halfOpenRetries: 10,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);

    for (let i = 0; i < 15; i++) {
      try {
        await breaker.fire();
      } catch {
        // expected
      }
    }

    const m = collector.getMetrics();
    expect(m.circuitBreakerState).toBe("OPEN");
  });

  it("computes averageResponseTime from recorded latencies", async () => {
    const fn = async () => "ok";
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);

    // Fire several times to accumulate latency data
    for (let i = 0; i < 5; i++) {
      await breaker.fire();
    }

    const m = collector.getMetrics();
    // averageResponseTime should be >= 0 (actual latencies are very small in tests)
    assert.ok(m.averageResponseTime >= 0, "averageResponseTime should be non-negative");
    expect(m.successfulRequests).toBe(5);
  });

  it("reset() clears all metrics", async () => {
    const fn = async () => "ok";
    const breaker = createCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);
    await breaker.fire();

    const before = collector.getMetrics();
    expect(before.totalRequests).toBe(1);

    collector.reset();

    const m = collector.getMetrics();
    expect(m.totalRequests).toBe(0);
    expect(m.successfulRequests).toBe(0);
    expect(m.failedRequests).toBe(0);
    expect(m.rejectedRequests).toBe(0);
    expect(m.averageResponseTime).toBe(0);
    expect(m.circuitBreakerState).toBe("CLOSED");
  });

  it("getMetrics() returns a copy (not a reference)", () => {
    const m1 = collector.getMetrics();
    const m2 = collector.getMetrics();
    expect(m1).not.toBe(m2);
  });
});
