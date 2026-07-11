/**
 * @file backfill-admin-mfa-backup-codes.ts
 * @description Data migration copying historical admin MFA backup-code hashes
 *              from the legacy `AdminUser.passwordResetToken` JSON blob into the
 *              canonical `AdminUser.mfaBackupCodes` column so the unified MFA
 *              service can read them. Idempotent (writes only when the target is
 *              empty), source-retaining (a separate cleanup step nulls the legacy
 *              value). Exposes `runBackfill`, `verifyIntegrity`, and `runCleanup`
 *              as import-safe functions taking an injected PrismaClient; the CLI
 *              runner executes only on direct invocation, never on import.
 * @layer infrastructure
 */
// canon-exception: migration:2026-07-11
import { pathToFileURL } from "node:url";
import { PrismaClient } from "../generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createLogger } from "@observability/logger";

const logger = createLogger("backfill-admin-mfa-backup-codes");

/** Rows fetched per page so a large AdminUser table is never loaded at once. */
const BATCH_SIZE = 200;

/**
 * @function parseLegacyBackupBlob
 * @description Decide whether a `passwordResetToken` value is a genuine legacy
 *              MFA backup-code blob and, if so, return its hashes. A value
 *              qualifies only when it is a non-empty JSON array whose every
 *              element is an Argon2id hash string. A genuine reset token (a UUID)
 *              or the `CHANGE_REQUIRED` sentinel fails the check and is skipped;
 *              a malformed value is caught and skipped, never thrown.
 * @param value - The raw `passwordResetToken` column value.
 * @returns The array of Argon2id hashes when the value qualifies, otherwise null.
 */
export function parseLegacyBackupBlob(value: string | null): string[] | null {
  if (value === null || !value.startsWith("[")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }
  const allArgon2id = parsed.every(
    (element): element is string => typeof element === "string" && element.startsWith("$argon2id$")
  );
  return allArgon2id ? (parsed as string[]) : null;
}

/**
 * @function runBackfill
 * @description Copy each qualifying legacy blob's hashes into `mfaBackupCodes`.
 *              Only rows whose `mfaBackupCodes` is still empty are written, so a
 *              re-run migrates nothing and pre-existing codes are never
 *              overwritten. The source `passwordResetToken` is retained.
 * @param prisma - Injected PrismaClient (test-owned in suites, CLI-owned in prod).
 * @returns Counts of rows migrated and rows skipped by the content guard.
 */
export async function runBackfill(
  prisma: PrismaClient
): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;
  let lastId = "";

  for (;;) {
    const rows = await prisma.adminUser.findMany({
      where: {
        passwordResetToken: { startsWith: "[" },
        mfaBackupCodes: { isEmpty: true },
        id: { gt: lastId },
      },
      select: { id: true, passwordResetToken: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      lastId = row.id;
      const hashes = parseLegacyBackupBlob(row.passwordResetToken);
      if (hashes === null) {
        skipped += 1;
        continue;
      }
      // The empty-target guard lives in the query, so a matching row here always
      // has an empty `mfaBackupCodes`. Copy the hashes across and keep the source
      // `passwordResetToken`; nulling it is the cleanup step's job.
      await prisma.adminUser.update({
        where: { id: row.id },
        data: { mfaBackupCodes: hashes },
      });
      migrated += 1;
    }
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  logger.info({ migrated, skipped }, "Admin MFA backup-code backfill complete");
  return { migrated, skipped };
}

/**
 * @function verifyIntegrity
 * @description Count, while the source is still retained, how many rows carry a
 *              guard-matching legacy blob (`sourceMatching`) and how many of those
 *              already hold the copied codes (`verifiedMigrated`). `verifiedMigrated`
 *              can never exceed `sourceMatching`.
 *
 *              `verifiedMigrated` is an END-STATE SNAPSHOT of legacy rows confirmed
 *              present in `mfaBackupCodes` — NOT the same thing as `runBackfill`'s
 *              `migrated`, which is a per-invocation DELTA (rows migrated by that one
 *              call). `verifiedMigrated === sourceMatching` means every retained
 *              legacy row has been migrated, i.e. it is safe to run `runCleanup`.
 * @param prisma - Injected PrismaClient.
 * @returns The source-matching population and the verified-migrated snapshot.
 */
export async function verifyIntegrity(
  prisma: PrismaClient
): Promise<{ sourceMatching: number; verifiedMigrated: number }> {
  let sourceMatching = 0;
  let verifiedMigrated = 0;
  let lastId = "";

  for (;;) {
    const rows = await prisma.adminUser.findMany({
      where: {
        passwordResetToken: { startsWith: "[" },
        id: { gt: lastId },
      },
      select: { id: true, passwordResetToken: true, mfaBackupCodes: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      lastId = row.id;
      if (parseLegacyBackupBlob(row.passwordResetToken) === null) {
        continue;
      }
      sourceMatching += 1;
      if (row.mfaBackupCodes.length > 0) {
        verifiedMigrated += 1;
      }
    }
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  logger.info({ sourceMatching, verifiedMigrated }, "Admin MFA backup-code backfill verification");
  return { sourceMatching, verifiedMigrated };
}

/**
 * @function runCleanup
 * @description Null the legacy `passwordResetToken` ONLY on rows where the guard
 *              matched AND the copied codes are already present. A pending reset
 *              token (a UUID) and the `CHANGE_REQUIRED` sentinel never match the
 *              guard, so they are never nulled.
 * @param prisma - Injected PrismaClient.
 * @returns The count of legacy sources cleaned.
 */
export async function runCleanup(prisma: PrismaClient): Promise<{ cleaned: number }> {
  let cleaned = 0;
  let lastId = "";

  for (;;) {
    const rows = await prisma.adminUser.findMany({
      where: {
        passwordResetToken: { startsWith: "[" },
        mfaBackupCodes: { isEmpty: false },
        id: { gt: lastId },
      },
      select: { id: true, passwordResetToken: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      lastId = row.id;
      if (parseLegacyBackupBlob(row.passwordResetToken) === null) {
        continue;
      }
      // Only guard-matched rows whose codes are already present reach here, so
      // nulling the legacy source is safe: a pending reset token is a UUID, not a
      // JSON array of Argon2id hashes, and never satisfies the guard.
      await prisma.adminUser.update({
        where: { id: row.id },
        data: { passwordResetToken: null },
      });
      cleaned += 1;
    }
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  logger.info({ cleaned }, "Admin MFA backup-code legacy-source cleanup complete");
  return { cleaned };
}

/**
 * @function isDirectRun
 * @description Whether this module was executed directly (e.g. `node --import tsx
 *              backfill-admin-mfa-backup-codes.ts`) rather than imported by another
 *              module such as the integration test. Keeps the exported functions
 *              import-safe: importing the module never connects to Postgres or exits.
 * @returns True when the process entry point is this module's own file.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

/**
 * @function main
 * @description CLI entry point. Builds a dedicated PrismaClient from
 *              `DATABASE_URL`, runs the backfill and the verification pass, and
 *              runs the legacy-source cleanup only when invoked with `--cleanup`.
 * @returns Resolves after the run completes; disconnects the client either way.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is required");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    logger.info("Starting admin MFA backup-code backfill");
    const backfill = await runBackfill(prisma);
    const verify = await verifyIntegrity(prisma);
    logger.info({ backfill, verify }, "Backfill and verification complete");

    if (process.argv.includes("--cleanup")) {
      const cleanup = await runCleanup(prisma);
      logger.info({ cleanup }, "Legacy-source cleanup complete");
    } else {
      logger.info(
        "Source passwordResetToken retained. Re-run with --cleanup once counts are reconciled."
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectRun()) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Admin MFA backup-code backfill failed"
      );
      process.exit(1);
    });
}
