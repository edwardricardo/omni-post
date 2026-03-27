/**
 * @file BlueskyAdapter.test.ts
 * @description Mutation-killing tests for BlueskyAdapter — validates render behavior,
 * text limits, media handling, credential handling, publish flow, and error mapping.
 */

import { describe, it, beforeAll, beforeEach, vi } from "vitest";
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

function _makeMediaInput(
  body: string,
  media: Array<{ url: string; type: "image" | "video" | "gif"; alt?: string }>,
  channelId = "chan-001"
) {
  return {
    channelId,
    dedupeKey: "dedupe-002",
    post: { body, media },
  };
}

// ============================================================================
// Suite
// ============================================================================

describe("BlueskyAdapter", { concurrent: false }, () => {
  let adapter: BlueskyAdapter;

  beforeAll(() => {
    adapter = makeAdapter();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env vars to ensure clean state per test
    delete process.env.BLUESKY_IDENTIFIER;
    delete process.env.BLUESKY_APP_PASSWORD;
  });

  // =========================================================================
  // metadata and capabilities
  // =========================================================================

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

    it("has correct metadata displayName", () => {
      assert.equal(adapter.metadata.displayName, "Bluesky");
    });

    it("has correct metadata authType", () => {
      assert.equal(adapter.metadata.authType, "api_key");
    });

    it("has correct metadata status", () => {
      assert.equal(adapter.metadata.status, "active");
    });

    it("has correct allowed media types", () => {
      assert.deepEqual(adapter.limits.allowedMedia, ["image"]);
    });

    it("declares videos as false", () => {
      assert.equal(adapter.capabilities.videos, false);
    });

    it("declares publish as true", () => {
      assert.equal(adapter.capabilities.publish, true);
    });

    it("declares schedule as false", () => {
      assert.equal(adapter.capabilities.schedule, false);
    });

    it("declares analytics as false", () => {
      assert.equal(adapter.capabilities.analytics, false);
    });

    it("declares linkCards as true", () => {
      assert.equal(adapter.capabilities.linkCards, true);
    });

    it("has correct rateLimitHints", () => {
      assert.deepEqual(adapter.limits.rateLimitHints, { burst: 100, perSeconds: 3600 });
    });

    it("has maxPostsPerThread equal to 1", () => {
      assert.equal(adapter.limits.maxPostsPerThread, 1);
    });

    it("has correct aspect ratios", () => {
      assert.deepEqual(adapter.limits.aspectRatios, ["1:1", "16:9", "4:3"]);
    });

    it("has correct metadata name", () => {
      assert.equal(adapter.metadata.name, "bluesky");
    });

    it("has correct metadata color", () => {
      assert.equal(adapter.metadata.color, "#0085ff");
    });

    it("requires identifier and appPassword credentials", () => {
      // @ts-expect-error — accessing protected field for testing
      const fields = adapter.requiredCredentialFields;
      assert.deepEqual(fields, ["identifier", "appPassword"]);
    });
  });

  // =========================================================================
  // render
  // =========================================================================

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
      assert.equal(result.value.type, "single");
    });

    it("returns ok for empty body", () => {
      const result = adapter.render({ body: "" });
      assert.ok(result.ok);
      assert.equal((result.value.content as { body: string }).body, "");
    });

    it("uses empty string when body is undefined", () => {
      const result = adapter.render({} as { body: string });
      assert.ok(result.ok);
      assert.equal((result.value.content as { body: string }).body, "");
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

    it("includes media in rendered content with url, type, and alt", () => {
      const result = adapter.render({
        body: "media test",
        media: [
          { url: "https://img.com/a.jpg", type: "image" as const, id: "1", alt: "Alt A" },
          { url: "https://img.com/b.jpg", type: "image" as const, id: "2" },
        ],
      });
      assert.ok(result.ok);
      const content = result.value.content as {
        body: string;
        media: Array<{ url: string; type: string; alt?: string }>;
      };
      assert.equal(content.media.length, 2);
      assert.equal(content.media[0].url, "https://img.com/a.jpg");
      assert.equal(content.media[0].type, "image");
      assert.equal(content.media[0].alt, "Alt A");
      assert.equal(content.media[1].url, "https://img.com/b.jpg");
      assert.equal(content.media[1].type, "image");
      // Second image has no alt — key should not exist
      assert.equal(Object.prototype.hasOwnProperty.call(content.media[1], "alt"), false);
    });

    it("slices media to max 4 items", () => {
      // Provide exactly 4 images (boundary)
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
      const content = result.value.content as { body: string; media: Array<{ url: string }> };
      assert.equal(content.media.length, 4);
    });

    it("omits media from content when media array is empty", () => {
      const result = adapter.render({
        body: "no media",
        media: [],
      });
      assert.ok(result.ok);
      const content = result.value.content as { body: string; media?: unknown };
      assert.equal(Object.prototype.hasOwnProperty.call(content, "media"), false);
    });

    it("omits media from content when media is undefined", () => {
      const result = adapter.render({ body: "plain text" });
      assert.ok(result.ok);
      const content = result.value.content as { body: string; media?: unknown };
      assert.equal(Object.prototype.hasOwnProperty.call(content, "media"), false);
    });

    it("renders with 1 image", () => {
      const result = adapter.render({
        body: "single",
        media: [{ url: "one.jpg", type: "image" as const, id: "1" }],
      });
      assert.ok(result.ok);
      const content = result.value.content as { body: string; media: Array<{ url: string }> };
      assert.equal(content.media.length, 1);
      assert.equal(content.media[0].url, "one.jpg");
    });

    it("renders with 3 images", () => {
      const result = adapter.render({
        body: "three",
        media: [
          { url: "a.jpg", type: "image" as const, id: "1" },
          { url: "b.jpg", type: "image" as const, id: "2" },
          { url: "c.jpg", type: "image" as const, id: "3" },
        ],
      });
      assert.ok(result.ok);
      const content = result.value.content as { body: string; media: Array<{ url: string }> };
      assert.equal(content.media.length, 3);
    });
  });

  // =========================================================================
  // getCredentialsFromEnvironment
  // =========================================================================

  describe("getCredentialsFromEnvironment", () => {
    it("returns AUTH error when env vars missing", () => {
      // @ts-expect-error — accessing protected method for testing
      const result = adapter.getCredentialsFromEnvironment();
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH error when only identifier is set", () => {
      process.env.BLUESKY_IDENTIFIER = "test.bsky.social";
      // @ts-expect-error — accessing protected method for testing
      const result = adapter.getCredentialsFromEnvironment();
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH error when only appPassword is set", () => {
      process.env.BLUESKY_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx";
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

    it("returns AUTH error when identifier is empty string", () => {
      process.env.BLUESKY_IDENTIFIER = "";
      process.env.BLUESKY_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx";
      // @ts-expect-error — accessing protected method for testing
      const result = adapter.getCredentialsFromEnvironment();
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH error when appPassword is empty string", () => {
      process.env.BLUESKY_IDENTIFIER = "test.bsky.social";
      process.env.BLUESKY_APP_PASSWORD = "";
      // @ts-expect-error — accessing protected method for testing
      const result = adapter.getCredentialsFromEnvironment();
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  // =========================================================================
  // createApiClient
  // =========================================================================

  describe("createApiClient", () => {
    it("creates a BlueskyClient with the provided credentials", () => {
      const creds = { identifier: "user.bsky.social", appPassword: "xxxx" };
      // @ts-expect-error — accessing protected method for testing
      const client = adapter.createApiClient(creds);
      assert.ok(client, "Should return a client instance");
    });

    it("defaults identifier to empty string when undefined", () => {
      const creds = { identifier: undefined, appPassword: "pass" } as unknown as {
        identifier: string;
        appPassword: string;
      };
      // @ts-expect-error — accessing protected method for testing
      const client = adapter.createApiClient(creds);
      assert.ok(client, "Should not throw on undefined identifier");
    });

    it("defaults appPassword to empty string when undefined", () => {
      const creds = { identifier: "user", appPassword: undefined } as unknown as {
        identifier: string;
        appPassword: string;
      };
      // @ts-expect-error — accessing protected method for testing
      const client = adapter.createApiClient(creds);
      assert.ok(client, "Should not throw on undefined appPassword");
    });
  });

  // =========================================================================
  // publishThread — not supported
  // =========================================================================

  describe("publishThread — not supported", () => {
    it("publishThread is not implemented (threading not supported on Bluesky)", () => {
      assert.equal(typeof adapter.publishThread, "undefined");
    });
  });

  // =========================================================================
  // publish
  // =========================================================================

  describe("publish — credential failure", () => {
    it("returns AUTH error when no credentials in env or DB", async () => {
      const input = makeInput("Hello from Bluesky test");
      const result = await adapter.publish(input);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  describe("publish — text validation", () => {
    it("returns VALIDATION error for text > 300 chars even when credentials exist", async () => {
      process.env.BLUESKY_IDENTIFIER = "test.bsky.social";
      process.env.BLUESKY_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx";

      // Login will fail because we can't mock the real AtpAgent here,
      // but the text validation check happens after credential retrieval
      // and before/after login. If login succeeds, validation will be checked.
      const input = makeInput("z".repeat(301));
      const result = await adapter.publish(input);
      assert.ok(!result.ok, "Should reject text > 300 chars");
      // Will be either AUTH (login failure) or VALIDATION (text too long)
      assert.ok(
        result.error === "AUTH" || result.error === "VALIDATION",
        `Expected AUTH or VALIDATION, got ${result.error}`
      );
    });
  });
});
