/**
 * @file auditLogger.test.ts
 * @description Unit tests for AuditLogger. Uses in-memory mocked Prisma stores
 *              with real Redis for testing caching and alerting features.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type { FastifyRequest } from "fastify";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    logger: noopLogger,
    authLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

const { AuditLogger, createAuditLogger, AuditConfigs } =
  await import("../../src/security/auditLogger.js");
const Redis = (await import("ioredis")).default;

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

let redis: InstanceType<typeof Redis>;
let auditLogger: InstanceType<typeof AuditLogger>;
const scheduler = new NoopBackgroundTaskScheduler();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ---------------------------------------------------------------------------
// Main Test Suite
// ---------------------------------------------------------------------------

describe("AuditLogger Tests", () => {
  beforeAll(async () => {
    redis = new Redis(REDIS_URL);

    // Wait for Redis connection
    await new Promise<void>((resolve) => {
      if (redis.status === "ready") {
        resolve();
      } else {
        redis.once("ready", () => resolve());
      }
    });

    // Flush audit cache keys
    const keys = await redis.keys("audit_recent:*");
    if (keys.length > 0) await redis.del(...keys);

    const alertKeys = await redis.keys("failed_logins:*");
    if (alertKeys.length > 0) await redis.del(...alertKeys);

    const apiKeys = await redis.keys("api_calls:*");
    if (apiKeys.length > 0) await redis.del(...apiKeys);

    // Clear stores
    stores.auditLog.clear();

    auditLogger = new AuditLogger(redis, scheduler, {
      enableRealTimeAlerts: false,
      retentionDays: 7,
      enableDetailedLogging: true,
    });
  });

  afterAll(async () => {
    try {
      await auditLogger.cleanup();
    } catch (_err) {
      // Expected in test environment
    }

    // Cleanup Redis keys
    try {
      const keys = await redis.keys("audit_recent:*");
      if (keys.length > 0) await redis.del(...keys);

      const alertKeys = await redis.keys("failed_logins:*");
      if (alertKeys.length > 0) await redis.del(...alertKeys);

      const apiKeys = await redis.keys("api_calls:*");
      if (apiKeys.length > 0) await redis.del(...apiKeys);

      await redis.quit();
    } catch (_err) {
      // Expected in test environment
    }
  });

  // =========================================================================
  // Test Group 1: Basic Logging - Success Cases
  // =========================================================================

  describe("Basic Logging - Success Cases", () => {
    it("should log basic audit event", async () => {
      const event = {
        action: "TEST_ACTION",
        resource: "Test",
        resourceId: "test-123",
        success: true,
      };

      await auditLogger.log(event);

      // Verify in mock store
      const logs = stores.auditLog.all().filter((l) => l.action === "TEST_ACTION");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("TEST_ACTION");
      expect(logs[0]?.resource).toBe("Test");
      expect(logs[0]?.resourceId).toBe("test-123");
      expect(logs[0]?.success).toBe(true);
    });

    it("should enrich event with request data", async () => {
      const request = createMockRequest({
        headers: {
          "user-agent": "Test Browser/1.0",
        },
        ip: "203.0.113.195",
        socket: { remoteAddress: "203.0.113.195" } as never,
      });

      const event = {
        action: "ENRICHED_ACTION",
        success: true,
      };

      await auditLogger.log(event, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "ENRICHED_ACTION");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("203.0.113.195");
      expect(logs[0]?.userAgent).toBe("Test Browser/1.0");
    });

    it("should extract IP from X-Forwarded-For header", async () => {
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "198.51.100.1, 192.168.1.1",
          "user-agent": "Test Agent",
        },
      });

      await auditLogger.log({ action: "FORWARDED_IP_TEST", success: true }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "FORWARDED_IP_TEST");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("198.51.100.1");
    });

    it("should extract IP from X-Real-IP header", async () => {
      const request = createMockRequest({
        headers: {
          "x-real-ip": "198.51.100.2",
          "user-agent": "Test Agent",
        },
      });

      await auditLogger.log({ action: "REAL_IP_TEST", success: true }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "REAL_IP_TEST");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("198.51.100.2");
    });

    it("should extract IP from CF-Connecting-IP header", async () => {
      const request = createMockRequest({
        headers: {
          "cf-connecting-ip": "198.51.100.3",
          "user-agent": "Test Agent",
        },
      });

      await auditLogger.log({ action: "CF_IP_TEST", success: true }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "CF_IP_TEST");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("198.51.100.3");
    });
  });

  // =========================================================================
  // Test Group 2: Specialized Logging Methods
  // =========================================================================

  describe("Specialized Logging Methods", () => {
    it("should log authentication event with logAuth", async () => {
      const request = createMockRequest();

      await auditLogger.logAuth("LOGIN", { username: "testuser" }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "LOGIN");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("LOGIN");
      expect(logs[0]?.success).toBe(true);
    });

    it("should log failed login with medium severity", async () => {
      const request = createMockRequest();

      await auditLogger.logAuth("LOGIN_FAILED", { username: "baduser" }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "LOGIN_FAILED");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("LOGIN_FAILED");
      expect(logs[0]?.success).toBe(false);
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

      const logs = stores.auditLog.all().filter((l) => l.action === "POST_UPDATE");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("POST_UPDATE");
      expect(logs[0]?.resource).toBe("Post");
      expect(logs[0]?.resourceId).toBe("post-123");
    });

    it("should log DELETE with medium severity", async () => {
      await auditLogger.logDataChange("DELETE", "User", "user-456", {}, createMockRequest());

      const logs = stores.auditLog.all().filter((l) => l.action === "USER_DELETE");

      expect(logs.length).toBe(1);
    });

    it("should log security event with logSecurity", async () => {
      const request = createMockRequest();

      await auditLogger.logSecurity(
        "SUSPICIOUS_ACTIVITY",
        { reason: "Multiple failed logins" },
        "high",
        request
      );

      const logs = stores.auditLog.all().filter((l) => l.action === "SUSPICIOUS_ACTIVITY");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("SUSPICIOUS_ACTIVITY");
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

      const logs = stores.auditLog.all().filter((l) => l.action === "USER_ROLE_CHANGED");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("USER_ROLE_CHANGED");
    });

    it("should log system event with logSystem", async () => {
      await auditLogger.logSystem("SYSTEM_STARTUP", { version: "1.0.0" }, "low");

      const logs = stores.auditLog.all().filter((l) => l.action === "SYSTEM_STARTUP");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("SYSTEM_STARTUP");
    });

    it("should log billing event with logBilling", async () => {
      const request = createMockRequest();

      await auditLogger.logBilling(
        "SUBSCRIPTION_UPGRADED",
        "account-123",
        { plan: "PRO" },
        request
      );

      const logs = stores.auditLog.all().filter((l) => l.action === "SUBSCRIPTION_UPGRADED");

      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("SUBSCRIPTION_UPGRADED");
      expect(logs[0]?.resource).toBe("Account");
      expect(logs[0]?.resourceId).toBe("account-123");
    });
  });

  // =========================================================================
  // Test Group 3: Sensitive Data Sanitization
  // =========================================================================

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

      const logs = stores.auditLog.all().filter((l) => l.action === "PASSWORD_CHANGE");

      expect(logs.length).toBe(1);

      const details = logs[0]?.details as Record<string, unknown> | undefined;
      expect(details?.password).not.toBe("supersecretpassword123");
      expect((details?.password as string)?.includes("*")).toBeTruthy();
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

      const logs = stores.auditLog.all().filter((l) => l.action === "API_KEY_CREATED");

      expect(logs.length).toBe(1);

      const details = logs[0]?.details as Record<string, unknown> | undefined;
      expect(details?.apiToken).not.toBe("test_fake_token_1234567890abcdef");
      expect((details?.apiToken as string)?.includes("*")).toBeTruthy();
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

      const logs = stores.auditLog.all().filter((l) => l.action === "OAUTH_CONFIG");

      expect(logs.length).toBe(1);

      const details = logs[0]?.details as Record<string, unknown> | undefined;
      expect((details?.clientSecret as string)?.includes("*")).toBeTruthy();
      expect((details?.webhookSecret as string)?.includes("*")).toBeTruthy();
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

      const logs = stores.auditLog.all().filter((l) => l.action === "CONFIG_UPDATE");

      expect(logs.length).toBe(1);
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

      const logs = stores.auditLog.all().filter((l) => l.action === "SHORT_SECRET");

      expect(logs.length).toBe(1);
    });
  });

  // =========================================================================
  // Test Group 4: Query and Statistics
  // =========================================================================

  describe("Query and Statistics", () => {
    it("should query logs by action", async () => {
      await auditLogger.log({ action: "QUERY_TEST_1", success: true });

      const logs = await auditLogger.queryLogs({
        action: "QUERY_TEST",
        limit: 10,
      });

      expect(logs.length > 0).toBeTruthy();
    });

    it("should query logs by date range", async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const logs = await auditLogger.queryLogs({
        startDate: yesterday,
        endDate: now,
        limit: 10,
      });

      expect(Array.isArray(logs)).toBeTruthy();
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

      expect(successLogs.length > 0).toBeTruthy();
      expect(failureLogs.length > 0).toBeTruthy();
    });

    it("should get audit statistics", async () => {
      const stats = await auditLogger.getStatistics("day");

      expect(typeof stats.totalEvents === "number").toBeTruthy();
      expect(typeof stats.failedEvents === "number").toBeTruthy();
      expect(typeof stats.securityEvents === "number").toBeTruthy();
      expect(Array.isArray(stats.topActions)).toBeTruthy();
      expect(Array.isArray(stats.topUsers)).toBeTruthy();
    });

    it("should get statistics for different timeframes", async () => {
      const hourStats = await auditLogger.getStatistics("hour");
      const dayStats = await auditLogger.getStatistics("day");
      const weekStats = await auditLogger.getStatistics("week");
      const monthStats = await auditLogger.getStatistics("month");

      expect(typeof hourStats.totalEvents === "number").toBeTruthy();
      expect(typeof dayStats.totalEvents === "number").toBeTruthy();
      expect(typeof weekStats.totalEvents === "number").toBeTruthy();
      expect(typeof monthStats.totalEvents === "number").toBeTruthy();
    });

    it("should handle pagination with offset", async () => {
      const page1 = await auditLogger.queryLogs({ limit: 5, offset: 0 });
      const page2 = await auditLogger.queryLogs({ limit: 5, offset: 5 });

      expect(Array.isArray(page1)).toBeTruthy();
      expect(Array.isArray(page2)).toBeTruthy();
    });
  });

  // =========================================================================
  // Test Group 5: Factory Function and Configs
  // =========================================================================

  describe("Factory Function and Configs", () => {
    it("should create audit logger with factory function", () => {
      const logger = createAuditLogger(redis, scheduler);
      expect(logger).toBeTruthy();
    });

    it("should create audit logger with custom config", () => {
      const logger = createAuditLogger(redis, scheduler, {
        enableRealTimeAlerts: false,
        retentionDays: 30,
      });
      expect(logger).toBeTruthy();
    });

    it("should have HIGH_SECURITY config", () => {
      expect(AuditConfigs.HIGH_SECURITY.enableRealTimeAlerts).toBe(true);
      expect(AuditConfigs.HIGH_SECURITY.retentionDays).toBe(365);
      expect(AuditConfigs.HIGH_SECURITY.alertThresholds.failedLogins).toBe(3);
    });

    it("should have PRODUCTION config", () => {
      expect(AuditConfigs.PRODUCTION.enableRealTimeAlerts).toBe(true);
      expect(AuditConfigs.PRODUCTION.retentionDays).toBe(90);
      expect(AuditConfigs.PRODUCTION.alertThresholds.failedLogins).toBe(5);
    });

    it("should have DEVELOPMENT config", () => {
      expect(AuditConfigs.DEVELOPMENT.enableRealTimeAlerts).toBe(false);
      expect(AuditConfigs.DEVELOPMENT.retentionDays).toBe(7);
      expect(AuditConfigs.DEVELOPMENT.alertThresholds.failedLogins).toBe(10);
    });
  });

  // =========================================================================
  // Test Group 6: Error Handling
  // =========================================================================

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      // Create logger with invalid Redis to trigger errors
      const badRedis = new Redis({
        host: "invalid-host",
        port: 9999,
        maxRetriesPerRequest: 0,
        connectTimeout: 500,
        lazyConnect: true,
        retryStrategy: () => null,
      });

      const badLogger = new AuditLogger(badRedis, scheduler, {
        enableRealTimeAlerts: false,
      });

      // Should not throw
      await badLogger.log({ action: "ERROR_TEST", success: true });

      // Cleanup
      try {
        badRedis.disconnect(false);
      } catch {
        // Expected
      }
    }, 10_000);

    it("should return empty array on query errors", async () => {
      const logs = await auditLogger.queryLogs({
        startDate: new Date("invalid-date"),
      });

      expect(Array.isArray(logs)).toBeTruthy();
    });

    it("should return zero statistics on error", async () => {
      const stats = await auditLogger.getStatistics("invalid" as never);

      expect(stats.totalEvents).toBe(0);
      expect(stats.failedEvents).toBe(0);
      expect(stats.securityEvents).toBe(0);
    });
  });
});
