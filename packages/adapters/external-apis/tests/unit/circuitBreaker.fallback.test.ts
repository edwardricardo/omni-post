/**
 * @file circuitBreaker.fallback.test.ts
 * @description RED tests: verify that DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled === false
 *              (R1-B), that a circuit-breaker call with no fallback opts rejects on failure
 *              without invoking FallbackManager.executeFallback (R1-A), that ANALYTICS_CB_OPTIONS
 *              and METADATA_CB_OPTIONS presets exist (R3-A/R3-C), that opted-in reads reject
 *              when Redis cache is empty (R3-B), and that DLQ still fires with fallback disabled
 *              (R7-A). The global FallbackManager singleton is reset in afterEach of every
 *              describe block (EC-2).
 *
 * Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import {
  ExternalApiCircuitBreaker,
  DEFAULT_EXTERNAL_API_OPTIONS,
} from "../../src/circuitBreaker.js";

// ── Mock @adapters/fallback-strategies so we can spy on executeFallback ────────

const mockExecuteFallback = vi.fn();
const mockCacheSuccessfulResponse = vi.fn().mockResolvedValue(undefined);
const mockFallbackManagerInstance = {
  executeFallback: mockExecuteFallback,
  cacheSuccessfulResponse: mockCacheSuccessfulResponse,
};

vi.mock("@adapters/fallback-strategies", () => ({
  FallbackManager: class {
    executeFallback(...args: unknown[]) {
      return mockExecuteFallback(...args);
    }
    cacheSuccessfulResponse(...args: unknown[]) {
      return mockCacheSuccessfulResponse(...args);
    }
  },
  createFallbackManager: vi.fn(() => mockFallbackManagerInstance),
  getFallbackManager: vi.fn(() => mockFallbackManagerInstance),
  resetFallbackManager: vi.fn(),
  CommonFallbackStrategies: {
    ANALYTICS_FALLBACK: {
      strategy: "CACHED_RESPONSE",
      cacheTtl: 1_800_000,
    },
    METADATA_FALLBACK: {
      strategy: "CACHED_RESPONSE",
      cacheTtl: 3_600_000,
    },
    UPLOAD_FALLBACK: {
      strategy: "DEGRADED_SERVICE",
    },
    SOCIAL_POST_FALLBACK: {
      strategy: "STATIC_RESPONSE",
      staticResponse: {
        data: { id: "queued", status: "pending" },
        queued: true,
        message: "Post queued for retry when service recovers",
      },
    },
  },
}));

// ── Mock @adapters/dead-letter-queue ──────────────────────────────────────────

const mockAddFailedOperation = vi.fn().mockResolvedValue({ ok: true, value: "dlq-job-1" });
const mockDlqInstance = {
  addFailedOperation: mockAddFailedOperation,
};

vi.mock("@adapters/dead-letter-queue", () => ({
  DeadLetterQueueManager: class {},
  createDeadLetterQueue: vi.fn(() => mockDlqInstance),
  getDeadLetterQueue: vi.fn(() => mockDlqInstance),
}));

vi.mock("@adapters/queue-bullmq", () => ({
  QUEUE_NAMES: { FAILED_OPERATIONS_DLQ: "failed-operations-dlq" },
}));

vi.mock("@observability/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** Breaker options that prevent circuit opening during tests */
const NO_FALLBACK_FAST = {
  errorThresholdPercentage: 100,
  monitoringPeriod: 60_000,
  halfOpenRetries: 100,
  resetTimeout: 60_000,
  maxRetries: 0,
  baseDelay: 1,
  maxDelay: 5,
  jitterEnabled: false,
  fallbackEnabled: false,
  deadLetterEnabled: false,
} as const;

/**
 * Same fast settings but WITHOUT `fallbackEnabled`, so the DEFAULT
 * (`DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled`) governs. Used by R1-A so it
 * genuinely exercises the source default (and turns RED if the default is
 * reverted to true), instead of overriding it.
 */
const DEFAULT_FAST = {
  errorThresholdPercentage: 100,
  monitoringPeriod: 60_000,
  halfOpenRetries: 100,
  resetTimeout: 60_000,
  maxRetries: 0,
  baseDelay: 1,
  maxDelay: 5,
  jitterEnabled: false,
  deadLetterEnabled: false,
} as const;

// ── Helper: fresh registry per test to avoid metric conflicts ─────────────────
function freshRegistry(): client.Registry {
  const reg = new client.Registry();
  return reg;
}

// ─────────────────────────────────────────────────────────────────────────────
// R1-B: DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled MUST be false
// ─────────────────────────────────────────────────────────────────────────────

describe("DEFAULT_EXTERNAL_API_OPTIONS — fallback policy (R1-B)", { concurrent: false }, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fallbackEnabled MUST be false (R1-B)", () => {
    // This test is RED while fallbackEnabled is still true in the source.
    assert.strictEqual(
      DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled,
      false,
      "DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled must be false after PR1 green"
    );
  });

  it("fallbackConfig MUST be undefined in the default (R1-B)", () => {
    assert.strictEqual(
      DEFAULT_EXTERNAL_API_OPTIONS.fallbackConfig,
      undefined,
      "DEFAULT_EXTERNAL_API_OPTIONS.fallbackConfig must be undefined (no ANALYTICS_FALLBACK wired by default)"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1-A: Default call with no fallback opts + forced rejection → rejects AND
//       FallbackManager.executeFallback NOT called
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "ExternalApiCircuitBreaker.call() — default options, failing operation (R1-A)",
  { concurrent: false },
  () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it("rejects with original error when no fallback options are supplied (R1-A)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        const e = new Error("provider 5xx");
        (e as Record<string, unknown>).status = 500;
        throw e;
      };

      await assert.rejects(
        () =>
          cb.call("test-svc", "no-fallback-op", operation, [], {
            ...DEFAULT_FAST,
          }),
        (thrown: unknown) => {
          assert.ok(thrown instanceof Error, "must throw an Error");
          return true;
        }
      );
    });

    it("FallbackManager.executeFallback is NOT called when fallbackEnabled is false (R1-A)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        throw new Error("forced rejection");
      };

      await assert.rejects(() =>
        cb.call("test-svc", "spy-op", operation, [], {
          ...DEFAULT_FAST,
        })
      );

      assert.strictEqual(
        mockExecuteFallback.mock.calls.length,
        0,
        "executeFallback must NOT be called by default (fallbackEnabled defaults to false)"
      );
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// R1-C: Explicit { fallbackEnabled: false } also produces a rejection
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "ExternalApiCircuitBreaker.call() — explicit fallbackEnabled: false (R1-C)",
  { concurrent: false },
  () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it("rejects and does not call fallback when options explicitly set fallbackEnabled:false (R1-C)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        throw new Error("explicit false test");
      };

      await assert.rejects(() =>
        cb.call("test-svc", "explicit-false-op", operation, [], {
          ...NO_FALLBACK_FAST,
          fallbackEnabled: false,
        })
      );

      assert.strictEqual(mockExecuteFallback.mock.calls.length, 0);
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// EC-3: Empty options object {} → behaves as R1-A (fail-fast)
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "ExternalApiCircuitBreaker.call() — empty options {} behaves as fail-fast (EC-3)",
  { concurrent: false },
  () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it("empty options object inherits DEFAULT (fail-fast) and rejects (EC-3)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        throw new Error("empty opts test");
      };

      // After GREEN: DEFAULT.fallbackEnabled === false, so this rejects.
      // Pass small delays to keep test fast.
      await assert.rejects(() =>
        cb.call("test-svc", "empty-opts-op", operation, [], {
          maxRetries: 0,
          baseDelay: 1,
          maxDelay: 5,
          jitterEnabled: false,
          deadLetterEnabled: false,
          errorThresholdPercentage: 100,
          monitoringPeriod: 60_000,
          halfOpenRetries: 100,
          resetTimeout: 60_000,
        })
      );

      assert.strictEqual(mockExecuteFallback.mock.calls.length, 0);
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// R3-A: ANALYTICS_CB_OPTIONS preset — exists, fallbackEnabled true
// ─────────────────────────────────────────────────────────────────────────────

describe("ANALYTICS_CB_OPTIONS preset (R3-A / R3-C)", { concurrent: false }, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ANALYTICS_CB_OPTIONS is exported from circuitBreaker.ts (R3-A)", async () => {
    // Dynamic import so this test is RED if the export doesn't exist yet.
    const mod = await import("../../src/circuitBreaker.js");
    const preset = (mod as Record<string, unknown>)["ANALYTICS_CB_OPTIONS"];
    assert.ok(preset !== undefined, "ANALYTICS_CB_OPTIONS must be exported from circuitBreaker.ts");
  });

  it("ANALYTICS_CB_OPTIONS.fallbackEnabled is true (R3-A)", async () => {
    const mod = await import("../../src/circuitBreaker.js");
    const preset = (mod as Record<string, unknown>)["ANALYTICS_CB_OPTIONS"] as Record<
      string,
      unknown
    >;
    assert.strictEqual(
      preset.fallbackEnabled,
      true,
      "ANALYTICS_CB_OPTIONS.fallbackEnabled must be true"
    );
  });

  it("ANALYTICS_CB_OPTIONS.cacheTtl is 1_800_000 (30 min) (R3-A)", async () => {
    const mod = await import("../../src/circuitBreaker.js");
    const preset = (mod as Record<string, unknown>)["ANALYTICS_CB_OPTIONS"] as Record<
      string,
      unknown
    >;
    assert.strictEqual(preset.cacheTtl, 1_800_000, "ANALYTICS_CB_OPTIONS.cacheTtl must be 1800000");
  });

  it("METADATA_CB_OPTIONS is exported from circuitBreaker.ts (R3-C)", async () => {
    const mod = await import("../../src/circuitBreaker.js");
    const preset = (mod as Record<string, unknown>)["METADATA_CB_OPTIONS"];
    assert.ok(preset !== undefined, "METADATA_CB_OPTIONS must be exported from circuitBreaker.ts");
  });

  it("METADATA_CB_OPTIONS.fallbackEnabled is true (R3-C)", async () => {
    const mod = await import("../../src/circuitBreaker.js");
    const preset = (mod as Record<string, unknown>)["METADATA_CB_OPTIONS"] as Record<
      string,
      unknown
    >;
    assert.strictEqual(
      preset.fallbackEnabled,
      true,
      "METADATA_CB_OPTIONS.fallbackEnabled must be true"
    );
  });

  it("METADATA_CB_OPTIONS.cacheTtl is 3_600_000 (1 hr) (R3-C)", async () => {
    const mod = await import("../../src/circuitBreaker.js");
    const preset = (mod as Record<string, unknown>)["METADATA_CB_OPTIONS"] as Record<
      string,
      unknown
    >;
    assert.strictEqual(preset.cacheTtl, 3_600_000, "METADATA_CB_OPTIONS.cacheTtl must be 3600000");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3-B: opted-in read with empty Redis → MUST reject (no invented default)
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "ExternalApiCircuitBreaker.call() — opted-in read rejects when Redis empty (R3-B)",
  { concurrent: false },
  () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it("rejects when fallback is enabled but executeFallback returns err (empty Redis) (R3-B)", async () => {
      // Simulate Redis cache miss: executeFallback returns a failed result
      mockExecuteFallback.mockResolvedValueOnce({
        ok: false,
        error: "FALLBACK_FAILED",
      });

      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        const e = new Error("provider down");
        (e as Record<string, unknown>).status = 500;
        throw e;
      };

      await assert.rejects(
        () =>
          cb.call("analytics-svc", "get-analytics", operation, [], {
            ...NO_FALLBACK_FAST,
            fallbackEnabled: true,
            fallbackConfig: { strategy: "CACHED_RESPONSE" as const, cacheTtl: 1_800_000 },
          }),
        (thrown: unknown) => {
          assert.ok(thrown instanceof Error, "must throw an Error");
          return true;
        }
      );

      assert.strictEqual(
        mockExecuteFallback.mock.calls.length,
        1,
        "executeFallback must be called exactly once for opted-in read"
      );
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// R7-A: { fallbackEnabled: false, deadLetterEnabled: true } → rejects AND DLQ fires
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "ExternalApiCircuitBreaker.call() — DLQ still fires with fallback disabled (R7-A)",
  { concurrent: false },
  () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it("rejects AND DLQ addFailedOperation is called when deadLetterEnabled:true (R7-A)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry(), "redis://localhost:6379");
      const operation = async (): Promise<unknown> => {
        const e = new Error("dlq test error");
        (e as Record<string, unknown>).status = 500;
        throw e;
      };

      await assert.rejects(() =>
        cb.call("dlq-svc", "dlq-op", operation, [], {
          ...NO_FALLBACK_FAST,
          fallbackEnabled: false,
          deadLetterEnabled: true,
          deadLetterPriority: "normal",
        })
      );

      // DLQ should have been called
      assert.strictEqual(
        mockAddFailedOperation.mock.calls.length,
        1,
        "addFailedOperation must be called once when deadLetterEnabled:true"
      );
      assert.strictEqual(
        mockExecuteFallback.mock.calls.length,
        0,
        "executeFallback must NOT be called when fallbackEnabled:false"
      );
    });

    it("DLQ and fallback are independent — both false → rejects, neither fires (R7-B)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        throw new Error("both disabled");
      };

      await assert.rejects(() =>
        cb.call("independent-svc", "both-off", operation, [], {
          ...NO_FALLBACK_FAST,
          fallbackEnabled: false,
          deadLetterEnabled: false,
        })
      );

      assert.strictEqual(mockExecuteFallback.mock.calls.length, 0);
      assert.strictEqual(mockAddFailedOperation.mock.calls.length, 0);
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// C-1: the cacheKeyDiscriminant threads into the L2 fallback store (write + read)
// so the fallback path is tenant-scoped, closing the second cross-tenant vector.
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "ExternalApiCircuitBreaker.call() — discriminant threads into the L2 fallback store (C-1)",
  { concurrent: false },
  () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it("passes cacheKeyDiscriminant as the 5th arg of cacheSuccessfulResponse on success (write path)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => ({ ok: true });

      await cb.call("x-api", "get-analytics", operation, [], {
        ...NO_FALLBACK_FAST,
        fallbackEnabled: true,
        fallbackConfig: { strategy: "CACHED_RESPONSE" as const, cacheTtl: 1_800_000 },
        cacheKeyDiscriminant: "disc-A",
      });

      assert.strictEqual(
        mockCacheSuccessfulResponse.mock.calls.length,
        1,
        "cacheSuccessfulResponse must be called once on a successful fallback-enabled read"
      );
      const args = mockCacheSuccessfulResponse.mock.calls[0] as unknown[];
      assert.strictEqual(
        args[4],
        "disc-A",
        "the tenant discriminant must be threaded as the 5th argument"
      );
    });

    it("carries the discriminant on the executeFallback context on failure (read path)", async () => {
      mockExecuteFallback.mockResolvedValueOnce({ ok: false, error: "FALLBACK_FAILED" });
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => {
        const e = new Error("provider down");
        (e as Record<string, unknown>).status = 500;
        throw e;
      };

      await assert.rejects(() =>
        cb.call("x-api", "get-analytics", operation, [], {
          ...NO_FALLBACK_FAST,
          fallbackEnabled: true,
          fallbackConfig: { strategy: "CACHED_RESPONSE" as const, cacheTtl: 1_800_000 },
          cacheKeyDiscriminant: "disc-B",
        })
      );

      assert.strictEqual(
        mockExecuteFallback.mock.calls.length,
        1,
        "executeFallback must be called once for the opted-in read"
      );
      const context = mockExecuteFallback.mock.calls[0][1] as { discriminant?: string };
      assert.strictEqual(
        context.discriminant,
        "disc-B",
        "the discriminant must be carried on the fallback context"
      );
    });

    it("passes NO discriminant when none is supplied (fail-safe, un-migrated site)", async () => {
      const cb = new ExternalApiCircuitBreaker(freshRegistry());
      const operation = async (): Promise<unknown> => ({ ok: true });

      await cb.call("x-api", "get-analytics", operation, [], {
        ...NO_FALLBACK_FAST,
        fallbackEnabled: true,
        fallbackConfig: { strategy: "CACHED_RESPONSE" as const, cacheTtl: 1_800_000 },
      });

      assert.strictEqual(mockCacheSuccessfulResponse.mock.calls.length, 1);
      const args = mockCacheSuccessfulResponse.mock.calls[0] as unknown[];
      assert.strictEqual(
        args[4],
        undefined,
        "no discriminant supplied => 5th arg is undefined; FallbackManager then stores nothing shared"
      );
    });
  }
);
