/**
 * @file BlueskyAdapter.test.ts
 * @description Unit tests for BlueskyAdapter — validates render behavior, text limits,
 * credential handling, and thread rejection with mocked BlueskyClient.
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlueskyAdapter } from "../src/BlueskyAdapter.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAdapter(): BlueskyAdapter {
  return new BlueskyAdapter();
}

function makeInput(body: string, channelId = "chan-001") {
  return {
    channelId,
    dedupeKey: "dedupe-001",
    post: { body, media: undefined },
  };
}

// ============================================================================
// Suite
// ============================================================================

describe("BlueskyAdapter", () => {
  let adapter: BlueskyAdapter;

  before(() => {
    adapter = makeAdapter();
  });

  beforeEach(() => {
    // Clear env vars to ensure clean state per test
    delete process.env.BLUESKY_IDENTIFIER;
    delete process.env.BLUESKY_APP_PASSWORD;
  });

  describe("metadata and capabilities", () => {
    it("has correct provider id", () => {
      assert.equal(adapter.id, "bluesky");
    });

    it("has correct character limit of 300", () => {
      assert.equal(adapter.limits.maxChars, 300);
    });

    it("declares communityPosts as false", () => {
      assert.equal(adapter.capabilities.communityPosts, false);
    });

    it("declares reels as false", () => {
      assert.equal(adapter.capabilities.reels, false);
    });

    it("declares stories as false", () => {
      assert.equal(adapter.capabilities.stories, false);
    });

    it("declares images as true", () => {
      assert.equal(adapter.capabilities.images, true);
    });

    it("declares maxMediaPerPost as 4", () => {
      assert.equal(adapter.limits.maxMediaPerPost, 4);
    });

    it("declares threading as false", () => {
      assert.equal(adapter.capabilities.threading, false);
    });
  });

  describe("render", () => {
    it("returns ok with type=single for text within 300 chars", () => {
      const result = adapter.render({ body: "Hello Bluesky!" });
      assert.ok(result.ok, "Should render successfully");
      assert.equal(result.value.type, "single");
      assert.equal((result.value.content as { body: string }).body, "Hello Bluesky!");
    });

    it("returns TEXT_TOO_LONG error for text > 300 chars", () => {
      const longText = "a".repeat(301);
      const result = adapter.render({ body: longText });
      assert.ok(!result.ok, "Should fail");
      assert.equal(result.error, "TEXT_TOO_LONG");
    });

    it("returns TEXT_TOO_LONG for exactly 301 chars", () => {
      const result = adapter.render({ body: "a".repeat(301) });
      assert.ok(!result.ok);
      assert.equal(result.error, "TEXT_TOO_LONG");
    });

    it("returns ok for exactly 300 chars", () => {
      const result = adapter.render({ body: "a".repeat(300) });
      assert.ok(result.ok);
    });

    it("returns ok for empty body", () => {
      const result = adapter.render({ body: "" });
      assert.ok(result.ok);
    });

    it("returns VALIDATION_ERROR when > 4 images", () => {
      const result = adapter.render({
        body: "test",
        media: [
          { url: "a.jpg", type: "image" as const, id: "1" },
          { url: "b.jpg", type: "image" as const, id: "2" },
          { url: "c.jpg", type: "image" as const, id: "3" },
          { url: "d.jpg", type: "image" as const, id: "4" },
          { url: "e.jpg", type: "image" as const, id: "5" },
        ],
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION_ERROR");
    });

    it("returns ok for exactly 4 images", () => {
      const result = adapter.render({
        body: "test",
        media: [
          { url: "a.jpg", type: "image" as const, id: "1" },
          { url: "b.jpg", type: "image" as const, id: "2" },
          { url: "c.jpg", type: "image" as const, id: "3" },
          { url: "d.jpg", type: "image" as const, id: "4" },
        ],
      });
      assert.ok(result.ok);
    });
  });

  describe("getCredentialsFromEnvironment", () => {
    it("returns AUTH error when env vars missing", () => {
      // @ts-expect-error — accessing protected method for testing
      const result = adapter.getCredentialsFromEnvironment();
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns credentials when env vars set", () => {
      process.env.BLUESKY_IDENTIFIER = "test.bsky.social";
      process.env.BLUESKY_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx";

      // @ts-expect-error — accessing protected method for testing
      const result = adapter.getCredentialsFromEnvironment();
      assert.ok(result.ok);
      assert.equal(result.value.identifier, "test.bsky.social");
      assert.equal(result.value.appPassword, "xxxx-xxxx-xxxx-xxxx");
    });
  });

  describe("publishThread — not supported", () => {
    it("publishThread is not implemented (threading not supported on Bluesky)", () => {
      // Bluesky does not support threading via this adapter.
      // The method is optional in AbstractProviderAdapter and is intentionally absent.
      assert.equal(typeof adapter.publishThread, "undefined");
    });
  });

  describe("publish — credential failure", () => {
    it("returns AUTH error when no credentials in env or DB", async () => {
      const input = makeInput("Hello from Bluesky test");
      const result = await adapter.publish(input);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });
});
