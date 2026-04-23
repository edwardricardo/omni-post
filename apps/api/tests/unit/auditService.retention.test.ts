/**
 * @file auditService.retention.test.ts
 * @description Unit tests for AuditService.getUserLogs(), getResourceLogs(), cleanup().
 *              Uses mocked Prisma to avoid database dependency.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const noop = () => {};
  const noopAsync = async () => undefined;

  const auditLogCreate = vi.fn();
  const auditLogFindMany = vi.fn();
  const auditLogFindUnique = vi.fn();
  const auditLogCount = vi.fn();
  const auditLogDeleteMany = vi.fn();
  const auditLogGroupBy = vi.fn(async () => []);
  const adminUserFindMany = vi.fn();

  const prismaClient: any = {
    auditLog: {
      create: auditLogCreate,
      findMany: auditLogFindMany,
      findUnique: auditLogFindUnique,
      count: auditLogCount,
      deleteMany: auditLogDeleteMany,
      groupBy: auditLogGroupBy,
    },
    adminUser: {
      findMany: adminUserFindMany,
    },
    $connect: vi.fn(noopAsync),
    $disconnect: vi.fn(noopAsync),
    $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
  };

  const logger = {
    info: vi.fn(noop),
    warn: vi.fn(noop),
    error: vi.fn(noop),
    debug: vi.fn(noop),
    child: vi.fn(() => logger),
  };

  return {
    prismaClient,
    logger,
    auditLogFindMany,
    auditLogDeleteMany,
  };
});

vi.mock("@infra/prisma", () => ({
  prisma: mocks.prismaClient,
  Prisma: {},
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: mocks.logger,
}));

import { AuditService } from "../../src/audit/auditService.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_USER_1_ID = "audit-test-user-001";

const TEST_USER_1 = {
  id: TEST_USER_1_ID,
  email: "audit-test-user@example.com",
  name: "Audit Test User",
  role: "ADMIN",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterRecords(
  records: Array<Record<string, unknown>>,
  where: Record<string, unknown>
): Array<Record<string, unknown>> {
  return records.filter((entry) => {
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined || value === null) continue;

      if (key === "createdAt" && typeof value === "object") {
        const dateFilter = value as Record<string, Date>;
        const entryDate = entry.createdAt as Date;
        if (dateFilter.gte && entryDate < dateFilter.gte) return false;
        if (dateFilter.lte && entryDate > dateFilter.lte) return false;
        if (dateFilter.lt && entryDate >= dateFilter.lt) return false;
        continue;
      }

      if (typeof value === "object" && value !== null && "contains" in (value as any)) {
        const filter = value as { contains: string; mode?: string };
        const entryVal = String(entry[key] ?? "");
        if (filter.mode === "insensitive") {
          if (!entryVal.toLowerCase().includes(filter.contains.toLowerCase())) return false;
        } else {
          if (!entryVal.includes(filter.contains)) return false;
        }
        continue;
      }

      if (entry[key] !== value) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditService - getUserLogs(), getResourceLogs(), cleanup()", () => {
  const auditService = new AuditService();

  const now = new Date();
  const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
  const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  /** Mutable store of audit log records, shared between mock impls */
  let auditRecords: Array<Record<string, unknown>>;
  const adminUsers = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();

    adminUsers.clear();
    adminUsers.set(TEST_USER_1_ID, TEST_USER_1);

    auditRecords = [
      // Resource test data
      {
        id: "log-r-1",
        action: "RESOURCE_TEST_1",
        resource: "TEST_RESOURCE",
        resourceId: "resource-123",
        success: true,
        userId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "log-r-2",
        action: "RESOURCE_TEST_2",
        resource: "TEST_RESOURCE",
        resourceId: "resource-123",
        success: true,
        userId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "log-r-3",
        action: "RESOURCE_TEST_3",
        resource: "TEST_RESOURCE",
        resourceId: "resource-456",
        success: true,
        userId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
      },
      // Cleanup test data — old logs
      {
        id: "log-c-1",
        action: "CLEANUP_OLD_1",
        createdAt: oldDate,
        updatedAt: oldDate,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      },
      {
        id: "log-c-2",
        action: "CLEANUP_OLD_2",
        createdAt: oldDate,
        updatedAt: oldDate,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      },
      // Cleanup test data — recent logs
      {
        id: "log-c-3",
        action: "CLEANUP_RECENT_1",
        createdAt: recentDate,
        updatedAt: recentDate,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      },
      {
        id: "log-c-4",
        action: "CLEANUP_RECENT_2",
        createdAt: recentDate,
        updatedAt: recentDate,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      },
      // User-specific logs
      {
        id: "log-u-1",
        userId: TEST_USER_1_ID,
        action: "USER_LOG_ACTION_1",
        resource: "Post",
        success: true,
        error: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "log-u-2",
        userId: TEST_USER_1_ID,
        action: "USER_LOG_ACTION_2",
        resource: "Session",
        success: true,
        error: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    // Mock findMany with full filter/sort/pagination support
    mocks.auditLogFindMany.mockImplementation(
      async ({ where, orderBy, take, skip, include }: any = {}) => {
        let results = [...auditRecords];

        if (where) {
          results = filterRecords(results, where);
        }

        if (orderBy?.createdAt) {
          const dir = orderBy.createdAt;
          results.sort((a, b) => {
            const da = (a.createdAt as Date).getTime();
            const db = (b.createdAt as Date).getTime();
            return dir === "desc" ? db - da : da - db;
          });
        }

        const offset = skip ?? 0;
        const limit = take ?? results.length;
        results = results.slice(offset, offset + limit);

        if (include?.user) {
          results = results.map((entry) => {
            if (entry.userId) {
              const user = adminUsers.get(entry.userId as string);
              if (user) {
                return {
                  ...entry,
                  user: { id: user.id, email: user.email, name: user.name, role: user.role },
                };
              }
            }
            return { ...entry, user: null };
          });
        }

        return results;
      }
    );

    // Mock deleteMany — removes matching records from auditRecords
    mocks.auditLogDeleteMany.mockImplementation(async ({ where }: any = {}) => {
      if (!where) {
        const count = auditRecords.length;
        auditRecords = [];
        return { count };
      }

      const toDelete = filterRecords(auditRecords, where);
      const deleteIds = new Set(toDelete.map((r) => r.id));
      auditRecords = auditRecords.filter((r) => !deleteIds.has(r.id));
      return { count: toDelete.length };
    });
  });

  describe("getUserLogs() - User-Specific Queries", () => {
    it("should return logs for specific user", async () => {
      const result = await auditService.getUserLogs(TEST_USER_1_ID, 10, 0);

      expect(result.ok).toBeTruthy();
      result.value.forEach((log) => {
        expect(log.userId).toBe(TEST_USER_1_ID);
      });
    });

    it("should respect limit and offset", async () => {
      const result = await auditService.getUserLogs(TEST_USER_1_ID, 2, 0);

      expect(result.ok).toBeTruthy();
      expect(result.value.length <= 2).toBeTruthy();
    });
  });

  describe("getResourceLogs() - Resource-Specific Queries", () => {
    it("should return logs for specific resource type", async () => {
      const result = await auditService.getResourceLogs("TEST_RESOURCE", undefined, 10, 0);

      expect(result.ok).toBeTruthy();
      expect(result.value.length >= 3).toBeTruthy();
      result.value
        .filter((log) => log.action.startsWith("RESOURCE_TEST"))
        .forEach((log) => {
          expect(log.resource).toBe("TEST_RESOURCE");
        });
    });

    it("should filter by specific resourceId when provided", async () => {
      const result = await auditService.getResourceLogs("TEST_RESOURCE", "resource-123", 10, 0);

      expect(result.ok).toBeTruthy();
      const matching = result.value.filter((log) => log.resourceId === "resource-123");
      expect(matching.length >= 2).toBeTruthy();
      matching.forEach((log) => {
        expect(log.resource).toBe("TEST_RESOURCE");
        expect(log.resourceId).toBe("resource-123");
      });
    });

    it("should respect pagination", async () => {
      const result = await auditService.getResourceLogs("TEST_RESOURCE", undefined, 1, 0);

      expect(result.ok).toBeTruthy();
      expect(result.value.length <= 1).toBeTruthy();
    });
  });

  describe("cleanup() - Data Retention", () => {
    it("should delete logs older than retention period", async () => {
      const beforeCount = auditRecords.filter((e) =>
        String(e.action).startsWith("CLEANUP_")
      ).length;

      const result = await auditService.cleanup(90);

      expect(result.ok).toBeTruthy();
      expect(result.value).toBe(2);

      const afterCount = auditRecords.filter((e) => String(e.action).startsWith("CLEANUP_")).length;

      expect(beforeCount - afterCount).toBe(2);
    });

    it("should use strict less-than for cutoff (not less-than-or-equal)", async () => {
      const recentLog = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      auditRecords.push({
        id: "log-boundary",
        action: "CLEANUP_BOUNDARY_TEST",
        createdAt: recentLog,
        updatedAt: recentLog,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      });

      await auditService.cleanup(30);

      const stillExists = auditRecords.find((r) => r.id === "log-boundary");
      expect(stillExists).toBeTruthy();
    });

    it("should return count of deleted records", async () => {
      const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      auditRecords.push(
        {
          id: "log-count-1",
          action: "CLEANUP_COUNT_1",
          createdAt: old,
          updatedAt: old,
          success: true,
          userId: null,
          resource: null,
          resourceId: null,
          error: null,
          details: null,
          ipAddress: null,
          userAgent: null,
        },
        {
          id: "log-count-2",
          action: "CLEANUP_COUNT_2",
          createdAt: old,
          updatedAt: old,
          success: true,
          userId: null,
          resource: null,
          resourceId: null,
          error: null,
          details: null,
          ipAddress: null,
          userAgent: null,
        },
        {
          id: "log-count-3",
          action: "CLEANUP_COUNT_3",
          createdAt: old,
          updatedAt: old,
          success: true,
          userId: null,
          resource: null,
          resourceId: null,
          error: null,
          details: null,
          ipAddress: null,
          userAgent: null,
        }
      );

      const result = await auditService.cleanup(90);

      expect(result.ok).toBeTruthy();
      expect(result.value >= 3).toBeTruthy();
    });

    it("should not delete recent logs", async () => {
      const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      auditRecords.push({
        id: "log-recent-stay",
        action: "CLEANUP_RECENT_SHOULD_STAY",
        createdAt: recent,
        updatedAt: recent,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      });

      await auditService.cleanup(90);

      const stillExists = auditRecords.find((r) => r.id === "log-recent-stay");
      expect(stillExists).toBeTruthy();
    });

    it("should handle custom retention periods", async () => {
      const oldForShortRetention = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      auditRecords.push({
        id: "log-short-ret",
        action: "CLEANUP_SHORT_RETENTION",
        createdAt: oldForShortRetention,
        updatedAt: oldForShortRetention,
        success: true,
        userId: null,
        resource: null,
        resourceId: null,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
      });

      const result = await auditService.cleanup(30);

      expect(result.ok).toBeTruthy();
      expect(result.value >= 1).toBeTruthy();
    });
  });
});
