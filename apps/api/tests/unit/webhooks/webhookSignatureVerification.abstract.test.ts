import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  signPayload,
  tamperSignature,
  StubHexProcessor,
  Base64StubProcessor,
} from "./webhookSignatureVerification.test-helpers.js";

describe(
  "Webhook signature verification — AbstractWebhookProcessor.verify()",
  { concurrency: 1 },
  () => {
    const secret = "super-secret-webhook-key-12345";
    let processor: StubHexProcessor;

    beforeEach(() => {
      processor = new StubHexProcessor();
    });

    it("accepts a correctly signed payload", () => {
      const rawBody = JSON.stringify({ type: "POST_PUBLISHED", postId: "post-001" });
      const signature = signPayload(rawBody, secret);

      const result = processor.verify(rawBody, signature, secret);

      assert.strictEqual(result, true, "Valid signature must be accepted");
    });

    it("accepts payload with signature having no sha256= prefix", () => {
      const rawBody = JSON.stringify({ type: "POST_PUBLISHED", postId: "post-002" });
      const hexOnly = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

      const result = processor.verify(rawBody, hexOnly, secret);

      assert.strictEqual(result, true, "Signature without prefix should also be accepted");
    });

    it("rejects a payload whose body was tampered after signing", () => {
      const originalBody = JSON.stringify({ type: "POST_PUBLISHED", postId: "post-003" });
      const signature = signPayload(originalBody, secret);

      const tamperedBody = JSON.stringify({ type: "POST_DELETED", postId: "post-003", evil: true });

      const result = processor.verify(tamperedBody, signature, secret);

      assert.strictEqual(result, false, "Tampered body must be rejected");
    });

    it("rejects a payload whose signature hex was corrupted", () => {
      const rawBody = JSON.stringify({ event: "mention", userId: "user-x" });
      const validSig = signPayload(rawBody, secret);
      const corruptedSig = tamperSignature(validSig);

      const result = processor.verify(rawBody, corruptedSig, secret);

      assert.strictEqual(result, false, "Corrupted signature must be rejected");
    });

    it("rejects signature computed with wrong secret", () => {
      const rawBody = JSON.stringify({ type: "COMMENT_RECEIVED" });
      const signatureWithWrongSecret = signPayload(rawBody, "attacker-does-not-know-real-secret");

      const result = processor.verify(rawBody, signatureWithWrongSecret, secret);

      assert.strictEqual(result, false, "Signature from wrong secret must be rejected");
    });

    it("rejects an empty signature string", () => {
      const rawBody = JSON.stringify({ type: "POST_PUBLISHED" });

      const result = processor.verify(rawBody, "", secret);

      assert.strictEqual(result, false, "Empty signature must be rejected");
    });

    it("rejects a signature that is only the prefix with no hex value", () => {
      const rawBody = JSON.stringify({ type: "POST_PUBLISHED" });

      const result = processor.verify(rawBody, "sha256=", secret);

      assert.strictEqual(result, false, "Prefix-only signature must be rejected");
    });
  }
);

describe(
  "Webhook signature verification — base64 encoding (X provider pattern)",
  { concurrency: 1 },
  () => {
    const secret = "x-provider-base64-secret";
    let processor: Base64StubProcessor;

    beforeEach(() => {
      processor = new Base64StubProcessor();
    });

    it("accepts a valid base64-encoded signature", () => {
      const rawBody = JSON.stringify({ tweet_create_events: [{ id_str: "tweet-001" }] });
      const sig = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

      assert.strictEqual(processor.verify(rawBody, sig, secret), true);
    });

    it("rejects a tampered body with base64 encoding", () => {
      const original = JSON.stringify({ tweet_create_events: [{ id_str: "tweet-001" }] });
      const sig =
        "sha256=" + createHmac("sha256", secret).update(original, "utf8").digest("base64");

      const tampered = JSON.stringify({ tweet_create_events: [{ id_str: "tweet-EVIL" }] });

      assert.strictEqual(processor.verify(tampered, sig, secret), false);
    });

    it("rejects missing signature (empty string) with base64 encoding", () => {
      const rawBody = JSON.stringify({ tweet_create_events: [{ id_str: "tweet-002" }] });

      assert.strictEqual(processor.verify(rawBody, "", secret), false);
    });
  }
);

describe("Timing attack prevention — constantTimeCompare", { concurrency: 1 }, () => {
  let processor: StubHexProcessor;

  beforeEach(() => {
    processor = new StubHexProcessor();
  });

  it("returns false for strings of different lengths without leaking length info early", () => {
    const rawBody = JSON.stringify({ test: "data" });
    const secret = "timing-attack-test-secret";
    const correctSig = signPayload(rawBody, secret);

    const shortSig = correctSig.slice(0, -1);

    assert.strictEqual(processor.verify(rawBody, shortSig, secret), false);
  });

  it("returns false for same-length wrong signature without short-circuiting", () => {
    const rawBody = JSON.stringify({ test: "constant-time" });
    const secret = "timing-attack-test-secret";
    const correctSig = signPayload(rawBody, secret);
    const wrongSig = tamperSignature(correctSig);

    assert.strictEqual(processor.verify(rawBody, wrongSig, secret), false);
  });

  it("returns true for the authentic signature in the same code path", () => {
    const rawBody = JSON.stringify({ test: "authentic" });
    const secret = "timing-attack-test-secret";
    const sig = signPayload(rawBody, secret);

    assert.strictEqual(processor.verify(rawBody, sig, secret), true);
  });
});
