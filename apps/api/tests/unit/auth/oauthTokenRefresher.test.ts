/**
 * @file oauthTokenRefresher.test.ts
 * @description Unit tests for OAuthTokenRefresher: refresh-token rotation
 *              (new token persisted, old dropped), kept token when the
 *              provider returns none, and reauth-flagging on every failure
 *              path. Provider token endpoint intercepted HTTP-faithfully.
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterEach, afterAll } from "vitest";
import assert from "node:assert/strict";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Channel, ProjectId, AccountId } from "@core/domain/index.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import {
  OAuthTokenRefresher,
  type RefreshableProviderConfig,
} from "../../../src/auth/oauth/OAuthTokenRefresher.js";

const TOKEN_URL = "https://token.example.test/oauth/token";
const CONFIG: RefreshableProviderConfig = {
  tokenUrl: TOKEN_URL,
  clientId: "client-1",
  clientSecret: "secret-1",
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeChannel(refreshToken: string | undefined) {
  const created = Channel.create({
    projectId: ProjectId.generate(),
    accountId: AccountId.generate(),
    provider: "X",
    handle: "@acct",
    credentials: {
      accessToken: "old-access",
      ...(refreshToken !== undefined && { refreshToken }),
    },
  });
  assert.ok(created.ok, "channel factory should succeed");
  return created.value;
}

function makeRepo(channel: Channel) {
  const repo = {
    findById: async () => ({ ok: true as const, value: channel }),
    save: async () => ({ ok: true as const, value: undefined }),
  };
  return repo as unknown as ChannelRepository;
}

describe("OAuthTokenRefresher", () => {
  it("rotates the refresh token when the provider returns a new one", async () => {
    let sentBody = "";
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        sentBody = await request.text();
        return HttpResponse.json({
          access_token: "new-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        });
      })
    );
    const channel = makeChannel("old-refresh");
    const result = await new OAuthTokenRefresher(makeRepo(channel)).refresh(channel.id, CONFIG);

    assert.ok(result.ok, "refresh should succeed");
    assert.strictEqual(channel.credentials.accessToken, "new-access");
    assert.strictEqual(channel.credentials.refreshToken, "rotated-refresh");
    assert.match(sentBody, /grant_type=refresh_token/);
    assert.match(sentBody, /refresh_token=old-refresh/);
  });

  it("keeps the existing refresh token when the provider returns none", async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: "new-access", expires_in: 3600 })
      )
    );
    const channel = makeChannel("keep-this-refresh");
    const result = await new OAuthTokenRefresher(makeRepo(channel)).refresh(channel.id, CONFIG);

    assert.ok(result.ok);
    assert.strictEqual(channel.credentials.accessToken, "new-access");
    assert.strictEqual(channel.credentials.refreshToken, "keep-this-refresh");
  });

  it("flags the channel for reauth and errs when the provider rejects the refresh", async () => {
    server.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ error: "invalid_grant" }, { status: 400 }))
    );
    const channel = makeChannel("old-refresh");
    const result = await new OAuthTokenRefresher(makeRepo(channel)).refresh(channel.id, CONFIG);

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "REFRESH_FAILED");
    assert.strictEqual(channel.needsReauth, true);
  });

  it("flags for reauth without calling the provider when no refresh token is stored", async () => {
    const channel = makeChannel(undefined);
    const result = await new OAuthTokenRefresher(makeRepo(channel)).refresh(channel.id, CONFIG);

    assert.ok(!result.ok);
    assert.strictEqual(channel.needsReauth, true);
  });
});
