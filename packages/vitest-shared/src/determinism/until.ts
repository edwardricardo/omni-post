/**
 * @file until.ts
 * @description Condition waiters: a test waits on the observable result, never on time. Each
 *              probes its condition, pauses, and probes again until the condition holds or the
 *              deadline passes, and then rejects with an Error that names what it waited for and
 *              how long; vitest and node:test both fail a test on that rejection.
 *
 *              The last pause is cut short so the final probe runs at the deadline, never past it.
 *              The deadline is read from `Date.now()` and the pause is a global `setTimeout`, the
 *              two things vitest's and node:test's fake timers replace, so under fake timers a
 *              waiter moves only as far as the test advances the clock. A probe that throws ends
 *              the wait with its own error, and a probe that never settles holds the wait: the
 *              deadline is checked between probes, and the framework's test timeout bounds the
 *              rest.
 * @layer infrastructure
 */

/** How a waiter names its wait and bounds it. */
export interface WaitOptions {
  /** What the wait is for, as the failure message will say it: "the saga to reach COMPENSATED". */
  readonly description: string;
  /** How long to keep probing, in milliseconds. Default 5000. */
  readonly timeoutMs?: number;
  /** The pause between two probes, in milliseconds. Default 10. */
  readonly intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 10;

/** The pause between two probes: the one sanctioned sleep of the test code. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @description Waits until `probe` answers with a value, neither `null` nor `undefined`, and
 *   resolves with it.
 * @param probe - Reads the condition; `null` or `undefined` means "not yet".
 * @param options - The description the failure names, the timeout and the interval.
 * @returns The first value the probe answers with. `0`, `false` and `""` are values.
 */
export async function untilValue<T>(
  probe: () => T | null | undefined | Promise<T | null | undefined>,
  options: WaitOptions
): Promise<NonNullable<T>> {
  const { description, timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS } = options;
  // A NaN or infinite deadline is never reached, so the wait would end only at the test timeout,
  // with a message that names nothing; a zero or negative interval would spin.
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      `timeoutMs must be a finite number of at least 0, got ${timeoutMs} (waiting for ${description})`
    );
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(
      `intervalMs must be a finite number above 0, got ${intervalMs} (waiting for ${description})`
    );
  }
  const startedAt = Date.now();
  for (;;) {
    const answer = await probe();
    if (answer !== null && answer !== undefined) return answer;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(`timed out after ${elapsedMs} ms waiting for ${description}`);
    }
    await pause(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}

/**
 * @description Waits until `predicate` holds.
 * @param predicate - Reads the condition, synchronously or not.
 * @param options - The description the failure names, the timeout and the interval.
 * @returns A promise that resolves once the predicate has returned `true`.
 */
export async function until(
  predicate: () => boolean | Promise<boolean>,
  options: WaitOptions
): Promise<void> {
  await untilValue(async () => ((await predicate()) ? true : null), options);
}
