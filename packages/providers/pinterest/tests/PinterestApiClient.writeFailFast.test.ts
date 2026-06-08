/**
 * @file PinterestApiClient.writeFailFast.test.ts
 * @description RED tests: verify that PinterestApiClient.createPin rejects on
 *              provider failure instead of resolving with a synthetic queued
 *              response. Drives the REAL PinterestApiClient through the circuit
 *              breaker, with fetch mocked to reject at the HTTP layer.
 *
 *              RED (before PR2): selectFallbackConfig returns SOCIAL_POST_FALLBACK
 *              for create-pin → resolves with queued response (test fails).
 *              GREEN (after PR2): create-pin gets no fallback → rejects (test passes).
 *
 * Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { PinterestApiClient } from "../src/apiClient.js";

const NON_RETRYABLE_ERROR = new Error("mock provider failure — non-retryable");

function mockFetchReject() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(NON_RETRYABLE_ERROR));
}

const CREDS = {
  accessToken: "test-access-token",
  username: "testuser",
};

const CREATE_PIN_PARAMS = {
  board_id: "test-board-id",
  title: "Test Pin",
  description: "Test pin description",
  media_source: {
    source_type: "image_url" as const,
    url: "https://example.com/image.jpg",
  },
};

describe("PinterestApiClient.createPin — write fail-fast (R2-F)", { concurrent: false }, () => {
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
    const apiClient = new PinterestApiClient(CREDS);

    // RED: selectFallbackConfig returns SOCIAL_POST_FALLBACK for create-pin
    //      and makeRequest has fallbackEnabled:true → resolves (test fails).
    // GREEN: makeRequest removed from create-pin, no fallback opts → rejects (test passes).
    await assert.rejects(
      () => apiClient.createPin(CREATE_PIN_PARAMS),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });

  it("does NOT return a synthetic {id:'queued'} pin ID on failure", async () => {
    const apiClient = new PinterestApiClient(CREDS);

    let resolved: unknown;
    let rejected = false;

    try {
      resolved = await apiClient.createPin(CREATE_PIN_PARAMS);
    } catch {
      rejected = true;
    }

    assert.ok(
      rejected,
      `createPin must reject on failure, but resolved with: ${JSON.stringify(resolved)}`
    );
  });
});
