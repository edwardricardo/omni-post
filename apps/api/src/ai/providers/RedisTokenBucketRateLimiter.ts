/**
 * @file RedisTokenBucketRateLimiter.ts
 * @description Cross-pod token-bucket adapter for `RateLimiterPort`. State for
 *              each key is a Redis hash (`tokens`, `ts`) mutated by a single
 *              Lua `EVAL` so refill-and-consume is atomic across pods — no
 *              read-modify-write race. Capacity and refill window can be
 *              overridden per call (HTTP per-path rules) or default from the
 *              constructor (AI provider throttle). Buckets refill continuously
 *              and expire after one refill window of inactivity.
 *
 *              Fail-open: if Redis is unreachable the limiter allows the call
 *              rather than blocking traffic on a limiter outage.
 * @layer infrastructure
 */

import type Redis from "ioredis";
import type { RateLimiterPort, RateLimitDecision, RateLimitOptions } from "@ports/core";
import { logger } from "../../lib/logger.js";

const rlLogger = logger.child({ module: "ai", component: "rate-limiter" });

const DEFAULT_KEY_PREFIX = "ai:ratelimit:";
const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL_WINDOW_MS = 60_000;

/**
 * Lua: atomic token-bucket refill + consume.
 * KEYS[1] = bucket hash key
 * ARGV[1] = capacity, ARGV[2] = refillPerMs, ARGV[3] = nowMs,
 * ARGV[4] = cost, ARGV[5] = ttlMs
 * Returns: { allowed(0|1), retryAfterMs, remaining, msUntilFull } (all integers)
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
local remaining = math.floor(tokens)
local msUntilFull = 0
if tokens < capacity then
  msUntilFull = math.ceil((capacity - tokens) / refillPerMs)
end
return { allowed, retryAfterMs, remaining, msUntilFull }
`;

export interface RedisTokenBucketOptions {
  /** Default max permits when a call omits `capacity`. Default 60. */
  readonly capacity?: number;
  /** Default refill window in ms when a call omits `refillWindowMs`.
   *  Default 60 000. */
  readonly refillWindowMs?: number;
  /** Redis key prefix isolating this limiter's buckets (e.g. `ai:ratelimit:`
   *  vs `http:ratelimit:`). Default `ai:ratelimit:`. */
  readonly keyPrefix?: string;
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  readonly now?: () => number;
}

export class RedisTokenBucketRateLimiter implements RateLimiterPort {
  private readonly defaultCapacity: number;
  private readonly defaultRefillWindowMs: number;
  private readonly keyPrefix: string;
  private readonly now: () => number;

  constructor(
    private readonly redis: Redis,
    options: RedisTokenBucketOptions = {}
  ) {
    this.defaultCapacity = options.capacity ?? DEFAULT_CAPACITY;
    this.defaultRefillWindowMs = options.refillWindowMs ?? DEFAULT_REFILL_WINDOW_MS;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.now = options.now ?? Date.now;
  }

  async tryConsume(key: string, opts: RateLimitOptions = {}): Promise<RateLimitDecision> {
    const cost = opts.cost ?? 1;
    const capacity = opts.capacity ?? this.defaultCapacity;
    const refillWindowMs = opts.refillWindowMs ?? this.defaultRefillWindowMs;
    const refillPerMs = capacity / refillWindowMs;
    const now = this.now();

    try {
      const raw = (await this.redis.eval(
        CONSUME_SCRIPT,
        1,
        `${this.keyPrefix}${key}`,
        capacity,
        refillPerMs,
        now,
        cost,
        refillWindowMs
      )) as [number, number, number, number];

      const allowed = raw[0] === 1;
      const resetAtMs = now + raw[3];
      if (allowed) {
        return { allowed: true, remaining: raw[2], resetAtMs };
      }
      return { allowed: false, remaining: raw[2], resetAtMs, retryAfterMs: raw[1] };
    } catch (error) {
      // Fail-open: a limiter outage must not block traffic.
      rlLogger.warn({ err: error, key }, "Rate limiter unavailable, failing open");
      return { allowed: true, remaining: capacity, resetAtMs: now };
    }
  }
}
