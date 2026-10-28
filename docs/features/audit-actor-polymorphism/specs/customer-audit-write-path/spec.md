# Customer Audit Write Path — Delta Spec (audit-actor-polymorphism / A1)

> New capability for change `audit-actor-polymorphism`. Capability: **a customer
> actor can be written to `AuditLog` end-to-end — through the port input/DTO, both
> repository adapters, and `AuditableService` — and a customer-actor row can be
> anonymized for DSAR while its `actorType` attribution survives.**
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every requirement
> carries Given/When/Then scenarios written to become a FAILING test (RED) then
> made GREEN. Requirements whose failure is a data-loss, auth-evidence, or
> GDPR/DSAR regression are marked **[MERGE-BLOCKING]** — they gate the PR.
>
> **Hard ordering:** every **[MERGE-BLOCKING]** requirement below MUST land BEFORE
> `mfa-consolidation` PR2, which consumes the `AuditableService` customer-actor
> seam. Without this write path, PR2's customer MFA audit rows are dropped.
>
> Behavior-first: these requirements state WHAT the write path guarantees, not the
> exact seam field shape (`customerUserId?` vs actor object `{ type, id }`) or
> whether `accountId` is required on customer rows — those are design-phase choices.

---

## ADDED Requirements

### Requirement: Customer actor propagates through the write path **[MERGE-BLOCKING]**

The system SHALL carry a customer actor (`customerUserId` + `actorType = CUSTOMER`)
from the write seam through `AuditLogCreateInput` / `AuditLogRecordDto`,
`PrismaAuditLogRepository`, `InMemoryAuditLogRepository`, and `AuditableService`.
`AuditService.log` and `AuditLogger.log` SHALL gain the new fields as OPTIONAL only
(they keep their existing direct writes — no port migration). The customer-actor
seam on `AuditableService` is the exact surface `mfa-consolidation` PR2 consumes.

#### Scenario: AuditableService accepts a customer-actor write

- GIVEN the `AuditableService` customer-actor seam
- WHEN a caller records an action for a customer subject
- THEN the produced audit input carries `customerUserId` and `actorType = CUSTOMER` and null `userId`

#### Scenario: In-memory adapter mirrors the port contract

- GIVEN `InMemoryAuditLogRepository`
- WHEN a customer-actor input is created
- THEN the stored record exposes the same `customerUserId` + `actorType` fields as the Prisma adapter

---

### Requirement: Customer-actor row persists against a real database **[MERGE-BLOCKING]**

A customer-actor audit write SHALL persist against a REAL database — this is an
integration-level guarantee. A mocked unit test would not have caught the original
FK bug (a customer id written as `userId` violated the AdminUser FK and the row was
dropped), so the guarantee MUST be proven at the database boundary.

#### Scenario: Customer MFA-style audit row lands in the database

- GIVEN a real database with the A1 schema applied
- WHEN a customer-actor audit row is written via the repository (customer id → `customerUserId`, account id → `accountId`)
- THEN the row is present in `AuditLog` with `actorType = CUSTOMER` and its FK resolves to the `CustomerUser`

---

### Requirement: Admin and system writes are unchanged **[MERGE-BLOCKING]**

An admin-actor write SHALL be byte-for-byte unchanged (same `userId`, `actorType =
ADMIN`, null `customerUserId`). A system write (no actor) SHALL still succeed with
BOTH actor FKs null and `actorType = SYSTEM`.

#### Scenario: Admin-actor write is identical to today

- GIVEN an admin-actor audit write
- WHEN the row is persisted
- THEN `userId` is set, `customerUserId` is null, `actorType = ADMIN`, and the payload matches the pre-change behavior

#### Scenario: System write persists with both FKs null

- GIVEN a system action (`logSystemAction`, no actor)
- WHEN the row is persisted
- THEN both `userId` and `customerUserId` are null, `actorType = SYSTEM`, and the exclusive-arc CHECK is satisfied

---

### Requirement: DSAR anonymization covers customer actors **[MERGE-BLOCKING]**

`anonymizeUser` SHALL anonymize customer-actor rows (null the `customerUserId` FK),
extending the current admin-only behavior. `actorType` SHALL survive anonymization
so the row still attributes the action to a `CUSTOMER` after the identity is
removed. This gap MUST NOT ship: customers appear in `AuditLog` for the first time
in this change, so the DSAR extension lands in the SAME PR that enables customer rows.

#### Scenario: anonymizeUser nulls the customer FK but keeps actorType

- GIVEN a customer-actor audit row and a DSAR request for that customer
- WHEN `anonymizeCustomerUser(customerUserId)` runs
- THEN `customerUserId` is nulled AND `actorType` remains `CUSTOMER`

#### Scenario: Admin anonymization behavior is preserved

- GIVEN an admin-actor audit row
- WHEN `anonymizeUser` runs for that admin
- THEN `userId` is nulled exactly as before and `actorType` remains `ADMIN`

---

## Non-goals (explicitly OUT of this capability)

- Making audit-write failure LOUD (rethrow/alerting) — the non-rethrowing catch in `writeAuditLog` already emits an ERROR line; loud-failure is a separate operational decision (backlog).
- Migrating `AuditService.log` / `AuditLogger.log` to the port — they keep their direct writes and only gain optional fields.

## Verification note (strict TDD — RED→GREEN)

Port/adapter/seam scenarios are **vitest** unit tests in `apps/api/tests/unit/` with
the in-memory adapter. The real-database persistence requirement is a **node:test**
integration test requiring DB + Redis via `pnpm db:up` — it is the RED anchor that a
mocked test cannot cover. RED: before the change, a customer-actor write is dropped
by the AdminUser FK and `anonymizeUser` ignores customers. GREEN: the customer row
persists, admin/system writes are unchanged, and DSAR nulls the customer FK while
`actorType` survives. LXC: run a single test file, heap-capped
(`--max-old-space-size`), under a `timeout` wrapper. New/changed code carries tests +
JSDoc `@file/@description/@layer` (fitness #9/#10); anything newly constructed is
wired only in the composition root (fitness #21).
