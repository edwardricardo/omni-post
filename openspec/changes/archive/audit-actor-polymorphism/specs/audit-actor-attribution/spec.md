# Audit Actor Attribution — Delta Spec (audit-actor-polymorphism / A1)

> New capability for change `audit-actor-polymorphism`. Capability: **`AuditLog`
> can attribute an action to a `CustomerUser` as well as an `AdminUser`, with an
> explicit `actorType` discriminator and a database-enforced exclusive arc so a
> row can never carry two actor FKs.**
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every requirement
> carries Given/When/Then scenarios written to become a FAILING test (RED) then
> made GREEN. Requirements whose failure is a data-integrity or attribution
> regression are marked **[MERGE-BLOCKING]** — they gate the PR.
>
> **Hard ordering:** every **[MERGE-BLOCKING]** requirement below MUST land BEFORE
> `mfa-consolidation` PR2. PR2 routes customer MFA subjects into audit writes; if
> this schema is absent, those rows hit the AdminUser FK and are dropped.
>
> Behavior-first: these requirements state WHAT the schema guarantees, not the
> exact column type, relation name string, or migration file layout — those are
> design/implementation choices.

---

## ADDED Requirements

### Requirement: Polymorphic customer-actor FK on AuditLog **[MERGE-BLOCKING]**

`AuditLog` SHALL gain a nullable `customerUserId` column with a real foreign key to
`CustomerUser` (`onDelete: SetNull`), a relation name DISTINCT from the existing
`"PerformedBy"` AdminUser relation, a reverse relation on `CustomerUser`, and an
`@@index([customerUserId, createdAt])`. The pre-existing `userId` FK to `AdminUser`
SHALL remain unchanged.

#### Scenario: Customer-actor row references a real CustomerUser

- GIVEN the migration has been applied
- WHEN an audit row is written with `customerUserId` set to an existing `CustomerUser.id`
- THEN the row persists and the FK resolves to that `CustomerUser`

#### Scenario: Deleting a CustomerUser nulls the FK, not the row

- GIVEN an audit row attributed to a customer actor
- WHEN that `CustomerUser` is deleted
- THEN `customerUserId` becomes null (`SetNull`) and the audit row is retained as immutable evidence

#### Scenario: Admin relation is untouched

- GIVEN the existing `"PerformedBy"` AdminUser relation
- WHEN the migration is applied
- THEN the `userId`→`AdminUser` FK and relation name are unchanged and a new, distinctly named customer relation exists alongside it

---

### Requirement: Explicit actorType discriminator with deterministic backfill **[MERGE-BLOCKING]**

`AuditLog` SHALL gain an `actorType` discriminator whose values are exactly
`SYSTEM`, `ADMIN`, and `CUSTOMER`, modeled as a const-object union (NOT a raw
string union — fitness #3, no `any`). Existing rows SHALL be backfilled
deterministically: `userId != null` → `ADMIN`, otherwise `SYSTEM`. After this
change, readers SHALL distinguish system from customer actions via `actorType`,
never by inferring actor from `userId == null`.

#### Scenario: Pre-existing rows read the correct backfilled actorType

- GIVEN audit rows that existed before the change
- WHEN the backfill migration runs
- THEN every row with a non-null `userId` reads `actorType = ADMIN`
- AND every row with a null `userId` reads `actorType = SYSTEM`

#### Scenario: Discriminator is a const-object union

- GIVEN the `actorType` type definition
- WHEN the code is type-checked and fitness #3 runs
- THEN `actorType` derives from an `as const` object (three values) and no `any` is introduced

---

### Requirement: Database-enforced exclusive arc **[MERGE-BLOCKING]**

The migration SHALL add a raw-SQL CHECK constraint
`num_nonnulls("userId", "customerUserId") <= 1` so a single row can carry at most
one actor FK. `<=` is required because system rows legitimately have both FKs null.
The CHECK SHALL live in hand-written migration SQL (fitness #23 targets application
code and exempts migrations, so this is canon-clean).

#### Scenario: Insert with both actor FKs set is rejected

- GIVEN the CHECK constraint is applied
- WHEN an insert sets BOTH `userId` and `customerUserId`
- THEN the database rejects the write (constraint violation)

#### Scenario: System row with both FKs null is accepted

- GIVEN the CHECK constraint is applied
- WHEN a system audit row is written with `userId` and `customerUserId` both null
- THEN the write succeeds (`num_nonnulls = 0`, which satisfies `<= 1`)

#### Scenario: CHECK applies cleanly to a table with existing rows

- GIVEN existing rows, all of which have `customerUserId` null (new column)
- WHEN the CHECK is added
- THEN it applies without error because every existing row satisfies `num_nonnulls <= 1` by construction

---

### Requirement: Data-safe down-migration

The migration SHALL provide a down-migration that drops the CHECK, the index, the
`customerUserId` column, and the `actorType` column, with NO data loss on
pre-existing rows (`actorType` is re-derivable from `userId`).

#### Scenario: Down-migration reverses only the added structures

- GIVEN the columns, index, and CHECK have been added
- WHEN the down-migration is applied
- THEN only `customerUserId`, `actorType`, the new index, and the CHECK are removed
- AND no other `AuditLog` column or row is affected

---

## Non-goals (explicitly OUT of this capability)

- No RLS / tenant-guard change — `AuditLog` stays in the tenant-guard denylist (immutable evidence outside RLS).
- No third actor type (provider / service account / API key) — a future arrival is one more nullable FK plus a CHECK edit.

## Verification note (strict TDD — RED→GREEN)

Schema, backfill, and CHECK scenarios are **node:test** integration tests requiring
DB + Redis via `pnpm db:up` (run `pnpm db:up` before any migration per the repo
rule). RED: before the change, a customer-actor insert violates the AdminUser FK and
`actorType` does not exist. GREEN: the FK resolves, `actorType` backfills correctly,
and the exclusive-arc CHECK rejects dual-FK inserts. LXC: run a single test file,
heap-capped (`--max-old-space-size`), under a `timeout` wrapper — never the full
suite at once. ADR-0020 (exclusive-arc decision, deciders: Edward Velasquez) and any
new source file carry JSDoc `@file/@description/@layer` (fitness #9/#10).
