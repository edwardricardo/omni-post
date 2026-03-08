/**
 * Cloudinary Storage Adapter tests
 *
 * Tier 0: no Cloudinary services needed.
 * Tests the factory function, exported types, content-type validation,
 * file size validation, upload signature generation, and error handling.
 *
 * The circuit breaker is initialized at module level via
 * createExternalApiCircuitBreaker(). This is harmless because it only
 * creates an opossum instance + prom-client counters -- no network.
 *
 * IMPORTANT: The module-level circuit breaker is a singleton that
 * caches breaker instances by "service:operation" key. Once a breaker
 * is created for "cloudinary-storage:generate-upload-signature", ALL
 * subsequent calls with that key reuse the FIRST closure's behavior.
 * Tests that verify URL construction or resource-type routing must
 * use the FIRST call to a fresh operation key or a fresh adapter
 * (but the CB is global, so the first-call constraint applies).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import client from "prom-client";
import { createCloudinaryStorageAdapter, type CloudinaryConfig } from "../src/index.js";

before(() => {
  client.register.clear();
});

after(() => {
  client.register.clear();
});

const TEST_CONFIG: CloudinaryConfig = {
  cloudName: "test-cloud",
  apiKey: "test-api-key-123",
  apiSecret: "test-api-secret-456",
  folder: "test-uploads",
};

const MINIMAL_CONFIG: CloudinaryConfig = {
  cloudName: "minimal-cloud",
  apiKey: "key",
  apiSecret: "secret",
};

/* ──────────────────────────────────────────────────────────────────────
 * 1. Factory -- createCloudinaryStorageAdapter
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- factory", { concurrency: 1 }, () => {
  it("creates an adapter instance with full config", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    assert.ok(adapter, "adapter should be truthy");
    assert.strictEqual(typeof adapter.generateUploadSignature, "function");
    assert.strictEqual(typeof adapter.getMediaMetadata, "function");
  });

  it("creates an adapter instance with minimal config (no folder)", () => {
    const adapter = createCloudinaryStorageAdapter(MINIMAL_CONFIG);
    assert.ok(adapter, "adapter should be truthy");
    assert.strictEqual(typeof adapter.generateUploadSignature, "function");
  });

  it("exposes getSignedUploadUrl compatibility method", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getSignedUploadUrl, "function");
  });

  it("exposes getMetadata compatibility method", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getMetadata, "function");
  });

  it("exposes getCircuitBreakerStatus method", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getCircuitBreakerStatus, "function");
  });

  it("exposes getMetricsRegistry method", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    assert.strictEqual(typeof adapter.getMetricsRegistry, "function");
  });

  it("getCircuitBreakerStatus returns an object", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    const status = adapter.getCircuitBreakerStatus();
    assert.strictEqual(typeof status, "object");
    assert.ok(status !== null, "status should not be null");
  });

  it("getMetricsRegistry returns a prom-client Registry", () => {
    const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);
    const reg = adapter.getMetricsRegistry();
    assert.ok(reg instanceof client.Registry, "should be a prom-client Registry");
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 2. Content type validation
 *
 * These tests exercise the validation gate BEFORE the circuit breaker
 * is invoked, so they are not affected by breaker caching.
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- content type validation", { concurrency: 1 }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

  const ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/mov",
  ];

  for (const contentType of ALLOWED_TYPES) {
    it(`accepts allowed content type: ${contentType}`, async () => {
      const result = await adapter.generateUploadSignature("test-file.jpg", contentType);

      // Allowed types pass the validation gate.
      // They either succeed (local HMAC computation) or fail with
      // SERVICE_ERROR from the circuit breaker -- never INVALID_TYPE.
      if (result.ok) {
        assert.ok(result.value.url, "should have upload URL");
        assert.ok(result.value.fields, "should have fields");
        assert.ok(result.value.expiresAt instanceof Date, "should have expiresAt Date");
      } else {
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
    "application/octet-stream",
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
describe("createCloudinaryStorageAdapter -- file size validation", { concurrency: 1 }, () => {
  // Cast to any to access the 3-arg overload of generateUploadSignature
  // that accepts sizeBytes. The StoragePort interface only exposes 2 args,
  // but the Cloudinary implementation accepts an optional third parameter.
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG) as any;

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

    // Should NOT be INVALID_TYPE
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

    // Should succeed or be SERVICE_ERROR, never INVALID_TYPE
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
 * 4. Upload signature generation (local computation)
 *
 * Cloudinary signature generation uses cloudinary.utils.api_sign_request
 * which is a local HMAC computation -- no network needed.
 *
 * NOTE: The module-level circuit breaker caches the first breaker
 * function for "cloudinary-storage:generate-upload-signature". All
 * tests in this describe block observe the result of the FIRST
 * closure registered via the first call.
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- upload signature", { concurrency: 1 }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

  it("generates a signed upload URL for image/jpeg", async () => {
    const result = await adapter.generateUploadSignature("photo.jpg", "image/jpeg");

    if (result.ok) {
      const { url, fields, expiresAt } = result.value;

      // URL should point to Cloudinary upload endpoint
      assert.ok(
        url.includes("api.cloudinary.com/v1_1/"),
        "URL should target Cloudinary upload endpoint"
      );
      assert.ok(url.includes("/upload"), "URL should contain /upload path");

      // Fields should contain signature and api_key
      assert.ok(fields.signature, "should have a signature field");
      assert.ok(fields.api_key, "should have an api_key field");

      // Fields should contain public_id (UUID-based)
      assert.ok(fields.public_id, "should have a public_id field");

      // public_id should contain a UUID pattern
      const publicId = String(fields.public_id);
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
      assert.ok(uuidPattern.test(publicId), "public_id should contain a UUID");

      // expiresAt should be in the future
      assert.ok(expiresAt > new Date(), "expiresAt should be in the future");
    } else {
      assert.fail(`Expected ok result but got error: ${result.error}`);
    }
  });

  it("includes timestamp in upload parameters", async () => {
    const result = await adapter.generateUploadSignature("b.jpg", "image/jpeg");

    if (result.ok) {
      const timestamp = result.value.fields.timestamp;
      assert.ok(timestamp, "should include timestamp field");
      const ts = Number(timestamp);
      assert.ok(!isNaN(ts), "timestamp should be numeric");
      // Timestamp should be close to current time (within 10 seconds)
      const now = Math.round(Date.now() / 1000);
      assert.ok(Math.abs(ts - now) < 10, "timestamp should be close to current time");
    } else {
      assert.fail(`Expected ok result but got error: ${result.error}`);
    }
  });

  it("includes resource_type field in upload parameters", async () => {
    const result = await adapter.generateUploadSignature("c.jpg", "image/jpeg");

    if (result.ok) {
      assert.ok(result.value.fields.resource_type, "should include resource_type field");
    } else {
      assert.fail(`Expected ok result but got error: ${result.error}`);
    }
  });

  it("generates expiresAt approximately 1 hour in the future", async () => {
    const beforeCall = Date.now();
    const result = await adapter.generateUploadSignature("d.jpg", "image/jpeg");
    const afterCall = Date.now();

    if (result.ok) {
      const expiresMs = result.value.expiresAt.getTime();
      const oneHourMs = 60 * 60 * 1000;

      // expiresAt should be between (before + 1h) and (after + 1h)
      assert.ok(
        expiresMs >= beforeCall + oneHourMs - 1000,
        "expiresAt should be at least ~1 hour from now"
      );
      assert.ok(
        expiresMs <= afterCall + oneHourMs + 1000,
        "expiresAt should be at most ~1 hour from now"
      );
    } else {
      assert.fail(`Expected ok result but got error: ${result.error}`);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 5. getMediaMetadata -- URL parsing & validation
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- getMediaMetadata", { concurrency: 1 }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

  it("returns NOT_FOUND for URL without version path", async () => {
    // URL that doesn't match the /v{digits}/ pattern
    const result = await adapter.getMediaMetadata("https://example.com/no-version.jpg");

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND");
    }
  });

  it("returns NOT_FOUND for URL missing /v{digits}/ segment", async () => {
    const result = await adapter.getMediaMetadata(
      "https://res.cloudinary.com/test-cloud/image/upload/sample.jpg"
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND");
    }
  });

  it("returns error for URL with valid Cloudinary path (API unreachable)", async () => {
    // This URL matches the /v{digits}/ pattern, so it tries to call the API
    const result = await adapter.getMediaMetadata(
      "https://res.cloudinary.com/test-cloud/image/upload/v1234567890/sample.jpg"
    );

    assert.strictEqual(result.ok, false);
    // Could be NOT_FOUND or SERVICE_ERROR depending on how cloudinary SDK handles it
    if (!result.ok) {
      assert.ok(
        result.error === "NOT_FOUND" || result.error === "SERVICE_ERROR",
        "should be either NOT_FOUND or SERVICE_ERROR"
      );
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 6. API compatibility methods
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- API compatibility", { concurrency: 1 }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

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

  it("getSignedUploadUrl passes sizeBytes when provided", async () => {
    const oversizeBytes = 101 * 1024 * 1024;
    const result = await adapter.getSignedUploadUrl({
      path: "big.mp4",
      contentType: "video/mp4",
      sizeBytes: oversizeBytes,
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "INVALID_TYPE");
    }
  });

  it("getMetadata delegates to getMediaMetadata", async () => {
    const result = await adapter.getMetadata({
      url: "https://example.com/no-version.jpg",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 7. CloudinaryConfig interface constraints
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- config options", { concurrency: 1 }, () => {
  it("accepts config with folder option", () => {
    const adapter = createCloudinaryStorageAdapter({
      cloudName: "test",
      apiKey: "key",
      apiSecret: "secret",
      folder: "my-uploads",
    });
    assert.ok(adapter, "should create adapter with folder option");
  });

  it("accepts config with resourceType option", () => {
    const validTypes: Array<"image" | "video" | "raw" | "auto"> = ["image", "video", "raw", "auto"];

    for (const resourceType of validTypes) {
      const adapter = createCloudinaryStorageAdapter({
        cloudName: "test",
        apiKey: "key",
        apiSecret: "secret",
        resourceType,
      });
      assert.ok(adapter, `should create adapter with resourceType: ${resourceType}`);
    }
  });

  it("creates independent adapter instances", () => {
    const adapter1 = createCloudinaryStorageAdapter(TEST_CONFIG);
    const adapter2 = createCloudinaryStorageAdapter(MINIMAL_CONFIG);

    assert.notStrictEqual(adapter1, adapter2, "should be different objects");
    assert.strictEqual(typeof adapter1.generateUploadSignature, "function");
    assert.strictEqual(typeof adapter2.generateUploadSignature, "function");
  });
});
