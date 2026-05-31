/**
 * @file RateLimiterPort.ts
 * @description Technology-free port for permit-based rate limiting. Callers
 *              attempt to consume permits for a string key; the adapter
 *              decides whether the call is allowed and, when denied, hints
 *              how long to wait. The default adapter is an in-process token
 *              bucket; a Redis-backed adapter can be swapped in for cross-pod
 *              quota enforcement without touching callers (the whole point of
 *              the port).
 * @layer domain
 */

export interface RateLimitDecision {
  /** Whether the caller may proceed. */
  readonly allowed: boolean;
  /** When `allowed` is false, milliseconds until enough permits refill for
   *  the requested cost. Absent when allowed. */
  readonly retryAfterMs?: number;
}

export interface RateLimiterPort {
  /**
   * Attempt to consume `cost` permits for `key`. Implementations refill
   * permits over time (token bucket / sliding window). Returns
   * `{ allowed: true }` and deducts the permits on success, or
   * `{ allowed: false, retryAfterMs }` without deducting on denial.
   *
   * Async because cross-pod adapters (Redis) perform I/O; in-process
   * adapters resolve synchronously.
   *
   * @param key - Stable bucket identifier (e.g. provider name).
   * @param cost - Permits to consume. Default 1.
   */
  tryConsume(key: string, cost?: number): Promise<RateLimitDecision>;
}
