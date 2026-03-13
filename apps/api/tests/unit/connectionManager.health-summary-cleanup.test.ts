/**
 * ConnectionManager Tests - Health Check, Connection Summary & Cleanup Operations
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { ConnectionManager } from "../../src/auth/connectionManager.js";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";
import { createMockConnection, createMockDb } from "./connectionManager.test-helpers.js";

// ============================================================================
// ConnectionManager - Health Check Tests
// ============================================================================

describe("ConnectionManager - Health Check", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should perform health check on active connection", async (t) => {
    const mockConnection = createMockConnection();
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health).toBeTruthy();
    expect(typeof health.healthy).toBe("boolean");
    expect(typeof health.score).toBe("number");
    expect(Array.isArray(health.errors)).toBeTruthy();
    expect(Array.isArray(health.warnings)).toBeTruthy();
  });

  it("should report unhealthy for ERROR status", async (t) => {
    const mockConnection = createMockConnection({ status: "ERROR" as any });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health.healthy).toBe(false);
    expect(health.errors.length > 0).toBeTruthy();
  });

  it("should report unhealthy for EXPIRED status", async (t) => {
    const mockConnection = createMockConnection({ status: "EXPIRED" as any });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health.healthy).toBe(false);
    expect(health.errors.some((e) => e.includes("EXPIRED"))).toBeTruthy();
  });

  it("should detect expired access token", async (t) => {
    const mockConnection = createMockConnection({
      expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
    });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health.healthy).toBe(false);
    expect(health.errors.some((e) => e.includes("expired"))).toBeTruthy();
  });

  it("should warn about soon-to-expire tokens", async (t) => {
    const mockConnection = createMockConnection({
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours from now
    });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health.warnings.length > 0).toBeTruthy();
    expect(health.recommendations.length > 0).toBeTruthy();
  });

  it("should warn about high error count", async (t) => {
    const mockConnection = createMockConnection({ errorCount: 15 });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health.warnings.some((w) => w.includes("error count"))).toBeTruthy();
  });

  it("should recommend disconnecting unused connections", async (t) => {
    const mockConnection = createMockConnection({
      lastUsedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    expect(health.warnings.some((w) => w.includes("not used"))).toBeTruthy();
    expect(health.recommendations.some((r) => r.includes("disconnecting"))).toBeTruthy();
  });

  it("should cache health check results", async (t) => {
    const mockConnection = createMockConnection();
    const findUniqueMock = vi.fn(async () => mockConnection);
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = findUniqueMock;
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.checkConnectionHealth("conn-123");
    const callCount1 = findUniqueMock.mock.calls.length;

    // Second call should use cache
    await manager.checkConnectionHealth("conn-123");
    const callCount2 = findUniqueMock.mock.calls.length;

    expect(callCount2).toBe(callCount1);
  });

  it("should throw error for non-existent connection", async () => {
    // mockDb.providerConnection.findUnique returns null by default

    await expect(manager.checkConnectionHealth("non-existent")).rejects.toThrow(
      "Connection not found"
    );
  });
});

// ============================================================================
// ConnectionManager - Connection Summary Tests
// ============================================================================

describe("ConnectionManager - Connection Summary", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should generate summary for account connections", async (t) => {
    const mockConnections = [
      createMockConnection({ providerId: "X" as any, status: "CONNECTED" as any }),
      createMockConnection({ providerId: "INSTAGRAM" as any, status: "CONNECTED" as any }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    expect(summary.total).toBe(2);
    expect(summary.connected).toBe(2);
  });

  it("should count connections by status", async (t) => {
    const mockConnections = [
      createMockConnection({ status: "CONNECTED" as any }),
      createMockConnection({ status: "ERROR" as any }),
      createMockConnection({ status: "EXPIRED" as any }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    expect(summary.connected).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.expired).toBe(1);
  });

  it("should count connections by provider", async (t) => {
    const mockConnections = [
      createMockConnection({ providerId: "X" as any }),
      createMockConnection({ providerId: "X" as any }),
      createMockConnection({ providerId: "INSTAGRAM" as any }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    expect(summary.byProvider["x"]).toBe(2);
    expect(summary.byProvider["instagram"]).toBe(1);
  });

  it("should calculate average health score", async (t) => {
    const mockConnections = [
      createMockConnection({ healthScore: 100 }),
      createMockConnection({ healthScore: 80 }),
      createMockConnection({ healthScore: 60 }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    expect(summary.healthScore).toBe(80);
  });

  it("should return 100 health score for no connections", async () => {
    // mockDb returns empty array by default

    const summary = await manager.getConnectionsSummary("acc-123");

    expect(summary.healthScore).toBe(100);
  });
});

// ============================================================================
// ConnectionManager - Cleanup Tests
// ============================================================================

describe("ConnectionManager - Cleanup Operations", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should cleanup expired connections", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.updateMany as ReturnType<typeof vi.fn>) = vi.fn(
      async (args: any) => {
        capturedArgs = args;
        return { count: 3 };
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const count = await manager.cleanupExpiredConnections();

    expect(count).toBe(3);
    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.where.expiresAt.lt instanceof Date).toBeTruthy();
    expect(capturedArgs.data.status).toBe("EXPIRED");
    expect(capturedArgs.data.isActive).toBe(false);
  });

  it("should only update active connections that are not already expired", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.updateMany as ReturnType<typeof vi.fn>) = vi.fn(
      async (args: any) => {
        capturedArgs = args;
        return { count: 1 };
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.cleanupExpiredConnections();

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.where.isActive).toBe(true);
    expect(capturedArgs.where.status.not).toBe("EXPIRED");
  });
});
