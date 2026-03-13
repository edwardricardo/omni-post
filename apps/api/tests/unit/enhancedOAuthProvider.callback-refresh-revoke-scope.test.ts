/**
 * EnhancedOAuthService Tests - Callback Handling, Token Refresh,
 * Connection Revocation & Scope Validation
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
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

  beforeEach(() => {
    mocks = setupMocks();
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should handle OAuth error responses", async () => {
    const provider = createMockProvider();

    await expect(
      service.handleCallback(provider, "code", "state", "access_denied")
    ).rejects.toThrow(/OAuth provider error/);
  });

  it("should increment security threat metric on error", async () => {
    const provider = createMockProvider();

    try {
      await service.handleCallback(provider, "code", "state", "invalid_request");
    } catch {
      // Expected to fail
    }

    expect((mocks.mockMetrics.metrics.securityThreats.inc as any).mock.calls.length).toBe(1);
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

    mocks.mockRedis.get = vi.fn(async () => JSON.stringify(stateData));

    await expect(service.handleCallback(provider, "code", "valid-state")).rejects.toThrow(
      /Provider mismatch/
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

    mocks.mockRedis.get = vi.fn(async () => JSON.stringify(stateData));
    mocks.mockPrisma.providerConnection.findFirst = vi.fn(async () => null);
    mocks.mockPrisma.providerConnection.create = vi.fn(async () => ({
      id: "new-conn",
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

    const result = await service.handleCallback(provider, "auth-code", "valid-state");

    expect((mocks.mockPrisma.providerConnection.create as any).mock.calls.length).toBe(1);
    expect(result.isNewConnection).toBe(true);

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

    mocks.mockRedis.get = vi.fn(async () => JSON.stringify(stateData));
    mocks.mockPrisma.providerConnection.findFirst = vi.fn(async () => existingConnection);
    mocks.mockPrisma.providerConnection.update = vi.fn(async () => existingConnection);

    // Mock fetch for token exchange
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: "token",
        token_type: "Bearer",
      }),
    })) as any;

    const result = await service.handleCallback(provider, "auth-code", "valid-state");

    expect((mocks.mockPrisma.providerConnection.update as any).mock.calls.length).toBe(1);
    expect(result.isNewConnection).toBe(false);

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

  beforeEach(() => {
    mocks = setupMocks();
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should refresh tokens successfully", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async () => ({
      id: "conn-123",
      refreshToken: "old-refresh-token",
      accountId: "acc-123",
      providerId: "X",
    }));

    mocks.mockPrisma.providerConnection.update = vi.fn(async () => ({}));

    await service.refreshTokens(provider, "conn-123");

    expect((mocks.mockPrisma.providerConnection.update as any).mock.calls.length).toBe(1);
  });

  it("should throw error if connection not found", async (t) => {
    const provider = createMockProvider();
    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async () => null);

    await expect(service.refreshTokens(provider, "non-existent")).rejects.toThrow(
      /Connection not found/
    );
  });

  it("should throw error if refresh token not available", async (t) => {
    const provider = createMockProvider();
    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async () => ({
      id: "conn-123",
      refreshToken: null,
      accountId: "acc-123",
    }));

    await expect(service.refreshTokens(provider, "conn-123")).rejects.toThrow(
      /Refresh token not available/
    );
  });

  it("should update expiration date with new tokens", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async () => ({
      id: "conn-123",
      refreshToken: "refresh-token",
      accountId: "acc-123",
      providerId: "X",
    }));

    mocks.mockPrisma.providerConnection.update = vi.fn(async (args: any) => {
      expect(args.data.expiresAt instanceof Date).toBeTruthy();
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

  beforeEach(() => {
    mocks = setupMocks();
    service = new EnhancedOAuthService(
      mocks.mockRedis as any,
      mocks.mockMetrics as any,
      mocks.mockPrisma as any
    );
  });

  it("should revoke connection successfully", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async () => ({
      id: "conn-123",
      accessToken: "token",
      accountId: "acc-123",
    }));

    mocks.mockPrisma.providerConnection.delete = vi.fn(async () => ({}));

    await service.revokeConnection(provider, "conn-123", "acc-123");

    expect((mocks.mockPrisma.providerConnection.delete as any).mock.calls.length).toBe(1);
  });

  it("should throw error if connection not found", async (t) => {
    const provider = createMockProvider();
    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async () => null);

    await expect(service.revokeConnection(provider, "non-existent", "acc-123")).rejects.toThrow(
      /Connection not found/
    );
  });

  it("should enforce account ownership during revocation", async (t) => {
    const provider = createMockProvider();

    mocks.mockPrisma.providerConnection.findUnique = vi.fn(async (args: any) => {
      if (args.where.accountId === "acc-123") {
        return null;
      }
      return { id: "conn-123", accountId: "other-account" };
    });

    await expect(service.revokeConnection(provider, "conn-123", "acc-123")).rejects.toThrow(
      /Connection not found/
    );
  });
});

// ============================================================================
// EnhancedOAuthService - Scope Validation Tests
// ============================================================================

describe("EnhancedOAuthService - Scope Validation", () => {
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

  it("should accept valid scopes", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        allowedScopes: ["read", "write", "admin"],
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123", ["read", "write"]);

    expect(result.authUrl.includes("read")).toBeTruthy();
    expect(result.authUrl.includes("write")).toBeTruthy();
  });

  it("should filter out invalid scopes", async () => {
    const provider = createMockProvider({
      config: {
        ...createMockProvider().config,
        allowedScopes: ["read", "write"],
      },
    });

    const result = await service.generateAuthorizationUrl(provider, "acc-123", ["read", "invalid"]);

    expect(result.authUrl.includes("read")).toBeTruthy();
    expect(result.authUrl.includes("invalid")).toBe(false);
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

    expect(result.authUrl.includes("read")).toBeTruthy();
    expect(result.authUrl.includes("write")).toBeTruthy();
  });
});
