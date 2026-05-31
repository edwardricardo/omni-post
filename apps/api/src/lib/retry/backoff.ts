/**
 * @file backoff.ts
 * @description Full-jitter exponential backoff utilities. Pure function form
 *              of the formula popularised by Marc Brooker's AWS Architecture
 *              Blog post "Exponential Backoff And Jitter" (2015):
 *              `delay = random(0, min(cap, base * 2^attempt))`. Removing the
 *              correlation across concurrent retries collapses the
 *              thundering-herd amplitude after a transient provider outage.
 * @layer infrastructure
 */

export interface FullJitterOptions {
  /** Base unit in ms. Defaults to 1000. */
  readonly baseMs?: number;
  /** Hard ceiling for the upper bound in ms. Defaults to 5 * 60 * 1000. */
  readonly capMs?: number;
}

const DEFAULT_BASE_MS = 1000;
const DEFAULT_CAP_MS = 5 * 60 * 1000;

/**
 * @function computeFullJitterDelayMs
 * @description Returns a random delay in `[0, min(cap, base * 2^attempt))`.
 *   Stateless; deterministic when `Math.random` is seeded. Treats negative
 *   attempts as 0 and returns 0 when the upper bound collapses to ≤ 0.
 * @param attempt - Zero-based retry count (0 = first retry, 1 = second, ...).
 * @param options - Optional overrides for base / cap.
 * @returns Non-negative integer milliseconds below the upper bound.
 */
export function computeFullJitterDelayMs(attempt: number, options: FullJitterOptions = {}): number {
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const capMs = options.capMs ?? DEFAULT_CAP_MS;
  const safeAttempt = Math.max(0, attempt);
  const exponential = baseMs * Math.pow(2, safeAttempt);
  const upperBound = Math.min(capMs, exponential);
  if (upperBound <= 0) return 0;
  return Math.floor(Math.random() * upperBound);
}
