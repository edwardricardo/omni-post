/**
 * @file TelegramAdapter.publish.msw.test.ts
 * @description Proof-of-concept MSW contract test for TelegramAdapter. Uses
 *   MSW (Mock Service Worker) handlers to intercept the REAL HTTP calls
 *   made by `TelegramApiClient.callApi(...)` against `api.telegram.org`,
 *   en lugar del patrón histórico `vi.fn()` + factory injection.
 *
 *   Establecido en §3.2 Phase A1 del Normalization Roadmap como pattern
 *   reference. Coexiste con `TelegramAdapter.test.ts` (vi.fn() pattern)
 *   sin reemplazarlo — migración progresiva en §3.2.b.
 *
 *   Ventajas del MSW pattern vs vi.fn():
 *   - Ejerce el adapter+apiClient stack completo (parsing, error handling,
 *     URL construction) — no solo la lógica del adapter.
 *   - Fixtures HTTP reutilizables entre tests (contract fixtures).
 *   - Más resiliente a refactors internos del apiClient — el contrato
 *     externo (HTTP) es lo que importa.
 *
 *   Desventajas:
 *   - Más brittle si Telegram cambia el HTTP shape — bueno, lo queremos
 *     atrapar.
 *   - Setup más pesado (server.listen/close en hooks).
 *
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  createProviderMockServer,
  http,
  HttpResponse,
} from "@providers/shared/test-utils/msw-helpers.js";
import { TelegramAdapter } from "../src/TelegramAdapter.js";
import type { TelegramCredentials } from "../src/apiClient.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

const VALID_CREDS: TelegramCredentials = {
  botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  chatId: "@testchannel",
};

const TELEGRAM_BASE = "https://api.telegram.org";

function rendered(overrides: Partial<RenderedPost> = {}): RenderedPost {
  return { body: "Hello from MSW!", meta: {}, ...overrides };
}

function input(rOverrides: Partial<RenderedPost> = {}): PublishInput {
  return {
    channelId: "channel-tg-msw",
    post: rendered(rOverrides),
    dedupeKey: `dedupe-tg-msw-${Date.now()}`,
  };
}

// ─── MSW server lifecycle ──────────────────────────────────────────────────
//
// MSW node intercepts ALL fetch() calls in the process. `onUnhandledRequest:
// 'error'` makes the test FAIL if the adapter makes any HTTP call that we
// didn't declare a handler for — exactly what we want for a contract test.

const server = createProviderMockServer([
  http.post(`${TELEGRAM_BASE}/bot${VALID_CREDS.botToken}/sendMessage`, async () => {
    return HttpResponse.json({
      ok: true,
      result: {
        message_id: 42,
        chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
        date: 1705312800,
        text: "Hello from MSW!",
      },
    });
  }),
]);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("TelegramAdapter.publish — MSW contract", () => {
  it("publishes a text message and parses the response shape", async () => {
    const adapter = new TelegramAdapter(); // uses default apiClientFactory → real HTTP via fetch

    const result = await adapter.publish(input(), VALID_CREDS);

    assert.ok(result.ok, `Publish should succeed, got error: ${JSON.stringify(result)}`);
    const val = result.value;
    assert.ok(val.providerPostId, "Should have providerPostId");
    assert.strictEqual(val.providerPostId, "42");
    assert.ok(val.publishedAt instanceof Date, "publishedAt should be a Date");
  });

  it("constructs the canonical Telegram Bot API URL with botToken + method", async () => {
    // Verifica que el adapter está hitting el endpoint correcto (bot{token}/sendMessage)
    // — si Telegram cambia el path schema, esto rompe primero. El test de éxito de
    // arriba YA prueba esto implícitamente (si la URL fuera mal, el handler MSW
    // no matchearía y el `onUnhandledRequest: 'error'` haría fallar), pero acá lo
    // hacemos explícito grabando los requests.

    let capturedUrl = "";
    server.use(
      http.post(`${TELEGRAM_BASE}/bot${VALID_CREDS.botToken}/sendMessage`, async ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          ok: true,
          result: {
            message_id: 99,
            chat: { id: -1, title: "x", type: "channel" },
            date: 0,
            text: "x",
          },
        });
      })
    );

    const adapter = new TelegramAdapter();
    await adapter.publish(input(), VALID_CREDS);

    assert.strictEqual(
      capturedUrl,
      `${TELEGRAM_BASE}/bot${VALID_CREDS.botToken}/sendMessage`,
      "Adapter should hit the canonical Telegram Bot API path"
    );
  });
});

// Suppress canonical CanonicalPost import warning if unused — kept as
// reference for future tests that need to render before publish.
void ({} as CanonicalPost);
