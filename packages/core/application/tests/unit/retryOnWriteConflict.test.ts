/**
 * @file retryOnWriteConflict.test.ts
 * @description Unit tests for the bounded write-conflict retry — proves it retries ONLY the
 *   serialization/write-conflict class, stops at the attempt bound, rethrows the last failure
 *   rather than swallowing it, and spaces attempts with exponential full-jitter backoff.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import {
  WRITE_CONFLICT_BASE_DELAY_MS,
  WRITE_CONFLICT_MAX_ATTEMPTS,
  retryOnWriteConflict,
} from "../../src/retryOnWriteConflict.js";

/** A failure carrying the driver code the caller would really see. */
function withCode(code: string): Error {
  return Object.assign(new Error(`driver failure ${code}`), { code });
}

/** Seams that exercise the schedule without spending its wall clock. */
function seams(random = 1) {
  const slept: number[] = [];
  return {
    slept,
    options: {
      sleep: async (ms: number): Promise<void> => {
        slept.push(ms);
      },
      random: (): number => random,
    },
  };
}

describe("retryOnWriteConflict", () => {
  it("returns the value without sleeping when the operation succeeds first time", async () => {
    const { slept, options } = seams();
    const operation = vi.fn(async () => "done");

    const result = await retryOnWriteConflict(operation, options);

    assert.ok(result.ok);
    assert.strictEqual(result.value, "done");
    expect(operation).toHaveBeenCalledTimes(1);
    assert.deepStrictEqual(slept, []);
  });

  it("retries a P2034 write conflict and returns the later success", async () => {
    const { options } = seams();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(withCode("P2034"))
      .mockRejectedValueOnce(withCode("P2034"))
      .mockResolvedValueOnce("done");

    const result = await retryOnWriteConflict(operation, options);

    assert.ok(result.ok);
    assert.strictEqual(result.value, "done");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("stops at the attempt bound and rethrows the LAST failure", async () => {
    const { options } = seams();
    const last = withCode("P2034");
    const operation = vi.fn(async () => {
      throw last;
    });

    const result = await retryOnWriteConflict(operation, options);

    assert.ok(!result.ok);
    // The LAST failure is carried out verbatim, driver code intact, so the caller
    // classifies the error the database actually produced.
    assert.strictEqual(result.error, last);
    // Bounded, not a loop: the caller learns the tenant is unquiesced instead of
    // the process spinning on a conflict it cannot win.
    expect(operation).toHaveBeenCalledTimes(WRITE_CONFLICT_MAX_ATTEMPTS);
  });

  it("does NOT retry a P2028 transaction timeout", async () => {
    const { options } = seams();
    const timeout = withCode("P2028");
    const operation = vi.fn(async () => {
      throw timeout;
    });

    // Both P2028 and P2034 classify as TRANSIENT_FAILURE, so a retry keyed on that
    // code would re-run a delete that did not fit its budget — spending the whole
    // budget again, holding locks again, and failing the same way.
    const result = await retryOnWriteConflict(operation, options);

    assert.ok(!result.ok);
    assert.strictEqual(result.error, timeout);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a P2003 foreign-key interlock", async () => {
    const { options } = seams();
    const interlock = withCode("P2003");
    const operation = vi.fn(async () => {
      throw interlock;
    });

    const result = await retryOnWriteConflict(operation, options);

    assert.ok(!result.ok);
    assert.strictEqual(result.error, interlock);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry an unclassified error", async () => {
    const { options } = seams();
    const bug = new Error("tombstone integrity check failed");
    const operation = vi.fn(async () => {
      throw bug;
    });

    const result = await retryOnWriteConflict(operation, options);

    assert.ok(!result.ok);
    assert.strictEqual(result.error, bug);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially, capped by the jitter draw", async () => {
    // random() === 1 draws the top of the window, so the recorded delays ARE the
    // exponential caps and the growth is observable rather than inferred.
    const { slept, options } = seams(1);
    const operation = vi.fn(async () => {
      throw withCode("P2034");
    });

    const result = await retryOnWriteConflict(operation, {
      ...options,
      attempts: 4,
      baseDelayMs: 100,
    });

    assert.ok(!result.ok);
    assert.deepStrictEqual(slept, [100, 200, 400]);
  });

  it("applies FULL jitter, so two losers do not re-collide in lockstep", async () => {
    // random() === 0 is the bottom of the same window. A fixed backoff would record
    // the caps regardless of the draw; full jitter records the draw.
    const { slept, options } = seams(0);
    const operation = vi.fn(async () => {
      throw withCode("P2034");
    });

    const result = await retryOnWriteConflict(operation, {
      ...options,
      attempts: 3,
      baseDelayMs: 100,
    });

    assert.ok(!result.ok);
    assert.deepStrictEqual(slept, [0, 0]);
  });

  it("defaults the first backoff window to the shipped policy value", async () => {
    const { slept, options } = seams(1);
    const operation = vi.fn(async () => {
      throw withCode("P2034");
    });

    const result = await retryOnWriteConflict(operation, options);

    assert.ok(!result.ok);
    assert.strictEqual(slept[0], WRITE_CONFLICT_BASE_DELAY_MS);
  });
});
