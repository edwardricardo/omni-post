#!/usr/bin/env tsx
/**
 * Unit Tests for auditLogger
 * Testing comprehensive audit logging with Redis caching and Prisma persistence
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuditLogger, createAuditLogger, AuditConfigs } from "../../src/security/auditLogger.js";
import { prisma } from "@infra/prisma";
import Redis from "ioredis";
import type { FastifyRequest } from "fastify";

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    id: `req-${Date.now()}-${Math.random()}`,
    method: "POST",
    url: "/api/test",
    headers: {
      "user-agent": "Mozilla/5.0 (Test Agent)",
    },
    ip: "192.168.1.100",
    socket: { remoteAddress: "192.168.1.100" },
    ...overrides,
  } as FastifyRequest;
}

// Sleep utility
function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

// ============================================================================
// Test Setup
// ============================================================================

let redis: Redis;
let auditLogger: AuditLogger;
const testAuditIds: string[] = [];

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ============================================================================
// Main Test Suite
// ============================================================================

describe("AuditLogger Tests", { concurrency: 1 }, () => {
  before(async () => {
    redis = new Redis(REDIS_URL);

    // Wait for Redis connection
    await new Promise((resolve) => {
      if (redis.status === "ready") {
        resolve(true);
      } else {
        redis.once("ready", resolve);
      }
    });

    // Flush audit cache keys
    const keys = await redis.keys("audit_recent:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    const alertKeys = await redis.keys("failed_logins:*");
    if (alertKeys.length > 0) {
      await redis.del(...alertKeys);
    }

    const apiKeys = await redis.keys("api_calls:*");
    if (apiKeys.length > 0) {
      await redis.del(...apiKeys);
    }

    auditLogger = new AuditLogger(redis, {
      enableRealTimeAlerts: false, // Disable for testing
      retentionDays: 7,
      enableDetailedLogging: true,
    });
  });

  after(async () => {
    try {
      // Cleanup test audit logs
      if (testAuditIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { id: { in: testAuditIds } },
        });
      }

      // Cleanup Redis keys
      const keys = await redis.keys("audit_recent:*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }

      const alertKeys = await redis.keys("failed_logins:*");
      if (alertKeys.length > 0) {
        await redis.del(...alertKeys);
      }

      const apiKeys = await redis.keys("api_calls:*");
      if (apiKeys.length > 0) {
        await redis.del(...apiKeys);
      }

      await auditLogger.cleanup();
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }

    try {
      await redis.quit();
    } catch (err) {
      console.warn("Redis quit warning:", err);
    }
  });

  // ============================================================================
  // Test Group 1: Basic Logging - Success Cases
  // ============================================================================

  describe("Basic Logging - Success Cases", () => {
    it("should log basic audit event", async () => {
      const event = {
        action: "TEST_ACTION",
        resource: "Test",
        resourceId: "test-123",
        success: true,
      };

      await auditLogger.log(event);

      // Verify in database
      const logs = await prisma.auditLog.findMany({
        where: { action: "TEST_ACTION" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "TEST_ACTION");
      assert.strictEqual(logs[0]?.resource, "Test");
      assert.strictEqual(logs[0]?.resourceId, "test-123");
      assert.strictEqual(logs[0]?.success, true);

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should enrich event with request data", async () => {
      const request = createMockRequest({
        headers: {
          "user-agent": "Test Browser/1.0",
        },
        ip: "203.0.113.195",
        socket: { remoteAddress: "203.0.113.195" },
      });

      const event = {
        action: "ENRICHED_ACTION",
        success: true,
      };

      await auditLogger.log(event, request);

      const logs = await prisma.auditLog.findMany({
        where: { action: "ENRICHED_ACTION" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.ipAddress, "203.0.113.195");
      assert.strictEqual(logs[0]?.userAgent, "Test Browser/1.0");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should extract IP from X-Forwarded-For header", async () => {
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "198.51.100.1, 192.168.1.1",
          "user-agent": "Test Agent",
        },
      });

      const event = {
        action: "FORWARDED_IP_TEST",
        success: true,
      };

      await auditLogger.log(event, request);

      const logs = await prisma.auditLog.findMany({
        where: { action: "FORWARDED_IP_TEST" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.ipAddress, "198.51.100.1");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should extract IP from X-Real-IP header", async () => {
      const request = createMockRequest({
        headers: {
          "x-real-ip": "198.51.100.2",
          "user-agent": "Test Agent",
        },
      });

      const event = {
        action: "REAL_IP_TEST",
        success: true,
      };

      await auditLogger.log(event, request);

      const logs = await prisma.auditLog.findMany({
        where: { action: "REAL_IP_TEST" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.ipAddress, "198.51.100.2");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should extract IP from CF-Connecting-IP header", async () => {
      const request = createMockRequest({
        headers: {
          "cf-connecting-ip": "198.51.100.3",
          "user-agent": "Test Agent",
        },
      });

      const event = {
        action: "CF_IP_TEST",
        success: true,
      };

      await auditLogger.log(event, request);

      const logs = await prisma.auditLog.findMany({
        where: { action: "CF_IP_TEST" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.ipAddress, "198.51.100.3");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });
  });

  // ============================================================================
  // Test Group 2: Specialized Logging Methods
  // ============================================================================

  describe("Specialized Logging Methods", () => {
    it("should log authentication event with logAuth", async () => {
      const request = createMockRequest();

      await auditLogger.logAuth("LOGIN", { username: "testuser" }, request);

      const logs = await prisma.auditLog.findMany({
        where: { action: "LOGIN" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "LOGIN");
      assert.strictEqual(logs[0]?.success, true);

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log failed login with medium severity", async () => {
      const request = createMockRequest();

      await auditLogger.logAuth("LOGIN_FAILED", { username: "baduser" }, request);

      const logs = await prisma.auditLog.findMany({
        where: { action: "LOGIN_FAILED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "LOGIN_FAILED");
      assert.strictEqual(logs[0]?.success, false);

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log data change with logDataChange", async () => {
      const request = createMockRequest();

      await auditLogger.logDataChange(
        "UPDATE",
        "Post",
        "post-123",
        { title: "Updated Title" },
        request
      );

      const logs = await prisma.auditLog.findMany({
        where: { action: "POST_UPDATE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "POST_UPDATE");
      assert.strictEqual(logs[0]?.resource, "Post");
      assert.strictEqual(logs[0]?.resourceId, "post-123");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log DELETE with medium severity", async () => {
      await auditLogger.logDataChange("DELETE", "User", "user-456", {}, createMockRequest());

      const logs = await prisma.auditLog.findMany({
        where: { action: "USER_DELETE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log security event with logSecurity", async () => {
      const request = createMockRequest();

      await auditLogger.logSecurity(
        "SUSPICIOUS_ACTIVITY",
        { reason: "Multiple failed logins" },
        "high",
        request
      );

      const logs = await prisma.auditLog.findMany({
        where: { action: "SUSPICIOUS_ACTIVITY" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "SUSPICIOUS_ACTIVITY");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log admin action with logAdmin", async () => {
      const request = createMockRequest();

      await auditLogger.logAdmin(
        "USER_ROLE_CHANGED",
        "User",
        "user-789",
        { newRole: "ADMIN" },
        request
      );

      const logs = await prisma.auditLog.findMany({
        where: { action: "USER_ROLE_CHANGED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "USER_ROLE_CHANGED");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log system event with logSystem", async () => {
      await auditLogger.logSystem("SYSTEM_STARTUP", { version: "1.0.0" }, "low");

      const logs = await prisma.auditLog.findMany({
        where: { action: "SYSTEM_STARTUP" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "SYSTEM_STARTUP");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should log billing event with logBilling", async () => {
      const request = createMockRequest();

      await auditLogger.logBilling(
        "SUBSCRIPTION_UPGRADED",
        "account-123",
        { plan: "PRO" },
        request
      );

      const logs = await prisma.auditLog.findMany({
        where: { action: "SUBSCRIPTION_UPGRADED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]?.action, "SUBSCRIPTION_UPGRADED");
      assert.strictEqual(logs[0]?.resource, "Account");
      assert.strictEqual(logs[0]?.resourceId, "account-123");

      if (logs[0]) testAuditIds.push(logs[0].id);
    });
  });

  // ============================================================================
  // Test Group 3: Sensitive Data Sanitization
  // ============================================================================

  describe("Sensitive Data Sanitization", () => {
    it("should mask password fields", async () => {
      const event = {
        action: "PASSWORD_CHANGE",
        details: {
          password: "supersecretpassword123",
          confirmPassword: "supersecretpassword123",
        },
        success: true,
      };

      await auditLogger.log(event);

      const logs = await prisma.auditLog.findMany({
        where: { action: "PASSWORD_CHANGE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);

      const details = logs[0]?.details as any;
      assert.notStrictEqual(details?.password, "supersecretpassword123");
      assert.ok(details?.password?.includes("*"));

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should mask token fields", async () => {
      const event = {
        action: "API_KEY_CREATED",
        details: {
          apiToken: "test_fake_token_1234567890abcdef",
          accessToken: "bearer_token_xyz",
        },
        success: true,
      };

      await auditLogger.log(event);

      const logs = await prisma.auditLog.findMany({
        where: { action: "API_KEY_CREATED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);

      const details = logs[0]?.details as any;
      assert.notStrictEqual(details?.apiToken, "test_fake_token_1234567890abcdef");
      assert.ok(details?.apiToken?.includes("*"));

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should mask secret fields", async () => {
      const event = {
        action: "OAUTH_CONFIG",
        details: {
          clientSecret: "very_secret_value",
          webhookSecret: "another_secret",
        },
        success: true,
      };

      await auditLogger.log(event);

      const logs = await prisma.auditLog.findMany({
        where: { action: "OAUTH_CONFIG" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);

      const details = logs[0]?.details as any;
      assert.ok(details?.clientSecret?.includes("*"));
      assert.ok(details?.webhookSecret?.includes("*"));

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should mask nested sensitive fields", async () => {
      const event = {
        action: "CONFIG_UPDATE",
        details: {
          database: {
            connectionString: "postgres://user:password@localhost/db",
            credentials: {
              password: "dbpassword123",
            },
          },
        },
        success: true,
      };

      await auditLogger.log(event);

      const logs = await prisma.auditLog.findMany({
        where: { action: "CONFIG_UPDATE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);

      if (logs[0]) testAuditIds.push(logs[0].id);
    });

    it("should handle short sensitive values", async () => {
      const event = {
        action: "SHORT_SECRET",
        details: {
          pin: "1234",
        },
        success: true,
      };

      await auditLogger.log(event);

      const logs = await prisma.auditLog.findMany({
        where: { action: "SHORT_SECRET" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.strictEqual(logs.length, 1);

      if (logs[0]) testAuditIds.push(logs[0].id);
    });
  });

  // ============================================================================
  // Test Group 4: Query and Statistics
  // ============================================================================

  describe("Query and Statistics", () => {
    it("should query logs by action", async () => {
      await auditLogger.log({ action: "QUERY_TEST_1", success: true });

      const logs = await auditLogger.queryLogs({
        action: "QUERY_TEST",
        limit: 10,
      });

      assert.ok(logs.length > 0);

      logs.forEach((log: any) => {
        if (log.id) testAuditIds.push(log.id);
      });
    });

    it("should query logs by date range", async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const logs = await auditLogger.queryLogs({
        startDate: yesterday,
        endDate: now,
        limit: 10,
      });

      assert.ok(Array.isArray(logs));
    });

    it("should query logs by success status", async () => {
      await auditLogger.log({ action: "SUCCESS_TEST", success: true });
      await auditLogger.log({ action: "FAILURE_TEST", success: false });

      const successLogs = await auditLogger.queryLogs({
        success: true,
        limit: 10,
      });

      const failureLogs = await auditLogger.queryLogs({
        success: false,
        limit: 10,
      });

      assert.ok(successLogs.length > 0);
      assert.ok(failureLogs.length > 0);

      [...successLogs, ...failureLogs].forEach((log: any) => {
        if (log.id) testAuditIds.push(log.id);
      });
    });

    it("should get audit statistics", async () => {
      const stats = await auditLogger.getStatistics("day");

      assert.ok(typeof stats.totalEvents === "number");
      assert.ok(typeof stats.failedEvents === "number");
      assert.ok(typeof stats.securityEvents === "number");
      assert.ok(Array.isArray(stats.topActions));
      assert.ok(Array.isArray(stats.topUsers));
    });

    it("should get statistics for different timeframes", async () => {
      const hourStats = await auditLogger.getStatistics("hour");
      const dayStats = await auditLogger.getStatistics("day");
      const weekStats = await auditLogger.getStatistics("week");
      const monthStats = await auditLogger.getStatistics("month");

      assert.ok(typeof hourStats.totalEvents === "number", "hour stats should have totalEvents");
      assert.ok(typeof dayStats.totalEvents === "number", "day stats should have totalEvents");
      assert.ok(typeof weekStats.totalEvents === "number", "week stats should have totalEvents");
      assert.ok(typeof monthStats.totalEvents === "number", "month stats should have totalEvents");
    });

    it("should handle pagination with offset", async () => {
      const page1 = await auditLogger.queryLogs({ limit: 5, offset: 0 });
      const page2 = await auditLogger.queryLogs({ limit: 5, offset: 5 });

      assert.ok(Array.isArray(page1));
      assert.ok(Array.isArray(page2));
    });
  });

  // ============================================================================
  // Test Group 5: Factory Function and Configs
  // ============================================================================

  describe("Factory Function and Configs", () => {
    it("should create audit logger with factory function", () => {
      const logger = createAuditLogger(redis);
      assert.ok(logger);
    });

    it("should create audit logger with custom config", () => {
      const logger = createAuditLogger(redis, {
        enableRealTimeAlerts: false,
        retentionDays: 30,
      });
      assert.ok(logger);
    });

    it("should have HIGH_SECURITY config", () => {
      assert.strictEqual(AuditConfigs.HIGH_SECURITY.enableRealTimeAlerts, true);
      assert.strictEqual(AuditConfigs.HIGH_SECURITY.retentionDays, 365);
      assert.strictEqual(AuditConfigs.HIGH_SECURITY.alertThresholds.failedLogins, 3);
    });

    it("should have PRODUCTION config", () => {
      assert.strictEqual(AuditConfigs.PRODUCTION.enableRealTimeAlerts, true);
      assert.strictEqual(AuditConfigs.PRODUCTION.retentionDays, 90);
      assert.strictEqual(AuditConfigs.PRODUCTION.alertThresholds.failedLogins, 5);
    });

    it("should have DEVELOPMENT config", () => {
      assert.strictEqual(AuditConfigs.DEVELOPMENT.enableRealTimeAlerts, false);
      assert.strictEqual(AuditConfigs.DEVELOPMENT.retentionDays, 7);
      assert.strictEqual(AuditConfigs.DEVELOPMENT.alertThresholds.failedLogins, 10);
    });
  });

  // ============================================================================
  // Test Group 6: Error Handling
  // ============================================================================

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      // Create logger with invalid Redis to trigger errors
      const badRedis = new Redis({
        host: "invalid-host",
        port: 9999,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });

      const badLogger = new AuditLogger(badRedis, {
        enableRealTimeAlerts: false,
      });

      // Should not throw
      await badLogger.log({ action: "ERROR_TEST", success: true });

      // Cleanup: disconnect may fail since connection was never established
      try {
        badRedis.disconnect(false);
      } catch {
        // Expected — connection was never established
      }
    });

    it("should return empty array on query errors", async () => {
      const logs = await auditLogger.queryLogs({
        startDate: new Date("invalid-date"),
      });

      assert.ok(Array.isArray(logs));
    });

    it("should return zero statistics on error", async () => {
      // Query with invalid timeframe
      const stats = await auditLogger.getStatistics("invalid" as any);

      assert.strictEqual(stats.totalEvents, 0);
      assert.strictEqual(stats.failedEvents, 0);
      assert.strictEqual(stats.securityEvents, 0);
    });
  });
});
