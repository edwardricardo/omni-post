/**
 * @file BlueskyAdapter.test.ts
 * @description Mutation-killing tests for BlueskyAdapter — render behavior,
 *   text limits, media handling, credential validation, publish flow, and
 *   error mapping. The adapter takes credentials per-call; the suite injects a
 *   fake `BlueskyClient` factory so tests do not hit the network.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import { BlueskyAdapter, type BlueskyClientFactory } from "../src/BlueskyAdapter.js";
import type {
  BlueskyClient,
  BlueskyCredentials,
  BlueskyPostResult,
  BlueskySession,
} from "../src/BlueskyClient.js";

// ============================================================================
// Helpers
// ============================================================================

type ClientPublishError = "AUTH" | "RATE_LIMIT" | "PUBLISH" | "VALIDATION";

interface FakeClient {
  login: () => Promise<Result<BlueskySession, "AUTH">>;
  publishText: (text: string) => Promise<Result<BlueskyPostResult, ClientPublishError>>;
  publishWithImages: (
    text: string,
    buffers: Uint8Array[],
    altTexts: string[]
  ) => Promise<Result<BlueskyPostResult, ClientPublishError>>;
}

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    login: vi.fn(async () =>
      ok({
        accessJwt: "jwt",
        refreshJwt: "ref",
        did: "did:plc:test",
        handle: "test.bsky.social",
      })
    ),
    publishText: vi.fn(async () => ok({ uri: "at://test/post/1", cid: "bafy123" })),
    publishWithImages: vi.fn(async () => ok({ uri: "at://test/post/2", cid: "bafy456" })),
    ...overrides,
  };
}

function makeAdapter(client: FakeClient = makeFakeClient()) {
  const factory: BlueskyClientFactory = () => client as unknown as BlueskyClient;
  return new BlueskyAdapter({ clientFactory: factory });
}

const VALID_CREDS: BlueskyCredentials = {
  identifier: "test.bsky.social",
  appPassword: "xxxx-xxxx-xxxx-xxxx",
};

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

describe("BlueskyAdapter", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata and capabilities", () => {
    const adapter = makeAdapter();

    it("has correct provider id", () => {
      assert.equal(adapter.id, "bluesky");
    });

    it("has correct character limit of 300", () => {
      assert.equal(adapter.limits.maxChars, 300);
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

    it("declares publish as true", () => {
      assert.equal(adapter.capabilities.publish, true);
    });

    it("declares schedule as false", () => {
      assert.equal(adapter.capabilities.schedule, false);
    });

    it("declares analytics as false", () => {
      assert.equal(adapter.capabilities.analytics, false);
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
  });

  describe("render", () => {
    const adapter = makeAdapter();

    it("returns ok with type=single for text within 300 chars", () => {
      const result = adapter.render({ body: "Hello Bluesky!" });
      assert.ok(result.ok);
      assert.equal(result.value.type, "single");
      assert.equal((result.value.content as { body: string }).body, "Hello Bluesky!");
    });

    it("returns TEXT_TOO_LONG error for text > 300 chars", () => {
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
      assert.equal(content.media[0].alt, "Alt A");
      assert.equal(Object.prototype.hasOwnProperty.call(content.media[1], "alt"), false);
    });

    it("omits media from content when media array is empty", () => {
      const result = adapter.render({ body: "no media", media: [] });
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
  });

  describe("validateCredentials", () => {
    it("returns AUTH_INVALID when credentials are missing identifier", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({ appPassword: "xxxx" });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when credentials are missing appPassword", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({ identifier: "test.bsky.social" });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when credentials object is null", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials(null);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when login fails", async () => {
      const client = makeFakeClient({ login: vi.fn(async () => err("AUTH")) });
      const adapter = makeAdapter(client);
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns ok when credentials are valid and login succeeds", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(result.ok);
    });
  });

  describe("publish", () => {
    it("returns AUTH error when credentials are missing", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput("hello"), undefined);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH error when credentials lack identifier", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput("hello"), { appPassword: "xxxx" });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns VALIDATION error for text > 300 chars", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput("z".repeat(301)), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("returns AUTH error when login fails", async () => {
      const client = makeFakeClient({ login: vi.fn(async () => err("AUTH")) });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput("hello"), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns ok with providerPostId from publishText for text-only post", async () => {
      const client = makeFakeClient();
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput("hello world"), VALID_CREDS);
      assert.ok(result.ok);
      assert.equal(result.value.providerPostId, "at://test/post/1");
      assert.equal(client.publishText.mock.calls.length, 1);
    });

    it("returns VALIDATION when publishText returns VALIDATION error", async () => {
      const client = makeFakeClient({
        publishText: vi.fn(async () => err("VALIDATION")),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput("hello"), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("returns NETWORK when publishText returns PUBLISH error", async () => {
      const client = makeFakeClient({
        publishText: vi.fn(async () => err("PUBLISH")),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput("hello"), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });

    // §2F Slice 1: surface a definitive client AUTH (revoked app-password) as
    // AUTH so reauth can fire; a transient RATE_LIMIT stays RATE_LIMIT.
    it("returns AUTH when publishText returns AUTH error", async () => {
      const client = makeFakeClient({
        publishText: vi.fn(async () => err("AUTH")),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput("hello"), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns RATE_LIMIT when publishText returns RATE_LIMIT error", async () => {
      const client = makeFakeClient({
        publishText: vi.fn(async () => err("RATE_LIMIT")),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput("hello"), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "RATE_LIMIT");
    });

    it("includes profile URL in receipt", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput("hello"), VALID_CREDS);
      assert.ok(result.ok);
      assert.equal(result.value.url, "https://bsky.app/profile/test.bsky.social");
    });
  });

  describe("publishThread — not supported", () => {
    it("publishThread is not implemented (threading not supported on Bluesky)", () => {
      const adapter = makeAdapter();
      assert.equal(typeof adapter.publishThread, "undefined");
    });
  });
});
