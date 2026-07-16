# Tasks: ProjectMember Tenant Guard (Slice 5)

> Strict-TDD, dependency-ordered. RED precedes each GREEN. The two-tenant
> integration suite is the overarching **MERGE-BLOCKING RED** — green only after every
> phase lands. Smallest slice (Approach-A recipe minus routes/use-case/DTO/billing);
> the two deltas are D2's double-parent RAISE and a guarded-client (not HTTP) proof.
> Stacked on `69dd4cf2` (guard = 56, migrations through `20260715000100`).

## Sensitive-edit gate

**Token REQUIRED: YES — `infra/prisma/**`ONLY** (schema, 2 migrations,`tenantGuard.ts`).
Token-split: the **orchestrator** writes those 4 files inline under an active
`omnipost-allow sensitive-edit`; the **apply-agent** handles every non-sensitive file.
No `apps/api/src/security/\*\*` is touched this slice.

## Command legend (LXC-safe, single-file)

- **DBUP**: `pnpm db:up` (before any migration or integration test)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=7168 pnpm --filter @apps/api exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=7168 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **MIGRATE**: author `prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply `pnpm db:up && pnpm db:migrate`
- **CLIENT-REGEN**: `pnpm --filter @infra/prisma build`

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~320–390 (mig A+D2 ~55, mig B RLS pair ~30, schema ~5, guard ~2, seed ~1, port JSDoc ~1, unit matrix ~50, new integration ~180, run-tests.sh batch ~15, rls derived count ~15, docs ~20, spec ~15) |
| 400-line budget risk    | Medium                                                                                                                                                                                             |
| Chained PRs recommended | No                                                                                                                                                                                                 |
| Suggested split         | Single atomic PR (NOT-NULL column + guard flip must ship together or dev boot breaks)                                                                                                              |
| Delivery strategy       | single-pr                                                                                                                                                                                          |
| Chain strategy          | size-exception (only if apply measures > 400)                                                                                                                                                      |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

Rationale: expected under 400, but the gate-mandated run-tests.sh batch + rls derived
count push it into Medium. Cannot split: a NOT-NULL column with a flipped guard is one
atomic invariant. Bulk is the goldens-like integration suite (low review risk). Per
single-pr strategy, confirm/record `size:exception` before apply if it measures > 400.

### Suggested Work Units

| Unit | Goal                                                                                                                                                         | Likely PR                        | Focused test command                                         | Runtime harness                                | Rollback boundary                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | Full slice (atomic): enroll `ProjectMember` (56→57) + double-parent RAISE backfill + wire the tenant-isolation batch + two-tenant guarded-client suite green | PR 1 (`size:exception` if > 400) | INT `tests/integration/projectMemberTenantIsolation.test.ts` | DBUP + two-tenant real-DB guarded-client suite | revert branch pre-merge; post-merge `down.sql` drops RLS, remove guard entry, column additive/harmless |

## Phase 1: RED — unit guard matrix (vitest, no DB)

- [x] 1.1 [apply-agent] [RED] `apps/api/tests/unit/security/tenantGuard.test.ts`: add `projectMember` membership + where-injection (find/update/delete) + `create` injection + explicit-mismatch throw + missing-context (`TenantContextMissingError`); update `getTenantScopedModels` size assertion **56 → 57** (`:663-664`). RED until 3.1.
- [x] 1.2 [apply-agent] Run VITEST 1.1 — expect RED (size + membership fail pre-flip). (Baseline captured RED on the 56 assertion — guard already flipped by orchestrator; 52 green after update.)

## Phase 2: Schema + migrations (foundation) — [SENSITIVE — orchestrator]

- [x] 2.1 [SENSITIVE — orchestrator] `infra/prisma/schema.prisma` (model `:369-381`): add `accountId String` + `account Account @relation(..., onDelete: Cascade)` + `@@index([accountId, projectId])`; KEEP `@@unique([projectId, memberId])` + `@@index([memberId])`; add `projectMembers ProjectMember[]` back-relation on `Account`.
- [x] 2.2 [SENSITIVE — orchestrator] Author **Migration A** `<ts>_add_project_member_account_id/migration.sql` (D1+D2): `ADD COLUMN accountId` nullable → **D2 DO-block RAISE** on `Project.accountId <> CustomerUser.accountId` (double-parent, BEFORE backfill) → `UPDATE ... FROM "Project"` over NOT-NULL `projectId` FK → in-tx RAISE on residual NULL → `SET NOT NULL` → FK `Account` ON DELETE CASCADE → `CREATE INDEX (accountId, projectId)`. Timestamp **> 20260715000100**.
- [x] 2.3 [SENSITIVE — orchestrator] Author **Migration B** `<ts>_add_rls_project_member/{migration,down}.sql` (D3): ENABLE RLS → `DROP POLICY IF EXISTS` → `CREATE POLICY tenant_isolation` on `app.account_id` GUC + `__system__` bypass (copied from `20260527000000`, NOT edited); `down.sql` drops policy + disables RLS. Timestamp **> 2.2**.
- [x] 2.4 [apply-agent] Assert ordering: A < B, both > `20260715000100`, column-before-RLS (B references A's column). (A=20260716000000 < B=20260716000100; both > 20260715000100.)
- [x] 2.5 [apply-agent] CLIENT-REGEN + `prisma format` + `prisma validate` — `accountId` present in generated create/row types. (validate ✓; generated `accountId` proven by the green create in the integration suite; `prisma format` NOT re-run — schema is sensitive/orchestrator-owned and already formatted.)
- [x] 2.6 [apply-agent] DBUP then MIGRATE apply — both clean, zero NULL `accountId` (RAISE holds), row count preserved. (migrate status up-to-date; ProjectMember 50 rows / 0 NULL / 0 parent-mismatch on dev+test DBs.)

## Phase 3: Guard flip — [SENSITIVE — orchestrator] → turns 1.1 GREEN

- [x] 3.1 [SENSITIVE — orchestrator] [GREEN] `infra/prisma/src/extensions/tenantGuard.ts`: insert `"projectMember"` between `"project"` (`:126`) and `"recurringPost"` (`:127`); header JSDoc count **56 → 57** (`:82`). Run VITEST 1.1 → GREEN.

## Phase 4: Seed + port JSDoc (D5, D6)

- [x] 4.1 [apply-agent] [GREEN] `infra/prisma/seed.ts:1112` create branch: add `accountId: account.id` (one line; `update: {}` branch unchanged — required post NOT-NULL because seed's unguarded superuser client injects nothing).
- [x] 4.2 [apply-agent] `packages/core/domain/src/repositories/CustomerUserRepository.ts` (`:44-48`): append one contract sentence to `findByProjectId` JSDoc — "Tenant-scoped: the guarded client restricts results to the bound tenant context; a foreign projectId yields an empty list." No wiring-status/timeline commentary. Signature/body unchanged (D5/D8).

## Phase 5: Test harness wiring (gate-mandated)

- [x] 5.1 [apply-agent] `apps/api/scripts/run-tests.sh`: add new `run_batch` **`integration:tenant-isolation`** (DB-only tier) wiring ALL 7 `*TenantIsolation.test.ts` suites (6 existing never-wired + new `projectMember`) + `rls-tenant-isolation.test.ts`. Without this the rollout's MERGE-BLOCKING proofs never ran under `test:all`/`test:integration`.
- [x] 5.2 [apply-agent] `apps/api/tests/integration/rls-tenant-isolation.test.ts` (`:137-141`): convert the policy-count assertion **51 → derived expected count** — query `pg_policies` for `tenant_isolation` rows, compare against `getTenantScopedModels()`. Verified empirically against the migrated DB: exact 1:1 parity (57 policies === 57 guard models) + bidirectional mapping assertion; **no new literal**.

## Phase 6: RED→GREEN — two-tenant integration (MERGE-BLOCKING)

- [x] 6.1 [apply-agent] [RED] Create `apps/api/tests/integration/projectMemberTenantIsolation.test.ts` (node:test, real DB, two tenants; standard `@file`/`@description`/`@layer infrastructure` header — fitness #9/#10). Build production guard in-test: `prisma.$extends(tenantGuardExtension(provider))` + real ALS provider (`tenantContext.ts`) + real `PrismaCustomerUserRepository`; seed via superuser client. **`seedTenant` creates ONE membership row PER tenant** (B's project HAS members) so the foreign-read `[]` is NON-VACUOUS. Assert: (a) A-ctx `findByProjectId(B.projectId)` → `[]`; (b) A-ctx own projectId → own members only; (c) no-context read → `TenantContextMissingError`, no rows; (d) A-ctx guarded create WITHOUT `accountId` → row `accountId == Project.accountId == CustomerUser.accountId`; (e) create with explicit FOREIGN `accountId` → mismatch throw. (D2 RAISE is deploy-time, NOT integration-tested — D7.)
- [x] 6.2 [apply-agent] Run INT `tests/integration/projectMemberTenantIsolation.test.ts` (DBUP first) via the new batch — GREEN, 7/7, 0 cancelled.

## Phase 7: Regression + docs + spec + 0-defect gate

- [x] 7.1 [apply-agent] Regression: `rg -l "projectMember|ProjectMember|findByProjectId|CustomerUserRepository"` across `apps/api/tests packages/**/tests infra/prisma` — update any mocks/fixtures for the new `accountId` field; RUN the full affected set. (No fixture writes a `projectMember` row; `findByProjectId` mocks belong to OTHER repos; `buildModelMock` projectMember mocks are schema-agnostic — nothing to update.)
- [x] 7.2 [apply-agent] `docs/security/MULTI_TENANT_GUARDS.md`: enroll `ProjectMember` (3-step canon checklist), bump guard **56 → 57** + RLS counts, note double-parent RAISE + no-HTTP-surface (SMELL-59 deferred create-ownership).
- [x] 7.3 [apply-agent] `openspec/specs/multi-tenant-isolation/spec.md`: Req-1 `ProjectMember` row; Req-2 block (no-HTTP-surface pin + double-parent invariant); Req-3 N/A note (seed-only writer).
- [x] 7.4 [apply-agent] **0-defect gate (0/green)**: `tsc` (@apps/api=0, @core/domain=0, @infra/prisma build=0), `eslint --max-warnings 0` on touched files=0, fitness **#8/#9/#10/#21/#23 = 0**, `prisma validate` valid + `migrate status` up-to-date + backfill 0-NULL/0-mismatch/50 rows, MERGE-BLOCKING `integration:tenant-isolation` batch green (88 tests, 0 cancelled), affected unit set green (94 tests). Full vitest suite run separately (verify scope).
