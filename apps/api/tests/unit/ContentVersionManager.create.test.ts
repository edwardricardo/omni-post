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

describe("ContentVersionManager - createVersion", { concurrency: 1 }, () => {
  after(() => {
    console.error = _origConsoleError;
    console.log = _origConsoleLog;
    console.warn = _origConsoleWarn;
  });

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

  describe("Initial Version Creation", { concurrency: 1 }, () => {
    it("should create version 1 for new post", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
          changelog: "Initial version",
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.version, 1);
        assert.strictEqual(result.value.postId, testPostId);
        assert.strictEqual(result.value.createdBy, testUserId);
        assert.strictEqual(result.value.changelog, "Initial version");
        assert.ok(result.value.id, "Version should have an ID");
        assert.ok(result.value.createdAt instanceof Date, "Should have createdAt timestamp");
      }
    });

    it("should set isActive to true for main branch versions", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.isActive, true, "Main branch version should be active");
      }
    });

    it("should set isActive to false for branch versions", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
          branchName: "feature-branch",
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.isActive, false, "Branch version should not be active");
      }
    });

    it("should store content and adaptations", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
      if (result.ok) {
        assert.deepStrictEqual(result.value.content, testCanonicalPost);
        assert.deepStrictEqual(result.value.adaptations, testAdaptations);
      }
    });

    it("should handle optional changelog parameter", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.changelog, undefined);
      }
    });
  });

  describe("Incremental Version Creation", { concurrency: 1 }, () => {
    it("should increment version number for subsequent versions", async () => {
      const result1 = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId }
      );

      assert.ok(result1.ok);

      const updatedPost = { ...testCanonicalPost, title: "Updated Title" };
      const result2 = await versionManager.createVersion(testPostId, updatedPost, testAdaptations, {
        createdBy: testUserId,
      });

      assert.ok(result2.ok);
      if (result2.ok) {
        assert.strictEqual(result2.value.version, 2, "Should be version 2");
      }
    });

    it("should handle version creation with tags", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
          tags: ["release", "v1.0"],
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
    });

    it("should handle version creation with category", async () => {
      const result = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        {
          createdBy: testUserId,
          category: "marketing",
        }
      );

      assert.ok(result.ok, "Version creation should succeed");
    });
  });

  describe("Version Creation Error Handling", { concurrency: 1 }, () => {
    it("should handle errors gracefully", async () => {
      const invalidManager = new ContentVersionManager({
        prisma: mockPrisma,
        redis: {
          ...mockRedis,
          lpush: async () => {
            throw new Error("Redis connection error");
          },
        } as MockRedis as Redis,
        eventService: mockEventService as EventService,
      });

      const result = await invalidManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId }
      );

      assert.ok(!result.ok, "Should return error result");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "system");
        assert.ok(result.error.message.includes("Failed to create version"));
        assert.strictEqual(result.error.retryable, true);
      }
    });
  });
});

describe("ContentVersionManager - createBranch", { concurrency: 1 }, () => {
  let baseVersionId: string;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    mockPrisma = createMockPrisma();

    versionManager = new ContentVersionManager({
      prisma: mockPrisma,
      redis: mockRedis as Redis,
      eventService: mockEventService as EventService,
    });

    const result = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    assert.ok(result.ok);
    if (result.ok) {
      baseVersionId = result.value.id;
    }
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Branch Creation Success", { concurrency: 1 }, () => {
    it("should create a new branch successfully", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId,
        "New feature development"
      );

      assert.ok(result.ok, "Branch creation should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.name, "feature-branch");
        assert.strictEqual(result.value.postId, testPostId);
        assert.strictEqual(result.value.baseVersionId, baseVersionId);
        assert.strictEqual(result.value.headVersionId, baseVersionId);
        assert.strictEqual(result.value.isActive, true);
        assert.strictEqual(result.value.createdBy, testUserId);
        assert.strictEqual(result.value.description, "New feature development");
        assert.strictEqual(result.value.mergeable, true);
        assert.deepStrictEqual(result.value.conflictsWith, []);
      }
    });

    it("should create branch without description", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "quick-fix",
        baseVersionId,
        testUserId
      );

      assert.ok(result.ok, "Branch creation should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.description, undefined);
      }
    });

    it("should initialize branch head to base version", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId
      );

      assert.ok(result.ok);
      if (result.ok) {
        assert.strictEqual(
          result.value.headVersionId,
          result.value.baseVersionId,
          "Head should initially point to base"
        );
      }
    });
  });

  describe("Branch Creation Validation", { concurrency: 1 }, () => {
    it("should reject duplicate branch names", async () => {
      const result1 = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId
      );
      assert.ok(result1.ok);

      const result2 = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId
      );

      assert.ok(!result2.ok, "Duplicate branch should fail");
      if (!result2.ok) {
        assert.strictEqual(result2.error.type, "validation");
        assert.ok(result2.error.message.includes("Branch already exists"));
        assert.strictEqual(result2.error.retryable, false);
      }
    });

    it("should reject non-existent base version ID", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        "non-existent-version-id",
        testUserId
      );

      assert.ok(!result.ok, "Branch creation should fail with non-existent base version");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
        assert.ok(result.error.message.includes("Invalid base version"));
      }
    });

    it("should reject base version from a different post", async () => {
      const otherPostId = `post_${Date.now()}_other`;
      const otherResult = await versionManager.createVersion(
        otherPostId,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId }
      );
      assert.ok(otherResult.ok);

      const otherVersionId = otherResult.ok ? otherResult.value.id : "";

      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        otherVersionId,
        testUserId
      );

      assert.ok(!result.ok, "Branch creation should fail with cross-post base version");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
        assert.ok(result.error.message.includes("Invalid base version"));
      }
    });
  });
});
