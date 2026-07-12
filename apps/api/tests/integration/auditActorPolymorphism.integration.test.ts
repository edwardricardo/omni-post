/**
 * @file auditActorPolymorphism.integration.test.ts
 * @description Real-database integration coverage for the polymorphic audit
 *              actor. Proves the write path a mocked unit test cannot: a
 *              customer-actor row persists and its FK resolves, the
 *              exclusive-arc CHECK rejects a dual-FK insert, deleting a
 *              CustomerUser nulls the FK (SetNull) yet retains the immutable
 *              evidence row, a system row persists with both actor FKs null, an
 *              admin row is unchanged, and DSAR anonymization nulls the customer
 *              FK while `actorType` survives.
 * @layer infrastructure
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { AuditService } from "../../src/audit/auditService.js";

// Actor-type literals asserted against the DB. The production discriminator is
// the const-object union AUDIT_ACTOR_TYPE (fitness #3); string literals here are
// assignable to it and keep this test decoupled from import timing.
const CUSTOMER = "CUSTOMER";
const ADMIN = "ADMIN";
const SYSTEM = "SYSTEM";

let accountId: string;
let customerUserId: string;
let adminUserId: string;
let roleId: string;
const createdAuditIds: string[] = [];

/** Resolve a role id by name, creating it if absent (roles are shared, not torn down). */
async function ensureRoleId(name: string): Promise<string> {
  const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  return role.id;
}

async function trackedAuditCreate(data: {
  action: string;
  actorType: string;
  userId?: string;
  customerUserId?: string;
  accountId?: string;
}): Promise<string> {
  const row = await prisma.auditLog.create({
    data: {
      action: data.action,
      actorType: data.actorType as never,
      details: {},
      success: true,
      ...(data.userId !== undefined && { userId: data.userId }),
      ...(data.customerUserId !== undefined && { customerUserId: data.customerUserId }),
      ...(data.accountId !== undefined && { accountId: data.accountId }),
    },
  });
  createdAuditIds.push(row.id);
  return row.id;
}

describe("AuditLog polymorphic actor — real database", () => {
  before(async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    roleId = await ensureRoleId("ADMIN");

    const account = await prisma.account.create({
      data: { email: `audit-actor-acct-${uniqueId}@example.com`, name: "Audit Actor Test Account" },
    });
    accountId = account.id;

    const customer = await prisma.customerUser.create({
      data: {
        accountId,
        email: `audit-actor-customer-${uniqueId}@example.com`,
        passwordHash: "hashed",
        firstName: "Cust",
        lastName: "Actor",
      },
    });
    customerUserId = customer.id;

    const admin = await prisma.adminUser.create({
      data: {
        name: "Audit Actor Admin",
        email: `audit-actor-admin-${uniqueId}@example.com`,
        passwordHash: "hashed",
        roleId,
        isActive: true,
      },
    });
    adminUserId = admin.id;
  });

  afterEach(async () => {
    if (createdAuditIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
      createdAuditIds.length = 0;
    }
  });

  after(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ customerUserId }, { userId: adminUserId }] },
    });
    await prisma.customerUser.deleteMany({ where: { id: customerUserId } });
    await prisma.adminUser.deleteMany({ where: { id: adminUserId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
  });

  it("persists a customer-actor row written through the repository and resolves the FK", async () => {
    const repo = new PrismaAuditLogRepository(prisma);

    await repo.create({
      action: "CUSTOMER_MFA_ENABLED",
      actorType: CUSTOMER,
      customerUserId,
      accountId,
      details: { method: "totp" },
      success: true,
    });

    const row = await prisma.auditLog.findFirst({
      where: { customerUserId, action: "CUSTOMER_MFA_ENABLED" },
      include: { customerUser: true },
    });
    assert.ok(row, "customer-actor audit row must persist");
    if (row) createdAuditIds.push(row.id);

    assert.equal(row?.actorType, CUSTOMER);
    assert.equal(row?.customerUserId, customerUserId);
    assert.equal(row?.userId, null);
    assert.equal(row?.customerUser?.id, customerUserId, "FK resolves to the CustomerUser");
  });

  it("rejects an insert that sets BOTH actor FKs via the exclusive-arc CHECK", async () => {
    await assert.rejects(
      () =>
        prisma.auditLog.create({
          data: {
            action: "DUAL_FK_ATTEMPT",
            actorType: ADMIN as never,
            userId: adminUserId,
            customerUserId,
            details: {},
            success: true,
          },
        }),
      (error: unknown) =>
        /AuditLog_actor_exclusive_arc_check|num_nonnulls|check constraint/i.test(String(error)),
      "dual-FK insert must violate the exclusive-arc CHECK, not silently persist"
    );
  });

  it("nulls the customer FK but retains the row when the CustomerUser is deleted (SetNull)", async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const ephemeral = await prisma.customerUser.create({
      data: {
        accountId,
        email: `audit-actor-ephemeral-${uniqueId}@example.com`,
        passwordHash: "hashed",
        firstName: "Ephemeral",
        lastName: "Customer",
      },
    });

    const auditId = await trackedAuditCreate({
      action: "CUSTOMER_SETNULL_PROBE",
      actorType: CUSTOMER,
      customerUserId: ephemeral.id,
      accountId,
    });

    await prisma.customerUser.delete({ where: { id: ephemeral.id } });

    const row = await prisma.auditLog.findUnique({ where: { id: auditId } });
    assert.ok(row, "audit row must survive the CustomerUser deletion");
    assert.equal(row?.customerUserId, null, "FK nulled by onDelete: SetNull");
    assert.equal(row?.actorType, CUSTOMER, "actorType attribution survives the delete");
  });

  it("persists a system row with both actor FKs null and actorType SYSTEM", async () => {
    const repo = new PrismaAuditLogRepository(prisma);

    await repo.create({
      action: "SYSTEM_AUTO_RENEWAL",
      actorType: SYSTEM,
      accountId,
      details: { amount: 1000 },
      success: true,
    });

    const row = await prisma.auditLog.findFirst({
      where: { accountId, action: "SYSTEM_AUTO_RENEWAL" },
    });
    assert.ok(row);
    if (row) createdAuditIds.push(row.id);
    assert.equal(row?.userId, null);
    assert.equal(row?.customerUserId, null);
    assert.equal(row?.actorType, SYSTEM);
  });

  it("persists an admin-actor row unchanged (userId set, customerUserId null, actorType ADMIN)", async () => {
    const repo = new PrismaAuditLogRepository(prisma);

    await repo.create({
      action: "ADMIN_LOGIN",
      actorType: ADMIN,
      userId: adminUserId,
      details: {},
      success: true,
    });

    const row = await prisma.auditLog.findFirst({
      where: { userId: adminUserId, action: "ADMIN_LOGIN" },
    });
    assert.ok(row);
    if (row) createdAuditIds.push(row.id);
    assert.equal(row?.userId, adminUserId);
    assert.equal(row?.customerUserId, null);
    assert.equal(row?.actorType, ADMIN);
  });

  it("getLogs resolves the CUSTOMER actor identity against the real relation", async () => {
    const auditService = new AuditService(prisma);

    await trackedAuditCreate({
      action: "A2_READPATH_CUSTOMER_LOGIN",
      actorType: CUSTOMER,
      customerUserId,
      accountId,
    });

    const result = await auditService.getLogs({ action: "A2_READPATH_CUSTOMER_LOGIN" });

    assert.ok(result.ok, "getLogs must succeed");
    const row = result.value.find((log) => log.customerUserId === customerUserId);
    assert.ok(row, "the customer-actor row must be returned");
    assert.equal(row?.actorType, CUSTOMER);
    assert.equal(row?.customerUser?.id, customerUserId, "the customer relation resolves");
    assert.ok(
      row?.customerUser?.email.startsWith("audit-actor-customer-"),
      "the customer actor exposes its identity, not a null user"
    );
    assert.equal(row?.user ?? null, null, "no AdminUser is attached to a customer row");
  });

  it("getStats counts a customer actor by identity and keeps SYSTEM rows distinguishable", async () => {
    const auditService = new AuditService(prisma);

    await trackedAuditCreate({
      action: "A2_STATS_CUSTOMER_ONE",
      actorType: CUSTOMER,
      customerUserId,
      accountId,
    });
    await trackedAuditCreate({
      action: "A2_STATS_CUSTOMER_TWO",
      actorType: CUSTOMER,
      customerUserId,
      accountId,
    });
    await trackedAuditCreate({ action: "A2_STATS_ADMIN", actorType: ADMIN, userId: adminUserId });
    await trackedAuditCreate({ action: "A2_STATS_SYSTEM", actorType: SYSTEM, accountId });

    const result = await auditService.getStats({ action: "A2_STATS_" });

    assert.ok(result.ok, "getStats must succeed");
    assert.deepEqual(
      result.value.byActorType,
      { SYSTEM: 1, ADMIN: 1, CUSTOMER: 2 },
      "system rows stay distinguishable from customer rows via actorType"
    );

    assert.equal(result.value.topCustomerUsers.length, 1, "one customer identity is counted");
    assert.equal(result.value.topCustomerUsers[0]?.count, 2);
    assert.equal(result.value.topCustomerUsers[0]?.user, "Cust Actor");

    assert.equal(result.value.topUsers.length, 1, "the admin bucket still counts only admins");
    assert.equal(result.value.topUsers[0]?.user, "Audit Actor Admin");
    assert.equal(result.value.topUsers[0]?.count, 1);
  });

  it("anonymizeCustomerUser nulls the customer FK while actorType stays CUSTOMER (DSAR)", async () => {
    const repo = new PrismaAuditLogRepository(prisma);

    const auditId = await trackedAuditCreate({
      action: "CUSTOMER_DSAR_PROBE",
      actorType: CUSTOMER,
      customerUserId,
      accountId,
    });

    const count = await repo.anonymizeCustomerUser(customerUserId);
    assert.ok(count >= 1, "at least the probe row is anonymized");

    const row = await prisma.auditLog.findUnique({ where: { id: auditId } });
    assert.ok(row);
    assert.equal(row?.customerUserId, null, "customer FK nulled by DSAR anonymization");
    assert.equal(row?.actorType, CUSTOMER, "actorType attribution survives anonymization");
  });
});
