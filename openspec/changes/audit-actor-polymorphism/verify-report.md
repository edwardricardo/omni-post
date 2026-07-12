# Verify Report — audit-actor-polymorphism / PR A1

- **Change**: `audit-actor-polymorphism` (PR **A1** — polymorphic audit actor; hard-blocks `mfa-consolidation` PR2)
- **Branch**: `workstream/cluster-b-mfa` (uncommitted working tree = implementation)
- **Mode**: openspec (files) + engram mirror · Strict TDD active · adversarial re-derivation at source + runtime
- **Verdict**: **PASS WITH WARNINGS** — 0 CRITICAL · 1 WARNING (commit-boundary hygiene, non-code) · 3 SUGGESTION
- **Date**: 2026-07-09

Every MERGE-BLOCKING requirement is proven at runtime. The 0-defect gate is green
in this memory-capped LXC. The single WARNING is a git commit-scope hygiene item the
committer must honor (already flagged by apply); it is NOT an A1 code defect.

---

## 1. Completeness — tasks

| Group         | Tasks     | State                                     |
| ------------- | --------- | ----------------------------------------- |
| A1 (0.1–7.6)  | all `[x]` | COMPLETE — matches code                   |
| A2 (8.1–10.3) | all `[ ]` | UNTOUCHED (correct — A2 is a separate PR) |

No unchecked A1 implementation task. A2 correctly left unstarted.

## 2. Runtime evidence (all commands LXC-safe: `--pool=forks --maxWorkers=1 --no-file-parallelism`, heap-cap 3072, `timeout`)

| Suite                            | File(s)                                                                                        | Result                            | Command                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Real-DB integration (RED anchor) | `tests/integration/auditActorPolymorphism.integration.test.ts` (node:test)                     | **6 pass / 0 fail / 0 cancelled** | `node --conditions development --env-file=.env.test --import tsx --test --test-force-exit <file>` |
| Seam                             | `tests/unit/AuditableService.test.ts`                                                          | **19 pass**                       | `vitest run <file> --pool=forks --maxWorkers=1 --no-file-parallelism`                             |
| Port contract                    | `tests/unit/domain/repositories/AuditLogRepository.test.ts`                                    | **15 pass**                       | same                                                                                              |
| Prisma adapter                   | `tests/unit/infrastructure/repositories/PrismaAuditLogRepository.test.ts`                      | **11 pass**                       | same                                                                                              |
| Direct writer `AuditService.log` | `tests/unit/auditService.log.test.ts`                                                          | **15 pass**                       | same                                                                                              |
| Direct writer `AuditLogger.log`  | `tests/unit/auditLogger.test.ts`                                                               | **41 pass**                       | same                                                                                              |
| MFA PR1 regression               | `mfaService(27)`, `unifiedMfaService(17)`, `mfaRoutes(26)`, `PrismaAdminMfaUserRepository(12)` | **82 pass**                       | same                                                                                              |

Total: integration 6/6 + unit 101 (seam+port+adapter+writers) + MFA regression 82 — **all green, 0 cancelled/skipped**.

### Reconciliation queries (re-run by verify against the real test DB)

```
TOTAL_ROWS=1159
RECON_SYSTEM_MISLABEL (actorType='SYSTEM' AND (userId NOT NULL OR customerUserId NOT NULL)) = 0   ✓ expect 0
RECON_ADMIN_NULL_USER (actorType='ADMIN' AND userId IS NULL)                                  = 0   ✓ expect 0
BY_TYPE = [SYSTEM: 1157, ADMIN: 2]
```

Backfill deterministic and correct; both exclusive-arc invariants hold on real data.

## 3. Spec compliance matrix (each covering test passed at runtime)

### Capability: audit-actor-attribution (A1)

| Requirement [MERGE-BLOCKING]                                                                                                                                                                                                                | Evidence                                                                              | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| Polymorphic customer-actor FK (nullable `customerUserId`, `onDelete: SetNull`, relation `"PerformedByCustomer"` ≠ `"PerformedBy"`, reverse rel on CustomerUser, `@@index([customerUserId, createdAt])`, `userId`/`"PerformedBy"` untouched) | `schema.prisma` diff + integration test #1/#3 (FK resolves, SetNull retains)          | COMPLIANT |
| `actorType` const-object union SYSTEM/ADMIN/CUSTOMER (fitness #3, no raw union), deterministic backfill `userId!=null→ADMIN` else SYSTEM                                                                                                    | port `AUDIT_ACTOR_TYPE` (`as const`) + migration UPDATE + reconciliation 0/0          | COMPLIANT |
| DB exclusive-arc CHECK `num_nonnulls("userId","customerUserId") <= 1` in hand-written SQL                                                                                                                                                   | migration.sql:21-23 + integration test #2 (dual-FK rejected)                          | COMPLIANT |
| Data-safe down-migration                                                                                                                                                                                                                    | ADR-0020 §Down-migration (drops CHECK/index/FK/2 cols/TYPE; `actorType` re-derivable) | COMPLIANT |

### Capability: customer-audit-write-path (A1)

| Requirement [MERGE-BLOCKING]                                                                                                                                                   | Evidence                                                                                | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------- |
| Customer actor propagates through `AuditLogCreateInput`/DTO, Prisma+InMemory adapters, `AuditableService` seam; `AuditService.log`/`AuditLogger.log` gain OPTIONAL fields only | port + adapter diffs + seam switch + port/adapter/writer tests (101 pass)               | COMPLIANT |
| Customer-actor row persists against a REAL database                                                                                                                            | integration test #1 (persists + FK resolves)                                            | COMPLIANT |
| Admin write byte-for-byte unchanged + system write both FKs null                                                                                                               | integration #4/#5 + seam byte-identity test                                             | COMPLIANT |
| DSAR anonymization nulls customer FK, `actorType` survives                                                                                                                     | integration #6 + in-memory unit (documented deviation: `anonymizeCustomerUser`, see §5) | COMPLIANT |

## 4. Schema & migration (source re-derivation)

- `migration.sql` order EXACT: CREATE TYPE → ADD COLUMN customerUserId TEXT → ADD COLUMN actorType DEFAULT 'SYSTEM' → backfill UPDATE (userId NOT NULL → ADMIN) → CHECK `num_nonnulls("userId","customerUserId") <= 1` → FK (`ON DELETE SET NULL ON UPDATE CASCADE`) → INDEX. ✓
- `schema.prisma`: enum `AuditActorType {SYSTEM ADMIN CUSTOMER}`; `customerUserId String?`; `actorType AuditActorType @default(SYSTEM)`; relation `"PerformedByCustomer"` (distinct); reverse `auditLogs AuditLog[] @relation("PerformedByCustomer")` on CustomerUser; `@@index([customerUserId, createdAt])`; `userId`/`"PerformedBy"` unchanged. ✓
- CHECK is EXACTLY `num_nonnulls("userId", "customerUserId") <= 1`. ✓
- Migration applied to the test DB (integration passed) with 0/0 reconciliation. ✓

## 5. Seam + wraps + deviations (adversarial)

- **Seam**: `AuditableService.AuditLogEntry.userId?` REPLACED by required `actor: AuditActor`; `SystemActor|AdminActor|CustomerActor` union + `auditActor.{system,admin,customer}` factories; `CustomerActor` requires `accountId`; `writeAuditLog` = ONE switch (ADMIN→userId, CUSTOMER→customerUserId + `accountId ?? actor.accountId`, SYSTEM→{}; always `actorType`). Invalid dual-FK state unrepresentable. `logSystemAction`→`auditActor.system()`; `executeWithAudit`→`auditActor.admin(context.userId)`. ✓
- **28 wraps / 6 files** all converted: `mfaService.ts` ×8; `authServiceCore.ts` ×7; `authServiceSession.ts` ×5 (real caller sites, `*Public` forwarders auto-track via `Parameters<>`); `AccountSessionService.ts` ×2; `admin/auth/MfaService.ts` ×1; `accountLifecycleService.ts` ×5 = **28**. ✓
- **EventService.ts**: NOT modified (phantom commented reference) — compiles untouched (tsc EXIT 0). ✓
- **Deviation 6a — `services/audit.ts:66` `emitAudit`** (port caller the design missed): made polymorphic with `deriveActorType`. Derivation writes `userId` only from `input.userId`, `customerUserId` only from `input.customerUserId` — no cross-write. Verified `emitAudit` callers (`rbacService.ts:263` admin-scoped, `AuditEmitterAdapter` passthrough) pass only admin ids; NO A1 production path writes a customer id anywhere. **CORRECT.**
- **Deviation 6b — `authServiceCore.ts:167`** failed-login `USER_NOT_FOUND` → `auditActor.system()`: HONEST. No user exists to attribute; both FKs null is the only valid state and equals what the backfill labels a null-userId row (behavior-preserving). Forensics retained: `details.email`, `reason: USER_NOT_FOUND`, `ipAddress`, `userAgent`. A twin site `authServiceSession.ts:59` (BLACKLISTED_TOKEN_USED, pre-JWT-decode → no verified user) is equally honest SYSTEM with tokenHash/ip/userAgent retained. **Does NOT corrupt SYSTEM semantics.**
- **Deviation 6c — `AdminAuthService.ts:618`** used `event.userId ? 'ADMIN' : 'SYSTEM'` instead of hardcoded `'ADMIN'`: this writer sets `userId` CONDITIONALLY, so hardcoding ADMIN would create `ADMIN + userId NULL` rows and BREAK the reconciliation invariant. The derivation preserves it (verified: recon `ADMIN AND userId IS NULL` = 0). **CORRECT — improves on the design.**

## 6. Direct writers

- `PrismaAuditLogRepository.create` maps `actorType` + `customerUserId`; `anonymizeCustomerUser` = `updateMany` nulling ONLY `customerUserId`. InMemory mirrors. ✓
- `AnalyticsAccountHandlers:139` explicit `actorType:"ADMIN"`; `CustomerAccountBillingService:119` `actorType: AUDIT_ACTOR_TYPE.ADMIN` (port caller, compiler-forced); `auditService.ts` + `auditLogger.ts` derive when absent. ✓
- `gatewaySwitchProcessor.ts:122` + `credentialManager.ts:385` untouched (genuine SYSTEM, `@default`). ✓

## 7. 0-defect gate

| Check                                | Command                                                          | Result           |
| ------------------------------------ | ---------------------------------------------------------------- | ---------------- |
| tsc `@core/domain`                   | `pnpm --filter @core/domain exec tsc --noEmit`                   | **EXIT 0**       |
| tsc `@apps/api`                      | `pnpm --filter @apps/api exec tsc --noEmit`                      | **EXIT 0**       |
| eslint API (21 files)                | `eslint --max-warnings 0 <A1 api files>`                         | **EXIT 0**       |
| eslint port                          | `eslint --max-warnings 0 src/repositories/AuditLogRepository.ts` | **EXIT 0**       |
| fitness #3 (no any)                  | CLAUDE.md grep                                                   | **0**            |
| fitness #9 (@file)                   | CLAUDE.md grep                                                   | **0**            |
| fitness #10 (@layer)                 | CLAUDE.md grep                                                   | **0**            |
| fitness #21 (prisma DI)              | CLAUDE.md grep                                                   | **0**            |
| fitness #23 (raw SQL)                | CLAUDE.md grep                                                   | **0**            |
| #8 sprint/phase refs (A1 diff)       | grep added lines                                                 | **0**            |
| tripwire vocab (A1 diff + new files) | grep                                                             | **0**            |
| JSDoc @file/@layer on new files      | integration test + ADR                                           | present, English |

All new files carry `@file/@description/@layer infrastructure`; ADR-0020 conforms to the ADR-0001 outline (Status/Date/Deciders/Context/Decision/Rationale/Alternatives/Consequences/Revisit-if/Risks/Down-migration/References) with the down SQL block.

## 8. Scope isolation

- **No A2 leakage**: `auditRoutes.ts` and `apps/admin/lib/api/types.ts` UNMODIFIED; `auditService.ts`/`auditLogger.ts` changed only in the `log`/create path, NOT `getStats`/`getLogs`/`getStatistics`. ✓
- **No `mfa-consolidation` PR2 leakage**: no `PrismaCustomerMfaUserRepository`; `mfaRoutes.ts` UNMODIFIED; CustomerUser gains ONLY the `auditLogs` reverse relation (NO MFA columns). ✓
- ADR-0020 present and conformant. ✓

---

## Findings

### CRITICAL — none

### WARNING

1. **Commit-boundary hygiene (non-code).** The working tree also carries `.claude/settings.json`
   (pre-existing M) and `openspec/changes/mfa-consolidation/{design,tasks}.md` (sibling change).
   A1 code has ZERO dependency on them (markdown docs / IDE config). They MUST be EXCLUDED from the
   A1 commit or they pollute the PR. Apply already flagged this; the orchestrator (git owner) must honor it.
   Does NOT affect A1 implementation correctness.

### SUGGESTION

1. **Latent contradictory-combo on direct writers.** `deriveActorType` gives explicit `actorType`
   precedence, so a hypothetical future caller passing `actorType:'SYSTEM'` together with a `userId`
   would produce a reconciliation-violating row. No such caller exists in A1 and the ADR already lists
   this as an accepted, reconciliation-query-mitigated risk. Consider the backlogged fitness grep for
   `prisma.auditLog.create` without `actorType`.
2. **Enum-constant consistency (cosmetic).** `AnalyticsAccountHandlers:139` and `AdminAuthService:618`
   use raw `"ADMIN"`/`"SYSTEM"` string literals (type-checked against `$Enums.AuditActorType`) while
   `CustomerAccountBillingService` uses `AUDIT_ACTOR_TYPE.ADMIN`. Design-sanctioned and type-safe;
   importing the constant would unify the style. No correctness impact.
3. **Optional spec line alignment.** `specs/customer-audit-write-path/spec.md:94` still reads literal
   `anonymizeUser(customerUserId)` vs the implemented `anonymizeCustomerUser`. Documented intentional
   deviation (design Decision 4, task 7.4) — treated as SATISFIED. Aligning line 94 is optional polish
   the design explicitly left to discretion.

## Verdict

**PASS WITH WARNINGS.** All MERGE-BLOCKING requirements are proven at runtime (integration 6/6 on a
real DB, reconciliation 0/0, 265 unit/regression tests green, 0 cancelled). The 0-defect gate is green
(tsc 0/0 both packages, eslint 0/0, fitness #3/#9/#10/#21/#23 = 0, #8 = 0, tripwire = 0). The three
apply deviations are each judged correct — 6c is strictly better than the design. The lone WARNING is a
commit-scope hygiene item for the git-owning orchestrator, not an A1 code defect. **A1 is ready for
`sdd-archive`** once the orchestrator commits ONLY the A1 files (excluding `.claude/settings.json` and
the two `mfa-consolidation` docs).

---

## Post-verify remediation (same session)

The owner elected to resolve all 3 SUGGESTIONS immediately rather than carry them. Fresh
`sensitive-edit` token; sensitive files first.

| #   | Suggestion                                                                                                                                                                                                                                                                  | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Latent contradictory-combo on direct writers: explicit `actorType` took precedence over the FK, so a future caller passing `actorType:'SYSTEM'` alongside a set `userId`/`customerUserId` would produce a mislabeled row, detectable only after the fact by reconciliation. | **Derivation-wins hardening, applied at every create path outside the port-forced seam.** Inverted the precedence in `auditLogger.ts`, `auditService.ts` (`AuditService.log`), `AdminAuthService.ts`'s direct writer, and — in a follow-up micro-fix closing the residual — `services/audit.ts`'s `emitAudit` helper: an actor FK, when present, now ALWAYS determines `actorType` (`userId` → `ADMIN`, `customerUserId` → `CUSTOMER`); an explicit `actorType` is honored only when neither FK is set. The invalid combination is now structurally unrepresentable at all four create paths, not merely detectable later — same philosophy as the DB exclusive arc. `emitAudit` gained a dedicated new unit test file (`tests/unit/services/audit.test.ts`, none existed before) with RED→GREEN derivation-wins triangulation (7 tests). |
| S2  | Enum-constant consistency (cosmetic): `AnalyticsAccountHandlers:139` and `AdminAuthService:618` used raw `"ADMIN"`/`"SYSTEM"` string literals instead of `AUDIT_ACTOR_TYPE.*`.                                                                                              | Replaced both literals with `AUDIT_ACTOR_TYPE.ADMIN` / `AUDIT_ACTOR_TYPE.SYSTEM`, importing the const-object union from the port in each file. `auditLogger.ts` already used the constants (only its precedence order needed the S1 fix).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S3  | Optional spec line alignment: `specs/customer-audit-write-path/spec.md:94` still read the literal `anonymizeUser(customerUserId)` vs the implemented `anonymizeCustomerUser`.                                                                                               | Aligned the spec line to `WHEN anonymizeCustomerUser(customerUserId) runs`. Updated `design.md` Decision 4's deviation note to record the alignment as resolved history instead of a flag-for-verify instruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Re-verification after remediation (including the `emitAudit` micro-fix)

- `tsc --noEmit` (`@apps/api`): EXIT 0 (re-confirmed after the `emitAudit` fix).
- `eslint --max-warnings 0` on all touched files (including `services/audit.ts` and the new
  `tests/unit/services/audit.test.ts`): EXIT 0.
- Fitness #3 (no `any`) spot-check: 0.
- `auditLogger.test.ts` (43 pass), `auditService.log.test.ts` (17 pass), `tests/unit/services/audit.test.ts`
  (new, 7 pass — RED 2/7 on the derivation-wins override cases → GREEN 7/7): derivation-wins
  triangulation confirmed at all four create paths.
- Regression: `adminAuthService.test.ts` (15), `AuditableService.test.ts` (19), port contract (15),
  adapter (11), `rbacService.test.ts` (17), `EncryptionService.test.ts` (31) — all green, no
  behavior change for the real callers of `emitAudit` (none pass a conflicting FK+actorType combo).
- No A1 task checkbox regressed; A2 remains untouched.

**Final dedup micro-fix**: S1's `deriveActorType` implementation is now single-sourced as a pure
exported function on the port (`packages/core/domain/src/repositories/AuditLogRepository.ts`,
next to `AUDIT_ACTOR_TYPE`); the three local copies in `auditLogger.ts`, `audit/auditService.ts`,
and `services/audit.ts` were removed in favor of importing it. The port contract test
(`AuditLogRepository.test.ts`) is now the canonical home for the 6 derivation unit cases
(21 pass, up from 15); the three writer test files keep their triangulation tests as consumers.

---

---

# Verify Report — audit-actor-polymorphism / PR A2 (read-path visibility)

- **Change**: `audit-actor-polymorphism` (PR **A2** — read-path visibility; base: main after A1)
- **Branch**: `workstream/cluster-b-mfa` · A1 committed at `3242147a` (confirmed ancestor of `HEAD` `b97a4157`); uncommitted working tree = A2
- **Mode**: openspec (files) + engram mirror · Strict TDD active · adversarial re-derivation at source + runtime
- **Verdict**: **PASS WITH WARNINGS** — 0 CRITICAL · 2 WARNING · 4 SUGGESTION
- **Date**: 2026-07-12
- **Scope**: A2 (read path) + regression check that A1 still holds

The MERGE-BLOCKING do-not-regress guarantee — **admin reads are byte-identical** — is
**PROVEN**, not assumed: at source (line-by-line diff of all four read surfaces), at
runtime (a CSV byte-parity test that replays the _pre-change_ column table as the
baseline), and on a real database. No admin-visible count, column, order, or rendered
value changed. Neither WARNING is an admin regression or a spec violation.

---

## A2.1 Completeness — tasks

| Task                                               | Claim | Verified at source                                                                                 | Status |
| -------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- | ------ |
| 8.1 [RED] stats/query/logger tests                 | `[x]` | New describes in `auditService.stats.test.ts`, `auditService.query.test.ts`, `auditLogger.test.ts` | OK     |
| 8.2 [GREEN] `auditService.getStats` + `getLogs`    | `[x]` | `auditService.ts:325-368` (`topCustomerUsers` + `byActorType`), `:57-76` (`ACTOR_INCLUDE`)         | OK     |
| 8.3 [SENSITIVE][GREEN] `auditLogger.getStatistics` | `[x]` | `auditLogger.ts:405-443` + error-path fallback `:464-472`                                          | OK     |
| 9.1 [RED] CSV export test                          | `[x]` | `tests/unit/audit/auditExportColumns.test.ts` (new, exercises the real writer)                     | OK     |
| 9.2 [GREEN] CSV columns                            | `[x]` | `auditExportColumns.ts` (new) + `auditRoutes.ts:365`                                               | OK     |
| 10.1 [RED] frontend tests                          | `[x]` | `useAuditLogs.test.tsx`, `useCompliance.test.tsx`, `compliance/CompliancePage.test.tsx` (new)      | OK     |
| 10.2 [GREEN] frontend type + view                  | `[x]` | `lib/api/types.ts:170-213`, `useCompliance/{types,api}.ts`, `compliance/page.tsx:305`              | OK     |
| 10.3 A2 0-defect gate                              | `[x]` | Re-run independently below — all green                                                             | OK     |

**9/9 tasks complete; every checkbox matches code state.** No unchecked implementation task.

---

## A2.2 The merge-blocking claim: admin reads are byte-identical

Attacked hardest, across all four read surfaces. **Result: no regression on any.**

| Surface                                    | What the diff actually does                                                                                                                                                                                                 | Admin impact                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `auditService.ts` `getStats`               | Admin `groupBy(["userId"], where:{...where, userId:{not:null}})` + `adminUser.findMany` + the `topUsers` map (`:301-323`) are **outside every diff hunk** — untouched. `topCustomerUsers`/`byActorType` are appended after. | **None** — same filter, same counts, same shape |
| `auditLogger.ts` `getStatistics`           | The 5 original queries are **re-indented only** (Promise.all array reflow); `userId:{not:null}`, `take:10`, `orderBy` all identical. Two queries appended to the same `Promise.all`.                                        | **None**                                        |
| `auditRoutes.ts` + `auditExportColumns.ts` | Column table extracted verbatim into its own module; the 9 pre-change columns keep position **and** value; 2 columns appended at the end.                                                                                   | **None** (proven below)                         |
| `apps/admin` compliance view               | ONE additive JSX block, guarded by `log.actorType === AUDIT_ACTOR_TYPE.CUSTOMER` (`page.tsx:305`). An admin row cannot enter it.                                                                                            | **None**                                        |

**Runtime proof of CSV admin parity** — `auditExportColumns.test.ts` reconstructs the
_pre-change_ column table as `LEGACY_COLUMNS` and asserts the new admin row is a
byte-identical **prefix** of the old one:

```
expect(currentRow!.startsWith(`${legacyRow!},`)).toBe(true);   // 4/4 pass
```

Independent byte-probe (real `exportToCSV` + real `AUDIT_EXPORT_COLUMNS`, rows shaped as
`getLogs` actually emits them):

```
HEADER  [UserEmail]="User Email"        [ActorType]="Actor Type"  [CustomerEmail]="Customer Email"
ADMIN   [UserEmail]="admin@example.com" [ActorType]="ADMIN"       [CustomerEmail]=""
CUSTMR  [UserEmail]="undefined"         [ActorType]="CUSTOMER"    [CustomerEmail]="jane@example.com"
SYSTEM  [UserEmail]="undefined"         [ActorType]="SYSTEM"      [CustomerEmail]=""
```

Admin bytes unchanged. (The `"undefined"` on the non-admin rows is WARNING **A2-W1**.)

---

## A2.3 Spec compliance matrix (`specs/audit-actor-visibility/spec.md`)

| Requirement / Scenario                                        | Evidence (source)                                                                                                                                               | Covering test (passed at runtime)                                                                                                                                                                                                                                                                  | Status    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **R1** Customer actors visible in logs and stats              | —                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                  | COMPLIANT |
| R1.S1 Stats no longer collapse customers into the null bucket | `auditService.ts:325-368`; `auditLogger.ts:405-443`                                                                                                             | `auditService.stats.test.ts` "counts customer actors per customer identity…" + `byActorType` `{SYSTEM:2,ADMIN:6,CUSTOMER:3}` (19/19); `auditLogger.test.ts` "getStatistics — actor visibility" (46/46); **integration** `byActorType` `deepEqual {SYSTEM:1,ADMIN:1,CUSTOMER:2}` on a real DB (8/8) | COMPLIANT |
| R1.S2 `getLogs` returns the customer actor                    | `ACTOR_INCLUDE` `auditService.ts:57-76`, applied `:197`                                                                                                         | `auditService.query.test.ts` (17/17); **integration** "getLogs resolves the CUSTOMER actor identity against the real relation" — asserts `customerUser.id` + email, and `user === null` (8/8)                                                                                                      | COMPLIANT |
| **R2** CSV export carries the customer actor identity         | —                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                  | COMPLIANT |
| R2.S1 Customer row exports a non-blank actor                  | `auditExportColumns.ts:39-49`                                                                                                                                   | `auditExportColumns.test.ts` `cells[10] === "customer@example.com"`, `cells[9] === "CUSTOMER"` (4/4) + byte-probe above                                                                                                                                                                            | COMPLIANT |
| R2.S2 Admin row exports identically to today                  | `auditExportColumns.ts:25-38` (9 frozen columns)                                                                                                                | `auditExportColumns.test.ts` legacy-prefix byte assertion (4/4)                                                                                                                                                                                                                                    | COMPLIANT |
| **R3** API response + admin frontend type expose the actor    | —                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                  | COMPLIANT |
| R3.S1 Frontend type represents a customer actor               | `lib/api/types.ts:170-213` (`AUDIT_ACTOR_TYPE` const-object union); `useCompliance/types.ts:39,76-84`; backend emitter `AnalyticsComplianceHandlers.ts:101-137` | `useCompliance.test.tsx` "resolves a customer-actor row to the customer identity" -> `"Jane Doe"` (7/7); `useAuditLogs.test.tsx` (7/7)                                                                                                                                                             | COMPLIANT |
| R3.S2 Admin rows render unchanged                             | `compliance/page.tsx:305` (customer-only guard)                                                                                                                 | `CompliancePage.test.tsx` — admin row renders "Alice", asserts exactly ONE actor badge in the tab, i.e. the admin row gained none (2/2)                                                                                                                                                            | COMPLIANT |

**No spec requirement is UNTESTED or FAILING.** Every scenario has a covering test that
passed at runtime.

### Frontend data-path verification (the apply's discovery — CONFIRMED TRUE)

- `useAuditLogs` has **no page or component consumer** (`rg` over `apps/admin/app` + `components` -> 0 hits; only its own definition + test). Page-less: **true**.
- The compliance view's real path is `useCompliance` -> `fetch("/api/backend/admin/compliance/audit-logs")` (`useCompliance/api.ts:52`) -> served by `AnalyticsComplianceHandlers` (`GET /api/admin/compliance/audit-logs`).
- **Shape match verified field-for-field**: the handler emits `customerUserId`, `customerUser{id,email,firstName,lastName}|null`, `actorType` (`AnalyticsComplianceHandlers.ts:128-137`); `BackendAuditLog` (`useCompliance/types.ts:76-84`) declares exactly those. **No undefined-render risk.** Both paths extended.

### SYSTEM vs CUSTOMER disambiguation (ADR-0020's core principle)

Grepped every added line for actor identity inferred from a null FK. **No reader derives
the actor TYPE from a null FK.** `actorType` is passed through end-to-end
(`AnalyticsComplianceHandlers.ts:137` -> `useCompliance/api.ts:127` -> `page.tsx:305`), and
the badge switches on it. The ambiguity ADR-0020 exists to kill is not reintroduced.
(One display-name coalescing chain remains — SUGGESTION **A2-S1**, not a bug.)

---

## A2.4 Test honesty audit

Every modified test file was diffed for weakened or deleted assertions:

```
git diff -U0 <file> | rg '^-[^-]'   ->  ZERO deleted assertions across ALL 8 modified test files
```

The only deleted lines in the entire test diff are one comment (`mockPrisma.ts`) and one
destructuring statement (`analyticsRoutes.test.ts`). **No assertion was weakened, relaxed,
or removed to make the suite pass.**

Specifically checked, since the `auditService.stats.test.ts` seed grew by 3 customer rows:
the pre-existing `Basic Counts` / `Top Actions` / `Top Users` assertions were **already**
loose (`total >= 8`, `count >= 3`, ordering-only) and sit **outside every diff hunk** — they
were not touched. A2 _strengthened_ the admin guarantee by ADDING an exact-equality assertion
that did not exist before:

```ts
expect(result.value.topUsers).toEqual([
  { user: "Audit Test User", email: "audit-test-user@example.com", count: 3 },
  { user: "Audit Test User 2", email: "audit-test-user2@example.com", count: 3 },
]);
```

**Blast-radius check on the shared helper**: `mockPrisma.ts` now injects
`customerUserId: null` + `actorType: "SYSTEM"` into `auditLogDefaults`, which touches every
mocked auditLog row across 32 consumer test files. All 6 consumers that actually reference
the auditLog store were re-run: **all green** (below). No hidden fallout.

---

## A2.5 Runtime evidence (LXC-safe: one file per run, heap-capped, timeout-wrapped)

Runner: `NODE_OPTIONS="--max-old-space-size=4096" timeout <n> pnpm --filter <pkg> exec vitest run <file> --pool=forks --maxWorkers=1 --no-file-parallelism`

| Suite                                                                                                                               | Result                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `apps/api` `tests/unit/auditService.stats.test.ts`                                                                                  | **19 passed**                          |
| `apps/api` `tests/unit/audit/auditExportColumns.test.ts` (new)                                                                      | **4 passed**                           |
| `apps/api` `tests/unit/auditLogger.test.ts`                                                                                         | **46 passed**                          |
| `apps/api` `tests/unit/auditRoutes.test.ts`                                                                                         | **35 passed**                          |
| `apps/api` `tests/unit/auditService.query.test.ts`                                                                                  | **17 passed**                          |
| `apps/api` `tests/unit/analyticsRoutes.test.ts`                                                                                     | **19 passed**                          |
| `apps/admin` `tests/unit/hooks/useCompliance.test.tsx`                                                                              | **7 passed**                           |
| `apps/admin` `tests/unit/hooks/useAuditLogs.test.tsx`                                                                               | **7 passed**                           |
| `apps/admin` `tests/unit/compliance/CompliancePage.test.tsx` (new)                                                                  | **2 passed**                           |
| **mockPrisma blast radius** — `authService` / `accountLifecycleService` / `mfaRoutes` / `rbacService` / `authRoutes` / `rbacRoutes` | **24 / 14 / 29 / 17 / 19 / 38 passed** |

**A1 regression (real DB; `pnpm db:up` -> `omnipost-infra` OK):**

```
node --conditions development --import tsx --test --test-force-exit --test-concurrency=1 \
  tests/integration/auditActorPolymorphism.integration.test.ts
# tests 8 · # pass 8 · # fail 0 · # cancelled 0 · # skipped 0
```

Covers A1's exclusive-arc CHECK, `SetNull`-on-delete, `deriveActorType` FK-wins, and
`anonymizeCustomerUser` (DSAR) — **A1 still holds** — plus A2's real-relation `getLogs` and
`getStats` actor counts. **0 cancelled** (canon requires it).

**Total: 305 tests passed, 0 failed, 0 cancelled.**

---

## A2.6 0-defect gate

| Gate                                | Command                                                                   | Result                                                          |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Typecheck API                       | `pnpm --filter @apps/api exec tsc --noEmit` (`--max-old-space-size=6144`) | **0 errors**                                                    |
| Typecheck Admin                     | `pnpm --filter @apps/admin exec tsc --noEmit`                             | **0 errors**                                                    |
| Lint (20 touched files)             | `eslint --max-warnings 0`                                                 | **0 errors / 0 warnings**                                       |
| Fitness #3 (no `any`)               | exact grep                                                                | **0**                                                           |
| Fitness #8 (sprint/phase refs)      | exact grep                                                                | **0** (see A2-W2 — the regex does not catch the bare `A2` form) |
| Fitness #9 (`@file` header)         | exact grep                                                                | **0**                                                           |
| Fitness #10 (`@layer` values)       | exact grep                                                                | **0**                                                           |
| Fitness #12 (`@component`)          | exact loop                                                                | **0**                                                           |
| Fitness #17 (`process.env` in Next) | exact grep                                                                | **0**                                                           |
| Fitness #21 (prisma singleton)      | exact grep                                                                | **0**                                                           |
| Tripwire vocabulary on the A2 diff  | added-lines scan                                                          | **0** blocking hits                                             |
| i18n parity                         | `pnpm --filter @apps/admin i18n:lint`                                     | **OK — en:1312 es:1312**, valid ICU, key + arg parity           |

New key `compliance.audit.actorTypes.customer` present in **both** `en` ("Customer") and
`es` ("Cliente").

**Scope**: A2 touched **no** schema, migration, or MFA file (`git status` -> none). No
`mfa-consolidation` regression surface. A2 is read-only over A1's schema, as designed.

---

## A2.7 Issues

### CRITICAL — none

No admin-visible count, column, order, or rendered value changed. Nothing blocks archive.

### WARNING

**A2-W1 — The frozen `"User Email"` CSV column emits the literal string `undefined` for
CUSTOMER and SYSTEM rows.**
`apps/api/src/audit/auditExportColumns.ts:31` — `{ key: "user.email", header: "User Email" }`
carries no `format`, and `exportToCSV` does `String(extractFieldValue(...))`
(`packages/shared/src/csv.ts:131` + `:191-208`), so an unresolved nested path stringifies to
`"undefined"`. Proven by byte-probe (section A2.2).
_Not an admin regression_ (admin rows always resolve `user.email`; their bytes are unchanged)
and _not a spec violation_ (the customer identity IS carried by the new `"Customer Email"`
column, satisfying R2.S1). It is **pre-existing** for SYSTEM rows — the legacy column table
had the identical unformatted column. But A2 makes customer rows exportable for the first
time, so this garbage value now lands on the exact row class the change exists to surface,
**inside a compliance artifact** that auditors read. The apply was aware of the behavior (it
added a blanking `format` to the _new_ column, `:43-48`) and deliberately froze the legacy one.
_Recommended follow-up_: add the same blanking `format` to `"User Email"`. It **cannot**
regress admin bytes — an admin row always has a resolved `user`, so the formatter is a no-op
there; only SYSTEM/CUSTOMER rows change (`"undefined"` -> `""`), which is the desired outcome.

**A2-W2 — Development-slice references in production and test comments.**
`apps/api/src/security/auditLogger.ts:338`, `apps/admin/lib/api/types.ts:205`,
`apps/admin/hooks/api/useCompliance/types.ts:39`, `apps/api/tests/unit/auditLogger.test.ts:818`
("…A2, 8.3" — a task number), `apps/admin/tests/unit/hooks/useAuditLogs.test.tsx:195`,
`apps/admin/tests/unit/compliance/CompliancePage.test.tsx:4`.
`CODING_STANDARDS.md` section "Comment Quality Rules": _"No references to sprint numbers,
implementation phases, or development timeline — belong in git history, not source code."_
`A2` and `8.3` are exactly that. **Fitness #8's regex does not match the bare `A2` form**
(count = 0 -> CI stays green), so this is a canon violation CI cannot see. These comments rot
the moment the change is archived and "A2" stops meaning anything. Strip the slice labels;
keep the behavioral prose (which is genuinely good).

### SUGGESTION

**A2-S1** — `apps/admin/hooks/api/useCompliance/api.ts:120` resolves the display name with a
coalescing chain (`log.user?.name ?? customerDisplayName(log.customerUser) ?? log.userId ?? "Unknown"`)
rather than switching on `actorType`. It is correct **today** only because A1's exclusive-arc
CHECK guarantees at most one actor FK is non-null (verified live in the integration test). The
actor _type_ is never inferred from a null FK, so ADR-0020's ambiguity is not reintroduced — but
an explicit `switch (log.actorType)` would make the reader's contract self-evident and immune
to any future relaxation of the arc.

**A2-S2** — The compliance view badges only `CUSTOMER` (`page.tsx:305`). A SYSTEM row and a
DSAR-anonymized ADMIN row both render as `"Unknown"` with no badge, so they stay visually
indistinguishable even though `actorType` is now on the DTO. Badging all three actor types is
a cheap win and completes the "readers switch on actorType" story.

**A2-S3** — Both `getStats` (`auditService.ts:336`) and `getStatistics` (`auditLogger.ts:428`)
run `customerUser.findMany` **after** the `groupBy` resolves, adding a serial round-trip. It
mirrors the existing `adminUser.findMany` shape (so it is internally consistent), but the
lookup could join the `Promise.all`.

**A2-S4** — `CompliancePage.test.tsx:21` uses the word "Stub" in a comment; `stub` is in the
pre-edit tripwire vocabulary. Used in its legitimate testing sense (a `vi.mock` test double),
not as a placeholder-implementation smell — no action needed, but a future edit to that file
may trip the hook.

---

## A2.8 Verdict

**PASS WITH WARNINGS** — 0 CRITICAL · 2 WARNING · 4 SUGGESTION.

A2 delivers every spec requirement with runtime proof, and the merge-blocking do-not-regress
guarantee holds under adversarial re-derivation: admin reads are byte-identical at source, in
the emitted CSV bytes, and against a real database. Test honesty is clean — zero assertions
were weakened, and the admin guarantee was actually _strengthened_ with a new exact-equality
assertion. The 0-defect gate is green. Neither WARNING blocks archive; **A2-W1** (the
`"undefined"` cell in the compliance CSV) should be fixed or logged as backlog before that
export is trusted by an auditor.

**Next**: `sdd-archive`.

---

## Post-verify remediation (A2)

Owner policy: resolvable warnings are closed BEFORE commit, never carried. Both WARNINGs are
resolved. The 4 SUGGESTIONs are each dispositioned explicitly below.

### A2-W1 — RESOLVED: the `"User Email"` column no longer emits the literal `undefined`

`apps/api/src/audit/auditExportColumns.ts` — the column now carries a `format`
(`formatOptionalCell`) that renders an absent relation as an **empty cell**:

```ts
{ key: "user.email", header: "User Email", format: formatOptionalCell }
```

The same helper replaces the inline formatter that the `"Customer Email"` column already
carried, so both relation columns share one blank-cell rule instead of duplicating it.

**Admin bytes proven unchanged.** The formatter is a strict no-op when the value resolves
(`value === null || value === undefined ? "" : String(value)`), and an ADMIN row always
resolves `user.email`. This is now asserted, not asserted-by-argument — RED→GREEN in
`apps/api/tests/unit/audit/auditExportColumns.test.ts` (4 → 8 tests):

| Test                                                                          | Before fix                  | After fix           |
| ----------------------------------------------------------------------------- | --------------------------- | ------------------- |
| `renders an empty User Email cell for a customer row`                         | FAIL — cell was `undefined` | PASS — cell is `""` |
| `renders an empty User Email cell for a system row`                           | FAIL — cell was `undefined` | PASS — cell is `""` |
| `never fabricates a value in an actor column, for any actor type`             | FAIL                        | PASS                |
| `keeps the admin User Email cell byte-identical once the column is formatted` | PASS (guard)                | PASS (guard)        |

The pre-existing byte-freeze guard (`keeps the admin actor row byte-identical to the
pre-change export`, asserting the `LEGACY_COLUMNS` prefix) was **not weakened** — it still
compares the admin row emitted through the pre-change column table against the current one and
still passes. The new byte test adds an exact cell-level equality on top of the prefix check.

### A2-W2 — RESOLVED: development-slice references stripped, prose kept

Every comment kept the behavioral prose (which explains WHY and is worth keeping); only the
slice/task label was removed. Nine call sites across the change's file set:

| File                                                          | Was                                                                 | Now                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `apps/api/src/security/auditLogger.ts:338`                    | `…a system action (audit-actor-polymorphism A2).`                   | `…a system action.`                      |
| `apps/admin/lib/api/types.ts:205`                             | `Additive (audit-actor-polymorphism A2): admin rows…`               | `Additive: admin rows…`                  |
| `apps/admin/hooks/api/useCompliance/types.ts:39`              | `Actor discriminator (audit-actor-polymorphism A2).`                | `Actor discriminator.`                   |
| `apps/admin/app/[locale]/(dashboard)/compliance/page.tsx:302` | `…invisible in this view before A2`                                 | `…used to be invisible in this view`     |
| `apps/api/tests/unit/auditLogger.test.ts:751`                 | `actorType derivation (audit-actor-polymorphism)`                   | `actorType derivation`                   |
| `apps/api/tests/unit/auditLogger.test.ts:818`                 | `getStatistics actor visibility (audit-actor-polymorphism A2, 8.3)` | `getStatistics actor visibility`         |
| `apps/admin/tests/unit/hooks/useAuditLogs.test.tsx:195`       | `customer actor visibility (audit-actor-polymorphism A2)`           | `customer actor visibility`              |
| `apps/admin/tests/unit/hooks/useCompliance.test.tsx:219`      | `Before A2 the mapper joined only…`                                 | `The mapper used to join only…`          |
| `apps/admin/tests/unit/compliance/CompliancePage.test.tsx:4`  | `Proves the audit-actor-polymorphism A2 read-path`                  | `Proves the polymorphic-actor read path` |

A repo-wide re-scan over the change's file set surfaced **four more** of the same class that
the verify had not enumerated (`A1` / `post-A1` slice tags, carried in from the previous PR).
They are fixed in the same pass:

| File                                                                      | Was                                             | Now                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| `apps/api/tests/integration/auditActorPolymorphism.integration.test.ts:4` | `(change \`audit-actor-polymorphism\`, PR A1)`  | removed                                |
| `apps/api/tests/unit/analyticsRoutes.test.ts:136`                         | `written by the customer flows since A1`        | `written by the customer-facing flows` |
| `apps/api/tests/unit/auditRoutes.test.ts:173`                             | `written by the customer-facing flows since A1` | `written by the customer-facing flows` |
| `apps/api/tests/unit/auditService.stats.test.ts:168,185`                  | `(post-A1: \`userId\` FK…)`                     | `: \`userId\` FK…`                     |

Final scan over the change's file set: **zero** surviving phase/slice/task references. (The
three `task` hits remaining in `auditLogger.ts` are the background-_task_ scheduler's own
vocabulary — domain language, not a development timeline.)

### Fitness #8 has a blind spot — BACKLOG

Fitness **#8** (`CLAUDE.md` section "Automated Compliance Checks") matches `Sprint [0-9A-Z]`,
`Phase [0-9]`, `T0A_`, `(P[0-9])` and similar — but **not** the bare slice form (`A1`, `A2`) nor
the bare task-number form (`8.3`). Both were present in production source and CI stayed green
(count = 0). The guard could not see the violation it exists to prevent. Widening that regex
is a repo-wide change (it will surface pre-existing hits across other workstreams and needs a
documented baseline per the "Extending the suite" protocol), so it is **not** done inside this
change — routed to backlog.

### Legacy CSV columns stringify absent optionals — BACKLOG (needs spec sign-off)

Found while fixing A2-W1, and deliberately **not** fixed here. Five pre-change columns carry no
`format` (`Resource`, `Resource ID`, `IP Address`, `User Agent`, `Error`), so `exportToCSV`'s
`String(value)` renders an absent optional as the literal `"null"` / `"undefined"`. Same defect
class as A2-W1, but the fix is **not** in scope: those columns are inside the nine-column
pre-change set that the spec freezes byte-for-byte, and blanking them **would change ADMIN row
bytes** — i.e. fixing them requires relaxing the merge-blocking do-not-regress guarantee, which
is a spec decision, not a remediation. The new guard test is therefore scoped to the three
actor columns A2 actually owns, and says so in a comment.

### SUGGESTION dispositions

| ID                                                                                       | Disposition                                                 | Reason                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A2-S1** (`actorType` switch instead of the coalescing chain in `useCompliance/api.ts`) | **Accepted, deferred to backlog**                           | Behavior-identical readability refactor. The verify itself confirms correctness holds today (the exclusive-arc CHECK guarantees at most one non-null actor FK, proven live in the integration test) and that ADR-0020's ambiguity is _not_ reintroduced. Not a defect → not a pre-commit blocker, and widening the remediation diff to a no-op refactor is exactly the scope creep this policy avoids. |
| **A2-S2** (badge all three actor types)                                                  | **Rejected for this change; backlog as a product decision** | Badging ADMIN rows would **change the ADMIN row's rendered markup** — a direct violation of the spec's merge-blocking guarantee that admin rows render identically. It cannot land here without a spec amendment. (Badging SYSTEM alone is admin-safe but is a product/UX call, not a defect.)                                                                                                         |
| **A2-S3** (`customerUser.findMany` joins the `Promise.all`)                              | **Accepted, deferred to backlog**                           | Pure latency micro-optimization on one serial round-trip; no correctness impact. It mirrors the existing `adminUser.findMany` shape, so the current code is internally consistent. Not a defect.                                                                                                                                                                                                       |
| **A2-S4** (the word "Stub" in a `CompliancePage.test.tsx` comment)                       | **FIXED**                                                   | Zero-risk one-word comment change (`Stub the app's navigation barrel` → `Mock the app's navigation barrel`). The usage was legitimate (a `vi.mock` test double), but the word is in the pre-edit tripwire vocabulary and would trap a future edit to that file for no benefit. Cheaper to remove than to explain forever.                                                                              |

### Post-remediation gate — 0 defect

All runs LXC-safe: one file per run, `--pool=forks --maxWorkers=1 --no-file-parallelism`,
heap-capped, `timeout`-wrapped.

| Suite                                                      | Tests     | Result |
| ---------------------------------------------------------- | --------- | ------ |
| `apps/api/tests/unit/audit/auditExportColumns.test.ts`     | 8 (was 4) | pass   |
| `apps/api/tests/unit/auditRoutes.test.ts`                  | 35        | pass   |
| `apps/api/tests/unit/auditLogger.test.ts`                  | 46        | pass   |
| `apps/api/tests/unit/auditService.stats.test.ts`           | 19        | pass   |
| `apps/api/tests/unit/auditService.query.test.ts`           | 17        | pass   |
| `apps/api/tests/unit/analyticsRoutes.test.ts`              | 19        | pass   |
| `apps/admin/tests/unit/hooks/useCompliance.test.tsx`       | 7         | pass   |
| `apps/admin/tests/unit/hooks/useAuditLogs.test.tsx`        | 7         | pass   |
| `apps/admin/tests/unit/compliance/CompliancePage.test.tsx` | 2         | pass   |

0 failed · 0 cancelled · 0 skipped.

| Gate                                          | Result                |
| --------------------------------------------- | --------------------- |
| `tsc --noEmit` @apps/api                      | 0 errors              |
| `tsc --noEmit` @apps/admin                    | 0 errors              |
| `eslint --max-warnings 0` (all touched files) | 0 errors · 0 warnings |
| `prettier --check` (all touched files)        | clean                 |
| Fitness #3 (no `any`)                         | 0                     |
| Fitness #8 (sprint/phase refs)                | 0                     |
| Fitness #9 (`@file` header)                   | 0                     |
| Fitness #10 (`@layer` values)                 | 0                     |

**Post-remediation verdict**: **PASS** — 0 CRITICAL · 0 WARNING · 4 SUGGESTION dispositioned
(1 fixed, 2 backlog, 1 rejected with spec rationale). Ready for `sdd-archive`.
