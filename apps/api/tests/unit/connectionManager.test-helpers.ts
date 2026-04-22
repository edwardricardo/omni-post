/**
 * Shared test helpers for ConnectionManager tests
 */

import { vi } from "vitest";
import type { ProviderConnection } from "@infra/prisma";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  ConnectionManager,
  type ConnectionManagerPrisma,
} from "../../src/auth/connectionManager.js";

/**
 * Build a ConnectionManager for tests, wiring a Noop scheduler so the class
 * under test does not register real timers.
 */
export function createConnectionManager(db: ConnectionManagerPrisma): ConnectionManager {
  return new ConnectionManager(new NoopBackgroundTaskScheduler(), db);
}

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

export function createMockDb(): ConnectionManagerPrisma {
  return {
    providerConnection: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async (_args: any) => createMockConnection()),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}
