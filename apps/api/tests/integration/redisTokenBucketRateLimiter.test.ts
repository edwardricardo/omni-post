/**
 * @file redisTokenBucketRateLimiter.test.ts
 * @description Integration test for the Redis token-bucket adapter against a
 *              real Redis. Proves the Lua script enforces atomic
 *              refill-and-consume and that two adapter instances sharing the
 *              same Redis share bucket state (cross-pod semantics).
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";
import { RedisTokenBucketRateLimiter } from "../../src/ai/providers/RedisTokenBucketRateLimiter.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("RedisTokenBucketRateLimiter (integration)", () => {
  let redis: Redis;

  before(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
  });

  after(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ai:ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  it("allows up to capacity then denies with a retry-after hint", async () => {
    const limiter = new RedisTokenBucketRateLimiter(redis, {
      capacity: 3,
      refillWindowMs: 60_000,
    });

    assert.equal((await limiter.tryConsume("openai")).allowed, true);
    assert.equal((await limiter.tryConsume("openai")).allowed, true);
    assert.equal((await limiter.tryConsume("openai")).allowed, true);

    const denied = await limiter.tryConsume("openai");
    assert.equal(denied.allowed, false);
    assert.ok((denied.retryAfterMs ?? 0) > 0, "denied decision carries a retry-after hint");
  });

  it("shares bucket state across two adapter instances on the same Redis", async () => {
    const a = new RedisTokenBucketRateLimiter(redis, { capacity: 2, refillWindowMs: 60_000 });
    const b = new RedisTokenBucketRateLimiter(redis, { capacity: 2, refillWindowMs: 60_000 });

    assert.equal((await a.tryConsume("gemini")).allowed, true);
    assert.equal((await b.tryConsume("gemini")).allowed, true);
    // Both permits consumed across the two instances → third is denied.
    assert.equal((await a.tryConsume("gemini")).allowed, false);
  });

  it("refills over wall-clock time via an injected clock", async () => {
    let nowMs = 2_000_000;
    const limiter = new RedisTokenBucketRateLimiter(redis, {
      capacity: 2,
      refillWindowMs: 2_000, // 1 permit / 1000ms
      now: () => nowMs,
    });

    assert.equal((await limiter.tryConsume("perplexity")).allowed, true);
    assert.equal((await limiter.tryConsume("perplexity")).allowed, true);
    assert.equal((await limiter.tryConsume("perplexity")).allowed, false);

    nowMs += 2_000; // one full window later
    assert.equal((await limiter.tryConsume("perplexity")).allowed, true);
  });

  it("isolates buckets per key", async () => {
    const limiter = new RedisTokenBucketRateLimiter(redis, { capacity: 1, refillWindowMs: 60_000 });
    assert.equal((await limiter.tryConsume("openai")).allowed, true);
    assert.equal((await limiter.tryConsume("openai")).allowed, false);
    assert.equal((await limiter.tryConsume("anthropic")).allowed, true);
  });
});
