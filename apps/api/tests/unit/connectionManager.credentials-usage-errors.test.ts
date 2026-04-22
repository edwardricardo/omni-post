/**
 * ConnectionManager Tests - Credential Updates, Usage Tracking & Error Recording
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { ConnectionManager } from "../../src/auth/connectionManager.js";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";
import {
  createConnectionManager,
  createMockConnection,
  createMockDb,
} from "./connectionManager.test-helpers.js";

// ============================================================================
// ConnectionManager - Credential Updates Tests
// ============================================================================

describe("ConnectionManager - Credential Updates", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should update access token successfully", async (_t) => {
    let capturedArgs: any = null;
    const updatedConnection = createMockConnection({ accessToken: "new-access-token" });
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return updatedConnection;
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const result = await manager.updateCredentials("conn-123", {
      accessToken: "new-access-token",
    });

    expect(result).toBeTruthy();
    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.data.accessToken).toBe("new-access-token");
  });

  it("should update refresh token successfully", async (_t) => {
    let capturedArgs: any = null;
    const updatedConnection = createMockConnection({ refreshToken: "new-refresh-token" });
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return updatedConnection;
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", {
      refreshToken: "new-refresh-token",
    });

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.data.refreshToken).toBe("new-refresh-token");
  });

  it("should update expiration date", async (_t) => {
    const expiresAt = new Date("2025-12-31");
    let capturedArgs: any = null;
    const updatedConnection = createMockConnection({ expiresAt });
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return updatedConnection;
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", { expiresAt });

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.data.expiresAt instanceof Date).toBeTruthy();
  });

  it("should update lastUsedAt timestamp on credential update", async (_t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", { accessToken: "new-token" });

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.data.lastUsedAt instanceof Date).toBeTruthy();
  });

  it("should update multiple credentials atomically", async (_t) => {
    const expiresAt = new Date("2025-12-31");
    let capturedArgs: any = null;
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      capturedArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt,
    });

    expect(capturedArgs).toBeTruthy();
    expect(capturedArgs.data.accessToken).toBe("new-access");
    expect(capturedArgs.data.refreshToken).toBe("new-refresh");
    expect(capturedArgs.data.expiresAt instanceof Date).toBeTruthy();
  });
});

// ============================================================================
// ConnectionManager - Usage Tracking Tests
// ============================================================================

describe("ConnectionManager - Usage Tracking", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should record successful connection usage", async (_t) => {
    const mockConnection = createMockConnection({ healthScore: 95 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordUsage("conn-123");

    expect(updateArgs).toBeTruthy();
    expect(updateArgs.data.lastUsedAt instanceof Date).toBeTruthy();
    expect(updateArgs.data.healthScore >= 95).toBeTruthy();
  });

  it("should increment health score on successful usage", async (_t) => {
    const mockConnection = createMockConnection({ healthScore: 50 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection({ healthScore: 51 });
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordUsage("conn-123");

    expect(updateArgs).toBeTruthy();
    expect(updateArgs.data.healthScore > 50).toBeTruthy();
  });

  it("should cap health score at 100", async (_t) => {
    const mockConnection = createMockConnection({ healthScore: 100 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordUsage("conn-123");

    expect(updateArgs).toBeTruthy();
    expect(updateArgs.data.healthScore <= 100).toBeTruthy();
  });
});

// ============================================================================
// ConnectionManager - Error Recording Tests
// ============================================================================

describe("ConnectionManager - Error Recording", () => {
  let manager: ConnectionManager;
  let mockDb: ConnectionManagerPrisma;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();
  });

  afterEach(() => {
    manager.stopHealthMonitoring();
  });

  it("should record connection error and increment error count", async (_t) => {
    const mockConnection = createMockConnection({ errorCount: 5, healthScore: 100 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Test error");

    expect(updateArgs).toBeTruthy();
    expect(updateArgs.data.errorCount).toBe(6);
    expect(updateArgs.data.lastError).toBe("Test error");
    expect(updateArgs.data.lastErrorAt instanceof Date).toBeTruthy();
  });

  it("should decrease health score on error", async (_t) => {
    const mockConnection = createMockConnection({ errorCount: 0, healthScore: 100 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Test error");

    expect(updateArgs).toBeTruthy();
    expect(updateArgs.data.healthScore < 100).toBeTruthy();
  });

  it("should set status to ERROR when health score drops below 20", async (_t) => {
    const mockConnection = createMockConnection({ errorCount: 8, healthScore: 25 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Critical error");

    expect(updateArgs).toBeTruthy();
    if (updateArgs.data.healthScore < 20) {
      expect(updateArgs.data.status).toBe("ERROR");
    }
  });

  it("should not reduce health score below 0", async (_t) => {
    const mockConnection = createMockConnection({ errorCount: 20, healthScore: 5 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof vi.fn>) = vi.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof vi.fn>) = vi.fn(async (args: any) => {
      updateArgs = args;
      return createMockConnection();
    });
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Another error");

    expect(updateArgs).toBeTruthy();
    expect(updateArgs.data.healthScore >= 0).toBeTruthy();
  });

  it("should handle non-existent connection gracefully", async () => {
    // mockDb.providerConnection.findUnique returns null by default
    manager = createConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    // Should not throw
    await manager.recordError("non-existent", "Test error");
    expect(true).toBeTruthy();
  });
});
