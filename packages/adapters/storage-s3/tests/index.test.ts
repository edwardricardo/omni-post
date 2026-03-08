/**
 * S3 Storage Adapter tests
 *
 * Tier 0: no AWS services needed.
 * Tests the factory function, exported types, content-type validation,
 * file size validation, and error handling. The adapter is created with
 * a config pointing to a non-existent endpoint; calls that would reach
 * AWS return SERVICE_ERROR which we validate as correct error handling.
 *
 * The circuit breaker is initialized at module level via
 * createExternalApiCircuitBreaker(). This is harmless because it only
 * creates an opossum instance + prom-client counters -- no network.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import client from "prom-client";
import { createS3StorageAdapter, type S3Config } from "../src/index.js";

before(() => {
  client.register.clear();
});

after(() => {
  client.register.clear();
});

const TEST_CONFIG: S3Config = {
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "test-key-id",
  secretAccessKey: "test-secret-key",
  endpoint: "http://localhost:19000", // Non-existent — ensures no real AWS calls
};

const MINIMAL_CONFIG: S3Config = {
  region: "eu-west-1",
  bucket: "minimal-bucket",
};

/* ──────────────────────────────────────────────────────────────────────
 * 1. Factory — createS3StorageAdapter
 * ────────────────────────────────────────────────────────────────────── */
describe("createS3StorageAdapter — factory", { concurrency: 1 }, () => {
  it("creates an adapter instance with full config", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    assert.ok(adapter, "adapter should be truthy");
    assert.strictEqual(typeof adapter.generateUploadSignature, "function");
    assert.strictEqual(typeof adapter.getMediaMetadata, "function");
  });

  it("creates an adapter instance with minimal config (no credentials)", () => {
    const adapter = createS3StorageAdapter(MINIMAL_CONFIG);
    assert.ok(adapter, "adapter should be truthy");
    assert.strictEqual(typeof adapter.generateUploadSignature, "function");
  });

  it("exposes getSignedUploadUrl compatibility method", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getSignedUploadUrl, "function");
  });

  it("exposes getMetadata compatibility method", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getMetadata, "function");
  });

  it("exposes getCircuitBreakerStatus method", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getCircuitBreakerStatus, "function");
  });

  it("exposes getMetricsRegistry method", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getMetricsRegistry, "function");
  });

  it("getCircuitBreakerStatus returns an object", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    const status = adapter.getCircuitBreakerStatus();
    assert.strictEqual(typeof status, "object");
    assert.ok(status !== null, "status should not be null");
  });

  it("getMetricsRegistry returns a prom-client Registry", () => {
    const adapter = createS3StorageAdapter(TEST_CONFIG);
    const reg = adapter.getMetricsRegistry();
    assert.ok(reg instanceof client.Registry, "should be a prom-client Registry");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 2. Content type validation
 * ────────────────────────────────────────────────────────────────────── */
describe("createS3StorageAdapter — content type validation", { concurrency: 1 }, () => {
  const adapter = createS3StorageAdapter(TEST_CONFIG);

  const ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ];

  for (const contentType of ALLOWED_TYPES) {
    it(`accepts allowed content type: ${contentType}`, async () => {
      // This will attempt to create a presigned URL via the circuit breaker.
      // It will fail with SERVICE_ERROR since there is no real S3, but
      // critically it should NOT return INVALID_TYPE.
      const result = await adapter.generateUploadSignature("test-file.jpg", contentType);

      // The result is either ok (unlikely without real S3) or
      // SERVICE_ERROR (expected). Either way, NOT INVALID_TYPE.
      if (!result.ok) {
        assert.strictEqual(
          result.error,
          "SERVICE_ERROR",
          `${contentType} should not be rejected as INVALID_TYPE`
        );
      }
    });
  }

  const REJECTED_TYPES = [
    "application/pdf",
    "text/plain",
    "application/json",
    "audio/mp3",
    "image/svg+xml",
    "video/avi",
  ];

  for (const contentType of REJECTED_TYPES) {
    it(`rejects disallowed content type: ${contentType}`, async () => {
      const result = await adapter.generateUploadSignature("test-file.dat", contentType);

      assert.strictEqual(result.ok, false, "should be an error");
      if (!result.ok) {
        assert.strictEqual(result.error, "INVALID_TYPE");
      }
    });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * 3. File size validation
 * ────────────────────────────────────────────────────────────────────── */
describe("createS3StorageAdapter — file size validation", { concurrency: 1 }, () => {
  // Cast to any to access the 3-arg overload of generateUploadSignature
  // that accepts sizeBytes. The StoragePort interface only exposes 2 args,
  // but the S3 implementation accepts an optional third parameter.
  const adapter = createS3StorageAdapter(TEST_CONFIG) as any;

  it("rejects files exceeding 100MB", async () => {
    const oversizeBytes = 101 * 1024 * 1024; // 101 MB
    const result = await adapter.generateUploadSignature(
      "huge-video.mp4",
      "video/mp4",
      oversizeBytes
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "INVALID_TYPE");
    }
  });

  it("accepts files at exactly 100MB", async () => {
    const exactMaxBytes = 100 * 1024 * 1024;
    const result = await adapter.generateUploadSignature(
      "max-video.mp4",
      "video/mp4",
      exactMaxBytes
    );

    // Should NOT be INVALID_TYPE; will be SERVICE_ERROR because no real S3
    if (!result.ok) {
      assert.strictEqual(
        result.error,
        "SERVICE_ERROR",
        "100MB file should not be rejected as INVALID_TYPE"
      );
    }
  });

  it("accepts files under 100MB", async () => {
    const smallBytes = 5 * 1024 * 1024; // 5 MB
    const result = await adapter.generateUploadSignature(
      "small-image.jpg",
      "image/jpeg",
      smallBytes
    );

    if (!result.ok) {
      assert.strictEqual(
        result.error,
        "SERVICE_ERROR",
        "small file should not be rejected as INVALID_TYPE"
      );
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 4. getMediaMetadata — URL parsing & validation
 * ────────────────────────────────────────────────────────────────────── */
describe("createS3StorageAdapter — getMediaMetadata", { concurrency: 1 }, () => {
  const adapter = createS3StorageAdapter(TEST_CONFIG);

  it("returns NOT_FOUND for URL with empty path", async () => {
    // A URL like "http://bucket.s3.amazonaws.com/" has empty key
    const result = await adapter.getMediaMetadata("http://bucket.s3.amazonaws.com/");
    // Empty key after stripping leading "/" is ""
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND");
    }
  });

  it("returns SERVICE_ERROR for valid URL with unreachable S3", async () => {
    const result = await adapter.getMediaMetadata(
      "http://localhost:19000/test-bucket/uploads/test-file.jpg"
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "SERVICE_ERROR");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 5. API compatibility methods
 * ────────────────────────────────────────────────────────────────────── */
describe("createS3StorageAdapter — API compatibility", { concurrency: 1 }, () => {
  const adapter = createS3StorageAdapter(TEST_CONFIG);

  it("getSignedUploadUrl delegates to generateUploadSignature", async () => {
    // Rejected type should return INVALID_TYPE through both paths
    const result = await adapter.getSignedUploadUrl({
      path: "test.pdf",
      contentType: "application/pdf",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "INVALID_TYPE");
    }
  });

  it("getMetadata delegates to getMediaMetadata", async () => {
    const result = await adapter.getMetadata({
      url: "http://bucket.s3.amazonaws.com/",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND");
    }
  });
});
