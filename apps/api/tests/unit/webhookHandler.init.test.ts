import { describe, it, beforeEach, expect } from "vitest";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandler.js";
import { createSignature } from "./webhookHandler.test-helpers.js";

describe("WebhookHandler - Initialization", () => {
  it("should create handler without broadcaster", () => {
    const handler = new UniversalWebhookHandler();
    expect(handler).toBeTruthy();
  });

  it("should create handler with broadcaster", () => {
    const handler = new UniversalWebhookHandler(undefined);
    expect(handler).toBeTruthy();
  });
});

describe("WebhookHandler - Event ID Extraction", () => {
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

    expect(result.eventId).toBeTruthy();
  });

  it("should extract event ID from X payload", async () => {
    const payload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-123" }],
    });

    const signature = createSignature(payload, "test-secret");
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    expect(result.eventId).toBeTruthy();
  });

  it("should generate MD5 hash for payload without identifiable ID", async () => {
    const payload = JSON.stringify({ data: "unknown-format" });

    const signature = createSignature(payload, "test-secret");
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    expect(result.eventId).toBeTruthy();
    expect(result.eventId.length).toBe(32);
  });
});
