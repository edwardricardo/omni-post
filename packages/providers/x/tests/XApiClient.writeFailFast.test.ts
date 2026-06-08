/**
 * @file XApiClient.writeFailFast.test.ts
 * @description RED tests: verify that XApiClient.postTweet rejects on provider
 *              failure instead of resolving with a synthetic queued response.
 *              Drives the REAL XApiClient through the circuit breaker, with the
 *              twitter-api-v2 library mocked to reject at the SDK layer.
 *
 *              RED state (before PR2): fallbackEnabled:true + SOCIAL_POST_FALLBACK
 *              resolves with {data:{id:"queued",...}} — assert.rejects fails.
 *              GREEN state (after PR2): fallback opts removed, breaker rejects —
 *              assert.rejects passes.
 *
 * Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

// ─── Mock twitter-api-v2 ───────────────────────────────────────────────────
// The XApiClient constructs a TwitterApi instance from the bearer token.
// We replace the module so .v2.me() and .v2.tweet() reject immediately.
const mockTweetFn = vi.fn().mockRejectedValue(new Error("mock provider failure — non-retryable"));
const mockMeFn = vi.fn().mockRejectedValue(new Error("mock provider failure — non-retryable"));

vi.mock("twitter-api-v2", () => ({
  TwitterApi: class {
    v2 = {
      me: mockMeFn,
      tweet: mockTweetFn,
      search: vi.fn().mockRejectedValue(new Error("mock")),
      deleteTweet: vi.fn().mockRejectedValue(new Error("mock")),
    };
    v1 = {
      uploadMedia: vi.fn().mockRejectedValue(new Error("mock")),
    };
  },
}));

// Import AFTER mocking
import { XApiClient } from "../src/apiClient.js";

const CREDS = {
  apiKey: "test-key",
  apiSecret: "test-secret",
  accessToken: "test-access-token",
  accessTokenSecret: "test-access-secret",
  bearerToken: "test-bearer",
};

// ─────────────────────────────────────────────────────────────────────────────
// postTweet — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("XApiClient.postTweet — write fail-fast (R2-A)", { concurrent: false }, () => {
  beforeAll(() => {
    mockTweetFn.mockRejectedValue(new Error("mock provider failure — non-retryable"));
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore mock after clearAllMocks clears call counts but not implementation
    mockTweetFn.mockRejectedValue(new Error("mock provider failure — non-retryable"));
  });

  it("rejects when twitter-api-v2 fails (must not resolve with queued response)", async () => {
    const apiClient = new XApiClient(CREDS);

    // RED: with fallbackEnabled:true + SOCIAL_POST_FALLBACK, resolves → test fails.
    // GREEN: with fallback opts removed, rejects → test passes.
    await assert.rejects(
      () => apiClient.postTweet("Hello world"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });

  it("does NOT return a synthetic {id:'queued'} response on failure", async () => {
    const apiClient = new XApiClient(CREDS);

    let resolved: unknown;
    let rejected = false;

    try {
      resolved = await apiClient.postTweet("test tweet");
    } catch {
      rejected = true;
    }

    assert.ok(
      rejected,
      `postTweet must reject on failure, but it resolved with: ${JSON.stringify(resolved)}`
    );
  });
});
