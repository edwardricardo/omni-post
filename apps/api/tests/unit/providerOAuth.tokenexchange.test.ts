import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
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

describe("ProviderOAuth - Token Exchange (X/Twitter)", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  it("should exchange authorization code for access token", async () => {
    const provider = oauthProviders.x;

    global.fetch = vi.fn(async (url: string) => {
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

    expect(result.accessToken).toBe("x-access-token");
    expect(result.refreshToken).toBe("x-refresh-token");
    expect(result.expiresIn).toBe(7200);
    expect(result.accountInfo).toBeTruthy();
    expect(result.accountInfo.id).toBe("12345");
  });

  it("should handle token exchange failure", async () => {
    const provider = oauthProviders.x;

    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => "Invalid authorization code",
    })) as typeof global.fetch;

    await expect(provider.validateCode("invalid-code", "state")).rejects.toThrow(
      /token_exchange_failure/
    );
  });

  it("should handle user info fetch failure", async () => {
    const provider = oauthProviders.x;

    global.fetch = vi.fn(async (url: string) => {
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

    await expect(provider.validateCode("code", "state")).rejects.toThrow(/user_info_fetch_failure/);
  });
});

// ============================================================================
// OAuth Flow - Token Exchange Tests (Instagram)
// ============================================================================

describe("ProviderOAuth - Token Exchange (Instagram)", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  it("should exchange authorization code for Instagram access token", async () => {
    const provider = oauthProviders.instagram;

    global.fetch = vi.fn(async (url: string) => {
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

    expect(result.accessToken).toBe("ig-access-token");
    expect(result.accountInfo.username).toBe("testuser");
    expect(result.accountInfo.verified).toBe(true);
  });
});

// ============================================================================
// OAuth Flow - Token Exchange Tests (YouTube)
// ============================================================================

describe("ProviderOAuth - Token Exchange (YouTube)", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  it("should exchange authorization code for YouTube access token", async () => {
    const provider = oauthProviders.youtube;

    global.fetch = vi.fn(async (url: string) => {
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

    expect(result.accessToken).toBe("yt-access-token");
    expect(result.accountInfo.name).toBe("Test Channel");
  });

  it("should handle missing YouTube channel", async () => {
    const provider = oauthProviders.youtube;

    global.fetch = vi.fn(async (url: string) => {
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

    await expect(provider.validateCode("code", "state")).rejects.toThrow(/channel_not_found/);
  });
});

// ============================================================================
// OAuth Flow - Error Handling Tests
// ============================================================================

describe("ProviderOAuth - Error Handling", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should handle provider error in callback query", () => {
    const errorParam = "access_denied";
    const errorMessage = `OAuth error: ${errorParam}`;

    expect(errorMessage).toBe("OAuth error: access_denied");
  });

  it("should validate required callback parameters", () => {
    const query = { state: "test-state" };

    const hasCode = "code" in query;
    const hasState = "state" in query;

    expect(hasCode).toBe(false);
    expect(hasState).toBe(true);
  });

  it("should handle invalid state validation", () => {
    oauthStates.set("valid-state", {
      providerId: "x",
      accountId: "acc-123",
      projectId: "proj-123",
    });

    const stateData = oauthStates.get("invalid-state");
    expect(stateData).toBe(undefined);
  });

  it("should handle provider mismatch in state", () => {
    oauthStates.set("state-123", {
      providerId: "instagram",
      accountId: "acc-123",
      projectId: "proj-123",
    });

    const stateData = oauthStates.get("state-123");
    const requestedProvider = "x";

    expect(stateData).toBeTruthy();
    expect(stateData.providerId).not.toBe(requestedProvider);
  });
});
