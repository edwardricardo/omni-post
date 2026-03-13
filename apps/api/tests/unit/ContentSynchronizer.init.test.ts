import "./ContentSynchronizer.test-helpers.js";
import { describe, it, expect } from "vitest";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type { SyncContentRequest, SyncConfiguration } from "@shared/orchestration";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  stubSyncCoordinatorSuccess,
  stubSyncCoordinatorValidationFailure,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Initialization", () => {
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

    expect(mockRedis.xgroup.mock.calls.length > 0).toBeTruthy();
    expect(mockEventService.publishEvent.mock.calls.length > 0).toBeTruthy();
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

    expect(mockEventService.registerHandler.mock.calls.length > 0).toBeTruthy();
    const registerCall = mockEventService.registerHandler.mock.calls[0];
    expect(registerCall[0]).toBe("POST_UPDATED");
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

    expect(firstCallCount).toBe(secondCallCount);
  });
});

describe("ContentSynchronizer - syncContent()", () => {
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

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error?.type).toBe("validation");
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

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.success).toBe(true);
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

    expect(result.ok).toBe(true);
    expect(result.value?.data).toBeTruthy();
    expect(Array.isArray(result.value.data.syncedProviders)).toBeTruthy();
  });
});

describe("ContentSynchronizer - Sync Modes", () => {
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

    expect(result.ok).toBe(true);
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

    expect(result.ok).toBe(true);
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

    expect(result.ok).toBe(true);
  });
});
