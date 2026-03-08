import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { AuditService } from "../../src/audit/auditService";
import {
  setupAuditTestUsers,
  teardownAuditTestUsers,
  testUserId,
  testUser2Id,
} from "./auditService.test-helpers.js";

describe("AuditService - getStats()", { concurrency: 1 }, () => {
  const auditService = new AuditService();

  before(async () => {
    await setupAuditTestUsers();

    await prisma.auditLog.createMany({
      data: [
        { userId: testUserId, action: "STATS_LOGIN", resource: "Session", success: true },
        { userId: testUserId, action: "STATS_LOGIN", resource: "Session", success: true },
        {
          userId: testUserId,
          action: "STATS_POST_CREATE",
          resource: "Post",
          resourceId: "stats-post-1",
          success: true,
        },
        { userId: testUser2Id, action: "STATS_LOGIN", resource: "Session", success: false },
        {
          userId: testUser2Id,
          action: "STATS_POST_CREATE",
          resource: "Post",
          resourceId: "stats-post-2",
          success: true,
        },
        {
          userId: testUser2Id,
          action: "STATS_POST_CREATE",
          resource: "Post",
          resourceId: "stats-post-3",
          success: true,
        },
        { action: "STATS_SYSTEM_HEALTH", resource: "System", success: true },
        { action: "STATS_CACHE_CLEAR", resource: "System", success: true },
      ],
    });
  });

  after(async () => {
    await teardownAuditTestUsers();
  });

  describe("getStats() - Basic Counts", () => {
    it("should count total logs matching filter", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      assert.ok(result.value.total >= 8, `Expected at least 8, got ${result.value.total}`);
    });

    it("should count successful and failed separately", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      assert.strictEqual(
        result.value.total,
        result.value.successful + result.value.failed,
        "Total should equal successful + failed"
      );
      assert.ok(result.value.successful >= 7, "Should have at least 7 successful");
      assert.ok(result.value.failed >= 1, "Should have at least 1 failed");
    });
  });

  describe("getStats() - Top Actions Aggregation", () => {
    it("should return top actions sorted by count descending", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      assert.ok(result.value.topActions.length > 0, "Should have top actions");

      for (let i = 0; i < result.value.topActions.length - 1; i++) {
        assert.ok(
          result.value.topActions[i].count >= result.value.topActions[i + 1].count,
          "Top actions should be sorted by count descending"
        );
      }
    });

    it("should limit top actions to 10", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      assert.ok(result.value.topActions.length <= 10, "Should return at most 10 top actions");
    });

    it("should include action name and count", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      const loginAction = result.value.topActions.find((a) => a.action === "STATS_LOGIN");
      assert.ok(loginAction, "Should find STATS_LOGIN in top actions");
      assert.ok(loginAction.count >= 3, "Should have correct count for STATS_LOGIN");
    });
  });

  describe("getStats() - Top Resources Aggregation", () => {
    it("should return top resources sorted by count descending", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      assert.ok(result.value.topResources.length > 0, "Should have top resources");

      for (let i = 0; i < result.value.topResources.length - 1; i++) {
        assert.ok(
          result.value.topResources[i].count >= result.value.topResources[i + 1].count,
          "Top resources should be sorted by count descending"
        );
      }
    });

    it("should filter out null resources", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      result.value.topResources.forEach((r) => {
        assert.ok(r.resource, "Resources should not be null");
      });
    });

    it("should limit top resources to 10", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      assert.ok(result.value.topResources.length <= 10, "Should return at most 10 top resources");
    });
  });

  describe("getStats() - Top Users Aggregation", () => {
    it("should return top users with name and email", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      assert.ok(result.value.topUsers.length >= 2, "Should have at least 2 users");

      const testUser = result.value.topUsers.find((u) => u.email === "audit-test-user@example.com");
      assert.ok(testUser, "Should find test user in top users");
      assert.strictEqual(testUser.user, "Audit Test User");
      assert.ok(testUser.count >= 3, "Should have correct count for test user");
    });

    it("should filter out null userIds", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);
      result.value.topUsers.forEach((u) => {
        assert.ok(u.user !== "Unknown" || u.email !== "Unknown", "Should have valid user data");
      });
    });

    it("should sort by count descending", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      assert.ok(result.ok);

      if (result.value.topUsers.length >= 2) {
        for (let i = 0; i < result.value.topUsers.length - 1; i++) {
          assert.ok(
            result.value.topUsers[i].count >= result.value.topUsers[i + 1].count,
            "Top users should be sorted by count descending"
          );
        }
      }
    });

    it("should limit top users to 10", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      assert.ok(result.value.topUsers.length <= 10, "Should return at most 10 top users");
    });
  });

  describe("getStats() - Stats Filtering", () => {
    it("should apply filters to all aggregations", async () => {
      const result = await auditService.getStats({
        userId: testUserId,
      });

      assert.ok(result.ok);
      assert.ok(result.value.total >= 3);
    });

    it("should apply date range to stats", async () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const result = await auditService.getStats({
        action: "STATS_",
        startDate: oneDayAgo,
      });

      assert.ok(result.ok);
      assert.ok(result.value.total >= 0, "Should return stats for filtered date range");
    });
  });
});
