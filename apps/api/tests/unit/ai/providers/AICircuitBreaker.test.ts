/**
 * @file AICircuitBreaker.test.ts
 * @description Tests for the per-provider AI circuit breaker. Drives the
 *              three-state machine (closed → open → half-open) with
 *              `recordSuccess` / `recordFailure` and verifies that
 *              `canExecute` short-circuits OPEN providers and admits
 *              probes once the cooldown elapses.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { AICircuitBreaker } from "../../../../src/ai/providers/AICircuitBreaker.js";

function makeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("AICircuitBreaker", () => {
  it("starts CLOSED and admits calls", () => {
    const cb = new AICircuitBreaker();
    expect(cb.getState("openai")).toBe("CLOSED");
    expect(cb.canExecute("openai")).toBe(true);
  });

  it("opens after `failureThreshold` consecutive failures", () => {
    const cb = new AICircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.getState("openai")).toBe("CLOSED");
    cb.recordFailure("openai");
    expect(cb.getState("openai")).toBe("OPEN");
    expect(cb.canExecute("openai")).toBe(false);
  });

  it("recordSuccess resets failure count under threshold", () => {
    const cb = new AICircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordSuccess("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.getState("openai")).toBe("CLOSED");
  });

  it("transitions OPEN → HALF_OPEN after cooldown elapses", () => {
    const clock = makeClock(1000);
    const cb = new AICircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: clock.now,
    });
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.getState("openai")).toBe("OPEN");
    expect(cb.canExecute("openai")).toBe(false);

    clock.advance(29_999);
    expect(cb.canExecute("openai")).toBe(false);

    clock.advance(1);
    expect(cb.canExecute("openai")).toBe(true);
    expect(cb.getState("openai")).toBe("HALF_OPEN");
  });

  it("HALF_OPEN → CLOSED on success", () => {
    const clock = makeClock(0);
    const cb = new AICircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: clock.now });
    cb.recordFailure("openai");
    clock.advance(100);
    cb.canExecute("openai"); // transitions to HALF_OPEN
    cb.recordSuccess("openai");
    expect(cb.getState("openai")).toBe("CLOSED");
  });

  it("HALF_OPEN → OPEN immediately on failure (probe fails)", () => {
    const clock = makeClock(0);
    const cb = new AICircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: clock.now });
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    clock.advance(100);
    cb.canExecute("openai"); // → HALF_OPEN
    cb.recordFailure("openai");
    expect(cb.getState("openai")).toBe("OPEN");
    expect(cb.canExecute("openai")).toBe(false);
  });

  it("tracks each provider independently", () => {
    const cb = new AICircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.getState("openai")).toBe("OPEN");
    expect(cb.getState("anthropic")).toBe("CLOSED");
    expect(cb.canExecute("anthropic")).toBe(true);
  });
});
