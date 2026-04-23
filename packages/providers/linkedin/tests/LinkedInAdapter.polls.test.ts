/**
 * @file LinkedInAdapter.polls.test.ts
 * @description Unit tests for LinkedIn poll support in render() and publish().
 *              Verifies poll tag parsing, validation rules, and publish payload
 *              construction for poll content.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { LinkedInAdapter } from "../src/LinkedInAdapter.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Test helpers
// ============================================================================

function makeCanonicalPost(overrides?: Partial<CanonicalPost>): CanonicalPost {
  return {
    id: "post-poll-001",
    projectId: "project-001",
    locale: "en",
    body: "What do you think?",
    ...overrides,
  };
}

function makePublishInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    channelId: "channel-linkedin-poll-001",
    post: {
      body: "What do you think?",
      text: "What do you think?",
    },
    dedupeKey: "dedupe-poll-001",
    ...overrides,
  };
}

// ============================================================================
// Poll Render Tests
// ============================================================================

describe("LinkedInAdapter - Poll Render", { concurrency: 1 }, () => {
  let adapter: LinkedInAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LinkedInAdapter();
  });

  it("detects poll tag and includes poll data in rendered meta", () => {
    const post = makeCanonicalPost({
      tags: ["poll:THREE_DAYS:Best framework?|React|Vue|Angular"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      const poll = content.meta?.poll as {
        question: string;
        options: string[];
        duration: string;
      };
      assert.ok(poll, "Poll data should be present in meta");
      assert.strictEqual(poll.question, "Best framework?");
      assert.deepStrictEqual(poll.options, ["React", "Vue", "Angular"]);
      assert.strictEqual(poll.duration, "THREE_DAYS");
    }
  });

  it("accepts ONE_DAY duration", () => {
    const post = makeCanonicalPost({
      tags: ["poll:ONE_DAY:Quick poll?|Yes|No"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const poll = (result.value.content as RenderedPost).meta?.poll as Record<string, unknown>;
      assert.strictEqual(poll.duration, "ONE_DAY");
    }
  });

  it("accepts SEVEN_DAYS duration", () => {
    const post = makeCanonicalPost({
      tags: ["poll:SEVEN_DAYS:Week poll?|Option A|Option B"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const poll = (result.value.content as RenderedPost).meta?.poll as Record<string, unknown>;
      assert.strictEqual(poll.duration, "SEVEN_DAYS");
    }
  });

  it("accepts FOURTEEN_DAYS duration", () => {
    const post = makeCanonicalPost({
      tags: ["poll:FOURTEEN_DAYS:Long poll?|A|B|C|D"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const poll = (result.value.content as RenderedPost).meta?.poll as {
        options: string[];
      };
      assert.strictEqual(poll.options.length, 4);
    }
  });

  it("ignores poll tag with invalid duration", () => {
    const post = makeCanonicalPost({
      tags: ["poll:TWO_DAYS:Invalid?|Yes|No"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
    }
  });

  it("ignores poll tag with fewer than 2 options", () => {
    const post = makeCanonicalPost({
      tags: ["poll:THREE_DAYS:One option only?|Solo"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
    }
  });

  it("ignores poll tag with more than 4 options", () => {
    const post = makeCanonicalPost({
      tags: ["poll:THREE_DAYS:Too many?|A|B|C|D|E"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
    }
  });

  it("ignores poll tag when question exceeds 140 characters", () => {
    const longQuestion = "Q".repeat(141);
    const post = makeCanonicalPost({
      tags: [`poll:THREE_DAYS:${longQuestion}|Yes|No`],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
    }
  });

  it("ignores poll tag when an option exceeds 30 characters", () => {
    const longOption = "O".repeat(31);
    const post = makeCanonicalPost({
      tags: [`poll:THREE_DAYS:Valid question?|${longOption}|Short`],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
    }
  });

  it("ignores poll tag with missing colon separator", () => {
    const post = makeCanonicalPost({
      tags: ["poll:THREE_DAYSno-colon|Yes|No"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
    }
  });

  it("renders normally when no poll tag is present", () => {
    const post = makeCanonicalPost({
      tags: ["marketing", "announcement"],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.poll, undefined);
      assert.strictEqual(content.body, "What do you think?");
    }
  });
});

// ============================================================================
// Poll Publish Tests
// ============================================================================

describe("LinkedInAdapter - Poll Publish", { concurrency: 1 }, () => {
  let adapter: LinkedInAdapter;
  let mockCreatePost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LinkedInAdapter();

    mockCreatePost = vi.fn(async () => ({
      id: "urn:li:share:poll-12345",
      activity: "urn:li:activity:poll-12345",
    }));

    (adapter as Record<string, unknown>).createApiClient = () => ({
      createPost: mockCreatePost,
    });

    (adapter as Record<string, unknown>).getCredentials = vi.fn(async () => ({
      ok: true,
      value: {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        personUrn: "urn:li:person:abc123",
      },
    }));
  });

  it("creates post with poll content when poll meta is present", async () => {
    const input = makePublishInput({
      post: {
        body: "Cast your vote!",
        text: "Cast your vote!",
        meta: {
          platform: "linkedin",
          poll: {
            question: "Best language?",
            options: ["TypeScript", "Rust", "Go"],
            duration: "SEVEN_DAYS",
          },
        },
      },
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(mockCreatePost.mock.calls.length, 1);

    const payload = mockCreatePost.mock.calls[0]?.[0] as Record<string, unknown>;
    const content = payload.content as {
      poll: {
        question: string;
        options: Array<{ text: string }>;
        settings: { duration: string };
      };
    };

    assert.strictEqual(content.poll.question, "Best language?");
    assert.deepStrictEqual(content.poll.options, [
      { text: "TypeScript" },
      { text: "Rust" },
      { text: "Go" },
    ]);
    assert.strictEqual(content.poll.settings.duration, "SEVEN_DAYS");
  });

  it("does not attach media content when poll is present", async () => {
    const input = makePublishInput({
      post: {
        body: "Poll with media ignored",
        text: "Poll with media ignored",
        media: [{ url: "https://cdn.example.com/image.jpg", type: "image" as const }],
        meta: {
          platform: "linkedin",
          poll: {
            question: "Favorite color?",
            options: ["Red", "Blue"],
            duration: "ONE_DAY",
          },
        },
      },
    });

    await adapter.publish(input);

    const payload = mockCreatePost.mock.calls[0]?.[0] as Record<string, unknown>;
    const content = payload.content as Record<string, unknown>;
    assert.ok(content.poll, "Poll content should be set");
    assert.strictEqual(content.media, undefined, "Media should not be set when poll is present");
  });
});
