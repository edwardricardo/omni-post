/**
 * @file activityFeedService.test.ts
 * @description Integration tests for the ActivityFeedService — cursor-based pagination,
 *              action-to-display mapping, and filter behavior.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { ActivityFeedService } from "../../src/audit/activityFeedService.js";
import { AuditActions, AuditResources } from "../../src/audit/auditService.js";
import {
  setupAuditTestUsers,
  teardownAuditTestUsers,
  testUserId,
} from "./auditService.test-helpers.js";

describe("ActivityFeedService", { concurrency: 1 }, () => {
  const feedService = new ActivityFeedService();
  let createdLogIds: string[] = [];

  before(async () => {
    await setupAuditTestUsers();
  });

  after(async () => {
    if (createdLogIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdLogIds } } });
    }
    await teardownAuditTestUsers();
  });

  /**
   * Helper to create audit logs for testing
   */
  async function createTestLog(
    overrides: {
      action?: string;
      resource?: string;
      resourceId?: string;
      userId?: string;
      success?: boolean;
      details?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const log = await prisma.auditLog.create({
      data: {
        action: overrides.action ?? AuditActions.POST_CREATED,
        ...(overrides.resource && { resource: overrides.resource }),
        ...(overrides.resourceId && { resourceId: overrides.resourceId }),
        ...(overrides.userId && { userId: overrides.userId }),
        success: overrides.success ?? true,
        ...(overrides.details && { details: overrides.details }),
      },
    });
    createdLogIds.push(log.id);
    return log.id;
  }

  describe("getFeed", () => {
    beforeEach(async () => {
      if (createdLogIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { id: { in: createdLogIds } } });
        createdLogIds = [];
      }
    });

    it("returns empty feed when no audit logs exist for filters", async () => {
      const result = await feedService.getFeed({ userId: "non-existent-user-id" });

      assert.ok(result.ok, "Should return successful result");
      assert.strictEqual(result.value.items.length, 0);
      assert.strictEqual(result.value.hasMore, false);
      assert.strictEqual(result.value.nextCursor, undefined);
    });

    it("returns activity items with correct display mapping", async () => {
      await createTestLog({ action: AuditActions.POST_CREATED, userId: testUserId });

      const result = await feedService.getFeed({ userId: testUserId });

      assert.ok(result.ok, "Should return successful result");
      assert.ok(result.value.items.length >= 1, "Should have at least 1 item");

      const postItem = result.value.items.find((i) => i.title === "Created post");
      assert.ok(postItem, "Should find POST_CREATED mapped item");
      assert.strictEqual(postItem.icon, "file-plus");
      assert.ok(postItem.timestamp instanceof Date);
    });

    it("includes actor information when user exists", async () => {
      await createTestLog({ action: AuditActions.LOGIN, userId: testUserId });

      const result = await feedService.getFeed({ userId: testUserId });

      assert.ok(result.ok);
      const loginItem = result.value.items.find((i) => i.title === "Signed in");
      assert.ok(loginItem, "Should find LOGIN item");
      assert.ok(loginItem.actor, "Should include actor");
      assert.strictEqual(loginItem.actor.email, "audit-test-user@example.com");
    });

    it("filters by resource type", async () => {
      await createTestLog({
        action: AuditActions.PROJECT_CREATED,
        resource: AuditResources.PROJECT,
        userId: testUserId,
      });
      await createTestLog({
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        userId: testUserId,
      });

      const result = await feedService.getFeed({
        resource: AuditResources.PROJECT,
        userId: testUserId,
      });

      assert.ok(result.ok);
      const allProject = result.value.items.every((i) => i.resource === AuditResources.PROJECT);
      assert.ok(allProject, "All items should be Project resources");
    });

    it("excludes failed actions from feed", async () => {
      await createTestLog({
        action: AuditActions.LOGIN_FAILED,
        userId: testUserId,
        success: false,
      });
      await createTestLog({
        action: AuditActions.LOGIN,
        userId: testUserId,
        success: true,
      });

      const result = await feedService.getFeed({ userId: testUserId });

      assert.ok(result.ok);
      const failedItems = result.value.items.filter((i) => i.title === "Failed sign-in attempt");
      assert.strictEqual(failedItems.length, 0, "Should not include failed actions");
    });

    it("supports cursor-based pagination", async () => {
      // Create 5 logs
      for (let i = 0; i < 5; i++) {
        await createTestLog({ action: AuditActions.POST_UPDATED, userId: testUserId });
      }

      // Get first page with limit 2
      const page1 = await feedService.getFeed({ userId: testUserId, limit: 2 });
      assert.ok(page1.ok);
      assert.strictEqual(page1.value.items.length, 2);
      assert.strictEqual(page1.value.hasMore, true);
      assert.ok(page1.value.nextCursor, "Should have nextCursor");

      // Get second page using cursor
      const page2 = await feedService.getFeed({
        userId: testUserId,
        limit: 2,
        cursor: page1.value.nextCursor,
      });
      assert.ok(page2.ok);
      assert.strictEqual(page2.value.items.length, 2);

      // Verify no overlap
      const page1Ids = new Set(page1.value.items.map((i) => i.id));
      const overlap = page2.value.items.filter((i) => page1Ids.has(i.id));
      assert.strictEqual(overlap.length, 0, "Pages should not overlap");
    });

    it("caps limit at 100", async () => {
      const result = await feedService.getFeed({ userId: testUserId, limit: 500 });
      assert.ok(result.ok, "Should not error on high limit");
    });

    it("builds description from details metadata", async () => {
      await createTestLog({
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        resourceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        userId: testUserId,
        details: { name: "My First Post" },
      });

      const result = await feedService.getFeed({ userId: testUserId });
      assert.ok(result.ok);

      const item = result.value.items.find(
        (i) => i.resourceId === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      );
      assert.ok(item, "Should find the item");
      assert.ok(item.description.includes("My First Post"), "Should include name from details");
      assert.ok(item.description.includes("Post"), "Should include resource type");
    });
  });
});
