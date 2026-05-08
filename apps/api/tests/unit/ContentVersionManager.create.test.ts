/**
 * @file ContentVersionManager.create.test.ts
 * @description Tests for ContentVersionManager - createVersion
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

describe("ContentVersionManager - createVersion", () => {
  afterAll(() => {
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
      cache: new InMemoryCacheAdapter(),
    });
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Initial Version Creation", () => {
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.version).toBe(1);
        expect(result.value.postId).toBe(testPostId);
        expect(result.value.createdBy).toBe(testUserId);
        expect(result.value.changelog).toBe("Initial version");
        expect(result.value.id).toBeTruthy();
        expect(result.value.createdAt instanceof Date).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isActive).toBe(true);
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isActive).toBe(false);
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.content).toStrictEqual(testCanonicalPost);
        expect(result.value.adaptations).toStrictEqual(testAdaptations);
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.changelog).toBe(undefined);
      }
    });
  });

  describe("Incremental Version Creation", () => {
    it("should increment version number for subsequent versions", async () => {
      const result1 = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId }
      );

      expect(result1.ok).toBeTruthy();

      const updatedPost = { ...testCanonicalPost, title: "Updated Title" };
      const result2 = await versionManager.createVersion(testPostId, updatedPost, testAdaptations, {
        createdBy: testUserId,
      });

      expect(result2.ok).toBeTruthy();
      if (result2.ok) {
        expect(result2.value.version).toBe(2);
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

      expect(result.ok).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
    });
  });

  describe("Version Creation Error Handling", () => {
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
        cache: new InMemoryCacheAdapter(),
      });

      const result = await invalidManager.createVersion(
        testPostId,
        testCanonicalPost,
        testAdaptations,
        { createdBy: testUserId }
      );

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("system");
        expect(result.error.message.includes("Failed to create version")).toBeTruthy();
        expect(result.error.retryable).toBe(true);
      }
    });
  });
});

describe("ContentVersionManager - createBranch", () => {
  let baseVersionId: string;

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

    const result = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId }
    );
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      baseVersionId = result.value.id;
    }
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Branch Creation Success", () => {
    it("should create a new branch successfully", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId,
        "New feature development"
      );

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.name).toBe("feature-branch");
        expect(result.value.postId).toBe(testPostId);
        expect(result.value.baseVersionId).toBe(baseVersionId);
        expect(result.value.headVersionId).toBe(baseVersionId);
        expect(result.value.isActive).toBe(true);
        expect(result.value.createdBy).toBe(testUserId);
        expect(result.value.description).toBe("New feature development");
        expect(result.value.mergeable).toBe(true);
        expect(result.value.conflictsWith).toStrictEqual([]);
      }
    });

    it("should create branch without description", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "quick-fix",
        baseVersionId,
        testUserId
      );

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.description).toBe(undefined);
      }
    });

    it("should initialize branch head to base version", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId
      );

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.headVersionId).toBe(result.value.baseVersionId);
      }
    });
  });

  describe("Branch Creation Validation", () => {
    it("should reject duplicate branch names", async () => {
      const result1 = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId
      );
      expect(result1.ok).toBeTruthy();

      const result2 = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        baseVersionId,
        testUserId
      );

      expect(result2.ok).toBeFalsy();
      if (!result2.ok) {
        expect(result2.error.type).toBe("validation");
        expect(result2.error.message.includes("Branch already exists")).toBeTruthy();
        expect(result2.error.retryable).toBe(false);
      }
    });

    it("should reject non-existent base version ID", async () => {
      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        "non-existent-version-id",
        testUserId
      );

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.message.includes("Invalid base version")).toBeTruthy();
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
      expect(otherResult.ok).toBeTruthy();

      const otherVersionId = otherResult.ok ? otherResult.value.id : "";

      const result = await versionManager.createBranch(
        testPostId,
        "feature-branch",
        otherVersionId,
        testUserId
      );

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.message.includes("Invalid base version")).toBeTruthy();
      }
    });
  });
});
