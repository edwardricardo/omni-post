import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandler.js";
import { prisma } from "@infra/prisma";
import {
  createSignature,
  cleanupTestData,
  createTestSubscription,
} from "./webhookHandler.test-helpers.js";

describe("WebhookHandler - Duplicate Event Detection", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should process event on first occurrence", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [
        {
          id: "unique-event-001",
          changes: [
            {
              field: "media",
              value: {
                id: "media-123",
                media_type: "IMAGE",
                caption: "Test post",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, true, "First occurrence should succeed");
  });

  it("should return existing data on duplicate event", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    await prisma.webhookEvent.create({
      data: {
        provider: "INSTAGRAM",
        eventType: "POST_ENGAGEMENT_UPDATE",
        eventId: "duplicate-event-123",
        signature: "test-signature",
        payload: { test: "data" },
        headers: {},
        status: "COMPLETED",
        verified: true,
        processed: true,
        normalizedData: { message: "already processed" },
      },
    });

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "duplicate-event-123" }],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, true, "Duplicate should return success");
    assert.ok(result.normalizedData, "Should return existing normalized data");
  });
});

describe("WebhookHandler - Signature Verification", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should accept valid Instagram signature", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [
        {
          id: "valid-signature-test",
          changes: [
            {
              field: "media",
              value: {
                id: "media-456",
                media_type: "IMAGE",
                caption: "Valid signature",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, true, "Valid signature should be accepted");
  });

  it("should reject invalid signature", async () => {
    const { subscription: _subscription } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "invalid-signature-test" }],
    });

    const invalidSignature = "sha256=invalid-signature-hash";
    const headers = { "x-hub-signature-256": invalidSignature };

    const result = await handler.handleWebhook("INSTAGRAM", invalidSignature, payload, headers);

    assert.strictEqual(result.success, false, "Invalid signature should be rejected");
    assert.ok(
      result.error?.includes("signature verification failed"),
      "Should mention signature failure"
    );
  });

  it("should reject request with missing signature", async () => {
    await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "missing-signature-test" }],
    });

    const result = await handler.handleWebhook("INSTAGRAM", "", payload, {});

    assert.strictEqual(result.success, false, "Missing signature should be rejected");
  });
});

describe("WebhookHandler - Provider Routing", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should route Instagram webhook to Instagram processor", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [
        {
          id: "instagram-routing-test",
          changes: [
            {
              field: "media",
              value: {
                id: "media-789",
                media_type: "IMAGE",
                caption: "Routing test",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, true, "Instagram webhook should be routed");
  });

  it("should route Facebook webhook to Instagram processor (shared)", async () => {
    const { subscription } = await createTestSubscription("FACEBOOK");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [
        {
          id: "facebook-routing-test",
          changes: [
            {
              field: "comments",
              value: {
                id: "comment-123",
                text: "Great post!",
                created_time: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("FACEBOOK", signature, payload, headers);

    assert.strictEqual(result.success, true, "Facebook webhook should be routed");
  });

  it("should route X webhook to X processor", async () => {
    const { subscription } = await createTestSubscription("X");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      tweet_create_events: [
        {
          id_str: "x-routing-test",
          text: "Test tweet",
          user: {
            id_str: "user-123",
            screen_name: "testuser",
          },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    assert.strictEqual(result.success, true, "X webhook should be routed");
  });
});
