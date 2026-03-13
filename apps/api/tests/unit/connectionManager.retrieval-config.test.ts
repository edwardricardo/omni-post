/**
 * ConnectionManager Tests - Connection Retrieval & Configuration
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { ConnectionManager } from "../../src/auth/connectionManager.js";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";
import { createMockConnection, createMockDb } from "./connectionManager.test-helpers.js";

// ============================================================================
// ConnectionManager - Connection Retrieval Tests
// ============================================================================

describe("ConnectionManager - Connection Retrieval", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = new ConnectionManager(mockDb);
    // Stop health monitoring to avoid interference
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should retrieve connection by ID", async (t) => {
    const mockConnection = createMockConnection();
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const result = await manager.getConnection("conn-123");

    expect(result).toBeTruthy();
    expect(result?.id).toBe("conn-123");
  });

  it("should return null for non-existent connection", async () => {
    const result = await manager.getConnection("non-existent");

    expect(result).toBe(null);
  });

  it("should retrieve connections by account ID", async (t) => {
    const mockConnections = [
      createMockConnection({ id: "conn-1" }),
      createMockConnection({ id: "conn-2" }),
    ];
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnections
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const result = await manager.getConnections("acc-123");

    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(2);
  });

  it("should filter connections by provider ID (uppercased)", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return [];
    });
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.getConnections("acc-123", undefined, "x" as any);

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.where.providerId).toBe("X");
  });

  it("should filter connections by project ID", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return [];
    });
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.getConnections("acc-123", "proj-123");

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.where.projectId).toBe("proj-123");
  });

  it("should order connections by status, last used, and creation date", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.findMany as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return [];
    });
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.getConnections("acc-123");

    expect(capturedArgs).toBeTruthy();
    expect(Array.isArray(capturedArgs.orderBy)).toBeTruthy();
    expect(capturedArgs.orderBy[0].status).toBe("asc");
    expect(capturedArgs.orderBy[1].lastUsedAt).toBe("desc");
  });
});

// ============================================================================
// ConnectionManager - Connection Configuration Tests
// ============================================================================

describe("ConnectionManager - Connection Configuration", () => {
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

    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const config = await manager.getConnectionConfig("conn-123");

    expect(config).toBeTruthy();
    expect((config as any).accessToken).toBe("access-123");
    expect((config as any).refreshToken).toBe("refresh-123");
    expect((config as any).apiKey).toBe("api-key-123");
  });

  it("should return null for inactive connection", async (t) => {
    const mockConnection = createMockConnection({ isActive: false });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const config = await manager.getConnectionConfig("conn-123");

    expect(config).toBe(null);
  });

  it("should return null for non-existent connection", async () => {
    const config = await manager.getConnectionConfig("conn-123");

    expect(config).toBe(null);
  });

  it("should include connection metadata in config", async (t) => {
    const connectedAt = new Date("2024-01-01");
    const expiresAt = new Date("2025-12-31");
    const mockConnection = createMockConnection({ connectedAt, expiresAt });
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const config = await manager.getConnectionConfig("conn-123");

    expect(config).toBeTruthy();
    expect((config as any).connectedAt instanceof Date).toBeTruthy();
    expect((config as any).expiresAt instanceof Date).toBeTruthy();
  });
});
