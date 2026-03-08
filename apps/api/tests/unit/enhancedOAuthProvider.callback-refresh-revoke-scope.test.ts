/**
 * EnhancedOAuthService Tests - Callback Handling, Token Refresh,
 * Connection Revocation & Scope Validation
 */

import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { EnhancedOAuthService } from "../../src/auth/enhancedOAuthProvider";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";
import type { OAuthMocks } from "./enhancedOAuthProvider.test-helpers.js";
import { setupMocks, createMockProvider } from "./enhancedOAuthProvider.test-helpers.js";

// ============================================================================
// EnhancedOAuthService - Callback Handling Tests
// ============================================================================

describe("EnhancedOAuthService - Callback Handling", () => {
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

  it("should handle OAuth error responses", async () => {
    const provider = createMockProvider();

    await assert.rejects(
      async () => {
        await service.handleCallback(provider, "code", "state", "access_denied");
      },
      { message: /OAuth provider error/ }
    );
  });

  it("should increment security threat metric on error", async () => {
    const provider = createMockProvider();

    try {
      await service.handleCallback(provider, "code", "state", "invalid_request");
    } catch {
      // Expected to fail
    }

    assert.strictEqual(
      (mocks.mockMetrics.metrics.securityThreats.inc as any).mock.calls.length,
      1,
      "Should increment security threat counter"
    );
  });

  it("should validate provider matches state", async (t) => {
    const provider = createMockProvider({ id: "instagram" as ProviderId });
    const stateData = {
      state: "valid-state",
      accountId: "acc-123",
      provider: "x" as ProviderId,
      redirectUri: "http://localhost:3000/callback",
      scopes: ["read"],
      pkce: {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256" as const,
      },
      nonce: "nonce",
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
    };

    mocks.mockRedis.get = t.mock.fn(async () => JSON.stringify(stateData));

    await assert.rejects(
      async () => {
        await service.handleCallback(provider, "code", "valid-state");
      },
      { message: /Provider mismatch/ }
    );
  });

  it("should create new connection if none exists", async (t) => {
    const provider = createMockProvider();
    const stateData = {
      state: "valid-state",
      accountId: "acc-123",
      provider: "x" as ProviderId,
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
      id: "new-conn",
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

    const result = await service.handleCallback(provider, "auth-code", "valid-state");

    assert.strictEqual(
      (mocks.mockPrisma.providerConnection.create as any).mock.calls.length,
      1,
      "Should create new connection"
    );
    assert.strictEqual(result.isNewConnection, true, "Should indicate new connection");

    // Restore original fetch
    global.fetch = mocks.globalFetch;
  });

  it("should update existing connection if found", async (t) => {
    const provider = createMockProvider();
    const stateData = {
      state: "valid-state",
      accountId: "acc-123",
      provider: "x" as ProviderId,
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

    const existingConnection = {
      id: "existing-conn",
      createdAt: new Date(Date.now() - 86400000),
      updatedAt: new Date(),
    };

    mocks.mockRedis.get = t.mock.fn(async () => JSON.stringify(stateData));
    mocks.mockPrisma.providerConnection.findFirst = t.mock.fn(async () => existingConnection);
    mocks.mockPrisma.providerConnection.update = t.mock.fn(async () => existingConnection);

    // Mock fetch for token exchange
    global.fetch = t.mock.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: "token",
        token_type: "Bearer",
      }),
    })) as any;

    const result = await service.handleCallback(provider, "auth-code", "valid-state");

    assert.strictEqual(
      (mocks.mockPrisma.providerConnection.update as any).mock.calls.length,
      1,
      "Should update existing connection"
    );
    assert.strictEqual(result.isNewConnection, false, "Should indicate existing connection");

    // Restore original fetch
    global.fetch = mocks.globalFetch;
  });
});

// ============================================================================
// EnhancedOAuthService - Token Refresh Tests
// ============================================================================

describe("EnhancedOAuthService - Token Refresh", () => {
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

  it("should refresh tokens successfully", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async () => ({
      id: "conn-123",
      refreshToken: "old-refresh-token",
      accountId: "acc-123",
      providerId: "X",
    }));

    mocks.mockPrisma.providerConnection.update = t.mock.fn(async () => ({}));

    await service.refreshTokens(provider, "conn-123");

    assert.strictEqual(
      (mocks.mockPrisma.providerConnection.update as any).mock.calls.length,
      1,
      "Should update connection with new tokens"
    );
  });

  it("should throw error if connection not found", async (t) => {
    const provider = createMockProvider();
    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async () => null);

    await assert.rejects(
      async () => {
        await service.refreshTokens(provider, "non-existent");
      },
      { message: /Connection not found/ }
    );
  });

  it("should throw error if refresh token not available", async (t) => {
    const provider = createMockProvider();
    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async () => ({
      id: "conn-123",
      refreshToken: null,
      accountId: "acc-123",
    }));

    await assert.rejects(
      async () => {
        await service.refreshTokens(provider, "conn-123");
      },
      { message: /Refresh token not available/ }
    );
  });

  it("should update expiration date with new tokens", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async () => ({
      id: "conn-123",
      refreshToken: "refresh-token",
      accountId: "acc-123",
      providerId: "X",
    }));

    mocks.mockPrisma.providerConnection.update = t.mock.fn(async (args: any) => {
      assert.ok(args.data.expiresAt instanceof Date, "Should set new expiration date");
      return {};
    });

    await service.refreshTokens(provider, "conn-123");
  });
});

// ============================================================================
// EnhancedOAuthService - Connection Revocation Tests
// ============================================================================

describe("EnhancedOAuthService - Connection Revocation", () => {
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

  it("should revoke connection successfully", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async () => ({
      id: "conn-123",
      accessToken: "token",
      accountId: "acc-123",
    }));

    mocks.mockPrisma.providerConnection.delete = t.mock.fn(async () => ({}));

    await service.revokeConnection(provider, "conn-123", "acc-123");

    assert.strictEqual(
      (mocks.mockPrisma.providerConnection.delete as any).mock.calls.length,
      1,
      "Should delete connection"
    );
  });

  it("should throw error if connection not found", async (t) => {
    const provider = createMockProvider();
    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async () => null);

    await assert.rejects(
      async () => {
        await service.revokeConnection(provider, "non-existent", "acc-123");
      },
      { message: /Connection not found/ }
    );
  });

  it("should enforce account ownership during revocation", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = t.mock.fn(async (args: any) => {
      if (args.where.accountId === "acc-123") {
        return null;
      }
      return { id: "conn-123", accountId: "other-account" };
    });

    await assert.rejects(
      async () => {
        await service.revokeConnection(provider, "conn-123", "acc-123");
      },
      { message: /Connection not found/ }
    );
  });
});

// ============================================================================
// EnhancedOAuthService - Scope Validation Tests
// ============================================================================

describe("EnhancedOAuthService - Scope Validation", () => {
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

  it("should accept valid scopes", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        allowedScopes: ["read", "write", "admin"],
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123", ["read", "write"]);

    assert.ok(result.authUrl.includes("read"), "Should include read scope");
    assert.ok(result.authUrl.includes("write"), "Should include write scope");
  });

  it("should filter out invalid scopes", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        allowedScopes: ["read", "write"],
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123", ["read", "invalid"]);

    assert.ok(result.authUrl.includes("read"), "Should include valid scope");
    assert.strictEqual(result.authUrl.includes("invalid"), false, "Should exclude invalid scope");
  });

  it("should merge provider default scopes with additional scopes", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        scopes: ["read"],
        allowedScopes: ["read", "write", "admin"],
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123", ["write"]);

    assert.ok(result.authUrl.includes("read"), "Should include default scope");
    assert.ok(result.authUrl.includes("write"), "Should include additional scope");
  });
});
