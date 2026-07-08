/**
 * @file TikTokAuthService.cacheIsolation.test.ts
 * @description Cross-tenant cache-isolation anchor for the C1b per-site discriminant on the
 *              TikTok auth service (Spec C1-R1 scenario 3 + C1-R2 "PII sites are anchored").
 *              `get-user-profile` is a `cacheEnabled:true` PII READ (NOT a token op) scoped by
 *              the per-call access token. Account B must NEVER receive account A's cached profile.
 *              Uses the REAL process-singleton circuit breaker (only axios is mocked, routed by
 *              the outbound Bearer token) so the test exercises the actual breaker keying — where
 *              a discriminant-less call would share one breaker instance whose bound closure is
 *              the FIRST caller's, returning account A's profile to account B.
 *
 *              RED (before the C1b discriminant): the shared breaker binds account A's closure =>
 *              account B's call runs A's closure => B receives A's profile.
 *              GREEN (after `cacheKeyDiscriminant: hashCallScope(accessToken, ...)`): B's distinct
 *              token keys its own breaker/entry => B fetches its own profile; a same-account second
 *              call is served from cache.
 *
 *              Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));

import axios from "axios";
import { TikTokAuthService, type TikTokOAuthConfig } from "../src/authService.js";

const mockedAxiosPost = vi.mocked(axios.post);

const CONFIG: TikTokOAuthConfig = {
  clientKey: "client-key",
  clientSecret: "client-secret",
  redirectUri: "https://example.com/callback",
  scopes: ["user.info.basic"],
};

interface AxiosConfig {
  headers?: Record<string, string>;
}

/**
 * Routes the mocked axios.post by the outbound Bearer token so each access token
 * resolves to its own TikTok profile (a PII payload proxy).
 */
function installRoutedAxios(): void {
  mockedAxiosPost.mockImplementation(
    async (_url: string, _body: unknown, config?: AxiosConfig): Promise<unknown> => {
      const auth = config?.headers?.Authorization ?? "";
      const openId = auth.includes("token-A")
        ? "open-A"
        : auth.includes("token-B")
          ? "open-B"
          : auth.includes("token-same")
            ? "open-same"
            : "open-unknown";
      return {
        data: {
          data: {
            user: {
              open_id: openId,
              union_id: `union-${openId}`,
              display_name: `Display ${openId}`,
            },
          },
        },
      };
    }
  );
}

describe("TikTokAuthService.getUserProfile — cross-tenant cache isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRoutedAxios();
  });

  it("never serves account A's cached profile to account B", async () => {
    const service = new TikTokAuthService(CONFIG);

    const a = await service.getUserProfile("token-A");
    const b = await service.getUserProfile("token-B");

    assert.strictEqual(a.openId, "open-A", "account A receives its own profile");
    assert.strictEqual(
      b.openId,
      "open-B",
      "account B must receive its OWN profile, never account A's cached/closure-bound payload"
    );
  });

  it("still serves the same account's cache within TTL (no perf regression)", async () => {
    const service = new TikTokAuthService(CONFIG);

    const first = await service.getUserProfile("token-same");
    const second = await service.getUserProfile("token-same");

    assert.strictEqual(first.openId, "open-same");
    assert.strictEqual(second.openId, "open-same");
    // Count only the user-info POSTs for this token: the same-account second
    // call must be served from cache (one profile fetch for token-same).
    const profileCalls = mockedAxiosPost.mock.calls.filter((c) =>
      ((c[2] as AxiosConfig | undefined)?.headers?.Authorization ?? "").includes("token-same")
    );
    assert.strictEqual(
      profileCalls.length,
      1,
      "the same-account second profile call must be served from cache (one axios POST only)"
    );
  });
});
