/**
 * ConnectionManager Tests - Connection Retrieval & Configuration
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { ConnectionManager } from "../../src/auth/connectionManager.js";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";
import { createMockConnection, createMockDb } from "./connectionManager.test-helpers.js";

// ============================================================================
// ConnectionManager - Connection Retrieval Tests
// ============================================================================

describe("ConnectionManager - Connection Retrieval", { concurrency: 1 }, () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach((t) => {
    mockDb = createMockDb(t);
    manager = new ConnectionManager(mockDb);
    // Stop health monitoring to avoid interference
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should retrieve connection by ID", async (t) => {
    const mockConnection = createMockConnection();
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const result = await manager.getConnection("conn-123");

    assert.ok(result, "Should return a connection");
    assert.strictEqual(result?.id, "conn-123");
  });

  it("should return null for non-existent connection", async () => {
    const result = await manager.getConnection("non-existent");

    assert.strictEqual(result, null, "Should return null for non-existent connection");
  });

  it("should retrieve connections by account ID", async (t) => {
    const mockConnections = [
      createMockConnection({ id: "conn-1" }),
      createMockConnection({ id: "conn-2" }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const result = await manager.getConnections("acc-123");

    assert.ok(Array.isArray(result), "Should return an array");
    assert.strictEqual(result.length, 2, "Should return 2 connections");
  });

  it("should filter connections by provider ID (uppercased)", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return [];
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.getConnections("acc-123", undefined, "x" as any);

    assert.ok(capturedArgs, "Should have been called");
    assert.strictEqual(capturedArgs.where.providerId, "X", "Should uppercase provider ID");
  });

  it("should filter connections by project ID", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return [];
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.getConnections("acc-123", "proj-123");

    assert.ok(capturedArgs, "Should have been called");
    assert.strictEqual(capturedArgs.where.projectId, "proj-123", "Should filter by project ID");
  });

  it("should order connections by status, last used, and creation date", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.findMany as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return [];
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.getConnections("acc-123");

    assert.ok(capturedArgs, "Should have been called");
    assert.ok(Array.isArray(capturedArgs.orderBy), "Should have orderBy array");
    assert.strictEqual(capturedArgs.orderBy[0].status, "asc", "Should order by status ascending");
    assert.strictEqual(
      capturedArgs.orderBy[1].lastUsedAt,
      "desc",
      "Should order by lastUsedAt descending"
    );
  });
});

// ============================================================================
// ConnectionManager - Connection Configuration Tests
// ============================================================================

describe("ConnectionManager - Connection Configuration", { concurrency: 1 }, () => {
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

  it("should build connection config with all available credentials", async (t) => {
    const mockConnection = createMockConnection({
      accessToken: "access-123",
      refreshToken: "refresh-123",
      apiKey: "api-key-123",
      apiSecret: "api-secret-123",
      providerAccountId: "provider-acc-123",
      accountName: "@testuser",
      profileImage: "https://example.com/avatar.jpg",
      expiresAt: new Date("2025-12-31"),
    });

    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const config = await manager.getConnectionConfig("conn-123");

    assert.ok(config, "Should return config");
    assert.strictEqual((config as any).accessToken, "access-123", "Should include access token");
    assert.strictEqual((config as any).refreshToken, "refresh-123", "Should include refresh token");
    assert.strictEqual((config as any).apiKey, "api-key-123", "Should include API key");
  });

  it("should return null for inactive connection", async (t) => {
    const mockConnection = createMockConnection({ isActive: false });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const config = await manager.getConnectionConfig("conn-123");

    assert.strictEqual(config, null, "Should return null for inactive connection");
  });

  it("should return null for non-existent connection", async () => {
    const config = await manager.getConnectionConfig("conn-123");

    assert.strictEqual(config, null, "Should return null for non-existent connection");
  });

  it("should include connection metadata in config", async (t) => {
    const connectedAt = new Date("2024-01-01");
    const expiresAt = new Date("2025-12-31");
    const mockConnection = createMockConnection({ connectedAt, expiresAt });
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const config = await manager.getConnectionConfig("conn-123");

    assert.ok(config, "Should return config");
    assert.ok((config as any).connectedAt instanceof Date, "Should include connectedAt");
    assert.ok((config as any).expiresAt instanceof Date, "Should include expiresAt");
  });
});
