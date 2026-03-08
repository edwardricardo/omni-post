/**
 * Shared test helpers for EnhancedOAuthProvider tests
 */

import type { TestContext } from "node:test";
import type {
  EnhancedOAuthProvider,
  EnhancedOAuthConfig,
} from "../../src/auth/enhancedOAuthProvider";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";

// ============================================================================
// Mock Type Interfaces
// ============================================================================

export interface MockRedis {
  get: ReturnType<TestContext["mock"]["fn"]>;
  setex: ReturnType<TestContext["mock"]["fn"]>;
  del: ReturnType<TestContext["mock"]["fn"]>;
}

export interface MockMetrics {
  metrics: {
    securityThreats: {
      inc: ReturnType<TestContext["mock"]["fn"]>;
    };
  };
}

export interface MockPrisma {
  providerConnection: {
    findUnique: ReturnType<TestContext["mock"]["fn"]>;
    findFirst: ReturnType<TestContext["mock"]["fn"]>;
    update: ReturnType<TestContext["mock"]["fn"]>;
    create: ReturnType<TestContext["mock"]["fn"]>;
    delete: ReturnType<TestContext["mock"]["fn"]>;
  };
}

// ============================================================================
// Mock Factory (call once per beforeEach, use returned object)
// ============================================================================

export interface OAuthMocks {
  mockRedis: MockRedis;
  mockMetrics: MockMetrics;
  mockPrisma: MockPrisma;
  globalFetch: typeof global.fetch;
}

export function setupMocks(t: TestContext): OAuthMocks {
  const mockRedis: MockRedis = {
    get: t.mock.fn(async () => null),
    setex: t.mock.fn(async () => "OK"),
    del: t.mock.fn(async () => 1),
  };

  const mockMetrics: MockMetrics = {
    metrics: {
      securityThreats: {
        inc: t.mock.fn(() => {}),
      },
    },
  };

  const mockPrisma: MockPrisma = {
    providerConnection: {
      findUnique: t.mock.fn(async () => null),
      findFirst: t.mock.fn(async () => null),
      update: t.mock.fn(async () => ({})),
      create: t.mock.fn(async () => ({})),
      delete: t.mock.fn(async () => ({})),
    },
  };

  // Save original fetch
  const globalFetch = global.fetch;

  return { mockRedis, mockMetrics, mockPrisma, globalFetch };
}

// ============================================================================
// Mock Provider Factory
// ============================================================================

export function createMockProvider(
  overrides: Partial<EnhancedOAuthProvider> = {}
): EnhancedOAuthProvider {
  const baseConfig: EnhancedOAuthConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/callback",
    scopes: ["read", "write"],
    authUrl: "https://provider.com/oauth/authorize",
    tokenUrl: "https://provider.com/oauth/token",
    userInfoUrl: "https://provider.com/api/user",
    requirePKCE: true,
    validateCertificates: true,
    encryptStoredTokens: true,
    maxScopeCount: 10,
    allowedScopes: ["read", "write", "admin"],
    authorizationTimeout: 300,
    tokenRequestTimeout: 30,
    stateExpiryMinutes: 10,
  };

  return {
    id: "x" as ProviderId,
    config: baseConfig,
    async validateAuthorizationCode(_code: string, _state: string, _codeVerifier?: string) {
      return {
        tokens: {
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          expiresIn: 3600,
          tokenType: "Bearer",
        },
        userInfo: {
          id: "user-123",
          name: "Test User",
          email: "test@example.com",
          username: "testuser",
        },
        validatedScopes: ["read", "write"],
      };
    },
    async getUserInfo(_accessToken: string) {
      return {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
      };
    },
    async refreshAccessToken(_refreshToken: string) {
      return {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      };
    },
    async validateTokenScopes(_token: string, _requiredScopes: string[]) {
      return true;
    },
    ...overrides,
  };
}
