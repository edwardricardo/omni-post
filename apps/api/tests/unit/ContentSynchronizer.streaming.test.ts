import "./ContentSynchronizer.test-helpers.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type { SyncContentRequest, SyncTransformation, VersionDiff } from "@shared/orchestration";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockPost,
  stubSyncCoordinatorSuccess,
  stubSyncCoordinatorSystemError,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Content Transformations", { concurrency: 1 }, () => {
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

    assert.strictEqual(result.body.length, 280, "Should truncate to max length");
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

    assert.strictEqual(result.tags?.length, 3, "Should limit tags to max count");
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

    assert.strictEqual(result.body.length, 280, "Should truncate body");
    assert.strictEqual(result.tags?.length, 3, "Should limit tags");
  });
});

describe("ContentSynchronizer - Real-Time Sync", { concurrency: 1 }, () => {
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
    await assert.doesNotReject(
      () => synchronizer.realTimeSync("post-123", changes),
      "Real-time sync should complete without errors"
    );
  });
});

describe("ContentSynchronizer - Sync Rule Execution", { concurrency: 1 }, () => {
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

    assert.strictEqual(result.ok, true, "Should execute content rule");
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

    assert.strictEqual(result.ok, true, "Should execute media rule");
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

    assert.strictEqual(result.ok, true, "Should execute analytics rule");
  });
});

describe("ContentSynchronizer - Redis Stream Processing", { concurrency: 1 }, () => {
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
      (call: any) => call.arguments[0] === "POST_UPDATED"
    );

    assert.ok(handlerCall, "Should register POST_UPDATED handler");

    const handler = handlerCall.arguments[1];

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

    assert.ok(mockRedis.xadd.mock.calls.length > 0, "Should add to Redis stream");
    const xaddCall = mockRedis.xadd.mock.calls[0];
    assert.strictEqual(xaddCall.arguments[0], "sync:content:changes", "Should use correct stream");
  });
});

describe("ContentSynchronizer - Error Handling", { concurrency: 1 }, () => {
  it("should handle Redis errors gracefully", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    mockRedis.lrange.mock.mockImplementationOnce(async () => {
      throw new Error("Redis connection error");
    });
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const versions = await synchronizer.getVersionHistory("post-123");

    assert.strictEqual(versions.length, 0, "Should return empty array on error");
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

    assert.strictEqual(result.ok, false, "Should handle errors");
    assert.ok(result.error, "Should return error");
    assert.strictEqual(result.error?.type, "system", "Should be system error");
  });
});
