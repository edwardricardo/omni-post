/**
 * @file ContentSynchronizer.streaming.test.ts
 * @description Tests for ContentSynchronizer - Content Transformations
 * @layer infrastructure
 */
import "./ContentSynchronizer.test-helpers.js";
import { describe, it, expect } from "vitest";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type {
  SyncContentRequest,
  SyncTransformation,
  VersionDiff,
} from "@shared/types/orchestration.js";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockPost,
  stubSyncCoordinatorSuccess,
  stubSyncCoordinatorSystemError,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Content Transformations", () => {
  it("should apply truncate transformation", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const content = createMockPost({ body: "A".repeat(300) });

    const transformations: SyncTransformation[] = [
      {
        field: "body",
        transformer: "truncate",
        parameters: { maxLength: 280 },
      },
    ];

    const result = await synchronizer.applyTransformations(content, transformations);

    expect(result.body.length).toBe(280);
  });

  it("should apply hashtag_limit transformation", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const content = createMockPost({
      tags: ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"],
    });

    const transformations: SyncTransformation[] = [
      {
        field: "tags",
        transformer: "hashtag_limit",
        parameters: { maxTags: 3 },
      },
    ];

    const result = await synchronizer.applyTransformations(content, transformations);

    expect(result.tags?.length).toBe(3);
  });

  it("should apply multiple transformations in sequence", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const content = createMockPost({
      body: "A".repeat(300),
      tags: ["tag1", "tag2", "tag3", "tag4", "tag5"],
    });

    const transformations: SyncTransformation[] = [
      {
        field: "body",
        transformer: "truncate",
        parameters: { maxLength: 280 },
      },
      {
        field: "tags",
        transformer: "hashtag_limit",
        parameters: { maxTags: 3 },
      },
    ];

    const result = await synchronizer.applyTransformations(content, transformations);

    expect(result.body.length).toBe(280);
    expect(result.tags?.length).toBe(3);
  });
});

describe("ContentSynchronizer - Real-Time Sync", () => {
  it("should complete real-time sync without throwing errors", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();

    const changes: VersionDiff[] = [
      {
        field: "title",
        oldValue: "Old Title",
        newValue: "New Title",
        changeType: "modified",
      },
    ];

    // realTimeSync should not throw even when no sync configurations exist
    await expect(synchronizer.realTimeSync("post-123", changes)).resolves.not.toThrow();
  });
});

describe("ContentSynchronizer - Sync Rule Execution", () => {
  it("should execute content sync rule", async () => {
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
        mode: "ON_DEMAND",
        sources: ["x"],
        targets: ["instagram"],
        syncRules: [
          {
            id: "content-rule-1",
            type: "content",
            direction: "source_to_target",
          },
        ],
        conflictResolution: { strategy: "source_wins" },
      },
    };

    const result = await synchronizer.syncContent(request);

    expect(result.ok).toBe(true);
  });

  it("should execute media sync rule", async () => {
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
        mode: "ON_DEMAND",
        sources: ["instagram"],
        targets: ["facebook"],
        syncRules: [
          {
            id: "media-rule-1",
            type: "media",
            direction: "bidirectional",
          },
        ],
        conflictResolution: { strategy: "merge" },
      },
    };

    const result = await synchronizer.syncContent(request);

    expect(result.ok).toBe(true);
  });

  it("should execute analytics sync rule", async () => {
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
        mode: "BATCH",
        sources: ["x", "instagram"],
        targets: [],
        syncRules: [
          {
            id: "analytics-rule-1",
            type: "analytics",
            direction: "source_to_target",
          },
        ],
        conflictResolution: { strategy: "timestamp_wins" },
      },
    };

    const result = await synchronizer.syncContent(request);

    expect(result.ok).toBe(true);
  });
});

describe("ContentSynchronizer - Redis Stream Processing", () => {
  it("should add content changes to Redis stream", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();

    const handlerCall = mockEventService.registerHandler.mock.calls.find(
      (call: any) => call[0] === "POST_UPDATED"
    );

    expect(handlerCall).toBeTruthy();

    const handler = handlerCall[1];

    await handler.handle({
      id: "event-1",
      type: "POST_UPDATED",
      aggregateId: "post-123",
      aggregateType: "Post",
      version: 1,
      data: {
        postId: "post-123",
        changes: [{ field: "title", newValue: "New Title" }],
      },
      metadata: { userId: "user-1" },
      timestamp: new Date(),
    });

    expect(mockRedis.xadd.mock.calls.length > 0).toBeTruthy();
    const xaddCall = mockRedis.xadd.mock.calls[0];
    expect(xaddCall[0]).toBe("sync:content:changes");
  });
});

describe("ContentSynchronizer - Error Handling", () => {
  it("should handle Redis errors gracefully", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    mockRedis.lrange.mockImplementationOnce(async () => {
      throw new Error("Redis connection error");
    });
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const versions = await synchronizer.getVersionHistory("post-123");

    expect(versions.length).toBe(0);
  });

  it("should handle sync execution errors", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    await synchronizer.initialize();

    stubSyncCoordinatorSystemError(synchronizer);

    const request: any = {
      postId: "post-123",
      configuration: null,
    };

    const result = await synchronizer.syncContent(request);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error?.type).toBe("system");
  });
});
