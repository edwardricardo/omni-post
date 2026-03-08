/**
 * ConnectionManager Tests - Health Check, Connection Summary & Cleanup Operations
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { ConnectionManager } from "../../src/auth/connectionManager.js";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";
import { createMockConnection, createMockDb } from "./connectionManager.test-helpers.js";

// ============================================================================
// ConnectionManager - Health Check Tests
// ============================================================================

describe("ConnectionManager - Health Check", { concurrency: 1 }, () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach((t) => {
    mockDb = createMockDb(t);
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should perform health check on active connection", async (t) => {
    const mockConnection = createMockConnection();
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.ok(health, "Should return health report");
    assert.strictEqual(typeof health.healthy, "boolean", "Should have healthy flag");
    assert.strictEqual(typeof health.score, "number", "Should have health score");
    assert.ok(Array.isArray(health.errors), "Should have errors array");
    assert.ok(Array.isArray(health.warnings), "Should have warnings array");
  });

  it("should report unhealthy for ERROR status", async (t) => {
    const mockConnection = createMockConnection({ status: "ERROR" as any });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.strictEqual(health.healthy, false, "Should be unhealthy");
    assert.ok(health.errors.length > 0, "Should have error messages");
  });

  it("should report unhealthy for EXPIRED status", async (t) => {
    const mockConnection = createMockConnection({ status: "EXPIRED" as any });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.strictEqual(health.healthy, false, "Should be unhealthy");
    assert.ok(
      health.errors.some((e) => e.includes("EXPIRED")),
      "Should report expired status"
    );
  });

  it("should detect expired access token", async (t) => {
    const mockConnection = createMockConnection({
      expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
    });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.strictEqual(health.healthy, false, "Should be unhealthy");
    assert.ok(
      health.errors.some((e) => e.includes("expired")),
      "Should report token expiration"
    );
  });

  it("should warn about soon-to-expire tokens", async (t) => {
    const mockConnection = createMockConnection({
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours from now
    });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.ok(health.warnings.length > 0, "Should have warnings");
    assert.ok(health.recommendations.length > 0, "Should have recommendations");
  });

  it("should warn about high error count", async (t) => {
    const mockConnection = createMockConnection({ errorCount: 15 });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.ok(
      health.warnings.some((w) => w.includes("error count")),
      "Should warn about errors"
    );
  });

  it("should recommend disconnecting unused connections", async (t) => {
    const mockConnection = createMockConnection({
      lastUsedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const health = await manager.checkConnectionHealth("conn-123");

    assert.ok(
      health.warnings.some((w) => w.includes("not used")),
      "Should warn about inactivity"
    );
    assert.ok(
      health.recommendations.some((r) => r.includes("disconnecting")),
      "Should recommend disconnection"
    );
  });

  it("should cache health check results", async (t) => {
    const mockConnection = createMockConnection();
    const findUniqueMock = t.mock.fn(async () => mockConnection);
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = findUniqueMock;
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.checkConnectionHealth("conn-123");
    const callCount1 = findUniqueMock.mock.calls.length;

    // Second call should use cache
    await manager.checkConnectionHealth("conn-123");
    const callCount2 = findUniqueMock.mock.calls.length;

    assert.strictEqual(
      callCount2,
      callCount1,
      "Should use cached result (no additional findUnique calls)"
    );
  });

  it("should throw error for non-existent connection", async () => {
    // mockDb.providerConnection.findUnique returns null by default

    await assert.rejects(
      async () => {
        await manager.checkConnectionHealth("non-existent");
      },
      { message: "Connection not found" }
    );
  });
});

// ============================================================================
// ConnectionManager - Connection Summary Tests
// ============================================================================

describe("ConnectionManager - Connection Summary", { concurrency: 1 }, () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach((t) => {
    mockDb = createMockDb(t);
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
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    assert.strictEqual(summary.total, 2, "Should count total connections");
    assert.strictEqual(summary.connected, 2, "Should count connected");
  });

  it("should count connections by status", async (t) => {
    const mockConnections = [
      createMockConnection({ status: "CONNECTED" as any }),
      createMockConnection({ status: "ERROR" as any }),
      createMockConnection({ status: "EXPIRED" as any }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    assert.strictEqual(summary.connected, 1, "Should count connected");
    assert.strictEqual(summary.error, 1, "Should count errors");
    assert.strictEqual(summary.expired, 1, "Should count expired");
  });

  it("should count connections by provider", async (t) => {
    const mockConnections = [
      createMockConnection({ providerId: "X" as any }),
      createMockConnection({ providerId: "X" as any }),
      createMockConnection({ providerId: "INSTAGRAM" as any }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    assert.strictEqual(summary.byProvider["x"], 2, "Should count X connections");
    assert.strictEqual(summary.byProvider["instagram"], 1, "Should count Instagram connections");
  });

  it("should calculate average health score", async (t) => {
    const mockConnections = [
      createMockConnection({ healthScore: 100 }),
      createMockConnection({ healthScore: 80 }),
      createMockConnection({ healthScore: 60 }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const summary = await manager.getConnectionsSummary("acc-123");

    assert.strictEqual(summary.healthScore, 80, "Should calculate average health score");
  });

  it("should return 100 health score for no connections", async () => {
    // mockDb returns empty array by default

    const summary = await manager.getConnectionsSummary("acc-123");

    assert.strictEqual(summary.healthScore, 100, "Should return 100 for no connections");
  });
});

// ============================================================================
// ConnectionManager - Cleanup Tests
// ============================================================================

describe("ConnectionManager - Cleanup Operations", { concurrency: 1 }, () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach((t) => {
    mockDb = createMockDb(t);
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should cleanup expired connections", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.updateMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return { count: 3 };
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const count = await manager.cleanupExpiredConnections();

    assert.strictEqual(count, 3, "Should return count of cleaned up connections");
    assert.ok(capturedArgs, "Should have called updateMany");
    assert.ok(capturedArgs.where.expiresAt.lt instanceof Date, "Should filter by expiration date");
    assert.strictEqual(capturedArgs.data.status, "EXPIRED", "Should set status to EXPIRED");
    assert.strictEqual(capturedArgs.data.isActive, false, "Should deactivate");
  });

  it("should only update active connections that are not already expired", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.updateMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return { count: 1 };
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.cleanupExpiredConnections();

    assert.ok(capturedArgs, "Should have called updateMany");
    assert.strictEqual(capturedArgs.where.isActive, true, "Should only target active connections");
    assert.strictEqual(capturedArgs.where.status.not, "EXPIRED", "Should exclude already expired");
  });
});
