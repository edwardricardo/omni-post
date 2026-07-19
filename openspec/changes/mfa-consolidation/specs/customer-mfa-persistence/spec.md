# Customer MFA Persistence — Delta Spec (N-SEC-5 / Cluster B)

> Delta spec for change `mfa-consolidation`. Capability: **customer MFA state is
> persisted with full parity to admin, backup codes live only in the dedicated
> `mfaBackupCodes` column on BOTH tables, and the admin backfill off
> `passwordResetToken` is zero-downtime and idempotent**.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every requirement
> carries Given/When/Then scenarios written to be turned directly into a FAILING
> test (RED) then made GREEN. Requirements whose failure is a data-integrity or
> disclosure regression are marked **[MERGE-BLOCKING]** — they gate the PR.
>
> Behavior-first: these requirements state WHAT the storage guarantees are, not the
> exact column type, migration SQL, or backfill batching strategy — those are
> design/implementation choices.

---

## ADDED Requirements

### Requirement: Customer backup-code columns exist and are written **[MERGE-BLOCKING]**

`CustomerUser` MUST gain `mfaBackupCodes` and `mfaBackupUsedAt` columns mirroring
the admin table, and customer MFA setup MUST write hashed backup codes and track
their single-use state through those columns (parity with admin).

#### Scenario: Migration adds the two customer columns

- GIVEN the `CustomerUser` model before the change
- WHEN the schema migration is applied
- THEN `CustomerUser` has `mfaBackupCodes` and `mfaBackupUsedAt`

#### Scenario: Customer setup persists codes to the new columns

- GIVEN a customer subject running MFA setup
- WHEN backup codes are issued
- THEN the hashed codes are stored in `mfaBackupCodes` and single-use state is tracked via `mfaBackupUsedAt`

---

### Requirement: Backup codes never live in `passwordResetToken` **[MERGE-BLOCKING]**

After the change, backup codes MUST live ONLY in `mfaBackupCodes` on both the
admin and customer tables; `passwordResetToken` MUST be reset-token-only. A
password-reset flow and an MFA flow MUST NOT be able to clobber each other's
state through a shared column.

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
migration runs — and if it runs twice — then the codes MUST land in
`mfaBackupCodes` exactly once, the source `passwordResetToken` value MUST be
RETAINED until the migrated count is verified, and re-running MUST be a no-op. The
backfill MUST be online (zero-downtime; it MUST NOT block or lock the auth path).
Any raw SQL used MUST go through the sanctioned path so fitness #23 stays
hard-zero.

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

The customer-column migration MUST provide a down-migration that removes only the
newly added columns, so a rollback introduces no data loss on pre-existing data.

#### Scenario: Down-migration drops only the new columns

- GIVEN the customer columns have been added
- WHEN the down-migration is applied
- THEN only `mfaBackupCodes` and `mfaBackupUsedAt` are dropped and no other `CustomerUser` data is affected

---

## Verification note (strict TDD — RED→GREEN)

Schema-shape and backfill scenarios are **node:test** integration tests requiring
DB + Redis via `pnpm db:up` (run `pnpm db:up` before any migration per the repo
rule). RED: before the change, `CustomerUser` lacks the columns and admin codes
sit in `passwordResetToken`; the parity and no-clobber tests FAIL. GREEN: after the
migration + repointed setup + verified backfill, codes live only in
`mfaBackupCodes` on both tables, re-running the backfill changes nothing, and the
source is retained until verified. The idempotency scenario asserts a second run is
a no-op. LXC: run a single test file, heap-capped (`--max-old-space-size`), under a
`timeout` wrapper — never the full suite at once. New migration/helper code carries
tests + JSDoc `@file/@description/@layer` per canon; a one-off migration script may
use the sanctioned migration exception if applicable.
