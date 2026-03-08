/**
 * EnhancedOAuthService Tests - PKCE Challenge Generation & State Management
 */

import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { EnhancedOAuthService } from "../../src/auth/enhancedOAuthProvider";
import type { OAuthMocks } from "./enhancedOAuthProvider.test-helpers.js";
import { setupMocks, createMockProvider } from "./enhancedOAuthProvider.test-helpers.js";

// ============================================================================
// EnhancedOAuthService - PKCE Tests
// ============================================================================

describe("EnhancedOAuthService - PKCE Challenge Generation", () => {
  let service: EnhancedOAuthService;
  let mocks: OAuthMocks;

  beforeEach((t) => {
    mocks = setupMocks(t);
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should generate PKCE challenge with code verifier", async () => {
    const provider = createMockProvider();

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    assert.ok(result.codeVerifier, "Should generate code verifier");
    assert.strictEqual(typeof result.codeVerifier, "string", "Code verifier should be string");
    assert.ok(result.codeVerifier.length > 32, "Code verifier should be sufficiently long");
  });

  it("should generate authorization URL with PKCE parameters", async () => {
    const provider = createMockProvider();

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    assert.ok(result.authUrl, "Should generate authorization URL");
    assert.ok(result.authUrl.includes("code_challenge="), "Should include code challenge");
    assert.ok(
      result.authUrl.includes("code_challenge_method=S256"),
      "Should use S256 challenge method"
    );
  });

  it("should include PKCE parameters only when required", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        requirePKCE: false,
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    assert.strictEqual(
      result.authUrl.includes("code_challenge="),
      false,
      "Should not include PKCE"
    );
  });
});

// ============================================================================
// EnhancedOAuthService - State Management Tests
// ============================================================================

describe("EnhancedOAuthService - State Management", () => {
  let service: EnhancedOAuthService;
  let mocks: OAuthMocks;

  beforeEach((t) => {
    mocks = setupMocks(t);
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should generate secure random state parameter", async () => {
    const provider = createMockProvider();

    const result = await service.generateAuthorizationUrl(provider, "acc-123");

    assert.ok(result.state, "Should generate state parameter");
    assert.strictEqual(typeof result.state, "string", "State should be string");
    assert.ok(result.state.length >= 32, "State should be sufficiently random");
  });

  it("should store state in Redis with expiration", async () => {
    const provider = createMockProvider();

    await service.generateAuthorizationUrl(provider, "acc-123");

    assert.strictEqual(
      (mocks.mockRedis.setex as any).mock.calls.length,
      1,
      "Should store state in Redis"
    );
    const [key, ttl, _value] = (mocks.mockRedis.setex as any).mock.calls[0].arguments;
    assert.ok(key.startsWith("oauth:state:"), "Should use correct Redis key prefix");
    assert.ok(ttl > 0, "Should set expiration time");
  });

  it("should include account ID and provider in stored state", async (t) => {
    const provider = createMockProvider();
    let storedState: any;

    mocks.mockRedis.setex = t.mock.fn(async (_key: string, _ttl: number, value: string) => {
      storedState = JSON.parse(value);
      return "OK";
    });

    await service.generateAuthorizationUrl(provider, "acc-123");

    assert.strictEqual(storedState.accountId, "acc-123", "Should store account ID");
    assert.strictEqual(storedState.provider, "x", "Should store provider ID");
  });

  it("should include PKCE challenge in stored state", async (t) => {
    const provider = createMockProvider();
    let storedState: any;

    mocks.mockRedis.setex = t.mock.fn(async (_key: string, _ttl: number, value: string) => {
      storedState = JSON.parse(value);
      return "OK";
    });

    await service.generateAuthorizationUrl(provider, "acc-123");

    assert.ok(storedState.pkce, "Should store PKCE challenge");
    assert.ok(storedState.pkce.codeVerifier, "Should store code verifier");
    assert.ok(storedState.pkce.codeChallenge, "Should store code challenge");
  });

  it("should validate state exists in Redis during callback", async (t) => {
    const provider = createMockProvider();
    mocks.mockRedis.get = t.mock.fn(async () => null);

    await assert.rejects(
      async () => {
        await service.handleCallback(provider, "auth-code", "invalid-state");
      },
      { message: /Invalid or expired OAuth state/ }
    );
  });

  it("should delete state after successful callback", async (t) => {
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

    mocks.mockRedis.get = t.mock.fn(async () => JSON.stringify(stateData));
    mocks.mockPrisma.providerConnection.findFirst = t.mock.fn(async () => null);
    mocks.mockPrisma.providerConnection.create = t.mock.fn(async () => ({
      id: "conn-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Mock fetch for token exchange
    global.fetch = t.mock.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: "token",
        token_type: "Bearer",
      }),
    })) as any;

    await service.handleCallback(provider, "auth-code", "valid-state");

    assert.strictEqual(
      (mocks.mockRedis.del as any).mock.calls.length,
      1,
      "Should delete state from Redis"
    );

    // Restore original fetch
    global.fetch = mocks.globalFetch;
  });
});
