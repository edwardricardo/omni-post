# Customer Audit Write Path — Specification

> Living specification for the **customer-audit-write-path** capability: a
> customer actor can be written to `AuditLog` end-to-end — through the port
> input/DTO, both repository adapters, and `AuditableService` — and a
> customer-actor row can be anonymized for DSAR while its `actorType`
> attribution survives. Every create path derives `actorType` from whichever
> actor FK is actually set, so an actor FK and a mismatched explicit
> `actorType` can never together produce a mislabeled row.
>
> Source of truth: change `audit-actor-polymorphism` (ADR-0020), PR A1
> (`3242147a`). Design detail:
> `openspec/changes/archive/audit-actor-polymorphism/design.md` (Decisions 1,
> 2, 4).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each
> requirement carries Given/When/Then acceptance scenarios. Requirements
> whose failure is a data-loss, auth-evidence, or GDPR/DSAR regression are
> marked **[MERGE-BLOCKING]** — the acceptance criteria that gated A1 and
> must never silently regress.

---

## Requirements

### Requirement: Customer actor propagates through the write path **[MERGE-BLOCKING]**

A customer actor (`customerUserId` + `actorType = CUSTOMER`) flows from the
write seam through `AuditLogCreateInput` / `AuditLogRecordDto`,
`PrismaAuditLogRepository`, `InMemoryAuditLogRepository`, and
`AuditableService`. `AuditService.log` and `AuditLogger.log` carry the new
fields as OPTIONAL only (they keep their existing direct writes — no port
migration). The customer-actor seam on `AuditableService` is the exact
surface `mfa-consolidation` PR2 consumes.

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

A customer-actor audit write persists against a real database. This is
proven at the integration level, since a mocked unit test cannot catch an FK
violation — the original defect this capability exists to close (a customer
id written as `userId` violated the AdminUser FK and the row was silently
dropped).

#### Scenario: Customer MFA-style audit row lands in the database

- GIVEN a real database with the `audit-actor-attribution` schema applied
- WHEN a customer-actor audit row is written via the repository (customer id → `customerUserId`, account id → `accountId`)
- THEN the row is present in `AuditLog` with `actorType = CUSTOMER` and its FK resolves to the `CustomerUser`

---

### Requirement: Admin and system writes are unchanged **[MERGE-BLOCKING]**

An admin-actor write is byte-for-byte unchanged (same `userId`, `actorType =
ADMIN`, null `customerUserId`). A system write (no actor) still succeeds with
BOTH actor FKs null and `actorType = SYSTEM`.

#### Scenario: Admin-actor write is identical to before this capability shipped

- GIVEN an admin-actor audit write
- WHEN the row is persisted
- THEN `userId` is set, `customerUserId` is null, `actorType = ADMIN`, and the payload matches pre-change behavior

#### Scenario: System write persists with both FKs null

- GIVEN a system action (`logSystemAction`, no actor)
- WHEN the row is persisted
- THEN both `userId` and `customerUserId` are null, `actorType = SYSTEM`, and the exclusive-arc CHECK is satisfied

---

### Requirement: Derivation wins over an explicit actorType at every direct-writer create path **[MERGE-BLOCKING]**

At every create path outside the port-forced seam (`auditLogger.ts`,
`AuditService.log`, `AdminAuthService`'s direct writer, `services/audit.ts`'s
`emitAudit`), an actor FK — when present — ALWAYS determines `actorType`
(`userId` set → `ADMIN`; `customerUserId` set → `CUSTOMER`). An explicit
`actorType` argument is honored only when NEITHER FK is set. A caller cannot
produce a row whose `actorType` contradicts its own FK.

(Reason: an early implementation let an explicit `actorType` argument take
precedence over the FK, so a caller passing `actorType: 'SYSTEM'` together
with a set `userId` would have produced a mislabeled row, detectable only
after the fact via reconciliation. Derivation-wins makes that combination
structurally unrepresentable — the same philosophy as the DB exclusive arc.)

#### Scenario: An FK-mismatched explicit actorType is overridden by derivation

- GIVEN a direct-writer call that sets `userId` to a real admin id AND passes an explicit `actorType: 'SYSTEM'`
- WHEN the row is written
- THEN the persisted `actorType` is `ADMIN` (derived from the set `userId`), not the mismatched explicit value

#### Scenario: An explicit actorType is honored when no FK is set

- GIVEN a direct-writer call with neither `userId` nor `customerUserId` set, and an explicit `actorType`
- WHEN the row is written
- THEN the persisted `actorType` equals the explicit value

---

### Requirement: DSAR anonymization covers customer actors **[MERGE-BLOCKING]**

`anonymizeCustomerUser(customerUserId)` anonymizes customer-actor rows (nulls
the `customerUserId` FK); `anonymizeUser` continues to anonymize admin-actor
rows (nulls `userId`). In both cases `actorType` SURVIVES anonymization, so
the row still attributes the action to its actor kind after the identity is
removed.

#### Scenario: anonymizeCustomerUser nulls the customer FK but keeps actorType

- GIVEN a customer-actor audit row and a DSAR request for that customer
- WHEN `anonymizeCustomerUser(customerUserId)` runs
- THEN `customerUserId` is nulled AND `actorType` remains `CUSTOMER`

#### Scenario: Admin anonymization behavior is preserved

- GIVEN an admin-actor audit row
- WHEN `anonymizeUser` runs for that admin
- THEN `userId` is nulled exactly as before and `actorType` remains `ADMIN`

---

## How to extend

1. **New direct writer of `AuditLog`** — prefer the port-forced seam
   (`AuditableService`) so `actorType` is compiler-required. If a direct
   writer is unavoidable, import `deriveActorType` from
   `packages/core/domain/src/repositories/AuditLogRepository.ts` rather than
   re-implementing the derivation locally — it is the single source of truth
   for "FK wins over an explicit actorType."
2. **A future customer right-to-erasure flow** — `anonymizeCustomerUser`
   ships port-complete with no caller wired; wiring it into the DSAR
   completion flow (`compliance/complianceRoutes.ts`) is a future slice, not
   part of this capability. Hard delete of a `CustomerUser` is already
   covered at the DB level by the FK's `onDelete: SetNull` — audit rows are
   never orphaned.
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR (amend
   ADR-0020).

Companion capability: `audit-actor-attribution` (the schema this write path
targets) and `audit-actor-visibility` (the read path that consumes what this
capability writes). Companion audit trail:
`openspec/changes/archive/audit-actor-polymorphism/design.md` (Decisions 1,
2, 4), `verify-report.md` (A1 section, including the post-verify
derivation-wins remediation).
