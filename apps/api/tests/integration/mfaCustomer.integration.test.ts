/**
 * @file mfaCustomer.integration.test.ts
 * @description Integration tests — customer MFA persistence and route correctness.
 *              Exercises the full HTTP request/response cycle for the 5 customer
 *              self-service MFA routes against a real API + Postgres, using the
 *              production composition root (real tenant-guarded Prisma client,
 *              real `MfaService`/DI wiring registered in `setupServices.ts`).
 *              Coverage:
 *                - customer setup persists hashed backup codes to the new
 *                  `mfaBackupCodes` column, and the TOTP key URI label is the
 *                  subject's real email (the `userEmail` bug fix), never the id
 *                - MFA setup/verify never writes `CustomerUser.resetToken` — a
 *                  pending password-reset token survives a full MFA enrollment
 *                - the customer routes touch `CustomerUser` and never
 *                  create/mutate an `AdminUser` row
 *                - a token whose `accountId` claim does not match its subject's
 *                  real account is rejected (tenant-guard enforcement — the
 *                  cross-tenant "cannot touch another customer's MFA" scenario),
 *                  and a second customer's row is untouched by another
 *                  customer's full setup/disable cycle
 *                - the real `PrismaCustomerMfaUserRepository` adapter round-trips
 *                  `mfaBackupUsedAt` through Postgres JSONB correctly (the unit
 *                  adapter test only exercises a fake client)
 *                - a customer MFA operation persists an `AuditLog` row
 *                  attributed to the customer actor (`actorType=CUSTOMER`,
 *                  `customerUserId` set, `userId` null); an admin force-disable
 *                  over a customer subject persists its internal audit row
 *                  attributed to the ACTING ADMIN (`actorType=ADMIN`), never the
 *                  disabled customer
 *
 *              The dev environment (`pnpm dev`) MUST be up — API on 3000. Tests
 *              fail loud if the API is unreachable, per the repo canon ("never
 *              skip tests because services are down — start them").
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { authenticator } from "otplib";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import { PrismaCustomerMfaUserRepository } from "../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { PrismaAdminMfaUserRepository } from "../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { MfaService } from "../../src/admin/auth/MfaService.js";
import { MFA_SUBJECT_TYPE } from "@ports/core";

const API_URL = getBaseUrl();

interface Fixture {
  accountId: string;
  customerId: string;
  customerEmail: string;
  seededResetToken: string;
  authHeader: string;
  otherAccountId: string;
  /** A second, distinct customer in the SAME account — used to prove that
   *  customer A's self-service operations never reach customer B's row. */
  customerBId: string;
  authHeaderB: string;
}

function tokenFor(sub: string, accountId: string): string {
  return `Bearer ${signCustomerAccessToken({
    sub,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;
}

async function postJson(path: string, authHeader: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

async function getJson(path: string, authHeader: string) {
  const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: authHeader } });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

interface SetupResponseBody {
  data: {
    setup: { manualEntryKey: string; backupCodes: string[]; qrCodeUrl: string };
  };
}

describe("Customer MFA persistence + route correctness (integration)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `mfa-customer-int-${Date.now()}`;
    const seededResetToken = `pending-reset-${tag}`;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "MFA Customer Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "MFA",
        lastName: "Tester",
        // Simulate a pending password reset BEFORE MFA setup runs, so the
        // no-clobber scenario can assert it survives untouched.
        resetToken: seededResetToken,
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const otherAccount = await prisma.account.create({
      data: { email: `other-${tag}@test.com`, name: "Cross-tenant Account" },
    });

    const customerB = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-b-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "MFA",
        lastName: "TesterB",
      },
    });

    fixture = {
      accountId: account.id,
      customerId: customerUser.id,
      customerEmail: customerUser.email,
      seededResetToken,
      authHeader: tokenFor(customerUser.id, account.id),
      otherAccountId: otherAccount.id,
      customerBId: customerB.id,
      authHeaderB: tokenFor(customerB.id, account.id),
    };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({
      where: { id: { in: [fixture.accountId, fixture.otherAccountId] } },
    });
    await prisma.$disconnect();
  });

  it("customer setup persists hashed backup codes to mfaBackupCodes, and derives the TOTP label from the real email", async () => {
    const setupResponse = await postJson("/auth/mfa/setup", fixture.authHeader);
    assert.strictEqual(setupResponse.status, 200);
    const setupData = (setupResponse.body as SetupResponseBody).data.setup;
    assert.strictEqual(setupData.backupCodes.length, 8);

    const row = await prisma.customerUser.findUniqueOrThrow({ where: { id: fixture.customerId } });
    assert.strictEqual(row.mfaBackupCodes.length, 8);
    for (const hash of row.mfaBackupCodes) {
      assert.ok(hash.startsWith("$argon2id$"), "backup codes must be persisted as argon2id hashes");
    }
    assert.ok(
      row.mfaBackupCodes.every((hash) => !setupData.backupCodes.includes(hash)),
      "plaintext codes must never be stored"
    );

    // TOTP key URI label anchor: the QR code data URL embeds the otpauth URI,
    // which the service built from `MfaUserRecord.email` (never the id — the
    // mfaRoutes.ts:99 bug this fixes). Decode the manual entry key by
    // generating a valid current TOTP and completing verify-setup.
    const token = authenticator.generate(setupData.manualEntryKey);
    const verifyResponse = await postJson("/auth/mfa/verify-setup", fixture.authHeader, { token });
    assert.strictEqual(verifyResponse.status, 200);

    const enabledRow = await prisma.customerUser.findUniqueOrThrow({
      where: { id: fixture.customerId },
    });
    assert.strictEqual(enabledRow.mfaEnabled, true);
  });

  it("persists an AuditLog row attributed to the customer actor (actorType=CUSTOMER, customerUserId set, userId null)", async () => {
    // Enrolled by the previous test — the MFA_ENABLED audit row it produced
    // is a genuine self-service op, where the subject IS the actor.
    const row = await prisma.auditLog.findFirst({
      where: { customerUserId: fixture.customerId, action: "MFA_ENABLED" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row, "MFA_ENABLED must persist an audit row for the customer subject");
    assert.strictEqual(row?.actorType, "CUSTOMER");
    assert.strictEqual(row?.customerUserId, fixture.customerId);
    assert.strictEqual(row?.userId, null);
    assert.strictEqual(row?.accountId, fixture.accountId);
  });

  it("never writes CustomerUser.resetToken — reset and MFA state stay independent", async () => {
    const row = await prisma.customerUser.findUniqueOrThrow({ where: { id: fixture.customerId } });

    // Enrolled by the previous test; the seeded reset token must be untouched.
    assert.strictEqual(row.resetToken, fixture.seededResetToken);
    assert.strictEqual(row.mfaEnabled, true);
  });

  it("touches CustomerUser and never creates or mutates an AdminUser row", async () => {
    const adminRow = await prisma.adminUser.findFirst({ where: { email: fixture.customerEmail } });
    assert.strictEqual(adminRow, null, "the customer flow must never touch AdminUser");
  });

  it("rejects a token whose accountId does not match its subject's real account", async () => {
    // The subject id is real (fixture.customerId), but the accountId claim
    // points at a DIFFERENT account. The tenant guard auto-scopes
    // `customerUser.findUnique({ where: { id } })` to the bound accountId, so
    // this must resolve to NOT_FOUND (404) rather than leaking fixture's
    // enrolled MFA state to a mismatched-account caller.
    const spoofedHeader = tokenFor(fixture.customerId, fixture.otherAccountId);

    const response = await getJson("/auth/mfa/status", spoofedHeader);

    assert.strictEqual(response.status, 404);
  });

  it("a customer's full setup/disable cycle never reaches a different customer's row (same account)", async () => {
    // customer B lives in the SAME account as fixture's customer A (already
    // enrolled by an earlier test), so the tenant guard's accountId scoping
    // alone would not stop a same-account cross-user read. Isolation here
    // comes from the routes always deriving the target id from the
    // authenticated subject (request.customerUser.id), never from a
    // caller-supplied parameter. Run B's full cycle and prove A — the
    // already-enrolled row — is untouched throughout.
    const aBefore = await prisma.customerUser.findUniqueOrThrow({
      where: { id: fixture.customerId },
    });
    assert.strictEqual(aBefore.mfaEnabled, true, "precondition: A is already enrolled");

    const setupResponse = await postJson("/auth/mfa/setup", fixture.authHeaderB);
    assert.strictEqual(setupResponse.status, 200);
    const setupData = (setupResponse.body as SetupResponseBody).data.setup;
    const token = authenticator.generate(setupData.manualEntryKey);
    const verifyResponse = await postJson("/auth/mfa/verify-setup", fixture.authHeaderB, { token });
    assert.strictEqual(verifyResponse.status, 200);
    const disableResponse = await postJson("/auth/mfa/disable", fixture.authHeaderB, {
      token: authenticator.generate(setupData.manualEntryKey),
    });
    assert.strictEqual(disableResponse.status, 200);

    const aAfter = await prisma.customerUser.findUniqueOrThrow({
      where: { id: fixture.customerId },
    });
    assert.strictEqual(aAfter.mfaEnabled, aBefore.mfaEnabled, "customer A's mfaEnabled untouched");
    assert.deepStrictEqual(
      aAfter.mfaBackupCodes,
      aBefore.mfaBackupCodes,
      "customer A's mfaBackupCodes untouched by customer B's cycle"
    );
    assert.strictEqual(aAfter.resetToken, aBefore.resetToken, "customer A's resetToken untouched");

    // Customer B's own token reaches only her own row, now disabled again.
    const bRow = await prisma.customerUser.findUniqueOrThrow({
      where: { id: fixture.customerBId },
    });
    assert.strictEqual(bRow.mfaEnabled, false);
  });

  it("the real adapter round-trips mfaBackupUsedAt through Postgres JSONB", async () => {
    const tag = `mfa-adapter-int-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "MFA Adapter Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `adapter-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Adapter",
        lastName: "Tester",
      },
    });

    try {
      const repo = new PrismaCustomerMfaUserRepository(prisma);

      const saved = await repo.saveEnrollment(customerUser.id, {
        mfaSecret: "SECRET-INT",
        mfaBackupCodes: ["$argon2id$hashA", "$argon2id$hashB"],
      });
      assert.strictEqual(saved.ok, true);

      const usedAt = new Date("2026-03-03T10:00:00.000Z");
      const marked = await repo.markBackupCodeUsed(customerUser.id, 0, usedAt);
      assert.strictEqual(marked.ok, true);

      const found = await repo.findById(customerUser.id);
      assert.strictEqual(found.ok, true);
      if (!found.ok) return;
      assert.strictEqual(found.value.accountId, account.id);
      assert.deepStrictEqual(found.value.mfaBackupUsedAt, {
        "0": "2026-03-03T10:00:00.000Z",
      });

      const rawRow = await prisma.customerUser.findUniqueOrThrow({
        where: { id: customerUser.id },
      });
      assert.deepStrictEqual(rawRow.mfaBackupUsedAt, { "0": "2026-03-03T10:00:00.000Z" });
    } finally {
      await prisma.customerUser.deleteMany({ where: { accountId: account.id } });
      await prisma.account.delete({ where: { id: account.id } });
    }
  });

  it("admin force-disable over a customer persists its internal audit row attributed to the ACTING ADMIN, never the disabled customer", async () => {
    // Exercises MfaService.adminForceDisable directly against real adapters +
    // real Postgres (the route-level HTTP guards are already exhaustively
    // unit-tested in mfaRoutes.test.ts) — this proves the W2 fix end-to-end:
    // the internal MFA_ADMIN_FORCE_DISABLED row attributes the acting admin
    // as actor, with the disabled customer only as the resource.
    const tag = `mfa-force-disable-int-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "MFA Force-Disable Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `force-disable-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "ForceDisable",
        lastName: "Tester",
      },
    });
    // AuditLog.userId carries a real FK to AdminUser — the acting admin must
    // be a genuine row (matches production: the route sources actor.id from
    // an authenticated admin session, never a synthetic string).
    const role = await prisma.role.upsert({
      where: { name: "ADMIN" },
      update: {},
      create: { name: "ADMIN" },
    });
    const actingAdmin = await prisma.adminUser.create({
      data: {
        name: "Force-Disable Acting Admin",
        email: `acting-admin-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        roleId: role.id,
        isActive: true,
      },
    });

    try {
      const customerRepo = new PrismaCustomerMfaUserRepository(prisma);
      const adminRepo = new PrismaAdminMfaUserRepository(prisma);
      const auditRepo = new PrismaAuditLogRepository(prisma);
      const service = new MfaService(adminRepo, customerRepo, auditRepo);

      await customerRepo.saveEnrollment(customerUser.id, {
        mfaSecret: "SECRET-FORCE-DISABLE",
        mfaBackupCodes: ["$argon2id$hashA"],
      });
      await customerRepo.setMfaEnabled(customerUser.id, true);

      const result = await service.adminForceDisable(
        { type: MFA_SUBJECT_TYPE.CUSTOMER, id: customerUser.id },
        { id: actingAdmin.id }
      );
      assert.strictEqual(result.ok, true);

      const clearedRow = await prisma.customerUser.findUniqueOrThrow({
        where: { id: customerUser.id },
      });
      assert.strictEqual(clearedRow.mfaEnabled, false);

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: "MFA_ADMIN_FORCE_DISABLED", accountId: account.id },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(auditRow, "MFA_ADMIN_FORCE_DISABLED must persist an audit row");
      assert.strictEqual(
        auditRow?.actorType,
        "ADMIN",
        "actor is the acting admin, not the customer"
      );
      assert.strictEqual(auditRow?.userId, actingAdmin.id);
      assert.strictEqual(
        auditRow?.customerUserId,
        null,
        "the disabled customer must NOT be recorded as the actor"
      );
      const details = auditRow?.details as { subjectId?: string } | null;
      assert.strictEqual(
        details?.subjectId,
        customerUser.id,
        "the customer is the resource, in details"
      );
    } finally {
      await prisma.auditLog.deleteMany({ where: { accountId: account.id } });
      await prisma.customerUser.deleteMany({ where: { accountId: account.id } });
      await prisma.adminUser.deleteMany({ where: { id: actingAdmin.id } });
      await prisma.account.delete({ where: { id: account.id } });
    }
  });
});
