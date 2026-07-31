# Design: Channel Tenant Guard (Slice 7)

## Technical Approach

Approach-A recipe (Slices 1-5) applied to `Channel` (`schema.prisma:766-830`), plus the four proposal extensions that make this slice non-mechanical: the empirically-pinned worker role answer, explicit worker-side tenant scoping, OAuth-callback ownership binding, and the child-table read confirmation. Delivered as two chained PRs with a deliberately safe seam: PR1 = structural + API (column, backfill, guard flip, create-path ownership), PR2 = worker reconciliation + RLS. Empirical input (verified 2026-07-22 against the live DB via `pg_roles`): the connection user is `postgres` with `rolsuper=true, rolbypassrls=true` — **RLS is inert today for API and workers alike**; layer 1 (`$extends` guard) is the only live enforcement, and the worker fix must be app-layer.

## Architecture Decisions

### D1 — Worker resolution shape: explicit `accountId` scoping (option ii), NOT a guarded worker client

**Choice**: Thread the job's `accountId` as an explicit parameter into every worker Channel access and enforce with an explicit `WHERE accountId` predicate; bind the RLS GUC in the same transaction (D3).
**Alternatives considered**: (i) a guarded `$extends` worker client under `withTenantContext`/`withSystemContext`.
**Rationale**: (a) The ALS provider lives in `apps/api/src/security/tenantContext.ts` — not importable from `apps/workers`; option (i) requires new worker-side ALS infrastructure. (b) The `$extends` guard does NOT bind the GUC (the `withSystemContext` trap — AsyncLocalStorage feeds the guard, RLS needs in-tx `set_config`), so option (i) still needs D3's work on top. (c) A guarded worker client flips EVERY worker query on all 57+ enrolled models (e.g. `mentionIngestWorker` writes `Mention`, tenant-scoped) — un-inventoried paths would throw `TenantContextMissingError`; blast radius is the whole executable. (d) Explicit parameters work identically under both role postures (the `WHERE` is the enforcement, RLS-independent) and are testable with plain fakes. Precedent: the raw-query repositories already use the explicit-predicate pattern (`PrismaStyleGuideRuleRepository.ts:179-184`).

### D2 — Publish job payload gains `accountId`; single producer; bounded legacy fallback

**Choice**: The saga schedule step (`packages/shared/src/saga.ts:609-618`) adds `accountId: context.metadata.accountId` to each queued job. `metadata.accountId` is already populated at saga start (`SagaIntegration.ts:439`), and `"publish-post"` has exactly two occurrences repo-wide (`saga.ts:611`, `SagaIntegration.ts:276` which spreads `...job`) — one real producer. Mention jobs ALREADY carry `accountId` (`mentionIngestWorker.ts:108-125`) — no payload change there. In-flight compat: `PublishJobInput.payload.accountId?: string`; `publishHandler` computes the effective accountId once per job — `payload.accountId ?? getChannelOwnerAccountId(channelId)` (new adapter method, selects ONLY `accountId`, never decrypts) — and passes a required `string` downstream. The fallback is self-scoping (no isolation gain for legacy jobs, no regression either; those payloads were produced by tenant-scoped API code). **Removal condition**: delete the fallback + make the payload field required once the PUBLISH queue (including the delayed set — scheduled posts can sit for days) holds no pre-deploy jobs; verify by inspecting the BullMQ delayed set.
**Alternatives considered**: resolving accountId at enqueue time via guarded read (extra query per enqueue, still needs the fallback); optional param on `CredentialResolver` (spreads the fallback across call sites).

### D3 — GUC binding helper `setTenantGuc(tx, accountId)` in `infra/prisma/src/extensions/`

**Choice**: New helper next to the guard: executes ``tx.$executeRaw`SELECT set_config('app.account_id', ${accountId}, true)` ``. Used by `getChannelsByIds` (wraps its `findMany` in `$transaction`), `ChannelAuthFailureRecorder.record` (first statement of its existing `$transaction`, `ChannelAuthFailureRecorder.ts:49`), and `mentionIngestWorker.resolveChannelAdapter` (`mentionIngestWorker.ts:137`).
**Rationale**: Orchestrator constraint — worker DB work must bind the GUC so a future hardened `omnipost_app` NOBYPASSRLS role (the `20260527000000` header's stated intent) does not silently zero worker reads and break publish. `infra/prisma/src/extensions/` is the canonical tenant-isolation-primitive home (same package as guard + RLS shapes) and sits outside fitness #23's grep scope (`apps/api/src` + `apps/workers/src`) by design, not by dodge — mirroring the sanctioned `PrismaUnitOfWork` set_config exception; documented in `MULTI_TENANT_GUARDS.md`. **Deployment hardening follow-up (out of slice)**: provision the NOBYPASSRLS role; note `mentionIngestWorker`'s other Mention writes remain GUC-less (pre-existing, breaks only under the hardened role) — carried on that follow-up.

### D4 — Migration A: single-parent recipe, no double-parent assert

Copy `20260716000000_add_project_member_account_id` step-for-step minus step 1 (Channel has ONE `accountId`-bearing parent — `Project` via NOT-NULL `projectId`, `schema.prisma:768,804`): nullable ADD → `UPDATE "Channel" c SET "accountId" = p."accountId" FROM "Project" p WHERE c."projectId" = p."id"` (soft-deleted rows covered naturally) → RAISE-on-residual-NULL → `SET NOT NULL` → `Channel_accountId_fkey` → `Account` `ON DELETE CASCADE ON UPDATE CASCADE` → `CREATE INDEX "Channel_accountId_projectId_idx"`. Schema deltas: `accountId String` + `account Account @relation(..., onDelete: Cascade)` + `@@index([accountId, projectId])`; partial unique `Channel_projectId_provider_isPrimary_unique` and all existing indexes untouched; `Account` gains back-relation `channels`. Timestamps: A < B, both > `20260717000200` (current tip).

### D5 — PR seam: Migration B (RLS pair) ships in PR2 with the GUC binding

> **AMENDED AT APPLY (2026-07-23).** The MERGE-BLOCKING parity suite
> `tests/integration/rls-tenant-isolation.test.ts` asserts guard↔RLS parity by
> construction (every model in TENANT_SCOPED_MODELS must carry the
> `tenant_isolation` policy, and the counts must match) — it exists precisely to
> block enrollment-without-RLS. Weakening the suite to preserve the seam would
> invert its purpose, so **Migration B moves to PR1**
> (`20260723000100_add_rls_channel` + `down.sql`). The original layering concern
> ("enforcement before the code that binds it") is void under the empirically
> verified role posture: RLS is inert (superuser BYPASSRLS), so the policy in
> PR1 changes no runtime behavior; the worker GUC code still lands in PR2, and
> role hardening remains explicitly gated on PR2 completion. Everything else in
> this decision (worker changes in PR2, PR1 API-only safety) stands.

**Choice**: PR1 = Migration A + guard flip + API work; PR2 = RLS pair (`add_rls_channel` + `down.sql`, verbatim `20260716000100` shape) + all worker changes.
**Rationale**: Each PR carries only the enforcement its code can honor. PR1 alone is safe: the guard flip touches only the API `$extends` client (`setup.ts:61-64`); workers run the raw singleton (`workerContainer.ts:16`) — byte-identical behavior in the PR1→PR2 window; publish cannot break, and the worker IDOR is unchanged (not widened) while every API-side Channel IDOR closes. RLS in PR1 would be inert today (superuser) but would land enforcement before the code that binds it — wrong layering. A single PR is NOT forced: the NOT NULL migration does not touch workers because workers never CREATE channels (worker surface is findMany/findFirst/update only, exploration §2); seeds/factories are fixed inside PR1. Chain remains the recommendation; the tasks phase decides via the Review Workload Guard.

### D6 — Guard flip 57 → 58

Insert `"channel"` between `campaign` and `consentRecord` (`tenantGuard.ts:104-105`); header count 57 → 58 (`tenantGuard.ts:82`). Unit membership + inject/validate/mismatch/missing matrix; size assertion 57 → 58 (`tenantGuard.test.ts` ~:663). RLS policy-count integration assertion needs NO literal change — Slice 5 converted it to a derived count.

### D7 — OAuth callback (A8): `withTenantContext` + guarded parent probe; 404 semantics via the redirect flow

**Choice**: Wrap the `handleOAuthCallback` body from after `consumeOAuthFlow` (`providerOAuthFlow.ts:135`) in `withTenantContext({ accountId: record.accountId })` — the trigger the code comment at `:121-127` anticipates. Inject the existing guarded `ProjectRepository` into `ProviderOAuthHandler` (`providerOAuthFlow.ts:70-75`) and probe `record.projectId` BEFORE the existing/create branch: the guard injects `accountId` → a foreign or stale `projectId` resolves nothing → throw `AppError.notFound("Project")`. `Channel.create` gains `accountId` (from `record.accountId`); the guard cross-validates explicit accountId vs context (`tenantGuard.ts:281-294`) as depth.
**Rationale**: The guard alone cannot validate parent ownership on CREATE (no `where` on create; a foreign `projectId` + injected own `accountId` would mint a corrupt cross-tenant row — the corruption ProjectMember's D2 assert exists to catch). D3a adapted: `handleCallback` is a browser-redirect flow (`providerOAuthFlow.ts:279-296`) — the NOT_FOUND surfaces as the standard error redirect with no Channel persisted, which is the enforced property; Bluesky connect (JSON route) returns a literal 404 via its existing `assertCallerOwnsProject` gate (`channelRoutes.ts:443`) and only needs `accountId` threaded into `upsert.create` (`channelRoutes.ts:474`). `initiateOAuth`'s unverified `projectId` (`:249-258`) becomes harmless for persistence (callback enforces); an initiate-time probe is optional hardening, deferred to backlog.

### D8 — Entity threading: explicit `accountId` end-to-end (compile-time, not guard-runtime)

`ChannelProps`/`CreateChannelInput`/`reconstitute` props + private field + getter on the entity (`Channel.ts:40-83,194-220`); `PrismaChannelRepository.save` passes `accountId: channel.accountId.value` in `upsert.create` ONLY — never in `update` (`PrismaChannelRepository.ts:350-392`); `toDomain` maps it back. Prisma's generated create types require the field at tsc level; runtime guard injection cannot satisfy the compiler (Slices 1-5 D2 precedent). Seeds/factories thread `accountId` on every Channel create: `infra/prisma/seed.ts:104,:1153` (create branches), `apps/api/scripts/seed-large-dataset.ts`, `testDataFactory`, `bulkScheduleHarness`, `sagaCustomerFlow`, `sendReplyGuardrail`, `inboxRoutes`, `bulkScheduleOutboxSmoke`, `publish.flow`, `recurringPostTenantIsolation`, `repositories/*.test` (exploration §2 inventory; tsc enumerates the rest).

### D9 — Worker signatures + tenant-scoped cache key

`getChannelsByIds(ids, accountId)` adds `accountId` to the `where` (keeps existing semantics otherwise — no `deletedAt` change) across `RepoPort.ts:184`, `ChannelRepository.ts:44`, and `createPrismaRepoAdapter`. `CredentialResolver.resolve(channelId, accountId: string)` + `CredentialsLookup` (`publishHandlerTypes.ts:103-105`). `ChannelAuthFailureRecorder.record(channelId, provider, reason, accountId)` scopes its update via extended-where (`where: { id, accountId }` — P2025 on foreign = same failure as nonexistent, correct 404-equivalent semantics). `mentionIngest` call sites (`:229,:309`) pass `job.accountId`. **Cache key**: `createCachedRepositoryAdapter.getChannelsByIds` (`cached.ts:426-441`) keys by ids only — with tenant scoping the key MUST become `(accountId, ids)` or tenant A's cached entry would satisfy tenant B's scoped miss (cross-tenant cache poisoning). Zero production consumers today (export-only), but the decorator implements the port and tsc forces the update — do it correctly.

### D10 — Child-table read confirmation (extension d) — findings

Method: for every read keyed by `channelId` on PublishLog/Analytics/Daily/MonthlySummary (exploration §3b inventory), verify the `channelId` set is resolved WITHIN tenant scope (guarded `channel.findMany` or project-gated), by code inspection + the two-tenant integration suite.

| Path                                                                          | Verdict                  | Evidence                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyticsRoutes.ts:574-591` overview                                         | SAFE                     | explicit `getProjectAccess` gate `:564`; channels via `findMany({projectId})` (guard-injected post-flip); analytics via `post:{projectId}`, not raw channelId                                                                                                                                                                                       |
| `analyticsRoutes.ts:700-748` export                                           | SAFE                     | same shape; `project.findUnique:700` proves tenant context bound (works today on enrolled `project`)                                                                                                                                                                                                                                                |
| `PrismaAnalyticsReadRepository.getHistoricalTrends:292-316`                   | SAFE                     | channelIds resolved from guarded `channel.findMany({projectId})` first                                                                                                                                                                                                                                                                              |
| `PrismaAnalyticsReadRepository.getDailySummary:253` / `getMonthlySummary:272` | **LATENT GAP, not live** | accept raw `channelId`, zero tenant resolution; sole caller `GetHistoricalAnalyticsQuery` ignores its own `projectId` input; token registered (`setupAnalyticsUseCases.ts:219-226`) but resolved by NO route — dead wiring. Escalate to backlog: wire-time channel-ownership probe + port JSDoc precondition. NOT silently expanded into this slice |
| `AnalyticsDashboardHandlers.ts:89` admin `channel.groupBy`                    | SAFE (parity)            | sits in the same `Promise.all` as `project.count:71` on the same injected client — enrollment cannot introduce a failure mode `project` doesn't already have; integration regression confirms                                                                                                                                                       |
| hardDelete cascades (`PrismaChannelRepository.ts:426+`)                       | SAFE                     | child deleteMany runs after a guarded channel resolve, under the caller's context                                                                                                                                                                                                                                                                   |

### D11 — Rollback

Pre-merge: revert branch. Post-merge PR2: `down.sql` drops policy + disables RLS; worker signature changes revert independently of PR1. Post-merge PR1: remove `channel` from the guard Set; `accountId` additive, removable by a later down migration. No data loss.

## Data Flow

    [API] saga start: metadata.accountId (SagaIntegration.ts:439)
      └─ schedule step → PUBLISH job {postId, channelId, accountId}
           └─ publishHandler: eff = payload.accountId ?? ownerLookup(channelId)   [legacy only]
                ├─ resolve(channelId, eff) → $tx{ set_config(app.account_id); findMany(id IN ids AND accountId) } → decrypt | 0 rows → err("AUTH")
                └─ authFailureRecorder.record(..., eff) → $tx{ set_config; update(where {id, accountId}) }
    [API] OAuth callback: withTenantContext(record.accountId){ guarded project probe → 404 | save(channel + accountId) }

## File Changes

| File                                                                                         | PR  | Action                 | Description                                       |
| -------------------------------------------------------------------------------------------- | --- | ---------------------- | ------------------------------------------------- |
| `infra/prisma/schema.prisma`                                                                 | 1   | Mod — **SENSITIVE**    | D4 deltas + `Account.channels`                    |
| `infra/prisma/migrations/{tsA}_add_channel_account_id/migration.sql`                         | 1   | Create — **SENSITIVE** | D4                                                |
| `infra/prisma/src/extensions/tenantGuard.ts`                                                 | 1   | Mod — **SENSITIVE**    | D6 flip 57→58                                     |
| `packages/core/domain/src/entities/Channel.ts`                                               | 1   | Mod                    | D8 entity threading                               |
| `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts`                        | 1   | Mod                    | D8 `upsert.create` + `toDomain`                   |
| `apps/api/src/auth/providerOAuthFlow.ts` (+ handler wiring site)                             | 1   | Mod                    | D7 A8 binding, probe, threading                   |
| `apps/api/src/channels/channelRoutes.ts`                                                     | 1   | Mod                    | D7 Bluesky `upsert.create` accountId              |
| Seeds/factories/suites (D8 list)                                                             | 1   | Mod                    | thread accountId                                  |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                                           | 1   | Mod                    | membership + 57→58                                |
| `apps/api/tests/integration/channelTenantIsolation.test.ts`                                  | 1   | Create                 | two-tenant suite, every Channel route             |
| `apps/api/scripts/run-tests.sh`                                                              | 1   | Mod                    | add suite to `integration:tenant-isolation` batch |
| `docs/security/MULTI_TENANT_GUARDS.md`                                                       | 1+2 | Mod                    | enrollment, counts, D3 helper doc                 |
| `openspec/specs/multi-tenant-isolation/spec.md` + `tenant-context-boundaries`                | 1   | Mod                    | per proposal Modified Capabilities                |
| `infra/prisma/migrations/{tsB}_add_rls_channel/{migration,down}.sql`                         | 2   | Create — **SENSITIVE** | D5 RLS pair                                       |
| `infra/prisma/src/extensions/tenantGuc.ts` (+ package export)                                | 2   | Create — **SENSITIVE** | D3 helper                                         |
| `packages/ports/src/RepoPort.ts`                                                             | 2   | Mod                    | D9 signatures + `getChannelOwnerAccountId`        |
| `packages/adapters/db-prisma/src/{ChannelRepository,cached,index}.ts`                        | 2   | Mod                    | D9 scoping + GUC + cache key                      |
| `packages/shared/src/saga.ts` (+ `saga.d.ts`)                                                | 2   | Mod                    | D2 payload accountId                              |
| `apps/api/src/saga/SagaIntegration.ts`                                                       | 2   | Mod                    | D2 queueJob type (spread carries it)              |
| `apps/workers/src/services/{CredentialResolver,ChannelAuthFailureRecorder}.ts`               | 2   | Mod                    | D9                                                |
| `apps/workers/src/{publishHandlerTypes,publishHandler,publishWorker,mentionIngestWorker}.ts` | 2   | Mod                    | D2 + D9 threading                                 |
| Worker tests (`apps/workers/tests/**`, `publish.flow`)                                       | 2   | Mod/Create             | publish regression + foreign-channel AUTH         |

## Interfaces / Contracts

```typescript
// packages/ports/src/RepoPort.ts
getChannelsByIds(ids: string[], accountId: string): Promise<Result<Channel[], "DATABASE_ERROR">>;
/** Deploy-compat owner lookup (accountId column only, never decrypts). Remove with the D2 fallback. */
getChannelOwnerAccountId(channelId: string): Promise<Result<string | null, "DATABASE_ERROR">>;

// apps/workers/src/services/CredentialResolver.ts
resolve(channelId: string, accountId: string): Promise<Result<unknown, "AUTH">>;

// apps/workers/src/publishHandlerTypes.ts
payload: { postId: string; channelId: string; accountId?: string; provider?: string; sagaId?: string };

// infra/prisma/src/extensions/tenantGuc.ts
setTenantGuc(tx: Prisma.TransactionClient, accountId: string): Promise<void>;
```

## Testing Strategy

| Layer                                                             | What to Test                                                                                                                                                                                                                                  | Approach                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unit (vitest)                                                     | Guard matrix for `channel` (membership, where/create injection, mismatch, missing-ctx); CredentialResolver scoped resolve + legacy fallback; recorder scoped update                                                                           | pure `tenantGuardCheck`; fake repos                                                                      |
| Integration PR1 (MERGE-BLOCKING, node:test, two tenants, real DB) | Every Channel route: A-ctx reads/writes on B's channels → empty/404; OAuth-callback probe: foreign `projectId` → no row persisted + error redirect; Bluesky foreign project → 404; create auto-consistency `accountId == Project.accountId`   | guarded client + real repositories (Slice-5 D7 harness); wired into `integration:tenant-isolation` batch |
| Integration PR2 (MERGE-BLOCKING)                                  | Publish regression: own-tenant job resolves credentials + publishes; foreign `(channelId, accountId)` → `err("AUTH")`, nothing decrypted; legacy payload (no accountId) → fallback resolves owner and publishes; recorder foreign-scope no-op | worker repo over real DB, two tenants                                                                    |
| Migration                                                         | zero NULL post-backfill; row count preserved                                                                                                                                                                                                  | in-tx RAISE (D4)                                                                                         |
| Gate                                                              | 0-defect                                                                                                                                                                                                                                      | tsc, eslint --max-warnings 0, fitness #21/#23 (helper outside scope, documented), LXC-safe regression    |

## Threat Matrix

N/A — data-layer authorization only; no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (The BullMQ payload change is a data-contract change handled by D2's compat fallback, not a process-integration boundary.)

## Migration / Rollout

Chained PRs on `workstream/channel-tenant-guard` (D5 seam; tasks phase confirms via Review Workload Guard). Timestamps at apply (`--create-only`), A < B, both > `20260717000200`. `pnpm db:up` + `omnipost-allow sensitive-edit` at apply (`infra/prisma/**`, `tenantGuard.ts`). D2 fallback removal tracked with its stated condition. Deployment hardening follow-up (out of slice): provision `omnipost_app` NOBYPASSRLS role; until then RLS remains structural depth and layer 1 + explicit worker predicates are the live enforcement.

## Open Questions

- [ ] None blocking. Backlog escalations: (1) `getDailySummary`/`getMonthlySummary` latent gap before any future wiring of `GetHistoricalAnalyticsQuery` (D10); (2) initiate-time project-ownership probe (D7); (3) NOBYPASSRLS role provisioning + mentionIngest Mention-write GUC coverage (D3).
