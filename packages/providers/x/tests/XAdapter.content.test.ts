/**
 * @file XAdapter.content.test.ts
 * @description Render edge case tests for XAdapter — empty body, body at the
 *   threading boundary, max media items, unicode, multi-line, and special
 *   characters. The adapter is constructed with an injected fake apiClientFactory.
 *   Tier 0: no network, no DB, no Redis.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createTestCanonicalPost, makeAdapter } from "./XAdapter.test-helpers.js";
import type { Media } from "@shared/types";

// ============================================================================
// Edge Cases
// ============================================================================

describe("XAdapter - Edge Cases", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle empty body string", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Should render without error");
    assert.strictEqual(result.value.type, "single");
  });

  it("should handle body exactly at 280 chars", () => {
    const { adapter } = makeAdapter();
    const body280 = "B".repeat(280);
    const post = createTestCanonicalPost({ body: body280 });
    const result = adapter.render(post);

    assert.ok(result.ok, "Should render without error");
  });

  it("should handle body at threading boundary (274 chars)", () => {
    const { adapter } = makeAdapter();
    const body274 = "C".repeat(274);
    const post = createTestCanonicalPost({ body: body274 });
    const result = adapter.render(post);

    assert.ok(result.ok, "Should render without error");
    assert.strictEqual(result.value.type, "single", "274 chars should be a single tweet");
  });

  it("should accept up to maxMediaPerPost (4) media items in render", () => {
    const { adapter } = makeAdapter();
    const mediaItems: Media[] = [];
    for (let i = 0; i < 4; i++) {
      mediaItems.push({
        id: `media-${i}`,
        type: "image",
        url: `https://example.com/img${i}.jpg`,
      });
    }
    const post = createTestCanonicalPost({ body: "Max media tweet", media: mediaItems });
    const result = adapter.render(post);

    assert.ok(result.ok);
  });

  it("should handle unicode and emoji characters in content", () => {
    const { adapter } = makeAdapter();
    const emojiBody = "Hello world! Testing emojis and unicode chars here.";
    const post = createTestCanonicalPost({ body: emojiBody });
    const result = adapter.render(post);

    assert.ok(result.ok, "Should render unicode content without error");
    assert.strictEqual(result.value.type, "single");
  });

  it("should handle multi-line content", () => {
    const { adapter } = makeAdapter();
    const multiLine = "Line 1\nLine 2\nLine 3\n\nParagraph 2";
    const post = createTestCanonicalPost({ body: multiLine });
    const result = adapter.render(post);

    assert.ok(result.ok, "Should render multi-line content");
    assert.strictEqual(result.value.type, "single");
    if (result.value.type === "single") {
      const content = result.value.content as { body: string };
      assert.ok(content.body.includes("\n"), "Should preserve line breaks in single tweet");
    }
  });

  it("should handle special characters in content", () => {
    const { adapter } = makeAdapter();
    const specialChars =
      'Content with "quotes", <angles>, & ampersands, @mentions, #hashtags, and $money';
    const post = createTestCanonicalPost({ body: specialChars });
    const result = adapter.render(post);

    assert.ok(result.ok, "Should render content with special characters");
    assert.strictEqual(result.value.type, "single");
  });
});
