/**
 * @file backfillAdminMfaBackupCodesIsolation.test.ts
 * @description Pure unit test for the per-row fault isolation of the admin MFA
 *              backup-code backfill (`runBackfill` / `runCleanup`). It injects a
 *              mocked PrismaClient whose `update` rejects for exactly one poison
 *              row and resolves for the others, then asserts the tally contract:
 *              one failing row is counted and skipped while the loop CONTINUES to
 *              process every remaining row (no whole-run abort). A mocked client is
 *              used because the write is a single-column update with no plausible
 *              DB-level constraint to violate deterministically, and `runBackfill`
 *              exposes no seam to delete a row between page fetch and update — so a
 *              mock is the only deterministic way to inject a single-row fault. The
 *              integration suite covers the real-DB behavioral contract (idempotency,
 *              guards, cleanup); this suite covers the failure path, DB-free.
 * @layer infrastructure
 */

import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import {
  runBackfill,
  runCleanup,
} from "../../../../infra/prisma/scripts/backfill-admin-mfa-backup-codes.js";

const HASH_A = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEFBQUFBQUFBQQ$aGFzaEFBQUFBQUFBQUFBQUFBQUFBQQ";
const HASH_B = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEJCQkJCQkJCQg$aGFzaEJCQkJCQkJCQkJCQkJCQkJCQg";
const LEGACY_BLOB = JSON.stringify([HASH_A, HASH_B]);
const POISON_ID = "row-poison";

interface Row {
  id: string;
  passwordResetToken: string;
}

/** Three guard-matching rows: the middle one is the injected poison row. */
const makeRows = (): Row[] => [
  { id: "row-a", passwordResetToken: LEGACY_BLOB },
  { id: POISON_ID, passwordResetToken: LEGACY_BLOB },
  { id: "row-c", passwordResetToken: LEGACY_BLOB },
];

/**
 * Build a PrismaClient mock whose `adminUser.update` rejects for POISON_ID and
 * resolves otherwise. `findMany` returns a single page (< BATCH_SIZE) so the
 * keyset loop terminates after one pass; the same rows are returned regardless of
 * the `where` clause, which is all the tally contract needs.
 */
const makePrismaMock = (): {
  prisma: PrismaClient;
  update: ReturnType<typeof vi.fn>;
} => {
  const rows = makeRows();
  const findMany = vi.fn(async () => rows);
  const update = vi.fn(async ({ where }: { where: { id: string } }) => {
    if (where.id === POISON_ID) {
      throw new Error("simulated poison row (concurrently deleted / constraint violation)");
    }
    return {};
  });
  const prisma = { adminUser: { findMany, update } } as unknown as PrismaClient;
  return { prisma, update };
};

describe("Admin MFA backup-code backfill — per-row fault isolation", () => {
  it("runBackfill counts one failing row and migrates the rest instead of aborting", async () => {
    const { prisma, update } = makePrismaMock();

    const result = await runBackfill(prisma);

    assert.strictEqual(result.processed, 3, "every fetched row is processed");
    assert.strictEqual(result.migrated, 2, "the two healthy rows migrate");
    assert.strictEqual(result.failed, 1, "the poison row is counted as failed");
    assert.strictEqual(result.skipped, 0, "no guard-mismatch skips in this fixture");
    assert.strictEqual(
      update.mock.calls.length,
      3,
      "the loop attempts every row — it does not abort at the poison row"
    );
  });

  it("runCleanup counts one failing row and cleans the rest instead of aborting", async () => {
    const { prisma, update } = makePrismaMock();

    const result = await runCleanup(prisma);

    assert.strictEqual(result.processed, 3, "every fetched row is processed");
    assert.strictEqual(result.cleaned, 2, "the two healthy sources are nulled");
    assert.strictEqual(result.failed, 1, "the poison row is counted as failed");
    assert.strictEqual(
      update.mock.calls.length,
      3,
      "the loop attempts every row — it does not abort at the poison row"
    );
  });
});
