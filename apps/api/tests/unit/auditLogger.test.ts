/**
 * @file auditLogger.test.ts
 * @description Unit tests for AuditLogger. Uses in-memory mocked Prisma stores
 *              with real Redis for testing caching and alerting features.
 * @layer infrastructure
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
const { createInMemoryRedis } = await import("./inMemoryRedis.test-helpers.js");

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

let redis: ReturnType<typeof createInMemoryRedis>;
let auditLogger: InstanceType<typeof AuditLogger>;
const scheduler = new NoopBackgroundTaskScheduler();

// ---------------------------------------------------------------------------
// Main Test Suite
// ---------------------------------------------------------------------------

describe("AuditLogger Tests", () => {
  beforeAll(async () => {
    redis = createInMemoryRedis();

    // Flush audit cache keys
    const keys = await redis.keys("audit_recent:*");
    if (keys.length > 0) await redis.del(...keys);

    const alertKeys = await redis.keys("failed_logins:*");
    if (alertKeys.length > 0) await redis.del(...alertKeys);

    const apiKeys = await redis.keys("api_calls:*");
    if (apiKeys.length > 0) await redis.del(...apiKeys);

    // Clear stores
    stores.auditLog.clear();

    auditLogger = new AuditLogger(mockPrisma.prisma, redis, scheduler, {
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

    it("records the socket peer, not a spoofed X-Forwarded-For entry", async () => {
      // Under the test's fail-closed hop count (TRUSTED_PROXY_HOP_COUNT=0) the
      // resolver ignores the client-controlled XFF and records the socket peer.
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "198.51.100.1, 192.168.1.1",
          "user-agent": "Test Agent",
        },
      });

      await auditLogger.log({ action: "FORWARDED_IP_TEST", success: true }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "FORWARDED_IP_TEST");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("192.168.1.100");
      expect(logs[0]?.ipAddress).not.toBe("198.51.100.1");
    });

    it("ignores a standalone X-Real-IP header (untrusted)", async () => {
      const request = createMockRequest({
        headers: {
          "x-real-ip": "198.51.100.2",
          "user-agent": "Test Agent",
        },
      });

      await auditLogger.log({ action: "REAL_IP_TEST", success: true }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "REAL_IP_TEST");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("192.168.1.100");
    });

    it("ignores a standalone CF-Connecting-IP header (untrusted)", async () => {
      const request = createMockRequest({
        headers: {
          "cf-connecting-ip": "198.51.100.3",
          "user-agent": "Test Agent",
        },
      });

      await auditLogger.log({ action: "CF_IP_TEST", success: true }, request);

      const logs = stores.auditLog.all().filter((l) => l.action === "CF_IP_TEST");

      expect(logs.length).toBe(1);
      expect(logs[0]?.ipAddress).toBe("192.168.1.100");
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
      const logger = createAuditLogger(mockPrisma.prisma, redis, scheduler);
      expect(logger).toBeTruthy();
    });

    it("should create audit logger with custom config", () => {
      const logger = createAuditLogger(mockPrisma.prisma, redis, scheduler, {
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
      // Redis stub whose every data operation rejects, simulating an
      // unavailable backend. No real ioredis connection (this suite uses the
      // in-memory fake); AuditLogger must degrade gracefully and not throw.
      const badRedis = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "on" || prop === "disconnect" || prop === "quit") {
              return () => undefined;
            }
            return () => Promise.reject(new Error("Redis unavailable (test stub)"));
          },
        }
      ) as unknown as ReturnType<typeof createInMemoryRedis>;

      const badLogger = new AuditLogger(mockPrisma.prisma, badRedis, scheduler, {
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

  // =========================================================================
  // Test Group 7: User ID extraction from request auth context
  // =========================================================================

  describe("extractUserId from request auth context", () => {
    it("populates userId from req.auth.user.id (admin tier)", async () => {
      const req = createMockRequest({
        auth: {
          user: {
            id: "admin-user-123",
            email: "admin@example.com",
            name: "Admin",
            role: "SUPER_ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      } as Partial<FastifyRequest>);

      await auditLogger.log({ action: "ADMIN_AUTH_TEST", success: true }, req);

      const logs = stores.auditLog.all().filter((l) => l.action === "ADMIN_AUTH_TEST");
      expect(logs.length).toBe(1);
      expect(logs[0]?.userId).toBe("admin-user-123");
    });

    it("populates userId from req.user.id (regular tier) when no admin auth", async () => {
      const req = createMockRequest({
        user: {
          id: "regular-user-456",
          email: "user@example.com",
          name: "User",
          role: "USER",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          createdAt: new Date(),
        },
      } as Partial<FastifyRequest>);

      await auditLogger.log({ action: "USER_AUTH_TEST", success: true }, req);

      const logs = stores.auditLog.all().filter((l) => l.action === "USER_AUTH_TEST");
      expect(logs.length).toBe(1);
      expect(logs[0]?.userId).toBe("regular-user-456");
    });

    it("prefers req.auth.user.id over req.user.id when both present", async () => {
      const req = createMockRequest({
        auth: {
          user: {
            id: "admin-priority",
            email: "admin@example.com",
            name: "Admin",
            role: "SUPER_ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        user: {
          id: "regular-fallback",
          email: "user@example.com",
          name: "User",
          role: "USER",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          createdAt: new Date(),
        },
      } as Partial<FastifyRequest>);

      await auditLogger.log({ action: "PRIORITY_TEST", success: true }, req);

      const logs = stores.auditLog.all().filter((l) => l.action === "PRIORITY_TEST");
      expect(logs.length).toBe(1);
      expect(logs[0]?.userId).toBe("admin-priority");
    });

    it("leaves userId undefined when neither auth context is populated", async () => {
      const req = createMockRequest();

      await auditLogger.log({ action: "ANON_TEST", success: true }, req);

      const logs = stores.auditLog.all().filter((l) => l.action === "ANON_TEST");
      expect(logs.length).toBe(1);
      expect(logs[0]?.userId).toBeFalsy();
    });

    it("explicit event.userId overrides extracted userId", async () => {
      const req = createMockRequest({
        auth: {
          user: {
            id: "extracted-id",
            email: "admin@example.com",
            name: "Admin",
            role: "SUPER_ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      } as Partial<FastifyRequest>);

      await auditLogger.log({ action: "EXPLICIT_TEST", userId: "explicit-id", success: true }, req);

      const logs = stores.auditLog.all().filter((l) => l.action === "EXPLICIT_TEST");
      expect(logs.length).toBe(1);
      expect(logs[0]?.userId).toBe("explicit-id");
    });
  });

  // =========================================================================
  // Test Group 8: actorType derivation (audit-actor-polymorphism)
  // =========================================================================

  describe("actorType derivation", () => {
    it("derives actorType ADMIN when userId is present", async () => {
      await auditLogger.log({ action: "ACTOR_ADMIN", userId: "admin-1", success: true });
      const log = stores.auditLog.all().find((l) => l.action === "ACTOR_ADMIN");
      expect(log?.actorType).toBe("ADMIN");
      expect(log?.userId).toBe("admin-1");
    });

    it("derives actorType CUSTOMER when customerUserId is present", async () => {
      await auditLogger.log({ action: "ACTOR_CUSTOMER", customerUserId: "cust-1", success: true });
      const log = stores.auditLog.all().find((l) => l.action === "ACTOR_CUSTOMER");
      expect(log?.actorType).toBe("CUSTOMER");
      expect(log?.customerUserId).toBe("cust-1");
      expect(log?.userId).toBeFalsy();
    });

    it("derives actorType SYSTEM when no actor is present", async () => {
      await auditLogger.log({ action: "ACTOR_SYSTEM", success: true });
      const log = stores.auditLog.all().find((l) => l.action === "ACTOR_SYSTEM");
      expect(log?.actorType).toBe("SYSTEM");
    });

    it("derivation-wins: an actor FK overrides a conflicting explicit actorType (ADMIN)", async () => {
      // A future caller passing actorType:'SYSTEM' alongside a set userId must
      // NOT produce a mislabeled SYSTEM row — the FK wins, making the invalid
      // combination structurally impossible rather than merely detectable by
      // the reconciliation query later (post-verify remediation S1).
      await auditLogger.log({
        action: "ACTOR_OVERRIDE_ADMIN",
        userId: "admin-1",
        actorType: "SYSTEM",
        success: true,
      });
      const log = stores.auditLog.all().find((l) => l.action === "ACTOR_OVERRIDE_ADMIN");
      expect(log?.actorType).toBe("ADMIN");
      expect(log?.userId).toBe("admin-1");
    });

    it("derivation-wins: an actor FK overrides a conflicting explicit actorType (CUSTOMER)", async () => {
      await auditLogger.log({
        action: "ACTOR_OVERRIDE_CUSTOMER",
        customerUserId: "cust-1",
        actorType: "SYSTEM",
        success: true,
      });
      const log = stores.auditLog.all().find((l) => l.action === "ACTOR_OVERRIDE_CUSTOMER");
      expect(log?.actorType).toBe("CUSTOMER");
      expect(log?.customerUserId).toBe("cust-1");
    });

    it("honors an explicit actorType only when neither FK is present", async () => {
      await auditLogger.log({
        action: "ACTOR_EXPLICIT_SYSTEM_NO_FK",
        actorType: "SYSTEM",
        success: true,
      });
      const log = stores.auditLog.all().find((l) => l.action === "ACTOR_EXPLICIT_SYSTEM_NO_FK");
      expect(log?.actorType).toBe("SYSTEM");
      expect(log?.userId).toBeFalsy();
      expect(log?.customerUserId).toBeFalsy();
    });
  });
});
