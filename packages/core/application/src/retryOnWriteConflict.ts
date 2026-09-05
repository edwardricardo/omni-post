/**
 * @file retryOnWriteConflict.ts
 * @description Bounded retry for an operation that a Serializable transaction may abort with a
 *              write conflict. A Serializable hard delete on a tenant that is still receiving
 *              writes aborts rather than destroying a row no tombstone describes — correct, but
 *              without a retry the only convergent path left to the operator is a minutes-long
 *              cascade re-run by hand. This retries that specific, transient class and nothing
 *              else, so a durable interlock still fails fast.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";

import { isRetryableWriteConflict } from "./UseCase.js";

/**
 * Total attempts (the first try plus its retries) for a write-conflict retry.
 * Three because the conflict this closes is a short race with a concurrent
 * writer, not a queue: if two spaced retries still lose, the tenant is writing
 * continuously and more attempts only lengthen the wait before the operator
 * learns they must quiesce it.
 */
export const WRITE_CONFLICT_MAX_ATTEMPTS = 3;

/**
 * Base backoff (ms) before the first retry, doubled per attempt and jittered.
 * Sized in hundreds of milliseconds rather than tens: the competing writer is a
 * live request, and retrying inside its window just re-collides.
 */
export const WRITE_CONFLICT_BASE_DELAY_MS = 250;

/**
 * Injection seams for the retry, so a test can drive the schedule deterministically
 * instead of waiting on real time or a real random number.
 */
export interface WriteConflictRetryOptions {
  /** Total attempts including the first. Defaults to {@link WRITE_CONFLICT_MAX_ATTEMPTS}. */
  attempts?: number;
  /** Base backoff in ms. Defaults to {@link WRITE_CONFLICT_BASE_DELAY_MS}. */
  baseDelayMs?: number;
  /** Delay function. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * @function retryOnWriteConflict
 * @description Runs `operation`, retrying it only when it fails with a serialization/write
 *              conflict (see {@link isRetryableWriteConflict}). Backoff is exponential with full
 *              jitter, so two callers that collide do not re-collide in lockstep. Any other
 *              failure — a foreign-key interlock, a transaction timeout, a programming error —
 *              is returned on the first occurrence, because re-running it would fail the same way
 *              while holding the budget open.
 *
 *              RETURNS a `Result` rather than rethrowing, per the canon that a fallible operation
 *              in this layer answers with a value: the caught failure is carried out as
 *              `err(error)` with its driver code intact, so the caller classifies exactly the
 *              error the database produced.
 *
 *              WHAT THIS DOES NOT SOLVE: a tenant under continuous write load can lose every
 *              attempt. This bounds the flailing, it does not make an erasure converge against a
 *              live tenant; the caller's final error says so, and the operator's remedy is to
 *              quiesce the tenant (which the soft-delete-then-hard-delete interlock is designed
 *              to do) rather than to keep retrying.
 * @param operation - The work to run; typically opening the transaction.
 * @param options - Attempt count, backoff and the sleep/random seams for tests.
 * @returns `ok(value)` on success; `err(error)` carrying the LAST failure when every attempt lost
 *          the conflict, or the first failure when it was never retryable.
 */
export async function retryOnWriteConflict<T>(
  operation: () => Promise<T>,
  options?: WriteConflictRetryOptions
): Promise<Result<T, unknown>> {
  const attempts = options?.attempts ?? WRITE_CONFLICT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? WRITE_CONFLICT_BASE_DELAY_MS;
  const sleep = options?.sleep ?? defaultSleep;
  const random = options?.random ?? Math.random;

  let attempt = 1;
  for (;;) {
    try {
      return ok(await operation());
    } catch (error: unknown) {
      if (attempt >= attempts || !isRetryableWriteConflict(error)) {
        return err(error);
      }
      // Full jitter (AWS "Exponential Backoff and Jitter"): a uniform draw from
      // [0, cap) rather than cap itself, so concurrent losers spread out instead
      // of waking together and colliding again.
      const cap = baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.floor(random() * cap));
      attempt += 1;
    }
  }
}
