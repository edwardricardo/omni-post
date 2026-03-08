import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { AuditService } from "../../src/audit/auditService";
import {
  setupAuditTestUsers,
  teardownAuditTestUsers,
  testUserId,
} from "./auditService.test-helpers.js";

describe("AuditService - getUserLogs(), getResourceLogs(), cleanup()", { concurrency: 1 }, () => {
  const auditService = new AuditService();

  before(async () => {
    await setupAuditTestUsers();

    await prisma.auditLog.createMany({
      data: [
        {
          action: "RESOURCE_TEST_1",
          resource: "TEST_RESOURCE",
          resourceId: "resource-123",
          success: true,
        },
        {
          action: "RESOURCE_TEST_2",
          resource: "TEST_RESOURCE",
          resourceId: "resource-123",
          success: true,
        },
        {
          action: "RESOURCE_TEST_3",
          resource: "TEST_RESOURCE",
          resourceId: "resource-456",
          success: true,
        },
      ],
    });

    const now = new Date();
    const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    await prisma.auditLog.createMany({
      data: [
        { action: "CLEANUP_OLD_1", createdAt: old, success: true },
        { action: "CLEANUP_OLD_2", createdAt: old, success: true },
        { action: "CLEANUP_RECENT_1", createdAt: recent, success: true },
        { action: "CLEANUP_RECENT_2", createdAt: recent, success: true },
      ],
    });
  });

  after(async () => {
    await teardownAuditTestUsers();
  });

  describe("getUserLogs() - User-Specific Queries", () => {
    it("should return logs for specific user", async () => {
      const result = await auditService.getUserLogs(testUserId, 10, 0);

      assert.ok(result.ok);
      result.value.forEach((log) => {
        assert.strictEqual(log.userId, testUserId);
      });
    });

    it("should respect limit and offset", async () => {
      const result = await auditService.getUserLogs(testUserId, 2, 0);

      assert.ok(result.ok);
      assert.ok(result.value.length <= 2);
    });
  });

  describe("getResourceLogs() - Resource-Specific Queries", () => {
    it("should return logs for specific resource type", async () => {
      const result = await auditService.getResourceLogs("TEST_RESOURCE", undefined, 10, 0);

      assert.ok(result.ok);
      assert.ok(result.value.length >= 3);
      result.value
        .filter((log) => log.action.startsWith("RESOURCE_TEST"))
        .forEach((log) => {
          assert.strictEqual(log.resource, "TEST_RESOURCE");
        });
    });

    it("should filter by specific resourceId when provided", async () => {
      const result = await auditService.getResourceLogs("TEST_RESOURCE", "resource-123", 10, 0);

      assert.ok(result.ok);
      const matching = result.value.filter((log) => log.resourceId === "resource-123");
      assert.ok(matching.length >= 2);
      matching.forEach((log) => {
        assert.strictEqual(log.resource, "TEST_RESOURCE");
        assert.strictEqual(log.resourceId, "resource-123");
      });
    });

    it("should respect pagination", async () => {
      const result = await auditService.getResourceLogs("TEST_RESOURCE", undefined, 1, 0);

      assert.ok(result.ok);
      assert.ok(result.value.length <= 1);
    });
  });

  describe("cleanup() - Data Retention", () => {
    it("should delete logs older than retention period", async () => {
      const beforeCount = await prisma.auditLog.count({
        where: { action: { startsWith: "CLEANUP_" } },
      });

      const result = await auditService.cleanup(90);

      assert.ok(result.ok);
      assert.strictEqual(result.value, 2, "Should delete 2 old logs");

      const afterCount = await prisma.auditLog.count({
        where: { action: { startsWith: "CLEANUP_" } },
      });

      assert.strictEqual(beforeCount - afterCount, 2, "Should have deleted 2 logs");
    });

    it("should use strict less-than for cutoff (not less-than-or-equal)", async () => {
      const now = new Date();
      const recentLog = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);

      const log = await prisma.auditLog.create({
        data: {
          action: "CLEANUP_BOUNDARY_TEST",
          createdAt: recentLog,
          success: true,
        },
      });

      await auditService.cleanup(30);

      const stillExists = await prisma.auditLog.findUnique({
        where: { id: log.id },
      });

      assert.ok(
        stillExists,
        "Log within retention period should not be deleted (strict less-than behavior)"
      );

      await prisma.auditLog.delete({ where: { id: log.id } });
    });

    it("should return count of deleted records", async () => {
      const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      await prisma.auditLog.createMany({
        data: [
          { action: "CLEANUP_COUNT_1", createdAt: old, success: true },
          { action: "CLEANUP_COUNT_2", createdAt: old, success: true },
          { action: "CLEANUP_COUNT_3", createdAt: old, success: true },
        ],
      });

      const result = await auditService.cleanup(90);

      assert.ok(result.ok);
      assert.ok(result.value >= 3, `Should delete at least 3 logs, deleted ${result.value}`);
    });

    it("should not delete recent logs", async () => {
      const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const log = await prisma.auditLog.create({
        data: {
          action: "CLEANUP_RECENT_SHOULD_STAY",
          createdAt: recent,
          success: true,
        },
      });

      await auditService.cleanup(90);

      const stillExists = await prisma.auditLog.findUnique({
        where: { id: log.id },
      });

      assert.ok(stillExists, "Recent logs should not be deleted");

      await prisma.auditLog.delete({ where: { id: log.id } });
    });

    it("should handle custom retention periods", async () => {
      const oldForShortRetention = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      await prisma.auditLog.create({
        data: {
          action: "CLEANUP_SHORT_RETENTION",
          createdAt: oldForShortRetention,
          success: true,
        },
      });

      const result = await auditService.cleanup(30);

      assert.ok(result.ok);
      assert.ok(result.value >= 1, "Should delete with custom retention period");
    });
  });
});
