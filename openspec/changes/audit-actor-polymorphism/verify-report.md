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
   (pre-existing M) and `openspec/changes/archive/mfa-consolidation/{design,tasks}.md` (sibling change).
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
