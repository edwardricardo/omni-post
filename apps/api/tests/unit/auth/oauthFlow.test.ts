/**
 * @file oauthFlow.test.ts
 * @description Unit tests for the generic OAuth 2.1 flow: authorization-URL
 *              construction (state + PKCE persisted), exact-match redirect
 *              enforcement, and single-use/bound callback consumption.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import { OAuthFlowStore } from "../../../src/auth/oauth/OAuthFlowStore.js";
import {
  assertRegisteredRedirect,
  buildAuthorizationUrl,
  consumeOAuthFlow,
  redirectsMatchExactly,
} from "../../../src/auth/oauth/oauthFlow.js";

const baseArgs = (store: OAuthFlowStore, sendChallenge: boolean) => ({
  authUrl: "https://twitter.com/i/oauth2/authorize",
  clientId: "client-123",
  redirectUri: "https://app.example.com/auth/callback/x",
  scopes: ["tweet.read", "offline.access"],
  providerId: "x",
  accountId: "acc-1",
  projectId: "proj-1",
  store,
  sendChallenge,
});

describe("buildAuthorizationUrl", () => {
  it("emits state, response_type, exact redirect and S256 challenge when sendChallenge", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    const url = new URL(await buildAuthorizationUrl(baseArgs(store, true)));

    expect(url.origin + url.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert.strictEqual(
      url.searchParams.get("redirect_uri"),
      "https://app.example.com/auth/callback/x"
    );
    assert.strictEqual(url.searchParams.get("scope"), "tweet.read offline.access");
    assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok((url.searchParams.get("code_challenge") ?? "").length > 0);
    assert.ok((url.searchParams.get("state") ?? "").length > 0);
  });

  it("omits the PKCE challenge when sendChallenge is false but still binds state", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    const url = new URL(await buildAuthorizationUrl(baseArgs(store, false)));

    assert.strictEqual(url.searchParams.get("code_challenge"), null);
    const state = url.searchParams.get("state");
    assert.ok(state);
    const record = await store.consume(state);
    assert.ok(record);
    assert.strictEqual(record.providerId, "x");
    assert.strictEqual(record.accountId, "acc-1");
    assert.ok(record.codeVerifier.length > 0);
  });

  it("rejects an unconfigured (empty) redirect URI", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    await assert.rejects(
      () => buildAuthorizationUrl({ ...baseArgs(store, true), redirectUri: "" }),
      /redirect URI is not configured/
    );
  });

  it("rejects a relative / malformed redirect URI", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    await assert.rejects(
      () => buildAuthorizationUrl({ ...baseArgs(store, true), redirectUri: "/auth/callback/x" }),
      /valid absolute URL/
    );
  });
});

describe("assertRegisteredRedirect", () => {
  it("returns the URI unchanged when it is a valid absolute https URL", () => {
    const uri = "https://app.example.com/auth/callback/x";
    assert.strictEqual(assertRegisteredRedirect(uri), uri);
  });

  it("throws on a non-http(s) scheme", () => {
    assert.throws(() => assertRegisteredRedirect("ftp://x/cb"), /http\(s\)/);
  });
});

describe("redirectsMatchExactly", () => {
  it("is true only for byte-identical strings (no normalization)", () => {
    const a = "https://app.example.com/auth/callback/x";
    assert.strictEqual(redirectsMatchExactly(a, a), true);
    assert.strictEqual(redirectsMatchExactly(a, a + "/"), false);
    assert.strictEqual(redirectsMatchExactly(a, "https://APP.example.com/auth/callback/x"), false);
  });
});

describe("consumeOAuthFlow", () => {
  it("returns the bound record for a valid, matching state", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    const url = new URL(await buildAuthorizationUrl(baseArgs(store, true)));
    const state = url.searchParams.get("state") as string;

    const record = await consumeOAuthFlow(store, "x", state);
    assert.strictEqual(record.providerId, "x");
  });

  it("throws unauthorized for a missing/expired/replayed state", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    await expect(consumeOAuthFlow(store, "x", "never")).rejects.toThrow(
      /OAuth state validation failed/
    );
  });

  it("throws unauthorized when the provider does not match the bound flow", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    const url = new URL(await buildAuthorizationUrl(baseArgs(store, true)));
    const state = url.searchParams.get("state") as string;

    await expect(consumeOAuthFlow(store, "instagram", state)).rejects.toThrow(
      /OAuth state validation failed/
    );
  });
});
