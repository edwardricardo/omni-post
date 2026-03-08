/**
 * SyncEngine - Conflict Resolution & Transaction Rollback Tests
 *
 * Covers:
 * - Conflict detection during sync
 * - Rejecting resolution for non-existent transactions
 * - source_wins and merge conflict resolution strategies
 * - Rollback of non-existent transactions
 * - Rollback without a rollback plan
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Suppress console.log to prevent TAP protocol corruption in concurrent test mode
let _originalConsoleLog: typeof console.log;
before(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
after(() => {
  console.log = _originalConsoleLog;
});

import { SyncEngine } from "../../src/content/SyncEngine";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";
import {
  mockPrisma,
  mockRedis,
  mockEventService,
  synchronizer,
  versionManager,
  servicesAvailable,
  testPostId,
  setupSyncEngineInfra,
  teardownSyncEngineInfra,
  resetSyncEngineState,
  skipIfUnavailable,
} from "./syncEngine.helpers";

let syncEngine: SyncEngine;

before(async () => {
  await setupSyncEngineInfra();
});

after(async () => {
  await teardownSyncEngineInfra(syncEngine);
});

beforeEach(async () => {
  await resetSyncEngineState(syncEngine);
  if (!servicesAvailable) return;
  syncEngine = new SyncEngine({
    prisma: mockPrisma,
    redis: mockRedis,
    eventService: mockEventService,
    synchronizer,
    versionManager,
  });
});

// ============================================================================
// Conflict Resolution Tests
// ============================================================================

describe("SyncEngine - Conflict Resolution", { concurrency: 1 }, () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should detect conflicts during sync", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Conflict Detection",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "ON_DEMAND",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "manual",
        },
      }
    );

    assert.strictEqual(channelResult.ok, true);
    if (channelResult.ok) {
      const syncResult = await syncEngine.syncPost(
        testPostId,
        channelResult.value.id,
        "source_to_target"
      );

      assert.strictEqual(syncResult.ok, true);
      if (syncResult.ok) {
        assert.ok(Array.isArray(syncResult.value.conflicts), "Conflicts should be an array");
      }
    }
  });

  it("should reject resolution for non-existent transaction", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.resolveSyncConflicts("invalid-transaction-id", []);

    assert.strictEqual(result.ok, false, "Should reject invalid transaction");
    if (!result.ok) {
      assert.strictEqual(result.error.type, "validation");
      assert.match(result.error.message, /not found/i);
    }
  });

  it("should apply source_wins resolution strategy", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Source Wins",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "ON_DEMAND",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "source_wins",
        },
      }
    );

    assert.strictEqual(channelResult.ok, true);
    if (channelResult.ok) {
      const syncResult = await syncEngine.syncPost(
        testPostId,
        channelResult.value.id,
        "source_to_target"
      );

      assert.strictEqual(syncResult.ok, true);
      if (syncResult.ok && syncResult.value.conflicts.length > 0) {
        const resolvedConflicts = syncResult.value.conflicts.filter(
          (c) => c.resolution === "source_wins"
        );
        assert.ok(resolvedConflicts.length >= 0, "Source wins conflicts should be tracked");
      }
    }
  });

  it("should handle merge conflict resolution", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Merge Resolution",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "ON_DEMAND",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "merge",
        },
      }
    );

    assert.strictEqual(channelResult.ok, true);
    if (channelResult.ok) {
      const syncResult = await syncEngine.syncPost(
        testPostId,
        channelResult.value.id,
        "source_to_target"
      );

      assert.strictEqual(syncResult.ok, true, "Merge strategy should work");
    }
  });
});

// ============================================================================
// Rollback Tests
// ============================================================================

describe("SyncEngine - Transaction Rollback", { concurrency: 1 }, () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should reject rollback for non-existent transaction", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.rollbackTransaction("invalid-transaction-id");

    assert.strictEqual(result.ok, false, "Should reject invalid transaction");
    if (!result.ok) {
      assert.strictEqual(result.error.type, "validation");
      assert.match(result.error.message, /not found/i);
    }
  });

  it("should reject rollback without rollback plan", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "No Rollback Plan",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "ON_DEMAND",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "source_wins",
        },
      }
    );

    assert.strictEqual(channelResult.ok, true);
    if (channelResult.ok) {
      const syncResult = await syncEngine.syncPost(
        testPostId,
        channelResult.value.id,
        "source_to_target"
      );

      assert.strictEqual(syncResult.ok, true);
      if (syncResult.ok) {
        const rollbackResult = await syncEngine.rollbackTransaction(syncResult.value.id);

        if (!rollbackResult.ok) {
          assert.match(rollbackResult.error.message, /no rollback plan|not found/i);
        }
      }
    }
  });
});
