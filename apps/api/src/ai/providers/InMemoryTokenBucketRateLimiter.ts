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

import type { RateLimiterPort, RateLimitDecision, RateLimitOptions } from "@ports/core";

export interface TokenBucketOptions {
  /** Default max permits a bucket holds when a call omits `capacity`. Default 60. */
  readonly capacity?: number;
  /** Default window over which `capacity` permits fully refill, in ms, when a
   *  call omits `refillWindowMs`. Default 60 000 (one minute). */
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
  private readonly defaultCapacity: number;
  private readonly defaultRefillWindowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: TokenBucketOptions = {}) {
    this.defaultCapacity = options.capacity ?? DEFAULT_CAPACITY;
    this.defaultRefillWindowMs = options.refillWindowMs ?? DEFAULT_REFILL_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  async tryConsume(key: string, opts: RateLimitOptions = {}): Promise<RateLimitDecision> {
    const cost = opts.cost ?? 1;
    const capacity = opts.capacity ?? this.defaultCapacity;
    const refillWindowMs = opts.refillWindowMs ?? this.defaultRefillWindowMs;
    const refillPerMs = capacity / refillWindowMs;

    const now = this.now();
    const bucket = this.refill(key, now, capacity, refillPerMs);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAtMs: this.resetAtMs(now, bucket.tokens, capacity, refillPerMs),
      };
    }

    const retryAfterMs = Math.ceil((cost - bucket.tokens) / refillPerMs);
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      resetAtMs: this.resetAtMs(now, bucket.tokens, capacity, refillPerMs),
      retryAfterMs,
    };
  }

  private resetAtMs(now: number, tokens: number, capacity: number, refillPerMs: number): number {
    if (tokens >= capacity || refillPerMs <= 0) return now;
    return now + Math.ceil((capacity - tokens) / refillPerMs);
  }

  private refill(key: string, now: number, capacity: number, refillPerMs: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
      return bucket;
    }

    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
      bucket.lastRefillMs = now;
    }
    return bucket;
  }
}
