/**
 * @file backfillAdminMfaBackupCodesGuard.test.ts
 * @description Pure unit test for the fail-closed content guard
 *              (`parseLegacyBackupBlob`) driving the admin MFA backup-code
 *              backfill. The integration suite proves the guard against a live
 *              Postgres round-trip; this suite characterizes the guard itself,
 *              DB-free, so a future regression that weakens the classification
 *              (e.g. dropping the `$argon2id$` prefix check) fails fast without
 *              needing `pnpm db:up`.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseLegacyBackupBlob } from "../../../../infra/prisma/scripts/backfill-admin-mfa-backup-codes.js";

const HASH_A = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEFBQUFBQUFBQQ$aGFzaEFBQUFBQUFBQUFBQUFBQUFBQQ";
const HASH_B = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdEJCQkJCQkJCQg$aGFzaEJCQkJCQkJCQkJCQkJCQkJCQg";

describe("parseLegacyBackupBlob", () => {
  it("returns the parsed array for a JSON array of two Argon2id hashes", () => {
    const blob = JSON.stringify([HASH_A, HASH_B]);
    assert.deepStrictEqual(parseLegacyBackupBlob(blob), [HASH_A, HASH_B]);
  });

  it("returns null for an empty JSON array", () => {
    assert.strictEqual(parseLegacyBackupBlob("[]"), null);
  });

  it("returns null for a mixed array (all-or-nothing, no half-migration)", () => {
    assert.strictEqual(parseLegacyBackupBlob(JSON.stringify([HASH_A, "not-a-hash"])), null);
  });

  it("returns null for an array of non-Argon2id strings", () => {
    assert.strictEqual(parseLegacyBackupBlob(JSON.stringify(["plainstring"])), null);
  });

  it("returns null for a genuine reset token (UUID v4, no leading bracket)", () => {
    const genuineResetToken = randomUUID();
    assert.strictEqual(parseLegacyBackupBlob(genuineResetToken), null);
  });

  it("returns null for the CHANGE_REQUIRED sentinel", () => {
    assert.strictEqual(parseLegacyBackupBlob("CHANGE_REQUIRED"), null);
  });

  it("returns null for a JSON object (not an array)", () => {
    assert.strictEqual(parseLegacyBackupBlob(JSON.stringify({ codes: [HASH_A] })), null);
  });

  it("returns null without throwing for malformed JSON starting with a bracket", () => {
    assert.doesNotThrow(() => parseLegacyBackupBlob("[unclosed"));
    assert.strictEqual(parseLegacyBackupBlob("[unclosed"), null);
  });

  it("returns null for null and empty-string input", () => {
    assert.strictEqual(parseLegacyBackupBlob(null), null);
    assert.strictEqual(parseLegacyBackupBlob(""), null);
  });
});
