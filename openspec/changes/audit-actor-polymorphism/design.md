# Design: Audit Actor Polymorphism

Additive exclusive arc (Approach A, proposal-decided): `AuditLog` gains a `customerUserId` FK to `CustomerUser`, an `actorType` discriminator, and a database CHECK so a row can never carry two actor FKs. The write seam on `AuditableService` becomes a first-class `AuditActor` discriminated union so an invalid actor combination is unrepresentable at the type level — the compile-time mirror of the DB exclusive arc. Two chained PRs `stacked-to-main`: **A1** (schema + write path + DSAR + ADR-0020, blocks `mfa-consolidation` PR2) and **A2** (visibility/read path).

## Technical Approach

The DB enforces the arc last (`num_nonnulls <= 1`); the seam enforces it first (discriminated union); the port carries it explicitly (`actorType` required on `AuditLogCreateInput`). Every layer that can make the invalid state unrepresentable does; every layer that cannot (direct Prisma writers) degrades to a _detectable_ mislabel, never a dropped row — dropped audit rows are the failure class this change exists to eliminate (OWASP Logging Cheat Sheet / NIST SP 800-92 attribution).

## Architecture Decisions

### Decision 1: Write seam — first-class `AuditActor` discriminated union (option b)

**Choice**: Introduce an `AuditActor` union (`SYSTEM` carries no id, `ADMIN` carries `id`, `CUSTOMER` carries `id` + `accountId`) with factory helpers. `AuditLogEntry.userId?` is REPLACED by `actor: AuditActor` (required); `writeAuditLog` maps the union to port fields in one switch — the single choke point. The actor-taking wrappers (`logUserAction`, `logAccountAction`, `logResourceAction`, `logSecurityEvent`, `logDataAccess`, `logComplianceEvent`) become actor-first (first parameter `actor: AuditActor` instead of `userId: string`). `logSystemAction` keeps its signature (internally `auditActor.system()`); `executeWithAudit` keeps its signature and maps `context.userId` → `auditActor.admin(...)` internally (documented admin-only — changing `ServiceContext` would ripple through `BaseService` and every service, out of scope).

**Call-site map (re-verified at source)**: **28 mechanical wrapper conversions across 6 files**:

| File                                                                             | Wrapper × count                                                         | Sites                                                                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `auth/mfaService.ts` (legacy; deleted in `mfa-consolidation` PR3 but LIVE today) | `logSecurityEvent` ×8                                                   | `:90,:152,:196,:264,:281,:331,:373,:420`                                                                                  |
| `auth/authServiceCore.ts`                                                        | `logUserAction` ×3 + `logSecurityEvent` ×3 + `logResourceAction` ×1 = 7 | `:200,:217,:305` / `:235,:262,:277` / `:107`                                                                              |
| `auth/authServiceSession.ts`                                                     | via `*Public` forwarders ×5                                             | `:58` `writeAuditLogPublic` (entry gains `actor`), `:98,:284` `logSecurityEventPublic`, `:140,:254` `logUserActionPublic` |
| `admin/AccountSessionService.ts`                                                 | `logSecurityEvent` ×2                                                   | `:89,:171`                                                                                                                |
| `admin/auth/MfaService.ts`                                                       | `logSecurityEvent` ×1                                                   | `:393`                                                                                                                    |
| `admin/accountLifecycleService.ts`                                               | `logAccountAction` ×3 + `logComplianceEvent` ×2 = 5                     | `:117,:253,:387` / `:325,:460`                                                                                            |

**Corrected exclusions (were wrong in the prior draft)**:

- `events/EventService.ts` is NOT a site — its only `logUserAction` reference (`:433`) is COMMENTED OUT (`// await auditService.logUserAction(event.data);`). Phantom.
- `admin/auth/AdminAuthService.ts` is NOT a wrapper site — it does not extend `AuditableService` (`:34` `export class AdminAuthService {`). Its `logSecurityEvent(:189,:308)` calls a PRIVATE method that writes via direct `this.prisma.auditLog.create(:618)` — that single writer is already counted in the direct-writers section ("explicit ADMIN"). Counting `:189/:308` as conversions was a double-count.
- `authServiceCore.ts:346/:353` are the `...args` pass-through BODIES of the `*Public` forwarders, not conversion sites. The 3 forwarders (`:338 writeAuditLogPublic`, `:343 logUserActionPublic`, `:350 logSecurityEventPublic`) declare params via `Parameters<typeof this.logX>`, so their signatures AUTO-TRACK the actor-first change with no body edit — which is precisely why the 5 `authServiceSession.ts` caller sites break `tsc` (they pass a `string` where an `AuditActor` is now required). Those 5 caller sites are the real edits; the 0/0 `tsc` gate depends on them.

`executeWithAudit`'s external sites and `logSystemAction`/`logDataAccess` (0 external callers) need no edits.

**Alternatives considered**:

| Option                                                                    | Why rejected                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) optional `customerUserId?` + `actorType?` on `AuditLogEntry`/wrappers | Invalid states representable at the seam (both FKs set; `CUSTOMER` without `customerUserId`); they fail only at the DB CHECK, where the non-rethrowing catch (`AuditableService.ts:297-306`) DROPS the row — reproduces the original failure class this change exists to kill |
| (b-max) actor object into `ServiceContext`/`executeWithAudit` too         | `ServiceContext` is `BaseService` surface used by every service for logging context — disproportionate ripple; all `executeWithAudit` consumers are admin flows                                                                                                               |

**Rationale**: The seam is the only place humans choose the actor; a discriminated union makes the choice total and the invalid combination a compile error. `MfaSubject = { type: 'admin'|'customer', id }` (`packages/ports/src/MfaUserRepositoryPort.ts:18-32`) maps 1:1 onto the union — no conditional field-picking at the consumer. The 28-site churn is one mechanical line each (`userId` → `auditActor.admin(userId)`, one import per file) and lands as its own commit inside A1. The string-first seam is genuinely misconceived under two actor types — it cannot distinguish them. The confirmed loss path is `admin/auth/MfaService.audit()` (`admin/auth/MfaService.ts:393`), whose `MfaSubject` can be `customer`: a customer id passed as `userId` violates the AdminUser FK and the row is dropped (proposal §Intent; exploration `:47-51`). The legacy `auth/mfaService.ts` is NOT that path — it takes an `AdminUserRepositoryPort` (`:34`) and pushes only ADMIN ids, which satisfy the FK; it is in the conversion list solely because it is a live `AuditableService` subclass whose wrappers change signature. Either way, the fix is rework, not a shim.

### Decision 2: `accountId` REQUIRED on CUSTOMER actors at the type level; no DB CHECK on it

**Choice**: `CustomerActor` carries `accountId: string` (required). No DB constraint ties `actorType = 'CUSTOMER'` to `accountId IS NOT NULL`.

**Rationale**: `CustomerUser.accountId` is non-nullable (`schema.prisma:315`) — the caller always has it, so requiring it costs nothing; and `findByAccount` is the customer-facing read scope, so a customer row without `accountId` is invisible to its own account trail. A DB CHECK was rejected because a CHECK failure at write time drops the row via the catch — evidence loss is strictly worse than a detectable data-quality gap. The type layer guarantees it for every seam write; the direct writers are admin/system-scoped.

### Decision 3: `actorType` as a Postgres enum (`@default(SYSTEM)` retained)

**Choice**: Prisma `enum AuditActorType { SYSTEM ADMIN CUSTOMER }` — repo precedent is decisive (50+ Prisma enums in `schema.prisma`, e.g. `DsarStatus`, `LogStatus`). The domain port defines its own const-object union (`AUDIT_ACTOR_TYPE`, technology-free, `@layer domain`); its literal types are assignable to the generated `$Enums.AuditActorType`, giving compile-time parity with zero casts (fitness #3). A future 4th value is one `ALTER TYPE ... ADD VALUE` migration (cheap; must be its own migration — a value added by `ALTER TYPE` cannot be used in the same transaction, unlike `CREATE TYPE` whose values are usable immediately, which is why the A1 backfill can run in the same migration). TEXT+CHECK was rejected: adding a value means a constraint swap with a table re-validation, and it abandons the repo's established discriminator shape for no gain.

**`@default(SYSTEM)` retained deliberately**: verified that the two `userId`-less direct writers (`gatewaySwitchProcessor.ts:122`, `credentialManager.ts:385`) are genuine system actions — the default IS their correct semantics and they need zero edits. A future direct writer that forgets `actorType` degrades to a SYSTEM-labeled row — detectable via the reconciliation query `actorType = 'SYSTEM' AND ("userId" IS NOT NULL OR "customerUserId" IS NOT NULL)` (the `customerUserId` arm catches a writer that set the customer FK but forgot `actorType`) — never a dropped row. The port input, by contrast, makes `actorType` REQUIRED, compiler-forcing every port-based writer.

### Decision 4: DSAR — separate `anonymizeCustomerUser` port method

**Choice**: Add `anonymizeCustomerUser(customerUserId: string): Promise<number>` beside `anonymizeUser`. Rejected a `subjectType` parameter on `anonymizeUser`: the port's own style is one explicit method per dimension (`findByUser` / `findByResource` / `findByAccount`), and a two-valued flag parameter reads ambiguously at call sites. Both methods null ONLY their FK; `actorType` survives, preserving attribution through anonymization — which is also why NO stronger CHECK ties `actorType` to its FK (`ADMIN` with null `userId` is the legitimate post-DSAR state).

**Spec alignment (resolved post-verify)**: the `customer-audit-write-path` spec scenario originally wrote `anonymizeUser(customerUserId)` (single method, subject-agnostic) while this design used a SEPARATE `anonymizeCustomerUser(customerUserId)` per the naming rationale above. `sdd-verify` flagged the mismatch as a suggestion; the spec text was ALIGNED in the post-verify remediation batch (`specs/customer-audit-write-path/spec.md` line 94 now reads `WHEN anonymizeCustomerUser(customerUserId) runs`) rather than carried as a documented deviation.

**Caller / integration hook**: `anonymizeCustomerUser` ships in A1 as the port-complete DSAR erasure surface with NO caller wired in this change — mirroring how `anonymizeUser` is invoked today only from `accountLifecycleService.ts:447` (admin/account erasure). Verified: no customer-erasure flow calls audit anonymization today. Two adjacent facts bound the ambiguity so `sdd-tasks` need not rediscover it: (1) HARD customer deletion (`PrismaCustomerUserRepository.ts:239` `customerUser.delete`) is ALREADY covered at the DB level by the new FK's `onDelete: SetNull` — audit rows are never orphaned by a delete; (2) the natural application-level hook, when customer right-to-erasure is implemented, is the DSAR completion flow (`compliance/complianceRoutes.ts` `/admin/compliance/dsar/:id/complete`), which does not anonymize customer audit rows today. Wiring that hook is explicitly OUT of scope for this change (backlog).

### Decision 5 (A2): read path — typed grouped query per actor column; CSV appends columns

**Choice**: `getStats` (`auditService.ts:255-276`) and `getStatistics` (`auditLogger.ts:356-365`) keep their existing `groupBy(["userId"])` + `adminUser.findMany` UNTOUCHED (admin output byte-identical) and add a second typed `groupBy(["customerUserId"], where: { customerUserId: { not: null } })` + `customerUser.findMany`, surfaced as an additive `topCustomerUsers` array (same `{ user, email, count }` shape). A unified COALESCE actor key was rejected because it requires `$queryRaw` — fitness #23 hard-zero blocks raw queries outside the audited exceptions; this fitness function decides the design. `getLogs` adds `include: { customerUser: { select: { id, email, firstName, lastName } } }` and exposes `actorType`. CSV export (`auditRoutes.ts:369-383`): the `"user.email"` column stays byte-identical; two columns append at the end — `{ key: "actorType", header: "Actor Type" }` and `{ key: "customerUser.email", header: "Customer Email" }`. `apps/admin/lib/api/types.ts` `AuditLog` gains additive fields only.

## Schema & Migration (A1)

Prisma diff:

```prisma
enum AuditActorType {
  SYSTEM
  ADMIN
  CUSTOMER
}

model AuditLog {
  customerUserId String?
  actorType      AuditActorType @default(SYSTEM)
  customerUser   CustomerUser?  @relation("PerformedByCustomer", fields: [customerUserId], references: [id], onDelete: SetNull)
  @@index([customerUserId, createdAt])
}

model CustomerUser {
  auditLogs AuditLog[] @relation("PerformedByCustomer")
}
```

Migration (`prisma migrate dev --create-only`, then hand-edit; `pnpm db:up` first — repo rule):

```sql
-- Actor discriminator. CREATE TYPE values are usable in the same transaction.
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CUSTOMER');

-- Metadata-only on PostgreSQL 11+ (repo runs pgvector/pgvector:pg16,
-- docker-compose.yml:6) -- no table rewrite, no long lock.
ALTER TABLE "AuditLog" ADD COLUMN "customerUserId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'SYSTEM';

-- Deterministic backfill: rewrites only rows with a non-null userId.
UPDATE "AuditLog" SET "actorType" = 'ADMIN' WHERE "userId" IS NOT NULL;

-- Exclusive arc (Karwin, SQL Antipatterns ch. 7). Existing rows pass by
-- construction: customerUserId is brand-new, hence all-NULL.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actor_exclusive_arc_check"
  CHECK (num_nonnulls("userId", "customerUserId") <= 1);

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_customerUserId_fkey"
  FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AuditLog_customerUserId_createdAt_idx"
  ON "AuditLog"("customerUserId", "createdAt");
```

Lock posture: the single UPDATE runs inside the migration's transaction and touches only admin rows; at current table scale (single-instance homelab deployment) this is the right simplicity/safety trade. The batched `nullable → backfill → SET NOT NULL` variant buys nothing inside Prisma's single-transaction migration and is documented in ADR-0020 as the scale-up variant. Down-migration (exact SQL documented in ADR-0020; no data loss — `actorType` is re-derivable from `userId`; repo has no `down.sql` convention, matching the `20260505043443` CHECK precedent):

```sql
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actor_exclusive_arc_check";
DROP INDEX "AuditLog_customerUserId_createdAt_idx";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_customerUserId_fkey";
ALTER TABLE "AuditLog" DROP COLUMN "customerUserId";
ALTER TABLE "AuditLog" DROP COLUMN "actorType";
DROP TYPE "AuditActorType";
```

Post-migration verification (apply phase): reconciliation queries — `actorType='ADMIN' AND "userId" IS NULL` → only rows anonymized later; `actorType='SYSTEM' AND ("userId" IS NOT NULL OR "customerUserId" IS NOT NULL)` → 0 (the `customerUserId` arm guards against a mislabeled customer write).

## Interfaces / Contracts

Port (`packages/core/domain/src/repositories/AuditLogRepository.ts`):

```typescript
export const AUDIT_ACTOR_TYPE = {
  SYSTEM: "SYSTEM",
  ADMIN: "ADMIN",
  CUSTOMER: "CUSTOMER",
} as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPE)[keyof typeof AUDIT_ACTOR_TYPE];

export interface AuditLogCreateInput {
  action: string;
  actorType: AuditActorType; // REQUIRED: every port write claims its actor
  userId?: string; // ADMIN actor FK
  customerUserId?: string; // CUSTOMER actor FK
  // ... existing fields unchanged (resource?, resourceId?, accountId?, ipAddress?, userAgent?, details, success, error?)
}

export interface AuditLogRecordDto {
  // ... existing fields unchanged, plus:
  customerUserId: string | null;
  actorType: AuditActorType;
}

export interface AuditLogRepository {
  // ... existing methods unchanged, plus:
  anonymizeCustomerUser(customerUserId: string): Promise<number>;
}
```

Seam (`apps/api/src/services/AuditableService.ts`):

```typescript
export interface SystemActor {
  readonly type: typeof AUDIT_ACTOR_TYPE.SYSTEM;
}
export interface AdminActor {
  readonly type: typeof AUDIT_ACTOR_TYPE.ADMIN;
  readonly id: string;
}
export interface CustomerActor {
  readonly type: typeof AUDIT_ACTOR_TYPE.CUSTOMER;
  readonly id: string;
  readonly accountId: string;
}
export type AuditActor = SystemActor | AdminActor | CustomerActor;

export const auditActor = {
  system: (): SystemActor => ({ type: AUDIT_ACTOR_TYPE.SYSTEM }),
  admin: (id: string): AdminActor => ({ type: AUDIT_ACTOR_TYPE.ADMIN, id }),
  customer: (id: string, accountId: string): CustomerActor => ({
    type: AUDIT_ACTOR_TYPE.CUSTOMER,
    id,
    accountId,
  }),
} as const;
```

`writeAuditLog` maps the union once: `ADMIN → { userId: actor.id }`, `CUSTOMER → { customerUserId: actor.id }` (and `accountId: entry.accountId ?? actor.accountId` — an explicit entry-level `accountId` wins), `SYSTEM → {}`; always `actorType: entry.actor.type`.

Direct writers (public API gains OPTIONAL fields only; internals set the column):

- `AuditService.log` (`auditService.ts:62`) + `AuditLogger.log` (`auditLogger.ts:90`): params/event types gain `customerUserId?` + `actorType?`; internally derive when absent — `userId` present → `ADMIN`, `customerUserId` present → `CUSTOMER`, else `SYSTEM` (same rule as the backfill). Their `as Parameters<...>` casts bypass compiler forcing, hence the explicit derivation.
- `AnalyticsAccountHandlers.ts:139` + `AdminAuthService.ts:618` set `userId` → add explicit `actorType: 'ADMIN'` (2 one-liners).
- `CustomerAccountBillingService.ts:119` (port caller) → compiler-forced by the required port field → `actorType: AUDIT_ACTOR_TYPE.ADMIN`.
- `gatewaySwitchProcessor.ts:122` + `credentialManager.ts:385`: untouched — no `userId`, genuinely system actions, `@default(SYSTEM)` is correct.

**MFA PR2 handoff contract** (signature-level, zero PR2 rework on A1 surfaces): A1 ships `logSecurityEvent(actor: AuditActor, accountId: string, options)` and `auditActor.customer(id, accountId)`. In A1, `MfaService.audit()` (`MfaService.ts:387-398`) converts mechanically to `this.logSecurityEvent(auditActor.admin(subject.id), subject.id, {...})` — behavior-preserving (every live subject is admin until PR2 repoints the customer routes). In PR2, `audit()` gains the subject's account id (from `MfaUserRecord.accountId?`, which PR2 adds — the customer adapter returns the non-nullable `CustomerUser.accountId`) and builds:

```typescript
const actor =
  subject.type === MFA_SUBJECT_TYPE.CUSTOMER
    ? auditActor.customer(subject.id, accountId) // accountId guaranteed by the customer adapter
    : auditActor.admin(subject.id);
await this.logSecurityEvent(actor, accountId ?? subject.id, { action, severity, details });
```

No silent admin fallback for customer subjects — that would recreate the FK-violation bug.

## Data Flow

    MfaService.audit (PR2: MfaSubject → actor)      28 wrapper call sites / 6 files (mechanical wrap)
              │                                               │
      auditActor.customer(id, accountId)        auditActor.admin(userId) / .system()
              └───────────────────┬───────────────────────────┘
                                  ▼
              AuditableService wrappers (actor-first)
                                  ▼
              writeAuditLog — ONE switch: actor → {userId | customerUserId} + actorType
                                  ▼
              AuditLogRepository.create (actorType REQUIRED)
                                  ▼
        PrismaAuditLogRepository ──► AuditLog (CHECK num_nonnulls ≤ 1; FK → AdminUser, FK → CustomerUser)
                                  ▲
        direct writers (2 derive + 3 explicit; 2 untouched system writers rely on DEFAULT)

## File Changes

| File                                                                                                                                                                              | Action | PR  | Description                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma` + migration                                                                                                                                          | Modify | A1  | Enum, 2 columns, relation + reverse, index, CHECK, backfill                                                                                                         |
| `packages/core/domain/src/repositories/AuditLogRepository.ts`                                                                                                                     | Modify | A1  | `AUDIT_ACTOR_TYPE` union; required `actorType` + `customerUserId?` on input; DTO fields; `anonymizeCustomerUser`                                                    |
| `apps/api/src/infrastructure/repositories/PrismaAuditLogRepository.ts`                                                                                                            | Modify | A1  | Create maps new fields; `anonymizeCustomerUser` (`updateMany` → null FK)                                                                                            |
| `apps/api/tests/unit/helpers/InMemoryAuditLogRepository.ts`                                                                                                                       | Modify | A1  | Mirror port contract                                                                                                                                                |
| `apps/api/src/services/AuditableService.ts`                                                                                                                                       | Modify | A1  | `AuditActor` union + factories; `entry.actor`; actor-first wrappers; `writeAuditLog` switch                                                                         |
| `auth/mfaService.ts`, `auth/authServiceCore.ts`, `auth/authServiceSession.ts`, `admin/AccountSessionService.ts`, `admin/auth/MfaService.ts`, `admin/accountLifecycleService.ts`   | Modify | A1  | 28 mechanical `auditActor.admin()` wraps across 6 files (own commit); `authServiceCore` `*Public` forwarder signatures auto-track via `Parameters<>` (no body edit) |
| `apps/api/src/audit/auditService.ts`, `apps/api/src/security/auditLogger.ts`                                                                                                      | Modify | A1  | Optional public fields + internal derivation                                                                                                                        |
| `apps/api/src/admin/AnalyticsAccountHandlers.ts` (`:139`), `apps/api/src/admin/auth/AdminAuthService.ts` (`:618`), `apps/api/src/admin/CustomerAccountBillingService.ts` (`:119`) | Modify | A1  | Direct `auditLog.create` writers: explicit `actorType: ADMIN` (`CustomerAccountBillingService` is a port caller — compiler-forced)                                  |
| `docs/technical/ADR-0020-audit-actor-exclusive-arc.md`                                                                                                                            | Create | A1  | Exclusive-arc decision record (authored at apply)                                                                                                                   |
| Unit + integration test files                                                                                                                                                     | Create | A1  | See Testing Strategy                                                                                                                                                |
| `apps/api/src/audit/auditService.ts` (`getLogs`/`getStats`), `apps/api/src/security/auditLogger.ts` (`getStatistics`)                                                             | Modify | A2  | Customer include; second groupBy; additive `topCustomerUsers`                                                                                                       |
| `apps/api/src/audit/auditRoutes.ts`                                                                                                                                               | Modify | A2  | Append "Actor Type" + "Customer Email" CSV columns                                                                                                                  |
| `apps/admin/lib/api/types.ts` + compliance view                                                                                                                                   | Modify | A2  | Additive `actorType`, `customerUserId`, `customerUser?` fields; render actor                                                                                        |

## Testing Strategy

Strict TDD (RED→GREEN). LXC: single test file per run, `--max-old-space-size` heap cap, `timeout` wrapper; `pnpm db:up` before integration.

| Scenario (spec anchor)                                                                                      | Test                                                                                                                                                               | Layer              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Customer-actor row persists, FK resolves — **the RED anchor** (today: AdminUser FK violation drops the row) | New `node:test` integration file                                                                                                                                   | integration        |
| Exclusive-arc CHECK rejects dual-FK insert                                                                  | Same integration file                                                                                                                                              | integration        |
| `SetNull` on CustomerUser delete retains the row                                                            | Same integration file                                                                                                                                              | integration        |
| `anonymizeCustomerUser` against real DB — nulls FK, `actorType` survives                                    | Same integration file                                                                                                                                              | integration        |
| Seam actor mapping: ADMIN / CUSTOMER / SYSTEM → correct port input (RED: `entry.actor` absent today)        | vitest unit + `InMemoryAuditLogRepository`                                                                                                                         | unit               |
| Admin write byte-identical (create-input equality vs pre-change fixture)                                    | vitest unit                                                                                                                                                        | unit               |
| System write: both FKs absent, `actorType = SYSTEM`                                                         | vitest unit                                                                                                                                                        | unit               |
| `anonymizeUser` admin behavior preserved; `anonymizeCustomerUser` on in-memory (RED: method absent)         | vitest unit                                                                                                                                                        | unit               |
| Direct-writer derivation (`AuditService.log`, `AuditLogger.log`)                                            | vitest unit                                                                                                                                                        | unit               |
| Backfill correctness                                                                                        | Apply-phase verification: run migration on the dev DB (has pre-existing rows) + reconciliation queries (a post-migration test cannot fabricate pre-migration rows) | manual/scripted    |
| A2: stats merge, CSV column values, admin CSV byte-identity                                                 | vitest unit; CSV via integration                                                                                                                                   | unit + integration |
| A2: frontend type renders customer actor; admin rows unchanged                                              | vitest component (`@testing-library/react`)                                                                                                                        | unit               |

## ADR-0020 Outline (authored in A1 apply)

`docs/technical/ADR-0020-audit-actor-exclusive-arc.md` — ADR-0001 template: **Status** Accepted · **Date** (apply date) · **Deciders** Edward Velasquez · **Context**: AdminUser-only FK drops customer-actor rows (confirmed loss path via `MfaService.audit`); `mfa-consolidation` PR2 hard-blocked; OWASP/NIST attribution · **Decision**: additive exclusive arc — `customerUserId` FK, `actorType` Postgres enum with `@default(SYSTEM)`, CHECK `num_nonnulls <= 1`, `accountId` required on CUSTOMER at the type level (not DB), seam as discriminated union · **Rationale**: Karwin ch. 7 sanctioned shape; Prisma polymorphism guidance; type-level unrepresentability at the seam; evidence-preservation over compiler-forcing at direct writers · **Alternatives**: B free-string + `actorType` without FKs (the documented antipattern); C actor supertype table (disproportionate blast radius); optional-fields seam (invalid states representable); stronger CHECK tying `actorType` to its FK (breaks DSAR — anonymization nulls FKs while `actorType` survives) · **Consequences**: third actor = one column + CHECK edit; readers use `actorType`, never null-inference; stats need one grouped query per actor column · **Revisit if**: a third actor type arrives; audit volume demands partitioning/batched backfills · **Risks**: future direct writers mislabeling as SYSTEM — mitigation: reconciliation query `actorType='SYSTEM' AND ("userId" IS NOT NULL OR "customerUserId" IS NOT NULL)` must return 0 (both FK arms); backlog fitness idea · **Consequences (add)**: `anonymizeCustomerUser` ships port-complete but caller-less; hard customer delete is covered by FK `onDelete: SetNull`; application-level erasure hook (DSAR completion) deferred to backlog · **References**: Karwin _SQL Antipatterns_ ch. 7; Prisma relations + table-inheritance docs; OWASP Logging Cheat Sheet; NIST SP 800-92; down-migration SQL block.

## Fitness Matrix

| #              | Where it bites                                                                         | Why the design passes                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #3 (no `any`)  | `actorType` typing, adapter mapping                                                    | Const-object unions end-to-end; port literals assignable to `$Enums.AuditActorType` (generated as const object, not TS `enum`) — zero new casts                                         |
| #9/#10 (JSDoc) | New test files (A1 adds no new src files — union + factories live in existing modules) | `@file/@description/@layer infrastructure` on every new test file; ADR is docs                                                                                                          |
| #21 (DI)       | Nothing new is constructed                                                             | No new classes/tokens; all touched writers already receive `PrismaClient`/port via constructor; factories are pure functions                                                            |
| #23 (raw SQL)  | Backfill UPDATE + CHECK; A2 stats                                                      | Both live in migration SQL (grep scopes `apps/api/src` + `apps/workers/src` — migrations exempt); A2 uses typed `groupBy`, and #23 is WHY the COALESCE `$queryRaw` variant was rejected |

## Migration / Rollout

A1 → A2 chained `stacked-to-main`; A1 blocks `mfa-consolidation` PR2 (hard ordering). Rollback: A2 is read-only (revert commit); A1 code is additive-revertible and the migration has the documented down SQL; if MFA PR2 has merged, revert PR2 first. Review workload: A1 is the heavy slice (schema + port + seam + 28 wraps + tests + ADR) — `sdd-tasks` must forecast the 400-line budget; the 28-site mechanical wrap is a separable commit (candidate internal split point if the forecast demands it).

## Open Questions

None blocking. Backlog notes (out of scope, do not fold into the slice):

- [ ] `accountLifecycleService.ts:447` passes an `accountId` into `anonymizeUser(userId)` — pre-existing semantic smell; audit separately.
- [ ] Loud audit-write failure (rethrow/alerting on the `writeAuditLog` catch) — separate operational decision per proposal.
- [ ] Possible fitness grep for direct `prisma.auditLog.create` without `actorType` — hard to regex reliably; treat as review-time concern for now.
