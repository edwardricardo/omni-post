/**
 * @file StreamConnectionTracker.test.ts
 * @description Unit tests for the per-account SSE connection cap (SMELL-32).
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import { StreamConnectionTracker } from "../../../src/services/StreamConnectionTracker.js";

describe("StreamConnectionTracker", () => {
  let tracker: StreamConnectionTracker;

  beforeEach(() => {
    tracker = new StreamConnectionTracker(3);
  });

  it("constructor rejects non-positive maxPerAccount", () => {
    expect(() => new StreamConnectionTracker(0)).toThrow();
    expect(() => new StreamConnectionTracker(-1)).toThrow();
    expect(() => new StreamConnectionTracker(1.5)).toThrow();
  });

  it("tryReserve returns true up to the cap, false beyond", () => {
    expect(tracker.tryReserve("acc-1", "sub-1")).toBe(true);
    expect(tracker.tryReserve("acc-1", "sub-2")).toBe(true);
    expect(tracker.tryReserve("acc-1", "sub-3")).toBe(true);
    expect(tracker.tryReserve("acc-1", "sub-4")).toBe(false);
    expect(tracker.getActiveCount("acc-1")).toBe(3);
  });

  it("release frees a slot so a new reservation succeeds", () => {
    tracker.tryReserve("acc-1", "sub-1");
    tracker.tryReserve("acc-1", "sub-2");
    tracker.tryReserve("acc-1", "sub-3");
    expect(tracker.tryReserve("acc-1", "sub-4")).toBe(false);

    tracker.release("acc-1", "sub-2");
    expect(tracker.tryReserve("acc-1", "sub-4")).toBe(true);
    expect(tracker.getActiveCount("acc-1")).toBe(3);
  });

  it("caps are per-account (two accounts can each reach the cap)", () => {
    for (let i = 0; i < 3; i++) {
      expect(tracker.tryReserve("acc-A", `sub-A-${i}`)).toBe(true);
      expect(tracker.tryReserve("acc-B", `sub-B-${i}`)).toBe(true);
    }
    expect(tracker.tryReserve("acc-A", "sub-A-4")).toBe(false);
    expect(tracker.tryReserve("acc-B", "sub-B-4")).toBe(false);
    expect(tracker.getActiveCount("acc-A")).toBe(3);
    expect(tracker.getActiveCount("acc-B")).toBe(3);
  });

  it("release is idempotent (safe to call repeatedly)", () => {
    tracker.tryReserve("acc-1", "sub-1");
    tracker.release("acc-1", "sub-1");
    tracker.release("acc-1", "sub-1");
    tracker.release("acc-1", "sub-1");
    expect(tracker.getActiveCount("acc-1")).toBe(0);
  });

  it("getActiveCount returns 0 for unknown accounts", () => {
    expect(tracker.getActiveCount("unknown")).toBe(0);
  });

  it("getMaxPerAccount returns the configured cap", () => {
    expect(tracker.getMaxPerAccount()).toBe(3);
    const tracker10 = new StreamConnectionTracker(10);
    expect(tracker10.getMaxPerAccount()).toBe(10);
  });
});
