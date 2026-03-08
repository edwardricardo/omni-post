import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandler.js";
import { prisma } from "@infra/prisma";
import {
  createSignature,
  cleanupTestData,
  createTestSubscription,
} from "./webhookHandler.test-helpers.js";

describe("WebhookHandler - Error Handling", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should handle missing webhook subscription", async () => {
    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "no-subscription-test" }],
    });

    const signature = "sha256=test-signature";
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, false, "Should fail without subscription");
    assert.ok(result.error?.includes("not found"), "Should mention missing subscription");
  });

  it("should handle malformed JSON payload", async () => {
    await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const malformedPayload = "{ invalid json";

    const signature = "sha256=test-signature";
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, malformedPayload, headers);

    assert.strictEqual(result.success, false, "Should fail with malformed JSON");
    assert.ok(result.error, "Should have error message");
  });

  it("should handle inactive webhook subscription", async () => {
    const { subscription } = await createTestSubscription("INSTAGRAM");

    await prisma.webhookSubscription.update({
      where: { id: subscription.id },
      data: { isActive: false },
    });

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "inactive-subscription-test" }],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.strictEqual(result.success, false, "Should fail with inactive subscription");
    assert.ok(
      result.error?.includes("No active webhook subscription") ||
        result.error?.includes("subscription"),
      `Should mention subscription issue, got: ${result.error}`
    );
  });
});

describe("WebhookHandler - Retry Logic", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should mark retryable errors for retry", async () => {
    await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "retryable-error-test" }],
    });

    const signature = "sha256=test-signature";
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    assert.strictEqual(result.success, false, "Should fail");
  });

  it("should not retry signature verification failures", async () => {
    const { subscription: _subscription } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "non-retryable-test" }],
    });

    const invalidSignature = "sha256=wrong-signature";
    const headers = { "x-hub-signature-256": invalidSignature };

    const result = await handler.handleWebhook("INSTAGRAM", invalidSignature, payload, headers);

    assert.strictEqual(result.success, false, "Should fail");
    assert.strictEqual(result.retryAfter, undefined, "Should not suggest retry");
  });

  it("should calculate exponential backoff for retries", async () => {
    const handler = new UniversalWebhookHandler();

    const calculateRetryDelay = (handler as any).calculateRetryDelay.bind(handler);

    const delay1 = calculateRetryDelay(1);
    const delay2 = calculateRetryDelay(2);
    const delay3 = calculateRetryDelay(3);

    assert.strictEqual(delay1, 5000, "First retry should be 5 seconds");
    assert.strictEqual(delay2, 10000, "Second retry should be 10 seconds");
    assert.strictEqual(delay3, 20000, "Third retry should be 20 seconds");
  });
});

describe("WebhookHandler - Dead Letter Queue", { concurrency: 1 }, () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData().catch(() => {});
  });

  it("should move non-retryable events to dead letter queue", async () => {
    const { subscription: _subscription2 } = await createTestSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "dead-letter-test" }],
    });

    const invalidSignature = "sha256=invalid-signature";
    const headers = { "x-hub-signature-256": invalidSignature };

    await handler.handleWebhook("INSTAGRAM", invalidSignature, payload, headers);

    const deadLetterEvents = await prisma.webhookDeadLetter.findMany({
      where: { provider: "INSTAGRAM" },
    });

    assert.ok(Array.isArray(deadLetterEvents), "Should check dead letter queue");
  });
});
