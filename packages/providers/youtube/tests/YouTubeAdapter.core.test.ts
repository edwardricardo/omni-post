/**
 * YouTubeAdapter - Core Functionality Tests
 *
 * Validates the YouTube Adapter's core properties and methods:
 * 1. Metadata - id, displayName, authType, status, scopes, color, icon
 * 2. Limits - maxChars, allowedMedia, maxMediaPerPost, threadingSupported
 * 3. Capabilities - publish, schedule, analytics, comments, replies, threading
 * 4. Constraints - empty object (no restrictions)
 * 5. render() - Canonical post to YouTube format transformation
 * 6. validateCredentials() - Credential structure validation and API test
 * 7. getCredentialsFromEnvironment() - Environment variable reading
 *
 * Framework: node:test + node:assert/strict
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { YouTubeAdapter } from "../src/YouTubeAdapter.js";
import type { CanonicalPost } from "@shared/types";
import { createMockApiClient } from "./YouTubeAdapter.test-helpers.js";

// ============================================================================
// Helper: Create a minimal CanonicalPost for render() tests
// ============================================================================

function createCanonicalPost(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: "post-1",
    projectId: "project-1",
    locale: "en",
    body: "My Video Title\nThis is the video description.",
    media: [
      {
        id: "media-1",
        type: "video",
        url: "https://example.com/video.mp4",
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Metadata Tests
// ============================================================================

describe("YouTubeAdapter - Metadata", { concurrency: 1 }, () => {
  let adapter: YouTubeAdapter;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });

  it("should have id equal to 'youtube'", () => {
    assert.strictEqual(adapter.id, "youtube");
  });

  it("should have correct metadata fields", () => {
    assert.strictEqual(adapter.metadata.displayName, "YouTube");
    assert.strictEqual(adapter.metadata.authType, "oauth");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.color, "#FF0000");
    assert.strictEqual(adapter.metadata.website, "https://youtube.com");
    assert.strictEqual(adapter.metadata.icon, "/providers/youtube-icon.svg");
    assert.strictEqual(adapter.metadata.name, "youtube");
    assert.strictEqual(adapter.metadata.id, "youtube");
    assert.strictEqual(
      adapter.metadata.description,
      "Upload videos, shorts and community posts to YouTube"
    );
  });

  it("should require oauth scopes for youtube.upload and youtube.readonly", () => {
    assert.ok(Array.isArray(adapter.metadata.requiredScopes));
    assert.deepStrictEqual(adapter.metadata.requiredScopes, ["youtube.upload", "youtube.readonly"]);
  });

  it("should have correct limits", () => {
    assert.strictEqual(adapter.limits.maxChars, 5000);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["video"]);
    assert.strictEqual(adapter.limits.maxMediaPerPost, 1);
    assert.strictEqual(adapter.limits.threadingSupported, false);
    assert.deepStrictEqual(adapter.limits.aspectRatios, ["16:9", "9:16", "1:1"]);
    assert.deepStrictEqual(adapter.limits.rateLimitHints, {
      burst: 100,
      perSeconds: 3600,
    });
  });

  it("should have correct capabilities", () => {
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, true);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.comments, true);
    assert.strictEqual(adapter.capabilities.replies, false);
    assert.strictEqual(adapter.capabilities.threading, false);
  });

  it("should have empty constraints object", () => {
    assert.deepStrictEqual(adapter.constraints, {});
  });

  it("should require clientId, clientSecret, refreshToken, channelId credentials", () => {
    const fields = (adapter as any).requiredCredentialFields;
    assert.ok(Array.isArray(fields));
    assert.strictEqual(fields.length, 4);
    assert.ok(fields.includes("clientId"));
    assert.ok(fields.includes("clientSecret"));
    assert.ok(fields.includes("refreshToken"));
    assert.ok(fields.includes("channelId"));
  });
});

// ============================================================================
// render() Tests
// ============================================================================

describe("YouTubeAdapter - render()", { concurrency: 1 }, () => {
  let adapter: YouTubeAdapter;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });

  it("should render video with description and title extracted from first line", () => {
    const post = createCanonicalPost({
      body: "My Amazing Video\nThis is a great description for the video.",
      media: [{ id: "v1", type: "video", url: "https://example.com/amazing.mp4" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as any;
    assert.strictEqual(content.title, "My Amazing Video");
    assert.strictEqual(
      content.description,
      "My Amazing Video\nThis is a great description for the video."
    );
    assert.strictEqual(content.body, content.description);
    assert.strictEqual(content.videoUrl, "https://example.com/amazing.mp4");
  });

  it("should use 'Untitled Video' when body has empty first line", () => {
    const post = createCanonicalPost({
      body: "",
      media: [{ id: "v1", type: "video", url: "https://example.com/video.mp4" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "render should succeed");
    const content = result.value.content as any;
    assert.strictEqual(content.title, "Untitled Video");
  });

  it("should return CONTENT_TOO_LONG for description exceeding 5000 chars", () => {
    const longBody = "x".repeat(5001);
    const post = createCanonicalPost({
      body: longBody,
      media: [{ id: "v1", type: "video", url: "https://example.com/video.mp4" }],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "CONTENT_TOO_LONG");
    }
  });

  it("should succeed when body is exactly 5000 chars", () => {
    const exactBody = "x".repeat(5000);
    const post = createCanonicalPost({
      body: exactBody,
      media: [{ id: "v1", type: "video", url: "https://example.com/video.mp4" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "render should succeed for exactly 5000 chars");
    const content = result.value.content as any;
    assert.strictEqual(content.description.length, 5000);
  });

  it("should return VALIDATION_ERROR when no media provided", () => {
    const post = createCanonicalPost({
      media: [],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("should return VALIDATION_ERROR when media is undefined", () => {
    const post = createCanonicalPost();
    // Force media to undefined
    delete (post as any).media;

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("should return VALIDATION_ERROR when more than 1 media item", () => {
    const post = createCanonicalPost({
      media: [
        { id: "v1", type: "video", url: "https://example.com/video1.mp4" },
        { id: "v2", type: "video", url: "https://example.com/video2.mp4" },
      ],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("should return UNSUPPORTED_MEDIA for non-video media (image)", () => {
    const post = createCanonicalPost({
      media: [{ id: "img1", type: "image", url: "https://example.com/photo.jpg" }],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "UNSUPPORTED_MEDIA");
    }
  });

  it("should include videoUrl from media", () => {
    const videoUrl = "https://cdn.example.com/uploads/final-video.mp4";
    const post = createCanonicalPost({
      media: [{ id: "v1", type: "video", url: videoUrl }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    const content = result.value.content as any;
    assert.strictEqual(content.videoUrl, videoUrl);
  });

  it("should pass through media array in content", () => {
    const media = [{ id: "v1", type: "video" as const, url: "https://example.com/video.mp4" }];
    const post = createCanonicalPost({ media });

    const result = adapter.render(post);

    assert.ok(result.ok);
    const content = result.value.content as any;
    assert.ok(Array.isArray(content.media));
    assert.strictEqual(content.media.length, 1);
    assert.strictEqual(content.media[0].url, "https://example.com/video.mp4");
    assert.strictEqual(content.media[0].type, "video");
  });
});

// ============================================================================
// validateCredentials() Tests
// ============================================================================

describe("YouTubeAdapter - validateCredentials()", { concurrency: 1 }, () => {
  let adapter: YouTubeAdapter;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });

  it("should reject missing required fields (empty object)", async () => {
    const result = await adapter.validateCredentials({});

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("should reject partial credentials (missing channelId)", async () => {
    const result = await adapter.validateCredentials({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "test-refresh-token",
      // channelId is missing
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("should succeed with valid credentials and mock API client", async () => {
    const mockApiClient = createMockApiClient();

    // Mock createApiClient to return our mock
    mock.method(adapter as any, "createApiClient", () => mockApiClient);

    const result = await adapter.validateCredentials({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "test-refresh-token",
      channelId: "test-channel-id",
    });

    assert.ok(result.ok, "validateCredentials should succeed");
    assert.strictEqual(mockApiClient.validateCredentials.mock.callCount(), 1);
  });

  it("should return AUTH_INVALID on API error", async () => {
    const mockApiClient = createMockApiClient();
    mockApiClient.validateCredentials = mock.fn(async () => {
      throw new Error("API validation failed");
    });

    mock.method(adapter as any, "createApiClient", () => mockApiClient);

    const result = await adapter.validateCredentials({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "test-refresh-token",
      channelId: "test-channel-id",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("should return AUTH_EXPIRED on 401 error", async () => {
    const mockApiClient = createMockApiClient();
    mockApiClient.validateCredentials = mock.fn(async () => {
      const error = new Error("Unauthorized") as Error & { status: number };
      error.status = 401;
      throw error;
    });

    mock.method(adapter as any, "createApiClient", () => mockApiClient);

    const result = await adapter.validateCredentials({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "test-refresh-token",
      channelId: "test-channel-id",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_EXPIRED");
    }
  });
});

// ============================================================================
// getCredentialsFromEnvironment() Tests
// ============================================================================

describe("YouTubeAdapter - getCredentialsFromEnvironment()", { concurrency: 1 }, () => {
  let adapter: YouTubeAdapter;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
    savedEnv = { ...process.env };
    // Clear YouTube env vars
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
    delete process.env.YOUTUBE_REFRESH_TOKEN;
    delete process.env.YOUTUBE_CHANNEL_ID;
    delete process.env.YOUTUBE_ACCESS_TOKEN;
  });

  afterEach(() => {
    // Restore original env
    process.env = savedEnv;
  });

  it("should return err when env vars are not set", () => {
    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("should return err when clientId is placeholder", () => {
    process.env.YOUTUBE_CLIENT_ID = "placeholder";
    process.env.YOUTUBE_CLIENT_SECRET = "real-secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "real-refresh";
    process.env.YOUTUBE_CHANNEL_ID = "real-channel";

    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("should return err when refreshToken is placeholder", () => {
    process.env.YOUTUBE_CLIENT_ID = "real-client-id";
    process.env.YOUTUBE_CLIENT_SECRET = "real-secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "placeholder";
    process.env.YOUTUBE_CHANNEL_ID = "real-channel";

    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("should return ok when all env vars are set with real values", () => {
    process.env.YOUTUBE_CLIENT_ID = "real-client-id";
    process.env.YOUTUBE_CLIENT_SECRET = "real-secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "real-refresh-token";
    process.env.YOUTUBE_CHANNEL_ID = "UC_channel_123";

    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.ok(result.ok, "Should succeed when all env vars are real");
    assert.strictEqual(result.value.clientId, "real-client-id");
    assert.strictEqual(result.value.clientSecret, "real-secret");
    assert.strictEqual(result.value.refreshToken, "real-refresh-token");
    assert.strictEqual(result.value.channelId, "UC_channel_123");
    // accessToken should NOT be present when YOUTUBE_ACCESS_TOKEN is unset
    assert.strictEqual(result.value.accessToken, undefined);
  });

  it("should include optional accessToken when set", () => {
    process.env.YOUTUBE_CLIENT_ID = "real-client-id";
    process.env.YOUTUBE_CLIENT_SECRET = "real-secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "real-refresh-token";
    process.env.YOUTUBE_CHANNEL_ID = "UC_channel_123";
    process.env.YOUTUBE_ACCESS_TOKEN = "ya29.access-token-value";

    const result = (adapter as any).getCredentialsFromEnvironment();

    assert.ok(result.ok, "Should succeed with access token");
    assert.strictEqual(result.value.accessToken, "ya29.access-token-value");
  });
});
