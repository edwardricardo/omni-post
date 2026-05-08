/**
 * @file mediaUpload.test.ts
 * @description Mutation-killing tests for LinkedIn media upload helpers.
 * Covers uploadAndAttachMedia, uploadDocument, and the internal
 * buildMediaContent logic via integration through uploadAndAttachMedia.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { uploadAndAttachMedia, uploadDocument } from "../src/mediaUpload.js";

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockFetchSuccess(contentType = "image/jpeg", bodySize = 1024) {
  const buffer = new ArrayBuffer(bodySize);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValue(buffer),
    headers: new Map([["content-type", contentType]]),
  });
}

function mockFetchFailure() {
  mockFetch.mockResolvedValueOnce({ ok: false });
}

// ============================================================================
// Mock API Client
// ============================================================================

function createMockApiClient() {
  return {
    initializeImageUpload: vi.fn(async () => ({
      value: {
        uploadUrl: "https://api.linkedin.com/mediaUpload/image-upload-url",
        image: "urn:li:image:img-001",
      },
    })),
    initializeVideoUpload: vi.fn(async (_ownerUrn: string, _fileSize: number) => ({
      value: {
        uploadInstructions: [
          {
            uploadUrl: "https://api.linkedin.com/mediaUpload/video-chunk-1",
            firstByte: 0,
            lastByte: 1023,
          },
        ],
        video: "urn:li:video:vid-001",
      },
    })),
    initializeDocumentUpload: vi.fn(async () => ({
      value: {
        uploadUrl: "https://api.linkedin.com/mediaUpload/doc-upload-url",
        document: "urn:li:document:doc-001",
      },
    })),
    uploadMediaBinary: vi.fn(async () => undefined),
  };
}

// ============================================================================
// uploadAndAttachMedia
// ============================================================================

describe("uploadAndAttachMedia", () => {
  let apiClient: ReturnType<typeof createMockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    apiClient = createMockApiClient();
  });

  // =========================================================================
  // Single image upload
  // =========================================================================

  it("returns media content with image id on single image upload", async () => {
    mockFetchSuccess("image/jpeg");

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/photo.jpg", type: "image" },
    ]);

    assert.ok(result !== null, "Should return content");
    assert.ok(result?.media, "Should have media field");
    assert.equal(result?.media?.id, "urn:li:image:img-001");
  });

  it("includes altText as title when alt is provided for single image", async () => {
    mockFetchSuccess("image/jpeg");

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/photo.jpg", type: "image", alt: "A beautiful photo" },
    ]);

    assert.ok(result?.media, "Should have media field");
    expect(result?.media?.title).toBe("A beautiful photo");
  });

  it("omits title when alt is not provided for single image", async () => {
    mockFetchSuccess("image/jpeg");

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/photo.jpg", type: "image" },
    ]);

    assert.ok(result?.media, "Should have media field");
    expect(Object.prototype.hasOwnProperty.call(result?.media, "title")).toBe(false);
  });

  it("calls initializeImageUpload with ownerUrn", async () => {
    mockFetchSuccess();

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:456", [
      { url: "https://example.com/img.jpg", type: "image" },
    ]);

    expect(apiClient.initializeImageUpload).toHaveBeenCalledWith("urn:li:person:456");
  });

  it("calls uploadMediaBinary with correct upload URL and content type", async () => {
    mockFetchSuccess("image/png");

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/img.png", type: "image" },
    ]);

    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      "https://api.linkedin.com/mediaUpload/image-upload-url",
      expect.any(ArrayBuffer),
      "image/png"
    );
  });

  it("defaults content type to image/jpeg when header is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      headers: new Map(),
    });

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/img", type: "image" },
    ]);

    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      "image/jpeg"
    );
  });

  // =========================================================================
  // Single video upload
  // =========================================================================

  it("returns media content with video urn on single video upload", async () => {
    mockFetchSuccess("video/mp4", 1024);

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/video.mp4", type: "video" },
    ]);

    assert.ok(result !== null);
    assert.ok(result?.media, "Should have media field for video");
    assert.equal(result?.media?.id, "urn:li:video:vid-001");
  });

  it("calls initializeVideoUpload with ownerUrn and file size", async () => {
    const bufferSize = 2048;
    mockFetchSuccess("video/mp4", bufferSize);

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:789", [
      { url: "https://example.com/vid.mp4", type: "video" },
    ]);

    expect(apiClient.initializeVideoUpload).toHaveBeenCalledWith("urn:li:person:789", bufferSize);
  });

  it("uploads video chunks according to upload instructions", async () => {
    mockFetchSuccess("video/mp4", 2048);
    apiClient.initializeVideoUpload.mockResolvedValueOnce({
      value: {
        uploadInstructions: [
          { uploadUrl: "https://chunk1.url", firstByte: 0, lastByte: 999 },
          { uploadUrl: "https://chunk2.url", firstByte: 1000, lastByte: 2047 },
        ],
        video: "urn:li:video:vid-chunked",
      },
    });

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/large-video.mp4", type: "video" },
    ]);

    expect(apiClient.uploadMediaBinary).toHaveBeenCalledTimes(2);
    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      "https://chunk1.url",
      expect.any(ArrayBuffer),
      "video/mp4"
    );
    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      "https://chunk2.url",
      expect.any(ArrayBuffer),
      "video/mp4"
    );
  });

  it("defaults video content type to video/mp4 when header is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      headers: new Map(),
    });

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/vid", type: "video" },
    ]);

    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      "video/mp4"
    );
  });

  // =========================================================================
  // Video takes priority over images
  // =========================================================================

  it("returns video content when both video and images are provided", async () => {
    // Video fetch
    mockFetchSuccess("video/mp4", 1024);
    // Image fetch
    mockFetchSuccess("image/jpeg", 512);

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/video.mp4", type: "video" },
      { url: "https://example.com/photo.jpg", type: "image" },
    ]);

    assert.ok(result !== null);
    assert.ok(result?.media, "Should have media (video priority)");
    assert.equal(result?.media?.id, "urn:li:video:vid-001");
    // Should NOT have multiImage
    assert.equal(result?.multiImage, undefined);
  });

  // =========================================================================
  // Multi-image upload
  // =========================================================================

  it("returns multiImage content for 2+ images", async () => {
    mockFetchSuccess("image/jpeg");
    mockFetchSuccess("image/png");

    apiClient.initializeImageUpload
      .mockResolvedValueOnce({ value: { uploadUrl: "https://up1", image: "urn:li:image:a" } })
      .mockResolvedValueOnce({ value: { uploadUrl: "https://up2", image: "urn:li:image:b" } });

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/1.jpg", type: "image" },
      { url: "https://example.com/2.png", type: "image" },
    ]);

    assert.ok(result !== null);
    assert.ok(result?.multiImage, "Should have multiImage");
    assert.equal(result?.multiImage?.images.length, 2);
    assert.equal(result?.multiImage?.images[0]?.id, "urn:li:image:a");
    assert.equal(result?.multiImage?.images[1]?.id, "urn:li:image:b");
  });

  it("includes altText in multiImage when provided", async () => {
    mockFetchSuccess();
    mockFetchSuccess();

    apiClient.initializeImageUpload
      .mockResolvedValueOnce({ value: { uploadUrl: "https://up1", image: "urn:li:image:a" } })
      .mockResolvedValueOnce({ value: { uploadUrl: "https://up2", image: "urn:li:image:b" } });

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/1.jpg", type: "image", alt: "First" },
      { url: "https://example.com/2.jpg", type: "image" },
    ]);

    assert.ok(result?.multiImage);
    assert.equal(result?.multiImage?.images[0]?.altText, "First");
    expect(
      Object.prototype.hasOwnProperty.call(result?.multiImage?.images[1] || {}, "altText")
    ).toBe(false);
  });

  // =========================================================================
  // GIF treated as image
  // =========================================================================

  it("treats gif type as image upload", async () => {
    mockFetchSuccess("image/gif");

    await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://example.com/anim.gif", type: "gif" },
    ]);

    expect(apiClient.initializeImageUpload).toHaveBeenCalledTimes(1);
    expect(apiClient.initializeVideoUpload).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Fetch failures
  // =========================================================================

  it("returns null when image fetch fails", async () => {
    mockFetchFailure();

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://broken.com/img.jpg", type: "image" },
    ]);

    assert.equal(result, null);
    expect(apiClient.initializeImageUpload).not.toHaveBeenCalled();
  });

  it("returns null when video fetch fails", async () => {
    mockFetchFailure();

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://broken.com/vid.mp4", type: "video" },
    ]);

    assert.equal(result, null);
    expect(apiClient.initializeVideoUpload).not.toHaveBeenCalled();
  });

  it("returns null when no media provided", async () => {
    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", []);

    assert.equal(result, null);
  });

  it("skips failed images and returns remaining", async () => {
    mockFetchFailure(); // First image fails
    mockFetchSuccess("image/jpeg"); // Second succeeds

    apiClient.initializeImageUpload.mockResolvedValueOnce({
      value: { uploadUrl: "https://up", image: "urn:li:image:only" },
    });

    const result = await uploadAndAttachMedia(apiClient as any, "urn:li:person:123", [
      { url: "https://broken.com/1.jpg", type: "image" },
      { url: "https://example.com/2.jpg", type: "image" },
    ]);

    // Only one image succeeded — should return single media, not multiImage
    assert.ok(result !== null);
    assert.ok(result?.media, "Should have single media");
    assert.equal(result?.media?.id, "urn:li:image:only");
  });
});

// ============================================================================
// uploadDocument
// ============================================================================

describe("uploadDocument", () => {
  let apiClient: ReturnType<typeof createMockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    apiClient = createMockApiClient();
  });

  it("returns document URN on success", async () => {
    mockFetchSuccess("application/pdf");

    const result = await uploadDocument(
      apiClient as any,
      "urn:li:person:123",
      "https://example.com/doc.pdf"
    );

    assert.equal(result, "urn:li:document:doc-001");
  });

  it("calls initializeDocumentUpload with ownerUrn", async () => {
    mockFetchSuccess("application/pdf");

    await uploadDocument(
      apiClient as any,
      "urn:li:organization:456",
      "https://example.com/doc.pdf"
    );

    expect(apiClient.initializeDocumentUpload).toHaveBeenCalledWith("urn:li:organization:456");
  });

  it("calls uploadMediaBinary with correct URL and content type", async () => {
    mockFetchSuccess("application/vnd.ms-powerpoint");

    await uploadDocument(apiClient as any, "urn:li:person:123", "https://example.com/slides.ppt");

    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      "https://api.linkedin.com/mediaUpload/doc-upload-url",
      expect.any(ArrayBuffer),
      "application/vnd.ms-powerpoint"
    );
  });

  it("defaults content type to application/pdf when header is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      headers: new Map(),
    });

    await uploadDocument(apiClient as any, "urn:li:person:123", "https://example.com/doc");

    expect(apiClient.uploadMediaBinary).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      "application/pdf"
    );
  });

  it("returns undefined when fetch fails", async () => {
    mockFetchFailure();

    const result = await uploadDocument(
      apiClient as any,
      "urn:li:person:123",
      "https://broken.com/doc.pdf"
    );

    assert.equal(result, undefined);
    expect(apiClient.initializeDocumentUpload).not.toHaveBeenCalled();
  });
});
