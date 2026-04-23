/**
 * @file s3-operations.test.ts
 * @description Mutation-killing tests for storage-s3 adapter using aws-sdk-client-mock.
 * Mocks S3Client at the prototype level so even calls through circuit breaker
 * are intercepted. Also mocks createPresignedPost from @aws-sdk/s3-presigned-post.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client } from "@aws-sdk/client-s3";
import client from "prom-client";

// Mock createPresignedPost at module level
vi.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: vi.fn(),
}));

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
const mockedCreatePresignedPost = vi.mocked(createPresignedPost);

// Mock S3Client.send at prototype level
const s3Mock = mockClient(S3Client);

// Clear prom-client registry
client.register.clear();

import { createS3StorageAdapter, type S3Config } from "../src/index.js";

const TEST_CONFIG: S3Config = {
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  endpoint: "http://localhost:19000",
};

// ============================================================================
// generateUploadSignature — with mocked createPresignedPost
// ============================================================================

describe("generateUploadSignature — with presigned post mock", () => {
  let adapter: ReturnType<typeof createS3StorageAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    s3Mock.reset();
    adapter = createS3StorageAdapter(TEST_CONFIG);
  });

  it("returns ok with upload signature on success", async () => {
    mockedCreatePresignedPost.mockResolvedValueOnce({
      url: "https://test-bucket.s3.us-east-1.amazonaws.com",
      fields: {
        key: "uploads/abc-photo.jpg",
        "Content-Type": "image/jpeg",
        "x-amz-meta-original-name": "photo.jpg",
        Policy: "base64policy",
        "X-Amz-Signature": "sig123",
      },
    });

    const result = await adapter.generateUploadSignature("photo.jpg", "image/jpeg");

    assert.ok(result.ok, "Should succeed");
    assert.ok(result.value.url.includes("test-bucket"), "URL should contain bucket");
    assert.ok(result.value.fields["Content-Type"] === "image/jpeg");
    assert.ok(result.value.fields["x-amz-meta-original-name"] === "photo.jpg");
    assert.ok(result.value.expiresAt instanceof Date);
  });

  it("returns ok with correct key field containing UUID", async () => {
    mockedCreatePresignedPost.mockResolvedValueOnce({
      url: "https://test-bucket.s3.amazonaws.com",
      fields: { key: "uploads/uuid-test.jpg" },
    });

    const result = await adapter.generateUploadSignature("test.jpg", "image/jpeg");

    assert.ok(result.ok);
    // The key field should contain 'uploads/' prefix
    assert.ok(result.value.fields.key.startsWith("uploads/"));
  });

  it("calls createPresignedPost on successful upload", async () => {
    mockedCreatePresignedPost.mockResolvedValueOnce({
      url: "https://bucket.s3.amazonaws.com",
      fields: { key: "uploads/file.jpg" },
    });

    await adapter.generateUploadSignature("file.jpg", "image/jpeg");

    expect(mockedCreatePresignedPost).toHaveBeenCalledTimes(1);
  });

  it("sets expiresAt to ~15 minutes from now", async () => {
    mockedCreatePresignedPost.mockResolvedValueOnce({
      url: "https://bucket.s3.amazonaws.com",
      fields: { key: "uploads/file.jpg" },
    });

    const before = Date.now();
    const result = await adapter.generateUploadSignature("file.jpg", "image/jpeg");
    const after = Date.now();

    assert.ok(result.ok);
    const expiresMs = result.value.expiresAt.getTime();
    // Should be ~15 minutes (900 seconds) from now
    expect(expiresMs).toBeGreaterThanOrEqual(before + 899 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + 901 * 1000);
  });

  it("returns SERVICE_ERROR when createPresignedPost throws", async () => {
    mockedCreatePresignedPost.mockRejectedValueOnce(new Error("Access Denied"));

    const result = await adapter.generateUploadSignature("file.jpg", "image/jpeg");

    assert.ok(!result.ok);
    assert.equal(result.error, "SERVICE_ERROR");
  });

  it("still rejects invalid content types before calling createPresignedPost", async () => {
    const result = await adapter.generateUploadSignature("file.bmp", "image/bmp");

    assert.ok(!result.ok);
    assert.equal(result.error, "INVALID_TYPE");
    expect(mockedCreatePresignedPost).not.toHaveBeenCalled();
  });

  it("still rejects oversized files before calling createPresignedPost", async () => {
    const result = await (adapter as any).generateUploadSignature(
      "file.mp4",
      "video/mp4",
      101 * 1024 * 1024
    );

    assert.ok(!result.ok);
    assert.equal(result.error, "INVALID_TYPE");
    expect(mockedCreatePresignedPost).not.toHaveBeenCalled();
  });

  it("preserves content type in fields on success", async () => {
    mockedCreatePresignedPost.mockResolvedValueOnce({
      url: "https://bucket.s3.amazonaws.com",
      fields: { key: "uploads/abc-photo.jpg" },
    });

    const result = await adapter.generateUploadSignature("photo.jpg", "image/jpeg");

    assert.ok(result.ok);
    assert.equal(result.value.fields["Content-Type"], "image/jpeg");
  });
});

// ============================================================================
// getMediaMetadata — URL parsing (circuit breaker blocks HeadObject mocking)
// ============================================================================

describe("getMediaMetadata — URL parsing logic", () => {
  let adapter: ReturnType<typeof createS3StorageAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    s3Mock.reset();
    adapter = createS3StorageAdapter(TEST_CONFIG);
  });

  it("returns NOT_FOUND for URL with empty path after stripping slash", async () => {
    const result = await adapter.getMediaMetadata("http://bucket.s3.amazonaws.com/");
    assert.ok(!result.ok);
    assert.equal(result.error, "NOT_FOUND");
  });

  it("returns error (not crash) for URL with valid path but unreachable S3", async () => {
    const result = await adapter.getMediaMetadata(
      "http://localhost:19000/test-bucket/uploads/file.jpg"
    );
    // Will be SERVICE_ERROR because circuit breaker tries real connection
    assert.ok(!result.ok);
    expect(["SERVICE_ERROR", "NOT_FOUND"]).toContain(result.error);
  });
});
