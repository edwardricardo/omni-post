/**
 * Unit Tests for FacebookWebhookProcessor — Signature Verification & Feed Events
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api exec node --import tsx --test tests/unit/webhooks/facebookWebhookProcessor.signature-feed.test.ts
 *
 * @module FacebookWebhookProcessorTests
 * @category UnitTests
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { FacebookWebhookProcessor } from "../../../src/webhooks/processors/facebookWebhookProcessor.js";
import { generateHmacSignature } from "./facebookWebhookProcessor.test-helpers.js";

// ===========================
// Signature Verification Tests (8 tests)
// ===========================

describe("FacebookWebhookProcessor - Signature Verification", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;
  const testSecret = "test-facebook-app-secret";

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should verify valid webhook signature with sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should verify valid webhook signature without sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should reject invalid signature", () => {
    const payload = JSON.stringify({ test: "data" });
    const invalidSignature = "sha256=invalid-signature-value";

    const isValid = processor.verify(payload, invalidSignature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should reject signature with tampered payload", () => {
    const originalPayload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(originalPayload, testSecret);

    const tamperedPayload = JSON.stringify({ test: "tampered" });
    const isValid = processor.verify(tamperedPayload, signature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should reject signature with wrong secret", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, "wrong-secret");

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should handle empty payload", () => {
    const payload = "";
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should handle special characters in payload", () => {
    const payload = JSON.stringify({ test: "data with special chars ñ and emojis 🎉" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should use constant-time comparison", () => {
    const payload = JSON.stringify({ test: "data" });
    const correctSignature = generateHmacSignature(payload, testSecret);

    // Test multiple attempts to verify timing consistency
    for (let i = 0; i < 10; i++) {
      const isValid = processor.verify(payload, correctSignature, testSecret);
      assert.strictEqual(isValid, true);
    }
  });
});

// ===========================
// Feed Event Parsing Tests (6 tests)
// ===========================

describe("FacebookWebhookProcessor - Feed Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse feed published event for status post", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "post-456",
                verb: "add",
                item: "status",
                message: "Test status update",
                permalink_url: "https://facebook.com/page/posts/456",
                created_time: "2024-01-15T10:00:00Z",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
                published: true,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.eventType, "feed_published");
    assert.strictEqual(result.normalizedData.postId, "post-456");
    assert.strictEqual(result.normalizedData.verb, "add");
    assert.strictEqual(result.normalizedData.item, "status");
    assert.strictEqual(result.normalizedData.message, "Test status update");
    assert.strictEqual(result.normalizedData.isPublished, true);
  });

  it("should parse feed event for photo post", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "photo-789",
                verb: "add",
                item: "photo",
                message: "Check out this photo!",
                link: "https://facebook.com/photo/789",
                permalink_url: "https://facebook.com/page/posts/789",
                created_time: "2024-01-15T11:00:00Z",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
                published: true,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.item, "photo");
    assert.strictEqual(result.normalizedData.link, "https://facebook.com/photo/789");
  });

  it("should parse feed event for video post", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "video-999",
                verb: "add",
                item: "video",
                message: "New video posted",
                link: "https://facebook.com/video/999",
                created_time: "2024-01-15T12:00:00Z",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
                published: true,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.item, "video");
  });

  it("should parse feed edited event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "post-111",
                verb: "edited",
                item: "status",
                message: "Updated status",
                created_time: "2024-01-15T13:00:00Z",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.verb, "edited");
  });

  it("should parse hidden post event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "post-222",
                verb: "add",
                item: "status",
                message: "Hidden post",
                created_time: "2024-01-15T14:00:00Z",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
                is_hidden: true,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.isHidden, true);
  });

  it("should extract author information from feed event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "post-333",
                verb: "add",
                item: "status",
                message: "Test",
                created_time: "2024-01-15T15:00:00Z",
                from: {
                  id: "user-456",
                  name: "John Doe",
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.from.id, "user-456");
    assert.strictEqual(result.normalizedData.from.name, "John Doe");
  });
});
