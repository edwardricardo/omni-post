/**
 * @file FacebookApiClient.writeFailFast.test.ts
 * @description RED tests: verify that FacebookApiClient.postToPage rejects on
 *              provider failure instead of resolving with a synthetic queued
 *              response. Drives the REAL FacebookApiClient through the circuit
 *              breaker, with fetch mocked to reject at the HTTP layer.
 *
 *              RED (before PR2): fallbackEnabled:true + SOCIAL_POST_FALLBACK
 *              resolves → assert.rejects fails.
 *              GREEN (after PR2): fallback opts removed, rejects → passes.
 *
 * Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { FacebookApiClient } from "../src/apiClient.js";

const NON_RETRYABLE_ERROR = new Error("mock provider failure — non-retryable");

function mockFetchReject() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(NON_RETRYABLE_ERROR));
}

const CREDS = {
  accessToken: "test-access-token",
  pageId: "test-page-id",
  appId: "test-app-id",
  appSecret: "test-app-secret",
};

describe("FacebookApiClient.postToPage — write fail-fast (R2-B)", { concurrent: false }, () => {
  beforeAll(() => {
    mockFetchReject();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFetchReject();
  });

  it("rejects when provider HTTP call fails (must not resolve with queued response)", async () => {
    const apiClient = new FacebookApiClient(CREDS);

    // RED: with fallbackEnabled:true + SOCIAL_POST_FALLBACK → resolves (test fails).
    // GREEN: fallback opts removed → rejects (test passes).
    await assert.rejects(
      () => apiClient.postToPage("Hello world"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });

  it("does NOT return a synthetic {id:'queued'} post ID on failure", async () => {
    const apiClient = new FacebookApiClient(CREDS);

    let resolved: unknown;
    let rejected = false;

    try {
      resolved = await apiClient.postToPage("test post");
    } catch {
      rejected = true;
    }

    assert.ok(
      rejected,
      `postToPage must reject on failure, but resolved with: ${JSON.stringify(resolved)}`
    );
  });
});
