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

describe("ContentVersionManager - compareVersions", { concurrency: 1 }, () => {
  let version1Id: string;
  let version2Id: string;

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

    const updatedPost = {
      ...testCanonicalPost,
      title: "Updated Title",
      body: "Updated body content",
    };
    const result2 = await versionManager.createVersion(testPostId, updatedPost, testAdaptations, {
      createdBy: testUserId,
      changelog: "Version 2",
    });
    assert.ok(result2.ok);
    if (result2.ok) version2Id = result2.value.id;
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Diff Generation", { concurrency: 1 }, () => {
    it("should generate diffs for modified content fields", async () => {
      const result = await versionManager.compareVersions(version1Id, version2Id);

      assert.ok(result.ok, "Comparison should succeed");
      if (result.ok) {
        const diffs = result.value;
        assert.ok(Array.isArray(diffs), "Should return array of diffs");

        const titleDiff = diffs.find((d) => d.field === "content.title");
        assert.ok(titleDiff, "Should have title diff");
        if (titleDiff) {
          assert.strictEqual(titleDiff.oldValue, "Test Post Title");
          assert.strictEqual(titleDiff.newValue, "Updated Title");
          assert.strictEqual(titleDiff.changeType, "modified");
        }

        const bodyDiff = diffs.find((d) => d.field === "content.body");
        assert.ok(bodyDiff, "Should have body diff");
        if (bodyDiff) {
          assert.strictEqual(bodyDiff.oldValue, "Test post content body");
          assert.strictEqual(bodyDiff.newValue, "Updated body content");
          assert.strictEqual(bodyDiff.changeType, "modified");
        }
      }
    });

    it("should detect added fields", async () => {
      const version3Post = {
        ...testCanonicalPost,
        subtitle: "New subtitle field",
      } as any;

      const result3 = await versionManager.createVersion(
        testPostId,
        version3Post,
        testAdaptations,
        { createdBy: testUserId }
      );
      assert.ok(result3.ok);
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      assert.ok(result.ok);
      if (result.ok) {
        const addedDiff = result.value.find((d) => d.field === "content.subtitle");
        assert.ok(addedDiff, "Should detect added field");
        if (addedDiff) {
          assert.strictEqual(addedDiff.oldValue, undefined);
          assert.strictEqual(addedDiff.newValue, "New subtitle field");
          assert.strictEqual(addedDiff.changeType, "added");
        }
      }
    });

    it("should detect removed fields", async () => {
      const version3Post = {
        title: testCanonicalPost.title,
        body: testCanonicalPost.body,
      } as any;

      const result3 = await versionManager.createVersion(
        testPostId,
        version3Post,
        {},
        { createdBy: testUserId }
      );
      assert.ok(result3.ok);
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      assert.ok(result.ok);
      if (result.ok) {
        const removedDiff = result.value.find((d) => d.field === "content.tags");
        assert.ok(removedDiff, "Should detect removed field");
        if (removedDiff) {
          assert.deepStrictEqual(removedDiff.oldValue, ["test", "content"]);
          assert.strictEqual(removedDiff.newValue, undefined);
          assert.strictEqual(removedDiff.changeType, "removed");
        }
      }
    });

    it("should compare adaptations across platforms", async () => {
      const updatedAdaptations = {
        ...testAdaptations,
        x: {
          ...testAdaptations.x,
          body: "Updated Twitter content",
        },
      };

      const result3 = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        updatedAdaptations,
        { createdBy: testUserId }
      );
      assert.ok(result3.ok);
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      assert.ok(result.ok);
      if (result.ok) {
        const adaptationDiff = result.value.find((d) => d.field.startsWith("adaptations.x"));
        assert.ok(adaptationDiff, "Should detect adaptation changes");
      }
    });

    it("should detect added platform adaptations", async () => {
      const newAdaptations = {
        ...testAdaptations,
        facebook: {
          ...testCanonicalPost,
          body: "Facebook-specific content",
        },
      } as any;

      const result3 = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        newAdaptations,
        { createdBy: testUserId }
      );
      assert.ok(result3.ok);
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      assert.ok(result.ok);
      if (result.ok) {
        const addedAdaptation = result.value.find((d) => d.field === "adaptations.facebook");
        assert.ok(addedAdaptation, "Should detect added adaptation");
        if (addedAdaptation) {
          assert.strictEqual(addedAdaptation.changeType, "added");
        }
      }
    });

    it("should detect removed platform adaptations", async () => {
      const reducedAdaptations = {
        x: testAdaptations.x,
      };

      const result3 = await versionManager.createVersion(
        testPostId,
        testCanonicalPost,
        reducedAdaptations,
        { createdBy: testUserId }
      );
      assert.ok(result3.ok);
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      assert.ok(result.ok);
      if (result.ok) {
        const removedAdaptation = result.value.find((d) => d.field === "adaptations.instagram");
        assert.ok(removedAdaptation, "Should detect removed adaptation");
        if (removedAdaptation) {
          assert.strictEqual(removedAdaptation.changeType, "removed");
        }
      }
    });
  });

  describe("Comparison Validation", { concurrency: 1 }, () => {
    it("should handle comparison with non-existent version", async () => {
      const result = await versionManager.compareVersions(version1Id, "non-existent-id");

      assert.ok(!result.ok, "Should fail for non-existent version");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
        assert.ok(result.error.message.includes("not found"));
      }
    });

    it("should handle comparison when both versions not found", async () => {
      const result = await versionManager.compareVersions("invalid-1", "invalid-2");

      assert.ok(!result.ok, "Should fail when versions not found");
      if (!result.ok) {
        assert.strictEqual(result.error.type, "validation");
      }
    });
  });
});

describe("ContentVersionManager - getVersionHistory", { concurrency: 1 }, () => {
  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    mockPrisma = createMockPrisma();

    versionManager = new ContentVersionManager({
      prisma: mockPrisma,
      redis: mockRedis as Redis,
      eventService: mockEventService as EventService,
    });

    for (let i = 1; i <= 5; i++) {
      await versionManager.createVersion(
        testPostId,
        { ...testCanonicalPost, title: `Version ${i}` },
        testAdaptations,
        { createdBy: testUserId, changelog: `Change ${i}` }
      );
    }
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  it("should retrieve all versions for a post", async () => {
    const history = await versionManager.getVersionHistory(testPostId);

    assert.ok(Array.isArray(history), "Should return array");
    assert.strictEqual(history.length, 5, "Should have 5 versions");
  });

  it("should respect limit parameter", async () => {
    const history = await versionManager.getVersionHistory(testPostId, undefined, 3);

    assert.strictEqual(history.length, 3, "Should limit to 3 versions");
  });

  it("should retrieve versions from cache", async () => {
    const history1 = await versionManager.getVersionHistory(testPostId);
    assert.strictEqual(history1.length, 5);

    const history2 = await versionManager.getVersionHistory(testPostId);
    assert.strictEqual(history2.length, 5);
    assert.deepStrictEqual(history1, history2);
  });

  it("should handle empty history gracefully", async () => {
    const emptyPostId = `post_${Date.now()}_empty`;
    const history = await versionManager.getVersionHistory(emptyPostId);

    assert.ok(Array.isArray(history), "Should return empty array");
    assert.strictEqual(history.length, 0);
  });
});
