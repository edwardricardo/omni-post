/**
 * @file inboundWebhookProviders.test.ts
 * @description Verifies the centralized inbound-webhook capability source: the 7
 *              providers with a real inbound HTTP webhook channel return true, the
 *              4 without (snapchat/pinterest/bluesky/linkedin) return false, and
 *              the check is case-insensitive (accepts the Prisma enum casing).
 * @layer infrastructure
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { supportsInboundWebhooks, INBOUND_WEBHOOK_PROVIDERS } from "@shared/types";

describe("supportsInboundWebhooks", () => {
  it("returns true for the 7 providers with a real inbound webhook channel", () => {
    for (const p of ["instagram", "facebook", "threads", "x", "youtube", "tiktok", "telegram"]) {
      assert.strictEqual(supportsInboundWebhooks(p), true, `${p} should support inbound webhooks`);
    }
  });

  it("returns false for providers without an inbound HTTP webhook channel", () => {
    for (const p of ["snapchat", "pinterest", "bluesky", "linkedin"]) {
      assert.strictEqual(
        supportsInboundWebhooks(p),
        false,
        `${p} should NOT support inbound webhooks`
      );
    }
  });

  it("is case-insensitive (accepts the Prisma enum casing)", () => {
    assert.strictEqual(supportsInboundWebhooks("INSTAGRAM"), true);
    assert.strictEqual(supportsInboundWebhooks("SNAPCHAT"), false);
  });

  it("exposes exactly the 7 webhook-capable providers", () => {
    assert.strictEqual(INBOUND_WEBHOOK_PROVIDERS.size, 7);
  });
});
