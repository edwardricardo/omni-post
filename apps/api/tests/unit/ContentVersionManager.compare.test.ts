const _origConsoleError = console.error;
const _origConsoleLog = console.log;
const _origConsoleWarn = console.warn;
console.error = () => {};
console.log = () => {};
console.warn = () => {};

import { describe, it, beforeEach, afterEach, afterAll, expect } from "vitest";
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

describe("ContentVersionManager - compareVersions", () => {
  let version1Id: string;
  let version2Id: string;

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
    });

    const result1 = await versionManager.createVersion(
      testPostId,
      testCanonicalPost,
      testAdaptations,
      { createdBy: testUserId, changelog: "Version 1" }
    );
    expect(result1.ok).toBeTruthy();
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
    expect(result2.ok).toBeTruthy();
    if (result2.ok) version2Id = result2.value.id;
  });

  afterEach(async () => {
    if (mockRedis && typeof mockRedis.disconnect === "function") {
      await mockRedis.disconnect();
    }
  });

  describe("Diff Generation", () => {
    it("should generate diffs for modified content fields", async () => {
      const result = await versionManager.compareVersions(version1Id, version2Id);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const diffs = result.value;
        expect(Array.isArray(diffs)).toBeTruthy();

        const titleDiff = diffs.find((d) => d.field === "content.title");
        expect(titleDiff).toBeTruthy();
        if (titleDiff) {
          expect(titleDiff.oldValue).toBe("Test Post Title");
          expect(titleDiff.newValue).toBe("Updated Title");
          expect(titleDiff.changeType).toBe("modified");
        }

        const bodyDiff = diffs.find((d) => d.field === "content.body");
        expect(bodyDiff).toBeTruthy();
        if (bodyDiff) {
          expect(bodyDiff.oldValue).toBe("Test post content body");
          expect(bodyDiff.newValue).toBe("Updated body content");
          expect(bodyDiff.changeType).toBe("modified");
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
      expect(result3.ok).toBeTruthy();
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const addedDiff = result.value.find((d) => d.field === "content.subtitle");
        expect(addedDiff).toBeTruthy();
        if (addedDiff) {
          expect(addedDiff.oldValue).toBe(undefined);
          expect(addedDiff.newValue).toBe("New subtitle field");
          expect(addedDiff.changeType).toBe("added");
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
      expect(result3.ok).toBeTruthy();
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const removedDiff = result.value.find((d) => d.field === "content.tags");
        expect(removedDiff).toBeTruthy();
        if (removedDiff) {
          expect(removedDiff.oldValue).toStrictEqual(["test", "content"]);
          expect(removedDiff.newValue).toBe(undefined);
          expect(removedDiff.changeType).toBe("removed");
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
      expect(result3.ok).toBeTruthy();
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const adaptationDiff = result.value.find((d) => d.field.startsWith("adaptations.x"));
        expect(adaptationDiff).toBeTruthy();
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
      expect(result3.ok).toBeTruthy();
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const addedAdaptation = result.value.find((d) => d.field === "adaptations.facebook");
        expect(addedAdaptation).toBeTruthy();
        if (addedAdaptation) {
          expect(addedAdaptation.changeType).toBe("added");
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
      expect(result3.ok).toBeTruthy();
      const version3Id = result3.ok ? result3.value.id : "";

      const result = await versionManager.compareVersions(version1Id, version3Id);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const removedAdaptation = result.value.find((d) => d.field === "adaptations.instagram");
        expect(removedAdaptation).toBeTruthy();
        if (removedAdaptation) {
          expect(removedAdaptation.changeType).toBe("removed");
        }
      }
    });
  });

  describe("Comparison Validation", () => {
    it("should handle comparison with non-existent version", async () => {
      const result = await versionManager.compareVersions(version1Id, "non-existent-id");

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.message.includes("not found")).toBeTruthy();
      }
    });

    it("should handle comparison when both versions not found", async () => {
      const result = await versionManager.compareVersions("invalid-1", "invalid-2");

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
      }
    });
  });
});

describe("ContentVersionManager - getVersionHistory", () => {
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

    expect(Array.isArray(history)).toBeTruthy();
    expect(history.length).toBe(5);
  });

  it("should respect limit parameter", async () => {
    const history = await versionManager.getVersionHistory(testPostId, undefined, 3);

    expect(history.length).toBe(3);
  });

  it("should retrieve versions from cache", async () => {
    const history1 = await versionManager.getVersionHistory(testPostId);
    expect(history1.length).toBe(5);

    const history2 = await versionManager.getVersionHistory(testPostId);
    expect(history2.length).toBe(5);
    expect(history1).toStrictEqual(history2);
  });

  it("should handle empty history gracefully", async () => {
    const emptyPostId = `post_${Date.now()}_empty`;
    const history = await versionManager.getVersionHistory(emptyPostId);

    expect(Array.isArray(history)).toBeTruthy();
    expect(history.length).toBe(0);
  });
});
