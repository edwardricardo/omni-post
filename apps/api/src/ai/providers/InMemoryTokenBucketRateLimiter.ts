/**
 * @file InMemoryTokenBucketRateLimiter.ts
 * @description In-process token-bucket adapter for `RateLimiterPort`. Each key
 *              owns a bucket that refills continuously at
 *              `capacity / refillWindowMs` permits per millisecond, capped at
 *              `capacity`. `tryConsume` lazily refills based on elapsed
 *              wall-clock before deciding — so no background reset task is
 *              needed.
 *
 *              Scope is per-process (one bucket Map per instance). Used in
 *              tests and as a single-process fallback. For cross-pod provider
 *              quota enforcement the composition root injects
 *              `RedisTokenBucketRateLimiter` instead — callers depend only on
 *              `RateLimiterPort`.
 * @layer infrastructure
 */

import type { RateLimiterPort, RateLimitDecision } from "@ports/core";

export interface TokenBucketOptions {
  /** Max permits the bucket holds. Default 60. */
  readonly capacity?: number;
  /** Window over which `capacity` permits fully refill, in ms. Default
   *  60 000 (one minute). */
  readonly refillWindowMs?: number;
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL_WINDOW_MS = 60_000;

export class InMemoryTokenBucketRateLimiter implements RateLimiterPort {
  private readonly capacity: number;
  private readonly refillWindowMs: number;
  private readonly now: () => number;
  private readonly refillPerMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: TokenBucketOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.refillWindowMs = options.refillWindowMs ?? DEFAULT_REFILL_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.refillPerMs = this.capacity / this.refillWindowMs;
  }

  async tryConsume(key: string, cost = 1): Promise<RateLimitDecision> {
    const now = this.now();
    const bucket = this.refill(key, now);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true };
    }

    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillPerMs);
    return { allowed: false, retryAfterMs };
  }

  private refill(key: string, now: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
      return bucket;
    }

    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastRefillMs = now;
    }
    return bucket;
  }
}
