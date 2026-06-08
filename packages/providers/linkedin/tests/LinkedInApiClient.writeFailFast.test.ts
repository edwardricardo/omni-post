/**
 * @file LinkedInApiClient.writeFailFast.test.ts
 * @description RED tests: verify that LinkedInApiClient.createPost rejects on
 *              provider failure instead of resolving with a synthetic queued
 *              response. Drives the REAL LinkedInApiClient through the circuit
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
import { LinkedInApiClient } from "../src/apiClient.js";

const NON_RETRYABLE_ERROR = new Error("mock provider failure — non-retryable");

function mockFetchReject() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(NON_RETRYABLE_ERROR));
}

const CREDS = {
  accessToken: "test-access-token",
  organizationUrn: "urn:li:organization:test-org",
  personUrn: "urn:li:person:test-person",
};

const PAYLOAD = {
  author: "urn:li:person:test-person",
  commentary: "Test post content",
  visibility: "PUBLIC",
  distribution: {
    feedDistribution: "MAIN_FEED",
    targetEntities: [] as never[],
    thirdPartyDistributionChannels: [] as never[],
  },
  lifecycleState: "PUBLISHED",
  isReshareDisabledByAuthor: false,
};

describe("LinkedInApiClient.createPost — write fail-fast (R2-F)", { concurrent: false }, () => {
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
    const apiClient = new LinkedInApiClient(CREDS);

    // RED: fallbackEnabled:true + SOCIAL_POST_FALLBACK → resolves (test fails).
    // GREEN: fallback opts removed → rejects (test passes).
    await assert.rejects(
      () => apiClient.createPost(PAYLOAD),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });

  it("does NOT return a synthetic {id:'queued'} post ID on failure", async () => {
    const apiClient = new LinkedInApiClient(CREDS);

    let resolved: unknown;
    let rejected = false;

    try {
      resolved = await apiClient.createPost(PAYLOAD);
    } catch {
      rejected = true;
    }

    assert.ok(
      rejected,
      `createPost must reject on failure, but resolved with: ${JSON.stringify(resolved)}`
    );
  });
});
