/**
 * @file InMemoryTokenBucketRateLimiter.test.ts
 * @description Tests for the in-process token-bucket adapter: lazy time-based
 *              refill, denial with retry-after hint, per-key isolation, and
 *              injectable clock.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { InMemoryTokenBucketRateLimiter } from "../../../../src/ai/providers/InMemoryTokenBucketRateLimiter.js";

describe("InMemoryTokenBucketRateLimiter", () => {
  it("allows up to capacity then denies", async () => {
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 3, refillWindowMs: 60_000 });

    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
    expect((await limiter.tryConsume("openai")).allowed).toBe(true);

    const denied = await limiter.tryConsume("openai");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates buckets per key", async () => {
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 1, refillWindowMs: 60_000 });

    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
    expect((await limiter.tryConsume("openai")).allowed).toBe(false);
    // Different key has its own full bucket.
    expect((await limiter.tryConsume("gemini")).allowed).toBe(true);
  });

  it("refills over time using the injected clock", async () => {
    let nowMs = 1_000_000;
    const limiter = new InMemoryTokenBucketRateLimiter({
      capacity: 2,
      refillWindowMs: 2_000, // 1 permit per 1000ms
      now: () => nowMs,
    });

    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
    expect((await limiter.tryConsume("openai")).allowed).toBe(false);

    // Advance one full window → bucket back to capacity.
    nowMs += 2_000;
    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
  });

  it("computes retryAfterMs as time to refill the deficit", async () => {
    let nowMs = 0;
    const limiter = new InMemoryTokenBucketRateLimiter({
      capacity: 1,
      refillWindowMs: 1_000, // 1 permit per 1000ms
      now: () => nowMs,
    });

    expect((await limiter.tryConsume("openai")).allowed).toBe(true);
    const denied = await limiter.tryConsume("openai");
    expect(denied.allowed).toBe(false);
    // Need 1 permit, refill rate 1/1000ms → ~1000ms.
    expect(denied.retryAfterMs).toBe(1000);
  });

  it("supports a cost greater than one", async () => {
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 5, refillWindowMs: 60_000 });
    expect((await limiter.tryConsume("openai", 3)).allowed).toBe(true);
    expect((await limiter.tryConsume("openai", 3)).allowed).toBe(false);
    expect((await limiter.tryConsume("openai", 2)).allowed).toBe(true);
  });
});
