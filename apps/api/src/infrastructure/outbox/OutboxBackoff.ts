/**
 * @file OutboxBackoff.ts
 * @description Full-jitter exponential backoff for outbox retry scheduling.
 *              Pattern from AWS Architecture Blog "Exponential Backoff and
 *              Jitter" (Marc Brooker, 2015) — `delay = random(0, min(cap,
 *              base * 2^attempt))`. Reduces thundering-herd risk when many
 *              events fail simultaneously and would otherwise retry in
 *              lockstep.
 * @layer infrastructure
 */

export interface OutboxBackoffOptions {
  baseMs?: number;
  capMs?: number;
}

/**
 * Computes the delay (and absolute next-retry timestamp) for a failed
 * outbox event. Stateless and deterministic given a seeded `Math.random` —
 * see tests for the seeded distribution checks.
 */
export class OutboxBackoff {
  private readonly baseMs: number;
  private readonly capMs: number;

  constructor(options: OutboxBackoffOptions = {}) {
    this.baseMs = options.baseMs ?? 1000;
    this.capMs = options.capMs ?? 5 * 60 * 1000;
  }

  /**
   * Returns the delay in milliseconds for the given attempt count.
   *
   * Full jitter formula: `random(0, min(cap, base * 2^attempt))`.
   * Always returns a non-negative integer below the upper bound.
   */
  computeDelayMs(attempt: number): number {
    const safeAttempt = Math.max(0, attempt);
    const exponential = this.baseMs * Math.pow(2, safeAttempt);
    const upperBound = Math.min(this.capMs, exponential);
    if (upperBound <= 0) return 0;
    return Math.floor(Math.random() * upperBound);
  }

  /**
   * Returns an absolute Date `computeDelayMs(attempt)` milliseconds after
   * `now`. Default `now = new Date()` so callers don't have to pass it
   * unless they need a fixed clock for testing.
   */
  computeNextRetryAt(attempt: number, now: Date = new Date()): Date {
    return new Date(now.getTime() + this.computeDelayMs(attempt));
  }
}
