/**
 * @file InstagramApiClient.writeFailFast.test.ts
 * @description Verifies InstagramApiClient writes reject on provider failure instead of
 *              resolving with a synthetic queued response. Exercises createMediaContainer
 *              and publishMedia directly; the stories/reels container creators route
 *              through the same `makeRequest` fail-fast arm, so they share this guarantee.
 *              Drives the REAL InstagramApiClient through the circuit breaker, with fetch
 *              mocked to reject at the HTTP layer.
 *
 *              RED (before PR2): makeRequest sets fallbackEnabled:true + SOCIAL_POST_FALLBACK
 *              for create-container/publish-media → resolves (test fails).
 *              GREEN (after PR2): write ops get no fallback opts → rejects (test passes).
 *
 * Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { InstagramApiClient } from "../src/apiClient.js";

const NON_RETRYABLE_ERROR = new Error("mock provider failure — non-retryable");

function mockFetchReject() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(NON_RETRYABLE_ERROR));
}

const CREDS = {
  accessToken: "test-access-token",
  userId: "test-user-id",
};

// ─────────────────────────────────────────────────────────────────────────────
// createMediaContainer (create-container) — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe(
  "InstagramApiClient.createMediaContainer — write fail-fast (R2-C)",
  { concurrent: false },
  () => {
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
      const apiClient = new InstagramApiClient(CREDS);

      // RED: makeRequest sets SOCIAL_POST_FALLBACK for create-container → resolves (test fails).
      // GREEN: write ops use no fallback opts → rejects (test passes).
      await assert.rejects(
        () => apiClient.createMediaContainer("https://example.com/image.jpg"),
        (thrown: unknown) => {
          assert.ok(thrown instanceof Error, "must throw an Error");
          return true;
        }
      );
    });

    it("does NOT return a synthetic queued response on failure", async () => {
      const apiClient = new InstagramApiClient(CREDS);

      let resolved: unknown;
      let rejected = false;

      try {
        resolved = await apiClient.createMediaContainer("https://example.com/image.jpg");
      } catch {
        rejected = true;
      }

      assert.ok(
        rejected,
        `createMediaContainer must reject on failure, but resolved with: ${JSON.stringify(resolved)}`
      );
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// publishMedia (publish-media) — write must fail-fast
// ─────────────────────────────────────────────────────────────────────────────

describe("InstagramApiClient.publishMedia — write fail-fast (R2-C)", { concurrent: false }, () => {
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

  it("rejects when provider HTTP call fails", async () => {
    const apiClient = new InstagramApiClient(CREDS);

    await assert.rejects(
      () => apiClient.publishMedia("test-container-id"),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Error, "must throw an Error");
        return true;
      }
    );
  });
});
