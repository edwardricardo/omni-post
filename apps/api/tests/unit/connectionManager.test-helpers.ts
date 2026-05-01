/**
 * Shared test helpers for ConnectionManager tests
 *
 * @file connectionManager.test-helpers.ts
 * @description Test helpers for connection manager test helpers
 * @layer infrastructure
 */

import { vi } from "vitest";
import type { ProviderConnection } from "@infra/prisma";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { InMemoryCacheAdapter } from "../../../../packages/adapters/cache-redis/src/in-memory-cache-adapter.js";
import {
  ConnectionManager,
  type ConnectionManagerPrisma,
} from "../../src/auth/connectionManager.js";

/**
 * Build a ConnectionManager for tests, wiring a Noop scheduler so the class
 * under test does not register real timers, and an in-memory cache adapter so
 * cache-aside behavior is exercised without external Redis.
 */
export function createConnectionManager(db: ConnectionManagerPrisma): ConnectionManager {
  return new ConnectionManager(new NoopBackgroundTaskScheduler(), db, new InMemoryCacheAdapter());
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
