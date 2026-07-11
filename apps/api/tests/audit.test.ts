/**
 * @file audit.test.ts
 * @description Tests for Audit System
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuditService, AuditActions, AuditResources } from "../src/audit/auditService.js";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/admin/auth/MfaService.js";
import { PrismaAdminMfaUserRepository } from "../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaRoleRepository } from "../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAdminSessionRepository } from "../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/PrismaAuditLogRepository.js";

const auditService = new AuditService(prisma);
const adminUserRepo = new PrismaAdminUserRepository(prisma);
const roleRepo = new PrismaRoleRepository(prisma);
const sessionRepo = new PrismaAdminSessionRepository(prisma);
const mfaService = new MfaService(
  new PrismaAdminMfaUserRepository(prisma),
  new PrismaCustomerMfaUserRepository(prisma),
  new PrismaAuditLogRepository(prisma)
);
const authService = new AuthService(
  prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new PrismaAuditLogRepository(prisma)
);

describe("Audit System", () => {
  let testUserId: string;
  const testAuditLogIds: string[] = [];
  const testUserEmails: string[] = [];

  after(async () => {
    // Cleanup test data
    try {
      // Delete test users
      if (testUserEmails.length > 0) {
        await prisma.adminUser.deleteMany({
          where: {
            email: {
              in: testUserEmails,
            },
          },
        });
      }

      // Clean up test audit logs
      if (testAuditLogIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: {
            id: {
              in: testAuditLogIds,
            },
          },
        });
      }

      // Clean up specific test logs
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { action: { contains: "TEST" } },
            { details: { path: ["configKey"], equals: "test_setting" } },
            { resourceId: "test-resource-123" },
          ],
        },
      });
    } catch (error) {
      console.warn("Cleanup warning:", error);
    }
  });

  describe("Basic Audit Logging", () => {
    it("should create audit log entry", async () => {
      const logResult = await auditService.log({
        action: AuditActions.SYSTEM_CONFIG_CHANGED,
        resource: AuditResources.SYSTEM,
        details: {
          configKey: "test_setting",
          oldValue: "old",
          newValue: "new",
        },
        ipAddress: "127.0.0.1",
        userAgent: "Test-Agent",
        success: true,
      });

      assert.ok(logResult.ok, `Failed to create audit log: ${logResult.ok ? "" : logResult.error}`);
      if (!logResult.ok) return;
      assert.ok(logResult.value.id, "Audit log should have an ID");
      assert.strictEqual(
        logResult.value.action,
        AuditActions.SYSTEM_CONFIG_CHANGED,
        "Action should match"
      );
      assert.strictEqual(logResult.value.resource, AuditResources.SYSTEM, "Resource should match");

      testAuditLogIds.push(logResult.value.id);
    });
  });

  describe("Audit with Authentication", () => {
    it("should create audit logs during user registration and login", async () => {
      const email = `audit-test-${Date.now()}@example.com`;
      testUserEmails.push(email);

      // Register a test user (this should create audit logs)
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "Audit Test User",
        "ADMIN"
      );

      assert.ok(
        registerResult.ok,
        `Failed to register user: ${registerResult.ok ? "" : registerResult.error}`
      );
      if (!registerResult.ok) return;
      testUserId = registerResult.value.id;

      // Login the user (this should create more audit logs)
      const loginResult = await authService.login(
        { email, password: "password123" },
        "127.0.0.1",
        "Test-Browser"
      );

      assert.ok(loginResult.ok, `Failed to login: ${loginResult.ok ? "" : loginResult.error}`);

      // Get user's audit logs
      const userLogsResult = await auditService.getUserLogs(testUserId, 10);

      assert.ok(
        userLogsResult.ok,
        `Failed to get user logs: ${userLogsResult.ok ? "" : userLogsResult.error}`
      );
      if (!userLogsResult.ok) return;
      assert.ok(userLogsResult.value.length > 0, "Should have at least one audit log for user");
    });
  });

  describe("Audit Filtering", () => {
    before(async () => {
      // Create several test logs with different actions
      const testLogs = [
        { action: AuditActions.LOGIN, success: true },
        { action: AuditActions.LOGIN_FAILED, success: false },
        { action: AuditActions.USER_CREATED, success: true },
        { action: AuditActions.LOGOUT, success: true },
      ];

      for (const logData of testLogs) {
        const result = await auditService.log({
          action: logData.action,
          resource: AuditResources.USER,
          success: logData.success,
          ipAddress: "127.0.0.1",
        });

        if (result.ok) {
          testAuditLogIds.push(result.value.id);
        }
      }
    });

    it("should filter logs by success status", async () => {
      const successLogsResult = await auditService.getLogs({ success: true, limit: 100 });
      const failedLogsResult = await auditService.getLogs({ success: false, limit: 100 });

      assert.ok(successLogsResult.ok, "Should retrieve successful logs");
      assert.ok(failedLogsResult.ok, "Should retrieve failed logs");
      if (!successLogsResult.ok || !failedLogsResult.ok) return;

      assert.ok(successLogsResult.value.length > 0, "Should have successful logs");
      assert.ok(failedLogsResult.value.length > 0, "Should have failed logs");

      // Verify all results match the filter
      successLogsResult.value.forEach((log) => {
        assert.strictEqual(log.success, true, "All logs should be successful");
      });

      failedLogsResult.value.forEach((log) => {
        assert.strictEqual(log.success, false, "All logs should be failed");
      });
    });

    it("should filter logs by date range", async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentLogsResult = await auditService.getLogs({
        startDate: oneHourAgo,
        limit: 100,
      });

      assert.ok(
        recentLogsResult.ok,
        `Failed to filter by date: ${recentLogsResult.ok ? "" : recentLogsResult.error}`
      );
      if (!recentLogsResult.ok) return;
      assert.ok(recentLogsResult.value.length > 0, "Should have recent logs");

      // Verify all logs are within date range
      recentLogsResult.value.forEach((log) => {
        assert.ok(log.createdAt >= oneHourAgo, "All logs should be from last hour");
      });
    });
  });

  describe("Audit Statistics", () => {
    it("should retrieve audit statistics", async () => {
      const statsResult = await auditService.getStats();

      assert.ok(
        statsResult.ok,
        `Failed to get statistics: ${statsResult.ok ? "" : statsResult.error}`
      );
      if (!statsResult.ok) return;

      const stats = statsResult.value;
      assert.ok(stats.total > 0, "Should have total logs");
      assert.ok(stats.successful >= 0, "Should have successful count");
      assert.ok(stats.failed >= 0, "Should have failed count");
      assert.ok(Array.isArray(stats.topActions), "Should have top actions array");
      assert.ok(Array.isArray(stats.topResources), "Should have top resources array");
      assert.ok(Array.isArray(stats.topUsers), "Should have top users array");
    });
  });

  describe("Data Retention", () => {
    it("should clean up old audit logs", async () => {
      // Create an old audit log by directly inserting into database
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const oldLog = await prisma.auditLog.create({
        data: {
          action: "OLD_TEST_ACTION",
          success: true,
          createdAt: oldDate,
        },
      });

      // Test cleanup with 90-day retention
      const cleanupResult = await auditService.cleanup(90);

      assert.ok(
        cleanupResult.ok,
        `Failed to cleanup old logs: ${cleanupResult.ok ? "" : cleanupResult.error}`
      );
      if (!cleanupResult.ok) return;
      assert.ok(cleanupResult.value >= 1, "Should have removed at least one old log");

      // Verify old log was deleted
      const deletedLog = await prisma.auditLog.findUnique({
        where: { id: oldLog.id },
      });

      assert.strictEqual(deletedLog, null, "Old log should be deleted");
    });
  });

  describe("Resource-Specific Audit Logging", () => {
    it("should create and retrieve resource-specific audit logs", async () => {
      const testResourceId = "test-resource-123";

      // Create logs for a specific resource
      const createResult = await auditService.log({
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        resourceId: testResourceId,
        details: {
          title: "Test Post",
          projectId: "test-project",
        },
        success: true,
      });

      assert.ok(createResult.ok, "Should create resource audit log");
      if (!createResult.ok) return;
      testAuditLogIds.push(createResult.value.id);

      const updateResult = await auditService.log({
        action: AuditActions.POST_UPDATED,
        resource: AuditResources.POST,
        resourceId: testResourceId,
        details: {
          changes: ["title", "body"],
        },
        success: true,
      });

      assert.ok(updateResult.ok, "Should create update audit log");
      if (!updateResult.ok) return;
      testAuditLogIds.push(updateResult.value.id);

      // Get logs for the specific resource
      const resourceLogsResult = await auditService.getResourceLogs(
        AuditResources.POST,
        testResourceId,
        10
      );

      assert.ok(
        resourceLogsResult.ok,
        `Failed to get resource logs: ${resourceLogsResult.ok ? "" : resourceLogsResult.error}`
      );
      if (!resourceLogsResult.ok) return;
      assert.ok(
        resourceLogsResult.value.length >= 2,
        "Should have at least 2 resource-specific logs"
      );

      // Verify all logs are for the correct resource
      resourceLogsResult.value.forEach((log) => {
        assert.strictEqual(log.resource, AuditResources.POST, "Should be POST resource");
        assert.strictEqual(log.resourceId, testResourceId, "Should have correct resource ID");
      });
    });
  });
});
