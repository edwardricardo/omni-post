/**
 * @file RedisTokenBucketRateLimiter.ts
 * @description Cross-pod token-bucket adapter for `RateLimiterPort`. State for
 *              each key is a Redis hash (`tokens`, `ts`) mutated by a single
 *              Lua `EVAL` so refill-and-consume is atomic across pods — no
 *              read-modify-write race. Buckets refill continuously at
 *              `capacity / refillWindowMs` permits per millisecond, capped at
 *              `capacity`, and expire after one refill window of inactivity.
 *
 *              Fail-open: if Redis is unreachable the limiter allows the call
 *              rather than blocking AI traffic on a limiter outage. The hard
 *              provider quota is independently enforced provider-side via 429 +
 *              `Retry-After`, which the orchestrator honours.
 * @layer infrastructure
 */

import type Redis from "ioredis";
import type { RateLimiterPort, RateLimitDecision } from "@ports/core";
import { logger } from "../../lib/logger.js";

const rlLogger = logger.child({ module: "ai", component: "rate-limiter" });

const KEY_PREFIX = "ai:ratelimit:";

/**
 * Lua: atomic token-bucket refill + consume.
 * KEYS[1] = bucket hash key
 * ARGV[1] = capacity
 * ARGV[2] = refillPerMs
 * ARGV[3] = nowMs
 * ARGV[4] = cost
 * ARGV[5] = ttlMs
 * Returns: { allowed (0|1), retryAfterMs }
 */
const CONSUME_SCRIPT = `
local data = redis.call("HMGET", KEYS[1], "tokens", "ts")
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
local elapsed = now - ts
if elapsed > 0 then
  tokens = math.min(capacity, tokens + elapsed * refillPerMs)
  ts = now
end
local allowed = 0
local retryAfterMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfterMs = math.ceil((cost - tokens) / refillPerMs)
end
redis.call("HMSET", KEYS[1], "tokens", tokens, "ts", ts)
redis.call("PEXPIRE", KEYS[1], ttl)
return { allowed, retryAfterMs }
`;

export interface RedisTokenBucketOptions {
  /** Max permits the bucket holds. Default 60. */
  readonly capacity?: number;
  /** Window over which `capacity` permits fully refill, in ms. Default
   *  60 000 (one minute). */
  readonly refillWindowMs?: number;
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  readonly now?: () => number;
}

const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL_WINDOW_MS = 60_000;

export class RedisTokenBucketRateLimiter implements RateLimiterPort {
  private readonly capacity: number;
  private readonly refillWindowMs: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(
    private readonly redis: Redis,
    options: RedisTokenBucketOptions = {}
  ) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.refillWindowMs = options.refillWindowMs ?? DEFAULT_REFILL_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.refillPerMs = this.capacity / this.refillWindowMs;
  }

  async tryConsume(key: string, cost = 1): Promise<RateLimitDecision> {
    try {
      const raw = (await this.redis.eval(
        CONSUME_SCRIPT,
        1,
        `${KEY_PREFIX}${key}`,
        this.capacity,
        this.refillPerMs,
        this.now(),
        cost,
        this.refillWindowMs
      )) as [number, number];

      const allowed = raw[0] === 1;
      if (allowed) {
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: raw[1] };
    } catch (error) {
      // Fail-open: a limiter outage must not block AI traffic. Provider-side
      // 429 + Retry-After remains the hard backstop.
      rlLogger.warn({ err: error, key }, "Rate limiter unavailable, failing open");
      return { allowed: true };
    }
  }
}
