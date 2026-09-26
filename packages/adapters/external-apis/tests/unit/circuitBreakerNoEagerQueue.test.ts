/**
 * @file circuitBreakerNoEagerQueue.test.ts
 * @description Pins the invariant that constructing an `ExternalApiCircuitBreaker` — directly or
 *              through the shared `createExternalApiCircuitBreaker` factory — builds NO
 *              dead-letter queue.
 *
 *              Why it matters: `createDeadLetterQueue()` builds a BullMQ `Queue` and
 *              `QueueEvents`, and BullMQ's `RedisConnection` runs `init()` from its constructor,
 *              which calls `connect()` on a client still in `wait` status. `lazyConnect: true` on
 *              the ioredis client therefore does not hold — a real socket opens. Because every
 *              provider `apiClient` calls the breaker factory at module scope, that socket used to
 *              open on mere IMPORT, so a unit test that imported a worker for one pure helper
 *              opened a Redis connection and flooded the run with connection errors.
 *
 *              The breaker keeps its READ path (`getDeadLetterQueue()`), so a composition root
 *              that creates the queue still gets dead-lettering. The breaker owns no connection.
 *
 *              `@adapters/dead-letter-queue` is mocked so `createDeadLetterQueue` is a recording
 *              spy: calling it at all IS the defect, whether or not a Redis host is reachable from
 *              the machine running the test.
 *
 * Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";

// ── Mock @adapters/dead-letter-queue — createDeadLetterQueue is the spy ───────

const mockCreateDeadLetterQueue = vi.fn(() => ({ addFailedOperation: vi.fn() }));
const mockGetDeadLetterQueue = vi.fn(() => null);

vi.mock("@adapters/dead-letter-queue", () => ({
  DeadLetterQueueManager: class {},
  createDeadLetterQueue: mockCreateDeadLetterQueue,
  getDeadLetterQueue: mockGetDeadLetterQueue,
  resetDeadLetterQueue: vi.fn(),
}));

// ── Mock @adapters/fallback-strategies — proves the breaker still builds it ───

const mockCreateFallbackManager = vi.fn(() => ({
  executeFallback: vi.fn(),
  cacheSuccessfulResponse: vi.fn(),
}));

vi.mock("@adapters/fallback-strategies", () => ({
  FallbackManager: class {},
  createFallbackManager: mockCreateFallbackManager,
  getFallbackManager: vi.fn(() => null),
  resetFallbackManager: vi.fn(),
  CommonFallbackStrategies: {
    ANALYTICS_FALLBACK: { strategy: "CACHED_RESPONSE", cacheTtl: 1_800_000 },
    METADATA_FALLBACK: { strategy: "CACHED_RESPONSE", cacheTtl: 3_600_000 },
    UPLOAD_FALLBACK: { strategy: "DEGRADED_SERVICE" },
  },
}));

// Stable spies: `createLogger` runs once at the source's module scope, so the returned
// object must be the same one across calls for the test to inspect what was logged.
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();

vi.mock("@observability/logger", () => ({
  createLogger: () => ({
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: vi.fn(),
  }),
}));

const { ExternalApiCircuitBreaker } = await import("../../src/circuitBreaker.js");
const { createExternalApiCircuitBreaker } = await import("../../src/index.js");

/** A Redis URL that is syntactically valid and deliberately unreachable. */
const UNREACHABLE_REDIS_URL = "redis://127.0.0.1:1";

/** Fresh Prometheus registry per test so metric names never collide. */
function freshRegistry(): client.Registry {
  return new client.Registry();
}

describe("ExternalApiCircuitBreaker — construction opens no queue", { concurrent: false }, () => {
  let previousRedisUrl: string | undefined;

  beforeEach(() => {
    previousRedisUrl = process.env.REDIS_URL;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  });

  it("does not create a dead-letter queue when a Redis URL is passed explicitly", () => {
    delete process.env.REDIS_URL;

    new ExternalApiCircuitBreaker(freshRegistry(), UNREACHABLE_REDIS_URL);

    assert.strictEqual(
      mockCreateDeadLetterQueue.mock.calls.length,
      0,
      "the breaker must not construct a dead-letter queue; only a composition root may"
    );
  });

  it("does not create a dead-letter queue when REDIS_URL is set in the environment", () => {
    process.env.REDIS_URL = UNREACHABLE_REDIS_URL;

    new ExternalApiCircuitBreaker(freshRegistry());

    assert.strictEqual(
      mockCreateDeadLetterQueue.mock.calls.length,
      0,
      "an ambient REDIS_URL must not make the breaker construct a queue either"
    );
  });

  it("does not create a dead-letter queue through the shared factory", () => {
    process.env.REDIS_URL = UNREACHABLE_REDIS_URL;

    createExternalApiCircuitBreaker(freshRegistry(), UNREACHABLE_REDIS_URL);

    assert.strictEqual(
      mockCreateDeadLetterQueue.mock.calls.length,
      0,
      "the module-scope factory every provider apiClient calls must open nothing"
    );
  });

  it("still builds the fallback manager from the supplied Redis URL", () => {
    delete process.env.REDIS_URL;

    new ExternalApiCircuitBreaker(freshRegistry(), UNREACHABLE_REDIS_URL);

    assert.strictEqual(
      mockCreateFallbackManager.mock.calls.length,
      1,
      "the redisUrl parameter is still load-bearing for the fallback manager"
    );
    assert.deepStrictEqual(
      mockCreateFallbackManager.mock.calls[0],
      [UNREACHABLE_REDIS_URL],
      "the fallback manager must receive the URL the caller supplied"
    );
  });
});

/**
 * Breaker options that reach the dead-letter branch on the first failure: no retries, no
 * fallback, and a threshold high enough that the circuit stays closed.
 */
const DEAD_LETTER_FAST = {
  errorThresholdPercentage: 100,
  monitoringPeriod: 60_000,
  halfOpenRetries: 100,
  resetTimeout: 60_000,
  maxRetries: 0,
  baseDelay: 1,
  maxDelay: 5,
  jitterEnabled: false,
  fallbackEnabled: false,
  deadLetterEnabled: true,
} as const;

describe(
  "ExternalApiCircuitBreaker — dead-letter skip is logged, not silent",
  { concurrent: false },
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("warns once when a failed operation finds no dead-letter queue configured", async () => {
      // `getDeadLetterQueue()` is mocked to null: this is the shape of any process whose
      // composition root creates no queue, which is every worker process today.
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        throw new Error("provider is down");
      };

      await assert.rejects(() =>
        cb.call("skip-svc", "skip-op", operation, [], { ...DEAD_LETTER_FAST })
      );

      const skipWarnings = loggerWarn.mock.calls.filter(
        (call) =>
          call[1] ===
          "dead-letter queue not configured in this process; failed operation not recorded"
      );

      assert.strictEqual(
        skipWarnings.length,
        1,
        "a dropped dead-letter write must be logged exactly once per failed operation"
      );
      assert.deepStrictEqual(
        skipWarnings[0]?.[0],
        { service: "skip-svc", operation: "skip-op" },
        "the warning must name the service and operation whose failure went unrecorded"
      );
    });

    it("does not warn about a missing queue when dead-lettering is disabled", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        throw new Error("provider is down");
      };

      await assert.rejects(() =>
        cb.call("quiet-svc", "quiet-op", operation, [], {
          ...DEAD_LETTER_FAST,
          deadLetterEnabled: false,
        })
      );

      const skipWarnings = loggerWarn.mock.calls.filter(
        (call) =>
          call[1] ===
          "dead-letter queue not configured in this process; failed operation not recorded"
      );

      assert.strictEqual(
        skipWarnings.length,
        0,
        "a caller that never opted into dead-lettering has lost nothing to report"
      );
    });
  }
);
