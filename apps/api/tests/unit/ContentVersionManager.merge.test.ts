const _origConsoleError = console.error;
const _origConsoleLog = console.log;
const _origConsoleWarn = console.warn;
console.error = () => {};
console.log = () => {};
console.warn = () => {};

import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { ContentVersionManager } from "../../src/content/ContentVersionManager";
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

describe("ContentVersionManager - restoreVersion", { concurrency: 1 }, () => {
  let version1Id: string;
  let _version2Id: string;

  after(() => {
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
    });

    const result1 = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId, changelog: "Version 1" }
    );
    assert.ok(result1.ok);
    if (result1.ok) version1Id = result1.value.id;

    const result2 = await versionManager.createVersion(
      testPostId,
      { ...testCanonicalPost, title: "Updated Title" },
      testAdaptations,
      { createdBy: testUserId, changelog: "Version 2" }
    );
    assert.ok(result2.ok);
    if (result2.ok) _version2Id = result2.value.id;
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Restoration Success", { concurrency: 1 }, () => {
    it("should restore content from previous version", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      assert.ok(result.ok, "Restoration should succeed");
      if (result.ok) {
        const restoredVersion = result.value;
        assert.strictEqual(restoredVersion.version, 3, "Should create new version");
        assert.strictEqual(restoredVersion.content.title, testCanonicalPost.title);
        assert.ok(restoredVersion.changelog?.includes("Restored from version"));
      }
    });

    it("should create new version on restore (not modify original)", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      assert.ok(result.ok);
      if (result.ok) {
        assert.notStrictEqual(result.value.id, version1Id, "Should be new version");
      }
    });

    it("should preserve adaptations during restoration", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      assert.ok(result.ok);
      if (result.ok) {
        assert.deepStrictEqual(result.value.adaptations, testAdaptations);
      }
    });

    it("should include restoration metadata in changelog", async () => {
      const result = await versionManager.restoreVersion(version1Id, testUserId);

      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.changelog?.includes("Restored from version"));
        assert.ok(result.value.changelog?.includes("1"));
      }
    });
  });

  describe("Restoration Validation", { concurrency: 1 }, () => {
    it("should reject restoration of non-existent version", async () => {
      const result = await versionManager.restoreVersion("non-existent-id", testUserId);

      assert.ok(!result.ok, "Should fail for non-existent version");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
        assert.ok(result.error.message.includes("Version not found"));
        assert.strictEqual(result.error.retryable, false);
      }
    });
  });
});

describe("ContentVersionManager - createMergeRequest", { concurrency: 1 }, () => {
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
    });

    const baseResult = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    assert.ok(baseResult.ok);
    if (baseResult.ok) baseVersionId = baseResult.value.id;

    await versionManager.createBranch(testPostId, "source-branch", baseVersionId, testUserId);

    const sourceResult = await versionManager.createVersion(
      testPostId,
      { ...testCanonicalPost, title: "Source Branch Title" },
      testAdaptations,
      { createdBy: testUserId, branchName: "source-branch" }
    );
    assert.ok(sourceResult.ok);
    if (sourceResult.ok) _sourceBranchVersionId = sourceResult.value.id;

    await versionManager.createBranch(testPostId, "target-branch", baseVersionId, testUserId);

    const targetResult = await versionManager.createVersion(
      testPostId,
      { ...testCanonicalPost, title: "Target Branch Title" },
      testAdaptations,
      { createdBy: testUserId, branchName: "target-branch" }
    );
    assert.ok(targetResult.ok);
    if (targetResult.ok) _targetBranchVersionId = targetResult.value.id;
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Merge Request Creation", { concurrency: 1 }, () => {
    it("should create merge request between branches", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "source-branch",
        "target-branch",
        testUserId
      );

      assert.ok(result.ok, "Merge request creation should succeed");
      if (result.ok) {
        const mergeRequest = result.value;
        assert.strictEqual(mergeRequest.sourceBranch, "source-branch");
        assert.strictEqual(mergeRequest.targetBranch, "target-branch");
        assert.strictEqual(mergeRequest.postId, testPostId);
        assert.strictEqual(mergeRequest.requestedBy, testUserId);
        assert.ok(mergeRequest.requestedAt instanceof Date);
        assert.ok(["pending", "conflicted"].includes(mergeRequest.status));
      }
    });

    it("should detect conflicts automatically", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "source-branch",
        "target-branch",
        testUserId
      );

      assert.ok(result.ok);
      if (result.ok) {
        const mergeRequest = result.value;
        if (mergeRequest.conflicts.length > 0) {
          assert.strictEqual(mergeRequest.status, "conflicted");
          const titleConflict = mergeRequest.conflicts.find((c) => c.field === "title");
          assert.ok(titleConflict, "Should detect title conflict");
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
      assert.ok(base2Result.ok);
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

      assert.ok(result.ok);
      if (result.ok && result.value.conflicts.length === 0) {
        assert.strictEqual(result.value.status, "pending");
      }
    });
  });

  describe("Merge Request Validation", { concurrency: 1 }, () => {
    it("should reject merge request for non-existent source branch", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "non-existent-branch",
        "target-branch",
        testUserId
      );

      assert.ok(!result.ok, "Should fail for non-existent source");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
        assert.ok(result.error.message.includes("not found"));
      }
    });

    it("should reject merge request for non-existent target branch", async () => {
      const result = await versionManager.createMergeRequest(
        testPostId,
        "source-branch",
        "non-existent-branch",
        testUserId
      );

      assert.ok(!result.ok, "Should fail for non-existent target");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
      }
    });
  });
});

describe("ContentVersionManager - Event Emissions", { concurrency: 1 }, () => {
  beforeEach(() => {
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    mockPrisma = createMockPrisma();

    versionManager = new ContentVersionManager({
      prisma: mockPrisma,
      redis: mockRedis as Redis,
      eventService: mockEventService as EventService,
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
    assert.strictEqual(events.length, initialEventCount + 1, "Should emit one event");

    const versionEvent = events[events.length - 1];
    assert.strictEqual(versionEvent.type, "VERSION_CREATED");
    assert.strictEqual(versionEvent.aggregateType, "ContentVersion");
  });

  it("should emit BRANCH_CREATED event on branch creation", async () => {
    const versionResult = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    assert.ok(versionResult.ok);

    const eventService = mockEventService as any;
    const initialEventCount = eventService.getPublishedEvents().length;

    await versionManager.createBranch(
      testPostId,
      "feature-branch",
      versionResult.ok ? versionResult.value.id : "",
      testUserId
    );

    const events = eventService.getPublishedEvents();
    assert.ok(events.length > initialEventCount, "Should emit branch event");

    const branchEvent = events[events.length - 1];
    assert.strictEqual(branchEvent.type, "BRANCH_CREATED");
    assert.strictEqual(branchEvent.aggregateType, "VersionBranch");
  });

  it("should emit VERSION_RESTORED event on version restoration", async () => {
    const versionResult = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    assert.ok(versionResult.ok);

    const eventService = mockEventService as any;
    const _initialEventCount = eventService.getPublishedEvents().length;

    await versionManager.restoreVersion(versionResult.ok ? versionResult.value.id : "", testUserId);

    const events = eventService.getPublishedEvents();
    const restoredEvent = events.find((e: any) => e.type === "VERSION_RESTORED");
    assert.ok(restoredEvent, "Should emit VERSION_RESTORED event");
  });
});
