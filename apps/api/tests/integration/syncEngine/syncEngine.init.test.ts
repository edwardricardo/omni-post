/**
 * @file syncEngine.init.test.ts
 * @description SyncEngine - Initialization & Sync Channel Management Tests
 *
 * Covers:
 * - Engine initialization, Redis stream setup, idempotent re-init
 * - Channel creation from Redis on startup
 * - Unidirectional / bidirectional channel creation
 * - Duplicate channel rejection, same-source/target validation
 * - Redis storage of channel config, initial health status
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

import { SyncEngine } from "../../../src/content/SyncEngine.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type { SyncConfiguration } from "@shared/types/orchestration.js";
import type { ProviderId } from "../../../src/providers/providerAdapter.interface.js";
import {
  mockPrisma,
  mockRedis,
  mockEventService,
  synchronizer,
  versionManager,
  servicesAvailable,
  setupSyncEngineInfra,
  teardownSyncEngineInfra,
  resetSyncEngineState,
  skipIfUnavailable,
} from "./syncEngine.helpers.js";

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
    scheduler: new NoopBackgroundTaskScheduler(),
  });
});

// ============================================================================
// Initialization Tests
// ============================================================================

describe("SyncEngine - Initialization", () => {
  it("should initialize with empty channel map", async (t) => {
    if (skipIfUnavailable(t)) return;
    const engine = new SyncEngine({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
      synchronizer,
      versionManager,
      scheduler: new NoopBackgroundTaskScheduler(),
    });

    await engine.initialize();

    const metrics = await engine.getSyncMetrics();
    assert.strictEqual(metrics.totalTransactions, 0);
    await engine.shutdown();
  });

  it("should setup Redis streams on initialization", async (t) => {
    if (skipIfUnavailable(t)) return;
    await syncEngine.initialize();

    const streams = ["sync:content:changes", "sync:transactions", "sync:conflicts", "sync:metrics"];

    for (const stream of streams) {
      const info = await mockRedis.xinfo("STREAM", stream).catch(() => null);
      assert.ok(info, `Stream ${stream} should exist`);
    }
  });

  it("should not re-initialize when called multiple times", async (t) => {
    if (skipIfUnavailable(t)) return;
    await syncEngine.initialize();
    await syncEngine.initialize();
    await syncEngine.initialize();

    const metrics = await syncEngine.getSyncMetrics();
    assert.ok(metrics);
  });

  it("should load existing sync channels from Redis", async (t) => {
    if (skipIfUnavailable(t)) return;
    const channelData = {
      id: "test-channel-1",
      name: "Test Channel",
      sourceProvider: "twitter" as ProviderId,
      targetProvider: "instagram" as ProviderId,
      bidirectional: false,
      enabled: true,
      configuration: {
        mode: "ON_DEMAND",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "source_wins",
        },
      },
      healthStatus: "healthy" as const,
      errorCount: 0,
      successRate: 1.0,
    };

    await mockRedis.setex("sync:channel:test-channel-1", 86400, JSON.stringify(channelData));

    await syncEngine.initialize();

    const result = await syncEngine.createSyncChannel(
      "Test Channel",
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

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.match(result.error.message, /already exists/i);
    }
  });
});

// ============================================================================
// Sync Channel Management Tests
// ============================================================================

describe("SyncEngine - Sync Channel Management", () => {
  beforeEach(async () => {
    if (!servicesAvailable) return;
    await syncEngine.initialize();
  });

  it("should create unidirectional sync channel", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.createSyncChannel(
      "Twitter to Instagram",
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
      },
      false
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.sourceProvider, "twitter");
      assert.strictEqual(result.value.targetProvider, "instagram");
      assert.strictEqual(result.value.bidirectional, false);
      assert.strictEqual(result.value.enabled, true);
      assert.strictEqual(result.value.healthStatus, "healthy");
      assert.ok(result.value.id);
    }
  });

  it("should create bidirectional sync channel", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.createSyncChannel(
      "Twitter - Instagram",
      "twitter" as ProviderId,
      "instagram" as ProviderId,
      {
        mode: "REAL_TIME",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "timestamp_wins",
        },
      },
      true
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.bidirectional, true);
    }
  });

  it("should reject channel with same source and target", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.createSyncChannel(
      "Invalid Channel",
      "twitter" as ProviderId,
      "twitter" as ProviderId,
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

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.type, "validation");
      assert.match(result.error.message, /cannot be the same/i);
    }
  });

  it("should reject duplicate channel creation", async (t) => {
    if (skipIfUnavailable(t)) return;
    const config: SyncConfiguration = {
      mode: "ON_DEMAND",
      sources: [],
      targets: [],
      syncRules: [],
      conflictResolution: {
        strategy: "source_wins",
      },
    };

    const result1 = await syncEngine.createSyncChannel(
      "Twitter to Facebook",
      "twitter" as ProviderId,
      "facebook" as ProviderId,
      config
    );
    assert.strictEqual(result1.ok, true);

    const result2 = await syncEngine.createSyncChannel(
      "Twitter to Facebook Duplicate",
      "twitter" as ProviderId,
      "facebook" as ProviderId,
      config
    );

    assert.strictEqual(result2.ok, false);
    if (!result2.ok) {
      assert.match(result2.error.message, /already exists/i);
    }
  });

  it("should store channel configuration in Redis", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.createSyncChannel(
      "Test Redis Storage",
      "twitter" as ProviderId,
      "youtube" as ProviderId,
      {
        mode: "SCHEDULED",
        sources: [],
        targets: [],
        syncRules: [],
        conflictResolution: {
          strategy: "manual",
        },
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      const channelId = result.value.id;
      const stored = await mockRedis.get(`sync:channel:${channelId}`);
      assert.ok(stored);

      const parsed = JSON.parse(stored!);
      assert.strictEqual(parsed.id, channelId);
      assert.strictEqual(parsed.name, "Test Redis Storage");
    }
  });

  it("should initialize channel with healthy status", async (t) => {
    if (skipIfUnavailable(t)) return;
    const result = await syncEngine.createSyncChannel(
      "Health Check Channel",
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

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value.healthStatus, "healthy");
      assert.strictEqual(result.value.errorCount, 0);
      assert.strictEqual(result.value.successRate, 1.0);
    }
  });
});
