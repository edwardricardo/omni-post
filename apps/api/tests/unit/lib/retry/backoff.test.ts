/**
 * @file backoff.test.ts
 * @description Tests for `computeFullJitterDelayMs` — the pure full-jitter
 *              exponential backoff primitive shared by the outbox relay and
 *              the AI orchestrator.
 * @layer infrastructure
 */

import { describe, it, afterEach, vi, expect } from "vitest";
import { computeFullJitterDelayMs } from "../../../../src/lib/retry/backoff.js";

describe("computeFullJitterDelayMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when attempt is 0 and Math.random returns 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(computeFullJitterDelayMs(0, { baseMs: 1000, capMs: 60000 })).toBe(0);
  });

  it("returns delay strictly below base*2^attempt for small attempts", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const upper = 1000 * Math.pow(2, attempt);
      const delay = computeFullJitterDelayMs(attempt, { baseMs: 1000, capMs: 60000 });
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(upper);
    }
  });

  it("caps the delay at capMs even for very large attempts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(computeFullJitterDelayMs(20, { baseMs: 1000, capMs: 30000 })).toBeLessThan(30000);
  });

  it("treats negative attempts as 0", () => {
    const delay = computeFullJitterDelayMs(-3, { baseMs: 1000, capMs: 60000 });
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(1000);
  });

  it("returns 0 when capMs is 0", () => {
    expect(computeFullJitterDelayMs(5, { baseMs: 1000, capMs: 0 })).toBe(0);
  });

  it("uses defaults when options are omitted", () => {
    const delay = computeFullJitterDelayMs(0);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(1000);
  });

  it("spread across 1000 samples for attempt=5 spans the [0, cap) range", () => {
    const samples = Array.from({ length: 1000 }, () =>
      computeFullJitterDelayMs(5, { baseMs: 1000, capMs: 30000 })
    );
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const upper = Math.min(30000, 1000 * Math.pow(2, 5));
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(upper);
    expect(max - min).toBeGreaterThan(100);
  });
});
