/**
 * @file verifyWithGraceWindow.test.ts
 * @description Golden-case tests for the grace-window-aware HMAC
 *              verifier. Pure function — no Prisma, no logger. Covers
 *              the four observable branches: in-window, expired,
 *              out-of-window, and invalid-signature.
 * @layer infrastructure
 */

import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { verifyWithGraceWindow } from "../../../src/webhooks/webhookHandlerCore.js";
import type { WebhookProcessor } from "../../../src/webhooks/webhookTypes.js";

const PAYLOAD = "{}";
const SIGNATURE = "sha256=abc";
const HEADERS = { "x-hub-signature-256": SIGNATURE };
const NOW = new Date("2026-05-06T12:00:00.000Z");

function makeProcessor(validFor: ReadonlySet<string>): WebhookProcessor {
  const verify = vi.fn((_payload: string, _signature: string, secret: string) =>
    validFor.has(secret)
  );
  return {
    verify,
    parse: vi.fn(),
    extractEventId: vi.fn(),
  } as unknown as WebhookProcessor;
}

describe("verifyWithGraceWindow", () => {
  it("accepts when signature matches the active secretKey (no grace fallback used)", () => {
    const processor = makeProcessor(new Set(["new-secret"]));
    const result = verifyWithGraceWindow({
      processor,
      payload: PAYLOAD,
      signature: SIGNATURE,
      headers: HEADERS,
      subscription: {
        id: "s1",
        secretKey: "new-secret",
        previousSecretKey: "old-secret",
        previousSecretKeyExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      },
      now: NOW,
    });
    assert.equal(result.isValid, true);
    assert.equal(result.acceptedViaPrevious, false);
    assert.equal((processor.verify as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });

  it("falls back to previousSecretKey when grace window is open and old signature matches", () => {
    const processor = makeProcessor(new Set(["old-secret"]));
    const result = verifyWithGraceWindow({
      processor,
      payload: PAYLOAD,
      signature: SIGNATURE,
      headers: HEADERS,
      subscription: {
        id: "s1",
        secretKey: "new-secret",
        previousSecretKey: "old-secret",
        previousSecretKeyExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      },
      now: NOW,
    });
    assert.equal(result.isValid, true);
    assert.equal(result.acceptedViaPrevious, true);
    assert.equal((processor.verify as ReturnType<typeof vi.fn>).mock.calls.length, 2);
  });

  it("REJECTS when previousSecretKey signature is valid but window already expired", () => {
    const processor = makeProcessor(new Set(["old-secret"]));
    const result = verifyWithGraceWindow({
      processor,
      payload: PAYLOAD,
      signature: SIGNATURE,
      headers: HEADERS,
      subscription: {
        id: "s1",
        secretKey: "new-secret",
        previousSecretKey: "old-secret",
        previousSecretKeyExpiresAt: new Date(NOW.getTime() - 1),
      },
      now: NOW,
    });
    assert.equal(result.isValid, false);
    assert.equal(result.acceptedViaPrevious, false);
    assert.equal((processor.verify as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });

  it("rejects when both secrets fail (invalid signature)", () => {
    const processor = makeProcessor(new Set());
    const result = verifyWithGraceWindow({
      processor,
      payload: PAYLOAD,
      signature: SIGNATURE,
      headers: HEADERS,
      subscription: {
        id: "s1",
        secretKey: "new-secret",
        previousSecretKey: "old-secret",
        previousSecretKeyExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      },
      now: NOW,
    });
    assert.equal(result.isValid, false);
    assert.equal(result.acceptedViaPrevious, false);
    assert.equal((processor.verify as ReturnType<typeof vi.fn>).mock.calls.length, 2);
  });

  it("rejects without trying previous when no rotation is in progress", () => {
    const processor = makeProcessor(new Set());
    const result = verifyWithGraceWindow({
      processor,
      payload: PAYLOAD,
      signature: SIGNATURE,
      headers: HEADERS,
      subscription: {
        id: "s1",
        secretKey: "new-secret",
        previousSecretKey: null,
        previousSecretKeyExpiresAt: null,
      },
      now: NOW,
    });
    assert.equal(result.isValid, false);
    assert.equal(result.acceptedViaPrevious, false);
    assert.equal((processor.verify as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });

  it("rejects exactly at expiresAt boundary (window is exclusive of equality)", () => {
    const processor = makeProcessor(new Set(["old-secret"]));
    const result = verifyWithGraceWindow({
      processor,
      payload: PAYLOAD,
      signature: SIGNATURE,
      headers: HEADERS,
      subscription: {
        id: "s1",
        secretKey: "new-secret",
        previousSecretKey: "old-secret",
        previousSecretKeyExpiresAt: new Date(NOW.getTime()),
      },
      now: NOW,
    });
    assert.equal(result.isValid, false);
    assert.equal(result.acceptedViaPrevious, false);
  });
});
