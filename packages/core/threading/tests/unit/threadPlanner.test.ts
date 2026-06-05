/**
 * @file threadPlanner.test.ts
 * @description Unit tests for threadPlanner pure functions — planThread with SINGLE/AUTO
 *   strategies, estimateThreadReach reach tiers, and validateThreadPlan constraints.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { planThread, estimateThreadReach, validateThreadPlan } from "../../src/threadPlanner.js";
import type { CanonicalPost } from "@shared/types";

function makePost(body: string, media?: CanonicalPost["media"]): CanonicalPost {
  return {
    id: "post-id-001",
    projectId: "project-id-001",
    locale: "en",
    body,
    ...(media ? { media } : {}),
  };
}

describe("planThread", () => {
  describe("SINGLE strategy", () => {
    it("returns a single-tweet plan for content that fits in 280 chars", () => {
      const post = makePost("Hello world!");
      const r = planThread(post, "SINGLE");
      assert.ok(r.ok);
      assert.strictEqual(r.value.strategy, "SINGLE");
      assert.strictEqual(r.value.tweets.length, 1);
      assert.ok(!r.value.needsThreading);
    });

    it("truncates content with ellipsis when SINGLE is forced on long content", () => {
      const longBody = "a".repeat(300);
      const r = planThread(makePost(longBody), "SINGLE");
      assert.ok(r.ok);
      assert.strictEqual(r.value.tweets.length, 1);
      assert.ok(r.value.tweets[0]!.estimatedChars <= 280);
    });

    it("carries post media into the single tweet", () => {
      const media: CanonicalPost["media"] = [
        { id: "m1", type: "image", url: "https://cdn.example.com/a.jpg" },
      ];
      const r = planThread(makePost("Hello", media), "SINGLE");
      assert.ok(r.ok);
      assert.strictEqual(r.value.tweets[0]!.media?.length, 1);
    });
  });

  describe("AUTO strategy", () => {
    it("returns a SINGLE plan when content fits within 274 chars (280 - 6 indicator)", () => {
      const post = makePost("Short text.");
      const r = planThread(post, "AUTO");
      assert.ok(r.ok);
      assert.strictEqual(r.value.strategy, "SINGLE");
      assert.ok(!r.value.needsThreading);
    });

    it("returns a thread plan when content requires splitting", () => {
      // 300 chars: too long for one tweet with thread indicator
      const body = "x".repeat(300);
      const r = planThread(makePost(body), "AUTO");
      assert.ok(r.ok);
      assert.strictEqual(r.value.strategy, "AUTO");
      assert.ok(r.value.needsThreading);
      assert.ok(r.value.tweets.length >= 2);
    });

    it("each tweet in an AUTO thread respects the 280-char limit", () => {
      const body = "sentence. ".repeat(40); // ~400 chars
      const r = planThread(makePost(body), "AUTO");
      assert.ok(r.ok);
      for (const tweet of r.value.tweets) {
        assert.ok(
          tweet.estimatedChars <= 280,
          `Tweet #${tweet.sequence} exceeds 280 chars: ${tweet.estimatedChars}`
        );
      }
    });

    it("returns CONTENT_TOO_LONG error when content requires more than 25 tweets", () => {
      const body = "x".repeat(280 * 30); // way too long
      const r = planThread(makePost(body), "AUTO");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "CONTENT_TOO_LONG");
    });
  });

  describe("thread indicators", () => {
    it("thread fragments have a threadIndicator with sequence notation", () => {
      const body = "word ".repeat(80); // long enough to thread
      const r = planThread(makePost(body), "AUTO");
      assert.ok(r.ok);
      if (r.value.tweets.length > 1) {
        const first = r.value.tweets[0]!;
        assert.ok(first.threadIndicator, "Expected threadIndicator on first fragment");
        assert.match(first.threadIndicator!, /1\//);
      }
    });
  });
});

describe("estimateThreadReach", () => {
  it("returns 1.0 for a single tweet", () => {
    assert.strictEqual(estimateThreadReach(1), 1.0);
  });

  it("returns 1.2 for 2 tweets", () => {
    assert.strictEqual(estimateThreadReach(2), 1.2);
  });

  it("returns 1.2 for 3 tweets", () => {
    assert.strictEqual(estimateThreadReach(3), 1.2);
  });

  it("returns 1.4 for 5 tweets (mid-tier boost)", () => {
    assert.strictEqual(estimateThreadReach(5), 1.4);
  });

  it("returns 1.3 for 10 tweets (diminishing returns)", () => {
    assert.strictEqual(estimateThreadReach(10), 1.3);
  });

  it("returns 1.1 for 25 tweets (very long — lowest multiplier)", () => {
    assert.strictEqual(estimateThreadReach(25), 1.1);
  });
});

describe("validateThreadPlan", () => {
  it("returns ok for a plan that satisfies all constraints", () => {
    const plan = {
      strategy: "AUTO" as const,
      tweets: [
        { sequence: 1, text: "First tweet", estimatedChars: 11, media: [] },
        { sequence: 2, text: "Second tweet", estimatedChars: 12, media: [] },
      ],
      totalChars: 23,
      estimatedReach: 2,
      needsThreading: true,
    };
    const r = validateThreadPlan(plan);
    assert.ok(r.ok);
  });

  it("returns CONTENT_TOO_LONG when tweet count exceeds 25", () => {
    const tweets = Array.from({ length: 26 }, (_, i) => ({
      sequence: i + 1,
      text: "t",
      estimatedChars: 1,
      media: [],
    }));
    const r = validateThreadPlan({
      strategy: "AUTO",
      tweets,
      totalChars: 26,
      estimatedReach: 1,
      needsThreading: true,
    });
    assert.ok(!r.ok);
    assert.strictEqual(r.error, "CONTENT_TOO_LONG");
  });

  it("returns THREAD_PLANNING_FAILED when any tweet exceeds 280 chars", () => {
    const plan = {
      strategy: "AUTO" as const,
      tweets: [{ sequence: 1, text: "x", estimatedChars: 300, media: [] }],
      totalChars: 300,
      estimatedReach: 1,
      needsThreading: false,
    };
    const r = validateThreadPlan(plan);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, "THREAD_PLANNING_FAILED");
  });

  it("returns MEDIA_DISTRIBUTION_FAILED when any tweet has more than 4 media items", () => {
    const media = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      type: "image" as const,
      url: `https://cdn.example.com/${i}.jpg`,
    }));
    const plan = {
      strategy: "AUTO" as const,
      tweets: [{ sequence: 1, text: "x", estimatedChars: 1, media }],
      totalChars: 1,
      estimatedReach: 1,
      needsThreading: false,
    };
    const r = validateThreadPlan(plan);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, "MEDIA_DISTRIBUTION_FAILED");
  });
});
