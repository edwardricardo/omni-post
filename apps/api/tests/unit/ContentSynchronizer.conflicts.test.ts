import "./ContentSynchronizer.test-helpers.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockPost,
} from "./ContentSynchronizer.test-helpers.js";

describe("ContentSynchronizer - Conflict Detection", { concurrency: 1 }, () => {
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

    assert.ok(result.conflicts.length > 0, "Should detect conflicts");
    const titleConflict = result.conflicts.find((c: any) => c.field === "title");
    assert.ok(titleConflict, "Should detect title conflict");
    assert.strictEqual(
      titleConflict?.conflictType,
      "modification",
      "Should be modification conflict"
    );
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
    assert.ok(tagsConflict, "Should detect tags conflict");
    assert.strictEqual(tagsConflict?.conflictType, "deletion", "Should be deletion conflict");
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
    assert.ok(tagsConflict, "Should detect tags conflict");
    assert.strictEqual(tagsConflict?.conflictType, "creation", "Should be creation conflict");
  });
});

describe("ContentSynchronizer - Conflict Resolution Strategies", { concurrency: 1 }, () => {
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

    assert.strictEqual(result.resolvedContent.title, "Source Title", "Should use source value");
    const titleConflict = result.conflicts.find((c: any) => c.field === "title");
    assert.strictEqual(
      titleConflict?.resolution?.strategy,
      "source_wins",
      "Should apply source_wins strategy"
    );
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

    assert.strictEqual(result.resolvedContent.body, "Target body", "Should use target value");
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

    assert.strictEqual(result.resolvedContent.title, "Newer content", "Should use newer value");
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

    assert.ok(Array.isArray(result.resolvedContent.tags), "Should merge arrays");
    assert.ok(result.resolvedContent.tags?.includes("source"), "Should include source tags");
    assert.ok(result.resolvedContent.tags?.includes("target"), "Should include target tags");
    assert.ok(result.resolvedContent.tags?.includes("tag"), "Should deduplicate");
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

    assert.strictEqual(
      result.resolvedContent.body,
      "Much longer content",
      "Should use longer string"
    );
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
    assert.strictEqual(
      conflict?.resolution?.strategy,
      "manual",
      "Should mark for manual resolution"
    );
    assert.ok(
      conflict?.resolution?.rationale?.toLowerCase().includes("manual"),
      "Should indicate manual resolution needed"
    );
  });
});
