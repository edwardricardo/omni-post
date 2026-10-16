/**
 * @file child-exit.ts
 * @description The one wording the reach engine's collectors give a child process that did not
 *              exit 0, so a listing that ended badly reads the same whichever collector ran it.
 *              Each collector keeps its own prefix and its own detail; only how the run ended is
 *              shared, because two copies of that wording drifted apart once already.
 * @layer infrastructure
 */

/** How a finished child process ended: the part of a spawnSync result the wording reads. */
export interface ChildExit {
  /** The exit code, or `null` when the process did not exit on its own. */
  readonly status: number | null;
  /** The signal that stopped the process, or `null`. */
  readonly signal: string | null;
}

/**
 * @description Words how a child process ended. A real spawnSync result names a signal whenever
 *   it reports no exit code and no `error`, and every collector reads the `error` first, so the
 *   last arm is reached only by a recorded run that omits both (the node collector's self-tests
 *   pass such runs), which it keeps from reading as a signal called "null".
 * @param run - The finished process's exit code and signal.
 * @returns `exited N` when it exited, `was stopped by <signal>` when a signal stopped it, and
 *   `produced no exit status` when it reports neither.
 */
export function describeExit(run: ChildExit): string {
  if (run.status !== null) return `exited ${String(run.status)}`;
  if (run.signal !== null) return `was stopped by ${run.signal}`;
  return "produced no exit status";
}
