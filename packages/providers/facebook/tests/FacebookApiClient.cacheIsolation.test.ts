/**
 * @file FacebookApiClient.cacheIsolation.test.ts
 * @description Cross-tenant cache-isolation anchor for the confirmed leak (C1 / N-SEC-1):
 *              `facebook validate-credentials` returns the Page `access_token`. Account B must
 *              NEVER receive account A's cached token. Drives the REAL FacebookApiClient through
 *              the process-singleton circuit breaker, with fetch mocked and routed per pageId /
 *              debug_token so each account resolves to its OWN payload.
 *
 *              RED (before the flip): validate-credentials is `cacheEnabled:true` on a constant
 *              key => account B is served account A's cached payload => assertion fails.
 *              GREEN (after the flip to `cacheEnabled:false` + discriminant): B always fetches
 *              fresh => B receives B's own token.
 *
 *              Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import { FacebookApiClient } from "../src/apiClient.js";
import type { FacebookCredentials } from "../src/apiClientTypes.js";

const CREDS_A: FacebookCredentials = {
  accessToken: "fb-access-A",
  pageId: "fbpage-A",
  appId: "app-A",
  appSecret: "secret-A",
};

const CREDS_B: FacebookCredentials = {
  accessToken: "fb-access-B",
  pageId: "fbpage-B",
  appId: "app-B",
  appSecret: "secret-B",
};

const PAGE_TOKEN_A = "PAGE-TOKEN-A";
const PAGE_TOKEN_B = "PAGE-TOKEN-B";

/**
 * Routes the mocked fetch by URL: `/debug_token` => valid token; a URL bearing a
 * page id => that page's payload (each carrying its own Page `access_token`).
 */
function installRoutedFetch(): void {
  const routed = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/debug_token")) {
      return new Response(JSON.stringify({ data: { is_valid: true } }), { status: 200 });
    }
    if (url.includes(CREDS_A.pageId)) {
      return new Response(
        JSON.stringify({
          id: CREDS_A.pageId,
          name: "A",
          username: "a",
          access_token: PAGE_TOKEN_A,
        }),
        { status: 200 }
      );
    }
    if (url.includes(CREDS_B.pageId)) {
      return new Response(
        JSON.stringify({
          id: CREDS_B.pageId,
          name: "B",
          username: "b",
          access_token: PAGE_TOKEN_B,
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  vi.stubGlobal("fetch", vi.fn(routed));
}

describe(
  "FacebookApiClient.validateCredentials — cross-tenant cache isolation",
  { concurrent: false },
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      installRoutedFetch();
      // Isolate from any breaker cache state leaked by a prior test in this file.
      new FacebookApiClient(CREDS_A).clearCache();
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("never serves account A's cached Page access_token to account B (anchor)", async () => {
      const a = await new FacebookApiClient(CREDS_A).validateCredentials();
      const b = await new FacebookApiClient(CREDS_B).validateCredentials();

      assert.strictEqual(a.access_token, PAGE_TOKEN_A, "account A receives its own token");
      assert.strictEqual(b.access_token, PAGE_TOKEN_B, "account B must receive its OWN token");
      assert.notStrictEqual(
        b.access_token,
        PAGE_TOKEN_A,
        "account B must NEVER receive account A's token"
      );
    });

    it("still returns the correct token for the same account across repeated calls (do-not-regress)", async () => {
      const first = await new FacebookApiClient(CREDS_A).validateCredentials();
      const second = await new FacebookApiClient(CREDS_A).validateCredentials();

      assert.strictEqual(first.access_token, PAGE_TOKEN_A);
      assert.strictEqual(second.access_token, PAGE_TOKEN_A);
    });
  }
);
