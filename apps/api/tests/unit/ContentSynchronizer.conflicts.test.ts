import "./ContentSynchronizer.test-helpers.js";
import { describe, it, expect } from "vitest";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockPost,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Conflict Detection", () => {
  it("should detect modification conflicts", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ title: "Source Title" });
    const targetContent = createMockPost({ title: "Target Title" });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "source_wins" }
    );

    expect(result.conflicts.length > 0).toBeTruthy();
    const titleConflict = result.conflicts.find((c: any) => c.field === "title");
    expect(titleConflict).toBeTruthy();
    expect(titleConflict?.conflictType).toBe("modification");
  });

  it("should detect deletion conflicts", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ tags: ["existing", "tags"] });
    const targetContent = createMockPost({ tags: undefined });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "target_wins" }
    );

    const tagsConflict = result.conflicts.find((c: any) => c.field === "tags");
    expect(tagsConflict).toBeTruthy();
    expect(tagsConflict?.conflictType).toBe("deletion");
  });

  it("should detect creation conflicts", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ tags: undefined });
    const targetContent = createMockPost({ tags: ["new", "tags"] });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "merge" }
    );

    const tagsConflict = result.conflicts.find((c: any) => c.field === "tags");
    expect(tagsConflict).toBeTruthy();
    expect(tagsConflict?.conflictType).toBe("creation");
  });
});

describe("ContentSynchronizer - Conflict Resolution Strategies", () => {
  it("should resolve conflicts using source_wins strategy", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ title: "Source Title" });
    const targetContent = createMockPost({ title: "Target Title" });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "source_wins" }
    );

    expect(result.resolvedContent.title).toBe("Source Title");
    const titleConflict = result.conflicts.find((c: any) => c.field === "title");
    expect(titleConflict?.resolution?.strategy).toBe("source_wins");
  });

  it("should resolve conflicts using target_wins strategy", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ body: "Source body" });
    const targetContent = createMockPost({ body: "Target body" });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "target_wins" }
    );

    expect(result.resolvedContent.body).toBe("Target body");
  });

  it("should resolve conflicts using timestamp_wins strategy", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ title: "Newer content" });
    const targetContent = createMockPost({ title: "Older content" });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "timestamp_wins" }
    );

    expect(result.resolvedContent.title).toBe("Newer content");
  });

  it("should resolve conflicts using merge strategy for arrays", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ tags: ["source", "tag"] });
    const targetContent = createMockPost({ tags: ["target", "tag"] });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "merge" }
    );

    expect(Array.isArray(result.resolvedContent.tags)).toBeTruthy();
    expect(result.resolvedContent.tags?.includes("source")).toBeTruthy();
    expect(result.resolvedContent.tags?.includes("target")).toBeTruthy();
    expect(result.resolvedContent.tags?.includes("tag")).toBeTruthy();
  });

  it("should resolve conflicts using merge strategy for strings", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ body: "Short" });
    const targetContent = createMockPost({ body: "Much longer content" });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "merge" }
    );

    expect(result.resolvedContent.body).toBe("Much longer content");
  });

  it("should require manual resolution for manual strategy", async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    const synchronizer = new ContentSynchronizer({
      prisma: mockPrisma,
      redis: mockRedis,
      eventService: mockEventService,
    });

    const sourceContent = createMockPost({ title: "Source" });
    const targetContent = createMockPost({ title: "Target" });

    const result = await synchronizer.detectAndResolveConflicts(
      "post-123",
      sourceContent,
      targetContent,
      { strategy: "manual" }
    );

    const conflict = result.conflicts.find((c: any) => c.field === "title");
    expect(conflict?.resolution?.strategy).toBe("manual");
    expect(conflict?.resolution?.rationale?.toLowerCase().includes("manual")).toBeTruthy();
  });
});
