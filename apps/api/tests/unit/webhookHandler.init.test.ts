import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandler.js";
import { createSignature } from "./webhookHandler.test-helpers.js";

describe("WebhookHandler - Initialization", { concurrency: 1 }, () => {
  it("should create handler without broadcaster", () => {
    const handler = new UniversalWebhookHandler();
    assert.ok(handler, "Handler should be created");
  });

  it("should create handler with broadcaster", () => {
    const handler = new UniversalWebhookHandler(undefined);
    assert.ok(handler, "Handler should be created with undefined broadcaster");
  });
});

describe("WebhookHandler - Event ID Extraction", { concurrency: 1 }, () => {
  let handler: UniversalWebhookHandler;

  beforeEach(() => {
    handler = new UniversalWebhookHandler();
  });

  it("should extract event ID from Instagram payload", async () => {
    const payload = JSON.stringify({
      entry: [{ id: "instagram-entry-123" }],
    });

    const signature = createSignature(payload, "test-secret");
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    assert.ok(result.eventId, "Event ID should be extracted");
  });

  it("should extract event ID from X payload", async () => {
    const payload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-123" }],
    });

    const signature = createSignature(payload, "test-secret");
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    assert.ok(result.eventId, "Event ID should be extracted");
  });

  it("should generate MD5 hash for payload without identifiable ID", async () => {
    const payload = JSON.stringify({ data: "unknown-format" });

    const signature = createSignature(payload, "test-secret");
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    assert.ok(result.eventId, "Event ID should be generated");
    assert.strictEqual(result.eventId.length, 32, "Should be MD5 hash (32 chars)");
  });
});
