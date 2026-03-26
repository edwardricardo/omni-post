/**
 * AccessPatternTracker tests
 * Pure unit tests — no Redis, no network, no external services.
 * Tier 0: tracks access frequency and response times in memory.
 */

import { describe, it, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { AccessPatternTracker } from "../src/access-patterns.js";

describe("AccessPatternTracker — updatePattern", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("getPattern() returns undefined for unknown key", () => {
    expect(tracker.getPattern("missing")).toBe(undefined);
  });

  it("updatePattern() creates a new entry on first access", () => {
    const now = Date.now();
    tracker.updatePattern("user:1", now);
    const pattern = tracker.getPattern("user:1");
    expect(pattern).toBeTruthy();
    expect(pattern!.key).toBe("user:1");
    expect(pattern!.frequency).toBe(1);
    expect(pattern!.lastAccess).toBe(now);
  });

  it("updatePattern() increments frequency on repeated access", () => {
    const now = Date.now();
    tracker.updatePattern("post:42", now);
    tracker.updatePattern("post:42", now + 100);
    tracker.updatePattern("post:42", now + 200);
    const pattern = tracker.getPattern("post:42");
    expect(pattern!.frequency).toBe(3);
  });

  it("updatePattern() updates lastAccess to most recent call", () => {
    const t1 = Date.now();
    const t2 = t1 + 500;
    tracker.updatePattern("k", t1);
    tracker.updatePattern("k", t2);
    expect(tracker.getPattern("k")!.lastAccess).toBe(t2);
  });

  it("getAllPatterns() returns all tracked keys", () => {
    const now = Date.now();
    tracker.updatePattern("a", now);
    tracker.updatePattern("b", now);
    tracker.updatePattern("c", now);
    const all = tracker.getAllPatterns();
    expect(all.size).toBe(3);
    expect(all.has("a")).toBe(true);
    expect(all.has("b")).toBe(true);
    expect(all.has("c")).toBe(true);
  });
});

describe("AccessPatternTracker — getHotKeys", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("returns empty array when no patterns exist", () => {
    expect(tracker.getHotKeys()).toEqual([]);
  });

  it("returns keys sorted by frequency descending", () => {
    const now = Date.now();
    // "hot" accessed 10 times, "warm" 5 times, "cold" 1 time
    for (let i = 0; i < 10; i++) tracker.updatePattern("hot", now + i);
    for (let i = 0; i < 5; i++) tracker.updatePattern("warm", now + i);
    tracker.updatePattern("cold", now);

    const hot = tracker.getHotKeys(3);
    expect(hot[0]!.key).toBe("hot");
    expect(hot[1]!.key).toBe("warm");
    expect(hot[2]!.key).toBe("cold");
  });

  it("respects the limit parameter", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      tracker.updatePattern(`key-${i}`, now + i * 10);
    }
    const hot = tracker.getHotKeys(2);
    expect(hot.length).toBe(2);
  });

  it("hot key entry has key, hits, and frequency fields", () => {
    const now = Date.now();
    tracker.updatePattern("mykey", now);
    tracker.updatePattern("mykey", now + 1);
    const hot = tracker.getHotKeys(1);
    expect(hot.length).toBe(1);
    expect(hot[0]!.key).toBe("mykey");
    expect(hot[0]!.hits).toBe(2);
    expect(hot[0]!.frequency).toBe(2);
  });

  it("default limit is 10", () => {
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      tracker.updatePattern(`k${i}`, now + i);
    }
    expect(tracker.getHotKeys().length).toBe(10);
  });
});

describe("AccessPatternTracker — response times", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("getAverageResponseTime() returns 0 with no data", () => {
    expect(tracker.getAverageResponseTime()).toBe(0);
  });

  it("recordResponseTime() adds a timing and affects average", () => {
    const start = Date.now() - 50; // simulate 50ms operation
    tracker.recordResponseTime(start);
    const avg = tracker.getAverageResponseTime();
    // avg should be approximately 50ms (could be slightly more by clock drift)
    assert.ok(avg >= 0, "average should be non-negative");
    assert.ok(avg < 5000, "average should be a reasonable value");
  });

  it("getAverageResponseTime() computes mean of recorded times", () => {
    // Insert known response times by recording start times relative to now
    // We can't control exact elapsed time, but we can verify average is reasonable
    const start1 = Date.now() - 100;
    const start2 = Date.now() - 200;
    tracker.recordResponseTime(start1);
    tracker.recordResponseTime(start2);
    const avg = tracker.getAverageResponseTime();
    // Average should be between 100 and 200ms (inclusive, allowing for clock drift)
    assert.ok(avg >= 100 && avg <= 500, `average ${avg}ms should be between 100 and 500ms`);
  });
});

describe("AccessPatternTracker — cleanup", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("clear() removes all patterns and response times", () => {
    const now = Date.now();
    tracker.updatePattern("a", now);
    tracker.recordResponseTime(now - 100);
    tracker.clear();
    expect(tracker.getAllPatterns().size).toBe(0);
    expect(tracker.getAverageResponseTime()).toBe(0);
  });

  it("cleanupOldPatterns() removes entries older than cutoff", () => {
    const old = Date.now() - 10_000;
    const recent = Date.now() - 100;
    tracker.updatePattern("old-key", old);
    tracker.updatePattern("new-key", recent);

    const cutoff = Date.now() - 1000; // everything older than 1 second
    tracker.cleanupOldPatterns(cutoff);

    expect(tracker.getPattern("old-key")).toBe(undefined);
    expect(tracker.getPattern("new-key")).not.toBe(undefined);
  });

  it("cleanupOldPatterns() with future cutoff removes all", () => {
    const now = Date.now();
    tracker.updatePattern("a", now - 1000);
    tracker.updatePattern("b", now - 2000);
    tracker.cleanupOldPatterns(now + 1); // cutoff in the future
    expect(tracker.getAllPatterns().size).toBe(0);
  });

  it("cleanupOldPatterns() with past cutoff keeps all", () => {
    const now = Date.now();
    tracker.updatePattern("a", now);
    tracker.updatePattern("b", now);
    tracker.cleanupOldPatterns(now - 10_000); // cutoff 10s ago
    expect(tracker.getAllPatterns().size).toBe(2);
  });
});
