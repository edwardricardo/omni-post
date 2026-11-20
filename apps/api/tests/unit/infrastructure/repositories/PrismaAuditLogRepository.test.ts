/**
 * @file PrismaAuditLogRepository.test.ts
 * @description Unit tests for the Prisma adapter of the AuditLogRepository port.
 *              The Prisma client is stubbed with vi-mocked auditLog methods to
 *              assert the create payload (conditional inclusion of optional
 *              columns), query filters/pagination defaults, and user anonymization,
 *              and that create writes through the Unit of Work's transaction
 *              client when one is open.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaUnitOfWork } from "@adapters/db-prisma";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

/** A tenant provider that reports no context, so the Unit of Work binds no GUC. */
const NO_TENANT: ConstructorParameters<typeof PrismaUnitOfWork>[1] = {
  getTenantContext: () => undefined,
  getSystemContext: () => undefined,
};

const { PrismaAuditLogRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaAuditLogRepository.js");

interface MockPrisma {
  auditLog: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("PrismaAuditLogRepository", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaAuditLogRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaAuditLogRepository(prisma as never);
  });

  it("create writes action/details/success and omits absent optional columns", async () => {
    await repo.create({
      action: "USER_LOGIN",
      actorType: "SYSTEM",
      details: { category: "AUTHENTICATION" },
      success: true,
    });
    const data = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(data.action).toBe("USER_LOGIN");
    expect(data.success).toBe(true);
    expect(data.details).toEqual({ category: "AUTHENTICATION" });
    expect("userId" in data).toBe(false);
    expect("customerUserId" in data).toBe(false);
    expect("resource" in data).toBe(false);
    expect("ipAddress" in data).toBe(false);
  });

  it("create includes optional columns when provided", async () => {
    await repo.create({
      action: "RESOURCE_UPDATE",
      actorType: "ADMIN",
      resource: "AdminUser",
      resourceId: "u-1",
      userId: "actor-1",
      accountId: "acc-1",
      ipAddress: "1.2.3.4",
      userAgent: "agent",
      details: {},
      success: false,
    });
    const data = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(data.resource).toBe("AdminUser");
    expect(data.resourceId).toBe("u-1");
    expect(data.userId).toBe("actor-1");
    expect(data.accountId).toBe("acc-1");
    expect(data.ipAddress).toBe("1.2.3.4");
    expect(data.success).toBe(false);
  });

  it("create omits accountId when not provided (searchability is best-effort)", async () => {
    await repo.create({
      action: "SYSTEM_TICK",
      actorType: "SYSTEM",
      details: {},
      success: true,
    });
    const data = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect("accountId" in data).toBe(false);
  });

  it("create always writes actorType and maps customerUserId for a customer actor", async () => {
    await repo.create({
      action: "CUSTOMER_MFA_ENABLED",
      actorType: "CUSTOMER",
      customerUserId: "cust-1",
      accountId: "acc-1",
      details: {},
      success: true,
    });
    const data = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(data.actorType).toBe("CUSTOMER");
    expect(data.customerUserId).toBe("cust-1");
    expect("userId" in data).toBe(false);
  });

  it("anonymizeCustomerUser nulls only customerUserId via updateMany and returns the count", async () => {
    prisma.auditLog.updateMany.mockResolvedValue({ count: 3 });
    const count = await repo.anonymizeCustomerUser("cust-1");
    expect(prisma.auditLog.updateMany).toHaveBeenCalledWith({
      where: { customerUserId: "cust-1" },
      data: { customerUserId: null },
    });
    expect(count).toBe(3);
  });

  it("findByUser filters by userId with default pagination, newest first", async () => {
    await repo.findByUser("u-1");
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u-1" },
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      })
    );
  });

  it("findByUser applies action filter, date range, and limit/offset", async () => {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const endDate = new Date("2026-02-01T00:00:00Z");
    await repo.findByUser("u-1", {
      action: "USER_LOGIN",
      startDate,
      endDate,
      limit: 10,
      offset: 5,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u-1", action: "USER_LOGIN", createdAt: { gte: startDate, lte: endDate } },
        take: 10,
        skip: 5,
      })
    );
  });

  it("findByResource scopes the query to resource + resourceId", async () => {
    await repo.findByResource("Account", "a-1");
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resource: "Account", resourceId: "a-1" } })
    );
  });

  it("findByAccount scopes the query to accountId with default pagination", async () => {
    await repo.findByAccount("acc-1");
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: "acc-1" },
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      })
    );
  });

  it("findByAccount applies action filter, date range, and limit/offset", async () => {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const endDate = new Date("2026-02-01T00:00:00Z");
    await repo.findByAccount("acc-1", {
      action: "ACCOUNT_UPDATE",
      startDate,
      endDate,
      limit: 25,
      offset: 100,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: "acc-1",
          action: "ACCOUNT_UPDATE",
          createdAt: { gte: startDate, lte: endDate },
        },
        take: 25,
        skip: 100,
      })
    );
  });

  it("anonymizeUser nulls userId via updateMany and returns the count", async () => {
    prisma.auditLog.updateMany.mockResolvedValue({ count: 4 });
    const count = await repo.anonymizeUser("u-1");
    expect(prisma.auditLog.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-1" },
      data: { userId: null },
    });
    expect(count).toBe(4);
  });
});

describe("PrismaAuditLogRepository inside a unit of work", () => {
  let base: MockPrisma & { $transaction: ReturnType<typeof vi.fn> };
  let tx: MockPrisma;
  let repo: InstanceType<typeof PrismaAuditLogRepository>;

  beforeEach(() => {
    tx = makePrisma();
    // Prisma hands an interactive transaction its own client: a call on `tx` ran inside it.
    base = {
      ...makePrisma(),
      $transaction: vi.fn(async (work: (client: MockPrisma) => Promise<unknown>) => work(tx)),
    };
    repo = new PrismaAuditLogRepository(base as never);
  });

  it("writes the entry once through the transaction's client, and never through the base client, when create runs inside an open unit of work", async () => {
    const uow = new PrismaUnitOfWork(base as never, NO_TENANT);

    await uow.executeInTransaction(() =>
      repo.create({
        action: "FIRST_ADMINISTRATOR_CREATED",
        actorType: "SYSTEM",
        resource: "AdminUser",
        resourceId: "u-1",
        details: { task: "create-first-admin" },
        success: true,
      })
    );

    expect(base.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0]?.[0]?.data).toMatchObject({
      action: "FIRST_ADMINISTRATOR_CREATED",
      resourceId: "u-1",
    });
    expect(base.auditLog.create).not.toHaveBeenCalled();
  });
});
