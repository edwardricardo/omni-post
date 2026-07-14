# Tasks: ScheduledReport + Campaign Tenant Guard (Slice 2)

## Review Workload Forecast

| Field                   | Value                                                       |
| ----------------------- | ----------------------------------------------------------- |
| Estimated changed lines | ~700–900 (2 models × recipe + 2 integration tests)          |
| 400-line budget risk    | High                                                        |
| Chained PRs recommended | No (a tenant guard is atomic — half a guard is a live IDOR) |
| Suggested split         | Single PR, `size:exception`                                 |
| Delivery strategy       | ask-on-risk                                                 |
| Chain strategy          | size-exception                                              |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                                  | Likely PR               | Focused test command        | Runtime harness                          | Rollback boundary                                                             |
| ---- | --------------------------------------------------------------------- | ----------------------- | --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| 1    | Both models enrolled + create/untag closed + 2 two-tenant tests green | PR 1 (`size:exception`) | full affected set (see 6.x) | two-tenant integration (5.x) via real DB | revert branch pre-merge; post-merge per-model `down.sql` + drop guard entries |

**Sensitive-edit token REQUIRED** (`omnipost-allow sensitive-edit`) for every `[SENSITIVE]` task (all `infra/prisma/**`).

## Phase 1: RED — unit tests (fast, no DB)

- [x] 1.1 RED `packages/core/reports/tests/unit/CreateScheduledReportUseCase.test.ts`: foreign/missing project (mocked `ProjectRepositoryPort`) → `NOT_FOUND` before doWork; own project threads `accountId`.
- [x] 1.2 RED `packages/core/campaigns/tests/unit/CreateCampaignUseCase.test.ts`: same shape.
- [x] 1.3 RED `packages/core/campaigns/tests/unit/UntagPostFromCampaignUseCase.test.ts` (new): foreign/missing campaign (mocked `campaignRepository.findById`) → `NOT_FOUND` before `removePost` is called.
- [x] 1.4 RED guard unit: `scheduledReport` + `campaign` get `accountId` auto-injected (assert `TENANT_SCOPED_MODELS` size 53).
- [x] Run: `pnpm --filter <pkg> exec vitest run <file>` — expect RED.

## Phase 2: Schema + migrations (foundation) — [SENSITIVE] token REQUIRED

- [x] 2.1 [SENSITIVE] `infra/prisma/schema.prisma`: add `accountId String` + `account Account @relation(onDelete: Cascade)` + `@@index([accountId])` to `ScheduledReport` AND `Campaign`; add back-relations `scheduledReports`, `campaigns` on `Account`.
- [x] 2.2 [SENSITIVE] `*_add_scheduled_report_account_id/migration.sql` — Recipe A (copy `20260714020035`: ADD nullable → `UPDATE ... FROM "Project"` over `projectId` → in-tx `RAISE EXCEPTION` on NULL → `SET NOT NULL` → FK Cascade → index). Timestamp **> 20260714020135**.
- [x] 2.3 [SENSITIVE] `*_add_rls_scheduled_report/{migration,down}.sql` — Recipe B (copy `20260714020135`: ENABLE RLS → DROP POLICY IF EXISTS → CREATE POLICY `tenant_isolation` w/ `__system__` bypass + `down.sql`). Timestamp **> 2.2**.
- [x] 2.4 [SENSITIVE] `*_add_campaign_account_id/migration.sql` — Recipe A for Campaign. Timestamp **> 2.3**.
- [x] 2.5 [SENSITIVE] `*_add_rls_campaign/{migration,down}.sql` — Recipe B for Campaign. Timestamp **> 2.4** (final).
- [x] 2.6 `pnpm db:up` then `pnpm db:migrate` — assert all 4 apply clean, zero NULL `accountId`, row counts preserved.

## Phase 3: Guard flip — [SENSITIVE] token REQUIRED

- [x] 3.1 [SENSITIVE] `infra/prisma/src/extensions/tenantGuard.ts`: append `"campaign"`, `"scheduledReport"` (alpha) to `TENANT_SCOPED_MODELS`; header count 51 → 53. Turns 1.4 GREEN.

## Phase 4: GREEN — entity threading, use cases, D5

- [x] 4.1 `packages/core/domain/src/entities/ScheduledReport.ts` + `Campaign.ts`: add `accountId: string` to props/create-factory/getter/`fromPersistence` (never in `toDto`/`toJSON`).
- [x] 4.2 `PrismaScheduledReportRepository.ts` + `PrismaCampaignRepository.ts`: row iface + `toDomain` + upsert `create` carry `accountId`.
- [x] 4.3 `CreateScheduledReportUseCase.ts` + `CreateCampaignUseCase.ts`: inject `ProjectRepositoryPort` (2nd ctor param); guarded `findById(projectId)` → `err(NOT_FOUND)` before doWork; thread `project.accountId.toString()`. Turns 1.1/1.2 GREEN.
- [x] 4.4 DI: `setupAnalyticsUseCases.ts` (~145) + `setupCrisisUseCases.ts` (~121) inject `TOKENS.ProjectRepository` into the two creates.
- [x] 4.5 `UntagPostFromCampaignUseCase.ts`: add guarded `campaignRepository.findById(campaignId)` at TOP of `execute` (mirror `TagPostWithCampaignUseCase.ts:51`) → foreign/missing → `NOT_FOUND` before `removePost`. Turns 1.3 GREEN. (D5)
- [x] 4.6 Verify (no change): both create routes + untag route already map `NOT_FOUND → 404` via `mapErrorCode`.

## Phase 5: RED→GREEN — two-tenant integration (MERGE-BLOCKING)

- [x] 5.1 `apps/api/tests/integration/scheduledReportTenantIsolation.test.ts` (template `externalNotificationTenantIsolation.test.ts`): foreign get/update(recipients)/generate/delete → 404; foreign-projectId create → **404 never 403/500**; foreign `listReports` → **200 + []**; NO analytics/email crosses; own create persists `accountId == Project.accountId`.
- [x] 5.2 `apps/api/tests/integration/campaignTenantIsolation.test.ts`: foreign get/patch/archive/tag → 404; foreign **untag → 404 AND B's campaign-post tag set unchanged (join row survives)**; foreign create → **404**; list foreign `projectId` → **200 + []**; own create consistent.
- [x] 5.3 Run each (LXC-safe): `pnpm db:up`; from `apps/api`: `NODE_OPTIONS=--max-old-space-size=7168 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test tests/integration/<file>` — expect GREEN.

## Phase 6: Regression (SMELL-53) + 0-defect gate

- [x] 6.1 Enumerate: `rg -l "scheduledReport|ScheduledReport|campaign\b|Campaign|CreateScheduledReport|CreateCampaign|UntagPost|CampaignRepository|ScheduledReportRepository" apps/api/tests packages/**/tests infra/prisma`. Known breakers: `entities.campaign.test.ts`, `campaignUseCases.test.ts`, `reportUseCases.test.ts`, package create-use-case tests, `infra/prisma/seed.ts`, `vitest-entry.ts`. Update ctor mocks + `accountId` fixtures; RUN the FULL set.
- [x] 6.2 `docs/security/MULTI_TENANT_GUARDS.md`: enroll both models. `openspec/specs/multi-tenant-isolation/spec.md`: append both to Req-1/Req-3 tables.
- [x] 6.3 0-defect gate (0/0): `tsc` (@apps/api, @core/campaigns, @core/reports, @core/domain), `eslint --max-warnings 0`, fitness **#21 = 0** + **#23 = 0**, migrations apply clean + backfill zero-NULLs, FULL affected test set (unit + both integration) green.

## Phase 7: Adversarial-gate hardening (test-only, no production change)

- [x] 7.1 (WARNING) Campaign suite covers `GET /campaigns/:id/analytics` — the one campaign read that traverses the unguarded `campaignPost` join. Verified in source that step 2 of `GetCampaignAnalyticsUseCase` resolves existence through the now-guarded `campaign` model (`findUnique` + injected `accountId` → null) → `NOT_FOUND` → 404 BEFORE `findPostIdsByCampaignId` queries the join. Added foreign-analytics IDOR test (404 + no aggregate of B) and own-analytics positive control (200, totalPosts=1). Upgraded the analytics-read double to a fully-typed `AnalyticsReadRepositoryPort` (drops `as never`) so the owner path exercises `getLatestForPosts`/`aggregateEngagement`.
- [x] 7.2 (SUGGESTION) Restored the parent-consistency invariant in BOTH suites: `findMany({ where: { accountId: { in: [A,B] } }, include: { project: { select: { accountId: true } } } })` with per-row `assert.strictEqual(row.accountId, row.project.accountId)`. Kept the existing NULL check.
- [x] 7.3 (SUGGESTION) Report suite: added own-tenant generate positive control (200 + `emailSends` incremented, pins the exfil sentinel) and replaced the `analyticsRead as never` / `emailPort as never` casts with typed stubs (`AnalyticsReadRepositoryPort`, `EmailPort` returning `ok(undefined)`).
- [x] 7.4 Verify: both suites green single-file (campaign 13/13, report 11/11, 0 cancelled), `eslint --max-warnings 0` clean, tsc 0 errors incl. both test files. Note (SMELL-53): `apps/api/tsconfig.json` `include` omits `tests/`, so the default `typecheck` script does NOT type-check integration tests — verified via a temporary tests-inclusive config.
