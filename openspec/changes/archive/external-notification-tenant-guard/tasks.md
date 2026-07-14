# Tasks: External Notification Tenant Guard (Slice 1 — Reference Implementation)

> Strict-TDD, dependency-ordered. RED test precedes each GREEN. The two-tenant
> integration suite is the overarching **MERGE-BLOCKING RED** — it goes green only
> after every phase lands. Slices 2–8 copy this shape (see design "Recipe").

## Sensitive-edit gate

**Sensitive-edit token REQUIRED: YES.** Every `[SENSITIVE]` task edits `infra/prisma/**`
and is BLOCKED without an active `omnipost-allow sensitive-edit` token. Acquire it before
Phase 1. Do NOT run migrations in this phase — authoring only; the apply phase runs them.

## Command legend (LXC-safe, single-file)

- **DBUP**: `pnpm db:up` (Postgres + Redis; run before any migration or integration test)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec vitest run <file>`
- **VITEST-CORE `<file>`**: `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @core/external-notifications exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=6144 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **MIGRATE**: author with `pnpm --filter @infra/prisma exec prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply (apply phase only) `pnpm db:up && pnpm db:migrate`
- **CLIENT-REGEN + TSC(prisma)**: `pnpm --filter @infra/prisma build`

## Review Workload Forecast

| Field                   | Value                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~360–420 (2 migrations ~90, schema ~8, guard ~2, src threading ~40, route ~3, wiring ~4, tests ~210, docs ~20) |
| 400-line budget risk    | Medium                                                                                                         |
| Chained PRs recommended | No                                                                                                             |
| Suggested split         | Single PR (atomic: NOT-NULL column + guard flip + threading MUST ship together or dev boot breaks)             |
| Delivery strategy       | ask-on-risk                                                                                                    |
| Chain strategy          | pending                                                                                                        |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

Rationale: near the 400 line, but the migration + guard flip + accountId threading are a
single atomic invariant (a NOT-NULL column with a flipped guard cannot land across PRs
without breaking create). If apply measures >400, take `size:exception`, do NOT split.
The bulk of lines is the integration test (goldens-like, low review risk).

### Suggested Work Units

| Unit | Goal                | Likely PR | Focused test command                                                | Runtime harness                      | Rollback boundary                                                       |
| ---- | ------------------- | --------- | ------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| 1    | Full slice (atomic) | PR 1      | INT `tests/integration/externalNotificationTenantIsolation.test.ts` | DBUP + two-tenant real-DB HTTP suite | revert guard/code commit (column stays, harmless); `down.sql` drops RLS |

## Phase 1: Foundation — schema + migrations (SENSITIVE, atomic, load-bearing order)

- [x] 1.1 [SENSITIVE] (done by orchestrator) `schema.prisma`: add `accountId String`, `account Account @relation(..., onDelete: Cascade)`, and `@@index([accountId])` to `ExternalNotificationConfig`; add the back-relation list field on `Account`. Index rule: leading column `accountId`. (Verified at source: model @2409 carries `accountId String`, `account Account @relation(onDelete: Cascade)`, `@@index([accountId])`; retains `@@index([projectId, isActive])`.)
- [x] 1.2 [SENSITIVE] (done by orchestrator) Author **Migration A** `20260714020035_..._account_id`: `ADD COLUMN "accountId"` nullable → backfill from `Project` → in-tx zero-NULL assert → `SET NOT NULL` → FK to `Account` `ON DELETE CASCADE` → accountId-led `CREATE INDEX`. Applied; backfill passed its in-migration zero-NULL assert.
- [x] 1.3 [SENSITIVE] (done by orchestrator) Author **Migration B** `20260714020135_..._add_rls_...` + `down.sql`: RLS `tenant_isolation` policy copied from `20260527000000`. Applied. (Live `pg_policies` count = 51, matching the existing `rls-tenant-isolation.test.ts` assertion after the PublishingQueue drop netted out.)
- [x] 1.4 **Assert ordering** (done by orchestrator): `A.timestamp (020035) < B.timestamp (020135)` — B's `CREATE POLICY` references the column A adds.
- [x] 1.5 CLIENT-REGEN + TSC(prisma) (done by orchestrator) — Prisma client regenerated; `accountId` is present in the generated create types (confirmed: `@apps/api` tsc compiles the adapter's explicit `accountId` threading).

## Phase 2: Guard flip (SENSITIVE) — RED → GREEN

- [x] 2.1 [RED] `apps/api/tests/unit/security/tenantGuard.test.ts`: added `externalNotificationConfig` membership + where-injection + `upsert.create` injection + explicit-mismatch + no-context cases; bumped count assertion 50 → 51. (Prior RED captured in obs 277: 6/6 failed pre-flip.)
- [x] 2.2 [SENSITIVE] [GREEN] (done by orchestrator) `infra/prisma/src/extensions/tenantGuard.ts`: `"externalNotificationConfig"` appended to `TENANT_SCOPED_MODELS`; JSDoc header `50` → `51`. tenantGuard.test.ts now 24/24 GREEN.

## Phase 3: accountId threading + create-path 404 (D2 + D3a) — RED → GREEN

- [x] 3.1 [RED] `packages/core/external-notifications/tests/unit/ConfigureExternalNotificationUseCase.test.ts` AND `apps/api/tests/unit/application/externalNotificationUseCase.test.ts`: ctor takes `ProjectRepositoryPort` (findById) as 2nd arg (UoW last); foreign/missing project → `err(NOT_FOUND)`; own project threads `project.accountId`. Ran → FAILED (core 5/8, api part of the 11 fails).
- [x] 3.2 [GREEN] `packages/core/domain/src/repositories/ExternalNotificationConfigRepository.ts`: `ExternalNotificationConfigData` gains required `accountId: string`.
- [x] 3.3 [GREEN] `packages/core/external-notifications/src/ConfigureExternalNotificationUseCase.ts`: ctor gains `projectRepository: ProjectRepositoryPort` (UoW last); parses `ProjectId.fromString` (invalid → VALIDATION_FAILED); resolves `projectRepository.findById(projectId)` BEFORE `doWork`; on miss returns `err(USE_CASE_ERRORS.NOT_FOUND)`; threads `project.accountId.toString()`. Ran → PASSES.
- [x] 3.4 [RED] `apps/api/tests/unit/infrastructure/PrismaExternalNotificationConfigRepository.test.ts`: `upsert.create` includes `accountId`; `toData` maps it; `update` must NOT touch `accountId`. Ran → FAILED.
- [x] 3.5 [GREEN] `apps/api/src/infrastructure/repositories/PrismaExternalNotificationConfigRepository.ts`: `accountId` in `upsert.create` (NOT in `update` — invariant D2); mapped in `toData` (+ record type). Ran → PASSES.
- [x] 3.6 [RED] `apps/api/tests/unit/infrastructure/container/setupExternalNotificationUseCases.test.ts`: Configure factory resolves `TOKENS.ProjectRepository`. Ran → FAILED.
- [x] 3.7 [GREEN] `apps/api/src/infrastructure/container/setupExternalNotificationUseCases.ts`: wired `TOKENS.ProjectRepository` into `ConfigureExternalNotificationUseCase` (2nd arg, UoW last). Ran → PASSES.
- [x] 3.8 [GREEN] `apps/api/src/external-notifications/externalNotificationRoutes.ts`: create handler `result.error.code === "NOT_FOUND" ? 404 : ...` branch added. D3a trap: integration RED confirmed foreign create 500 → GREEN 404 after this branch.

## Phase 4: Two-tenant integration (MERGE-BLOCKING RED → GREEN)

- [x] 4.1 [RED→GREEN] Created `apps/api/tests/integration/externalNotificationTenantIsolation.test.ts` (node:test, real DB, two tenants, in-process `app.inject`, guarded client wired like production). Asserts: (a) A `GET ?projectId={B}` → 200 `[]`, no B webhook in body; (b) A `DELETE /{B}` → 404, B persists; (c) A `POST /{B}/test` → 404, B sink ZERO hits, no B secret in body; (d) A create with B's projectId → **404, never 500/403**, no row; (e) own create/list/test-fire (sink +1)/delete regression; (f) `accountId == Project.accountId`; (g) NULL-accountId count = 0. Comment states List + Test-fire run OUTSIDE a UoW → RLS INERT → this test is the sole enforcement. Ran INT → 10/10 PASS, 0 cancelled.

## Phase 5: Regression sweep (SMELL-53 — the 0-defect requirement)

- [x] 5.1 Enumerated affected via `rg`: the 4 unit files + `SlackNotifierAdapter.test.ts` + `TeamsNotifierAdapter.test.ts` + `rls-tenant-isolation.test.ts`. No seed builds `ExternalNotificationConfigData`. Verified Slack/Teams adapters do NOT construct config rows (they take a `NotificationPayload`) → NOT broken; `rls-tenant-isolation` policy-count assertion (51) still holds (PublishingQueue drop netted out migration B's addition).
- [x] 5.2 Ran the FULL affected set: `@apps/api` vitest (tenantGuard + externalNotificationUseCase + PrismaExternalNotificationConfigRepository + setupExternalNotificationUseCases + Slack + Teams) = 55/55; `@core/external-notifications` vitest = 8/8; INT externalNotificationTenantIsolation = 10/10; INT rls-tenant-isolation = 11/11. All green, 0 cancelled.

## Phase 6: Docs + 0-defect gate

- [x] 6.1 `docs/security/MULTI_TENANT_GUARDS.md`: promoted `ExternalNotificationConfig` from transitively-scoped to tenant-scoped list; fixed stale "50" counts (Layer 2 header + tenant-scoped section → 51); added the "Create-path parent-ownership" recipe section.
- [x] 6.2 **0-defect gate (all 0/green)**:
  - `pnpm --filter @apps/api exec tsc --noEmit` = 0; `@core/external-notifications` tsc = 0; `@core/domain` tsc = 0. (`@infra/prisma` client already regenerated by orchestrator; not rebuilt here — not touching infra/prisma.)
  - `eslint --max-warnings 0` on all touched files (@apps/api + @core) = 0.
  - Fitness **#21** = 0; Fitness **#23** = 0.
  - Backfill zero-NULL proven in-migration (orchestrator) + re-asserted by the integration test (NULL count = 0).
  - Full affected test set + MERGE-BLOCKING integration green, 0 cancelled.
