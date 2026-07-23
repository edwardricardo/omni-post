# Tasks: Channel Tenant Guard (Slice 7, N-SEC-3)

> Strict-TDD, dependency-ordered. RED precedes each GREEN. Two chained PRs on the
> deliberate D5 seam: **PR1 = structural + API** (column, backfill, guard flip 57→58,
> create-path ownership, API two-tenant suite — workers untouched, publish keeps
> working byte-identically); **PR2 = worker reconciliation + RLS** (Migration B, GUC
> helper, explicit `accountId` scoping, publish regression). RLS is INERT today
> (superuser role, verified 2026-07-22) — legs 1–2 + explicit worker predicates are
> the ACTIVE enforcement. Branch `workstream/channel-tenant-guard` (guard = 57, tip
> `20260717000200`).

## Sensitive-edit gate

**Token REQUIRED: YES — `omnipost-allow sensitive-edit`.** Sensitive paths: `infra/prisma/**`
(schema, Migration A, Migration B pair, `tenantGuc.ts`) and `tenantGuard.ts`. No
`apps/api/src/security/**` touched. Author these under an active token; every other file
is non-sensitive.

## Command legend (LXC-safe, single-file — heap 3072, never the full local suite)

- **DBUP**: `pnpm db:up` (before any migration or integration test)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/api exec vitest run <file>`
- **WVITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/workers exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **MIGRATE**: author `prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply `pnpm db:up && pnpm db:migrate`
- **CLIENT-REGEN**: `pnpm --filter @infra/prisma build`

## Review Workload Forecast

| Field                   | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Estimated changed lines | PR1 ~400–470 · PR2 ~360–430 · combined ~760–900              |
| 400-line budget risk    | High                                                         |
| Chained PRs recommended | Yes                                                          |
| Suggested split         | PR 1 (structural + API) → PR 2 (worker reconciliation + RLS) |
| Delivery strategy       | ask-on-risk                                                  |
| Chain strategy          | pending (recommend stacked-to-main)                          |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Rationale: design forecasts >400 lines and mandates the D5 two-PR seam. PR1 is
independently safe and mergeable (guard flip touches only the API `$extends` client;
workers run the raw singleton unchanged, so publish cannot break in the PR1→PR2 window).
PR2 depends on PR1's `accountId` column and reverts independently (`down.sql` + worker
signatures). **Stacked-to-main** fits (PR1 merges, PR2 rebases on main); confirm the chain
strategy with the user before apply.

### Suggested Work Units

| Unit | Goal                                                                                                                                        | Likely PR | Focused test command                                                                                     | Runtime harness                                                                                                                 | Rollback boundary                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | Enroll `Channel` structurally (57→58) + backfill + both create-path ownership (404) + two-tenant API suite green; workers/publish unchanged | PR 1      | INT `tests/integration/channelTenantIsolation.test.ts`; VITEST `tests/unit/security/tenantGuard.test.ts` | DBUP + two-tenant real-DB suite over every Channel route (read/list/update/delete/connect)                                      | revert branch pre-merge; post-merge remove `channel` from guard set, `accountId` additive/removable by later down migration |
| 2    | Worker tenant-safety: RLS pair + `setTenantGuc` + explicit `accountId` scoping + publish job payload + publish regression green             | PR 2      | WVITEST publish-flow + CredentialResolver unit; INT worker two-tenant                                    | DBUP + publish-flow regression (own-tenant publishes green; foreign `(channelId,accountId)` → `err("AUTH")`, nothing decrypted) | post-merge `down.sql` drops RLS policy + disables RLS; worker signature changes revert independently of PR1                 |

## Phase 0: Spec reconciliation — BEFORE any code (gate finding #1)

- [x] 0.1 Amend BOTH deltas so the **OAuth-callback** create scenarios assert "error redirect (302) + NO channel persisted" (NOT a literal 404): `handleCallback` is a browser-redirect flow — its catch (`providerOAuthFlow.ts:310-318`) turns every error into a 302, so a literal 404 is UNSATISFIABLE there. Edit `specs/multi-tenant-isolation/spec.md` (Req "Channel — IDOR routes closed" connect scenario; Req "Create paths validate parent ownership" OAuth scenario) + `specs/tenant-context-boundaries/spec.md` ("A8 … foreign projectId rejected" scenario). Keep the **Bluesky JSON route** asserting a literal **404** (it returns JSON via `assertCallerOwnsProject`). Prevents a false-positive CRITICAL at sdd-verify.

---

# PR1 — Structural + API

## Phase 1: RED — unit guard matrix (vitest, no DB)

- [x] 1.1 [RED] `apps/api/tests/unit/security/tenantGuard.test.ts`: add `channel` membership + where-injection (find/update/delete) + `create` injection + explicit-mismatch throw + missing-context (`TenantContextMissingError`); bump size assertion **57 → 58** (~`:663`). RED until 3.1.
- [x] 1.2 Run VITEST 1.1 → expect RED (size + membership fail pre-flip).

## Phase 2: Schema + Migration A — [SENSITIVE — token]

- [x] 2.1 [SENSITIVE] `infra/prisma/schema.prisma` (`:766-830`): add `accountId String` + `account Account @relation(..., onDelete: Cascade)` + `@@index([accountId, projectId])`; KEEP the partial `@@unique([projectId,provider] …)` and all existing indexes; add `channels Channel[]` back-relation on `Account`.
- [x] 2.2 [SENSITIVE] Author **Migration A** `<tsA>_add_channel_account_id/migration.sql` (D4, single-parent): `ADD COLUMN "accountId" TEXT` nullable → `UPDATE "Channel" c SET "accountId"=p."accountId" FROM "Project" p WHERE c."projectId"=p."id"` (soft-deleted covered naturally) → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT NULL` → `Channel_accountId_fkey` → `Account` `ON DELETE CASCADE ON UPDATE CASCADE` → `CREATE INDEX "Channel_accountId_projectId_idx"`. Timestamp **> 20260717000200**.
- [x] 2.3 CLIENT-REGEN + `prisma validate`; DBUP + MIGRATE apply — clean, **zero NULL** `accountId` (RAISE holds), row count preserved (soft-deleted included).

## Phase 3: Guard flip — [SENSITIVE — token] → turns 1.1 GREEN

- [x] 3.1 [SENSITIVE][GREEN] `infra/prisma/src/extensions/tenantGuard.ts`: insert `"channel"` between `"campaign"` and `"consentRecord"` (`:104-105`); header JSDoc count **57 → 58** (`:82`). Run VITEST 1.1 → GREEN.

## Phase 4: D8 entity + D7 create-path ownership (API)

- [x] 4.1 [GREEN] `packages/core/domain/src/entities/Channel.ts` (`:40-83,194-220`): `ChannelProps`/`CreateChannelInput`/`reconstitute` gain `accountId` + private field + getter (compile-time thread; no `any`).
- [x] 4.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts` (`:350-392`): pass `accountId: channel.accountId.value` in `upsert.create` ONLY (never `update`); `toDomain` maps it back.
- [x] 4.3 [GREEN] `apps/api/src/auth/providerOAuthFlow.ts` (D7): wrap the `handleOAuthCallback` body from after `consumeOAuthFlow` (`:135`) in `withTenantContext({ accountId: record.accountId })`; inject the guarded `ProjectRepository` into `ProviderOAuthHandler` (`:70-75`); probe `record.projectId` BEFORE the existing/create branch → foreign/stale resolves nothing → `AppError.notFound("Project")` (surfaces as the standard error redirect, no channel persisted); `Channel.create` gains `accountId: record.accountId`.
- [x] 4.4 [GREEN] `apps/api/src/channels/channelRoutes.ts` (`:474`): Bluesky `upsert.create` threads `accountId` from the already-`assertCallerOwnsProject`-gated project (`:443`). Also threaded the two other Channel-construction sites in the same file — `createChannel` reconstitute (`:263`) and `updateChannel` reconstitute (`:376`) — via `assertCallerOwnsProject` now returning `accountId`.

## Phase 5: Seeds/factories/suites — thread accountId (tsc compile gate)

- [x] 5.1 [GREEN] Add `accountId` to EVERY Channel create (D8 inventory): `infra/prisma/seed.ts:104,:1153` (DEFERRED — SENSITIVE `infra/prisma/**`, orchestrator to apply under token), `apps/api/scripts/seed-large-dataset.ts` (no channel create — delete-only, nothing to thread), `testDataFactory` (derives accountId from owning project), `bulkScheduleHarness`, `sagaCustomerFlow` (3 sites), `sendReplyGuardrail`, `inboxRoutes` (test), `bulkScheduleOutboxSmoke` (foreign), `publish.flow`, `recurringPostTenantIsolation`, `repositories/*.test` (ProjectRepository.test + AnalyticsRepository.test-helpers ×2). `tsc` enumerated 4 additional domain-factory unit-test sites (entities.test.ts ×20, oauthTokenRefresher.test, setPrimaryChannelUseCase.test, UpdateChannelAuthStateUseCase.test) — all threaded.

## Phase 6: RED→GREEN — two-tenant integration (MERGE-BLOCKING)

- [x] 6.1 [RED] Create `apps/api/tests/integration/channelTenantIsolation.test.ts` (node:test, real DB, two tenants; `@file`/`@description`/`@layer infrastructure` header — fitness #9/#10). Build the production guard in-test (`$extends(tenantGuardExtension)` + real ALS provider + real `PrismaChannelRepository`; seed via superuser). Assert: (a) A-ctx get/update/delete on B's channel id → NOT_FOUND, B unchanged; (b) A-ctx list with B's `projectId` → `[]`; (c) NO decrypted credential of B in body/error/logs on any route; (d) OAuth-callback foreign `projectId` → error redirect + no row persisted; (e) Bluesky foreign project → literal 404; (f) own create → `accountId == Project.accountId`; (g) no-context read → `TenantContextMissingError`.
- [x] 6.2 [GREEN] `apps/api/scripts/run-tests.sh`: add `channelTenantIsolation.test.ts` to the `integration:tenant-isolation` batch.
- [x] 6.3 Run INT 6.1 via the batch (DBUP first) → GREEN, 0 cancelled.

## Phase 7: Docs + spec sync + PR1 0-defect gate

- [x] 7.1 `docs/security/MULTI_TENANT_GUARDS.md`: enroll `Channel` (3-step canon checklist), bump guard **57 → 58**, note RLS lands in PR2 (inert today under superuser).
- [x] 7.2 Mirror the Phase-0 reconciled deltas into the living `openspec/specs/multi-tenant-isolation/spec.md` + `openspec/specs/tenant-context-boundaries/spec.md`.
- [ ] 7.3 **0-defect gate (PR1)**: `tsc` (@apps/api, @core/domain, @infra/prisma build) = 0; `eslint --max-warnings 0` on touched files = 0; fitness **#8/#9/#10/#21/#23 = 0**; `prisma validate` + `migrate status` up-to-date + backfill 0-NULL/row-count preserved; `integration:tenant-isolation` batch green; affected unit set green.

---

# PR2 — Worker reconciliation + RLS

## Phase 8: RED — worker unit (fakes, no DB)

- [ ] 8.1 [RED] `apps/workers/tests/**` CredentialResolver + ChannelAuthFailureRecorder unit: own-`accountId` resolve decrypts; foreign `(channelId, accountId)` → `err("AUTH")` / recorder no-op; legacy payload (no `accountId`) → fallback resolves owner. Fake repos. RED until Phase 10–11.

## Phase 9: Migration B (RLS) + GUC helper — [SENSITIVE — token]

- [ ] 9.1 [SENSITIVE] Author **Migration B** `<tsB>_add_rls_channel/{migration,down}.sql` (D5, verbatim `20260716000100` shape): `ENABLE ROW LEVEL SECURITY` → `DROP POLICY IF EXISTS tenant_isolation` → `CREATE POLICY tenant_isolation` on the `app.account_id` GUC + `__system__` bypass; `down.sql` drops policy + disables RLS. Timestamp **> tsA (Migration A)**.
- [ ] 9.2 [SENSITIVE] Create `infra/prisma/src/extensions/tenantGuc.ts` + package export: `setTenantGuc(tx, accountId)` executes ``tx.$executeRaw`SELECT set_config('app.account_id', ${accountId}, true)` ``. Outside fitness #23's grep scope by design (mirrors the `PrismaUnitOfWork` set_config exception) — document in 13.1.
- [ ] 9.3 DBUP + MIGRATE apply; assert ordering A < B (B references A's column).

## Phase 10: Worker signatures + explicit scoping (D9) → turns 8.1 GREEN

- [ ] 10.1 [GREEN] `packages/ports/src/RepoPort.ts` (`:184`): `getChannelsByIds(ids, accountId)` + new `getChannelOwnerAccountId(channelId)` (selects `accountId` column ONLY, never decrypts; JSDoc: "remove with the D2 fallback").
- [ ] 10.2 [GREEN] `packages/adapters/db-prisma/src/{ChannelRepository,cached,index}.ts`: `getChannelsByIds` adds `accountId` to `where`, wraps `findMany` in `$transaction` calling `setTenantGuc(tx, accountId)` first; `cached.ts:426-441` cache key becomes `(accountId, ids)` (D9 anti-poisoning); implement `getChannelOwnerAccountId`.
- [ ] 10.3 [GREEN] `apps/workers/src/services/CredentialResolver.ts`: `resolve(channelId, accountId: string)`; `publishHandlerTypes.ts:103-105` `CredentialsLookup` signature.
- [ ] 10.4 [GREEN] `apps/workers/src/services/ChannelAuthFailureRecorder.ts` (`:49`): `record(channelId, provider, reason, accountId)` — `setTenantGuc` as first statement of the existing `$transaction`; update `where: { id, accountId }` (P2025 on foreign = 404-equivalent).
- [ ] 10.5 [GREEN] `apps/workers/src/mentionIngestWorker.ts` (`:137`): `resolveChannelAdapter` calls `setTenantGuc` + scopes by `job.accountId`; call sites `:229,:309` pass `job.accountId`.

## Phase 11: Publish job payload accountId (D2)

- [ ] 11.1 [GREEN] `packages/shared/src/saga.ts` (`:609-618`, + `saga.d.ts`): schedule step adds `accountId` to the `"publish-post"` job from `context.metadata.accountId`. **Gate finding #2**: `metadata.accountId` is untyped — narrow to `string` via a type guard / explicit check (throw or skip when absent) — NO `any`, NO `as any` (fitness #3).
- [ ] 11.2 [GREEN] `apps/api/src/saga/SagaIntegration.ts` (`:276`): `queueJob` type carries `accountId` (the `...job` spread propagates it; `:439` already populates `metadata.accountId`).
- [ ] 11.3 [GREEN] `apps/workers/src/{publishHandlerTypes,publishHandler,publishWorker}.ts`: `payload.accountId?: string`; `publishHandler` computes `eff = payload.accountId ?? getChannelOwnerAccountId(channelId)` once per job, passes a required `string` to `resolve`/`record`. **Bounded fallback — removal condition**: delete the fallback + make the field required once the PUBLISH queue (incl. the BullMQ delayed set — scheduled posts sit for days) holds no pre-deploy jobs.

## Phase 12: RED→GREEN — publish regression (MERGE-BLOCKING)

- [ ] 12.1 [GREEN] Worker two-tenant regression (real DB): own-tenant job resolves credentials + publishes green; foreign `(channelId, accountId)` → `err("AUTH")`, nothing decrypted, no reauth flag on B; legacy payload (no `accountId`) → fallback resolves owner + publishes; recorder foreign-scope no-op. Turns 8.1 GREEN.
- [ ] 12.2 Run WVITEST publish-flow + CredentialResolver unit (LXC by-file) + worker INT → GREEN, 0 cancelled.

## Phase 13: Child-table audit + docs + PR2 gate

- [ ] 13.1 `docs/security/MULTI_TENANT_GUARDS.md`: RLS policy note + `setTenantGuc` (D3) helper doc + **D10 child-table read confirmation** table (SAFE: `analyticsRoutes` overview/export, `getHistoricalTrends`, admin `groupBy`, hardDelete cascades). **Escalate to backlog** (do NOT silently drop): (1) `getDailySummary`/`getMonthlySummary` latent gap (D10); (2) initiate-time project-ownership probe (D7); (3) NOBYPASSRLS role provisioning + `mentionIngest` Mention-write GUC coverage (D3).
- [ ] 13.2 **0-defect gate (PR2)**: `tsc` (@apps/workers, @packages/*, @infra/prisma build) = 0; `eslint --max-warnings 0` on touched files = 0; fitness **#3/#21/#23 = 0** (`tenantGuc.ts` outside #23 scope, documented); publish regression + worker unit green; CI green before merge.
