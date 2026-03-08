/**
 * Use Case Timeout Wrapper
 *
 * Provides a 30-second safety net around any use case execution.
 * If the underlying promise does not settle within the allotted time,
 * the wrapper rejects with a TimeoutError so route handlers can
 * return 504 Gateway Timeout instead of hanging indefinitely.
 *
 * Design notes:
 * - Uses Promise.race() — no external dependencies.
 * - The timer is unref()'d so it never blocks process exit in tests.
 * - Does NOT cancel the in-flight promise (AbortSignal integration is P1 scope).
 *   The promise continues to run in the background but its result is discarded.
 *
 * @module lib/withTimeout
 */

/**
 * Error thrown when a use case execution exceeds the timeout threshold.
 * Route handlers should catch this and respond with HTTP 504.
 */
export class TimeoutError extends Error {
  /** Discriminator for instanceof-free checks */
  readonly code = "TIMEOUT" as const;

  constructor(label: string, timeoutMs: number) {
    super(`Use case "${label}" timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Race a use case promise against a fixed timeout.
 *
 * @param promise   - The use case execution promise (e.g. useCase.execute(input))
 * @param timeoutMs - Maximum allowed milliseconds (default 30 000)
 * @param label     - Human-readable name used in the timeout error message
 * @returns         Resolves with the use case result, or rejects with TimeoutError
 *
 * @example
 * const result = await withTimeout(
 *   createPostUC.execute(input),
 *   30_000,
 *   "CreatePost"
 * );
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);

    // Unref so the timer never prevents process exit (important for tests)
    timerId.unref();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Always clear the timer whether the promise won or timed out
    clearTimeout(timerId!);
  }
}

/** Default timeout for use case executions (30 seconds) */
export const USE_CASE_TIMEOUT_MS = 30_000;
