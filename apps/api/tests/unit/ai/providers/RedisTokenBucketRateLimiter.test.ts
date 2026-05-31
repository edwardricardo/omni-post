/**
 * @file RedisTokenBucketRateLimiter.test.ts
 * @description Unit tests for the Redis token-bucket adapter wrapping: it parses
 *              the Lua `[allowed, retryAfterMs]` reply correctly and fails open
 *              when Redis is unreachable. The Lua atomicity itself is exercised
 *              by the integration test against a real Redis.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import type Redis from "ioredis";
import { RedisTokenBucketRateLimiter } from "../../../../src/ai/providers/RedisTokenBucketRateLimiter.js";

function fakeRedis(evalImpl: (...args: unknown[]) => Promise<unknown>): Redis {
  return { eval: vi.fn(evalImpl) } as unknown as Redis;
}

describe("RedisTokenBucketRateLimiter", () => {
  it("allows when the Lua reply is [1, 0]", async () => {
    const limiter = new RedisTokenBucketRateLimiter(fakeRedis(async () => [1, 0]));
    const decision = await limiter.tryConsume("openai");
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterMs).toBeUndefined();
  });

  it("denies with retryAfterMs when the Lua reply is [0, n]", async () => {
    const limiter = new RedisTokenBucketRateLimiter(fakeRedis(async () => [0, 4200]));
    const decision = await limiter.tryConsume("openai");
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(4200);
  });

  it("passes key, capacity, refillPerMs, cost and ttl to the script", async () => {
    const evalSpy = vi.fn(async () => [1, 0]);
    const limiter = new RedisTokenBucketRateLimiter(fakeRedis(evalSpy), {
      capacity: 120,
      refillWindowMs: 60_000,
    });
    await limiter.tryConsume("gemini", 2);

    const callArgs = evalSpy.mock.calls[0];
    // eval(script, numKeys, key, capacity, refillPerMs, now, cost, ttl)
    expect(callArgs[1]).toBe(1);
    expect(callArgs[2]).toBe("ai:ratelimit:gemini");
    expect(callArgs[3]).toBe(120);
    expect(callArgs[4]).toBe(120 / 60_000);
    expect(callArgs[6]).toBe(2);
    expect(callArgs[7]).toBe(60_000);
  });

  it("fails open (allows) when Redis throws", async () => {
    const limiter = new RedisTokenBucketRateLimiter(
      fakeRedis(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    const decision = await limiter.tryConsume("openai");
    expect(decision.allowed).toBe(true);
  });
});
