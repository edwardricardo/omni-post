/**
 * @file TelegramApiClient.cacheIsolation.test.ts
 * @description Cross-tenant cache-isolation anchor for the C1b per-site discriminant on Telegram
 *              (Spec C1-R1 scenario 3 + C1-R2 "PII sites are anchored by an isolation test").
 *              `validate-credentials` (getMe) and `get-chat-member` are `cacheEnabled:true` PII
 *              reads scoped to the bot token / chat. Bot B must NEVER receive bot A's cached
 *              identity, and a same-bot second read must still hit cache. Drives the REAL
 *              TelegramApiClient through the process-singleton circuit breaker with fetch mocked
 *              and routed by the bot token embedded in the request URL.
 *
 *              RED (before the C1b discriminant): a `cacheEnabled:true` read with NO discriminant
 *              fails safe (D1b) — the breaker skips L1, so the same-bot second read fetches fresh
 *              (two fetches) => the cache-hit assertion fails.
 *              GREEN (after `cacheKeyDiscriminant: hashCallScope(this.botToken, ...)`): bot A's
 *              distinct discriminant keys its own entry => the same-bot second read is served from
 *              cache (one fetch) while bot B, carrying a different discriminant, still fetches its
 *              own identity.
 *
 *              Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import { TelegramApiClient, type TelegramCredentials } from "../src/apiClient.js";

const CREDS_A: TelegramCredentials = {
  botToken: "111:token-A",
  chatId: "chat-A",
};

const CREDS_B: TelegramCredentials = {
  botToken: "222:token-B",
  chatId: "chat-B",
};

/**
 * Routes the mocked fetch by the bot token embedded in the outbound URL
 * (`/bot<token>/<method>`) so each bot resolves to its own identity (a PII proxy).
 */
function installRoutedFetch(): void {
  const routed = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    const isA = url.includes(`/bot${CREDS_A.botToken}/`);
    const botId = isA ? 111 : 222;
    if (url.endsWith("/getMe")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: { id: botId, is_bot: true, first_name: `bot-${botId}` },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith("/getChatMember")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            status: "administrator",
            user: { id: botId, is_bot: true, first_name: `bot-${botId}` },
          },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  vi.stubGlobal("fetch", vi.fn(routed));
}

describe("TelegramApiClient — cross-tenant cache isolation", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRoutedFetch();
    // Isolate from any breaker cache state leaked by a prior test in this file.
    new TelegramApiClient(CREDS_A).clearCache();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("never serves bot A's cached identity to bot B (validate-credentials)", async () => {
    const a = await new TelegramApiClient(CREDS_A).validateCredentials();
    const b = await new TelegramApiClient(CREDS_B).validateCredentials();

    assert.strictEqual(a.id, 111, "bot A receives its own identity");
    assert.strictEqual(
      b.id,
      222,
      "bot B must receive its OWN identity, never bot A's cached getMe payload"
    );
  });

  it("still serves the same bot's cache within TTL (validate-credentials, no perf regression)", async () => {
    const first = await new TelegramApiClient(CREDS_A).validateCredentials();
    const second = await new TelegramApiClient(CREDS_A).validateCredentials();

    assert.strictEqual(first.id, 111);
    assert.strictEqual(second.id, 111);
    const fetchMock = fetch as unknown as { mock: { calls: unknown[] } };
    assert.strictEqual(
      fetchMock.mock.calls.length,
      1,
      "the same-bot second validate call must be served from cache (one fetch only)"
    );
  });

  it("never serves bot A's cached chat-member payload to bot B (get-chat-member)", async () => {
    const a = await new TelegramApiClient(CREDS_A).getChatMember(111);
    const b = await new TelegramApiClient(CREDS_B).getChatMember(222);

    assert.strictEqual(a.user.id, 111, "bot A receives its own chat-member payload");
    assert.strictEqual(
      b.user.id,
      222,
      "bot B must receive its OWN chat-member payload, never bot A's cached one"
    );
  });
});
