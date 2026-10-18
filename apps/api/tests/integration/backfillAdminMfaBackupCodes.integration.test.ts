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
 *              Each case seeds the admin rows it reads and runs every step it
 *              depends on, and its rows are removed after it, so the cases hold
 *              in any order and on an empty database.
 *
 *              Requires Postgres up (`pnpm db:up`); fails loud if `DATABASE_URL`
 *              is unset, per repo canon ("never skip tests because services are
 *              down — start them").
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
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

/** The columns that make a seeded admin row the case under test. */
interface AdminRowFields {
  name: string;
  passwordResetToken: string;
  mfaBackupCodes: string[];
  mfaEnabled?: boolean;
  mfaSecret?: string;
}

/** A legacy-enrolled admin: the hashes sit in the `passwordResetToken` blob, no codes yet. */
const legacyRow = (): AdminRowFields => ({
  name: "Legacy Enrolled Admin",
  mfaEnabled: true,
  mfaSecret: "SEEDEDSECRETLEGACY",
  passwordResetToken: LEGACY_BLOB,
  mfaBackupCodes: [],
});

/**
 * An admin with a genuine, still-pending password-reset token (UUID v4) — must be skipped
 * by the migration guard and never nulled by cleanup.
 */
const resetTokenRow = (genuineResetToken: string): AdminRowFields => ({
  name: "Pending Reset Admin",
  passwordResetToken: genuineResetToken,
  mfaBackupCodes: [],
});

/** An admin carrying the `CHANGE_REQUIRED` sentinel instead of a token. */
const sentinelRow = (): AdminRowFields => ({
  name: "Change-Required Sentinel Admin",
  passwordResetToken: "CHANGE_REQUIRED",
  mfaBackupCodes: [],
});

/** Source is legacy-shaped, but codes already exist → must be left alone. */
const alreadyMigratedRow = (): AdminRowFields => ({
  name: "Already Migrated Admin",
  mfaEnabled: true,
  mfaSecret: "SEEDEDSECRETMIGRATED",
  passwordResetToken: LEGACY_BLOB,
  mfaBackupCodes: [EXISTING_HASH],
});

describe("Admin MFA backup-code backfill (integration)", () => {
  let prisma: PrismaClient;
  let roleId: string;
  /** Set only when the suite had to create the ADMIN role, so `after` removes what it added. */
  let createdRoleId: string | undefined;
  /** The admin rows the running case seeded; removed after each case. */
  const seededAdminIds: string[] = [];

  /** Seeds one admin row for the running case and returns its id. */
  async function seedAdmin(fields: AdminRowFields): Promise<string> {
    const admin = await prisma.adminUser.create({
      data: {
        email: `mfa-backfill-int-${randomUUID()}@test.com`,
        passwordHash: "ignored-for-test",
        roleId,
        ...fields,
      },
    });
    seededAdminIds.push(admin.id);
    return admin.id;
  }

  /** Reads one seeded admin row back as the database holds it now. */
  async function readAdmin(id: string) {
    return prisma.adminUser.findUniqueOrThrow({ where: { id } });
  }

  before(async () => {
    prisma = createSeedPrismaClient();
    const existingRole = await prisma.role.findUnique({ where: { name: "ADMIN" } });
    if (existingRole) {
      roleId = existingRole.id;
    } else {
      const role = await prisma.role.create({ data: { name: "ADMIN" } });
      roleId = role.id;
      createdRoleId = role.id;
    }
  });

  afterEach(async () => {
    await prisma.adminUser.deleteMany({ where: { id: { in: seededAdminIds.splice(0) } } });
  });

  after(async () => {
    if (createdRoleId !== undefined) {
      await prisma.role.delete({ where: { id: createdRoleId } });
    }
    await prisma.$disconnect();
  });

  it("migrates a legacy row's hashes into mfaBackupCodes and retains the source", async () => {
    const legacyAdminId = await seedAdmin(legacyRow());

    const result = await runBackfill(prisma);

    // At least our seeded legacy row is migrated (global count tolerates residue).
    assert.ok(result.migrated >= 1, "backfill migrated at least the seeded legacy row");
    const row = await readAdmin(legacyAdminId);
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
    const legacyAdminId = await seedAdmin(legacyRow());
    await runBackfill(prisma);
    const afterFirstRun = await readAdmin(legacyAdminId);
    assert.deepStrictEqual(
      afterFirstRun.mfaBackupCodes,
      [LEGACY_HASH_A, LEGACY_HASH_B],
      "arrange: the first backfill migrated the seeded legacy row"
    );

    await runBackfill(prisma);

    const afterSecondRun = await readAdmin(legacyAdminId);
    assert.deepStrictEqual(
      afterSecondRun.mfaBackupCodes,
      afterFirstRun.mfaBackupCodes,
      "a second backfill leaves the already-migrated codes unchanged"
    );
  });

  it("skips a genuine reset token (UUID v4) untouched", async () => {
    const genuineResetToken = randomUUID();
    const resetTokenAdminId = await seedAdmin(resetTokenRow(genuineResetToken));

    await runBackfill(prisma);

    const row = await readAdmin(resetTokenAdminId);
    assert.deepStrictEqual(row.mfaBackupCodes, [], "reset-token row gets no backup codes");
    assert.strictEqual(
      row.passwordResetToken,
      genuineResetToken,
      "the genuine reset token is left intact"
    );
  });

  it("skips the CHANGE_REQUIRED sentinel untouched", async () => {
    const sentinelAdminId = await seedAdmin(sentinelRow());

    await runBackfill(prisma);

    const row = await readAdmin(sentinelAdminId);
    assert.deepStrictEqual(row.mfaBackupCodes, [], "sentinel row gets no backup codes");
    assert.strictEqual(
      row.passwordResetToken,
      "CHANGE_REQUIRED",
      "the CHANGE_REQUIRED sentinel is left intact"
    );
  });

  it("skips a row that already has backup codes (skip-migrated, never overwritten)", async () => {
    const alreadyMigratedAdminId = await seedAdmin(alreadyMigratedRow());

    await runBackfill(prisma);

    const row = await readAdmin(alreadyMigratedAdminId);
    assert.deepStrictEqual(
      row.mfaBackupCodes,
      [EXISTING_HASH],
      "pre-existing mfaBackupCodes are never overwritten by the legacy source"
    );
  });

  it("verifyIntegrity reports source-matching vs migrated counts while the source is retained", async () => {
    await seedAdmin(legacyRow());
    await runBackfill(prisma);

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
    const legacyAdminId = await seedAdmin(legacyRow());
    const genuineResetToken = randomUUID();
    const resetTokenAdminId = await seedAdmin(resetTokenRow(genuineResetToken));
    const sentinelAdminId = await seedAdmin(sentinelRow());
    await runBackfill(prisma);

    await runCleanup(prisma);

    const migrated = await readAdmin(legacyAdminId);
    assert.strictEqual(
      migrated.passwordResetToken,
      null,
      "the migrated legacy source is nulled once its codes are present"
    );

    const pending = await readAdmin(resetTokenAdminId);
    assert.strictEqual(
      pending.passwordResetToken,
      genuineResetToken,
      "a pending reset token is NEVER nulled by cleanup"
    );

    const sentinel = await readAdmin(sentinelAdminId);
    assert.strictEqual(
      sentinel.passwordResetToken,
      "CHANGE_REQUIRED",
      "the sentinel is NEVER nulled by cleanup"
    );
  });
});
