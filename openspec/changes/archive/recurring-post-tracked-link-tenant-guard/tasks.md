# Tasks: RecurringPost + TrackedLink Tenant Guard (Slice 3)

## Review Workload Forecast

| Field                   | Value                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~1000–1300 (2 models × recipe + triple ownership + redirect/rate-limit + 3 wraps + 2 integration suites over 12 routes) |
| 400-line budget risk    | High                                                                                                                    |
| Chained PRs recommended | No (a tenant guard is atomic — half a guard is a live IDOR; the redirect wrap MUST ship in the same commit as the flip) |
| Suggested split         | Single PR, `size:exception`                                                                                             |
| Delivery strategy       | ask-on-risk                                                                                                             |
| Chain strategy          | size-exception                                                                                                          |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                                                                                                  | Likely PR               | Focused test command        | Runtime harness                          | Rollback boundary                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Both models enrolled + triple/single create ownership + 3 `withSystemContext` wraps + redirect rate-limit + 2 two-tenant suites green | PR 1 (`size:exception`) | full affected set (see 8.x) | two-tenant integration (7.x) via real DB | revert branch pre-merge; post-merge per-model `down.sql`, drop columns, remove guard entries; wraps + rate-limit harmless without flip |

**Sensitive-edit token REQUIRED** (`omnipost-allow sensitive-edit`) for every `[SENSITIVE]` task — all `infra/prisma/**` (2.1–2.5, 3.1) AND the rate-limit config + redirect route (6.1, 6.2, security/config surface).

## Phase 1: RED — unit tests (fast, no DB)

- [x] 1.1 RED `packages/core/recurring/tests/unit/CreateRecurringPostUseCase.test.ts`: mocked `ProjectRepositoryPort`+`PostRepository`+`ChannelRepository` — foreign/missing `projectId` → `NOT_FOUND` before doWork; foreign `templatePostId` (`post.projectId !== projectId`) → `NOT_FOUND`; foreign `channels[]` entry (`channel.projectId !== projectId`) → `NOT_FOUND`; own refs thread `project.accountId` into `RecurringPost.create({...,accountId})`.
- [x] 1.2 RED `packages/core/recurring/tests/unit/UpdateRecurringPostUseCase.test.ts`: patch channel-repoint with foreign channel → `NOT_FOUND`; own repoint round-trips `accountId` (fromPersistence→save).
- [x] 1.3 RED `packages/core/links/tests/unit/CreateTrackedLinkUseCase.test.ts`: foreign/missing `projectId` (mocked `ProjectRepositoryPort`) → `NOT_FOUND` before doWork; own project threads `accountId`.
- [x] 1.4 RED `apps/api/tests/unit/security/tenantGuard.test.ts`: `recurringPost` + `trackedLink` get `accountId` auto-injected on find/update/delete; missing-context → `TenantContextMissingError`; assert `TENANT_SCOPED_MODELS` size **55** (RED until 3.1). Assert `linkClick` stays OUT.
- [x] 1.5 Run: `pnpm --filter <pkg> exec vitest run <file>` per suite — expect RED.

## Phase 2: Schema + migrations (foundation) — [SENSITIVE] token REQUIRED

- [x] 2.1 [SENSITIVE] `infra/prisma/schema.prisma`: add `accountId String` + `account Account @relation(onDelete: Cascade)` + `@@index([accountId, projectId])` to `RecurringPost` AND `TrackedLink`; add back-relations `recurringPosts`, `trackedLinks` on `Account`. Keep `shortCode @unique` GLOBAL (cross-tenant, per D1); leave `vanitySlug` untouched (SMELL-57, see 8.2).
- [x] 2.2 [SENSITIVE] `infra/prisma/migrations/20260714040000_add_recurring_post_account_id/migration.sql` — Recipe A (ADD nullable → `UPDATE ... FROM "Project"` over NOT-NULL `projectId` FK → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT NULL` → FK Cascade → `@@index([accountId, projectId])`). Timestamp **> 20260714030300**.
- [x] 2.3 [SENSITIVE] `infra/prisma/migrations/20260714040100_add_rls_recurring_post/{migration,down}.sql` — Recipe B (ENABLE RLS → DROP POLICY IF EXISTS → CREATE POLICY `tenant_isolation` on `app.account_id` GUC + `__system__` bypass + `down.sql`). Timestamp **> 2.2**.
- [x] 2.4 [SENSITIVE] `infra/prisma/migrations/20260714040200_add_tracked_link_account_id/migration.sql` — Recipe A for `TrackedLink`. Timestamp **> 2.3**.
- [x] 2.5 [SENSITIVE] `infra/prisma/migrations/20260714040300_add_rls_tracked_link/{migration,down}.sql` — Recipe B for `TrackedLink`. Timestamp **> 2.4** (final).
- [x] 2.6 `pnpm db:up` then `pnpm db:migrate` — assert all 4 apply clean, zero NULL `accountId` (RAISE assert holds), row counts preserved for both tables.

## Phase 3: Guard flip — [SENSITIVE] token REQUIRED

- [x] 3.1 [SENSITIVE] `infra/prisma/src/extensions/tenantGuard.ts`: append `"recurringPost"`, `"trackedLink"` (alpha) to `TENANT_SCOPED_MODELS`; header JSDoc count **53 → 55**. `LinkClick` stays OUT (no `accountId`; gated transitively). Turns 1.4 GREEN.

## Phase 4: GREEN — entity/DTO threading + repositories

- [x] 4.1 `packages/core/domain/src/entities/RecurringPost.ts` (D2b): add `accountId: string` to `RecurringPostProps` (:131), to `RecurringPostCreateProps` (:152, currently MISSING), to the internal `create()` `new RecurringPost({...})` literal (:275), a getter, and flow through `fromPersistence`. `packages/core/domain/src/repositories/RecurringPostRepository.ts`: add `accountId` to `RecurringPostData`. Never in `toJSON`/output DTOs.
- [x] 4.2 `packages/core/domain/src/entities/TrackedLink.ts` (D2a): add `accountId` to props / create factory / getter / `fromPersistence`. Never in `toJSON`.
- [x] 4.3 `apps/api/src/infrastructure/repositories/PrismaRecurringPostRepository.ts`: `PrismaRecurringPostRow` iface + `toData` + `upsert.create` branch carry `accountId`.
- [x] 4.4 `apps/api/src/infrastructure/repositories/PrismaTrackedLinkRepository.ts`: `create` branch + `toDomain` carry `accountId` (`update` branch untouched, per D2a).

## Phase 5: GREEN — use cases (ownership + FOUR save sites + THREE fromPersistence)

- [x] 5.1 `packages/core/recurring/src/CreateRecurringPostUseCase.ts`: ctor gains `ProjectRepositoryPort` + `PostRepository` + `ChannelRepository` (UoW stays LAST). Triple ownership BEFORE doWork: guarded `projectRepository.findById(projectId)` → `err(NOT_FOUND)`; `postRepository.findById(templatePostId)` then assert `post.projectId === projectId`; per channel assert `channel.projectId === projectId`. Thread `project.accountId` into `create()` + save literal (:115). Turns 1.1 GREEN.
- [x] 5.2 `packages/core/recurring/src/UpdateRecurringPostUseCase.ts`: channel-repoint consistency assertion; round-trip `accountId` (`fromPersistence:85` + save literal :135). Turns 1.2 GREEN.
- [x] 5.3 `packages/core/recurring/src/ProcessRecurrenceUseCase.ts`: round-trip `accountId` — reconstitute→re-save (`fromPersistence:96` + save literal :126).
- [x] 5.4 `packages/core/recurring/src/DeactivateRecurringPostUseCase.ts`: round-trip `accountId` — reconstitute→re-save (`fromPersistence:57` + save literal :82).
- [x] 5.5 `packages/core/links/src/CreateTrackedLinkUseCase.ts`: ctor gains `ProjectRepositoryPort`; guarded `findById(projectId)` → `err(NOT_FOUND)` before doWork; thread `project.accountId`. Turns 1.3 GREEN.
- [x] 5.6 DI: `apps/api/src/infrastructure/container/setupRecurringPostUseCases.ts` inject `TOKENS.ProjectRepository`+`PostRepository`+`ChannelRepository` into Create; `apps/api/src/infrastructure/container/setupLinkUseCases.ts` inject `TOKENS.ProjectRepository` into Create.

## Phase 6: System-context wraps + redirect rate-limit + route 404

- [x] 6.1 [SENSITIVE] `apps/api/src/security/httpRateLimitPreHandler.ts`: add a `REDIRECT` preset (~60/min) for the `/r` namespace (D7). sensitive-edit REQUIRED.
- [x] 6.2 [SENSITIVE] `apps/api/src/links/linkRoutes.ts`: wrap the `GET /r/:shortCode` redirect use-case call in `withSystemContext("public-link-redirect", ...)` (covers `findByShortCode` + fire-and-forget `recordClick`'s `trackedLink.update` — ALS propagates, D6); resolve `TOKENS.HttpRateLimiter` and attach a dedicated preHandler keyed `redirect:{clientIp}` NAMESPACE (NOT `ip:url`) to the `/r/:shortCode` registration ONLY (D7). sensitive-edit REQUIRED (security/config).
- [x] 6.3 `apps/api/src/infrastructure/repositories/PrismaTrackedLinkRepository.ts`: wrap the `isShortCodeAvailable` query in `withSystemContext("shortcode-uniqueness-probe")` (D8 — restores GLOBAL uniqueness semantics; boolean only).
- [x] 6.4 `apps/api/src/recurring/RecurrenceScheduler.ts`: wrap the `tick()` body in `withSystemContext("recurrence-sweep")` (D8 — `findActiveByNextScheduled` is cross-account by design).
- [x] 6.5 `apps/api/src/recurring/recurringPostRoutes.ts`: add a `NOT_FOUND → 404` branch to the create handler (D3a). Verify `linkRoutes.createLink:85` already maps `NOT_FOUND → 404` (no change).
- [x] 6.6 INVARIANT (D9): assert the guard does NOT auto-scope `findByShortCode` — it MUST stay tenant-unscoped so the system-context wrap (6.2) is what resolves the public lookup. Confirm no `requireTenantContext` is added to `findByShortCode`.

## Phase 7: RED→GREEN — two-tenant integration (MERGE-BLOCKING)

- [x] 7.1 `apps/api/tests/integration/recurringPostTenantIsolation.test.ts` (all 5 routes): foreign get/patch/deactivate → 404; list foreign `projectId` → **empty**; foreign create refs (`projectId`, `templatePostId`, `channels[]`) → **404 never 403/500** AND assert the scheduler `tick()` does NOT clone B's `Post` for the rejected recurrence; own create persists `accountId == Project.accountId`; scheduler `tick()` completes under system context (no `TenantContextMissingError`); per-row `accountId === project.accountId` parent-consistency; zero NULL + row count preserved.
- [x] 7.2 `apps/api/tests/integration/trackedLinkTenantIsolation.test.ts` (all 7 routes across linkRoutes+utmRoutes): foreign get/delete/utm-generate/utm-url → 404; **stats foreign → 404 BEFORE any `linkClick` aggregation** (child-table sentinel); delete of B → 404 AND B's `linkClick` rows survive; foreign create `projectId` → 404; anonymous `/r/:shortCode` → **302 + click recorded** (positive control); redirect body/headers carry **NO tenant/accountId/analytics** (leaks-nothing); N `/r/*` from one IP → **429** (namespace rate-limit engages); management surface foreign → NOT_FOUND; per-row `accountId === project.accountId`; own redirect works.
- [x] 7.3 Run each (LXC-safe): `pnpm db:up`; from `apps/api`: `NODE_OPTIONS=--max-old-space-size=7168 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test tests/integration/<file>` — expect GREEN, 0 cancelled.

## Phase 8: Regression (SMELL-53) + docs + 0-defect gate

- [x] 8.1 Regression: `rg -l "recurringPost|RecurringPost|trackedLink|TrackedLink|CreateRecurringPost|UpdateRecurringPost|ProcessRecurrence|DeactivateRecurringPost|CreateTrackedLink|RedirectAndTrackClick|RecurrenceScheduler|TrackedLinkRepository|RecurringPostRepository" apps/api/tests packages/**/tests infra/prisma` — update ctor mocks + `accountId` fixtures (incl. `infra/prisma/seed.ts`, entity/use-case unit tests); RUN the FULL set.
- [x] 8.2 Docs: `docs/security/MULTI_TENANT_GUARDS.md` enroll both models + document the `withSystemContext` precedent (redirect / recurrence-sweep / shortcode-probe) + the redirect namespace rate-limit control. `docs/reports/roadmap-detected-smells-backlog.md`: add **SMELL-57** — `vanitySlug` not `@unique` → nondeterministic public redirect (`findFirst`) + `isShortCodeAvailable` check-then-insert TOCTOU; pre-existing, unrelated to tenant isolation; proper fix needs a global `@@unique` on `vanitySlug` + a dedup migration; OUT of tenant-guard scope. (spec.md Req-1/Req-3 rows already carried by the delta.)
- [x] 8.3 0-defect gate (0/0): `tsc` (@apps/api, @core/recurring, @core/links, @core/domain), `eslint --max-warnings 0`, fitness **#21 = 0** + **#23 = 0**, migrations apply clean + backfill zero-NULLs, FULL affected test set (unit + both MERGE-BLOCKING integration suites) green, 0 cancelled.
