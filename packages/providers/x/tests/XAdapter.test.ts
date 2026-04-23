/**
 * XAdapter - Core Test Suite
 *
 * Tests validated here:
 * 1. Metadata (7 tests)        -- id, limits, capabilities, metadata, constraints,
 *                                  requiredCredentialFields, singleton export
 * 2. Render (6 tests)           -- single tweet, thread, media passthrough,
 *                                  empty thread plan, short body, exact 280 chars
 * 3. PlanThread (4 tests)       -- short content (no threading), long content
 *                                  (needs threading), respects limits, CONTENT_TOO_LONG
 * 4. ValidateCredentials (5)    -- missing fields, valid creds, API error,
 *                                  401 error, partial missing fields
 * 5. GetCredentialsFromEnv (4)  -- reads env vars, placeholder error, partial
 *                                  placeholders, all valid
 *
 * All tests are Tier 0 (no network, no DB, no Redis).
 *
 * @file XAdapter.test.ts
 * @description Tests for XAdapter - Metadata
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { XAdapter } from "../src/XAdapter.js";
import {
  createMockApiClient,
  createFailingApiClient,
  createTestCanonicalPost,
  SHORT_BODY,
  LONG_BODY,
} from "./XAdapter.test-helpers.js";

// ============================================================================
// 1. Metadata Tests (7 tests)
// ============================================================================

describe("XAdapter - Metadata", { concurrent: false }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new XAdapter();
  });

  it("should have correct provider ID", () => {
    assert.strictEqual(adapter.id, "x");
  });

  it("should have correct metadata fields", () => {
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
    assert.deepStrictEqual(adapter.constraints, {});
  });

  it("should have correct requiredCredentialFields", () => {
    // Access protected field via type cast
    const fields = (adapter as any).requiredCredentialFields;
    assert.deepStrictEqual(fields, ["apiKey", "apiSecret", "bearerToken"]);
  });

  it("should export a singleton instance", async () => {
    const { xAdapter } = await import("../src/XAdapter.js");
    assert.ok(xAdapter instanceof XAdapter);
    assert.strictEqual(xAdapter.id, "x");
  });
});

// ============================================================================
// 2. Render Tests (6 tests)
// ============================================================================

describe("XAdapter - render()", { concurrent: false }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new XAdapter();
  });

  it("should render short content as a single tweet", () => {
    const post = createTestCanonicalPost({ body: SHORT_BODY });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as any;
    assert.strictEqual(content.body, SHORT_BODY);
    assert.deepStrictEqual(content.meta, {
      sequence: 1,
      totalTweets: 1,
    });
  });

  it("should render long content as a thread", () => {
    const post = createTestCanonicalPost({ body: LONG_BODY });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "thread");

    const content = result.value.content as any;
    assert.ok(content.needsThreading, "Should indicate threading is needed");
    assert.ok(content.tweets.length > 1, "Thread should have multiple tweets");
    assert.ok(
      content.tweets.every((t: any) => t.text.length <= 280),
      "All tweets should be within 280 chars"
    );
  });

  it("should pass media through in single tweet render", () => {
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

    const content = result.value.content as any;
    assert.ok(content.media, "Media should be present");
    assert.strictEqual(content.media.length, 1);
    assert.strictEqual(content.media[0].url, "https://example.com/image.jpg");
    assert.strictEqual(content.media[0].type, "image");
    assert.strictEqual(content.media[0].alt, "Test image");
  });

  it("should not include media array when post has no media", () => {
    const post = createTestCanonicalPost({ body: "No media here" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    const content = result.value.content as any;
    assert.strictEqual(content.media, undefined, "Should not have media key");
  });

  it("should handle body exactly at 280 chars as single tweet", () => {
    const exactBody = "A".repeat(274); // 274 chars -- within 280 - 6 (indicator length)
    const post = createTestCanonicalPost({ body: exactBody });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single", "Should be single tweet");
  });

  it("should include estimatedReach in thread meta", () => {
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
// 3. PlanThread Tests (4 tests)
// ============================================================================

describe("XAdapter - planThread()", { concurrent: false }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new XAdapter();
  });

  it("should not need threading for short content", () => {
    const post = createTestCanonicalPost({ body: SHORT_BODY });
    const result = adapter.planThread(post);

    assert.ok(result.ok, "planThread should succeed");
    assert.strictEqual(result.value.needsThreading, false, "Should not need threading");
    assert.strictEqual(result.value.tweets.length, 1, "Should have exactly 1 tweet");
    assert.strictEqual(result.value.strategy, "SINGLE", "Strategy should be SINGLE");
  });

  it("should plan threading for long content", () => {
    const post = createTestCanonicalPost({ body: LONG_BODY });
    const result = adapter.planThread(post);

    assert.ok(result.ok, "planThread should succeed");
    assert.strictEqual(result.value.needsThreading, true, "Should need threading");
    assert.ok(result.value.tweets.length > 1, "Should have multiple tweets");
    assert.strictEqual(result.value.strategy, "AUTO", "Strategy should be AUTO");
  });

  it("should respect maxChars limit in each tweet fragment", () => {
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
    // Create content that exceeds 25 tweets * ~274 chars = ~6850 chars
    const extremeBody = "A".repeat(8000);
    const post = createTestCanonicalPost({ body: extremeBody });
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false, "Should fail");
    assert.strictEqual(
      (result as any).error,
      "CONTENT_TOO_LONG",
      "Error should be CONTENT_TOO_LONG"
    );
  });
});

// ============================================================================
// 4. ValidateCredentials Tests (5 tests)
// ============================================================================

describe("XAdapter - validateCredentials()", { concurrent: false }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new XAdapter();
  });

  it("should return AUTH_INVALID when required fields are missing", async () => {
    const result = await adapter.validateCredentials({
      apiKey: "key",
      // missing apiSecret and bearerToken
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).error, "AUTH_INVALID");
  });

  it("should succeed with valid credentials and working API client", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "createApiClient").mockReturnValue(mockClient);

    const result = await adapter.validateCredentials({
      apiKey: "valid-key",
      apiSecret: "valid-secret",
      bearerToken: "valid-bearer",
      accessToken: "valid-token",
      accessTokenSecret: "valid-token-secret",
    });

    assert.ok(result.ok, "Should succeed with valid credentials");
    assert.strictEqual(
      mockClient.validateCredentials.mock.calls.length,
      1,
      "Should call validateCredentials on API client"
    );
  });

  it("should return AUTH_INVALID when API client throws generic error", async () => {
    const mockClient = createFailingApiClient("Connection refused");
    vi.spyOn(adapter as any, "createApiClient").mockReturnValue(mockClient);

    const result = await adapter.validateCredentials({
      apiKey: "key",
      apiSecret: "secret",
      bearerToken: "bearer",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).error, "AUTH_INVALID");
  });

  it("should return AUTH_EXPIRED when API returns 401", async () => {
    const mockClient = createFailingApiClient("Unauthorized", 401);
    vi.spyOn(adapter as any, "createApiClient").mockReturnValue(mockClient);

    const result = await adapter.validateCredentials({
      apiKey: "expired-key",
      apiSecret: "expired-secret",
      bearerToken: "expired-bearer",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).error, "AUTH_EXPIRED");
  });

  it("should return AUTH_INVALID when some required fields are empty strings", async () => {
    const result = await adapter.validateCredentials({
      apiKey: "",
      apiSecret: "secret",
      bearerToken: "bearer",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).error, "AUTH_INVALID");
  });
});

// ============================================================================
// 5. GetCredentialsFromEnvironment Tests (4 tests)
// ============================================================================

describe("XAdapter - getCredentialsFromEnvironment()", { concurrent: false }, () => {
  let adapter: XAdapter;
  const envVars = [
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET",
    "X_BEARER_TOKEN",
  ] as const;

  // Save and restore env vars
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new XAdapter();
    savedEnv = {};
    for (const key of envVars) {
      savedEnv[key] = process.env[key];
    }
  });

  // Use afterEach-like cleanup via beforeEach resetting + manual restore pattern
  // In node:test, we clean up in each test or use a shared pattern.

  function restoreEnv() {
    for (const key of envVars) {
      const saved = savedEnv[key];
      if (saved !== undefined) {
        process.env[key] = saved;
      } else {
        delete process.env[key];
      }
    }
  }

  it("should return err when env vars are not set (placeholder defaults)", () => {
    // Clear all X env vars
    for (const key of envVars) {
      delete process.env[key];
    }

    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.strictEqual(result.ok, false, "Should fail with placeholders");
    assert.strictEqual(result.error, "AUTH");

    restoreEnv();
  });

  it("should return err when apiKey is placeholder", () => {
    process.env.X_API_KEY = "placeholder";
    process.env.X_API_SECRET = "real-secret";
    process.env.X_ACCESS_TOKEN = "real-token";
    process.env.X_ACCESS_TOKEN_SECRET = "real-token-secret";
    process.env.X_BEARER_TOKEN = "real-bearer";

    const result = (adapter as any).getCredentialsFromEnvironment();
    assert.strictEqual(result.ok, false, "Should fail when apiKey is placeholder");

    restoreEnv();
  });

  it("should return err when bearerToken is placeholder", () => {
    process.env.X_API_KEY = "real-key";
    process.env.X_API_SECRET = "real-secret";
    process.env.X_ACCESS_TOKEN = "real-token";
    process.env.X_ACCESS_TOKEN_SECRET = "real-token-secret";
    process.env.X_BEARER_TOKEN = "placeholder";

    const result = (adapter as any).getCredentialsFromEnvironment();
    assert.strictEqual(result.ok, false, "Should fail when bearerToken is placeholder");

    restoreEnv();
  });

  it("should return ok with valid env vars", () => {
    process.env.X_API_KEY = "real-api-key";
    process.env.X_API_SECRET = "real-api-secret";
    process.env.X_ACCESS_TOKEN = "real-access-token";
    process.env.X_ACCESS_TOKEN_SECRET = "real-access-token-secret";
    process.env.X_BEARER_TOKEN = "real-bearer-token";

    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.ok(result.ok, "Should succeed with valid env vars");
    assert.strictEqual(result.value.apiKey, "real-api-key");
    assert.strictEqual(result.value.apiSecret, "real-api-secret");
    assert.strictEqual(result.value.accessToken, "real-access-token");
    assert.strictEqual(result.value.accessTokenSecret, "real-access-token-secret");
    assert.strictEqual(result.value.bearerToken, "real-bearer-token");

    restoreEnv();
  });
});
