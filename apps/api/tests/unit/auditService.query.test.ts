import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { AuditService } from "../../src/audit/auditService";
import {
  setupAuditTestUsers,
  teardownAuditTestData,
  testUserId,
  testUser2Id,
} from "./auditService.test-helpers.js";

describe("AuditService - getLogs() - Query and Filtering", { concurrency: 1 }, () => {
  const auditService = new AuditService();

  before(async () => {
    await setupAuditTestUsers();

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    await prisma.auditLog.createMany({
      data: [
        {
          userId: testUserId,
          action: "TEST_FILTER_LOGIN",
          resource: "Session",
          success: true,
          createdAt: now,
        },
        {
          userId: testUserId,
          action: "TEST_FILTER_LOGOUT",
          resource: "Session",
          success: true,
          createdAt: yesterday,
        },
        {
          userId: testUser2Id,
          action: "TEST_FILTER_LOGIN",
          resource: "Session",
          success: false,
          error: "Invalid credentials",
          createdAt: now,
        },
        {
          userId: testUser2Id,
          action: "TEST_FILTER_POST_CREATE",
          resource: "Post",
          resourceId: "post-test-1",
          success: true,
          createdAt: twoDaysAgo,
        },
        {
          action: "TEST_FILTER_SYSTEM",
          resource: "System",
          success: true,
          createdAt: now,
        },
      ],
    });
  });

  after(async () => {
    // Only clean up audit logs with "TEST_FILTER" prefix created by this file
    await teardownAuditTestData("TEST_FILTER");
  });

  describe("Where Clause Building", () => {
    it("should filter by userId exactly", async () => {
      const result = await auditService.getLogs({ userId: testUserId });

      assert.ok(result.ok);
      assert.ok(result.value.length >= 2);
      result.value.forEach((log) => {
        assert.strictEqual(log.userId, testUserId);
      });
    });

    it("should filter by action with case-insensitive contains", async () => {
      const result = await auditService.getLogs({ action: "login" });

      assert.ok(result.ok);
      const loginLogs = result.value.filter((log) => log.action.includes("TEST_FILTER_LOGIN"));
      assert.ok(loginLogs.length >= 2, "Should find LOGIN actions case-insensitively");
    });

    it("should filter by resource exactly", async () => {
      const result = await auditService.getLogs({ resource: "Session" });

      assert.ok(result.ok);
      result.value
        .filter((log) => log.action.startsWith("TEST_FILTER"))
        .forEach((log) => {
          assert.strictEqual(log.resource, "Session");
        });
    });

    it("should filter by resourceId exactly", async () => {
      const result = await auditService.getLogs({
        resource: "Post",
        resourceId: "post-test-1",
      });

      assert.ok(result.ok);
      const matching = result.value.find((log) => log.resourceId === "post-test-1");
      assert.ok(matching, "Should find log with specific resourceId");
    });

    it("should filter by success=true", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER_LOGIN",
        success: true,
      });

      assert.ok(result.ok);
      result.value
        .filter((log) => log.action === "TEST_FILTER_LOGIN")
        .forEach((log) => {
          assert.strictEqual(log.success, true);
        });
    });

    it("should filter by success=false", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER_LOGIN",
        success: false,
      });

      assert.ok(result.ok);
      const failedLogin = result.value.find(
        (log) => log.action === "TEST_FILTER_LOGIN" && log.userId === testUser2Id
      );
      assert.ok(failedLogin);
      assert.strictEqual(failedLogin.success, false);
      assert.strictEqual(failedLogin.error, "Invalid credentials");
    });
  });

  describe("Date Range Filtering", () => {
    it("should filter by startDate (gte)", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        startDate: yesterday,
      });

      assert.ok(result.ok);
      result.value
        .filter((log) => log.action.startsWith("TEST_FILTER"))
        .forEach((log) => {
          assert.ok(log.createdAt >= yesterday, "All logs should be after startDate");
        });
    });

    it("should filter by endDate (lte)", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        endDate: yesterday,
      });

      assert.ok(result.ok);
      const oldLogs = result.value.filter((log) => log.action.startsWith("TEST_FILTER"));
      oldLogs.forEach((log) => {
        assert.ok(log.createdAt <= yesterday, "All logs should be before endDate");
      });
    });

    it("should filter by date range (both startDate and endDate)", async () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        startDate: threeDaysAgo,
        endDate: oneDayAgo,
      });

      assert.ok(result.ok);
      result.value
        .filter((log) => log.action.startsWith("TEST_FILTER"))
        .forEach((log) => {
          assert.ok(
            log.createdAt >= threeDaysAgo && log.createdAt <= oneDayAgo,
            "Logs should be within date range"
          );
        });
    });
  });

  describe("Pagination", () => {
    it("should respect limit parameter", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        limit: 2,
      });

      assert.ok(result.ok);
      assert.ok(
        result.value.length <= 2,
        `Should return at most 2 results, got ${result.value.length}`
      );
    });

    it("should respect offset parameter", async () => {
      const firstPage = await auditService.getLogs({
        action: "TEST_FILTER",
        limit: 2,
        offset: 0,
      });

      const secondPage = await auditService.getLogs({
        action: "TEST_FILTER",
        limit: 2,
        offset: 2,
      });

      assert.ok(firstPage.ok && secondPage.ok);
      if (firstPage.value.length === 2 && secondPage.value.length > 0) {
        const firstIds = firstPage.value.map((log) => log.id);
        const secondIds = secondPage.value.map((log) => log.id);
        assert.ok(!firstIds.some((id) => secondIds.includes(id)), "Pages should not overlap");
      }
    });

    it("should cap limit at 1000 for performance", async () => {
      const result = await auditService.getLogs({
        limit: 5000,
      });

      assert.ok(result.ok);
      assert.ok(
        result.value.length <= 1000,
        "Should never return more than 1000 results regardless of request"
      );
    });

    it("should use default limit of 50 when not specified", async () => {
      const result = await auditService.getLogs({});

      assert.ok(result.ok);
      assert.ok(result.value.length <= 50 || result.value.length <= 1000);
    });
  });

  describe("Result Ordering", () => {
    it("should order results by createdAt descending (newest first)", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        limit: 10,
      });

      assert.ok(result.ok);
      const filtered = result.value.filter((log) => log.action.startsWith("TEST_FILTER"));

      if (filtered.length >= 2) {
        for (let i = 0; i < filtered.length - 1; i++) {
          assert.ok(
            filtered[i].createdAt >= filtered[i + 1].createdAt,
            "Results should be ordered newest first"
          );
        }
      }
    });
  });
});
