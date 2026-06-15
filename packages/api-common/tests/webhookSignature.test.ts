/**
 * @file webhookSignature.test.ts
 * @description Tests for the framework-neutral webhook signature helpers —
 *              covers HMAC verification across SHA-256 / SHA-1, hex / base64
 *              encodings, prefix stripping, the constant-time comparator, and
 *              the silent-error contract (errors flow through `onError`,
 *              never thrown).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhookSignature, constantTimeCompare } from "../src/webhookSignature.js";

function sign(payload: string, secret: string, encoding: "hex" | "base64" = "hex"): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest(encoding);
}

describe("verifyWebhookSignature", () => {
  it("returns true when the HMAC-SHA256 hex signature matches", () => {
    const payload = '{"event":"ping"}';
    const secret = "test-secret";
    const signature = sign(payload, secret, "hex");
    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it("returns false when the signature does not match", () => {
    expect(verifyWebhookSignature("payload", "deadbeef".repeat(8), "secret")).toBe(false);
  });

  it("supports the base64 encoding", () => {
    const payload = "x";
    const secret = "s";
    const signature = sign(payload, secret, "base64");
    expect(verifyWebhookSignature(payload, signature, secret, { encoding: "base64" })).toBe(true);
  });

  it("strips a `sha256=` prefix when removePrefix is true (Instagram / Facebook)", () => {
    const payload = "{}";
    const secret = "fb";
    const signature = sign(payload, secret);
    expect(
      verifyWebhookSignature(payload, `sha256=${signature}`, secret, { removePrefix: true })
    ).toBe(true);
  });

  it("supports SHA-1 when explicitly requested", () => {
    const payload = "p";
    const secret = "s";
    const sha1 = createHmac("sha1", secret).update(payload, "utf8").digest("hex");
    expect(verifyWebhookSignature(payload, sha1, secret, { algorithm: "sha1" })).toBe(true);
  });

  it("never throws — returns false and forwards the error to onError", () => {
    const onError = vi.fn();
    const result = verifyWebhookSignature(
      "x",
      "y",
      "z",
      // Force crypto-level failure with a bogus algorithm cast through `never`.
      { algorithm: "not-a-real-algorithm" as never, onError }
    );
    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("constantTimeCompare", () => {
  it("returns true for byte-equal strings", () => {
    expect(constantTimeCompare("abc123", "abc123")).toBe(true);
  });

  it("returns false for differing strings of equal length", () => {
    expect(constantTimeCompare("abc123", "abc124")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(constantTimeCompare("abc", "abcd")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeCompare("", "")).toBe(true);
  });
});
