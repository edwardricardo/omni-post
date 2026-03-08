import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { TikTokWebhookProcessor } from "../../../src/webhooks/processors/tiktokWebhookProcessor.js";
import { XWebhookProcessor } from "../../../src/webhooks/processors/xWebhookProcessor.js";
import { signPayload } from "./webhookSignatureVerification.test-helpers.js";

describe("Webhook signature verification — TikTokWebhookProcessor", { concurrency: 1 }, () => {
  const secret = "tiktok-test-secret-tok";
  let processor: TikTokWebhookProcessor;

  let _originalConsoleLog: typeof console.log;
  before(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
  });
  after(() => {
    console.log = _originalConsoleLog;
  });

  beforeEach(() => {
    processor = new TikTokWebhookProcessor();
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

    assert.strictEqual(
      processor.verify(payload, signature, secret),
      true,
      "TikTok: valid sha256-hex signature must be accepted"
    );
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

    assert.strictEqual(
      processor.verify(tamperedPayload, signature, secret),
      false,
      "TikTok: tampered body must be rejected"
    );
  });

  it("scenario 3: missing x-tiktok-signature header (empty string) → rejected", () => {
    const payload = JSON.stringify({
      event: { type: "video.remove", content: { video_id: "vid-tiktok-003" } },
    });

    assert.strictEqual(
      processor.verify(payload, "", secret),
      false,
      "TikTok: missing signature must be rejected"
    );
  });

  it("scenario 3b: completely wrong signature value → rejected", () => {
    const payload = JSON.stringify({
      event: { type: "comment.create", content: { comment_id: "c-001" } },
    });
    const wrongSig = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

    assert.strictEqual(
      processor.verify(payload, wrongSig, secret),
      false,
      "TikTok: all-zero signature must be rejected"
    );
  });

  it("rejects signature computed with wrong secret", () => {
    const payload = JSON.stringify({
      event: { type: "video.statistics.update", content: { video_id: "vid-004" } },
    });
    const signatureWithWrongSecret = signPayload(payload, "attacker-fake-secret");

    assert.strictEqual(
      processor.verify(payload, signatureWithWrongSecret, secret),
      false,
      "TikTok: wrong-secret signature must be rejected"
    );
  });
});

describe("Webhook signature verification — XWebhookProcessor", { concurrency: 1 }, () => {
  const secret = "x-twitter-test-secret-consumer";
  let processor: XWebhookProcessor;

  let _originalConsoleLog: typeof console.log;
  before(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
  });
  after(() => {
    console.log = _originalConsoleLog;
  });

  beforeEach(() => {
    processor = new XWebhookProcessor();
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

    assert.strictEqual(
      processor.verify(payload, signature, secret),
      true,
      "X: valid base64 signature must be accepted"
    );
  });

  it("scenario 1b: valid payload with correct hex-encoded signature → accepted (dual-format tolerance)", () => {
    const payload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-002", text: "Dual format test" }],
    });
    const signature = signX_hex(payload, secret);

    assert.strictEqual(
      processor.verify(payload, signature, secret),
      true,
      "X: valid hex signature must also be accepted (dual-format)"
    );
  });

  it("scenario 2: tampered body (body modified after signing) → rejected", () => {
    const originalPayload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-003", text: "Original text" }],
    });
    const signature = signX_base64(originalPayload, secret);

    const tamperedPayload = JSON.stringify({
      tweet_create_events: [{ id_str: "tweet-003", text: "EVIL MODIFIED TEXT" }],
    });

    assert.strictEqual(
      processor.verify(tamperedPayload, signature, secret),
      false,
      "X: tampered body must be rejected"
    );
  });

  it("scenario 3: missing x-signature header (empty string) → rejected", () => {
    const payload = JSON.stringify({
      tweet_delete_events: [{ status: { id_str: "tweet-deleted-001" } }],
    });

    assert.strictEqual(
      processor.verify(payload, "", secret),
      false,
      "X: missing signature must be rejected"
    );
  });

  it("scenario 3b: garbage signature value → rejected", () => {
    const payload = JSON.stringify({
      favorite_events: [{ id_str: "fav-001" }],
    });
    const garbage = "sha256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    assert.strictEqual(
      processor.verify(payload, garbage, secret),
      false,
      "X: garbage signature must be rejected"
    );
  });

  it("rejects signature computed with wrong consumer secret", () => {
    const payload = JSON.stringify({
      retweet_events: [{ id_str: "rt-001" }],
    });
    const wrongSecretSig = signX_base64(payload, "attacker-consumer-secret");

    assert.strictEqual(
      processor.verify(payload, wrongSecretSig, secret),
      false,
      "X: wrong-secret signature must be rejected"
    );
  });
});
