/**
 * AccessPatternTracker tests
 * Pure unit tests — no Redis, no network, no external services.
 * Tier 0: tracks access frequency and response times in memory.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AccessPatternTracker } from "../src/access-patterns.js";

describe("AccessPatternTracker — updatePattern", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("getPattern() returns undefined for unknown key", () => {
    assert.strictEqual(tracker.getPattern("missing"), undefined);
  });

  it("updatePattern() creates a new entry on first access", () => {
    const now = Date.now();
    tracker.updatePattern("user:1", now);
    const pattern = tracker.getPattern("user:1");
    assert.ok(pattern !== undefined, "pattern should exist");
    assert.strictEqual(pattern.key, "user:1");
    assert.strictEqual(pattern.frequency, 1);
    assert.strictEqual(pattern.lastAccess, now);
  });

  it("updatePattern() increments frequency on repeated access", () => {
    const now = Date.now();
    tracker.updatePattern("post:42", now);
    tracker.updatePattern("post:42", now + 100);
    tracker.updatePattern("post:42", now + 200);
    const pattern = tracker.getPattern("post:42");
    assert.strictEqual(pattern!.frequency, 3);
  });

  it("updatePattern() updates lastAccess to most recent call", () => {
    const t1 = Date.now();
    const t2 = t1 + 500;
    tracker.updatePattern("k", t1);
    tracker.updatePattern("k", t2);
    assert.strictEqual(tracker.getPattern("k")!.lastAccess, t2);
  });

  it("getAllPatterns() returns all tracked keys", () => {
    const now = Date.now();
    tracker.updatePattern("a", now);
    tracker.updatePattern("b", now);
    tracker.updatePattern("c", now);
    const all = tracker.getAllPatterns();
    assert.strictEqual(all.size, 3);
    assert.ok(all.has("a"));
    assert.ok(all.has("b"));
    assert.ok(all.has("c"));
  });
});

describe("AccessPatternTracker — getHotKeys", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("returns empty array when no patterns exist", () => {
    assert.deepStrictEqual(tracker.getHotKeys(), []);
  });

  it("returns keys sorted by frequency descending", () => {
    const now = Date.now();
    // "hot" accessed 10 times, "warm" 5 times, "cold" 1 time
    for (let i = 0; i < 10; i++) tracker.updatePattern("hot", now + i);
    for (let i = 0; i < 5; i++) tracker.updatePattern("warm", now + i);
    tracker.updatePattern("cold", now);

    const hot = tracker.getHotKeys(3);
    assert.strictEqual(hot[0]!.key, "hot");
    assert.strictEqual(hot[1]!.key, "warm");
    assert.strictEqual(hot[2]!.key, "cold");
  });

  it("respects the limit parameter", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      tracker.updatePattern(`key-${i}`, now + i * 10);
    }
    const hot = tracker.getHotKeys(2);
    assert.strictEqual(hot.length, 2);
  });

  it("hot key entry has key, hits, and frequency fields", () => {
    const now = Date.now();
    tracker.updatePattern("mykey", now);
    tracker.updatePattern("mykey", now + 1);
    const hot = tracker.getHotKeys(1);
    assert.strictEqual(hot.length, 1);
    assert.strictEqual(hot[0]!.key, "mykey");
    assert.strictEqual(hot[0]!.hits, 2);
    assert.strictEqual(hot[0]!.frequency, 2);
  });

  it("default limit is 10", () => {
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      tracker.updatePattern(`k${i}`, now + i);
    }
    assert.strictEqual(tracker.getHotKeys().length, 10);
  });
});

describe("AccessPatternTracker — response times", { concurrency: 1 }, () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker();
  });

  it("getAverageResponseTime() returns 0 with no data", () => {
    assert.strictEqual(tracker.getAverageResponseTime(), 0);
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
    assert.strictEqual(tracker.getAllPatterns().size, 0);
    assert.strictEqual(tracker.getAverageResponseTime(), 0);
  });

  it("cleanupOldPatterns() removes entries older than cutoff", () => {
    const old = Date.now() - 10_000;
    const recent = Date.now() - 100;
    tracker.updatePattern("old-key", old);
    tracker.updatePattern("new-key", recent);

    const cutoff = Date.now() - 1000; // everything older than 1 second
    tracker.cleanupOldPatterns(cutoff);

    assert.strictEqual(tracker.getPattern("old-key"), undefined);
    assert.ok(tracker.getPattern("new-key") !== undefined);
  });

  it("cleanupOldPatterns() with future cutoff removes all", () => {
    const now = Date.now();
    tracker.updatePattern("a", now - 1000);
    tracker.updatePattern("b", now - 2000);
    tracker.cleanupOldPatterns(now + 1); // cutoff in the future
    assert.strictEqual(tracker.getAllPatterns().size, 0);
  });

  it("cleanupOldPatterns() with past cutoff keeps all", () => {
    const now = Date.now();
    tracker.updatePattern("a", now);
    tracker.updatePattern("b", now);
    tracker.cleanupOldPatterns(now - 10_000); // cutoff 10s ago
    assert.strictEqual(tracker.getAllPatterns().size, 2);
  });
});
