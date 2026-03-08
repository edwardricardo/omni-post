/**
 * ConnectionManager Tests - Credential Updates, Usage Tracking & Error Recording
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { ConnectionManager } from "../../src/auth/connectionManager.js";
import type { ConnectionManagerPrisma } from "../../src/auth/connectionManager.js";
import { createMockConnection, createMockDb } from "./connectionManager.test-helpers.js";

// ============================================================================
// ConnectionManager - Credential Updates Tests
// ============================================================================

describe("ConnectionManager - Credential Updates", { concurrency: 1 }, () => {
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

  it("should update access token successfully", async (t) => {
    let capturedArgs: any = null;
    const updatedConnection = createMockConnection({ accessToken: "new-access-token" });
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return updatedConnection;
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    const result = await manager.updateCredentials("conn-123", {
      accessToken: "new-access-token",
    });

    assert.ok(result, "Should return updated connection");
    assert.ok(capturedArgs, "Should have called update");
    assert.strictEqual(
      capturedArgs.data.accessToken,
      "new-access-token",
      "Should update access token"
    );
  });

  it("should update refresh token successfully", async (t) => {
    let capturedArgs: any = null;
    const updatedConnection = createMockConnection({ refreshToken: "new-refresh-token" });
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return updatedConnection;
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", {
      refreshToken: "new-refresh-token",
    });

    assert.ok(capturedArgs, "Should have called update");
    assert.strictEqual(
      capturedArgs.data.refreshToken,
      "new-refresh-token",
      "Should update refresh token"
    );
  });

  it("should update expiration date", async (t) => {
    const expiresAt = new Date("2025-12-31");
    let capturedArgs: any = null;
    const updatedConnection = createMockConnection({ expiresAt });
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return updatedConnection;
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", { expiresAt });

    assert.ok(capturedArgs, "Should have called update");
    assert.ok(capturedArgs.data.expiresAt instanceof Date, "Should update expiration date");
  });

  it("should update lastUsedAt timestamp on credential update", async (t) => {
    let capturedArgs: any = null;
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", { accessToken: "new-token" });

    assert.ok(capturedArgs, "Should have called update");
    assert.ok(capturedArgs.data.lastUsedAt instanceof Date, "Should update lastUsedAt");
  });

  it("should update multiple credentials atomically", async (t) => {
    const expiresAt = new Date("2025-12-31");
    let capturedArgs: any = null;
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        capturedArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.updateCredentials("conn-123", {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt,
    });

    assert.ok(capturedArgs, "Should have called update");
    assert.strictEqual(capturedArgs.data.accessToken, "new-access", "Should include access token");
    assert.strictEqual(
      capturedArgs.data.refreshToken,
      "new-refresh",
      "Should include refresh token"
    );
    assert.ok(capturedArgs.data.expiresAt instanceof Date, "Should include expiration");
  });
});

// ============================================================================
// ConnectionManager - Usage Tracking Tests
// ============================================================================

describe("ConnectionManager - Usage Tracking", { concurrency: 1 }, () => {
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

  it("should record successful connection usage", async (t) => {
    const mockConnection = createMockConnection({ healthScore: 95 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordUsage("conn-123");

    assert.ok(updateArgs, "Should have called update");
    assert.ok(updateArgs.data.lastUsedAt instanceof Date, "Should update lastUsedAt");
    assert.ok(updateArgs.data.healthScore >= 95, "Should maintain or improve health score");
  });

  it("should increment health score on successful usage", async (t) => {
    const mockConnection = createMockConnection({ healthScore: 50 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection({ healthScore: 51 });
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordUsage("conn-123");

    assert.ok(updateArgs, "Should have called update");
    assert.ok(updateArgs.data.healthScore > 50, "Should increment health score");
  });

  it("should cap health score at 100", async (t) => {
    const mockConnection = createMockConnection({ healthScore: 100 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordUsage("conn-123");

    assert.ok(updateArgs, "Should have called update");
    assert.ok(updateArgs.data.healthScore <= 100, "Should not exceed 100");
  });
});

// ============================================================================
// ConnectionManager - Error Recording Tests
// ============================================================================

describe("ConnectionManager - Error Recording", { concurrency: 1 }, () => {
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

  it("should record connection error and increment error count", async (t) => {
    const mockConnection = createMockConnection({ errorCount: 5, healthScore: 100 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Test error");

    assert.ok(updateArgs, "Should have called update");
    assert.strictEqual(updateArgs.data.errorCount, 6, "Should increment error count");
    assert.strictEqual(updateArgs.data.lastError, "Test error", "Should store error message");
    assert.ok(updateArgs.data.lastErrorAt instanceof Date, "Should update error timestamp");
  });

  it("should decrease health score on error", async (t) => {
    const mockConnection = createMockConnection({ errorCount: 0, healthScore: 100 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Test error");

    assert.ok(updateArgs, "Should have called update");
    assert.ok(updateArgs.data.healthScore < 100, "Should decrease health score");
  });

  it("should set status to ERROR when health score drops below 20", async (t) => {
    const mockConnection = createMockConnection({ errorCount: 8, healthScore: 25 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Critical error");

    assert.ok(updateArgs, "Should have called update");
    if (updateArgs.data.healthScore < 20) {
      assert.strictEqual(updateArgs.data.status, "ERROR", "Should set status to ERROR");
    }
  });

  it("should not reduce health score below 0", async (t) => {
    const mockConnection = createMockConnection({ errorCount: 20, healthScore: 5 });
    let updateArgs: any = null;
    (mockDb.providerConnection.findUnique as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async () => mockConnection
    );
    (mockDb.providerConnection.update as ReturnType<typeof t.mock.fn>) = t.mock.fn(
      async (args: any) => {
        updateArgs = args;
        return createMockConnection();
      }
    );
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    await manager.recordError("conn-123", "Another error");

    assert.ok(updateArgs, "Should have called update");
    assert.ok(updateArgs.data.healthScore >= 0, "Should not go below 0");
  });

  it("should handle non-existent connection gracefully", async () => {
    // mockDb.providerConnection.findUnique returns null by default
    manager = new ConnectionManager(mockDb);
    manager.stopHealthMonitoring();

    // Should not throw
    await manager.recordError("non-existent", "Test error");
    assert.ok(true, "Should handle non-existent connection without throwing");
  });
});
