/**
 * @file authService.test.ts
 * @description Mutation-killing tests for TikTokAuthService covering OAuth URL
 *              generation, token exchange, refresh, profile retrieval, revocation,
 *              validation, and Login Kit configuration.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";

// Mock external dependencies before importing source
vi.mock("@adapters/external-apis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/external-apis")>();
  return {
    ...actual,
    createExternalApiCircuitBreaker: vi.fn(() => ({
      call: vi.fn((_service: string, _op: string, fn: () => unknown) => fn()),
      getAllStatuses: vi.fn(() => ({ "tiktok-auth-api": "CLOSED" })),
      clearCache: vi.fn(),
    })),
  };
});

vi.mock("@adapters/fallback-strategies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/fallback-strategies")>();
  return {
    ...actual,
    CommonFallbackStrategies: {
      METADATA_FALLBACK: { type: "metadata" },
    },
  };
});

vi.mock("prom-client", () => ({
  Registry: class MockRegistry {},
}));

vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));

import axios from "axios";
import { TikTokAuthService } from "../src/authService.js";
import type { TikTokOAuthConfig } from "../src/authService.js";

const mockedAxiosPost = vi.mocked(axios.post);

const makeConfig = (overrides?: Partial<TikTokOAuthConfig>): TikTokOAuthConfig => ({
  clientKey: "test-client-key",
  clientSecret: "test-client-secret",
  redirectUri: "https://example.com/callback",
  scopes: ["user.info.basic", "video.publish"],
  ...overrides,
});

describe("TikTokAuthService", () => {
  let service: TikTokAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TikTokAuthService(makeConfig());
  });

  // =========================================================================
  // generateAuthUrl
  // =========================================================================
  describe("generateAuthUrl", () => {
    it("returns url containing correct base path", () => {
      const result = service.generateAuthUrl();

      assert.ok(result.url.startsWith("https://www.tiktok.com/v2/auth/authorize/?"));
    });

    it("includes client_key in URL params", () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);

      assert.strictEqual(url.searchParams.get("client_key"), "test-client-key");
    });

    it("includes scopes joined by comma", () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);

      assert.strictEqual(url.searchParams.get("scope"), "user.info.basic,video.publish");
    });

    it("includes response_type as code", () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);

      assert.strictEqual(url.searchParams.get("response_type"), "code");
    });

    it("includes redirect_uri from config", () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);

      assert.strictEqual(url.searchParams.get("redirect_uri"), "https://example.com/callback");
    });

    it("generates a random state when none provided", () => {
      const result1 = service.generateAuthUrl();
      const result2 = service.generateAuthUrl();

      assert.ok(result1.state.length > 0);
      assert.ok(result2.state.length > 0);
      // Random states should differ (extremely unlikely to collide)
      assert.notStrictEqual(result1.state, result2.state);
    });

    it("uses provided state when given", () => {
      const result = service.generateAuthUrl({ state: "my-custom-state" });

      assert.strictEqual(result.state, "my-custom-state");
      const url = new URL(result.url);
      assert.strictEqual(url.searchParams.get("state"), "my-custom-state");
    });

    it("does not include codeVerifier without PKCE", () => {
      const result = service.generateAuthUrl({ usePKCE: false });

      assert.strictEqual(result.codeVerifier, undefined);
    });

    it("does not include code_challenge params without PKCE", () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);

      assert.strictEqual(url.searchParams.get("code_challenge"), null);
      assert.strictEqual(url.searchParams.get("code_challenge_method"), null);
    });

    it("includes codeVerifier when PKCE is enabled", () => {
      const result = service.generateAuthUrl({ usePKCE: true });

      assert.ok(result.codeVerifier);
      assert.ok(result.codeVerifier.length > 0);
    });

    it("includes code_challenge in URL when PKCE is enabled", () => {
      const result = service.generateAuthUrl({ usePKCE: true });
      const url = new URL(result.url);

      assert.ok(url.searchParams.get("code_challenge"));
      assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    });

    it("appends additionalScopes to existing scopes", () => {
      const result = service.generateAuthUrl({
        additionalScopes: ["video.list", "user.info.stats"],
      });
      const url = new URL(result.url);

      const scopeParam = url.searchParams.get("scope");
      assert.ok(scopeParam);
      expect(scopeParam).toContain("user.info.basic");
      expect(scopeParam).toContain("video.publish");
      expect(scopeParam).toContain("video.list");
      expect(scopeParam).toContain("user.info.stats");
    });

    it("handles empty additionalScopes gracefully", () => {
      const result = service.generateAuthUrl({ additionalScopes: [] });
      const url = new URL(result.url);

      assert.strictEqual(url.searchParams.get("scope"), "user.info.basic,video.publish");
    });

    it("generates different codeVerifiers on each call", () => {
      const result1 = service.generateAuthUrl({ usePKCE: true });
      const result2 = service.generateAuthUrl({ usePKCE: true });

      assert.notStrictEqual(result1.codeVerifier, result2.codeVerifier);
    });
  });

  // =========================================================================
  // shouldRefreshToken
  // =========================================================================
  describe("shouldRefreshToken", () => {
    // Every case here is a distance from "now", and the method reads the clock
    // AGAIN inside itself. With a real clock the two reads differ by however long
    // the call took, so the 1 ms boundary case below is decided by scheduling
    // jitter — it was failing roughly one CI run in fifteen. Freezing the clock
    // makes the boundary exact, which is the whole point of testing a boundary.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns true when token expires in less than 1 hour", () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      assert.strictEqual(service.shouldRefreshToken(expiresAt), true);
    });

    it("returns true when token is already expired", () => {
      const expiresAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      assert.strictEqual(service.shouldRefreshToken(expiresAt), true);
    });

    it("returns false when token expires in more than 1 hour", () => {
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

      assert.strictEqual(service.shouldRefreshToken(expiresAt), false);
    });

    it("returns true when token expires at exactly 1 hour (boundary)", () => {
      // timeUntilExpiry === oneHour => <= oneHour is true
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      assert.strictEqual(service.shouldRefreshToken(expiresAt), true);
    });

    it("returns false when token expires at 1 hour + 1ms", () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000 + 1);

      assert.strictEqual(service.shouldRefreshToken(expiresAt), false);
    });

    it("returns true when expiresAt equals now", () => {
      const expiresAt = new Date(Date.now());

      assert.strictEqual(service.shouldRefreshToken(expiresAt), true);
    });
  });

  // =========================================================================
  // generateLoginKitConfig
  // =========================================================================
  describe("generateLoginKitConfig", () => {
    it("returns config with clientKey from constructor config", () => {
      const result = service.generateLoginKitConfig();

      assert.strictEqual(result.clientKey, "test-client-key");
    });

    it("returns config with clientSecret from constructor config", () => {
      const result = service.generateLoginKitConfig();

      assert.strictEqual(result.clientSecret, "test-client-secret");
    });

    it("returns config with redirectUri from constructor config", () => {
      const result = service.generateLoginKitConfig();

      assert.strictEqual(result.redirectUri, "https://example.com/callback");
    });

    it("returns config with base scopes", () => {
      const result = service.generateLoginKitConfig();

      expect(result.scopes).toEqual(["user.info.basic", "video.publish"]);
    });

    it("generates a random state when none provided", () => {
      const result = service.generateLoginKitConfig();

      assert.ok(result.state);
      assert.ok(result.state.length > 0);
    });

    it("uses provided state override", () => {
      const result = service.generateLoginKitConfig({ state: "custom-state-123" });

      assert.strictEqual(result.state, "custom-state-123");
    });

    it("does not include codeChallenge without PKCE", () => {
      const result = service.generateLoginKitConfig();

      assert.strictEqual(result.codeChallenge, undefined);
      assert.strictEqual(result.codeChallengeMethod, undefined);
    });

    it("includes codeChallenge and codeChallengeMethod with PKCE", () => {
      const result = service.generateLoginKitConfig({ usePKCE: true });

      assert.ok(result.codeChallenge);
      assert.ok(result.codeChallenge.length > 0);
      assert.strictEqual(result.codeChallengeMethod, "S256");
    });

    it("appends additionalScopes to base scopes", () => {
      const result = service.generateLoginKitConfig({
        additionalScopes: ["video.list"],
      });

      expect(result.scopes).toEqual(["user.info.basic", "video.publish", "video.list"]);
    });

    it("handles empty additionalScopes", () => {
      const result = service.generateLoginKitConfig({ additionalScopes: [] });

      expect(result.scopes).toEqual(["user.info.basic", "video.publish"]);
    });
  });

  // =========================================================================
  // getAvailableScopes (static)
  // =========================================================================
  describe("getAvailableScopes", () => {
    it("returns exactly 10 scopes", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(Object.keys(scopes).length, 10);
    });

    it("contains user.info.basic scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["user.info.basic"], "Access to basic user information");
    });

    it("contains user.info.profile scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["user.info.profile"], "Access to user profile information");
    });

    it("contains user.info.stats scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["user.info.stats"], "Access to user statistics");
    });

    it("contains video.list scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["video.list"], "Access to user's video list");
    });

    it("contains video.upload scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["video.upload"], "Permission to upload videos");
    });

    it("contains video.publish scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["video.publish"], "Permission to publish videos");
    });

    it("contains research.adlib.basic scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(
        scopes["research.adlib.basic"],
        "Access to basic advertising library data"
      );
    });

    it("contains research.data.basic scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["research.data.basic"], "Access to basic research data");
    });

    it("contains business.insights scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["business.insights"], "Access to business insights and analytics");
    });

    it("contains marketing.api scope", () => {
      const scopes = TikTokAuthService.getAvailableScopes();

      assert.strictEqual(scopes["marketing.api"], "Access to Marketing API functionality");
    });
  });

  // =========================================================================
  // exchangeCodeForToken
  // =========================================================================
  describe("exchangeCodeForToken", () => {
    it("returns mapped TikTokAuthResult on success", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok-abc",
            refresh_token: "ref-xyz",
            expires_in: 7200,
            token_type: "Bearer",
            scope: "user.info.basic",
            open_id: "open-id-123",
            union_id: "union-id-456",
          },
        },
      });

      const result = await service.exchangeCodeForToken("auth-code-999");

      assert.strictEqual(result.accessToken, "tok-abc");
      assert.strictEqual(result.refreshToken, "ref-xyz");
      assert.strictEqual(result.expiresIn, 7200);
      assert.strictEqual(result.tokenType, "Bearer");
      assert.strictEqual(result.scope, "user.info.basic");
      assert.strictEqual(result.openId, "open-id-123");
      assert.strictEqual(result.unionId, "union-id-456");
      assert.ok(result.expiresAt instanceof Date);
    });

    it("computes expiresAt from expires_in", async () => {
      const beforeCall = Date.now();

      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "user.info.basic",
            open_id: "oid",
          },
        },
      });

      const result = await service.exchangeCodeForToken("code");

      const afterCall = Date.now();
      const expectedMin = beforeCall + 3600 * 1000;
      const expectedMax = afterCall + 3600 * 1000;

      assert.ok(result.expiresAt.getTime() >= expectedMin);
      assert.ok(result.expiresAt.getTime() <= expectedMax);
    });

    it("sends correct params to TikTok OAuth endpoint", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "s",
            open_id: "o",
          },
        },
      });

      await service.exchangeCodeForToken("my-code");

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://open.tiktokapis.com/v2/oauth/token/",
        expect.objectContaining({
          client_key: "test-client-key",
          client_secret: "test-client-secret",
          code: "my-code",
          grant_type: "authorization_code",
          redirect_uri: "https://example.com/callback",
        }),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
          },
        })
      );
    });

    it("includes code_verifier when codeVerifier option is provided", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "s",
            open_id: "o",
          },
        },
      });

      await service.exchangeCodeForToken("code", { codeVerifier: "my-verifier" });

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code_verifier: "my-verifier" }),
        expect.any(Object)
      );
    });

    it("does not include code_verifier when not provided", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "s",
            open_id: "o",
          },
        },
      });

      await service.exchangeCodeForToken("code");

      const params = mockedAxiosPost.mock.calls[0]![1] as Record<string, unknown>;
      assert.strictEqual(params.code_verifier, undefined);
    });

    it("throws ProviderError when response contains error field", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          error: "invalid_grant",
          error_description: "Code has expired",
        },
      });

      await expect(service.exchangeCodeForToken("expired-code")).rejects.toThrow(
        "TikTok OAuth error: invalid_grant - Code has expired"
      );
    });
  });

  // =========================================================================
  // refreshAccessToken
  // =========================================================================
  describe("refreshAccessToken", () => {
    it("returns mapped TikTokRefreshTokenResult on success", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "new-tok",
            expires_in: 7200,
            refresh_token: "new-ref",
            scope: "user.info.basic,video.publish",
          },
        },
      });

      const result = await service.refreshAccessToken("old-refresh-token");

      assert.strictEqual(result.accessToken, "new-tok");
      assert.strictEqual(result.expiresIn, 7200);
      assert.strictEqual(result.refreshToken, "new-ref");
      assert.strictEqual(result.scope, "user.info.basic,video.publish");
      assert.ok(result.expiresAt instanceof Date);
    });

    it("sends correct params including refresh_token", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok",
            expires_in: 3600,
            scope: "s",
          },
        },
      });

      await service.refreshAccessToken("refresh-token-abc");

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://open.tiktokapis.com/v2/oauth/token/",
        expect.objectContaining({
          client_key: "test-client-key",
          client_secret: "test-client-secret",
          grant_type: "refresh_token",
          refresh_token: "refresh-token-abc",
        }),
        expect.any(Object)
      );
    });

    it("computes expiresAt from expires_in correctly", async () => {
      const beforeCall = Date.now();

      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            access_token: "tok",
            expires_in: 1800,
            scope: "s",
          },
        },
      });

      const result = await service.refreshAccessToken("ref");

      const afterCall = Date.now();
      assert.ok(result.expiresAt.getTime() >= beforeCall + 1800 * 1000);
      assert.ok(result.expiresAt.getTime() <= afterCall + 1800 * 1000);
    });

    it("throws ProviderError when response contains error field", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          error: "invalid_token",
          error_description: "Refresh token expired",
        },
      });

      await expect(service.refreshAccessToken("expired-ref")).rejects.toThrow(
        "TikTok token refresh error: invalid_token - Refresh token expired"
      );
    });
  });

  // =========================================================================
  // getUserProfile
  // =========================================================================
  describe("getUserProfile", () => {
    const makeUserResponse = (userData: Record<string, unknown> = {}) => ({
      data: {
        data: {
          user: {
            open_id: "oid-1",
            union_id: "uid-1",
            username: "testuser",
            display_name: "Test User",
            avatar_url: "https://cdn.tiktok.com/avatar.jpg",
            avatar_large_url: "https://cdn.tiktok.com/avatar-lg.jpg",
            profile_deep_link: "https://www.tiktok.com/@testuser",
            bio_description: "My bio",
            website_url: "https://example.com",
            verified: true,
            follower_count: 1000,
            following_count: 200,
            likes_count: 5000,
            video_count: 50,
            ...userData,
          },
        },
      },
    });

    it("returns base profile with mapped fields", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse());

      const profile = await service.getUserProfile("access-tok");

      assert.strictEqual(profile.openId, "oid-1");
      assert.strictEqual(profile.unionId, "uid-1");
      assert.strictEqual(profile.username, "testuser");
      assert.strictEqual(profile.displayName, "Test User");
      assert.strictEqual(profile.avatarUrl, "https://cdn.tiktok.com/avatar.jpg");
      assert.strictEqual(profile.avatarLargeUrl, "https://cdn.tiktok.com/avatar-lg.jpg");
      assert.strictEqual(profile.profileDeepLink, "https://www.tiktok.com/@testuser");
      assert.strictEqual(profile.bioDescription, "My bio");
      assert.strictEqual(profile.websiteUrl, "https://example.com");
      assert.strictEqual(profile.verified, true);
    });

    it("defaults stat fields to 0 when not present", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeUserResponse({
          follower_count: undefined,
          following_count: undefined,
          likes_count: undefined,
          video_count: undefined,
        })
      );

      const profile = await service.getUserProfile("tok");

      assert.strictEqual(profile.followerCount, 0);
      assert.strictEqual(profile.followingCount, 0);
      assert.strictEqual(profile.likesCount, 0);
      assert.strictEqual(profile.videoCount, 0);
    });

    it("defaults verified to false when not present", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse({ verified: undefined }));

      const profile = await service.getUserProfile("tok");

      assert.strictEqual(profile.verified, false);
    });

    it("includes stats fields in request when includeStats is true", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse());

      await service.getUserProfile("tok", { includeStats: true });

      const requestBody = mockedAxiosPost.mock.calls[0]![1] as Record<string, unknown>;
      const fields = requestBody.fields as string[];
      expect(fields).toContain("follower_count");
      expect(fields).toContain("following_count");
      expect(fields).toContain("likes_count");
      expect(fields).toContain("video_count");
    });

    it("does not include stat fields when includeStats is false", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse());

      await service.getUserProfile("tok", { includeStats: false });

      const requestBody = mockedAxiosPost.mock.calls[0]![1] as Record<string, unknown>;
      const fields = requestBody.fields as string[];
      expect(fields).not.toContain("follower_count");
      expect(fields).not.toContain("following_count");
    });

    it("returns business profile when includeBusiness is true and data exists", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeUserResponse({
          business_account_type: "business",
          category: "Tech",
          business_email: "biz@example.com",
          business_phone: "+1234567890",
          business_address: "123 Main St",
          is_marketing_api_enabled: true,
          advertiser_account_ids: ["adv-1", "adv-2"],
        })
      );

      const profile = await service.getUserProfile("tok", { includeBusiness: true });

      assert.strictEqual((profile as any).businessAccountType, "business");
      assert.strictEqual((profile as any).category, "Tech");
      assert.strictEqual((profile as any).businessEmail, "biz@example.com");
      assert.strictEqual((profile as any).businessPhone, "+1234567890");
      assert.strictEqual((profile as any).businessAddress, "123 Main St");
      assert.strictEqual((profile as any).isMarketingApiEnabled, true);
      expect((profile as any).advertiserAccountIds).toEqual(["adv-1", "adv-2"]);
    });

    it("defaults business marketing fields when not present", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeUserResponse({
          business_account_type: "creator",
          category: "Entertainment",
        })
      );

      const profile = await service.getUserProfile("tok", { includeBusiness: true });

      assert.strictEqual((profile as any).isMarketingApiEnabled, false);
      expect((profile as any).advertiserAccountIds).toEqual([]);
    });

    it("returns base profile when includeBusiness but no business_account_type", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse());

      const profile = await service.getUserProfile("tok", { includeBusiness: true });

      assert.strictEqual((profile as any).businessAccountType, undefined);
    });

    it("sends Authorization header with Bearer token", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse());

      await service.getUserProfile("my-access-token-xyz");

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-access-token-xyz",
          }),
        })
      );
    });

    it("throws ProviderError when response contains error code", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          error: {
            code: "access_token_invalid",
            message: "Token has been revoked",
          },
        },
      });

      await expect(service.getUserProfile("bad-tok")).rejects.toThrow(
        "TikTok API error: access_token_invalid - Token has been revoked"
      );
    });

    it("includes business fields in request when includeBusiness is true", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeUserResponse());

      await service.getUserProfile("tok", { includeBusiness: true });

      const requestBody = mockedAxiosPost.mock.calls[0]![1] as Record<string, unknown>;
      const fields = requestBody.fields as string[];
      expect(fields).toContain("business_account_type");
      expect(fields).toContain("category");
      expect(fields).toContain("business_email");
      expect(fields).toContain("business_phone");
      expect(fields).toContain("business_address");
    });
  });

  // =========================================================================
  // revokeToken
  // =========================================================================
  describe("revokeToken", () => {
    it("returns true on successful revocation with revoked field", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: { data: { revoked: true } },
      });

      const result = await service.revokeToken("tok-to-revoke");

      assert.strictEqual(result, true);
    });

    it("returns true when revoked field is absent (fallback to true)", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: { data: {} },
      });

      const result = await service.revokeToken("tok-to-revoke");

      assert.strictEqual(result, true);
    });

    it("returns true when data is null (fallback to true)", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: { data: null },
      });

      const result = await service.revokeToken("tok-to-revoke");

      assert.strictEqual(result, true);
    });

    it("sends correct body to revoke endpoint", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: { data: { revoked: true } },
      });

      await service.revokeToken("my-token");

      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://open.tiktokapis.com/v2/oauth/revoke/",
        expect.objectContaining({
          client_key: "test-client-key",
          client_secret: "test-client-secret",
          token: "my-token",
        }),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("throws ProviderError when response contains error", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          error: "token_not_found",
          error_description: "Token does not exist",
        },
      });

      await expect(service.revokeToken("nonexistent-tok")).rejects.toThrow(
        "TikTok token revocation error: token_not_found - Token does not exist"
      );
    });
  });

  // =========================================================================
  // validateToken
  // =========================================================================
  describe("validateToken", () => {
    it("returns true when getUserProfile succeeds", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            user: {
              open_id: "oid",
              union_id: "uid",
              username: "u",
              display_name: "U",
              avatar_url: "url",
              profile_deep_link: "link",
            },
          },
        },
      });

      const result = await service.validateToken("valid-token");

      assert.strictEqual(result, true);
    });

    it("returns false when getUserProfile throws", async () => {
      mockedAxiosPost.mockRejectedValueOnce(new Error("Network error"));

      const result = await service.validateToken("invalid-token");

      assert.strictEqual(result, false);
    });

    it("calls getUserProfile with includeStats false", async () => {
      mockedAxiosPost.mockResolvedValueOnce({
        data: {
          data: {
            user: {
              open_id: "oid",
              union_id: "uid",
              username: "u",
              display_name: "U",
              avatar_url: "url",
              profile_deep_link: "link",
            },
          },
        },
      });

      await service.validateToken("tok");

      // The fields should NOT include stat fields
      const requestBody = mockedAxiosPost.mock.calls[0]![1] as Record<string, unknown>;
      const fields = requestBody.fields as string[];
      expect(fields).not.toContain("follower_count");
    });
  });

  // =========================================================================
  // getCircuitBreakerStatus & clearCache
  // =========================================================================
  describe("getCircuitBreakerStatus", () => {
    it("delegates to circuitBreaker.getAllStatuses", () => {
      const result = service.getCircuitBreakerStatus();

      expect(result).toEqual({ "tiktok-auth-api": "CLOSED" });
    });
  });

  describe("clearCache", () => {
    it("does not throw when called", () => {
      expect(() => service.clearCache()).not.toThrow();
    });
  });

  describe("getMetricsRegistry", () => {
    it("returns a registry object", () => {
      const registry = TikTokAuthService.getMetricsRegistry();

      assert.ok(registry !== null);
      assert.ok(registry !== undefined);
    });
  });
});
