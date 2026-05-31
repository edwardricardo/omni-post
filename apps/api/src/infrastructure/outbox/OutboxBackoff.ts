/**
 * @file OutboxBackoff.ts
 * @description Class-based wrapper around the shared full-jitter primitive
 *              (`computeFullJitterDelayMs`) tailored to outbox retry
 *              scheduling. Carries (baseMs, capMs) as instance state plus a
 *              `computeNextRetryAt` convenience that returns an absolute
 *              Date for the outbox row's `nextRetryAt` column.
 * @layer infrastructure
 */

import { computeFullJitterDelayMs } from "../../lib/retry/backoff.js";

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
    return computeFullJitterDelayMs(attempt, { baseMs: this.baseMs, capMs: this.capMs });
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
