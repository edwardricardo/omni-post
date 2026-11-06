/**
 * Cloudinary Storage Adapter tests
 *
 * Tier 0: no Cloudinary services needed.
 * Tests content-type validation, file size validation, metadata URL parsing,
 * the compatibility methods, adapter independence and error handling.
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
 *
 * @file index.test.ts
 * @description Tests for createCloudinaryStorageAdapter -- validation and compatibility
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import { createCloudinaryStorageAdapter, type CloudinaryConfig } from "../src/index.js";

beforeAll(() => {
  client.register.clear();
});

afterAll(() => {
  client.register.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
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
 * 2. Content type validation
 *
 * These tests exercise the validation gate BEFORE the circuit breaker
 * is invoked, so they are not affected by breaker caching.
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- content type validation", { concurrent: false }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

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

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("INVALID_TYPE");
      }
    });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * 3. File size validation
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- file size validation", { concurrent: false }, () => {
  // Cast to access the 3-arg overload of generateUploadSignature
  // that accepts sizeBytes. The StoragePort interface only exposes 2 args,
  // but the Cloudinary implementation accepts an optional third parameter.
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG) as unknown as {
    generateUploadSignature: (
      filename: string,
      contentType: string,
      sizeBytes?: number
    ) => Promise<{ ok: boolean; error?: string }>;
  };

  it("rejects files exceeding 100MB", async () => {
    const oversizeBytes = 101 * 1024 * 1024; // 101 MB
    const result = await adapter.generateUploadSignature(
      "huge-video.mp4",
      "video/mp4",
      oversizeBytes
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INVALID_TYPE");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 5. getMediaMetadata -- URL parsing & validation
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- getMediaMetadata", { concurrent: false }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

  it("returns NOT_FOUND for URL without version path", async () => {
    // URL that doesn't match the /v{digits}/ pattern
    const result = await adapter.getMediaMetadata("https://example.com/no-version.jpg");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("returns NOT_FOUND for URL missing /v{digits}/ segment", async () => {
    const result = await adapter.getMediaMetadata(
      "https://res.cloudinary.com/test-cloud/image/upload/sample.jpg"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("returns error for URL with valid Cloudinary path (API unreachable)", async () => {
    // This URL matches the /v{digits}/ pattern, so it tries to call the API
    const result = await adapter.getMediaMetadata(
      "https://res.cloudinary.com/test-cloud/image/upload/v1234567890/sample.jpg"
    );

    expect(result.ok).toBe(false);
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
describe("createCloudinaryStorageAdapter -- API compatibility", { concurrent: false }, () => {
  const adapter = createCloudinaryStorageAdapter(TEST_CONFIG);

  it("getSignedUploadUrl delegates to generateUploadSignature", async () => {
    // Rejected type should return INVALID_TYPE through both paths
    const result = await adapter.getSignedUploadUrl({
      path: "test.pdf",
      contentType: "application/pdf",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INVALID_TYPE");
    }
  });

  it("getSignedUploadUrl passes sizeBytes when provided", async () => {
    const oversizeBytes = 101 * 1024 * 1024;
    const result = await adapter.getSignedUploadUrl({
      path: "big.mp4",
      contentType: "video/mp4",
      sizeBytes: oversizeBytes,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INVALID_TYPE");
    }
  });

  it("getMetadata delegates to getMediaMetadata", async () => {
    const result = await adapter.getMetadata({
      url: "https://example.com/no-version.jpg",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * 7. CloudinaryConfig interface constraints
 * ────────────────────────────────────────────────────────────────────── */
describe("createCloudinaryStorageAdapter -- config options", { concurrent: false }, () => {
  it("creates independent adapter instances", () => {
    const adapter1 = createCloudinaryStorageAdapter(TEST_CONFIG);
    const adapter2 = createCloudinaryStorageAdapter(MINIMAL_CONFIG);

    expect(adapter1).not.toBe(adapter2);
    expect(typeof adapter1.generateUploadSignature).toBe("function");
    expect(typeof adapter2.generateUploadSignature).toBe("function");
  });
});
