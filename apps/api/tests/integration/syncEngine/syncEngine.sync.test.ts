/**
 * @file syncEngine.sync.test.ts
 * @description SyncEngine - Real-time Synchronization & Sync Transactions Tests
 *
 * Covers:
 * - Starting real-time sync for valid/invalid channels
 * - Filtering mixed valid/invalid channel IDs
 * - Multi-channel sync for the same post
 * - Creating and executing sync transactions
 * - Rejecting sync with invalid/disabled channels
 * - Bidirectional sync direction
 * - Transaction status tracking
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Suppress console.log to prevent TAP protocol corruption in concurrent test mode
const _originalConsoleLog = console.log;
before(() => {
  console.log = () => {};
});
after(() => {
  console.log = _originalConsoleLog;
});

import { SyncEngine } from "../../../src/content/SyncEngine";
import type { ProviderId } from "../../../src/providers/providerAdapter.interface";
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
// Real-time Sync Tests
// ============================================================================

describe("SyncEngine - Real-time Synchronization", () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should start real-time sync for valid channels", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Realtime Test",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "REAL_TIME",
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
      const result = await syncEngine.startRealtimeSync(testPostId, [channelResult.value.id]);
      assert.strictEqual(result.ok, true);
    }
  });

  it("should reject real-time sync with invalid channel IDs", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.startRealtimeSync(testPostId, [
      "invalid-channel-1",
      "invalid-channel-2",
    ]);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.type, "validation");
      assert.match(result.error.message, /no valid sync channels/i);
    }
  });

  it("should filter out invalid channels but proceed with valid ones", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Valid Channel",
      "twitter" as ProviderId,
      "facebook" as ProviderId,
      {
        mode: "REAL_TIME",
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
      const result = await syncEngine.startRealtimeSync(testPostId, [
        channelResult.value.id,
        "invalid-channel-1",
        "invalid-channel-2",
      ]);

      assert.strictEqual(result.ok, true);
    }
  });

  it("should handle multiple channels for same post", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channel1 = await syncEngine.createSyncChannel(
      "Channel 1",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "REAL_TIME",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "source_wins",
        },
      }
    );

    const channel2 = await syncEngine.createSyncChannel(
      "Channel 2",
      "twitter" as ProviderId,
      "facebook" as ProviderId,
      {
        mode: "REAL_TIME",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "source_wins",
        },
      }
    );

    assert.strictEqual(channel1.ok, true);
    assert.strictEqual(channel2.ok, true);

    if (channel1.ok && channel2.ok) {
      const result = await syncEngine.startRealtimeSync(testPostId, [
        channel1.value.id,
        channel2.value.id,
      ]);

      assert.strictEqual(result.ok, true);
    }
  });
});

// ============================================================================
// Sync Transaction Tests
// ============================================================================

describe("SyncEngine - Sync Transactions", () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should create and execute sync transaction", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Transaction Test",
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
        assert.strictEqual(syncResult.value.postId, testPostId);
        assert.strictEqual(syncResult.value.channelId, channelResult.value.id);
        assert.strictEqual(syncResult.value.direction, "source_to_target");
        assert.ok(syncResult.value.id);
        assert.ok(syncResult.value.startedAt);
      }
    }
  });

  it("should reject sync with invalid channel ID", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.syncPost(testPostId, "invalid-channel-id", "source_to_target");

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.type, "validation");
      assert.match(result.error.message, /not found/i);
    }
  });

  it("should reject sync with disabled channel", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Disabled Channel",
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
      // Manually disable the channel via Redis
      const stored = await mockRedis.get(`sync:channel:${channelResult.value.id}`);
      if (stored) {
        const channel = JSON.parse(stored);
        channel.enabled = false;
        await mockRedis.setex(
          `sync:channel:${channelResult.value.id}`,
          86400,
          JSON.stringify(channel)
        );
      }

      // Recreate engine to reload disabled channel state
      const newEngine = new SyncEngine({
        prisma: mockPrisma,
        redis: mockRedis,
        eventService: mockEventService,
        synchronizer,
        versionManager,
      });
      await newEngine.initialize();

      const result = await newEngine.syncPost(
        testPostId,
        channelResult.value.id,
        "source_to_target"
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.match(result.error.message, /disabled/i);
      }

      await newEngine.shutdown();
    }
  });

  it("should support bidirectional sync direction", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Bidirectional Transaction",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "ON_DEMAND",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "timestamp_wins",
        },
      },
      true
    );

    assert.strictEqual(channelResult.ok, true);
    if (channelResult.ok) {
      const result = await syncEngine.syncPost(testPostId, channelResult.value.id, "bidirectional");

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.direction, "bidirectional");
      }
    }
  });

  it("should track transaction status changes", async (_t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Status Tracking",
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
      const result = await syncEngine.syncPost(
        testPostId,
        channelResult.value.id,
        "source_to_target"
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const validStatuses = ["processing", "completed", "failed", "pending"];
        assert.ok(
          validStatuses.includes(result.value.status),
          `Status should be one of ${validStatuses.join(", ")}, got: ${result.value.status}`
        );
      }
    }
  });
});
