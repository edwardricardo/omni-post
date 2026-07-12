# Tasks: Audit Actor Polymorphism

> **A1 HARD-BLOCKS `mfa-consolidation` PR2.** PR2 routes customer MFA subjects into
> audit writes; without A1's schema + seam those rows hit the AdminUser FK and are
> dropped. A1 MUST merge before MFA PR2. Recorded here and in the A1 PR description.

## Legend

- `[SENSITIVE]` — touches `infra/prisma/schema.prisma`, `infra/prisma/migrations/**`,
  `apps/api/src/auth/**`, `apps/api/src/admin/auth/**`, or `apps/api/src/security/**`.
  Requires an active `omnipost-allow sensitive-edit` token (15-min TTL, owner-issued).
- `[RED]` write the failing test first · `[GREEN]` implement to pass (Strict TDD).
- Every verify command is a **single test file**, LXC-safe (heap-cap `--max-old-space-size`,
  `timeout` wrapper). Integration files need `pnpm db:up` first.

### Sensitive-edit token windows

Two windows, ordered so one token covers each cluster; **schema/migration FIRST**
(everything else type-checks against the regenerated client):

- **Window A** — A1.1 (schema.prisma + migration).
- **Window B** — A1.5 + A1.6 sensitive source edits, contiguous: `auth/mfaService.ts`,
  `auth/authServiceCore.ts`, `auth/authServiceSession.ts`, `admin/auth/MfaService.ts`,
  `security/auditLogger.ts`, `admin/auth/AdminAuthService.ts`. A2.1's `auditLogger.ts`
  edit is A2's own window (separate PR).

> Two windows are unavoidable: the non-sensitive port + seam (A1.2–A1.4) MUST land
> between the schema and the wrap sites, because the wraps call the new actor-first
> seam signatures.

## Review Workload Forecast

| Field                   | Value                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | A1 ~560–650, A2 ~230–280 (total ~800–930)                                                                 |
| 400-line budget risk    | High (A1) · Medium (A2)                                                                                   |
| Chained PRs recommended | Yes                                                                                                       |
| Suggested split         | A1 → A2 (owner-fixed, stacked-to-main; do NOT reorder). Internal A1 cut: the 28 wraps as their own commit |
| Delivery strategy       | ask-on-risk (owner already fixed the A1/A2 stacked-to-main split)                                         |
| Chain strategy          | stacked-to-main                                                                                           |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

A1 exceeds 400 lines as an owner-fixed single PR (schema + port + seam + 28 wraps +
DSAR + ADR + tests cannot sub-split without breaking the atomic RED→GREEN block-order
guarantee). A1 needs maintainer `size:exception`; the 28-wraps isolated commit is the
review-focus aid. A2 is within budget.

### Suggested Work Units

| Unit | Goal                                                                            | PR  | Base            |
| ---- | ------------------------------------------------------------------------------- | --- | --------------- |
| 1    | Schema + port/adapters + `AuditActor` seam + 28 wraps + DSAR + ADR-0020 + tests | A1  | main            |
| 2    | Read-path visibility (stats, CSV, API shape, admin frontend type) + tests       | A2  | main (after A1) |

Dependency diagram: `📍 A1 → A2` · `A1 ⛔ blocks mfa-consolidation PR2`.

---

## A1: Schema + Write Path + DSAR + ADR (base: main) — blocks MFA PR2

### Phase A1.0 — Preconditions

- [x] 0.1 Run `pnpm db:up` (mandatory before any migration/integration test). If Prisma
      later reports **P3015 / "not yet applied"**, look for an orphan NON-migration directory
      inside `infra/prisma/migrations/` (e.g. a stray `.claude/` dir) and move it OUT — this
      is a stray-directory gotcha, NOT a shadow-DB issue (diagnose with `prisma migrate status`).

### Phase A1.1 — Schema & Migration [Window A; FIRST]

- [x] 1.1 [RED] Create node:test integration file
      `apps/api/tests/integration/auditActorPolymorphism.integration.test.ts` — **RED anchor**:
      a customer-actor row (customer id → `customerUserId`, `accountId` set) persists and the
      FK resolves; dual-FK insert rejected by the CHECK; `SetNull`-on-CustomerUser-delete
      retains the row; `anonymizeCustomerUser` nulls FK while `actorType` survives. JSDoc
      `@file/@description/@layer infrastructure`. Verify (fails RED, schema absent):
      `pnpm --filter @apps/api test:integration -- auditActorPolymorphism`.
- [x] 1.2 [SENSITIVE][GREEN] Edit `infra/prisma/schema.prisma`: add `enum AuditActorType { SYSTEM ADMIN CUSTOMER }`;
      on `AuditLog` add `customerUserId String?`, `actorType AuditActorType @default(SYSTEM)`,
      relation `customerUser CustomerUser? @relation("PerformedByCustomer", fields:[customerUserId], references:[id], onDelete: SetNull)`,
      `@@index([customerUserId, createdAt])`; on `CustomerUser` add reverse `auditLogs AuditLog[] @relation("PerformedByCustomer")`.
      Leave the `userId`/`"PerformedBy"` AdminUser relation UNTOUCHED.
- [x] 1.3 [SENSITIVE][GREEN] Generate migration under `infra/prisma/migrations/`
      (`prisma migrate dev --create-only`, then hand-edit to the design SQL), in this order:
      `CREATE TYPE "AuditActorType"` → `ADD COLUMN "customerUserId" TEXT` →
      `ADD COLUMN "actorType" ... DEFAULT 'SYSTEM'` → backfill `UPDATE ... SET actorType='ADMIN' WHERE "userId" IS NOT NULL` →
      CHECK `num_nonnulls("userId","customerUserId") <= 1` → FK (`ON DELETE SET NULL ON UPDATE CASCADE`) →
      INDEX. Regenerate the Prisma client. Verify: 1.1 now GREEN.
- [x] 1.4 Post-migration reconciliation on the dev DB (backfill correctness — a post-migration
      test cannot fabricate pre-migration rows): `actorType='SYSTEM' AND ("userId" IS NOT NULL OR "customerUserId" IS NOT NULL)` → **0**;
      `actorType='ADMIN' AND "userId" IS NULL` → **0** (pre-DSAR).

### Phase A1.2 — Port + Adapters

- [x] 2.1 [RED] Extend `apps/api/tests/unit/domain/repositories/AuditLogRepository.test.ts`:
      `AUDIT_ACTOR_TYPE` const-object union (3 values); required `actorType` + optional
      `customerUserId` on `AuditLogCreateInput`; DTO gains `customerUserId`/`actorType`;
      `anonymizeCustomerUser` on the interface. Verify RED: `pnpm --filter @apps/api test -- AuditLogRepository`.
- [x] 2.2 [GREEN] Edit `packages/core/domain/src/repositories/AuditLogRepository.ts`: add
      `AUDIT_ACTOR_TYPE` (`as const`) + `AuditActorType`; required `actorType` + `customerUserId?`
      on input; `customerUserId: string|null` + `actorType` on DTO; `anonymizeCustomerUser(customerUserId: string): Promise<number>`.
      JSDoc. Verify GREEN (same file).
- [x] 2.3 [RED] Extend `apps/api/tests/unit/infrastructure/repositories/PrismaAuditLogRepository.test.ts`:
      create maps `customerUserId` + `actorType`; `anonymizeCustomerUser` → `updateMany` nulls ONLY `customerUserId`. Verify RED.
- [x] 2.4 [GREEN] Edit `apps/api/src/infrastructure/repositories/PrismaAuditLogRepository.ts`:
      map new fields in create; implement `anonymizeCustomerUser`. Verify GREEN.
- [x] 2.5 [GREEN] Mirror the port in `apps/api/tests/unit/helpers/InMemoryAuditLogRepository.ts`
      (`customerUserId`/`actorType` fields + `anonymizeCustomerUser`). Verified by A1.3/A1.4 unit tests.

### Phase A1.3 — AuditableService seam

- [x] 3.1 [RED] Extend `apps/api/tests/unit/AuditableService.test.ts` (**RED anchor: `entry.actor` absent today**):
      ADMIN actor → `{userId, actorType:ADMIN}`, null `customerUserId`; CUSTOMER → `{customerUserId, actorType:CUSTOMER, accountId}`, null `userId`;
      SYSTEM → both FKs absent, `actorType:SYSTEM`; admin write byte-identical vs a pre-change create-input fixture. Verify RED.
- [x] 3.2 [GREEN] Edit `apps/api/src/services/AuditableService.ts`: add `SystemActor|AdminActor|CustomerActor`
      union + `auditActor` factories (import `AUDIT_ACTOR_TYPE`); replace `AuditLogEntry.userId?` with
      required `actor: AuditActor`; make the 6 wrappers actor-first; `writeAuditLog` = ONE switch
      (ADMIN→`userId`; CUSTOMER→`customerUserId` + `accountId: entry.accountId ?? actor.accountId`;
      SYSTEM→`{}`; always `actorType`). `logSystemAction` keeps signature (`auditActor.system()`);
      `executeWithAudit` maps `context.userId → auditActor.admin()` internally. Verify GREEN.

### Phase A1.4 — DSAR unit coverage

- [x] 4.1 [RED→GREEN] Extend the port/in-memory unit tests: `anonymizeCustomerUser` nulls
      `customerUserId`, `actorType` stays `CUSTOMER`; `anonymizeUser` admin behavior preserved
      (`userId` nulled, `actorType` `ADMIN`). Impl already in 2.2/2.4/2.5. Verify GREEN.
      (Real-DB DSAR coverage is in 1.1. No caller is wired — port-complete only, hard delete
      covered by FK `onDelete: SetNull`; application erasure hook is backlog.)

### Phase A1.5 — 28 mechanical wraps (OWN COMMIT) [Window B opens]

- [x] 5.1 [SENSITIVE][GREEN] `apps/api/src/auth/mfaService.ts` — wrap 8 `logSecurityEvent`
      (`:90,:152,:196,:264,:281,:331,:373,:420`) → `auditActor.admin(<id>)`; add import.
- [x] 5.2 [SENSITIVE][GREEN] `apps/api/src/auth/authServiceCore.ts` — wrap 7 sites: `logUserAction`
      (`:200,:217,:305`), `logSecurityEvent` (`:235,:262,:277`), `logResourceAction` (`:107`).
      `*Public` forwarders (`:338/:343/:350`) auto-track via `Parameters<>` — NO body edit.
- [x] 5.3 [SENSITIVE][GREEN] `apps/api/src/auth/authServiceSession.ts` — fix the 5 real caller
      sites (the `tsc`-breaking ones): `:58` `writeAuditLogPublic` (entry gains `actor`), `:98,:284`
      `logSecurityEventPublic`, `:140,:254` `logUserActionPublic` — pass `AuditActor`, not `string`.
- [x] 5.4 [GREEN] `apps/api/src/admin/AccountSessionService.ts` — wrap 2 `logSecurityEvent` (`:89,:171`).
- [x] 5.5 [SENSITIVE][GREEN] `apps/api/src/admin/auth/MfaService.ts` — wrap `logSecurityEvent` (`:393`)
      → `this.logSecurityEvent(auditActor.admin(subject.id), subject.id, {...})` (behavior-preserving;
      PR2 repoints customer subjects — this is the MFA PR2 handoff seam).
- [x] 5.6 [GREEN] `apps/api/src/admin/accountLifecycleService.ts` — wrap 5 sites: `logAccountAction`
      (`:117,:253,:387`), `logComplianceEvent` (`:325,:460`).
- [x] 5.7 Verify `tsc` clean (wraps + A1.3 seam prove each other) and rerun affected suites.
      This is the isolated **"28 mechanical wraps"** commit (design's natural internal cut point).

### Phase A1.6 — Direct writers + optional fields [Window B continues]

- [x] 6.1 [RED] Extend `apps/api/tests/unit/auditService.log.test.ts` + `apps/api/tests/unit/auditLogger.test.ts`:
      `log` derives `actorType` when absent (`userId`→ADMIN, `customerUserId`→CUSTOMER, else SYSTEM);
      optional `customerUserId`/`actorType` accepted. Verify RED.
- [x] 6.2 [GREEN] `apps/api/src/audit/auditService.ts` (`:62 log`) — optional fields + internal derivation. Verify GREEN.
- [x] 6.3 [SENSITIVE][GREEN] `apps/api/src/security/auditLogger.ts` (`:90 log`) — same. Verify GREEN.
- [x] 6.4 [GREEN] `apps/api/src/admin/AnalyticsAccountHandlers.ts:139` explicit `actorType: 'ADMIN'`;
      `apps/api/src/admin/CustomerAccountBillingService.ts:119` (port caller, compiler-forced) `actorType: AUDIT_ACTOR_TYPE.ADMIN`.
- [x] 6.5 [SENSITIVE][GREEN] `apps/api/src/admin/auth/AdminAuthService.ts:618` direct `auditLog.create`
      writer — add explicit `actorType: 'ADMIN'`. (`:189/:308` are NOT wrapper sites — a private method
      routing to `:618`; single writer.) Verify affected suite.
- [x] 6.6 Leave `gatewaySwitchProcessor.ts:122` + `credentialManager.ts:385` UNTOUCHED (genuine
      system actions; `@default(SYSTEM)` is correct).

### Phase A1.7 — ADR + guards + verify prep

- [x] 7.1 Author `docs/technical/ADR-0020-audit-actor-exclusive-arc.md` from the design outline
      (ADR-0001 template: Status Accepted · Date · Deciders Edward Velasquez · Context · Decision ·
      Rationale · Alternatives · Consequences · Revisit-if · Risks · References; include the
      down-migration SQL block: drop CHECK, index, FK, both columns, TYPE).
- [x] 7.2 Regression guard: keep the PR1 MFA suite green (orchestrator baseline: 106 tests) —
      the wraps touch `auth/mfaService.ts` + `admin/auth/MfaService.ts`. Run
      `apps/api/tests/unit/mfaService.test.ts`, `apps/api/tests/unit/unifiedMfaService.test.ts`,
      `apps/api/tests/unit/infrastructure/adapters/PrismaAdminMfaUserRepository.test.ts`,
      `apps/api/tests/unit/mfaRoutes.test.ts`. All green.
- [x] 7.3 Fitness spot-checks (exact greps; expect the documented counts):
  - #3 `grep -rnE "(:\s+any\b|\bas any\b|<any>)" apps/api/src/domain/ apps/api/src/application/ apps/api/src/infrastructure/ --include="*.ts" | grep -vE "//.*any|^[^:]+:[0-9]+:\s*\*" | wc -l` → 0
  - #9 `grep -rL "@file" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|dist\|\.next\|\.stryker\|reports/mutation\|next-env\.d\.ts" | wc -l` → 0
  - #10 `grep -rn "@layer" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|dist\|\.next\|\.stryker\|reports/mutation" | grep -v "@layer application\|@layer domain\|@layer infrastructure" | wc -l` → 0
  - #21 `grep -rlE "import \{[^}]*\bprisma\b[^}]*\} from \"@infra/prisma\"" apps/api/src apps/workers/src --include="*.ts" | grep -vE "/infrastructure/container/|/index\.ts$|/container/|\.test\.|/tests/" | wc -l` → 0
  - #23 `grep -rnE "\.\\\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\(" apps/api/src apps/workers/src --include="*.ts" | grep -vE "/extensions/tenantGuard|/infrastructure/container/|/tests/|\.test\." | grep -vE "/events/EventStore\.ts|/PrismaStyleGuideRuleRepository\.ts|/PrismaGlossaryRepository\.ts" | grep -vE "/unitofwork/PrismaUnitOfWork\.ts" | wc -l` → 0
- [x] 7.4 Verify-prep note (carry to `sdd-verify`): the design uses a SEPARATE
      `anonymizeCustomerUser(customerUserId)` vs the `customer-audit-write-path` spec scenario's
      literal `anonymizeUser(customerUserId)`. This is a **documented, intentional deviation**
      (design Decision 4) — `sdd-verify` MUST treat it as satisfied, NOT a gap. No spec edit required.
- [x] 7.5 A1 PR description: state **"A1 hard-blocks `mfa-consolidation` PR2"**; include the
      dependency diagram (`📍 A1 → A2`, `A1 ⛔ MFA PR2`); ship ADR-0020 in this PR; note the isolated
      28-wraps commit; record `size:exception` rationale (owner-fixed single PR > 400 lines).
- [x] 7.6 0-defect gate: `eslint --max-warnings 0`, `tsc` clean, fitness #3/#9/#10/#21/#23
      hard-zero, LXC-safe single-file test runs green.

---

## A2: Read-Path Visibility (base: main after A1)

### Phase A2.1 — Stats + getLogs

- [x] 8.1 [RED] Extend `apps/api/tests/unit/auditService.stats.test.ts` +
      `apps/api/tests/unit/auditService.query.test.ts` + `apps/api/tests/unit/auditLogger.test.ts`:
      stats no longer collapse customers into the null bucket; second `groupBy(["customerUserId"])`
      yields additive `topCustomerUsers`; `getLogs` exposes `actorType` + `customerUser`; admin
      stats byte-identical. Verify RED.
- [x] 8.2 [GREEN] `apps/api/src/audit/auditService.ts` `getStats` (`:255-276`): keep the existing
      `groupBy(["userId"])` + `adminUser.findMany` UNTOUCHED; add typed `groupBy(["customerUserId"], where:{customerUserId:{not:null}})`
  - `customerUser.findMany` → additive `topCustomerUsers` (`{user,email,count}`). `getLogs` adds
    `include:{customerUser:{select:{id,email,firstName,lastName}}}` + `actorType`. Verify GREEN.
- [x] 8.3 [SENSITIVE][GREEN] `apps/api/src/security/auditLogger.ts` `getStatistics` (`:356-365`):
      same additive second `groupBy`. (A2's own token window.) Verify GREEN.
      (Done: additive `topCustomerUsers` (`groupBy(["customerUserId"])` + `customerUser.findMany`
      lookup) + `byActorType` (`groupBy(["actorType"])`), mirroring `auditService.ts`'s `getStats`.
      Existing `topActions`/`topUsers`/`totalEvents`/`failedEvents`/`securityEvents` untouched.
      RED→GREEN: new "getStatistics — actor visibility" describe block in `auditLogger.test.ts`
      (3 cases: customer counted by identity, SYSTEM/CUSTOMER distinguishable via byActorType, admin
      topUsers unchanged) — 46/46 green. No route/handler consumes `getStatistics` outside its own
      test — change contained to the `AuditLogger` class.
      Assertions pin the defect both ways: the customer actor resolves to its own identity
      (`user: "Stats Customer"`) AND is absent from the ADMIN `topUsers` column, and `byActorType`
      asserts SYSTEM >= 1 alongside CUSTOMER >= 1 so the two null-`userId` actor kinds stay
      separable by discriminator, never by a null FK. RED-by-construction against HEAD, whose
      `getStatistics` returns neither field.)

### Phase A2.2 — CSV + API shape

- [x] 9.1 [RED] Extend the CSV export test (integration for real store; vitest for shape): a
      customer row exports a non-blank actor; admin CSV byte-identical to the pre-change `"User Email"`. Verify RED.
- [x] 9.2 [GREEN] `apps/api/src/audit/auditRoutes.ts` (`:369-383`): keep `"user.email"` column
      byte-identical; append `{key:"actorType",header:"Actor Type"}` + `{key:"customerUser.email",header:"Customer Email"}`. Verify GREEN.

### Phase A2.3 — Frontend type + compliance view

- [x] 10.1 [RED] vitest component (`@testing-library/react`) in `apps/admin/tests/unit/hooks/useAuditLogs.test.tsx`
      (+ compliance component test): customer actor representable; admin rows render unchanged. Verify RED.
      (Done: `useAuditLogs.test.tsx` +2 cases for customer representability/admin pass-through; mapper RED in
      `useCompliance.test.tsx`; new page-render test `tests/unit/compliance/CompliancePage.test.tsx` — customer
      identity + actor badge, admin row identical.)
- [x] 10.2 [GREEN] `apps/admin/lib/api/types.ts` (`AuditLog`, `:170-182`): additive `actorType`,
      `customerUserId: string|null`, `customerUser?` fields. `apps/admin/app/[locale]/(dashboard)/compliance/page.tsx`:
      render the actor via `actorType` + customer identity; admin unchanged. Verify GREEN.
      (Done additively. The compliance view's real data path is `useCompliance` → `AuditEvent` mapper, so the
      `useCompliance/{types.ts,api.ts}` path + i18n `compliance.audit.actorTypes.customer` (en/es) were extended
      too; `AuditLog` type in `lib/api/types.ts` covers the API response shape. Backend already emits
      `customerUser`/`actorType`/`customerUserId`.)
- [x] 10.3 A2 0-defect gate: `eslint --max-warnings 0`, `tsc` clean, fitness green, LXC-safe tests green.
      (Full A2 gate CLOSED: tsc @apps/admin=0, tsc @apps/api=0, eslint --max-warnings 0 on every
      touched file (frontend + `security/auditLogger.ts`), fitness #3/#9/#10/#12/#17/#21=0, i18n
      parity OK, all LXC-safe single-file test runs green (backend stats/CSV/auditLogger + frontend
      hooks/page). A2 complete — every task 8.1 through 10.3 done.)
