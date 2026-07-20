/**
 * @file auditService.log.test.ts
 * @description Unit tests for AuditService.log() — creating audit log entries.
 *              Uses mocked Prisma to avoid database dependency.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { randomUUID } from "crypto";

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
    auditLogCreate,
    adminUserFindMany,
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

import { AuditService, AuditActions, AuditResources } from "../../src/audit/auditService.js";

// ---------------------------------------------------------------------------
// Test user data
// ---------------------------------------------------------------------------

const TEST_USER_1 = {
  id: "audit-test-user-001",
  email: "audit-test-user@example.com",
  name: "Audit Test User",
  role: { name: "ADMIN" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditService - log() - Create Audit Logs", () => {
  const auditService = new AuditService(mocks.prismaClient);
  const adminUserStore = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    adminUserStore.clear();
    adminUserStore.set(TEST_USER_1.id, TEST_USER_1);

    // Mock auditLog.create — returns record with resolved user relation
    mocks.auditLogCreate.mockImplementation(async ({ data, include }: any) => {
      const id = randomUUID();
      const now = new Date();
      const record: Record<string, unknown> = {
        id,
        createdAt: now,
        updatedAt: now,
        userId: null,
        resource: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        success: true,
        error: null,
        user: null,
        ...data,
      };

      if (include?.user && record.userId) {
        const adminUser = adminUserStore.get(record.userId as string);
        if (adminUser) {
          record.user = {
            id: adminUser.id,
            email: adminUser.email,
            name: adminUser.name,
            role: adminUser.role,
          };
        }
      }

      return record;
    });
  });

  describe("Conditional Property Spreading - exactOptionalPropertyTypes", () => {
    it("should create minimal log with only required fields", async () => {
      const result = await auditService.log({
        action: "TEST_MINIMAL_ACTION",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.action).toBe("TEST_MINIMAL_ACTION");
      expect(result.value.userId).toBe(null);
      expect(result.value.resource).toBe(null);
      expect(result.value.resourceId).toBe(null);
      expect(result.value.details).toBe(null);
      expect(result.value.ipAddress).toBe(null);
      expect(result.value.userAgent).toBe(null);
      expect(result.value.success).toBe(true);
      expect(result.value.error).toBe(null);
    });

    it("should handle all optional fields when provided", async () => {
      const result = await auditService.log({
        userId: TEST_USER_1.id,
        action: AuditActions.USER_UPDATED,
        resource: AuditResources.USER,
        resourceId: TEST_USER_1.id,
        details: { field: "email", oldValue: "old@example.com", newValue: "new@example.com" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        success: true,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.userId).toBe(TEST_USER_1.id);
      expect(result.value.action).toBe(AuditActions.USER_UPDATED);
      expect(result.value.resource).toBe(AuditResources.USER);
      expect(result.value.resourceId).toBe(TEST_USER_1.id);
      expect(result.value.details).toStrictEqual({
        field: "email",
        oldValue: "old@example.com",
        newValue: "new@example.com",
      });
      expect(result.value.ipAddress).toBe("192.168.1.1");
      expect(result.value.userAgent).toBe("Mozilla/5.0");
      expect(result.value.success).toBe(true);
    });

    it("should handle error field when success=false", async () => {
      const result = await auditService.log({
        userId: TEST_USER_1.id,
        action: AuditActions.LOGIN_FAILED,
        success: false,
        error: "Invalid password",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.success).toBe(false);
      expect(result.value.error).toBe("Invalid password");
    });

    it("should default success to true when not specified", async () => {
      const result = await auditService.log({
        action: "TEST_DEFAULT_SUCCESS",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.success).toBe(true);
    });

    it("should explicitly set success to false when provided", async () => {
      const result = await auditService.log({
        action: "TEST_EXPLICIT_FAILURE",
        success: false,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.success).toBe(false);
    });
  });

  describe("User Association", () => {
    it("should include user details when userId is provided", async () => {
      const result = await auditService.log({
        userId: TEST_USER_1.id,
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        resourceId: "post-123",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.user).toBeTruthy();
      expect(result.value.user.id).toBe(TEST_USER_1.id);
      expect(result.value.user.email).toBe("audit-test-user@example.com");
      expect(result.value.user.name).toBe("Audit Test User");
      expect(result.value.user.role).toBe("ADMIN");
    });

    it("should handle logs without user association", async () => {
      const result = await auditService.log({
        action: AuditActions.SYSTEM_CONFIG_CHANGED,
        resource: AuditResources.SYSTEM,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.userId).toBe(null);
      expect(result.value.user).toBe(null);
    });
  });

  describe("Complex Details Objects", () => {
    it("should preserve nested objects in details", async () => {
      const details = {
        changes: {
          profile: {
            name: { old: "Old Name", new: "New Name" },
            avatar: { old: null, new: "https://example.com/avatar.jpg" },
          },
          settings: {
            notifications: { old: false, new: true },
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await auditService.log({
        userId: TEST_USER_1.id,
        action: "TEST_NESTED_DETAILS",
        details,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.details).toStrictEqual(details);
    });

    it("should handle arrays in details", async () => {
      const details = {
        permissions: ["read", "write", "delete"],
        removedRoles: ["moderator", "admin"],
      };

      const result = await auditService.log({
        action: "TEST_ARRAY_DETAILS",
        details,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.details).toStrictEqual(details);
    });
  });

  describe("actorType derivation (audit-actor-polymorphism)", () => {
    it("derives actorType ADMIN when userId is present and actorType is absent", async () => {
      await auditService.log({ userId: TEST_USER_1.id, action: "ADMIN_ACTION" });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("ADMIN");
      expect(data.userId).toBe(TEST_USER_1.id);
    });

    it("derives actorType CUSTOMER when customerUserId is present", async () => {
      await auditService.log({ customerUserId: "cust-1", action: "CUSTOMER_ACTION" });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("CUSTOMER");
      expect(data.customerUserId).toBe("cust-1");
      expect("userId" in data).toBe(false);
    });

    it("derives actorType SYSTEM when no actor is present", async () => {
      await auditService.log({ action: "SYSTEM_ACTION" });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("SYSTEM");
    });

    it("derivation-wins: an actor FK overrides a conflicting explicit actorType (ADMIN)", async () => {
      // A future caller passing actorType:'SYSTEM' alongside a set userId must
      // NOT produce a mislabeled SYSTEM row — the FK wins, making the invalid
      // combination structurally impossible rather than merely detectable by
      // the reconciliation query later (post-verify remediation S1).
      await auditService.log({
        userId: TEST_USER_1.id,
        actorType: "SYSTEM",
        action: "OVERRIDE_ADMIN",
      });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("ADMIN");
      expect(data.userId).toBe(TEST_USER_1.id);
    });

    it("derivation-wins: an actor FK overrides a conflicting explicit actorType (CUSTOMER)", async () => {
      await auditService.log({
        customerUserId: "cust-1",
        actorType: "SYSTEM",
        action: "OVERRIDE_CUSTOMER",
      });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("CUSTOMER");
      expect(data.customerUserId).toBe("cust-1");
    });

    it("honors an explicit actorType only when neither FK is present", async () => {
      await auditService.log({ actorType: "SYSTEM", action: "EXPLICIT_SYSTEM_NO_FK" });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("SYSTEM");
      expect("userId" in data).toBe(false);
      expect("customerUserId" in data).toBe(false);
    });

    it("drops customerUserId, keeps the ADMIN userId, and warns when both actor FKs are supplied", async () => {
      // A dual-FK caller bug must not reach the DB exclusive-arc CHECK: the row
      // is written as an ADMIN entry (userId wins) and the drop is logged.
      await auditService.log({
        userId: TEST_USER_1.id,
        customerUserId: "cust-1",
        action: "DUAL_FK_ACTION",
      });
      const data = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
      expect(data.actorType).toBe("ADMIN");
      expect(data.userId).toBe(TEST_USER_1.id);
      expect("customerUserId" in data).toBe(false);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            userId: TEST_USER_1.id,
            customerUserId: "cust-1",
          }),
        }),
        expect.stringContaining("customerUserId")
      );
    });
  });

  describe("AuditActions Constants", () => {
    it("should have all expected action constants", () => {
      expect(AuditActions.LOGIN).toBe("LOGIN");
      expect(AuditActions.LOGOUT).toBe("LOGOUT");
      expect(AuditActions.USER_CREATED).toBe("USER_CREATED");
      expect(AuditActions.PERMISSION_DENIED).toBe("PERMISSION_DENIED");
      expect(AuditActions.POST_PUBLISHED).toBe("POST_PUBLISHED");
    });
  });

  describe("AuditResources Constants", () => {
    it("should have all expected resource constants", () => {
      expect(AuditResources.USER).toBe("AdminUser");
      expect(AuditResources.ACCOUNT).toBe("Account");
      expect(AuditResources.POST).toBe("Post");
      expect(AuditResources.SYSTEM).toBe("System");
    });
  });
});
