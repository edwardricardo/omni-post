import "./ContentSynchronizer.test-helpers.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type { ContentVersion } from "@shared/orchestration";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockPost,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Version History", { concurrency: 1 }, () => {
  it("should retrieve version history from Redis", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const version1: ContentVersion = {
      id: "v1",
      postId: "post-123",
      version: 1,
      content: createMockPost({ title: "Version 1" }),
      adaptations: {},
      createdAt: new Date("2024-01-01T10:00:00Z"),
      createdBy: "user-1",
      isActive: false,
    };

    const version2: ContentVersion = {
      id: "v2",
      postId: "post-123",
      version: 2,
      content: createMockPost({ title: "Version 2" }),
      adaptations: {},
      createdAt: new Date("2024-01-02T10:00:00Z"),
      createdBy: "user-1",
      isActive: true,
    };

    mockRedis.lrange.mock.mockImplementationOnce(async () => [
      JSON.stringify(version2),
      JSON.stringify(version1),
    ]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const versions = await synchronizer.getVersionHistory("post-123");

    assert.strictEqual(versions.length, 2, "Should return 2 versions");
    assert.strictEqual(versions[0].version, 2, "Should have correct version number");
    assert.strictEqual(versions[0].isActive, true, "Latest version should be active");
  });

  it("should return empty array if no versions exist", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    mockRedis.lrange.mock.mockImplementationOnce(async () => []);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const versions = await synchronizer.getVersionHistory("post-999");

    assert.strictEqual(versions.length, 0, "Should return empty array");
  });
});

describe("ContentSynchronizer - Version Creation", { concurrency: 1 }, () => {
  it("should create new version with incremented version number", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const existingVersion: ContentVersion = {
      id: "v1",
      postId: "post-123",
      version: 1,
      content: createMockPost(),
      adaptations: {},
      createdAt: new Date("2024-01-01T10:00:00Z"),
      createdBy: "user-1",
      isActive: true,
    };

    mockRedis.lrange.mock.mockImplementationOnce(async () => [JSON.stringify(existingVersion)]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const newContent = createMockPost({ title: "Updated Content" });
    const version = await synchronizer.createVersion(
      "post-123",
      newContent,
      { x: newContent },
      "user-2",
      "Updated title"
    );

    assert.strictEqual(version.version, 2, "Should increment version number");
    assert.strictEqual(version.createdBy, "user-2", "Should set correct creator");
    assert.strictEqual(version.changelog, "Updated title", "Should include changelog");
    assert.strictEqual(version.isActive, true, "New version should be active");
  });

  it("should cache current version in Redis", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    mockRedis.lrange.mock.mockImplementationOnce(async () => []);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const content = createMockPost();
    await synchronizer.createVersion("post-123", content, { instagram: content }, "user-1");

    assert.ok(mockRedis.setex.mock.calls.length > 0, "Should cache version");
    const setexCall = mockRedis.setex.mock.calls[0];
    assert.ok(
      String(setexCall.arguments[0]).includes("current_version"),
      "Should cache current version"
    );
  });
});

describe("ContentSynchronizer - Version Comparison", { concurrency: 1 }, () => {
  it("should generate diff for modified fields", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const version1: ContentVersion = {
      id: "v1",
      postId: "post-123",
      version: 1,
      content: createMockPost({ title: "Original Title", body: "Original body" }),
      adaptations: {},
      createdAt: new Date("2024-01-01T10:00:00Z"),
      createdBy: "user-1",
      isActive: false,
    };

    const version2: ContentVersion = {
      id: "v2",
      postId: "post-123",
      version: 2,
      content: createMockPost({ title: "Updated Title", body: "Original body" }),
      adaptations: {},
      createdAt: new Date("2024-01-02T10:00:00Z"),
      createdBy: "user-1",
      isActive: true,
    };

    mockRedis.lrange.mock.mockImplementationOnce(async () => [
      JSON.stringify(version2),
      JSON.stringify(version1),
    ]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const diffs = await synchronizer.compareVersions("post-123", 1, 2);

    assert.ok(diffs.length > 0, "Should generate diffs");
    const titleDiff = diffs.find((d) => d.field === "title");
    assert.ok(titleDiff, "Should detect title change");
    assert.strictEqual(titleDiff?.oldValue, "Original Title", "Should have old value");
    assert.strictEqual(titleDiff?.newValue, "Updated Title", "Should have new value");
    assert.strictEqual(titleDiff?.changeType, "modified", "Should be modification");
  });

  it("should detect added fields", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const version1: ContentVersion = {
      id: "v1",
      postId: "post-123",
      version: 1,
      content: createMockPost({ tags: undefined }),
      adaptations: {},
      createdAt: new Date("2024-01-01T10:00:00Z"),
      createdBy: "user-1",
      isActive: false,
    };

    const version2: ContentVersion = {
      id: "v2",
      postId: "post-123",
      version: 2,
      content: createMockPost({ tags: ["new", "tags"] }),
      adaptations: {},
      createdAt: new Date("2024-01-02T10:00:00Z"),
      createdBy: "user-1",
      isActive: true,
    };

    mockRedis.lrange.mock.mockImplementationOnce(async () => [
      JSON.stringify(version2),
      JSON.stringify(version1),
    ]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const diffs = await synchronizer.compareVersions("post-123", 1, 2);

    const tagsDiff = diffs.find((d) => d.field === "tags");
    assert.ok(tagsDiff, "Should detect tags addition");
    assert.strictEqual(tagsDiff?.changeType, "added", "Should be addition");
  });

  it("should detect removed fields", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const version1: ContentVersion = {
      id: "v1",
      postId: "post-123",
      version: 1,
      content: createMockPost({ tags: ["old", "tags"] }),
      adaptations: {},
      createdAt: new Date("2024-01-01T10:00:00Z"),
      createdBy: "user-1",
      isActive: false,
    };

    const version2: ContentVersion = {
      id: "v2",
      postId: "post-123",
      version: 2,
      content: createMockPost({ tags: undefined }),
      adaptations: {},
      createdAt: new Date("2024-01-02T10:00:00Z"),
      createdBy: "user-1",
      isActive: true,
    };

    mockRedis.lrange.mock.mockImplementationOnce(async () => [
      JSON.stringify(version2),
      JSON.stringify(version1),
    ]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const diffs = await synchronizer.compareVersions("post-123", 1, 2);

    const tagsDiff = diffs.find((d) => d.field === "tags");
    assert.ok(tagsDiff, "Should detect tags removal");
    assert.strictEqual(tagsDiff?.changeType, "removed", "Should be removal");
  });
});
