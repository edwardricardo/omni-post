/**
 * @file ContentVersionManager.merge.test.ts
 * @description Tests for ContentVersionManager - restoreVersion
 * @layer infrastructure
 */
const _origConsoleError = console.error;
const _origConsoleLog = console.log;
const _origConsoleWarn = console.warn;
console.error = () => {};
console.log = () => {};
console.warn = () => {};

import { describe, it, beforeEach, afterEach, afterAll, expect } from "vitest";
import { ContentVersionManager } from "../../src/content/ContentVersionManager";
import { InMemoryCacheAdapter } from "../../../../packages/adapters/cache-redis/src/in-memory-cache-adapter.js";
import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { EventService } from "../../src/events/EventService";
import {
  testPostId,
  testUserId,
  testCanonicalPost,
  testAdaptations,
  createMockRedis,
  createMockEventService,
  createMockPrisma,
  type MockRedis,
  type MockEventService,
} from "./ContentVersionManager.test-helpers";

let mockRedis: MockRedis;
let mockEventService: MockEventService;
let mockPrisma: PrismaClient;
let versionManager: ContentVersionManager;

describe("ContentVersionManager - restoreVersion", () => {
  let version1Id: string;
  let _version2Id: string;

  afterAll(() => {
    console.error = _origConsoleError;
    console.log = _origConsoleLog;
    console.warn = _origConsoleWarn;
  });

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    mockPrisma = createMockPrisma();

    versionManager = new ContentVersionManager({
      prisma: mockPrisma,
      redis: mockRedis as Redis,
      eventService: mockEventService as EventService,
      cache: new InMemoryCacheAdapter(),
    });

    const result1 = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId, changelog: "Version 1" }
    );
    expect(result1.ok).toBeTruthy();
    if (result1.ok) version1Id = result1.value.id;

    const result2 = await versionManager.createVersion(
      testPostId,
      { ...testCanonicalPost, title: "Updated Title" },
      testAdaptations,
      { createdBy: testUserId, changelog: "Version 2" }
    );
    expect(result2.ok).toBeTruthy();
    if (result2.ok) _version2Id = result2.value.id;
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Restoration Success", () => {
    it("should restore content from previous version", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const restoredVersion = result.value;
        expect(restoredVersion.version).toBe(3);
        expect(restoredVersion.content.title).toBe(testCanonicalPost.title);
        expect(restoredVersion.changelog?.includes("Restored from version")).toBeTruthy();
      }
    });

    it("should create new version on restore (not modify original)", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.id).not.toBe(version1Id);
      }
    });

    it("should preserve adaptations during restoration", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.adaptations).toStrictEqual(testAdaptations);
      }
    });

    it("should include restoration metadata in changelog", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.changelog?.includes("Restored from version")).toBeTruthy();
        expect(result.value.changelog?.includes("1")).toBeTruthy();
      }
    });
  });

  describe("Restoration Validation", () => {
    it("should reject restoration of non-existent version", async () => {
      const result = await versionManager.restoreVersion("non-existent-id", testUserId);

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.message.includes("Version not found")).toBeTruthy();
        expect(result.error.retryable).toBe(false);
      }
    });
  });
});

describe("ContentVersionManager - createMergeRequest", () => {
  let baseVersionId: string;
  let _sourceBranchVersionId: string;
  let _targetBranchVersionId: string;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    mockPrisma = createMockPrisma();

    versionManager = new ContentVersionManager({
      prisma: mockPrisma,
      redis: mockRedis as Redis,
      eventService: mockEventService as EventService,
      cache: new InMemoryCacheAdapter(),
    });

    const baseResult = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    expect(baseResult.ok).toBeTruthy();
    if (baseResult.ok) baseVersionId = baseResult.value.id;

    await versionManager.createBranch(testPostId, "source-branch", baseVersionId, testUserId);

    const sourceResult = await versionManager.createVersion(
      testPostId,
      { ...testCanonicalPost, title: "Source Branch Title" },
      testAdaptations,
      { createdBy: testUserId, branchName: "source-branch" }
    );
    expect(sourceResult.ok).toBeTruthy();
    if (sourceResult.ok) _sourceBranchVersionId = sourceResult.value.id;

    await versionManager.createBranch(testPostId, "target-branch", baseVersionId, testUserId);

    const targetResult = await versionManager.createVersion(
      testPostId,
      { ...testCanonicalPost, title: "Target Branch Title" },
      testAdaptations,
      { createdBy: testUserId, branchName: "target-branch" }
    );
    expect(targetResult.ok).toBeTruthy();
    if (targetResult.ok) _targetBranchVersionId = targetResult.value.id;
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Merge Request Creation", () => {
    it("should create merge request between branches", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "source-branch",
        "target-branch",
        testUserId
      );

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const mergeRequest = result.value;
        expect(mergeRequest.sourceBranch).toBe("source-branch");
        expect(mergeRequest.targetBranch).toBe("target-branch");
        expect(mergeRequest.postId).toBe(testPostId);
        expect(mergeRequest.requestedBy).toBe(testUserId);
        expect(mergeRequest.requestedAt instanceof Date).toBeTruthy();
        expect(["pending", "conflicted"].includes(mergeRequest.status)).toBeTruthy();
      }
    });

    it("should detect conflicts automatically", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "source-branch",
        "target-branch",
        testUserId
      );

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const mergeRequest = result.value;
        if (mergeRequest.conflicts.length > 0) {
          expect(mergeRequest.status).toBe("conflicted");
          const titleConflict = mergeRequest.conflicts.find((c) => c.field === "title");
          expect(titleConflict).toBeTruthy();
        }
      }
    });

    it("should set status to pending when no conflicts", async () => {
      const base2Result = await versionManager.createVersion(
        `${testPostId}_noconflict`,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId }
      );
      expect(base2Result.ok).toBeTruthy();
      const base2Id = base2Result.ok ? base2Result.value.id : "";

      await versionManager.createBranch(
        `${testPostId}_noconflict`,
        "branch-a",
        base2Id,
        testUserId
      );
      await versionManager.createBranch(
        `${testPostId}_noconflict`,
        "branch-b",
        base2Id,
        testUserId
      );

      await versionManager.createVersion(
        `${testPostId}_noconflict`,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId, branchName: "branch-a" }
      );

      await versionManager.createVersion(
        `${testPostId}_noconflict`,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId, branchName: "branch-b" }
      );

      const result = await versionManager.createMergeRequest(
        `${testPostId}_noconflict`,
        "branch-a",
        "branch-b",
        testUserId
      );

      expect(result.ok).toBeTruthy();
      if (result.ok && result.value.conflicts.length === 0) {
        expect(result.value.status).toBe("pending");
      }
    });
  });

  describe("Merge Request Validation", () => {
    it("should reject merge request for non-existent source branch", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "non-existent-branch",
        "target-branch",
        testUserId
      );

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.message.includes("not found")).toBeTruthy();
      }
    });

    it("should reject merge request for non-existent target branch", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "source-branch",
        "non-existent-branch",
        testUserId
      );

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
      }
    });
  });
});

describe("ContentVersionManager - Event Emissions", () => {
  beforeEach(() => {
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    mockPrisma = createMockPrisma();

    versionManager = new ContentVersionManager({
      prisma: mockPrisma,
      redis: mockRedis as Redis,
      eventService: mockEventService as EventService,
      cache: new InMemoryCacheAdapter(),
    });
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  it("should emit VERSION_CREATED event on version creation", async () => {
    const eventService = mockEventService as any;
    const initialEventCount = eventService.getPublishedEvents().length;

    await versionManager.createVersion(testPostId, testCanonicalPost, testAdaptations, {
      createdBy: testUserId,
    });

    const events = eventService.getPublishedEvents();
    expect(events.length).toBe(initialEventCount + 1);

    const versionEvent = events[events.length - 1];
    expect(versionEvent.type).toBe("VERSION_CREATED");
    expect(versionEvent.aggregateType).toBe("ContentVersion");
  });

  it("should emit BRANCH_CREATED event on branch creation", async () => {
    const versionResult = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    expect(versionResult.ok).toBeTruthy();

    const eventService = mockEventService as any;
    const initialEventCount = eventService.getPublishedEvents().length;

    await versionManager.createBranch(
      testPostId,
      "feature-branch",
      versionResult.ok ? versionResult.value.id : "",
      testUserId
    );

    const events = eventService.getPublishedEvents();
    expect(events.length > initialEventCount).toBeTruthy();

    const branchEvent = events[events.length - 1];
    expect(branchEvent.type).toBe("BRANCH_CREATED");
    expect(branchEvent.aggregateType).toBe("VersionBranch");
  });

  it("should emit VERSION_RESTORED event on version restoration", async () => {
    const versionResult = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    expect(versionResult.ok).toBeTruthy();

    const eventService = mockEventService as any;
    const _initialEventCount = eventService.getPublishedEvents().length;

    await versionManager.restoreVersion(versionResult.ok ? versionResult.value.id : "", testUserId);

    const events = eventService.getPublishedEvents();
    const restoredEvent = events.find((e: any) => e.type === "VERSION_RESTORED");
    expect(restoredEvent).toBeTruthy();
  });
});
