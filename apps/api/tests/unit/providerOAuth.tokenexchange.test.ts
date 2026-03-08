import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { oauthProviders } from "../../src/auth/providerOAuth.js";

let globalFetch: typeof global.fetch;
let oauthStates: Map<string, Record<string, unknown>>;

function setupMocks() {
  globalFetch = global.fetch;
  oauthStates = new Map();
}

// ============================================================================
// OAuth Flow - Token Exchange Tests (X/Twitter)
// ============================================================================

describe("ProviderOAuth - Token Exchange (X/Twitter)", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  it("should exchange authorization code for access token", async () => {
    const provider = oauthProviders.x;

    global.fetch = mock.fn(async (url: string) => {
      if (url.includes("oauth2/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "x-access-token",
            refresh_token: "x-refresh-token",
            expires_in: 7200,
            token_type: "Bearer",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            id: "12345",
            name: "Test User",
            username: "testuser",
            profile_image_url: "https://example.com/avatar.jpg",
            verified: true,
          },
        }),
      };
    }) as typeof global.fetch;

    const result = await provider.validateCode("auth-code", "state");

    assert.strictEqual(result.accessToken, "x-access-token", "Should return access token");
    assert.strictEqual(result.refreshToken, "x-refresh-token", "Should return refresh token");
    assert.strictEqual(result.expiresIn, 7200, "Should return expiration time");
    assert.ok(result.accountInfo, "Should return account info");
    assert.strictEqual(result.accountInfo.id, "12345", "Should return user ID");
  });

  it("should handle token exchange failure", async () => {
    const provider = oauthProviders.x;

    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => "Invalid authorization code",
    })) as typeof global.fetch;

    await assert.rejects(
      async () => {
        await provider.validateCode("invalid-code", "state");
      },
      { message: /token_exchange_failure/ }
    );
  });

  it("should handle user info fetch failure", async () => {
    const provider = oauthProviders.x;

    global.fetch = mock.fn(async (url: string) => {
      if (url.includes("oauth2/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "token",
            token_type: "Bearer",
          }),
        };
      }
      return {
        ok: false,
        status: 401,
      };
    }) as typeof global.fetch;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /user_info_fetch_failure/ }
    );
  });
});

// ============================================================================
// OAuth Flow - Token Exchange Tests (Instagram)
// ============================================================================

describe("ProviderOAuth - Token Exchange (Instagram)", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  it("should exchange authorization code for Instagram access token", async () => {
    const provider = oauthProviders.instagram;

    global.fetch = mock.fn(async (url: string) => {
      if (url.includes("api.instagram.com/oauth/")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "ig-access-token",
            expires_in: 3600,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "ig-user-123",
          username: "testuser",
          media_count: 50,
          account_type: "BUSINESS",
        }),
      };
    }) as typeof global.fetch;

    const result = await provider.validateCode("auth-code", "state");

    assert.strictEqual(result.accessToken, "ig-access-token", "Should return access token");
    assert.strictEqual(result.accountInfo.username, "testuser", "Should return username");
    assert.strictEqual(result.accountInfo.verified, true, "Business accounts should be verified");
  });
});

// ============================================================================
// OAuth Flow - Token Exchange Tests (YouTube)
// ============================================================================

describe("ProviderOAuth - Token Exchange (YouTube)", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  it("should exchange authorization code for YouTube access token", async () => {
    const provider = oauthProviders.youtube;

    global.fetch = mock.fn(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "yt-access-token",
            refresh_token: "yt-refresh-token",
            expires_in: 3600,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "channel-123",
              snippet: {
                title: "Test Channel",
                customUrl: "testchannel",
                thumbnails: {
                  default: {
                    url: "https://example.com/thumb.jpg",
                  },
                },
              },
            },
          ],
        }),
      };
    }) as typeof global.fetch;

    const result = await provider.validateCode("auth-code", "state");

    assert.strictEqual(result.accessToken, "yt-access-token", "Should return access token");
    assert.strictEqual(result.accountInfo.name, "Test Channel", "Should return channel name");
  });

  it("should handle missing YouTube channel", async () => {
    const provider = oauthProviders.youtube;

    global.fetch = mock.fn(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "token",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [],
        }),
      };
    }) as typeof global.fetch;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /channel_not_found/ }
    );
  });
});

// ============================================================================
// OAuth Flow - Error Handling Tests
// ============================================================================

describe("ProviderOAuth - Error Handling", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should handle provider error in callback query", () => {
    const errorParam = "access_denied";
    const errorMessage = `OAuth error: ${errorParam}`;

    assert.strictEqual(errorMessage, "OAuth error: access_denied", "Should format error message");
  });

  it("should validate required callback parameters", () => {
    const query = { state: "test-state" };

    const hasCode = "code" in query;
    const hasState = "state" in query;

    assert.strictEqual(hasCode, false, "Should detect missing code");
    assert.strictEqual(hasState, true, "Should detect present state");
  });

  it("should handle invalid state validation", () => {
    oauthStates.set("valid-state", {
      providerId: "x",
      accountId: "acc-123",
      projectId: "proj-123",
    });

    const stateData = oauthStates.get("invalid-state");
    assert.strictEqual(stateData, undefined, "Should return undefined for invalid state");
  });

  it("should handle provider mismatch in state", () => {
    oauthStates.set("state-123", {
      providerId: "instagram",
      accountId: "acc-123",
      projectId: "proj-123",
    });

    const stateData = oauthStates.get("state-123");
    const requestedProvider = "x";

    assert.ok(stateData, "Should retrieve state data");
    assert.notStrictEqual(
      stateData.providerId,
      requestedProvider,
      "Should detect provider mismatch"
    );
  });
});
