/**
 * EnhancedOAuthService Tests - PKCE Challenge Generation & State Management
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { EnhancedOAuthService } from "../../src/auth/enhancedOAuthProvider";
import type { OAuthMocks } from "./enhancedOAuthProvider.test-helpers.js";
import { setupMocks, createMockProvider } from "./enhancedOAuthProvider.test-helpers.js";

// ============================================================================
// EnhancedOAuthService - PKCE Tests
// ============================================================================

describe("EnhancedOAuthService - PKCE Challenge Generation", () => {
  let service: EnhancedOAuthService;
  let mocks: OAuthMocks;

  beforeEach(() => {
    mocks = setupMocks();
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should generate PKCE challenge with code verifier", async () => {
    const provider = createMockProvider();

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    expect(result.codeVerifier).toBeTruthy();
    expect(typeof result.codeVerifier).toBe("string");
    expect(result.codeVerifier.length > 32).toBeTruthy();
  });

  it("should generate authorization URL with PKCE parameters", async () => {
    const provider = createMockProvider();

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    expect(result.authUrl).toBeTruthy();
    expect(result.authUrl.includes("code_challenge=")).toBeTruthy();
    expect(result.authUrl.includes("code_challenge_method=S256")).toBeTruthy();
  });

  it("should include PKCE parameters only when required", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        requirePKCE: false,
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    expect(result.authUrl.includes("code_challenge=")).toBe(false);
  });
});

// ============================================================================
// EnhancedOAuthService - State Management Tests
// ============================================================================

describe("EnhancedOAuthService - State Management", () => {
  let service: EnhancedOAuthService;
  let mocks: OAuthMocks;

  beforeEach(() => {
    mocks = setupMocks();
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should generate secure random state parameter", async () => {
    const provider = createMockProvider();

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    expect(result.state).toBeTruthy();
    expect(typeof result.state).toBe("string");
    expect(result.state.length >= 32).toBeTruthy();
  });

  it("should store state in Redis with expiration", async () => {
    const provider = createMockProvider();

    await service.generateAuthorizationUrl(provider, "acc-123");

    expect((mocks.mockRedis.setex as any).mock.calls.length).toBe(1);
    const [key, ttl, _value] = (mocks.mockRedis.setex as any).mock.calls[0];
    expect(key.startsWith("oauth:state:")).toBeTruthy();
    expect(ttl > 0).toBeTruthy();
  });

  it("should include account ID and provider in stored state", async (_t) => {
    const provider = createMockProvider();
    let storedState: any;

    mocks.mockRedis.setex = vi.fn(async (_key: string, _ttl: number, value: string) => {
      storedState = JSON.parse(value);
      return "OK";
    });

    await service.generateAuthorizationUrl(provider, "acc-123");

    expect(storedState.accountId).toBe("acc-123");
    expect(storedState.provider).toBe("x");
  });

  it("should include PKCE challenge in stored state", async (_t) => {
    const provider = createMockProvider();
    let storedState: any;

    mocks.mockRedis.setex = vi.fn(async (_key: string, _ttl: number, value: string) => {
      storedState = JSON.parse(value);
      return "OK";
    });

    await service.generateAuthorizationUrl(provider, "acc-123");

    expect(storedState.pkce).toBeTruthy();
    expect(storedState.pkce.codeVerifier).toBeTruthy();
    expect(storedState.pkce.codeChallenge).toBeTruthy();
  });

  it("should validate state exists in Redis during callback", async (_t) => {
    const provider = createMockProvider();
    mocks.mockRedis.get = vi.fn(async () => null);

    await expect(service.handleCallback(provider, "auth-code", "invalid-state")).rejects.toThrow(
      /Invalid or expired OAuth state/
    );
  });

  it("should delete state after successful callback", async (_t) => {
    const provider = createMockProvider();
    const stateData = {
      state: "valid-state",
      accountId: "acc-123",
      provider: "x",
      redirectUri: "http://localhost:3000/callback",
      scopes: ["read", "write"],
      pkce: {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256" as const,
      },
      nonce: "nonce-123",
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
    };

    mocks.mockRedis.get = vi.fn(async () => JSON.stringify(stateData));
    mocks.mockPrisma.providerConnection.findFirst = vi.fn(async () => null);
    mocks.mockPrisma.providerConnection.create = vi.fn(async () => ({
      id: "conn-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Mock fetch for token exchange
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: "token",
        token_type: "Bearer",
      }),
    })) as any;

    await service.handleCallback(provider, "auth-code", "valid-state");

    expect((mocks.mockRedis.del as any).mock.calls.length).toBe(1);

    // Restore original fetch
    global.fetch = mocks.globalFetch;
  });
});
