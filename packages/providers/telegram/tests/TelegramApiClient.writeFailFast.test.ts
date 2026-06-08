/**
 * @file TelegramApiClient.writeFailFast.test.ts
 * @description RED tests: verify that Telegram write methods (sendMessage, sendPhoto,
 *              sendPoll, sendDocument, sendAudio) reject on provider failure instead of
 *              resolving with a synthetic queued response. These tests drive the REAL
 *              TelegramApiClient through the circuit breaker, with fetch mocked to return
 *              a non-retryable error at the HTTP layer.
 *
 *              RED state (before PR2): fallbackEnabled:true + SOCIAL_POST_FALLBACK makes
 *              the breaker resolve with {data:{id:"queued",...}} — assert.rejects fails.
 *              GREEN state (after PR2): fallback opts removed, breaker rejects with the
 *              original error — assert.rejects passes.
 *
 * Tier 0: no external services needed. No Redis, no live Telegram API.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { TelegramApiClient } from "../src/apiClient.js";

// ─── Non-retryable mock fetch ──────────────────────────────────────────────
// A generic Error (no .status, no ECONNRESET/ENOTFOUND) is treated as
// non-retryable by isRetryableError, so the breaker exits immediately
// without waiting for backoff delays.
const NON_RETRYABLE_ERROR = new Error("mock provider failure — non-retryable");

function mockFetchReject() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(NON_RETRYABLE_ERROR));
}

function restoreFetch() {
  vi.unstubAllGlobals();
}

const CREDS = {
  botToken: "123456:ABCDEFtesttoken",
  chatId: "@testchannel",
};

// ─────────────────────────────────────────────────────────────────────────────
// sendMessage — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("TelegramApiClient.sendMessage — write fail-fast (R2-E)", { concurrent: false }, () => {
  beforeAll(() => {
    mockFetchReject();
  });

  afterAll(() => {
    restoreFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when provider HTTP call fails (must not resolve with queued response)", async () => {
    const apiClient = new TelegramApiClient(CREDS);

    // RED: with fallbackEnabled:true + SOCIAL_POST_FALLBACK, this resolves → test fails.
    // GREEN: with fallback opts removed, this rejects → test passes.
    await assert.rejects(
      () => apiClient.sendMessage("Hello world"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        // Must NOT be the synthetic queued response — if the fallback fires,
        // the resolved value is {data:{id:"queued",...}}, NOT an Error.
        assert.ok(
          !("data" in (thrown as Record<string, unknown>)) ||
            (thrown as Record<string, unknown> & { data?: { id?: string } }).data?.id !== "queued",
          "sendMessage must not resolve with a queued/synthetic response"
        );
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendPhoto — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("TelegramApiClient.sendPhoto — write fail-fast (R2-E)", { concurrent: false }, () => {
  beforeAll(() => {
    mockFetchReject();
  });

  afterAll(() => {
    restoreFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when provider HTTP call fails", async () => {
    const apiClient = new TelegramApiClient(CREDS);

    await assert.rejects(
      () => apiClient.sendPhoto("https://example.com/photo.jpg", "caption"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendPoll — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("TelegramApiClient.sendPoll — write fail-fast (R2-E)", { concurrent: false }, () => {
  beforeAll(() => {
    mockFetchReject();
  });

  afterAll(() => {
    restoreFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when provider HTTP call fails", async () => {
    const apiClient = new TelegramApiClient(CREDS);

    await assert.rejects(
      () => apiClient.sendPoll("Question?", ["Yes", "No"]),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendDocument — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("TelegramApiClient.sendDocument — write fail-fast (R2-E)", { concurrent: false }, () => {
  beforeAll(() => {
    mockFetchReject();
  });

  afterAll(() => {
    restoreFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when provider HTTP call fails", async () => {
    const apiClient = new TelegramApiClient(CREDS);

    await assert.rejects(
      () => apiClient.sendDocument("https://example.com/doc.pdf"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendAudio — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("TelegramApiClient.sendAudio — write fail-fast (R2-E)", { concurrent: false }, () => {
  beforeAll(() => {
    mockFetchReject();
  });

  afterAll(() => {
    restoreFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when provider HTTP call fails", async () => {
    const apiClient = new TelegramApiClient(CREDS);

    await assert.rejects(
      () => apiClient.sendAudio("https://example.com/audio.mp3"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });
});
