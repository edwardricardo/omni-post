/**
 * @file determinism.test.ts
 * @description Unit tests for the determinism kit, `@packages/vitest-shared/determinism`: the
 *              condition waiters `until` and `untilValue`, the one-shot gate, the deferred and the
 *              fixed clock. The waiters run under vitest fake timers, so each deadline below is
 *              reached by advancing the fake clock and costs no wall-clock time; one case runs on
 *              real timers, to show the kit does not depend on fake ones.
 * @layer infrastructure
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXED_CLOCK_ISO,
  createDeferred,
  createGate,
  fixedClock,
  until,
  untilValue,
} from "../src/determinism/index.js";

/** Lets every microtask queued so far run: a promise still pending after it is held, not slow. */
async function turn(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** Records whether `promise` has settled, and keeps its rejection from going unhandled. */
function track(promise: Promise<unknown>): { readonly settled: boolean } {
  const state = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    }
  );
  return state;
}

describe("until", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves on the first probe when the predicate already holds", async () => {
    const predicate = vi.fn(() => true);

    await until(predicate, { description: "a predicate that already holds" });

    expect(predicate).toHaveBeenCalledTimes(1);
  });

  it("resolves at the first probe after the predicate turns true", async () => {
    const startedAt = Date.now();
    const predicate = vi.fn(() => Date.now() - startedAt >= 25);
    const waiting = until(predicate, { description: "25 ms to pass", intervalMs: 10 });
    const state = track(waiting);

    await vi.advanceTimersByTimeAsync(29);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(predicate).toHaveBeenCalledTimes(4);
  });

  it("awaits an async predicate", async () => {
    const startedAt = Date.now();
    const predicate = vi.fn(async () => Date.now() - startedAt >= 20);
    const waiting = until(predicate, { description: "20 ms to pass", intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(20);
    await waiting;

    expect(predicate).toHaveBeenCalledTimes(3);
  });

  it("rejects at the deadline with an Error naming the description and the elapsed time", async () => {
    const waiting = until(() => false, {
      description: "a flag that never turns",
      timeoutMs: 100,
      intervalMs: 10,
    });
    const state = track(waiting);

    await vi.advanceTimersByTimeAsync(99);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).rejects.toThrow(
      new Error("timed out after 100 ms waiting for a flag that never turns")
    );
  });

  it("probes one last time at the deadline and never sleeps past it", async () => {
    const predicate = vi.fn(() => false);
    const waiting = until(predicate, {
      description: "an interval that does not divide the timeout",
      timeoutMs: 100,
      intervalMs: 30,
    });
    track(waiting);

    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).rejects.toThrow("timed out after 100 ms");
    // Probes at 0, 30, 60, 90 and 100 ms: the last pause is cut to the 10 ms that remain.
    expect(predicate).toHaveBeenCalledTimes(5);
  });

  it("waits 5000 ms and probes every 10 ms by default", async () => {
    const predicate = vi.fn(() => false);
    const waiting = until(predicate, { description: "the default deadline" });
    const state = track(waiting);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).rejects.toThrow(
      new Error("timed out after 5000 ms waiting for the default deadline")
    );
    expect(predicate).toHaveBeenCalledTimes(501);
  });

  it("rejects with the predicate's own error and probes no further", async () => {
    const failure = new Error("the probe broke");
    let probes = 0;
    const waiting = until(
      () => {
        probes += 1;
        if (probes === 2) throw failure;
        return false;
      },
      { description: "a probe that breaks on its second call", intervalMs: 10 }
    );
    track(waiting);

    await vi.advanceTimersByTimeAsync(10);
    await expect(waiting).rejects.toBe(failure);

    await vi.advanceTimersByTimeAsync(100);
    expect(probes).toBe(2);
  });

  it("probes exactly once under a zero timeout", async () => {
    const predicate = vi.fn(() => false);

    await expect(until(predicate, { description: "a zero timeout", timeoutMs: 0 })).rejects.toThrow(
      new Error("timed out after 0 ms waiting for a zero timeout")
    );
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "refuses a timeoutMs of %s before probing",
    async (timeoutMs) => {
      const predicate = vi.fn(() => true);

      await expect(until(predicate, { description: "a bad timeout", timeoutMs })).rejects.toThrow(
        RangeError
      );
      expect(predicate).not.toHaveBeenCalled();
    }
  );

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses an intervalMs of %s before probing",
    async (intervalMs) => {
      const predicate = vi.fn(() => true);

      await expect(until(predicate, { description: "a bad interval", intervalMs })).rejects.toThrow(
        RangeError
      );
      expect(predicate).not.toHaveBeenCalled();
    }
  );
});

describe("untilValue", () => {
  interface SagaRow {
    readonly id: string;
    readonly status: string;
  }

  const COMPENSATED: SagaRow = { id: "saga-001", status: "COMPENSATED" };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the first answer that is neither null nor undefined", async () => {
    const probe = vi
      .fn<() => Promise<SagaRow | null | undefined>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(COMPENSATED);
    const waiting = untilValue(probe, { description: "the saga row", intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(20);

    await expect(waiting).resolves.toBe(COMPENSATED);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it.each([0, false, ""])("resolves the falsy answer %j, which is a value", async (answer) => {
    await expect(untilValue(() => answer, { description: "a falsy answer" })).resolves.toBe(answer);
  });

  it("rejects at the deadline with an Error naming the description and the elapsed time", async () => {
    const waiting = untilValue(() => null, {
      description: "a row that never appears",
      timeoutMs: 50,
    });
    track(waiting);

    await vi.advanceTimersByTimeAsync(50);

    await expect(waiting).rejects.toThrow(
      new Error("timed out after 50 ms waiting for a row that never appears")
    );
  });
});

describe("the waiters on real timers", () => {
  it("resolves without fake timers installed", async () => {
    let probes = 0;

    await until(
      () => {
        probes += 1;
        return probes === 3;
      },
      { description: "the third probe", intervalMs: 1 }
    );

    expect(probes).toBe(3);
  });
});

describe("createGate", () => {
  const VALUE = "the value the read returns";

  it("passes straight through while unarmed", async () => {
    const gate = createGate();

    await expect(gate.pass(async () => VALUE)).resolves.toBe(VALUE);
    expect(gate.hasReached()).toBe(false);
  });

  it("accepts a synchronous read", async () => {
    const gate = createGate();

    await expect(gate.pass(() => VALUE)).resolves.toBe(VALUE);
  });

  it("holds the next pass once armed, until release", async () => {
    const gate = createGate();
    const read = vi.fn(async () => VALUE);
    gate.arm();

    const held = gate.pass(read);
    const state = track(held);
    await gate.reached();
    await turn();
    expect(read).not.toHaveBeenCalled();
    expect(state.settled).toBe(false);

    gate.release();
    await expect(held).resolves.toBe(VALUE);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reports the held pass through hasReached as soon as it arrives", async () => {
    const gate = createGate();
    gate.arm();
    expect(gate.hasReached()).toBe(false);

    const held = gate.pass(async () => VALUE);
    expect(gate.hasReached()).toBe(true);

    gate.release();
    await held;
  });

  it("resolves reached() when the held pass arrives, whether asked before or after", async () => {
    const gate = createGate();
    gate.arm();
    const askedBefore = gate.reached();
    const state = track(askedBefore);
    await turn();
    expect(state.settled).toBe(false);

    const held = gate.pass(async () => VALUE);
    await askedBefore;
    await gate.reached();

    gate.release();
    await held;
  });

  it("holds exactly one pass", async () => {
    const gate = createGate();
    gate.arm();

    const first = gate.pass(async () => "first");
    const state = track(first);
    await expect(gate.pass(async () => "second")).resolves.toBe("second");
    expect(state.settled).toBe(false);

    gate.release();
    await expect(first).resolves.toBe("first");
  });

  it("treats a second release as harmless", async () => {
    const gate = createGate();
    const read = vi.fn(async () => VALUE);
    gate.arm();
    const held = gate.pass(read);

    gate.release();
    expect(() => gate.release()).not.toThrow();

    await expect(held).resolves.toBe(VALUE);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("lets the pass through when released before it arrives", async () => {
    const gate = createGate();
    gate.arm();
    gate.release();

    await expect(gate.pass(async () => VALUE)).resolves.toBe(VALUE);
    expect(gate.hasReached()).toBe(true);
  });

  it("refuses to be armed again once it has held a pass or been released", async () => {
    const reachedGate = createGate();
    reachedGate.arm();
    const held = reachedGate.pass(async () => VALUE);
    expect(() => reachedGate.arm()).toThrow(Error);
    reachedGate.release();
    await held;

    const releasedGate = createGate();
    releasedGate.release();
    expect(() => releasedGate.arm()).toThrow(Error);
  });

  it("returns the read's rejection", async () => {
    const gate = createGate();
    const failure = new Error("the read failed");

    await expect(
      gate.pass(async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe("createDeferred", () => {
  const VALUE = "the deferred value";

  it("settles the promise with the value it is resolved with", async () => {
    const deferred = createDeferred<string>();
    expect(deferred.settled).toBe(false);

    deferred.resolve(VALUE);

    expect(deferred.settled).toBe(true);
    await expect(deferred.promise).resolves.toBe(VALUE);
  });

  it("settles the promise with the reason it is rejected with", async () => {
    const deferred = createDeferred<string>();
    const failure = new Error("the deferred failed");

    deferred.reject(failure);

    expect(deferred.settled).toBe(true);
    await expect(deferred.promise).rejects.toBe(failure);
  });

  it("keeps the first settlement and ignores later calls", async () => {
    const deferred = createDeferred<string>();

    deferred.resolve(VALUE);
    deferred.reject(new Error("too late"));
    deferred.resolve("also too late");

    await expect(deferred.promise).resolves.toBe(VALUE);
  });

  it("resolves a void deferred with no argument", async () => {
    const deferred = createDeferred<void>();

    deferred.resolve();

    await expect(deferred.promise).resolves.toBeUndefined();
  });
});

describe("the fixed clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names 2026-01-01T00:00:00.000Z", () => {
    expect(FIXED_CLOCK_ISO).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns that instant as a fresh Date on every call", () => {
    const first = fixedClock();
    first.setUTCFullYear(1999);

    const second = fixedClock();

    expect(second).not.toBe(first);
    expect(second.toISOString()).toBe(FIXED_CLOCK_ISO);
  });

  it("fixes Date under vitest fake timers", () => {
    vi.useFakeTimers({ now: fixedClock() });

    expect(Date.now()).toBe(Date.parse(FIXED_CLOCK_ISO));
    expect(new Date().toISOString()).toBe(FIXED_CLOCK_ISO);
  });
});
