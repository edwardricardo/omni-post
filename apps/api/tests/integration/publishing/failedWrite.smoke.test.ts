/**
 * @file failedWrite.smoke.test.ts
 * @description E2E smoke — circuit-breaker write fail-fast policy (PR3).
 *
 *   PR2 proved each provider's apiClient rejects on HTTP failure at the
 *   UNIT level (sdk-mocked). This file proves the same contract END-TO-END:
 *   the real provider ADAPTER (one level above the apiClient) is driven
 *   through the real circuit-breaker with the outbound HTTP intercepted
 *   by MSW's Node server, which patches both `fetch` (Telegram, LinkedIn)
 *   and Node's `https.request` (twitter-api-v2).
 *
 *   The critical assertion is NOT just "rejects" but specifically that the
 *   adapter's Result is `err(...)` — NOT `ok({ providerPostId: "queued", ... })`.
 *   Any re-introduction of a write-path fallback would cause the adapter to
 *   resolve with a synthetic receipt, flipping `result.ok` to `true` and
 *   breaking these assertions (RED state).
 *
 *   Providers covered:
 *   - Telegram (send-message, fetch-based) — primary smoke
 *   - LinkedIn (create-post, fetch-based)  — secondary smoke
 *
 *   Pre-requisites: none — MSW intercepts HTTP at the Node level; no live
 *   APIs, no Docker, no Redis connection needed (fallbackEnabled:false means
 *   the FallbackManager's lazyConnect Redis is never touched).
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { resetFallbackManager } from "@adapters/fallback-strategies";
import { TelegramAdapter } from "@providers/telegram";
import { LinkedInAdapter } from "@providers/linkedin";
import type { PublishInput } from "@ports/core";

// ---------------------------------------------------------------------------
// MSW server — intercepts ALL outbound HTTP for both providers
// ---------------------------------------------------------------------------

const server = setupServer(
  // Telegram Bot API — any method under the bot token path
  http.post(/https:\/\/api\.telegram\.org\/bot.*\/.*/, () =>
    HttpResponse.json(
      { ok: false, error_code: 503, description: "Service Unavailable" },
      { status: 503 }
    )
  ),

  // LinkedIn Posts API
  http.post("https://api.linkedin.com/rest/posts", () =>
    HttpResponse.json({ message: "Service Unavailable" }, { status: 503 })
  ),

  // LinkedIn media upload endpoints (initializeUpload, binary upload)
  http.post(/https:\/\/api\.linkedin\.com\/.*/, () =>
    HttpResponse.json({ message: "Service Unavailable" }, { status: 503 })
  ),

  // X / twitter-api-v2 — tweets endpoint (https.request via ClientRequestInterceptor)
  http.post(/https:\/\/api\.x\.com\/.*/, () =>
    HttpResponse.json({ title: "Service Unavailable", status: 503 }, { status: 503 })
  )
);

// ---------------------------------------------------------------------------
// Minimal PublishInput factories
// ---------------------------------------------------------------------------

function makeTelegramInput(): PublishInput {
  return {
    channelId: "smoke-channel-telegram",
    dedupeKey: "smoke-tg-1",
    post: {
      body: "Smoke test message — fail-fast verification",
    },
  };
}

function makeLinkedInInput(): PublishInput {
  return {
    channelId: "smoke-channel-linkedin",
    dedupeKey: "smoke-li-1",
    post: {
      body: "Smoke test post — fail-fast verification",
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("circuit-breaker write fail-fast — E2E smoke (PR3)", () => {
  before(() => {
    // onUnhandledRequest: "warn" so we don't fail if opossum / prom-client
    // makes internal calls we haven't intercepted.
    server.listen({ onUnhandledRequest: "warn" });
  });

  after(() => {
    server.close();
    resetFallbackManager();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Telegram (fetch-based, send-message path)
  // ──────────────────────────────────────────────────────────────────────────

  describe("TelegramAdapter.publish — 503 provider response", () => {
    it("returns err(…) — not ok({ providerPostId: 'queued', … })", async () => {
      const adapter = new TelegramAdapter();
      const credentials = { botToken: "123456:ABCDsmoketoken", chatId: "@smokechannel" };

      const result = await adapter.publish(makeTelegramInput(), credentials);

      // PRIMARY assertion: must NOT be a success receipt.
      // If fallbackEnabled were re-enabled for send-message (write path),
      // the adapter would resolve with ok({ providerPostId: "queued", ... })
      // — flipping ok to true and failing this assertion (RED).
      assert.strictEqual(
        result.ok,
        false,
        `TelegramAdapter.publish must return err on 503 provider response, ` +
          `but got ok=${result.ok} — check if fallbackEnabled was re-enabled for 'send-message'`
      );

      // Confirm the resolved value is not a synthetic queued receipt
      if (result.ok) {
        const receipt = result.value as { providerPostId?: string };
        assert.notEqual(
          receipt.providerPostId,
          "queued",
          "providerPostId must not be the synthetic 'queued' value"
        );
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // LinkedIn (fetch-based, create-post path)
  // ──────────────────────────────────────────────────────────────────────────

  describe("LinkedInAdapter.publish — 503 provider response", () => {
    it("returns err(…) — not ok({ providerPostId: 'queued', … })", async () => {
      const adapter = new LinkedInAdapter();
      const credentials = {
        accessToken: "smoke-access-token",
        refreshToken: "smoke-refresh-token",
        personUrn: "urn:li:person:smoke123",
      };

      const result = await adapter.publish(makeLinkedInInput(), credentials);

      // Same RED/GREEN logic as Telegram above.
      assert.strictEqual(
        result.ok,
        false,
        `LinkedInAdapter.publish must return err on 503 provider response, ` +
          `but got ok=${result.ok} — check if fallbackEnabled was re-enabled for 'create-post'`
      );

      if (result.ok) {
        const receipt = result.value as { providerPostId?: string };
        assert.notEqual(
          receipt.providerPostId,
          "queued",
          "providerPostId must not be the synthetic 'queued' value"
        );
      }
    });
  });
});
