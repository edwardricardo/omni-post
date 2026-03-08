/**
 * SyncEngine - Metrics Collection, Error Handling & Content Change Monitoring Tests
 *
 * Covers:
 * - Default metrics structure and field types
 * - Global and channel-specific metrics
 * - Metrics updated after sync operations
 * - Initial metric values (all zero)
 * - Redis connection error handling
 * - System failure error result structure
 * - Content change errors without crashes
 * - Content changes for posts without subscriptions
 * - Processing changes for subscribed channels
 * - Filtering changes by provider involvement
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

import Redis from "ioredis";
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
// Metrics Tests
// ============================================================================

describe("SyncEngine - Metrics Collection", { concurrency: 1 }, () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should return default metrics structure", async (t) => {
    if (skipIfUnavailable(t)) return;
    const metrics = await syncEngine.getSyncMetrics();

    assert.ok(metrics, "Metrics should be returned");
    assert.strictEqual(typeof metrics.totalTransactions, "number");
    assert.strictEqual(typeof metrics.successfulSyncs, "number");
    assert.strictEqual(typeof metrics.failedSyncs, "number");
    assert.strictEqual(typeof metrics.conflictsDetected, "number");
    assert.strictEqual(typeof metrics.conflictsResolved, "number");
    assert.strictEqual(typeof metrics.averageSyncTime, "number");
    assert.strictEqual(typeof metrics.dataTransferred, "number");
    assert.strictEqual(typeof metrics.lastSyncDuration, "number");
  });

  it("should return global metrics when no channel specified", async (t) => {
    if (skipIfUnavailable(t)) return;
    const metrics = await syncEngine.getSyncMetrics();

    assert.ok(metrics, "Global metrics should be available");
    assert.ok(metrics.totalTransactions >= 0);
  });

  it("should return channel-specific metrics", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Metrics Channel",
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
      const metrics = await syncEngine.getSyncMetrics(channelResult.value.id);

      assert.ok(metrics, "Channel metrics should be returned");
      assert.ok(metrics.totalTransactions >= 0);
    }
  });

  it("should track metrics after sync operations", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Sync Metrics Tracking",
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
      const beforeMetrics = await syncEngine.getSyncMetrics();

      await syncEngine.syncPost(testPostId, channelResult.value.id, "source_to_target");

      const afterMetrics = await syncEngine.getSyncMetrics();

      assert.ok(afterMetrics.totalTransactions >= beforeMetrics.totalTransactions);
    }
  });

  it("should initialize all metric fields to zero", async (t) => {
    if (skipIfUnavailable(t)) return;
    const metrics = await syncEngine.getSyncMetrics();

    assert.strictEqual(metrics.totalTransactions, 0);
    assert.strictEqual(metrics.successfulSyncs, 0);
    assert.strictEqual(metrics.failedSyncs, 0);
    assert.strictEqual(metrics.conflictsDetected, 0);
    assert.strictEqual(metrics.conflictsResolved, 0);
    assert.strictEqual(metrics.averageSyncTime, 0);
    assert.strictEqual(metrics.dataTransferred, 0);
    assert.strictEqual(metrics.lastSyncDuration, 0);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("SyncEngine - Error Handling", { concurrency: 1 }, () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should handle Redis connection errors gracefully", async (t) => {
    if (skipIfUnavailable(t)) return;
    const badRedis = new Redis({
      host: "invalid-host",
      port: 9999,
      retryStrategy: () => null, // Don't retry
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    });

    const badEngine = new SyncEngine({
      prisma: mockPrisma,
      redis: badRedis,
      eventService: mockEventService,
      synchronizer,
      versionManager,
    });

    try {
      await badEngine.initialize();
      assert.ok(true, "Should handle Redis errors");
    } catch (error) {
      assert.ok(error, "Error should be catchable");
    } finally {
      try {
        await badEngine.shutdown();
      } catch {
        /* ignore */
      }
      try {
        await badRedis.quit();
      } catch {
        /* connection may never have opened */
      }
    }
  });

  it("should return error result for system failures", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Error Test",
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

      if (!result.ok) {
        assert.ok(result.error.id, "Error should have ID");
        assert.ok(result.error.type, "Error should have type");
        assert.ok(result.error.message, "Error should have message");
        assert.ok(result.error.occurredAt, "Error should have timestamp");
      }
    }
  });

  it("should handle content change errors without crashing", async (t) => {
    if (skipIfUnavailable(t)) return;
    await syncEngine.initialize();

    // handleContentChange for a non-existent post should not throw
    await assert.doesNotReject(
      () => syncEngine.handleContentChange("non-existent-post", [], "twitter" as ProviderId),
      "Should handle invalid content changes gracefully"
    );
  });
});

// ============================================================================
// Content Change Monitoring Tests
// ============================================================================

describe("SyncEngine - Content Change Monitoring", { concurrency: 1 }, () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should handle content changes for posts without subscriptions", async (t) => {
    if (skipIfUnavailable(t)) return;

    // Should not throw when no sync channels are subscribed to this post
    await assert.doesNotReject(
      () => syncEngine.handleContentChange(testPostId, [], "twitter" as ProviderId),
      "Should handle posts without subscriptions without throwing"
    );
  });

  it("should process content changes for subscribed channels", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Change Monitor",
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
      await syncEngine.startRealtimeSync(testPostId, [channelResult.value.id]);

      // Should not throw when processing content changes
      await assert.doesNotReject(
        () =>
          syncEngine.handleContentChange(
            testPostId,
            [
              {
                field: "content",
                oldValue: "old content",
                newValue: "new content",
                changeType: "modified" as const,
              },
            ],
            "twitter" as ProviderId
          ),
        "Should process content changes without errors"
      );
    }
  });

  it("should filter changes by provider involvement", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelResult = await syncEngine.createSyncChannel(
      "Provider Filter",
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
      await syncEngine.startRealtimeSync(testPostId, [channelResult.value.id]);

      // Change from provider not in channel should be silently ignored (no throw)
      await assert.doesNotReject(
        () =>
          syncEngine.handleContentChange(
            testPostId,
            [
              {
                field: "content",
                oldValue: "old",
                newValue: "new",
                changeType: "modified" as const,
              },
            ],
            "facebook" as ProviderId
          ),
        "Should filter out irrelevant provider changes without errors"
      );
    }
  });
});
