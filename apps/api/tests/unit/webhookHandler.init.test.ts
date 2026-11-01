/**
 * @file webhookHandler.init.test.ts
 * @description Tests for WebhookHandler - Event ID Extraction
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandler.js";
import { makeWebhookPrismaFake } from "./helpers/webhookPrismaFake.js";
import { createSignature } from "./webhookHandler.test-helpers.js";

describe("WebhookHandler - Event ID Extraction", () => {
  let handler: UniversalWebhookHandler;

  beforeEach(() => {
    handler = new UniversalWebhookHandler(makeWebhookPrismaFake().prisma);
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
