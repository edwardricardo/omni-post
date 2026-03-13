/**
 * Shared test helpers for EnhancedOAuthProvider tests
 */

import type {
  EnhancedOAuthProvider,
  EnhancedOAuthConfig,
} from "../../src/auth/enhancedOAuthProvider";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";

// ============================================================================
// Mock Type Interfaces
// ============================================================================

export interface MockRedis {
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

export interface MockMetrics {
  metrics: {
    securityThreats: {
      inc: ReturnType<typeof vi.fn>;
    };
  };
}

export interface MockPrisma {
  providerConnection: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
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

export function setupMocks(): OAuthMocks {
  const mockRedis: MockRedis = {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  };

  const mockMetrics: MockMetrics = {
    metrics: {
      securityThreats: {
        inc: vi.fn(() => {}),
      },
    },
  };

  const mockPrisma: MockPrisma = {
    providerConnection: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
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
