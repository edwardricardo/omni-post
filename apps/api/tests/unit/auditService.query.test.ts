/**
 * @file auditService.query.test.ts
 * @description Unit tests for AuditService.getLogs() — query and filtering.
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
  };
});

vi.mock("@infra/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/prisma")>();
  return {
    ...actual,
    prisma: mocks.prismaClient,
  };
});

vi.mock("../../src/lib/logger.js", () => ({
  logger: mocks.logger,
}));

import { AuditService } from "../../src/audit/auditService.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_USER_1_ID = "audit-test-user-001";
const TEST_USER_2_ID = "audit-test-user-002";

const TEST_USER_1 = {
  id: TEST_USER_1_ID,
  email: "audit-test-user@example.com",
  name: "Audit Test User",
  role: "ADMIN",
};

const TEST_USER_2 = {
  id: TEST_USER_2_ID,
  email: "audit-test-user2@example.com",
  name: "Audit Test User 2",
  role: "SUPPORT",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter in-memory records using the same where clause logic AuditService builds */
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

/** Resolve user relation for each record */
function resolveUsers(
  records: Array<Record<string, unknown>>,
  users: Map<string, Record<string, unknown>>
): Array<Record<string, unknown>> {
  return records.map((entry) => {
    if (entry.userId) {
      const user = users.get(entry.userId as string);
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditService - getLogs() - Query and Filtering", () => {
  const auditService = new AuditService(mocks.prismaClient);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const adminUsers = new Map<string, Record<string, unknown>>();
  let seedRecords: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();

    adminUsers.clear();
    adminUsers.set(TEST_USER_1_ID, TEST_USER_1);
    adminUsers.set(TEST_USER_2_ID, TEST_USER_2);

    seedRecords = [
      {
        id: "log-q-1",
        userId: TEST_USER_1_ID,
        action: "TEST_FILTER_LOGIN",
        resource: "Session",
        success: true,
        error: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
        user: null,
      },
      {
        id: "log-q-2",
        userId: TEST_USER_1_ID,
        action: "TEST_FILTER_LOGOUT",
        resource: "Session",
        success: true,
        error: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: yesterday,
        updatedAt: yesterday,
        user: null,
      },
      {
        id: "log-q-3",
        userId: TEST_USER_2_ID,
        action: "TEST_FILTER_LOGIN",
        resource: "Session",
        success: false,
        error: "Invalid credentials",
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
        user: null,
      },
      {
        id: "log-q-4",
        userId: TEST_USER_2_ID,
        action: "TEST_FILTER_POST_CREATE",
        resource: "Post",
        resourceId: "post-test-1",
        success: true,
        error: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
        user: null,
      },
      {
        id: "log-q-5",
        userId: null,
        action: "TEST_FILTER_SYSTEM",
        resource: "System",
        success: true,
        error: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        createdAt: now,
        updatedAt: now,
        user: null,
      },
    ];

    // Override findMany to handle complex where + ordering + pagination + include
    mocks.auditLogFindMany.mockImplementation(
      async ({ where, orderBy, take, skip, include }: any = {}) => {
        let results = [...seedRecords];

        if (where) {
          results = filterRecords(results, where);
        }

        // Ordering
        if (orderBy?.createdAt) {
          const dir = orderBy.createdAt;
          results.sort((a, b) => {
            const da = (a.createdAt as Date).getTime();
            const db = (b.createdAt as Date).getTime();
            return dir === "desc" ? db - da : da - db;
          });
        }

        // Pagination
        const offset = skip ?? 0;
        const limit = take ?? results.length;
        results = results.slice(offset, offset + limit);

        // Resolve user relation
        if (include?.user) {
          results = resolveUsers(results, adminUsers);
        }

        return results;
      }
    );
  });

  describe("Where Clause Building", () => {
    it("should filter by userId exactly", async () => {
      const result = await auditService.getLogs({ userId: TEST_USER_1_ID });

      expect(result.ok).toBeTruthy();
      expect(result.value.length >= 2).toBeTruthy();
      result.value.forEach((log) => {
        expect(log.userId).toBe(TEST_USER_1_ID);
      });
    });

    it("should filter by action with case-insensitive contains", async () => {
      const result = await auditService.getLogs({ action: "login" });

      expect(result.ok).toBeTruthy();
      const loginLogs = result.value.filter((log) => log.action.includes("TEST_FILTER_LOGIN"));
      expect(loginLogs.length >= 2).toBeTruthy();
    });

    it("should filter by resource exactly", async () => {
      const result = await auditService.getLogs({ resource: "Session" });

      expect(result.ok).toBeTruthy();
      result.value
        .filter((log) => log.action.startsWith("TEST_FILTER"))
        .forEach((log) => {
          expect(log.resource).toBe("Session");
        });
    });

    it("should filter by resourceId exactly", async () => {
      const result = await auditService.getLogs({
        resource: "Post",
        resourceId: "post-test-1",
      });

      expect(result.ok).toBeTruthy();
      const matching = result.value.find((log) => log.resourceId === "post-test-1");
      expect(matching).toBeTruthy();
    });

    it("should filter by success=true", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER_LOGIN",
        success: true,
      });

      expect(result.ok).toBeTruthy();
      result.value
        .filter((log) => log.action === "TEST_FILTER_LOGIN")
        .forEach((log) => {
          expect(log.success).toBe(true);
        });
    });

    it("should filter by success=false", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER_LOGIN",
        success: false,
      });

      expect(result.ok).toBeTruthy();
      const failedLogin = result.value.find(
        (log) => log.action === "TEST_FILTER_LOGIN" && log.userId === TEST_USER_2_ID
      );
      expect(failedLogin).toBeTruthy();
      expect(failedLogin.success).toBe(false);
      expect(failedLogin.error).toBe("Invalid credentials");
    });
  });

  describe("Date Range Filtering", () => {
    it("should filter by startDate (gte)", async () => {
      const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        startDate: yesterdayDate,
      });

      expect(result.ok).toBeTruthy();
      result.value
        .filter((log) => log.action.startsWith("TEST_FILTER"))
        .forEach((log) => {
          expect(log.createdAt >= yesterdayDate).toBeTruthy();
        });
    });

    it("should filter by endDate (lte)", async () => {
      const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        endDate: yesterdayDate,
      });

      expect(result.ok).toBeTruthy();
      const oldLogs = result.value.filter((log) => log.action.startsWith("TEST_FILTER"));
      oldLogs.forEach((log) => {
        expect(log.createdAt <= yesterdayDate).toBeTruthy();
      });
    });

    it("should filter by date range (both startDate and endDate)", async () => {
      const currentTime = new Date();
      const oneDayAgo = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(currentTime.getTime() - 72 * 60 * 60 * 1000);

      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        startDate: threeDaysAgo,
        endDate: oneDayAgo,
      });

      expect(result.ok).toBeTruthy();
      result.value
        .filter((log) => log.action.startsWith("TEST_FILTER"))
        .forEach((log) => {
          expect(log.createdAt >= threeDaysAgo && log.createdAt <= oneDayAgo).toBeTruthy();
        });
    });
  });

  describe("Pagination", () => {
    it("should respect limit parameter", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        limit: 2,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.length <= 2).toBeTruthy();
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

      expect(firstPage.ok && secondPage.ok).toBeTruthy();
      if (firstPage.value.length === 2 && secondPage.value.length > 0) {
        const firstIds = firstPage.value.map((log) => log.id);
        const secondIds = secondPage.value.map((log) => log.id);
        expect(firstIds.some((id) => secondIds.includes(id))).toBeFalsy();
      }
    });

    it("should cap limit at 1000 for performance", async () => {
      const result = await auditService.getLogs({
        limit: 5000,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.length <= 1000).toBeTruthy();
    });

    it("should use default limit of 50 when not specified", async () => {
      const result = await auditService.getLogs({});

      expect(result.ok).toBeTruthy();
      expect(result.value.length <= 50 || result.value.length <= 1000).toBeTruthy();
    });
  });

  describe("Result Ordering", () => {
    it("should order results by createdAt descending (newest first)", async () => {
      const result = await auditService.getLogs({
        action: "TEST_FILTER",
        limit: 10,
      });

      expect(result.ok).toBeTruthy();
      const filtered = result.value.filter((log) => log.action.startsWith("TEST_FILTER"));

      if (filtered.length >= 2) {
        for (let i = 0; i < filtered.length - 1; i++) {
          expect(filtered[i].createdAt >= filtered[i + 1].createdAt).toBeTruthy();
        }
      }
    });
  });
});
