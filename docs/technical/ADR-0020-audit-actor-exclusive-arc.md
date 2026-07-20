# ADR-0020: Audit actor polymorphism via an additive exclusive arc

- **Status**: Accepted
- **Date**: 2026-07-09
- **Deciders**: Edward Velasquez

## Context

`AuditLog` could attribute an action only to an `AdminUser` (the `userId` FK, relation
`"PerformedBy"`, `onDelete: SetNull`). A customer actor had nowhere to go: the confirmed
loss path is `admin/auth/MfaService.audit()`, whose `MfaSubject` can be a `customer`. A
customer id passed as `userId` violates the AdminUser foreign key, and the non-rethrowing
catch in `AuditableService.writeAuditLog` swallows the error — the audit row is **dropped**.
Dropped audit rows are the failure class this change exists to eliminate (OWASP Logging
Cheat Sheet, NIST SP 800-92 attribution).

This also hard-blocks `mfa-consolidation` PR2, which routes customer MFA subjects into audit
writes: without a customer actor FK plus the write seam, those rows hit the AdminUser FK and
are dropped.

## Decision

Add an **additive exclusive arc** to `AuditLog`:

- A nullable `customerUserId` column with a real FK to `CustomerUser` (`onDelete: SetNull`),
  a relation name (`"PerformedByCustomer"`) distinct from the existing `"PerformedBy"`
  AdminUser relation, a reverse relation on `CustomerUser`, and `@@index([customerUserId, createdAt])`.
  The pre-existing `userId` FK is untouched.
- An `actorType` discriminator as a Postgres enum `AuditActorType { SYSTEM, ADMIN, CUSTOMER }`
  with `@default(SYSTEM)`, backfilled deterministically (`userId != null` → `ADMIN`, else
  `SYSTEM`). Readers distinguish system from customer actions via `actorType`, never by
  inferring actor from `userId == null`.
- A database CHECK `num_nonnulls("userId", "customerUserId") <= 1` in hand-written migration
  SQL so a single row can never carry two actor FKs. `<=` (not `=`) because system rows
  legitimately have both FKs null.
- `accountId` REQUIRED on CUSTOMER actors at the **type level** (`CustomerActor.accountId`),
  NOT via a DB CHECK. `CustomerUser.accountId` is non-nullable, so the caller always has it,
  and `findByAccount` is the customer-facing read scope.
- The write seam on `AuditableService` becomes a first-class `AuditActor` discriminated union
  (`SystemActor` | `AdminActor { id }` | `CustomerActor { id, accountId }`) with
  `auditActor.{system,admin,customer}` factories. `writeAuditLog` maps the union to port
  fields in ONE switch — the single choke point. `AuditLogEntry.userId?` is replaced by a
  required `actor: AuditActor`, so an invalid dual-FK actor is unrepresentable at compile time
  (the compile-time mirror of the DB exclusive arc).
- The port input (`AuditLogCreateInput`) makes `actorType` REQUIRED, compiler-forcing every
  port-based writer. The two direct writers that bypass the port via `as Parameters<>` casts
  (`AuditService.log`, `AuditLogger.log`) derive `actorType` internally with the same rule as
  the backfill.

## Rationale

- The DB enforces the arc last (`num_nonnulls <= 1`), the seam enforces it first
  (discriminated union), the port carries it explicitly (`actorType` required). Every layer
  that can make the invalid state unrepresentable does; every layer that cannot degrades to a
  _detectable_ mislabel, never a dropped row.
- The exclusive arc is the sanctioned shape for polymorphic association (Karwin, _SQL
  Antipatterns_ ch. 7): two nullable FKs plus a CHECK, rather than a free-string actor id or a
  supertype table.
- A Postgres enum matches decisive repo precedent (50+ Prisma enums). The domain port defines
  its own const-object union (`AUDIT_ACTOR_TYPE`, technology-free, `@layer domain`) whose
  literals are assignable to the generated `$Enums.AuditActorType` — compile-time parity with
  zero casts (fitness #3, no `any`).
- No DB CHECK ties `actorType` to its FK: DSAR anonymization nulls the FK while `actorType`
  survives (`ADMIN` with a null `userId` is the legitimate post-erasure state), so a stronger
  CHECK would break erasure.

## Alternatives Considered

- **Free-string actor id + `actorType` without FKs** — the documented antipattern (Karwin ch. 7):
  no referential integrity, orphan-prone, unindexable joins.
- **Actor supertype table** — disproportionate blast radius for two concrete actor types.
- **Optional-fields seam** (`customerUserId?` + `actorType?` on the entry/wrappers) — invalid
  states representable at the seam (both FKs set, `CUSTOMER` without `customerUserId`); they
  fail only at the DB CHECK, where the non-rethrowing catch drops the row — reproducing the
  original failure class.
- **Stronger CHECK tying `actorType` to its FK** — breaks DSAR (anonymization nulls FKs while
  `actorType` must survive).
- **DB CHECK requiring `accountId` on CUSTOMER rows** — a CHECK failure drops the row via the
  catch; evidence loss is strictly worse than a detectable data-quality gap. Enforced at the
  type level instead.

## Consequences

- A third actor type (provider / service account / API key) is one more nullable FK plus a
  CHECK edit and one `ALTER TYPE ... ADD VALUE` migration (must be its own migration — a value
  added by `ALTER TYPE` cannot be used in the same transaction).
- Readers use `actorType`, never null-inference. Stats need one grouped query per actor column
  (A2): a unified COALESCE actor key was rejected because it requires `$queryRaw`, which
  fitness #23 blocks.
- `anonymizeCustomerUser` ships port-complete but caller-less in A1: hard customer deletion is
  already covered by the FK `onDelete: SetNull`; the application-level erasure hook (DSAR
  completion flow) is deferred to backlog.
- Migration lock posture: the single backfill UPDATE runs inside the migration transaction and
  touches only admin rows; at single-instance homelab scale this is the right simplicity/safety
  trade. The batched `nullable → backfill → SET NOT NULL` variant buys nothing inside Prisma's
  single-transaction migration and is the documented scale-up variant.

## Revisit if

- A third actor type arrives (provider / service account / API key).
- Audit volume demands table partitioning or batched backfills.

## Risks and Mitigations

- **Future direct writers mislabeling as SYSTEM.** Originally a writer that set a customer FK
  but passed an explicit conflicting `actorType` (e.g. `SYSTEM`) could produce a mislabeled row,
  detectable only after the fact by the reconciliation query. Post-verify remediation closed
  this structurally at EVERY create path outside the port-forced seam: `AuditService.log`,
  `AuditLogger.log`, `AdminAuthService`'s direct writer, and `services/audit.ts`'s `emitAudit`
  helper all derive `actorType` with the FK winning over an explicit value (`userId` present →
  `ADMIN`, `customerUserId` present → `CUSTOMER`; an explicit `actorType` is honored ONLY when
  neither FK is set), so the mislabel is no longer representable at any of these create paths —
  the same philosophy as the DB exclusive arc. The reconciliation query `actorType = 'SYSTEM'
AND ("userId" IS NOT NULL OR "customerUserId" IS NOT NULL)` (0 expected; both FK arms) and the
  companion `actorType = 'ADMIN' AND "userId" IS NULL` (0 expected pre-DSAR) remain in place as
  **defense-in-depth**, not the primary control. Post-migration verification on the dev DB
  returned 0 for both (1157 rows: 1155 SYSTEM, 2 ADMIN). A fitness grep for direct
  `prisma.auditLog.create` without `actorType` is
  still a backlog idea (hard to regex reliably).

## Down-migration

No `down.sql` convention in this repo (matching the `20260505043443` CHECK precedent). The
down SQL is data-safe — `actorType` is re-derivable from `userId`:

```sql
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actor_exclusive_arc_check";
DROP INDEX "AuditLog_customerUserId_createdAt_idx";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_customerUserId_fkey";
ALTER TABLE "AuditLog" DROP COLUMN "customerUserId";
ALTER TABLE "AuditLog" DROP COLUMN "actorType";
DROP TYPE "AuditActorType";
```

## References

- Karwin, _SQL Antipatterns_, ch. 7 (Polymorphic Associations / exclusive arc).
- Prisma relations + table-inheritance documentation.
- OWASP Logging Cheat Sheet; NIST SP 800-92 (audit attribution).
- Migration: `infra/prisma/migrations/20260709204721_add_audit_actor_polymorphism/migration.sql`.
- Seam: `apps/api/src/services/AuditableService.ts`; port:
  `packages/core/domain/src/repositories/AuditLogRepository.ts`.
- `mfa-consolidation` PR2 handoff: A1 hard-blocks PR2 (customer MFA audit writes).
