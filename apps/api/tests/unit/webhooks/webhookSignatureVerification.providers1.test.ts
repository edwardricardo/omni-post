import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { InstagramWebhookProcessor } from "../../../src/webhooks/processors/instagramWebhookProcessor.js";
import { FacebookWebhookProcessor } from "../../../src/webhooks/processors/facebookWebhookProcessor.js";
import { YouTubeWebhookProcessor } from "../../../src/webhooks/processors/youtubeWebhookProcessor.js";
import { signPayload } from "./webhookSignatureVerification.test-helpers.js";

describe("Webhook signature verification — InstagramWebhookProcessor", { concurrency: 1 }, () => {
  const secret = "instagram-test-secret-abc";
  let processor: InstagramWebhookProcessor;

  beforeEach(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("scenario 1: valid payload with correct signature → accepted", () => {
    const payload = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "ig-page-123",
          changes: [{ field: "media", value: { id: "media-abc", media_type: "IMAGE" } }],
        },
      ],
    });
    const signature = signPayload(payload, secret);

    assert.strictEqual(
      processor.verify(payload, signature, secret),
      true,
      "Instagram: valid signature must be accepted"
    );
  });

  it("scenario 2: tampered body (attacker modifies payload after signing) → rejected", () => {
    const originalPayload = JSON.stringify({
      object: "instagram",
      entry: [{ id: "ig-page-123", changes: [{ field: "media", value: { id: "media-abc" } }] }],
    });
    const signature = signPayload(originalPayload, secret);

    const tamperedPayload = JSON.stringify({
      object: "instagram",
      entry: [{ id: "ig-page-123", changes: [{ field: "media", value: { id: "media-abc" } }] }],
      injected: "malicious-data",
    });

    assert.strictEqual(
      processor.verify(tamperedPayload, signature, secret),
      false,
      "Instagram: tampered body must be rejected"
    );
  });

  it("scenario 3: missing X-Hub-Signature-256 header (empty string) → rejected", () => {
    const payload = JSON.stringify({ object: "instagram", entry: [{ id: "ig-page-123" }] });

    assert.strictEqual(
      processor.verify(payload, "", secret),
      false,
      "Instagram: missing signature must be rejected"
    );
  });

  it("scenario 3b: signature header present but value is garbage → rejected", () => {
    const payload = JSON.stringify({ object: "instagram", entry: [{ id: "ig-page-456" }] });
    const garbage = "sha256=00000000000000000000000000000000000000000000000000000000000000";

    assert.strictEqual(
      processor.verify(payload, garbage, secret),
      false,
      "Instagram: garbage signature must be rejected"
    );
  });
});

describe("Webhook signature verification — FacebookWebhookProcessor", { concurrency: 1 }, () => {
  const secret = "facebook-test-secret-xyz";
  let processor: FacebookWebhookProcessor;

  beforeEach(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("scenario 1: valid payload with correct signature → accepted", () => {
    const payload = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "fb-page-456",
          changes: [{ field: "feed", value: { verb: "add", post_id: "post-789" } }],
        },
      ],
    });
    const signature = signPayload(payload, secret);

    assert.strictEqual(
      processor.verify(payload, signature, secret),
      true,
      "Facebook: valid signature must be accepted"
    );
  });

  it("scenario 2: tampered body → rejected", () => {
    const originalPayload = JSON.stringify({
      object: "page",
      entry: [{ id: "fb-page-456", changes: [{ field: "feed", value: { verb: "add" } }] }],
    });
    const signature = signPayload(originalPayload, secret);

    const tamperedPayload = JSON.stringify({
      object: "page",
      entry: [{ id: "fb-page-456", changes: [{ field: "feed", value: { verb: "delete" } }] }],
    });

    assert.strictEqual(
      processor.verify(tamperedPayload, signature, secret),
      false,
      "Facebook: tampered body must be rejected"
    );
  });

  it("scenario 3: missing X-Hub-Signature-256 header → rejected", () => {
    const payload = JSON.stringify({ object: "page", entry: [{ id: "fb-page-456" }] });

    assert.strictEqual(
      processor.verify(payload, "", secret),
      false,
      "Facebook: missing signature must be rejected"
    );
  });

  it("scenario 3b: completely wrong signature value → rejected", () => {
    const payload = JSON.stringify({ object: "page", entry: [{ id: "fb-page-789" }] });
    const wrongSig = "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    assert.strictEqual(
      processor.verify(payload, wrongSig, secret),
      false,
      "Facebook: wrong signature must be rejected"
    );
  });
});

describe(
  "Webhook signature verification — YouTubeWebhookProcessor (SHA-1)",
  { concurrency: 1 },
  () => {
    const secret = "youtube-pubsubhubbub-secret-yt";
    let processor: YouTubeWebhookProcessor;

    let _originalConsoleLog: typeof console.log;
    before(() => {
      _originalConsoleLog = console.log;
      console.log = () => {};
    });
    after(() => {
      console.log = _originalConsoleLog;
    });

    beforeEach(() => {
      processor = new YouTubeWebhookProcessor();
    });

    function signYouTube(rawBody: string, s: string): string {
      return "sha1=" + createHmac("sha1", s).update(rawBody, "utf8").digest("hex");
    }

    it("scenario 1: valid Atom feed payload with correct SHA-1 signature → accepted", () => {
      const atomPayload =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">` +
        `<entry><yt:videoId>dQw4w9WgXcQ</yt:videoId></entry></feed>`;
      const signature = signYouTube(atomPayload, secret);

      assert.strictEqual(
        processor.verify(atomPayload, signature, secret),
        true,
        "YouTube: valid sha1-hex signature must be accepted"
      );
    });

    it("scenario 2: tampered Atom body (video ID changed after signing) → rejected", () => {
      const originalPayload = `<feed><entry><yt:videoId>original-video-id</yt:videoId></entry></feed>`;
      const signature = signYouTube(originalPayload, secret);

      const tamperedPayload = `<feed><entry><yt:videoId>EVIL-REPLACED-ID</yt:videoId></entry></feed>`;

      assert.strictEqual(
        processor.verify(tamperedPayload, signature, secret),
        false,
        "YouTube: tampered Atom body must be rejected"
      );
    });

    it("scenario 3: missing X-Hub-Signature header (empty string) → rejected", () => {
      const payload = `<feed><entry><yt:videoId>another-video-id</yt:videoId></entry></feed>`;

      assert.strictEqual(
        processor.verify(payload, "", secret),
        false,
        "YouTube: missing signature must be rejected"
      );
    });

    it("scenario 3b: X-Hub-Signature header present but all-zero value → rejected", () => {
      const payload = `<feed><entry><yt:videoId>zero-sig-video</yt:videoId></entry></feed>`;
      const zeroSig = "sha1=0000000000000000000000000000000000000000";

      assert.strictEqual(
        processor.verify(payload, zeroSig, secret),
        false,
        "YouTube: all-zero sha1 signature must be rejected"
      );
    });

    it("rejects a SHA-256 signature (wrong algorithm) even if hex matches in length", () => {
      const payload = `<feed><entry><yt:videoId>video-sha256-attempt</yt:videoId></entry></feed>`;
      const sha256Sig =
        "sha1=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex");

      assert.strictEqual(
        processor.verify(payload, sha256Sig, secret),
        false,
        "YouTube: SHA-256 signature (wrong algorithm) must be rejected"
      );
    });

    it("rejects signature computed with wrong secret", () => {
      const payload = `<feed><entry><yt:videoId>wrong-secret-video</yt:videoId></entry></feed>`;
      const wrongSecretSig = signYouTube(payload, "attacker-wrong-secret");

      assert.strictEqual(
        processor.verify(payload, wrongSecretSig, secret),
        false,
        "YouTube: wrong-secret SHA-1 signature must be rejected"
      );
    });
  }
);
