/**
 * @file webhookSignatureVerification.providers2.test.ts
 * @description Tests for Webhook signature verification — TikTokWebhookProcessor
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@infra/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/prisma")>();
  return {
    ...actual,
    prisma: {},
  };
});
import { TikTokWebhookProcessor } from "../../../src/webhooks/processors/tiktokWebhookProcessor.js";
import { prisma } from "@infra/prisma";
import { XWebhookProcessor } from "../../../src/webhooks/processors/xWebhookProcessor.js";
import { signPayload } from "./webhookSignatureVerification.test-helpers.js";

describe("Webhook signature verification — TikTokWebhookProcessor", () => {
  const secret = "tiktok-test-secret-tok";
  let processor: TikTokWebhookProcessor;

  let _originalConsoleLog: typeof console.log;
  beforeAll(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
  });
  afterAll(() => {
    console.log = _originalConsoleLog;
  });

  beforeEach(() => {
    processor = new TikTokWebhookProcessor(prisma as never);
  });

  it("scenario 1: valid payload with correct sha256-hex signature → accepted", () => {
    const payload = JSON.stringify({
      event: {
        type: "video.create",
        content: {
          video_id: "vid-tiktok-001",
          user_id: "tiktok-user-abc",
          title: "Test video",
        },
      },
    });
    const signature = signPayload(payload, secret);

    expect(processor.verify(payload, signature, secret)).toBe(true);
  });

  it("scenario 2: tampered body (attacker injects extra field after signing) → rejected", () => {
    const originalPayload = JSON.stringify({
      event: {
        type: "video.create",
        content: { video_id: "vid-tiktok-002", user_id: "tiktok-user-abc" },
      },
    });
    const signature = signPayload(originalPayload, secret);

    const tamperedPayload = JSON.stringify({
      event: {
        type: "video.create",
        content: { video_id: "vid-tiktok-002", user_id: "tiktok-user-abc" },
      },
      injected_field: "attacker-data",
    });

    expect(processor.verify(tamperedPayload, signature, secret)).toBe(false);
  });

  it("scenario 3: missing x-tiktok-signature header (empty string) → rejected", () => {
    const payload = JSON.stringify({
      event: { type: "video.remove", content: { video_id: "vid-tiktok-003" } },
    });

    expect(processor.verify(payload, "", secret)).toBe(false);
  });

  it("scenario 3b: completely wrong signature value → rejected", () => {
    const payload = JSON.stringify({
      event: { type: "comment.create", content: { comment_id: "c-001" } },
    });
    const wrongSig = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

    expect(processor.verify(payload, wrongSig, secret)).toBe(false);
  });

  it("rejects signature computed with wrong secret", () => {
    const payload = JSON.stringify({
      event: { type: "video.statistics.update", content: { video_id: "vid-004" } },
    });
    const signatureWithWrongSecret = signPayload(payload, "attacker-fake-secret");

    expect(processor.verify(payload, signatureWithWrongSecret, secret)).toBe(false);
  });
});

describe("Webhook signature verification — XWebhookProcessor", () => {
  const secret = "x-twitter-test-secret-consumer";
  let processor: XWebhookProcessor;

  let _originalConsoleLog: typeof console.log;
  beforeAll(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
  });
  afterAll(() => {
    console.log = _originalConsoleLog;
  });

  beforeEach(() => {
    processor = new XWebhookProcessor(prisma as never);
  });

  function signX_base64(rawBody: string, s: string): string {
    return "sha256=" + createHmac("sha256", s).update(rawBody, "utf8").digest("base64");
  }

  function signX_hex(rawBody: string, s: string): string {
    const b64 = createHmac("sha256", s).update(rawBody, "utf8").digest("base64");
    return "sha256=" + Buffer.from(b64, "base64").toString("hex");
  }

  it("scenario 1a: valid payload with correct base64-encoded signature → accepted", () => {
    const payload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-001", text: "Hello world" }],
    });
    const signature = signX_base64(payload, secret);

    expect(processor.verify(payload, signature, secret)).toBe(true);
  });

  it("scenario 1b: valid payload with correct hex-encoded signature → accepted (dual-format tolerance)", () => {
    const payload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-002", text: "Dual format test" }],
    });
    const signature = signX_hex(payload, secret);

    expect(processor.verify(payload, signature, secret)).toBe(true);
  });

  it("scenario 2: tampered body (body modified after signing) → rejected", () => {
    const originalPayload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-003", text: "Original text" }],
    });
    const signature = signX_base64(originalPayload, secret);

    const tamperedPayload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-003", text: "EVIL MODIFIED TEXT" }],
    });

    expect(processor.verify(tamperedPayload, signature, secret)).toBe(false);
  });

  it("scenario 3: missing x-signature header (empty string) → rejected", () => {
    const payload = JSON.stringify({
      tweet_delete_events: [{ status: { id_str: "tweet-deleted-001" } }],
    });

    expect(processor.verify(payload, "", secret)).toBe(false);
  });

  it("scenario 3b: garbage signature value → rejected", () => {
    const payload = JSON.stringify({
      favorite_events: [{ id_str: "fav-001" }],
    });
    const garbage = "sha256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    expect(processor.verify(payload, garbage, secret)).toBe(false);
  });

  it("rejects signature computed with wrong consumer secret", () => {
    const payload = JSON.stringify({
      retweet_events: [{ id_str: "rt-001" }],
    });
    const wrongSecretSig = signX_base64(payload, "attacker-consumer-secret");

    expect(processor.verify(payload, wrongSecretSig, secret)).toBe(false);
  });
});
