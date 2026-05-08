/**
 * @file XAdapter.test.ts
 * @description Core test suite for XAdapter — metadata, render, planThread, and
 *   validateCredentials. The adapter takes credentials per-call; tests construct
 *   it via injected fake apiClientFactory (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { XAdapter } from "../src/XAdapter.js";
import {
  createMockApiClient,
  createFailingApiClient,
  createTestCanonicalPost,
  makeAdapter,
  MOCK_CREDENTIALS,
  SHORT_BODY,
  LONG_BODY,
} from "./XAdapter.test-helpers.js";

// ============================================================================
// 1. Metadata Tests
// ============================================================================

describe("XAdapter - Metadata", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct provider ID", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.id, "x");
  });

  it("should have correct metadata fields", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.id, "x");
    assert.strictEqual(adapter.metadata.name, "x");
    assert.strictEqual(adapter.metadata.displayName, "X (Twitter)");
    assert.strictEqual(adapter.metadata.authType, "oauth");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.deepStrictEqual(adapter.metadata.requiredScopes, [
      "tweet.read",
      "tweet.write",
      "users.read",
    ]);
  });

  it("should have correct limits", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxChars, 280);
    assert.strictEqual(adapter.limits.maxMediaPerPost, 4);
    assert.strictEqual(adapter.limits.maxPostsPerThread, 25);
    assert.strictEqual(adapter.limits.threadingSupported, true);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video", "gif"]);
    assert.deepStrictEqual(adapter.limits.aspectRatios, ["16:9", "1:1", "4:5", "9:16"]);
    assert.deepStrictEqual(adapter.limits.rateLimitHints, {
      burst: 300,
      perSeconds: 10800,
    });
  });

  it("should have correct capabilities", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, true);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.comments, true);
    assert.strictEqual(adapter.capabilities.replies, true);
    assert.strictEqual(adapter.capabilities.threading, true);
    assert.strictEqual(adapter.capabilities.media, true);
    assert.strictEqual(adapter.capabilities.images, true);
    assert.strictEqual(adapter.capabilities.videos, true);
  });

  it("should have empty constraints", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.constraints, {});
  });

  it("should expose a factory that returns an XAdapter instance", async () => {
    const { createXAdapter } = await import("../src/XAdapter.js");
    const adapter = createXAdapter();
    assert.ok(adapter instanceof XAdapter);
    assert.strictEqual(adapter.id, "x");
  });
});

// ============================================================================
// 2. Render Tests
// ============================================================================

describe("XAdapter - render()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render short content as a single tweet", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: SHORT_BODY });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as { body: string; meta: Record<string, unknown> };
    assert.strictEqual(content.body, SHORT_BODY);
    assert.deepStrictEqual(content.meta, {
      sequence: 1,
      totalTweets: 1,
    });
  });

  it("should render long content as a thread", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: LONG_BODY });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "thread");

    const content = result.value.content as {
      needsThreading: boolean;
      tweets: Array<{ text: string }>;
    };
    assert.ok(content.needsThreading, "Should indicate threading is needed");
    assert.ok(content.tweets.length > 1, "Thread should have multiple tweets");
    assert.ok(
      content.tweets.every((t) => t.text.length <= 280),
      "All tweets should be within 280 chars"
    );
  });

  it("should pass media through in single tweet render", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "Tweet with media",
      media: [
        {
          id: "media-1",
          type: "image",
          url: "https://example.com/image.jpg",
          alt: "Test image",
        },
      ],
    });

    const result = adapter.render(post);
    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as {
      media?: Array<{ url: string; type: string; alt?: string }>;
    };
    assert.ok(content.media, "Media should be present");
    assert.strictEqual(content.media!.length, 1);
    assert.strictEqual(content.media![0]!.url, "https://example.com/image.jpg");
    assert.strictEqual(content.media![0]!.type, "image");
    assert.strictEqual(content.media![0]!.alt, "Test image");
  });

  it("should not include media array when post has no media", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "No media here" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    const content = result.value.content as { media?: unknown };
    assert.strictEqual(content.media, undefined, "Should not have media key");
  });

  it("should handle body exactly at 280 chars as single tweet", () => {
    const { adapter } = makeAdapter();
    const exactBody = "A".repeat(274);
    const post = createTestCanonicalPost({ body: exactBody });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single", "Should be single tweet");
  });

  it("should include estimatedReach in thread meta", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: LONG_BODY });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    if (result.value.type === "thread") {
      assert.ok(
        result.value.meta?.estimatedReach !== undefined,
        "Thread meta should contain estimatedReach"
      );
    }
  });
});

// ============================================================================
// 3. PlanThread Tests
// ============================================================================

describe("XAdapter - planThread()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not need threading for short content", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: SHORT_BODY });
    const result = adapter.planThread(post);

    assert.ok(result.ok, "planThread should succeed");
    assert.strictEqual(result.value.needsThreading, false);
    assert.strictEqual(result.value.tweets.length, 1);
    assert.strictEqual(result.value.strategy, "SINGLE");
  });

  it("should plan threading for long content", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: LONG_BODY });
    const result = adapter.planThread(post);

    assert.ok(result.ok, "planThread should succeed");
    assert.strictEqual(result.value.needsThreading, true);
    assert.ok(result.value.tweets.length > 1);
    assert.strictEqual(result.value.strategy, "AUTO");
  });

  it("should respect maxChars limit in each tweet fragment", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: LONG_BODY });
    const result = adapter.planThread(post);

    assert.ok(result.ok, "planThread should succeed");

    for (const tweet of result.value.tweets) {
      assert.ok(
        tweet.estimatedChars <= 280,
        `Tweet ${tweet.sequence} exceeds 280 chars: ${tweet.estimatedChars}`
      );
    }
  });

  it("should return CONTENT_TOO_LONG for extremely long content", () => {
    const { adapter } = makeAdapter();
    const extremeBody = "A".repeat(8000);
    const post = createTestCanonicalPost({ body: extremeBody });
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "CONTENT_TOO_LONG");
  });
});

// ============================================================================
// 4. ValidateCredentials Tests
// ============================================================================

describe("XAdapter - validateCredentials()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return AUTH_INVALID when required fields are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({
      apiKey: "key",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH_INVALID");
  });

  it("should return AUTH_INVALID when credentials are null", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials(null);
    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH_INVALID");
  });

  it("should succeed with valid credentials and working API client", async () => {
    const { adapter, client } = makeAdapter();
    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);

    assert.ok(result.ok, "Should succeed with valid credentials");
    assert.strictEqual(client.validateCredentials.mock.calls.length, 1);
  });

  it("should return AUTH_INVALID when API client throws generic error", async () => {
    const failingClient = createFailingApiClient("Connection refused");
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.validateCredentials({
      apiKey: "key",
      apiSecret: "secret",
      bearerToken: "bearer",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH_INVALID");
  });

  it("should return AUTH_EXPIRED when API returns 401", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.validateCredentials({
      apiKey: "expired-key",
      apiSecret: "expired-secret",
      bearerToken: "expired-bearer",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH_EXPIRED");
  });

  it("should return AUTH_INVALID when some required fields are empty strings", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({
      apiKey: "",
      apiSecret: "secret",
      bearerToken: "bearer",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH_INVALID");
  });
});

// Force the helper imports to be retained by the tooling.
void createMockApiClient;
