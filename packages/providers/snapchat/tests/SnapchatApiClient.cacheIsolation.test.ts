/**
 * @file SnapchatApiClient.cacheIsolation.test.ts
 * @description Cross-tenant cache-isolation test for the C1b per-site discriminant on Snapchat
 *              (Spec C1-R1 scenario 3 + C1-R2 "PII sites are anchored by an isolation test").
 *              `validate-credentials` is a `cacheEnabled:true` PII read returning the account's
 *              organizations. Account B must NEVER receive account A's cached organizations.
 *              Drives the REAL SnapchatApiClient through the process-singleton circuit breaker
 *              with fetch mocked and routed by the bearer token so each account resolves to its
 *              OWN payload.
 *
 *              RED (before the C1b discriminant): validate-credentials caches on a constant key
 *              => account B is served account A's cached organizations => assertion fails.
 *              GREEN (after `cacheKeyDiscriminant: hashCallScope(this.credentials)`): B's distinct
 *              discriminant keys a distinct entry => B fetches fresh => B receives B's own orgs.
 *
 *              Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import { SnapchatApiClient } from "../src/apiClient.js";
import type { SnapchatCredentials } from "../src/types.js";

const CREDS_A: SnapchatCredentials = {
  clientId: "client-A",
  clientSecret: "secret-A",
  accessToken: "snap-token-A",
  refreshToken: "refresh-A",
  organizationId: "org-A",
};

const CREDS_B: SnapchatCredentials = {
  clientId: "client-B",
  clientSecret: "secret-B",
  accessToken: "snap-token-B",
  refreshToken: "refresh-B",
  organizationId: "org-B",
};

/**
 * Routes the mocked fetch by the outbound bearer token so each account resolves
 * to its own organizations list (a PII payload proxy).
 */
function installRoutedFetch(): void {
  const routed = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? "";
    if (url.includes("/me/organizations")) {
      if (auth.includes(CREDS_A.accessToken)) {
        return new Response(JSON.stringify({ organizations: [{ id: "org-A", name: "A" }] }), {
          status: 200,
        });
      }
      if (auth.includes(CREDS_B.accessToken)) {
        return new Response(JSON.stringify({ organizations: [{ id: "org-B", name: "B" }] }), {
          status: 200,
        });
      }
    }
    return new Response(JSON.stringify({ organizations: [] }), { status: 200 });
  };
  vi.stubGlobal("fetch", vi.fn(routed));
}

describe(
  "SnapchatApiClient.validateCredentials — cross-tenant cache isolation",
  { concurrent: false },
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      installRoutedFetch();
      // Isolate from any breaker cache state leaked by a prior test in this file.
      new SnapchatApiClient(CREDS_A).clearCache();
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("never serves account A's cached organizations to account B", async () => {
      const a = await new SnapchatApiClient(CREDS_A).validateCredentials();
      const b = await new SnapchatApiClient(CREDS_B).validateCredentials();

      assert.strictEqual(
        a.organizations[0]?.id,
        "org-A",
        "account A receives its own organizations"
      );
      assert.strictEqual(
        b.organizations[0]?.id,
        "org-B",
        "account B must receive its OWN organizations, never account A's cached payload"
      );
    });

    it("still serves the same account's cache within TTL (no perf regression)", async () => {
      const first = await new SnapchatApiClient(CREDS_A).validateCredentials();
      const second = await new SnapchatApiClient(CREDS_A).validateCredentials();

      assert.strictEqual(first.organizations[0]?.id, "org-A");
      assert.strictEqual(second.organizations[0]?.id, "org-A");
      // The same-tenant second call is a cache hit: fetch invoked once for A.
      const fetchMock = fetch as unknown as { mock: { calls: unknown[] } };
      assert.strictEqual(
        fetchMock.mock.calls.length,
        1,
        "the same-account second call must be served from cache (one fetch only)"
      );
    });
  }
);
