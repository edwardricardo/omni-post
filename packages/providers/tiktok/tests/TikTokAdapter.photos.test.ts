/**
 * @file TikTokAdapter.photos.test.ts
 * @description Unit tests for TikTok photo post (carousel) rendering and publishing.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { TikTokAdapter } from "../src/TikTokAdapter.js";
import { createMockApiClient, MOCK_CREDENTIALS } from "./TikTokAdapter.test-helpers.js";

// ============================================================================
// 1. Render Tests — Photo Posts
// ============================================================================

describe("TikTokAdapter - render photo posts", { concurrent: false }, () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TikTokAdapter();
  });

  it("renders a single-image post", () => {
    const result = adapter.render({
      body: "Check out this photo",
      media: [{ type: "image", url: "https://example.com/photo.jpg" }],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.content.body, "Check out this photo");
    assert.strictEqual(result.value.meta?.contentType, "photo");
    assert.strictEqual(result.value.content.media?.length, 1);
  });

  it("renders a multi-image carousel post", () => {
    const result = adapter.render({
      body: "Photo carousel",
      media: [
        { type: "image", url: "https://example.com/photo1.jpg" },
        { type: "image", url: "https://example.com/photo2.jpg" },
        { type: "image", url: "https://example.com/photo3.jpg" },
      ],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.content.media?.length, 3);
    assert.strictEqual(result.value.meta?.contentType, "photo");
  });

  it("rejects mixed media (image + video)", () => {
    const result = adapter.render({
      body: "Mixed media",
      media: [
        { type: "image", url: "https://example.com/photo.jpg" },
        { type: "video", url: "https://example.com/video.mp4" },
      ],
    });

    assert.ok(!result.ok);
  });

  it("rejects more than 35 images", () => {
    const media = Array.from({ length: 36 }, (_, i) => ({
      type: "image" as const,
      url: `https://example.com/photo${i}.jpg`,
    }));

    const result = adapter.render({
      body: "Too many photos",
      media,
    });

    assert.ok(!result.ok);
  });

  it("still renders video posts correctly", () => {
    const result = adapter.render({
      body: "Video post",
      media: [{ type: "video", url: "https://example.com/video.mp4" }],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.meta?.contentType, undefined);
  });
});

// ============================================================================
// 2. Publish Tests — Photo Posts
// ============================================================================

describe("TikTokAdapter - publish photo posts", { concurrent: false }, () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TikTokAdapter();
  });

  it("publishes a photo post via publishPhotoPost API", async () => {
    const mockClient = {
      ...createMockApiClient(),
      publishPhotoPost: vi.fn(async () => ({
        shareId: "photo-post-001",
        shareUrl: "https://www.tiktok.com/@user/photo/photo-post-001",
        uniqueId: "photo-post-001",
      })),
    };

    const getCredsSpy = vi
      .spyOn(adapter as any, "getCredentials")
      .mockResolvedValue({ ok: true, value: MOCK_CREDENTIALS });
    const createClientSpy = vi.spyOn(adapter as any, "createApiClient").mockReturnValue(mockClient);

    const result = await adapter.publish({
      channelId: "channel-123",
      post: {
        body: "My photo carousel",
        media: [
          { type: "image", url: "https://example.com/photo1.jpg" },
          { type: "image", url: "https://example.com/photo2.jpg" },
        ],
        meta: { contentType: "photo" },
      },
      dedupeKey: "test-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerPostId, "photo-post-001");

    const call = mockClient.publishPhotoPost.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0].imageUrls.length, 2);
    assert.strictEqual(call[0].privacy, "PUBLIC_TO_EVERYONE");

    getCredsSpy.mockRestore();
    createClientSpy.mockRestore();
  });

  it("detects photo post from media types when no contentType meta", async () => {
    const mockClient = {
      ...createMockApiClient(),
      publishPhotoPost: vi.fn(async () => ({
        shareId: "photo-post-002",
        shareUrl: "",
        uniqueId: "photo-post-002",
      })),
    };

    const getCredsSpy = vi
      .spyOn(adapter as any, "getCredentials")
      .mockResolvedValue({ ok: true, value: MOCK_CREDENTIALS });
    const createClientSpy = vi.spyOn(adapter as any, "createApiClient").mockReturnValue(mockClient);

    const result = await adapter.publish({
      channelId: "channel-123",
      post: {
        body: "Auto-detected photo post",
        media: [{ type: "image", url: "https://example.com/photo1.jpg" }],
        meta: {},
      },
      dedupeKey: "test-002",
    });

    assert.ok(result.ok);
    assert.strictEqual(mockClient.publishPhotoPost.mock.calls.length, 1);

    getCredsSpy.mockRestore();
    createClientSpy.mockRestore();
  });

  it("uses SELF_ONLY privacy for private photo posts", async () => {
    const mockClient = {
      ...createMockApiClient(),
      publishPhotoPost: vi.fn(async () => ({
        shareId: "photo-post-003",
        shareUrl: "",
        uniqueId: "photo-post-003",
      })),
    };

    const getCredsSpy = vi
      .spyOn(adapter as any, "getCredentials")
      .mockResolvedValue({ ok: true, value: MOCK_CREDENTIALS });
    const createClientSpy = vi.spyOn(adapter as any, "createApiClient").mockReturnValue(mockClient);

    const result = await adapter.publish({
      channelId: "channel-123",
      post: {
        body: "Private photo",
        media: [{ type: "image", url: "https://example.com/photo1.jpg" }],
        meta: { contentType: "photo", privacy: "private" },
      },
      dedupeKey: "test-003",
    });

    assert.ok(result.ok);
    const call = mockClient.publishPhotoPost.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0].privacy, "SELF_ONLY");

    getCredsSpy.mockRestore();
    createClientSpy.mockRestore();
  });
});

// ============================================================================
// 3. Capabilities
// ============================================================================

describe("TikTokAdapter - capabilities with photos", { concurrent: false }, () => {
  it("allows image media", () => {
    const adapter = new TikTokAdapter();
    assert.ok(adapter.limits.allowedMedia?.includes("image"));
    assert.ok(adapter.limits.allowedMedia?.includes("video"));
  });

  it("allows up to 35 media per post", () => {
    const adapter = new TikTokAdapter();
    assert.strictEqual(adapter.limits.maxMediaPerPost, 35);
  });
});
