/**
 * @file AuditableService.test.ts
 * @description Unit tests for AuditableService — audit logging functionality
 *              with mocked Prisma (no database dependency).
 * @layer test-infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const noop = () => {};

  const auditLogStore: Array<Record<string, unknown>> = [];

  const auditLogCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    // Simulate FK constraint failure for non-existent user IDs
    // In real DB, userId references adminUser — if user doesn't exist, create fails
    if (data.userId && !knownUserIds.has(data.userId as string)) {
      throw new Error(`Foreign key constraint failed on the field: \`AuditLog_userId_fkey\``);
    }

    const now = new Date();
    const record = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      action: null,
      resource: null,
      resourceId: null,
      userId: null,
      ipAddress: null,
      userAgent: null,
      details: null,
      success: true,
      error: null,
      ...data,
    };
    auditLogStore.push(record);
    return record;
  });

  const auditLogFindFirst = vi.fn(
    async (args: { where?: Record<string, unknown>; orderBy?: any }) => {
      let results = [...auditLogStore];

      if (args.where) {
        results = results.filter((entry) => {
          for (const [key, value] of Object.entries(args.where!)) {
            if (entry[key] !== value) return false;
          }
          return true;
        });
      }

      // Sort by createdAt desc
      results.sort(
        (a, b) =>
          new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
      );

      return results[0] ?? null;
    }
  );

  const auditLogFindMany = vi.fn(async () => []);
  const auditLogDeleteMany = vi.fn(async () => ({ count: 0 }));

  const prismaClient: any = {
    auditLog: {
      create: auditLogCreate,
      findFirst: auditLogFindFirst,
      findMany: auditLogFindMany,
      findUnique: vi.fn(async () => null),
      deleteMany: auditLogDeleteMany,
      count: vi.fn(async () => 0),
    },
    adminUser: {
      create: vi.fn(async ({ data }: any) => {
        const id = randomUUID();
        knownUserIds.add(id);
        return { id, ...data };
      }),
      delete: vi.fn(async () => null),
    },
    account: {
      create: vi.fn(async ({ data }: any) => ({ id: randomUUID(), ...data })),
      delete: vi.fn(async () => null),
    },
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
  };

  const loggerObj = {
    info: vi.fn(noop),
    warn: vi.fn(noop),
    error: vi.fn(noop),
    debug: vi.fn(noop),
    trace: vi.fn(noop),
    fatal: vi.fn(noop),
    child: vi.fn((): any => loggerObj),
  };

  // Track known user IDs that pass FK validation
  const knownUserIds = new Set<string>();

  return {
    prismaClient,
    loggerObj,
    auditLogStore,
    auditLogCreate,
    auditLogFindFirst,
    auditLogFindMany,
    auditLogDeleteMany,
    knownUserIds,
  };
});

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mocks.prismaClient };
});

vi.mock("../../src/lib/logger.js", () => ({
  logger: mocks.loggerObj,
  authLogger: mocks.loggerObj,
  createLogger: () => mocks.loggerObj,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

import {
  AuditableService,
  type UserActionOptions,
  type AccountActionOptions,
  type ResourceActionOptions,
} from "../../src/services/AuditableService.js";

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------

class TestAuditableService extends AuditableService {
  constructor() {
    super("TestAuditableService");
  }

  public async testLogUserAction(userId: string, options: UserActionOptions) {
    return this.logUserAction(userId, options);
  }

  public async testLogAccountAction(userId: string, options: AccountActionOptions) {
    return this.logAccountAction(userId, options);
  }

  public async testLogResourceAction(userId: string, options: ResourceActionOptions) {
    return this.logResourceAction(userId, options);
  }

  public async testExecuteWithAudit<T>(
    context: { operation: string; userId?: string; accountId?: string },
    auditOptions: {
      action: string;
      category:
        | "AUTHENTICATION"
        | "ACCOUNT"
        | "DATA"
        | "DATA_ACCESS"
        | "SECURITY"
        | "COMPLIANCE"
        | "SYSTEM";
      resourceType?: string;
      resourceId?: string;
      severity?: "LOW" | "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";
    },
    operation: () => Promise<T>
  ) {
    return this.executeWithAudit(context, auditOptions, operation);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditableService", () => {
  const testUserId = "auditable-user-001";
  const testAccountId = "auditable-account-001";
  const timestamp = Date.now();

  beforeEach(() => {
    mocks.auditLogStore.length = 0;
    mocks.auditLogCreate.mockClear();
    mocks.auditLogFindFirst.mockClear();
    mocks.auditLogFindMany.mockClear();
    mocks.auditLogDeleteMany.mockClear();
    mocks.loggerObj.error.mockClear();

    // Register known user IDs so FK constraint simulation passes
    mocks.knownUserIds.clear();
    mocks.knownUserIds.add(testUserId);
  });

  it("logUserAction - creates audit log with correct data", async () => {
    const service = new TestAuditableService();

    await service.testLogUserAction(testUserId, {
      action: "USER_LOGIN",
      category: "AUTHENTICATION",
      severity: "INFO",
      details: { method: "password" },
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
    });

    // Verify audit log was created with correct data
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);

    const userActionLog = mocks.auditLogStore.find(
      (l) => l.userId === testUserId && l.action === "USER_LOGIN"
    );

    expect(userActionLog).toBeTruthy();
    expect(userActionLog!.action).toBe("USER_LOGIN");
    expect(userActionLog!.userId).toBe(testUserId);
    expect(userActionLog!.ipAddress).toBe("192.168.1.1");
    expect(userActionLog!.userAgent).toBe("Mozilla/5.0");
    expect(userActionLog!.success).toBe(true);

    // Verify details structure (category, severity, and custom fields stored in details)
    expect(userActionLog!.details).toBeTruthy();
    expect(typeof userActionLog!.details).toBe("object");

    const details = userActionLog!.details as Record<string, unknown>;
    expect(details.category).toBe("AUTHENTICATION");
    expect(details.severity).toBe("INFO");
    expect(details.method).toBe("password");
  });

  it("logAccountAction - creates account-level audit log", async () => {
    const service = new TestAuditableService();

    await service.testLogAccountAction(testUserId, {
      accountId: testAccountId,
      action: "SUBSCRIPTION_UPGRADE",
      category: "ACCOUNT",
      severity: "HIGH",
      details: { from: "BASIC", to: "PRO" },
    });

    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);

    const accountActionLog = mocks.auditLogStore.find(
      (l) => l.userId === testUserId && l.action === "SUBSCRIPTION_UPGRADE"
    );

    expect(accountActionLog).toBeTruthy();
    expect(accountActionLog!.action).toBe("SUBSCRIPTION_UPGRADE");
    expect(accountActionLog!.userId).toBe(testUserId);
    expect(accountActionLog!.success).toBe(true);

    // Verify details structure (accountId is stored in details, not as direct field)
    expect(accountActionLog!.details).toBeTruthy();
    const details = accountActionLog!.details as Record<string, unknown>;
    expect(details.category).toBe("ACCOUNT");
    expect(details.severity).toBe("HIGH");
    expect(details.from).toBe("BASIC");
    expect(details.to).toBe("PRO");
  });

  it("logResourceAction - creates resource-level audit log", async () => {
    const service = new TestAuditableService();
    const resourceId = `resource-${timestamp}-create`;

    await service.testLogResourceAction(testUserId, {
      accountId: testAccountId,
      action: "RESOURCE_CREATE",
      category: "DATA",
      resourceType: "Post",
      resourceId,
      severity: "LOW",
      details: { title: "Test Post", status: "DRAFT" },
    });

    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);

    const resourceLog = mocks.auditLogStore.find(
      (l) =>
        l.userId === testUserId &&
        l.action === "RESOURCE_CREATE" &&
        l.resource === "Post" &&
        l.resourceId === resourceId
    );

    expect(resourceLog).toBeTruthy();
    expect(resourceLog!.action).toBe("RESOURCE_CREATE");
    expect(resourceLog!.userId).toBe(testUserId);
    expect(resourceLog!.resource).toBe("Post");
    expect(resourceLog!.resourceId).toBe(resourceId);
    expect(resourceLog!.success).toBe(true);

    // Verify details
    expect(resourceLog!.details).toBeTruthy();
    const details = resourceLog!.details as Record<string, unknown>;
    expect(details.category).toBe("DATA");
    expect(details.severity).toBe("LOW");
    expect(details.title).toBe("Test Post");
    expect(details.status).toBe("DRAFT");
  });

  it("executeWithAudit - logs successful operation", async () => {
    const service = new TestAuditableService();

    const result = await service.testExecuteWithAudit(
      {
        operation: "testOperation",
        userId: testUserId,
        accountId: testAccountId,
      },
      {
        action: "DATA_CREATE",
        category: "DATA",
        resourceType: "Post",
        resourceId: `post-${timestamp}-123`,
        severity: "LOW",
      },
      async () => {
        return { success: true, data: "test data" };
      }
    );

    // Verify operation result
    expect(result).toStrictEqual({ success: true, data: "test data" });

    // Verify success audit log was created
    const successLog = mocks.auditLogStore.find(
      (l) =>
        l.userId === testUserId &&
        l.action === "DATA_CREATE" &&
        l.resource === "Post" &&
        l.resourceId === `post-${timestamp}-123`
    );

    expect(successLog).toBeTruthy();
    expect(successLog!.action).toBe("DATA_CREATE");
    expect(successLog!.userId).toBe(testUserId);
    expect(successLog!.resource).toBe("Post");
    expect(successLog!.resourceId).toBe(`post-${timestamp}-123`);
    expect(successLog!.success).toBe(true);

    // Verify details contain operation metadata
    expect(successLog!.details).toBeTruthy();
    const details = successLog!.details as Record<string, unknown>;
    expect(details.operation).toBe("testOperation");
    expect(details.success).toBe(true);
    expect(typeof details.durationMs === "number").toBeTruthy();
    expect((details.durationMs as number) >= 0).toBeTruthy();
  });

  it("executeWithAudit - logs failed operation with HIGH severity", async () => {
    const service = new TestAuditableService();

    await expect(
      service.testExecuteWithAudit(
        {
          operation: "failOperation",
          userId: testUserId,
          accountId: testAccountId,
        },
        {
          action: "DATA_UPDATE",
          category: "DATA",
          resourceType: "Post",
          resourceId: `post-${timestamp}-456`,
        },
        async () => {
          throw new Error("Test error");
        }
      )
    ).rejects.toThrow("Test error");

    // Verify failure audit log was created
    const failureLog = mocks.auditLogStore.find(
      (l) =>
        l.userId === testUserId &&
        l.action === "DATA_UPDATE" &&
        l.resource === "Post" &&
        l.resourceId === `post-${timestamp}-456`
    );

    expect(failureLog).toBeTruthy();
    expect(failureLog!.action).toBe("DATA_UPDATE");
    expect(failureLog!.userId).toBe(testUserId);
    expect(failureLog!.resource).toBe("Post");
    expect(failureLog!.resourceId).toBe(`post-${timestamp}-456`);

    // Note: success field in database might be true by default, but details.success should be false
    expect(failureLog!.details).toBeTruthy();
    const details = failureLog!.details as Record<string, unknown>;
    expect(details.operation).toBe("failOperation");
    expect(details.success).toBe(false);
    expect(details.error).toBe("Test error");
    expect(details.severity).toBe("HIGH");
    expect(typeof details.durationMs === "number").toBeTruthy();
    expect((details.durationMs as number) >= 0).toBeTruthy();
  });

  it("handles NULL vs undefined correctly in optional fields", async () => {
    const service = new TestAuditableService();

    // Test with undefined optional fields (should not be included)
    await service.testLogUserAction(testUserId, {
      action: "USER_ACTION_NO_OPTIONAL",
      category: "AUTHENTICATION",
      // ipAddress and userAgent intentionally omitted
    });

    const logWithoutOptional = mocks.auditLogStore.find(
      (l) => l.userId === testUserId && l.action === "USER_ACTION_NO_OPTIONAL"
    );

    expect(logWithoutOptional).toBeTruthy();
    // Mock returns null for missing optional fields (matching Prisma behavior)
    expect(logWithoutOptional!.ipAddress).toBe(null);
    expect(logWithoutOptional!.userAgent).toBe(null);

    // Test with provided optional fields
    await service.testLogUserAction(testUserId, {
      action: "USER_ACTION_WITH_OPTIONAL",
      category: "AUTHENTICATION",
      ipAddress: "10.0.0.1",
      userAgent: "TestAgent/1.0",
    });

    const logWithOptional = mocks.auditLogStore.find(
      (l) => l.userId === testUserId && l.action === "USER_ACTION_WITH_OPTIONAL"
    );

    expect(logWithOptional).toBeTruthy();
    expect(logWithOptional!.ipAddress).toBe("10.0.0.1");
    expect(logWithOptional!.userAgent).toBe("TestAgent/1.0");
  });

  it("stores complex details in JSON field", async () => {
    const service = new TestAuditableService();

    const complexDetails = {
      nested: {
        field: "value",
        array: [1, 2, 3],
      },
      boolean: true,
      number: 42,
      nullValue: null,
    };

    await service.testLogUserAction(testUserId, {
      action: "USER_ACTION_COMPLEX_DETAILS",
      category: "AUTHENTICATION",
      details: complexDetails,
    });

    const logWithComplexDetails = mocks.auditLogStore.find(
      (l) => l.userId === testUserId && l.action === "USER_ACTION_COMPLEX_DETAILS"
    );

    expect(logWithComplexDetails).toBeTruthy();
    expect(logWithComplexDetails!.details).toBeTruthy();

    const retrievedDetails = logWithComplexDetails!.details as Record<string, unknown>;

    // Verify nested structure is preserved (note: category and severity are added)
    expect(retrievedDetails.nested).toBeTruthy();
    const nested = retrievedDetails.nested as Record<string, unknown>;
    expect(nested.field).toBe("value");
    expect(nested.array).toStrictEqual([1, 2, 3]);
    expect(retrievedDetails.boolean).toBe(true);
    expect(retrievedDetails.number).toBe(42);
    expect(retrievedDetails.nullValue).toBe(null);
  });

  it("handles audit logging failure gracefully without throwing", async () => {
    const service = new TestAuditableService();

    // The service should not throw even if the audit log creation fails
    // "non-existent-user-id" is not in knownUserIds, so FK constraint simulation triggers
    await service.testLogUserAction("non-existent-user-id", {
      action: "TEST_GRACEFUL_FAILURE",
      category: "SYSTEM",
    });

    // The operation completes successfully even though the audit log failed
    // This demonstrates that audit failures don't break the main operation flow

    // Since the audit log failed due to FK constraint, it won't be in the store
    const log = mocks.auditLogStore.find((l) => l.action === "TEST_GRACEFUL_FAILURE");

    // The audit log should NOT exist because the FK constraint failed
    // But the important part is that the operation didn't throw
    expect(log).toBe(undefined);

    // Verify the error was logged
    expect(mocks.loggerObj.error).toHaveBeenCalled();
  });
});
