/**
 * @file backfillAdminMfaBackupCodes.integration.test.ts
 * @description Integration contract for the admin MFA backup-code backfill.
 * @layer infrastructure
 *
 *              Drives the data-migration script
 *              `infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts` directly
 *              against a real Postgres (no HTTP), exercising its injected-Prisma
 *              entry points (`runBackfill` / `verifyIntegrity` / `runCleanup`).
 *              The script copies historical hashes from the legacy
 *              `passwordResetToken` blob into `mfaBackupCodes` so the unified MFA
 *              service — which reads hashes from `mfaBackupCodes` — can serve
 *              admins enrolled before the column existed.
 *
 *              This suite GUARDS the behavior a data migration must not regress:
 *                - IDEMPOTENCY: a legacy row (`passwordResetToken` = a JSON array
 *                  of `$argon2id$` hashes, empty `mfaBackupCodes`) is migrated once
 *                  into `mfaBackupCodes`; a re-run is a no-op
 *                - SOURCE RETENTION: the backfill step leaves `passwordResetToken`
 *                  intact (nulling it is the separate cleanup step's job)
 *                - EMPTY-TARGET-ONLY WRITES / NEVER-OVERWRITE: a row that already
 *                  has non-empty `mfaBackupCodes` is skipped — its codes are never
 *                  overwritten by the legacy source
 *                - SENTINEL SAFETY: a genuine reset token (a UUID v4) and the
 *                  `"CHANGE_REQUIRED"` sentinel are skipped, untouched
 *                - VERIFICATION: `verifyIntegrity` reports source-matching vs
 *                  migrated counts while the source is still retained
 *                - CLEANUP GUARDS: the cleanup step nulls `passwordResetToken` ONLY
 *                  where the guard matched AND `mfaBackupCodes` is non-empty; a
 *                  pending reset token and the sentinel are never nulled
 *
 *              Requires Postgres up (`pnpm db:up`); fails loud if `DATABASE_URL`
 *              is unset, per repo canon ("never skip tests because services are
 *              down — start them").
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
// The three named exports each receive an injected PrismaClient, so the suite
// drives them against a test-owned client; the module's CLI `main()` runner is
// guarded to run only on direct invocation, so importing here never connects.
import {
  runBackfill,
  verifyIntegrity,
  runCleanup,
} from "../../../../infra/prisma/scripts/backfill-admin-mfa-backup-codes.js";

/** Two realistic Argon2id hashes as the legacy service would have stored them. */
const LEGACY_HASH_A =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEFBQUFBQUFBQQ$aGFzaEFBQUFBQUFBQUFBQUFBQUFBQQ";
const LEGACY_HASH_B =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEJCQkJCQkJCQg$aGFzaEJCQkJCQkJCQkJCQkJCQkJCQg";
/** A hash already present in a skip-migrated row's `mfaBackupCodes`. */
const EXISTING_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEVYSVNUSU5H$aGFzaEVYSVNUSU5HRVhJU1RJTkc";

/** Legacy on-disk shape: a JSON-encoded array of Argon2id hashes. */
const LEGACY_BLOB = JSON.stringify([LEGACY_HASH_A, LEGACY_HASH_B]);

interface Fixture {
  roleId: string;
  legacyAdminId: string;
  resetTokenAdminId: string;
  sentinelAdminId: string;
  alreadyMigratedAdminId: string;
  genuineResetToken: string;
}

describe("Admin MFA backup-code backfill (integration)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    prisma = createTestPrismaClient();
    const tag = `mfa-backfill-int-${Date.now()}`;

    const role = await prisma.role.upsert({
      where: { name: "ADMIN" },
      update: {},
      create: { name: "ADMIN" },
    });

    // A genuine, still-pending password-reset token (UUID v4) — must be skipped
    // by the migration guard and never nulled by cleanup.
    const genuineResetToken = randomUUID();

    const legacyAdmin = await prisma.adminUser.create({
      data: {
        name: "Legacy Enrolled Admin",
        email: `legacy-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        roleId: role.id,
        mfaEnabled: true,
        mfaSecret: "SEEDEDSECRETLEGACY",
        passwordResetToken: LEGACY_BLOB,
        mfaBackupCodes: [],
      },
    });
    const resetTokenAdmin = await prisma.adminUser.create({
      data: {
        name: "Pending Reset Admin",
        email: `reset-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        roleId: role.id,
        passwordResetToken: genuineResetToken,
        mfaBackupCodes: [],
      },
    });
    const sentinelAdmin = await prisma.adminUser.create({
      data: {
        name: "Change-Required Sentinel Admin",
        email: `sentinel-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        roleId: role.id,
        passwordResetToken: "CHANGE_REQUIRED",
        mfaBackupCodes: [],
      },
    });
    const alreadyMigratedAdmin = await prisma.adminUser.create({
      data: {
        name: "Already Migrated Admin",
        email: `migrated-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        roleId: role.id,
        mfaEnabled: true,
        mfaSecret: "SEEDEDSECRETMIGRATED",
        // Source is legacy-shaped, but codes already exist → must be left alone.
        passwordResetToken: LEGACY_BLOB,
        mfaBackupCodes: [EXISTING_HASH],
      },
    });

    fixture = {
      roleId: role.id,
      legacyAdminId: legacyAdmin.id,
      resetTokenAdminId: resetTokenAdmin.id,
      sentinelAdminId: sentinelAdmin.id,
      alreadyMigratedAdminId: alreadyMigratedAdmin.id,
      genuineResetToken,
    };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.adminUser.deleteMany({
      where: {
        id: {
          in: [
            fixture.legacyAdminId,
            fixture.resetTokenAdminId,
            fixture.sentinelAdminId,
            fixture.alreadyMigratedAdminId,
          ],
        },
      },
    });
    await prisma.$disconnect();
  });

  it("migrates a legacy row's hashes into mfaBackupCodes and retains the source", async () => {
    const result = await runBackfill(prisma);
    // At least our seeded legacy row is migrated (global count tolerates residue).
    assert.ok(result.migrated >= 1, "backfill migrated at least the seeded legacy row");

    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.legacyAdminId },
    });
    assert.deepStrictEqual(
      row.mfaBackupCodes,
      [LEGACY_HASH_A, LEGACY_HASH_B],
      "mfaBackupCodes holds the exact hashes from the legacy passwordResetToken blob"
    );
    assert.strictEqual(
      row.passwordResetToken,
      LEGACY_BLOB,
      "backfill retains the source passwordResetToken (cleanup is a separate step)"
    );
  });

  it("is idempotent: a re-run does not re-migrate an already-migrated row", async () => {
    const before = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.legacyAdminId },
    });
    await runBackfill(prisma);
    const after = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.legacyAdminId },
    });
    assert.deepStrictEqual(
      after.mfaBackupCodes,
      before.mfaBackupCodes,
      "a second backfill leaves the already-migrated codes unchanged"
    );
  });

  it("skips a genuine reset token (UUID v4) untouched", async () => {
    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.resetTokenAdminId },
    });
    assert.deepStrictEqual(row.mfaBackupCodes, [], "reset-token row gets no backup codes");
    assert.strictEqual(
      row.passwordResetToken,
      fixture.genuineResetToken,
      "the genuine reset token is left intact"
    );
  });

  it("skips the CHANGE_REQUIRED sentinel untouched", async () => {
    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.sentinelAdminId },
    });
    assert.deepStrictEqual(row.mfaBackupCodes, [], "sentinel row gets no backup codes");
    assert.strictEqual(
      row.passwordResetToken,
      "CHANGE_REQUIRED",
      "the CHANGE_REQUIRED sentinel is left intact"
    );
  });

  it("skips a row that already has backup codes (skip-migrated, never overwritten)", async () => {
    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.alreadyMigratedAdminId },
    });
    assert.deepStrictEqual(
      row.mfaBackupCodes,
      [EXISTING_HASH],
      "pre-existing mfaBackupCodes are never overwritten by the legacy source"
    );
  });

  it("verifyIntegrity reports source-matching vs migrated counts while the source is retained", async () => {
    const verify = await verifyIntegrity(prisma);
    assert.strictEqual(typeof verify.sourceMatching, "number", "sourceMatching is numeric");
    assert.strictEqual(typeof verify.verifiedMigrated, "number", "verifiedMigrated is numeric");
    assert.ok(
      verify.verifiedMigrated <= verify.sourceMatching,
      "verifiedMigrated can never exceed the source-matching population"
    );
    assert.ok(
      verify.sourceMatching >= 1,
      "the retained legacy source rows are counted while still present"
    );
  });

  it("cleanup nulls the source only where the guard matched AND codes are present; a pending reset token is never nulled", async () => {
    await runCleanup(prisma);

    const migrated = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.legacyAdminId },
    });
    assert.strictEqual(
      migrated.passwordResetToken,
      null,
      "the migrated legacy source is nulled once its codes are present"
    );

    const pending = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.resetTokenAdminId },
    });
    assert.strictEqual(
      pending.passwordResetToken,
      fixture.genuineResetToken,
      "a pending reset token is NEVER nulled by cleanup"
    );

    const sentinel = await prisma.adminUser.findUniqueOrThrow({
      where: { id: fixture.sentinelAdminId },
    });
    assert.strictEqual(
      sentinel.passwordResetToken,
      "CHANGE_REQUIRED",
      "the sentinel is NEVER nulled by cleanup"
    );
  });
});
