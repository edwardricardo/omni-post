/**
 * Shared test helpers for ConnectionManager tests
 */

import type { TestContext } from "node:test";
import type { ProviderConnection } from "@infra/prisma";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";

export function createMockConnection(
  overrides: Partial<ProviderConnection> = {}
): ProviderConnection {
  return {
    id: "conn-123",
    accountId: "acc-123",
    projectId: "proj-123",
    providerId: "X" as any,
    providerName: "X",
    providerAccountId: "x-user-123",
    accountName: "@testuser",
    accessToken: "access-token-123",
    refreshToken: "refresh-token-123",
    expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    isActive: true,
    isVerified: true,
    status: "CONNECTED" as any,
    connectedAt: new Date(),
    lastUsedAt: new Date(),
    healthScore: 100,
    errorCount: 0,
    lastError: null,
    lastErrorAt: null,
    lastHealthCheck: new Date(),
    capabilities: {},
    limits: {},
    constraints: {},
    profileImage: null,
    apiKey: null,
    apiSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockDb(t: TestContext): ConnectionManagerPrisma {
  return {
    providerConnection: {
      findUnique: t.mock.fn(async () => null),
      findMany: t.mock.fn(async () => []),
      update: t.mock.fn(async (_args: any) => createMockConnection()),
      updateMany: t.mock.fn(async () => ({ count: 0 })),
    },
  };
}
