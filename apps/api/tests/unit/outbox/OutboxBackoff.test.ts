/**
 * @file OutboxBackoff.test.ts
 * @description Tests for `OutboxBackoff` — full-jitter exponential backoff.
 * @layer infrastructure
 */

import { describe, it, afterEach, vi, expect } from "vitest";
import { OutboxBackoff } from "../../../src/infrastructure/outbox/OutboxBackoff.js";

describe("OutboxBackoff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when attempt is 0 and Math.random returns 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 60000 });
    expect(backoff.computeDelayMs(0)).toBe(0);
  });

  it("returns delay strictly below base*2^attempt for small attempts", () => {
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 60000 });
    for (let attempt = 0; attempt < 5; attempt++) {
      const upper = 1000 * Math.pow(2, attempt);
      const delay = backoff.computeDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(upper);
    }
  });

  it("caps the delay at capMs even for very large attempts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 30000 });
    expect(backoff.computeDelayMs(20)).toBeLessThan(30000);
  });

  it("treats negative attempts as 0", () => {
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 60000 });
    const delay = backoff.computeDelayMs(-3);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(1000);
  });

  it("returns 0 when capMs is 0", () => {
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 0 });
    expect(backoff.computeDelayMs(5)).toBe(0);
  });

  it("uses defaults when options are omitted", () => {
    const backoff = new OutboxBackoff();
    const delay = backoff.computeDelayMs(0);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(1000);
  });

  it("computeNextRetryAt returns a Date `delay` ms after `now`", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 60000 });
    const now = new Date("2026-04-30T00:00:00Z");
    const next = backoff.computeNextRetryAt(2, now);
    // attempt=2 -> upper = 4000ms, mock 0.5 -> delay = floor(2000) = 2000
    expect(next.getTime() - now.getTime()).toBe(2000);
  });

  it("Monte Carlo: distribution for attempt=5 spans the [0, cap) range", () => {
    const backoff = new OutboxBackoff({ baseMs: 1000, capMs: 30000 });
    const samples = Array.from({ length: 1000 }, () => backoff.computeDelayMs(5));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const upper = Math.min(30000, 1000 * Math.pow(2, 5));
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(upper);
    // Spread check: at least 100ms range from min to max with 1000 samples
    expect(max - min).toBeGreaterThan(100);
  });
});
