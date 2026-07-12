# Audit Actor Attribution — Specification

> Living specification for the **audit-actor-attribution** capability:
> `AuditLog` can attribute an action to a `CustomerUser` as well as an
> `AdminUser`, with an explicit `actorType` discriminator and a
> database-enforced exclusive arc so a row can never carry two actor FKs.
>
> Source of truth: change `audit-actor-polymorphism` (ADR-0020), PR A1
> (`3242147a`). Design detail:
> `openspec/changes/archive/audit-actor-polymorphism/design.md` (Decisions
> 1–3), ADR: `docs/technical/ADR-0020-audit-actor-exclusive-arc.md`.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each
> requirement carries Given/When/Then acceptance scenarios. Requirements
> whose failure is a data-integrity or attribution regression are marked
> **[MERGE-BLOCKING]** — the acceptance criteria that gated A1 and must never
> silently regress.

---

## Requirements

### Requirement: Polymorphic customer-actor FK on AuditLog **[MERGE-BLOCKING]**

`AuditLog` carries a nullable `customerUserId` column with a real foreign key
to `CustomerUser` (`onDelete: SetNull`), a relation name distinct from the
pre-existing `"PerformedBy"` AdminUser relation, a reverse relation on
`CustomerUser`, and an `@@index([customerUserId, createdAt])`. The
pre-existing `userId` FK to `AdminUser` is unchanged.

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
- WHEN the schema is inspected
- THEN the `userId` → `AdminUser` FK and relation name are unchanged and a distinctly named customer relation exists alongside it

---

### Requirement: actorType is the ONLY way readers distinguish actors — never a null FK **[MERGE-BLOCKING]**

`AuditLog` carries an `actorType` discriminator whose values are exactly
`SYSTEM`, `ADMIN`, and `CUSTOMER`, modeled as a const-object union (not a raw
string union — fitness #3). Pre-existing rows are backfilled deterministically:
`userId != null` → `ADMIN`, otherwise `SYSTEM`. A reader MUST determine an
actor's type by reading `actorType`; a reader MUST NOT infer "system action"
from `userId == null`, because a `CUSTOMER` row ALSO has `userId == null` —
that ambiguity is the exact defect this capability exists to close.

#### Scenario: Pre-existing rows read the correct backfilled actorType

- GIVEN audit rows that existed before this capability shipped
- WHEN they are read after the backfill
- THEN every row with a non-null `userId` reads `actorType = ADMIN`
- AND every row with a null `userId` reads `actorType = SYSTEM`

#### Scenario: SYSTEM and CUSTOMER are distinguishable despite both having a null userId

- GIVEN a SYSTEM-actor row and a CUSTOMER-actor row, both with `userId = null`
- WHEN a reader inspects `actorType`
- THEN the two rows are distinguishable (`SYSTEM` vs `CUSTOMER`) without inspecting any FK

#### Scenario: Discriminator is a const-object union

- GIVEN the `actorType` type definition
- WHEN the code is type-checked and fitness #3 runs
- THEN `actorType` derives from an `as const` object (three values) and no `any` is introduced

---

### Requirement: Database-enforced exclusive arc **[MERGE-BLOCKING]**

A raw-SQL CHECK constraint `num_nonnulls("userId", "customerUserId") <= 1`
ensures a single row can carry at most one actor FK. `<=` (not `=`) is required
because system rows legitimately have both FKs null. The CHECK lives in
hand-written migration SQL (fitness #23 targets application code and exempts
migrations).

#### Scenario: Insert with both actor FKs set is rejected

- GIVEN the CHECK constraint is applied
- WHEN an insert sets BOTH `userId` and `customerUserId`
- THEN the database rejects the write (constraint violation)

#### Scenario: System row with both FKs null is accepted

- GIVEN the CHECK constraint is applied
- WHEN a system audit row is written with `userId` and `customerUserId` both null
- THEN the write succeeds (`num_nonnulls = 0`, which satisfies `<= 1`)

---

### Requirement: Data-safe down-migration

A down-migration reverses the CHECK, the index, the `customerUserId` column,
and the `actorType` column, with no data loss on pre-existing rows (`actorType`
is re-derivable from `userId`).

#### Scenario: Down-migration reverses only the added structures

- GIVEN the columns, index, and CHECK have been added
- WHEN the down-migration is applied
- THEN only `customerUserId`, `actorType`, the new index, and the CHECK are removed
- AND no other `AuditLog` column or row is affected

---

## How to extend

1. **A third actor type** (provider, service account, API key) — add one more
   nullable FK column plus a CHECK edit (`num_nonnulls(...) <= 1` widened to
   the new column); the discriminator gains a fourth enum value via
   `ALTER TYPE ... ADD VALUE` as its OWN migration (a value added by
   `ALTER TYPE` cannot be used in the same transaction that adds it).
2. **Any new reader of `AuditLog`** — switch on `actorType`, never derive
   actor identity from which FK is non-null or from `userId == null`. This is
   the guarantee this capability exists to protect; reintroducing null-FK
   inference is a regression even if it happens to work today.
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR (amend
   ADR-0020, do not silently relax the CHECK or the backfill rule).

Companion capability: `customer-audit-write-path` (the write seam that
produces these rows) and `audit-actor-visibility` (the read path that
consumes `actorType`). Companion audit trail:
`openspec/changes/archive/audit-actor-polymorphism/design.md` (Decisions
1–3), `verify-report.md` (A1 section — reconciliation queries proven 0/0
against 1159 real rows), `docs/technical/ADR-0020-audit-actor-exclusive-arc.md`.
