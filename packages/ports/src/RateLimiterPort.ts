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
  /** Permits left in the bucket after this decision. Floored to an integer;
   *  always ≥ 0. Feeds the `X-RateLimit-Remaining` header for HTTP callers. */
  readonly remaining: number;
  /** Epoch milliseconds at which the bucket returns to full capacity. Feeds
   *  the `X-RateLimit-Reset` header for HTTP callers. */
  readonly resetAtMs: number;
  /** When `allowed` is false, milliseconds until enough permits refill for
   *  the requested cost. Absent when allowed. */
  readonly retryAfterMs?: number;
}

export interface RateLimitOptions {
  /** Permits to consume. Default 1. */
  readonly cost?: number;
  /** Per-call capacity override (e.g. an HTTP per-path rule's max requests).
   *  Falls back to the adapter's constructor default when omitted. */
  readonly capacity?: number;
  /** Per-call refill-window override in ms. Falls back to the adapter's
   *  constructor default when omitted. */
  readonly refillWindowMs?: number;
}

export interface RateLimiterPort {
  /**
   * Attempt to consume permits for `key`. Implementations refill permits over
   * time (token bucket). Returns `{ allowed, remaining, resetAtMs }` and
   * deducts the permits on success, or `{ allowed: false, ..., retryAfterMs }`
   * without deducting on denial.
   *
   * Async because cross-pod adapters (Redis) perform I/O; in-process adapters
   * resolve immediately.
   *
   * @param key - Stable bucket identifier (e.g. provider name, or `ip:path`).
   * @param opts - Optional cost + per-call capacity/window overrides.
   */
  tryConsume(key: string, opts?: RateLimitOptions): Promise<RateLimitDecision>;
}
