/**
 * @file LinkedInAdapter.documents.test.ts
 * @description Unit tests for LinkedIn document upload flow (PDF/PPTX/DOCX).
 *              Verifies that publish() detects document media by URL extension,
 *              uses the document upload path, and falls back to regular media
 *              for non-document files.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { LinkedInAdapter } from "../src/LinkedInAdapter.js";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Test helpers
// ============================================================================

function makePublishInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    channelId: "channel-linkedin-doc-001",
    post: {
      body: "Check out this document",
      text: "Check out this document",
    },
    dedupeKey: "dedupe-doc-001",
    ...overrides,
  };
}

function makeCredentialsResult() {
  return {
    ok: true as const,
    value: {
      accessToken: "test-token",
      refreshToken: "test-refresh",
      personUrn: "urn:li:person:abc123",
    },
  };
}

// ============================================================================
// Document Upload Tests
// ============================================================================

describe("LinkedInAdapter - Document Upload", { concurrency: 1 }, () => {
  let adapter: LinkedInAdapter;
  let mockCreatePost: ReturnType<typeof vi.fn>;
  let mockInitializeDocumentUpload: ReturnType<typeof vi.fn>;
  let mockUploadMediaBinary: ReturnType<typeof vi.fn>;
  let mockInitializeImageUpload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LinkedInAdapter();

    mockCreatePost = vi.fn(async () => ({
      id: "urn:li:share:99999",
      activity: "urn:li:activity:99999",
    }));

    mockInitializeDocumentUpload = vi.fn(async () => ({
      value: {
        uploadUrlExpiresAt: Date.now() + 300000,
        uploadUrl: "https://api.linkedin.com/upload/document/presigned-url",
        document: "urn:li:document:doc-001",
      },
    }));

    mockUploadMediaBinary = vi.fn(async () => undefined);

    mockInitializeImageUpload = vi.fn(async () => ({
      value: {
        uploadUrlExpiresAt: Date.now() + 300000,
        uploadUrl: "https://api.linkedin.com/upload/image/presigned-url",
        image: "urn:li:image:img-001",
      },
    }));

    (adapter as Record<string, unknown>).createApiClient = () => ({
      createPost: mockCreatePost,
      initializeDocumentUpload: mockInitializeDocumentUpload,
      initializeImageUpload: mockInitializeImageUpload,
      uploadMediaBinary: mockUploadMediaBinary,
    });

    (adapter as Record<string, unknown>).getCredentials = vi.fn(async () =>
      makeCredentialsResult()
    );

    // Mock global fetch for document/image binary download
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      if (typeof url === "string" && url.startsWith("https://api.linkedin.com")) {
        return originalFetch(url);
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
        headers: new Headers({ "content-type": "application/pdf" }),
      } as Response;
    });
  });

  it("publishes document post when media URL has .pdf extension", async () => {
    const input = makePublishInput({
      post: {
        body: "See the attached PDF",
        text: "See the attached PDF",
        media: [{ url: "https://cdn.example.com/report.pdf", type: "image" as const }],
      },
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed for document media");
    if (result.ok) {
      assert.strictEqual(result.value.providerPostId, "urn:li:share:99999");
    }

    assert.strictEqual(mockInitializeDocumentUpload.mock.calls.length, 1);
    const ownerUrn = mockInitializeDocumentUpload.mock.calls[0]?.[0] as string;
    assert.strictEqual(ownerUrn, "urn:li:person:abc123");
  });

  it("publishes document post when media URL has .pptx extension", async () => {
    const input = makePublishInput({
      post: {
        body: "Slides attached",
        text: "Slides attached",
        media: [{ url: "https://cdn.example.com/deck.pptx", type: "image" as const }],
      },
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed for PPTX media");
    assert.strictEqual(mockInitializeDocumentUpload.mock.calls.length, 1);
  });

  it("publishes document post when media URL has .docx extension", async () => {
    const input = makePublishInput({
      post: {
        body: "Word doc attached",
        text: "Word doc attached",
        media: [{ url: "https://cdn.example.com/memo.docx", type: "image" as const }],
      },
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed for DOCX media");
    assert.strictEqual(mockInitializeDocumentUpload.mock.calls.length, 1);
  });

  it("sets document content with URN and alt-based title in payload", async () => {
    const input = makePublishInput({
      post: {
        body: "Doc post",
        text: "Doc post",
        media: [
          {
            url: "https://cdn.example.com/report.pdf",
            type: "image" as const,
            alt: "Q4 Report",
          },
        ],
      },
    });

    await adapter.publish(input);

    assert.strictEqual(mockCreatePost.mock.calls.length, 1);
    const payload = mockCreatePost.mock.calls[0]?.[0] as Record<string, unknown>;
    const content = payload.content as { media: { id: string; title: string } };
    assert.strictEqual(content.media.id, "urn:li:document:doc-001");
    assert.strictEqual(content.media.title, "Q4 Report");
  });

  it("uses 'Document' as default title when alt is not provided", async () => {
    const input = makePublishInput({
      post: {
        body: "Doc without alt",
        text: "Doc without alt",
        media: [{ url: "https://cdn.example.com/file.pdf", type: "image" as const }],
      },
    });

    await adapter.publish(input);

    const payload = mockCreatePost.mock.calls[0]?.[0] as Record<string, unknown>;
    const content = payload.content as { media: { id: string; title: string } };
    assert.strictEqual(content.media.title, "Document");
  });

  it("falls back to regular media upload for non-document files", async () => {
    const input = makePublishInput({
      post: {
        body: "Image post",
        text: "Image post",
        media: [{ url: "https://cdn.example.com/photo.jpg", type: "image" as const }],
      },
    });

    await adapter.publish(input);

    assert.strictEqual(
      mockInitializeDocumentUpload.mock.calls.length,
      0,
      "Should not call document upload for .jpg"
    );
    assert.strictEqual(
      mockInitializeImageUpload.mock.calls.length,
      1,
      "Should call image upload for .jpg"
    );
  });

  it("detects document extension case-insensitively", async () => {
    const input = makePublishInput({
      post: {
        body: "Uppercase extension",
        text: "Uppercase extension",
        media: [{ url: "https://cdn.example.com/report.PDF", type: "image" as const }],
      },
    });

    await adapter.publish(input);

    assert.strictEqual(
      mockInitializeDocumentUpload.mock.calls.length,
      1,
      "Should detect .PDF as document"
    );
  });
});
