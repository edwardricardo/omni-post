import "./ContentSynchronizer.test-helpers.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type { SyncContentRequest, SyncConfiguration } from "@shared/orchestration";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  stubSyncCoordinatorSuccess,
  stubSyncCoordinatorValidationFailure,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Initialization", { concurrency: 1 }, () => {
  it("should initialize with Redis streams", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();

    assert.ok(mockRedis.xgroup.mock.calls.length > 0, "Should create Redis stream group");
    assert.ok(
      mockEventService.publishEvent.mock.calls.length > 0,
      "Should publish initialization event"
    );
  });

  it("should register event handlers for POST_UPDATED", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();

    assert.ok(
      mockEventService.registerHandler.mock.calls.length > 0,
      "Should register event handlers"
    );
    const registerCall = mockEventService.registerHandler.mock.calls[0];
    assert.strictEqual(
      registerCall.arguments[0],
      "POST_UPDATED",
      "Should register POST_UPDATED handler"
    );
  });

  it("should not reinitialize if already initialized", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();
    const firstCallCount = mockRedis.xgroup.mock.calls.length;

    await synchronizer.initialize();
    const secondCallCount = mockRedis.xgroup.mock.calls.length;

    assert.strictEqual(firstCallCount, secondCallCount, "Should not reinitialize");
  });
});

describe("ContentSynchronizer - syncContent()", { concurrency: 1 }, () => {
  it("should validate sync request and reject invalid post", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();

    stubSyncCoordinatorValidationFailure(synchronizer);

    const request: SyncContentRequest = {
      postId: "invalid-post-id",
      configuration: {
        mode: "REAL_TIME",
        sources: ["x"],
        targets: ["instagram"],
        syncRules: [],
        conflictResolution: { strategy: "source_wins" },
      },
    };

    const result = await synchronizer.syncContent(request);

    assert.strictEqual(result.ok, false, "Should fail validation");
    assert.ok(result.error, "Should have error");
    assert.strictEqual(result.error?.type, "validation", "Should be validation error");
  });

  it("should execute sync with REAL_TIME mode", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();
    stubSyncCoordinatorSuccess(synchronizer);

    const request: SyncContentRequest = {
      postId: "post-123",
      configuration: {
        mode: "REAL_TIME",
        sources: ["x"],
        targets: ["instagram"],
        syncRules: [
          {
            id: "rule-1",
            type: "content",
            direction: "source_to_target",
          },
        ],
        conflictResolution: { strategy: "source_wins" },
      },
    };

    const result = await synchronizer.syncContent(request);

    assert.strictEqual(result.ok, true, "Should succeed");
    assert.ok(result.value, "Should have value");
    assert.strictEqual(result.value.success, true, "Should be successful");
  });

  it("should handle dry run simulation", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();
    stubSyncCoordinatorSuccess(synchronizer);

    const request: SyncContentRequest = {
      postId: "post-123",
      configuration: {
        mode: "SCHEDULED",
        sources: ["x"],
        targets: ["instagram", "facebook"],
        syncRules: [],
        conflictResolution: { strategy: "merge" },
      },
      dryRun: true,
    };

    const result = await synchronizer.syncContent(request);

    assert.strictEqual(result.ok, true, "Should succeed");
    assert.ok(result.value?.data, "Should have simulation data");
    assert.ok(Array.isArray(result.value.data.syncedProviders), "Should have synced providers");
  });
});

describe("ContentSynchronizer - Sync Modes", { concurrency: 1 }, () => {
  it("should handle REAL_TIME sync mode", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();
    stubSyncCoordinatorSuccess(synchronizer);

    const config: SyncConfiguration = {
      mode: "REAL_TIME",
      sources: ["x"],
      targets: ["instagram"],
      syncRules: [],
      conflictResolution: { strategy: "source_wins" },
    };

    const result = await synchronizer.syncContent({
      postId: "post-123",
      configuration: config,
    });

    assert.strictEqual(result.ok, true, "Should handle REAL_TIME mode");
  });

  it("should handle SCHEDULED sync mode", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();
    stubSyncCoordinatorSuccess(synchronizer);

    const config: SyncConfiguration = {
      mode: "SCHEDULED",
      sources: ["x"],
      targets: ["facebook"],
      syncRules: [],
      conflictResolution: { strategy: "timestamp_wins" },
      interval: 3600000,
    };

    const result = await synchronizer.syncContent({
      postId: "post-123",
      configuration: config,
    });

    assert.strictEqual(result.ok, true, "Should handle SCHEDULED mode");
  });

  it("should handle ON_DEMAND sync mode", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();
    stubSyncCoordinatorSuccess(synchronizer);

    const config: SyncConfiguration = {
      mode: "ON_DEMAND",
      sources: ["instagram"],
      targets: ["x"],
      syncRules: [],
      conflictResolution: { strategy: "manual" },
    };

    const result = await synchronizer.syncContent({
      postId: "post-456",
      configuration: config,
    });

    assert.strictEqual(result.ok, true, "Should handle ON_DEMAND mode");
  });
});
