/**
 * @file XAdapter.polls.test.ts
 * @description Unit tests for X/Twitter poll and quote tweet features.
 *   Tests render() poll tag detection and publish() poll/quote passing through
 *   the injected fake apiClientFactory. All tests are Tier 0.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { CanonicalPost } from "@shared/types";
import type { PublishInput } from "@ports/core";
import { makeAdapter, MOCK_CREDENTIALS } from "./XAdapter.test-helpers.js";

// ============================================================================
// Test fixtures
// ============================================================================

function makeCanonicalPost(overrides?: Partial<CanonicalPost>): CanonicalPost {
  return {
    id: "post-001",
    projectId: "project-001",
    locale: "en",
    body: "What is your favorite color?",
    ...overrides,
  };
}

function makePublishInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    channelId: "channel-x-001",
    post: {
      body: "What is your favorite color?",
      text: "What is your favorite color?",
      meta: {},
    },
    dedupeKey: "dedupe-001",
    ...overrides,
  };
}

// ============================================================================
// 1. Poll Tag Parsing in render()
// ============================================================================

describe("XAdapter - Poll Rendering", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects poll tag and includes poll config in rendered meta", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      tags: ["poll:1440:What is your favorite color?|Red|Blue|Green"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.ok(meta.poll, "Poll config should be in meta");

    const poll = meta.poll as { options: string[]; durationMinutes: number };
    assert.deepStrictEqual(poll.options, ["Red", "Blue", "Green"]);
    assert.strictEqual(poll.durationMinutes, 1440);
  });

  it("renders without poll when no poll tag present", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({ tags: ["category:tech"] });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.poll, undefined);
  });

  it("ignores invalid poll tag with less than 2 options", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      tags: ["poll:1440:Question|OnlyOneOption"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.poll, undefined);
  });

  it("ignores poll tag with invalid duration", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      tags: ["poll:abc:Question|A|B"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.poll, undefined);
  });

  it("ignores poll tag with duration out of range", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      tags: ["poll:1:Question|A|B"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.poll, undefined);
  });

  it("accepts poll with 4 options (maximum)", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      tags: ["poll:60:Pick one|A|B|C|D"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    const poll = meta.poll as { options: string[]; durationMinutes: number };
    assert.ok(poll);
    assert.strictEqual(poll.options.length, 4);
    assert.strictEqual(poll.durationMinutes, 60);
  });

  it("rejects poll with more than 4 options", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      tags: ["poll:60:Pick|A|B|C|D|E"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.poll, undefined);
  });
});

// ============================================================================
// 2. Quote Tweet Tag Parsing
// ============================================================================

describe("XAdapter - Quote Tweet Rendering", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects quote tweet tag and includes ID in meta", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost({
      body: "Check out this great tweet!",
      tags: ["quote:1234567890123456789"],
    });

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.quoteTweetId, "1234567890123456789");
  });

  it("renders without quoteTweetId when no quote tag", () => {
    const { adapter } = makeAdapter();
    const canonical = makeCanonicalPost();

    const result = adapter.render(canonical);

    assert.ok(result.ok);
    const meta = result.value.content.meta as Record<string, unknown>;
    assert.strictEqual(meta.quoteTweetId, undefined);
  });
});

// ============================================================================
// 3. Publish with Poll & Quote Tweet
// ============================================================================

describe("XAdapter - Publish with Poll/Quote", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes poll config to postTweet when present in meta", async () => {
    const { adapter, client } = makeAdapter();

    const input = makePublishInput({
      post: {
        body: "Vote now!",
        text: "Vote now!",
        meta: {
          poll: { options: ["Yes", "No"], durationMinutes: 1440 },
        },
      },
    });

    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.ok(result.ok);

    const call = client.postTweet.mock.calls[0];
    assert.ok(call);
    const pollArg = call[3] as { options: string[]; durationMinutes: number };
    assert.ok(pollArg);
    assert.deepStrictEqual(pollArg.options, ["Yes", "No"]);
    assert.strictEqual(pollArg.durationMinutes, 1440);
  });

  it("passes quote tweet ID to postTweet when present in meta", async () => {
    const { adapter, client } = makeAdapter();

    const input = makePublishInput({
      post: {
        body: "Check this out",
        text: "Check this out",
        meta: { quoteTweetId: "9876543210" },
      },
    });

    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.ok(result.ok);

    const call = client.postTweet.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[4], "9876543210");
  });
});
