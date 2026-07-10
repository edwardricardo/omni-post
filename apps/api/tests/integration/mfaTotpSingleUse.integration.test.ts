/**
 * @file mfaTotpSingleUse.integration.test.ts
 * @description Integration tests for the TOTP single-use claim against a real
 *              Postgres (mfa-consolidation PR2b-1). Drives the real
 *              Prisma MFA adapters (admin + customer) directly — no HTTP — to prove
 *              the `claimTotpStep` compare-and-set contract end to end on the
 *              database: a fresh step is CLAIMED, the same step is ALREADY_USED, a
 *              strictly-greater step is CLAIMED (no lockout), an unknown id is
 *              NOT_FOUND, and two concurrent claims of the same step resolve to
 *              exactly one CLAIMED (the conditional single-statement UPDATE is the
 *              serializer). Requires Postgres up (`pnpm db:up`); fails loud if
 *              `DATABASE_URL` is unset, per repo canon.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { PrismaAdminMfaUserRepository } from "../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";

interface Fixture {
  accountId: string;
  customerId: string;
  adminId: string;
  roleId: string;
}

describe("TOTP single-use claim (integration)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;
  let adminRepo: PrismaAdminMfaUserRepository;
  let customerRepo: PrismaCustomerMfaUserRepository;

  before(async () => {
    prisma = createTestPrismaClient();
    adminRepo = new PrismaAdminMfaUserRepository(prisma);
    customerRepo = new PrismaCustomerMfaUserRepository(prisma);

    const tag = `mfa-totp-su-int-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "TOTP Single-Use Integration Account" },
    });
    const customer = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Totp",
        lastName: "Tester",
      },
    });
    const role = await prisma.role.upsert({
      where: { name: "ADMIN" },
      update: {},
      create: { name: "ADMIN" },
    });
    const admin = await prisma.adminUser.create({
      data: {
        name: "TOTP Single-Use Admin",
        email: `admin-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        roleId: role.id,
        isActive: true,
      },
    });

    fixture = {
      accountId: account.id,
      customerId: customer.id,
      adminId: admin.id,
      roleId: role.id,
    };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.adminUser.deleteMany({ where: { id: fixture.adminId } });
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    await prisma.$disconnect();
  });

  it("admin: claims a fresh step, rejects the replay, then accepts a strictly-greater step", async () => {
    const first = await adminRepo.claimTotpStep(fixture.adminId, 1000);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.ok && first.value, "CLAIMED");

    const replay = await adminRepo.claimTotpStep(fixture.adminId, 1000);
    assert.strictEqual(replay.ok, false);
    assert.strictEqual(!replay.ok && replay.error, "ALREADY_USED");

    const older = await adminRepo.claimTotpStep(fixture.adminId, 999);
    assert.strictEqual(!older.ok && older.error, "ALREADY_USED");

    const next = await adminRepo.claimTotpStep(fixture.adminId, 1001);
    assert.strictEqual(next.ok, true);
    assert.strictEqual(next.ok && next.value, "CLAIMED");

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: fixture.adminId } });
    assert.strictEqual(row.mfaLastUsedTotpStep, 1001);
  });

  it("customer: claims a fresh step, rejects the replay, then accepts a strictly-greater step", async () => {
    const first = await customerRepo.claimTotpStep(fixture.customerId, 2000);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.ok && first.value, "CLAIMED");

    const replay = await customerRepo.claimTotpStep(fixture.customerId, 2000);
    assert.strictEqual(!replay.ok && replay.error, "ALREADY_USED");

    const next = await customerRepo.claimTotpStep(fixture.customerId, 2001);
    assert.strictEqual(next.ok, true);
    assert.strictEqual(next.ok && next.value, "CLAIMED");

    const row = await prisma.customerUser.findUniqueOrThrow({ where: { id: fixture.customerId } });
    assert.strictEqual(row.mfaLastUsedTotpStep, 2001);
  });

  it("returns NOT_FOUND for an unknown id (both adapters)", async () => {
    const admin = await adminRepo.claimTotpStep("00000000-0000-0000-0000-000000000000", 1);
    assert.strictEqual(!admin.ok && admin.error, "NOT_FOUND");

    const customer = await customerRepo.claimTotpStep("00000000-0000-0000-0000-000000000000", 1);
    assert.strictEqual(!customer.ok && customer.error, "NOT_FOUND");
  });

  it("two concurrent claims of the same step resolve to exactly one CLAIMED", async () => {
    // Use a step strictly greater than any prior claim on the admin row so both
    // racers start from an eligible state.
    const step = 5000;
    const [a, b] = await Promise.all([
      adminRepo.claimTotpStep(fixture.adminId, step),
      adminRepo.claimTotpStep(fixture.adminId, step),
    ]);

    const claimed = [a, b].filter((r) => r.ok).length;
    const alreadyUsed = [a, b].filter((r) => !r.ok && r.error === "ALREADY_USED").length;
    assert.strictEqual(claimed, 1, "exactly one concurrent claim wins");
    assert.strictEqual(alreadyUsed, 1, "the loser sees ALREADY_USED");

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: fixture.adminId } });
    assert.strictEqual(row.mfaLastUsedTotpStep, step);
  });
});
