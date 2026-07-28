/**
 * Database resilience layer tests
 * Tests circuit breaker, retry logic, metrics collector, and default options.
 * Tier 0: no DB, no Redis — uses real opossum instances with simple async functions.
 *
 * @file resilience.test.ts
 * @description Tests for DEFAULT_DATABASE_RESILIENCE_OPTIONS
 * @layer infrastructure
 */

import { describe, it, afterAll, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

import {
  createDatabaseCircuitBreaker,
  withDatabaseRetry,
  isDatabaseErrorRetryable,
  DatabaseMetricsCollector,
  DEFAULT_DATABASE_RESILIENCE_OPTIONS,
  DEFAULT_DATABASE_RETRY_OPTIONS,
} from "../src/resilience.js";

// Track all circuit breakers so we can shut them down in afterAll()
const breakers: Array<{ shutdown: () => void }> = [];

afterAll(() => {
  for (const b of breakers) {
    b.shutdown();
  }
  breakers.length = 0;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// DEFAULT OPTIONS
// ---------------------------------------------------------------------------

describe("DEFAULT_DATABASE_RESILIENCE_OPTIONS", { concurrent: false }, () => {
  it("has expected timeout value", () => {
    assert.strictEqual(DEFAULT_DATABASE_RESILIENCE_OPTIONS.timeout, 8000);
  });

  it("has expected errorThresholdPercentage", () => {
    assert.strictEqual(DEFAULT_DATABASE_RESILIENCE_OPTIONS.errorThresholdPercentage, 50);
  });

  it("has expected resetTimeout", () => {
    assert.strictEqual(DEFAULT_DATABASE_RESILIENCE_OPTIONS.resetTimeout, 60000);
  });

  it("has expected monitoringPeriod", () => {
    assert.strictEqual(DEFAULT_DATABASE_RESILIENCE_OPTIONS.monitoringPeriod, 15000);
  });

  it("has expected halfOpenRetries", () => {
    assert.strictEqual(DEFAULT_DATABASE_RESILIENCE_OPTIONS.halfOpenRetries, 5);
  });

  it("has expected queryTimeout", () => {
    assert.strictEqual(DEFAULT_DATABASE_RESILIENCE_OPTIONS.queryTimeout, 10000);
  });
});

describe("DEFAULT_DATABASE_RETRY_OPTIONS", { concurrent: false }, () => {
  it("has expected maxRetries", () => {
    assert.strictEqual(DEFAULT_DATABASE_RETRY_OPTIONS.maxRetries, 3);
  });

  it("has expected baseDelay", () => {
    assert.strictEqual(DEFAULT_DATABASE_RETRY_OPTIONS.baseDelay, 150);
  });

  it("has expected maxDelay", () => {
    assert.strictEqual(DEFAULT_DATABASE_RETRY_OPTIONS.maxDelay, 8000);
  });

  it("has expected backoffMultiplier", () => {
    assert.strictEqual(DEFAULT_DATABASE_RETRY_OPTIONS.backoffMultiplier, 2.5);
  });

  it("contains all known retryable Prisma error codes", () => {
    const codes = DEFAULT_DATABASE_RETRY_OPTIONS.retryableErrors;
    assert.ok(codes.includes("P1001"), "should include P1001");
    assert.ok(codes.includes("P1002"), "should include P1002");
    assert.ok(codes.includes("P1008"), "should include P1008");
    assert.ok(codes.includes("P1017"), "should include P1017");
    assert.ok(codes.includes("P2024"), "should include P2024");
    assert.ok(codes.includes("ENOTFOUND"), "should include ENOTFOUND");
    assert.ok(codes.includes("ECONNRESET"), "should include ECONNRESET");
    assert.ok(codes.includes("ETIMEDOUT"), "should include ETIMEDOUT");
    assert.ok(codes.includes("ECONNREFUSED"), "should include ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// createDatabaseCircuitBreaker
// ---------------------------------------------------------------------------

describe("createDatabaseCircuitBreaker()", { concurrent: false }, () => {
  it("executes the wrapped function and returns its result", async () => {
    const fn = async (x: number) => x * 2;
    const breaker = createDatabaseCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    const result = await breaker.fire(21);
    assert.strictEqual(result, 42);
  });

  it("passes multiple arguments to the wrapped function", async () => {
    const fn = async (a: string, b: string) => `${a}-${b}`;
    const breaker = createDatabaseCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    const result = await breaker.fire("hello", "world");
    assert.strictEqual(result, "hello-world");
  });

  it("opens after reaching error threshold", async () => {
    let callCount = 0;
    const alwaysFails = async () => {
      callCount++;
      throw new Error("database down");
    };

    const breaker = createDatabaseCircuitBreaker(alwaysFails, {
      timeout: 5000,
      errorThresholdPercentage: 1, // Open after just 1% errors
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      halfOpenRetries: 10, // rollingCountBuckets
    });
    breakers.push(breaker);

    // Fire enough failures to open the breaker
    const attempts = 15;
    for (let i = 0; i < attempts; i++) {
      try {
        await breaker.fire();
      } catch {
        // expected
      }
    }

    assert.ok(breaker.opened, "circuit breaker should be in OPEN state after failures");
    assert.ok(
      callCount < attempts,
      "some calls should have been rejected without invoking the function"
    );
  });

  it("emits open event when circuit opens", async () => {
    let openFired = false;
    const alwaysFails = async () => {
      throw new Error("fail");
    };

    const breaker = createDatabaseCircuitBreaker(alwaysFails, {
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

    assert.ok(openFired, "should have fired the 'open' event");
  });

  it("rejects calls when circuit is open", async () => {
    const alwaysFails = async () => {
      throw new Error("fail");
    };

    const breaker = createDatabaseCircuitBreaker(alwaysFails, {
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

    assert.ok(breaker.opened, "should be open");

    // Next call should be rejected quickly
    await assert.rejects(
      () => breaker.fire(),
      (err: Error) => {
        assert.ok(
          err.message.includes("Breaker is open") || err.message.includes("breaker"),
          `Expected circuit breaker rejection, got: ${err.message}`
        );
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// isDatabaseErrorRetryable
// ---------------------------------------------------------------------------

describe("isDatabaseErrorRetryable()", { concurrent: false }, () => {
  it("returns true for Prisma P1001 error code", () => {
    const err = { code: "P1001", message: "Can't reach database server" };
    assert.ok(isDatabaseErrorRetryable(err));
  });

  it("returns true for ECONNRESET error code", () => {
    const err = { code: "ECONNRESET", message: "Connection reset" };
    assert.ok(isDatabaseErrorRetryable(err));
  });

  it("returns true for ETIMEDOUT error code", () => {
    const err = { code: "ETIMEDOUT", message: "Connection timed out" };
    assert.ok(isDatabaseErrorRetryable(err));
  });

  it("returns true for ECONNREFUSED error code", () => {
    const err = { code: "ECONNREFUSED", message: "Connection refused" };
    assert.ok(isDatabaseErrorRetryable(err));
  });

  it("returns true when retryable code appears in message", () => {
    const err = { message: "Something went wrong: P1001 error detected" };
    assert.ok(isDatabaseErrorRetryable(err));
  });

  it("returns false for non-retryable errors", () => {
    const err = { code: "P2002", message: "Unique constraint violation" };
    assert.ok(!isDatabaseErrorRetryable(err));
  });

  it("returns false for null/undefined", () => {
    assert.ok(!isDatabaseErrorRetryable(null));
    assert.ok(!isDatabaseErrorRetryable(undefined));
  });

  it("returns false for plain strings", () => {
    assert.ok(!isDatabaseErrorRetryable("some error"));
  });

  it("returns true for P2024 (connection pool timeout)", () => {
    const err = { code: "P2024", message: "Timed out fetching from pool" };
    assert.ok(isDatabaseErrorRetryable(err));
  });

  it("returns true for error with code in name field", () => {
    const err = { name: "ENOTFOUND", message: "DNS lookup failed" };
    assert.ok(isDatabaseErrorRetryable(err));
  });
});

// ---------------------------------------------------------------------------
// withDatabaseRetry
// ---------------------------------------------------------------------------

describe("withDatabaseRetry()", { concurrent: false }, () => {
  it("returns result on first success without retrying", async () => {
    let callCount = 0;
    const result = await withDatabaseRetry(
      async () => {
        callCount++;
        return "success";
      },
      { maxRetries: 3, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    );

    assert.strictEqual(result, "success");
    assert.strictEqual(callCount, 1);
  });

  it("retries on retryable errors and eventually succeeds", async () => {
    let callCount = 0;
    const result = await withDatabaseRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          const err = new Error("Connection reset");
          (err as any).code = "ECONNRESET";
          throw err;
        }
        return "recovered";
      },
      { maxRetries: 5, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    );

    assert.strictEqual(result, "recovered");
    assert.strictEqual(callCount, 3, "should have been called 3 times (2 failures + 1 success)");
  });

  it("does NOT retry on non-retryable errors", async () => {
    let callCount = 0;
    await assert.rejects(
      () =>
        withDatabaseRetry(
          async () => {
            callCount++;
            throw new Error("P2002: Unique constraint violation");
          },
          { maxRetries: 5, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
        ),
      (err: Error) => {
        assert.ok(err.message.includes("P2002"));
        return true;
      }
    );

    assert.strictEqual(callCount, 1, "should have called only once for non-retryable error");
  });

  it("throws after exceeding maxRetries", async () => {
    let callCount = 0;
    await assert.rejects(
      () =>
        withDatabaseRetry(
          async () => {
            callCount++;
            const err = new Error("DB unreachable");
            (err as any).code = "P1001";
            throw err;
          },
          { maxRetries: 2, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
        ),
      (err: Error) => {
        assert.ok(err.message.includes("DB unreachable"));
        return true;
      }
    );

    // maxRetries=2 means: 1 initial + 2 retries = 3 total calls
    assert.strictEqual(callCount, 3, "should attempt initial + maxRetries calls");
  });

  it("retries on P1008 (operations timed out)", async () => {
    let callCount = 0;
    const result = await withDatabaseRetry(
      async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("Operations timed out");
          (err as any).code = "P1008";
          throw err;
        }
        return "done";
      },
      { maxRetries: 3, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    );

    assert.strictEqual(result, "done");
    assert.strictEqual(callCount, 2);
  });

  it("retries on P1017 (server closed connection)", async () => {
    let callCount = 0;
    const result = await withDatabaseRetry(
      async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("Server has closed the connection");
          (err as any).code = "P1017";
          throw err;
        }
        return "reconnected";
      },
      { maxRetries: 3, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
    );

    assert.strictEqual(result, "reconnected");
    assert.strictEqual(callCount, 2);
  });

  it("uses custom options when provided", async () => {
    let callCount = 0;
    await assert.rejects(() =>
      withDatabaseRetry(
        async () => {
          callCount++;
          const err = new Error("fail");
          (err as any).code = "ECONNRESET";
          throw err;
        },
        { maxRetries: 1, baseDelay: 1, maxDelay: 5, backoffMultiplier: 1 }
      )
    );

    // maxRetries=1 means: 1 initial + 1 retry = 2 total calls
    assert.strictEqual(callCount, 2);
  });
});

// ---------------------------------------------------------------------------
// DatabaseMetricsCollector
// ---------------------------------------------------------------------------

describe("DatabaseMetricsCollector", { concurrent: false }, () => {
  let collector: DatabaseMetricsCollector;

  beforeEach(() => {
    collector = new DatabaseMetricsCollector();
  });

  it("initializes with zeroed metrics", () => {
    const m = collector.getMetrics();
    assert.strictEqual(m.totalOperations, 0);
    assert.strictEqual(m.successfulOperations, 0);
    assert.strictEqual(m.failedOperations, 0);
    assert.strictEqual(m.rejectedOperations, 0);
    assert.strictEqual(m.averageResponseTime, 0);
    assert.strictEqual(m.circuitBreakerState, "CLOSED");
    assert.strictEqual(m.connectionHealth.isHealthy, true);
    assert.strictEqual(m.connectionHealth.errors, 0);
    assert.strictEqual(m.performanceMetrics.slowQueries, 0);
    assert.strictEqual(m.performanceMetrics.queryTimeouts, 0);
  });

  it("tracks successful operations via circuit breaker events", async () => {
    const fn = async () => "ok";
    const breaker = createDatabaseCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);

    await breaker.fire();
    await breaker.fire();

    const m = collector.getMetrics();
    assert.strictEqual(m.totalOperations, 2);
    assert.strictEqual(m.successfulOperations, 2);
    assert.strictEqual(m.failedOperations, 0);
  });

  it("tracks failed operations via circuit breaker events", async () => {
    const fn = async () => {
      throw new Error("db error");
    };
    const breaker = createDatabaseCircuitBreaker(fn, {
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
    assert.strictEqual(m.totalOperations, 1);
    assert.strictEqual(m.failedOperations, 1);
    assert.ok(m.connectionHealth.errors >= 1, "should track connection errors");
  });

  it("tracks circuit breaker state transitions", async () => {
    const fn = async () => {
      throw new Error("fail");
    };
    const breaker = createDatabaseCircuitBreaker(fn, {
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
    assert.strictEqual(m.circuitBreakerState, "OPEN");
    assert.strictEqual(m.connectionHealth.isHealthy, false);
  });

  it("updateConnectionHealth sets health status", () => {
    collector.updateConnectionHealth(false);
    const m1 = collector.getMetrics();
    assert.strictEqual(m1.connectionHealth.isHealthy, false);
    assert.ok(m1.connectionHealth.errors >= 1);

    collector.updateConnectionHealth(true);
    const m2 = collector.getMetrics();
    assert.strictEqual(m2.connectionHealth.isHealthy, true);
  });

  it("reset() clears all metrics", async () => {
    const fn = async () => "ok";
    const breaker = createDatabaseCircuitBreaker(fn, {
      timeout: 5000,
      resetTimeout: 500,
      monitoringPeriod: 1000,
    });
    breakers.push(breaker);

    collector.setupCircuitBreakerMetrics(breaker);
    await breaker.fire();

    const before = collector.getMetrics();
    assert.strictEqual(before.totalOperations, 1);

    collector.reset();

    const after = collector.getMetrics();
    assert.strictEqual(after.totalOperations, 0);
    assert.strictEqual(after.successfulOperations, 0);
    assert.strictEqual(after.averageResponseTime, 0);
    assert.strictEqual(after.circuitBreakerState, "CLOSED");
  });

  it("getMetrics() returns a copy (not a reference)", () => {
    const m1 = collector.getMetrics();
    const m2 = collector.getMetrics();
    assert.notStrictEqual(m1, m2, "should return different object references");
    assert.notStrictEqual(
      m1.connectionHealth,
      m2.connectionHealth,
      "nested objects should also be copies"
    );
  });
});
