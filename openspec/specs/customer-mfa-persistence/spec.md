# Customer MFA Persistence — Specification

> Living specification for the **customer-mfa-persistence** capability: customer
> MFA state is persisted with full parity to admin, backup codes live only in the
> dedicated `mfaBackupCodes` column on BOTH tables, and the one-off admin backfill
> off `passwordResetToken` is zero-downtime and idempotent.
>
> Source of truth: change `mfa-consolidation` (N-SEC-5, Cluster B), PR2 (`c89b7d95`,
> schema) and PR3 (backfill + legacy retirement). Design detail:
> `openspec/changes/archive/mfa-consolidation/design.md` (Decision 3).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Requirements marked
> **[MERGE-BLOCKING]** are the acceptance criteria that gated the closing change —
> their failure is a data-integrity or disclosure regression and must never regress.

---

## Requirements

### Requirement: Customer backup-code columns exist and are written **[MERGE-BLOCKING]**

`CustomerUser` gains `mfaBackupCodes` and `mfaBackupUsedAt` columns mirroring
the admin table, and customer MFA setup writes hashed backup codes and tracks
their single-use state through those columns (parity with admin).

#### Scenario: CustomerUser carries the two backup-code columns

- GIVEN the `CustomerUser` model
- WHEN it is inspected
- THEN it has `mfaBackupCodes` and `mfaBackupUsedAt`

#### Scenario: Customer setup persists codes to the new columns

- GIVEN a customer subject running MFA setup
- WHEN backup codes are issued
- THEN the hashed codes are stored in `mfaBackupCodes` and single-use state is tracked via `mfaBackupUsedAt`

---

### Requirement: Backup codes never live in `passwordResetToken` **[MERGE-BLOCKING]**

Backup codes live ONLY in `mfaBackupCodes` on both the admin and customer
tables; `passwordResetToken` is reset-token-only. A password-reset flow and an
MFA flow MUST NOT clobber each other's state through a shared column.

#### Scenario: MFA setup does not write the reset-token column

- GIVEN a subject running MFA setup (admin or customer)
- WHEN backup codes are issued
- THEN `passwordResetToken` is not written with any MFA material

#### Scenario: Reset and MFA flows are independent

- GIVEN a subject with both a pending password-reset token and enrolled MFA backup codes
- WHEN a password reset is requested (writing `passwordResetToken`)
- THEN the subject's `mfaBackupCodes` remain intact, and vice versa

---

### Requirement: Idempotent online admin backfill **[MERGE-BLOCKING]**

Given existing admin backup codes stored in `passwordResetToken`, when the
backfill runs — and if it runs twice — the codes land in `mfaBackupCodes`
exactly once, the source `passwordResetToken` value is RETAINED until the
migrated count is verified, and re-running is a no-op. The backfill is online
(zero-downtime; it does not block or lock the auth path). Any raw SQL used goes
through the sanctioned path so fitness #23 stays hard-zero. The backfill's
content guard MUST NOT misclassify a genuine reset token or sentinel value as
MFA material, and cleanup MUST NOT null a pending genuine reset token.

#### Scenario: Backfill moves admin codes exactly once

- GIVEN admin rows whose `passwordResetToken` holds hashed backup-code JSON
- WHEN the backfill runs
- THEN each row's codes are copied into `mfaBackupCodes` exactly once (no duplication, no loss)

#### Scenario: Re-running the backfill is a no-op

- GIVEN the backfill has already completed for a set of admin rows
- WHEN the backfill is executed a second time
- THEN no row is changed and no code is duplicated (idempotent)

#### Scenario: Source is retained until the migrated count is verified

- GIVEN the backfill has copied codes into `mfaBackupCodes`
- WHEN the migration completes but the migrated count has not yet been verified
- THEN the source `passwordResetToken` values are still present
- AND cleanup of the source runs only after the migrated count is verified

#### Scenario: A genuine reset token or sentinel value is never migrated or nulled

- GIVEN an `AdminUser` row whose `passwordResetToken` holds a genuine password-reset token (not a JSON array of hashes) or the `CHANGE_REQUIRED` sentinel
- WHEN the backfill and, later, cleanup run
- THEN that row's `passwordResetToken` is never migrated into `mfaBackupCodes` and never nulled by cleanup

#### Scenario: Backfill runs online without blocking auth

- GIVEN the auth path is serving traffic
- WHEN the backfill executes
- THEN it does not take a lock that blocks login/reset and requires no downtime

#### Scenario: Any raw SQL uses the sanctioned path

- GIVEN the backfill needs raw SQL
- WHEN it executes
- THEN it goes through the sanctioned raw-query path and fitness #23 reports count `0`

---

### Requirement: Customer-column down-migration is data-safe

The customer-column migration provides a down-migration that removes only the
newly added columns, so a rollback introduces no data loss on pre-existing data.

#### Scenario: Down-migration drops only the new columns

- GIVEN the customer columns have been added
- WHEN the down-migration is applied
- THEN only `mfaBackupCodes` and `mfaBackupUsedAt` are dropped and no other `CustomerUser` data is affected

---

## How to extend

1. **New per-subject persisted MFA field** (e.g. `mfaLastUsedTotpStep`, added in
   PR2b-1) — mirror the column on BOTH `AdminUser` and `CustomerUser` with a
   nullable, no-default type so the ALTER stays metadata-only (online); see the
   `unified-mfa-service-and-port` capability for the behavior that field backs.
2. **Future one-off data migrations touching this data** — follow the same
   pattern as the admin backfill: cursor-batched, content-guarded, idempotent,
   source-retained-until-verified, typed Prisma only (no raw SQL unless via the
   sanctioned path).
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR; these are the
   acceptance criteria that closed N-SEC-5 and must not silently regress.

Companion audit trail: `openspec/changes/archive/mfa-consolidation/design.md`
(Decision 3), `verify-report.md` (PR2, PR3 sections — including the post-verify
remediation of the `verifyIntegrity` field-naming finding).
