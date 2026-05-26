/**
 * @file providerOAuthX.pilot.test.ts
 * @description HTTP-faithful test for the X/Twitter pilot on the OAuth 2.1
 *              substrate: the token exchange must carry the substrate-
 *              supplied PKCE `code_verifier`, the response is normalized,
 *              and a missing verifier is rejected (PKCE is mandatory).
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import assert from "node:assert/strict";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { oauthProviders } from "../../../src/auth/providerOAuthConfigs.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("X/Twitter pilot — OAuth 2.1 + PKCE token exchange", () => {
  it("sends the PKCE code_verifier and normalizes the token + user response", async () => {
    let tokenBody = "";
    server.use(
      http.post("https://api.twitter.com/2/oauth2/token", async ({ request }) => {
        tokenBody = await request.text();
        return HttpResponse.json({
          access_token: "tw-access",
          refresh_token: "tw-refresh",
          expires_in: 7200,
        });
      }),
      http.get("https://api.twitter.com/2/users/me", () =>
        HttpResponse.json({
          data: {
            id: "u-1",
            name: "Test User",
            username: "testuser",
            profile_image_url: "https://img.example/avatar.png",
            verified: true,
          },
        })
      )
    );

    const result = await oauthProviders.x.validateCode("auth-code-1", "state-1", "verifier-xyz");

    assert.match(tokenBody, /grant_type=authorization_code/);
    assert.match(tokenBody, /code_verifier=verifier-xyz/);
    assert.match(tokenBody, /code=auth-code-1/);
    assert.strictEqual(result.accessToken, "tw-access");
    assert.strictEqual(result.refreshToken, "tw-refresh");
    assert.strictEqual(result.expiresIn, 7200);
    assert.strictEqual(result.accountInfo.id, "u-1");
    assert.strictEqual(result.accountInfo.username, "testuser");
    assert.strictEqual(result.accountInfo.profileImage, "https://img.example/avatar.png");
  });

  it("rejects the exchange when no PKCE code_verifier is provided", async () => {
    await expect(oauthProviders.x.validateCode("auth-code-1", "state-1")).rejects.toThrow(
      /Missing PKCE code_verifier/
    );
  });
});
