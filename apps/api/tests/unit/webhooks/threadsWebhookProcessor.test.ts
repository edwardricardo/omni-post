/**
 * @file threadsWebhookProcessor.test.ts
 * @description Tests for ThreadsWebhookProcessor: HMAC-SHA256 (hex) signature
 *              verification and per-field event-type normalization (replies →
 *              COMMENT_RECEIVED, mentions → MENTION_RECEIVED, posts → POST_PUBLISHED).
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { ThreadsWebhookProcessor } from "../../../src/webhooks/processors/threadsWebhookProcessor.js";
import { signPayload } from "./webhookSignatureVerification.test-helpers.js";

const makePayload = (field: string, value: Record<string, unknown>): string =>
  JSON.stringify({
    object: "threads",
    entry: [{ id: "threads-acct-1", changes: [{ field, value }] }],
  });

// No matching channel → findRelatedEntities returns {} and parse still resolves.
const prismaStub = { channel: { findFirst: async () => null } } as never;

describe("ThreadsWebhookProcessor", () => {
  const secret = "threads-test-secret";
  let processor: ThreadsWebhookProcessor;

  beforeEach(() => {
    processor = new ThreadsWebhookProcessor(prismaStub);
  });

  describe("verify", () => {
    it("accepts a payload signed with the correct secret (sha256/hex)", () => {
      const payload = makePayload("mentions", { id: "m1", text: "hola" });
      expect(processor.verify(payload, signPayload(payload, secret), secret)).toBe(true);
    });

    it("rejects a tampered payload", () => {
      const payload = makePayload("mentions", { id: "m1" });
      const signature = signPayload(payload, secret);
      const tampered = makePayload("mentions", { id: "m1", injected: "evil" });
      expect(processor.verify(tampered, signature, secret)).toBe(false);
    });
  });

  describe("parse", () => {
    it("maps a reply to COMMENT_RECEIVED", async () => {
      const result = await processor.parse(
        JSON.parse(makePayload("replies", { id: "r1", text: "nice" }))
      );
      expect(result.eventType).toBe("COMMENT_RECEIVED");
      expect(result.normalizedData.eventType).toBe("reply_received");
    });

    it("maps a mention to MENTION_RECEIVED", async () => {
      const result = await processor.parse(
        JSON.parse(makePayload("mentions", { id: "m1", text: "@me" }))
      );
      expect(result.eventType).toBe("MENTION_RECEIVED");
      expect(result.normalizedData.mentionId).toBe("m1");
    });

    it("maps a post to POST_PUBLISHED", async () => {
      const result = await processor.parse(
        JSON.parse(makePayload("posts", { id: "p1", permalink: "u" }))
      );
      expect(result.eventType).toBe("POST_PUBLISHED");
      expect(result.normalizedData.threadsPostId).toBe("p1");
    });

    it("falls back to POST_UPDATED for an unknown field", async () => {
      const result = await processor.parse(JSON.parse(makePayload("unknown_field", {})));
      expect(result.eventType).toBe("POST_UPDATED");
    });

    it("throws on a payload with no entry", async () => {
      await expect(processor.parse({ object: "threads" })).rejects.toThrow();
    });
  });
});
