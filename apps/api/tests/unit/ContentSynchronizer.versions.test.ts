import "./ContentSynchronizer.test-helpers.js";
import { describe, it, expect } from "vitest";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type { ContentVersion } from "@shared/orchestration";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockPost,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Version History", () => {
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

    mockRedis.lrange.mockImplementationOnce(async () => [
      JSON.stringify(version2),
      JSON.stringify(version1),
    ]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const versions = await synchronizer.getVersionHistory("post-123");

    expect(versions.length).toBe(2);
    expect(versions[0].version).toBe(2);
    expect(versions[0].isActive).toBe(true);
  });

  it("should return empty array if no versions exist", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    mockRedis.lrange.mockImplementationOnce(async () => []);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const versions = await synchronizer.getVersionHistory("post-999");

    expect(versions.length).toBe(0);
  });
});

describe("ContentSynchronizer - Version Creation", () => {
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

    mockRedis.lrange.mockImplementationOnce(async () => [JSON.stringify(existingVersion)]);

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

    expect(version.version).toBe(2);
    expect(version.createdBy).toBe("user-2");
    expect(version.changelog).toBe("Updated title");
    expect(version.isActive).toBe(true);
  });

  it("should cache current version in Redis", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    mockRedis.lrange.mockImplementationOnce(async () => []);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const content = createMockPost();
    await synchronizer.createVersion("post-123", content, { instagram: content }, "user-1");

    expect(mockRedis.setex.mock.calls.length > 0).toBeTruthy();
    const setexCall = mockRedis.setex.mock.calls[0];
    expect(String(setexCall[0]).includes("current_version")).toBeTruthy();
  });
});

describe("ContentSynchronizer - Version Comparison", () => {
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

    mockRedis.lrange.mockImplementationOnce(async () => [
      JSON.stringify(version2),
      JSON.stringify(version1),
    ]);

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const diffs = await synchronizer.compareVersions("post-123", 1, 2);

    expect(diffs.length > 0).toBeTruthy();
    const titleDiff = diffs.find((d) => d.field === "title");
    expect(titleDiff).toBeTruthy();
    expect(titleDiff?.oldValue).toBe("Original Title");
    expect(titleDiff?.newValue).toBe("Updated Title");
    expect(titleDiff?.changeType).toBe("modified");
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

    mockRedis.lrange.mockImplementationOnce(async () => [
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
    expect(tagsDiff).toBeTruthy();
    expect(tagsDiff?.changeType).toBe("added");
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

    mockRedis.lrange.mockImplementationOnce(async () => [
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
    expect(tagsDiff).toBeTruthy();
    expect(tagsDiff?.changeType).toBe("removed");
  });
});
