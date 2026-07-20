/**
 * @file mfaBackupCodeSingleUse.integration.test.ts
 * @description Integration tests for backup-code single-use against a real
 *              Postgres. Proves the compare-and-swap `markBackupCodeUsed` closes
 *              the cross-challenge race the per-jti gate cannot: two concurrent
 *              verifications of the SAME backup code — the pre-auth threat the new
 *              public `POST /auth/customer/login/mfa` exposes when two step-1
 *              logins submit one code — resolve to EXACTLY ONE session. Two
 *              layers:
 *                - adapter: two concurrent `markBackupCodeUsed(id, index)` on the
 *                  real JSONB used-map resolve to one Ok + one ALREADY_USED (the
 *                  CAS `updateMany` is the serializer)
 *                - service: two concurrent `MfaService.verifyMfaToken` with the
 *                  same plaintext backup code yield exactly one verified success;
 *                  the loser is INVALID_TOKEN, never a second session
 *              Drives the real Prisma MFA adapters + the unified `MfaService`
 *              directly — no HTTP. Requires Postgres up (`pnpm db:up`); fails loud
 *              if `DATABASE_URL` is unset, per repo canon.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { authenticator } from "otplib";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { PrismaCustomerMfaUserRepository } from "../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { PrismaAdminMfaUserRepository } from "../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { MfaService } from "../../src/admin/auth/MfaService.js";
import { MFA_SUBJECT_TYPE } from "@ports/core";

interface Fixture {
  accountId: string;
  customerId: string;
}

describe("Backup-code single-use (integration)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;
  let customerRepo: PrismaCustomerMfaUserRepository;

  before(async () => {
    prisma = createTestPrismaClient();
    customerRepo = new PrismaCustomerMfaUserRepository(prisma);

    const tag = `mfa-backup-su-int-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Backup Single-Use Integration Account" },
    });
    const customer = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Backup",
        lastName: "Tester",
      },
    });

    fixture = { accountId: account.id, customerId: customer.id };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.auditLog.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    await prisma.$disconnect();
  });

  it("adapter: two concurrent markBackupCodeUsed of the same index resolve to one Ok + one ALREADY_USED", async () => {
    // Fresh row so the used-map starts empty ({} default) — both racers read the
    // same snapshot, so the JSONB-equals CAS decides the winner.
    const tag = `mfa-backup-adapter-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Backup Adapter CAS Account" },
    });
    const customer = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `adapter-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Adapter",
        lastName: "Tester",
      },
    });

    try {
      await customerRepo.saveEnrollment(customer.id, {
        mfaSecret: "SECRET-CAS",
        mfaBackupCodes: ["$argon2id$hashA", "$argon2id$hashB"],
      });

      const usedAt = new Date("2026-04-04T10:00:00.000Z");
      const [a, b] = await Promise.all([
        customerRepo.markBackupCodeUsed(customer.id, 0, usedAt),
        customerRepo.markBackupCodeUsed(customer.id, 0, usedAt),
      ]);

      const succeeded = [a, b].filter((r) => r.ok).length;
      const alreadyUsed = [a, b].filter((r) => !r.ok && r.error === "ALREADY_USED").length;
      assert.strictEqual(succeeded, 1, "exactly one concurrent mark wins");
      assert.strictEqual(alreadyUsed, 1, "the loser sees ALREADY_USED (single-use)");

      const row = await prisma.customerUser.findUniqueOrThrow({ where: { id: customer.id } });
      assert.deepStrictEqual(row.mfaBackupUsedAt, { "0": "2026-04-04T10:00:00.000Z" });
    } finally {
      await prisma.customerUser.deleteMany({ where: { accountId: account.id } });
      await prisma.account.delete({ where: { id: account.id } });
    }
  });

  it("service: two concurrent verifyMfaToken with the same backup code mint exactly one session", async () => {
    const customerRepoLocal = new PrismaCustomerMfaUserRepository(prisma);
    const adminRepo = new PrismaAdminMfaUserRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    const service = new MfaService(adminRepo, customerRepoLocal, auditRepo);
    const subject = { type: MFA_SUBJECT_TYPE.CUSTOMER, id: fixture.customerId } as const;

    // Enroll through the service so we hold the plaintext backup codes.
    const setup = await service.setupMfa(subject);
    assert.strictEqual(setup.ok, true);
    if (!setup.ok) return;
    const enabled = await service.verifyMfaSetup(
      subject,
      authenticator.generate(setup.value.secret)
    );
    assert.strictEqual(enabled.ok, true);

    const backupCode = setup.value.backupCodes[0]!;
    const [a, b] = await Promise.all([
      service.verifyMfaToken(subject, backupCode),
      service.verifyMfaToken(subject, backupCode),
    ]);

    const verified = [a, b].filter((r) => r.ok && r.value.verified).length;
    const rejected = [a, b].filter((r) => !r.ok && r.error === "INVALID_TOKEN").length;
    assert.strictEqual(verified, 1, "exactly one concurrent verification succeeds");
    assert.strictEqual(rejected, 1, "the loser is rejected as INVALID_TOKEN — no second session");

    // The used-map records the single consumed code exactly once.
    const found = await customerRepoLocal.findById(fixture.customerId);
    assert.strictEqual(found.ok, true);
    if (!found.ok) return;
    assert.strictEqual(Object.keys(found.value.mfaBackupUsedAt).length, 1);
  });
});
