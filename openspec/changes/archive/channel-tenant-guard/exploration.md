# Exploration: Channel tenant-guard enrollment (Slice 7, N-SEC-3)

> Hybrid-store mirror of engram topic `sdd/channel-tenant-guard/explore` (obs 413), verified against main a0f3595c.

Change-name: **`channel-tenant-guard`** (matches archived folder pattern `{model}-tenant-guard`). Channel is NOT in TENANT_SCOPED_MODELS today (57 models, no `channel`).

## 1. Canonical slice recipe (Approach A) — proven by slices 1-5

Two migrations, ORDER-MANDATED:

- **Migration A** `{ts}_add_channel_account_id`: `ADD COLUMN "accountId" TEXT` nullable → `UPDATE "Channel" c SET accountId = p."accountId" FROM "Project" p WHERE c."projectId"=p."id"` (orphan-free: projectId NOT NULL, Project.accountId NOT NULL; UPDATE...FROM covers soft-deleted rows naturally) → in-tx `RAISE EXCEPTION` if any NULL → `SET NOT NULL` → FK to Account `ON DELETE CASCADE ON UPDATE CASCADE` → `CREATE INDEX`.
- **Migration B** `{ts+}_add_rls_channel` (+down.sql): `ENABLE ROW LEVEL SECURITY` + `DROP POLICY IF EXISTS tenant_isolation` + `CREATE POLICY tenant_isolation ... USING/WITH CHECK (current_setting('app.account_id',true)='__system__' OR "accountId"=current_setting('app.account_id',true))`. Copy shape verbatim from 20260527000000 (never edited). A.timestamp < B.timestamp (B references the column A adds). Channel migrations must sort AFTER Slice-5 tip 20260716000100.
- **Guard flip**: append `"channel"` to TENANT_SCOPED_MODELS in `infra/prisma/src/extensions/tenantGuard.ts`; bump JSDoc header count 57→58.
- **D2** thread accountId explicitly (Prisma create types require it at compile time; runtime guard injection can't satisfy tsc): domain Channel entity + ChannelData gain `accountId`; adapter passes it in `upsert.create` (NOT in `update`).
- **D3/D3a** create-path ownership: where a client-supplied parentId is persisted, resolve parent via guard-scoped repo; foreign→NOT_FOUND 404 (never 403/500); the probe error must survive the use-case catch AND the route status map.
- **Index rule**: leading column accountId; parent-filtered reads → composite. Channel's dominant guarded reads are projectId-filtered → `@@index([accountId, projectId])`.
- Tests: guard-injection unit (tenantGuard.test.ts membership + inject/validate/mismatch/missing-ctx, bump count 57→58) + two-tenant real-DB integration proving the IDOR is closed; the integration suite is the sole enforcement for reads outside a UoW.
- run-tests.sh: add the new integration file to the explicit tenant-isolation batch list.
- Docs: MULTI_TENANT_GUARDS.md — promote Channel to tenant-scoped list, fix counts.
- SENSITIVE paths (`infra/prisma/**`, `tenantGuard.ts`) require `omnipost-allow sensitive-edit` at apply.

## 2. Channel full surface (file:line, source-verified)

Schema: `infra/prisma/schema.prisma:766-830`. Scoped by projectId today; credentials in 4 encrypted columns (credentialsCiphertext/Iv/AuthTag/KeyVersion); soft-delete via deletedAt; partial unique `@@unique([projectId,provider] where isPrimary,deletedAt)`; relations: publishLogs, analytics, socialMessages, socialConversations, mentions, analyticsDaily/MonthlySummaries.

**API — GUARDED $extends client (app.container):**

- `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts` — main repo: findById@134, findByProjectId@149, findConnectionViewsByProjectScopedToAccount@165 (manual `project:{accountId}` join), findOwnerAccountIdByChannelId@205, findIdsByProjectId@223, findByProjectAndProvider@234, findByProjectProviderAccount@258, findPrimaryByProjectAndProvider@277, save/upsert@350 (encrypts), delete@413, hardDelete@426 (cascades PublishLog+Analytics deleteMany then channel.delete), bulkMarkForReauthByProvider@460 (updateManyAndReturn, cross-tenant by provider), bulkSoftDeleteByProvider@483 (cross-tenant).
- Query adapters (findMany/count/groupBy by projectId or channelId): PrismaProjectQueryRepository.ts:176, PrismaAnalyticsReadRepository.ts:294, PrismaAnalyticsAggregationQuery.ts:18, PrismaScoreTrendContextAdapter.ts:36, PrismaRepurposeVariantAdapter.ts:52, PrismaUsageMetricRepository.ts:111, PrismaChannelQueryForIngestion.ts:17.
- Cascade deletes by projectId: PrismaProjectRepository.ts:233, PrismaAccountRepository.ts:236 (projectId in), accountRoutes.ts:329, projectRoutes.ts:319.
- Routes reading prisma directly (arch smell; use injected `prismaClient`): channelRoutes.ts:461 findFirst + :472 upsert (Bluesky CREATE), analyticsRoutes.ts:576/:725 findMany, admin/AnalyticsDashboardHandlers.ts:89 groupBy.
- providers/providerService.ts:182 findMany (getConnectionsByProjectId).
- OAuth CREATE path: `apps/api/src/auth/providerOAuthFlow.ts` handleOAuthCallback@129 → channelRepository.save@199/@220.
- Webhook processors (8) findFirst by providerAccountId, run under withSystemContext (A7 seam via webhookJobProcessor.ts:157+): facebook:338, instagram:265, tiktok:283(+update@515), youtube:316, snapchat:166, linkedin:211, telegram:321, x:363.

**Workers — UNGUARDED raw `workerPrisma` (=`prisma`, NO $extends; workerContainer.ts:16), context-less, ZERO withSystemContext/GUC:**

- `apps/workers/src/services/CredentialResolver.ts` + `packages/adapters/db-prisma/src/ChannelRepository.ts:46` getChannelsByIds — findMany `where:{id:{in:ids}}` then **decrypts**. THE publish credential-resolution path. No tenant scope at all.
- `apps/workers/src/services/ChannelAuthFailureRecorder.ts:50` tx.channel.update(needsReauth) inside $transaction.
- `apps/workers/src/mentionIngestWorker.ts:137` findFirst by channelId.

**Seeds/scripts/tests creating Channel (will break on NOT NULL accountId):** infra/prisma/seed.ts:104,:1153 upsert; apps/api/scripts/seed-large-dataset.ts; testDataFactory, bulkScheduleHarness, sagaCustomerFlow, sendReplyGuardrail, inboxRoutes, bulkScheduleOutboxSmoke, publish.flow, recurringPostTenantIsolation, repositories/*.test — all `prisma.channel.create` without accountId → must thread accountId.

## 3. Two mandatory execution findings

**(a) obs 273 — create-paths accept client-supplied projectId WITHOUT ownership check:**

- OAuth callback (providerOAuthFlow.ts): projectId comes from consumed OAuth state (`record.projectId`); NO explicit check that `record.accountId` owns `record.projectId`. initiateOAuth also trusts query projectId without ownership verification. GAP present. Fix: bind `withTenantContext({accountId: record.accountId})` around the callback body (the A8 trigger — code comment @121 already anticipates it) AND thread accountId into Channel.create; the guard then validates project ownership by scoping the save.
- Bluesky connect (channelRoutes.ts:433): ownership gate `assertCallerOwnsProject(ctx, projectId)` EXISTS @443 (also @250,@337). But upsert.create lacks accountId → will break on NOT NULL; thread accountId from the owned project.

**(b) obs 285 — enrollment does NOT cover join/child-table mutations or reads skipping guarded findById:**

- Child tables keyed by channelId, NOT in TENANT_SCOPED_MODELS, so the Channel guard does NOT protect them: PublishLog, Analytics, AnalyticsDailySummary, AnalyticsMonthlySummary. Analytics read/aggregate paths (PrismaAnalyticsReadRepository, AnalyticsAggregationQuery, analyticsRoutes) query by channelId — a foreign channelId would not be blocked by the Channel guard; they must resolve channelId within tenant scope first. socialMessages/socialConversations/mentions ARE separately tenant-scoped.
- Reads-by-raw-id that skip guarded findById: CredentialResolver.getChannelsByIds (worker raw), mentionIngest resolveChannelAdapter (worker raw), webhook processors (by providerAccountId under system context — resolve any tenant's channel by provider identity, inherent to inbound webhooks). hardDelete cascades PublishLog/Analytics by channelId (raw deleteMany, but api guarded client — under whatever context the caller holds).

## 4. Credentials-specific risk (IDOR-with-secrets)

`CredentialResolver.resolve(channelId)` → getChannelsByIds([channelId]) → `prisma.channel.findMany({where:{id:{in:ids}}})` + decrypt, on the WORKER RAW client, context-less. This decrypts provider OAuth tokens with ZERO tenant scoping (rollout plan: "MITIGATED app-layer, fragile: decrypt-before-authz" — mitigation is only that the publish job's channelId was created within tenant scope upstream). **Adding Channel to the guard/RLS does NOT close this at the worker** because workers use the raw client (no $extends) and set no GUC. This is the single biggest divergence from slices 1-5, whose out-of-context caller count was 0. Design must choose: (i) route worker credential resolution through a guarded client under withSystemContext with the GUC bound to the job's accountId (requires accountId in the publish job payload + a guarded worker client), or (ii) scope getChannelsByIds by accountId explicitly. Same applies to ChannelAuthFailureRecorder and mentionIngest.

## 5. Worker DB-role / BYPASSRLS question — TOP UNRESOLVED RISK

20260527000000 header: "Application code runs as `omnipost_app` (or equivalent), subject to RLS. The app role must NOT have BYPASSRLS or SUPERUSER. Locally the docker-compose `postgres` user IS superuser (bypasses RLS)." The worker already reads/writes RLS-protected **Mention** (mentionIngestWorker) via the raw client with no GUC — that it functions at all implies the worker connection effectively bypasses RLS (superuser locally; prod role unverified). Two-sided consequence for Channel:

- If worker role is NOBYPASSRLS: adding Channel to RLS → all worker channel reads (publish credential resolution, auth-failure recorder, mention channel lookup) filter to ZERO rows with no GUC → **silent publish breakage**. Note: withSystemContext alone does NOT fix workers (it sets AsyncLocalStorage the $extends guard reads, but the worker uses the RAW client; for RLS layer-2 the worker must set_config('app.account_id','**system**') in its own tx OR use a guarded UoW).
- If worker role is BYPASSRLS: RLS is inert for workers → the CredentialResolver IDOR-with-secrets stays open (layer-1 absent on raw client, layer-2 inert).

This MUST be pinned before flipping Channel into RLS. It is why the rollout plan gates Channel behind Slice 6 (out-of-context caller audit) and ranks it Tier 4 / HIGH complexity.

## 6. Migration + RLS specifics for Channel

- Backfill derivable: Channel.accountId = Project.accountId over NOT-NULL projectId FK; include soft-deleted rows (natural).
- Constraints: partial `@@unique([projectId,provider] where isPrimary,deletedAt)` — no accountId interplay (accountId redundant-consistent with projectId). Existing indexes are projectId/provider partials → add `@@index([accountId, projectId])` (leading accountId, parent second); bulk-by-provider reads run cross-tenant (system) so need no accountId index.
- Add `account Account @relation(fields:[accountId],references:[id], onDelete: Cascade)` + back-relation list on Account. Note existing manual cascades (deleteMany by projectId) stay; account FK adds DB-level cascade on account delete.

## Approaches

1. **Approach A — denormalize accountId + $extends guard + RLS (the established recipe).** Pros: canon-by-construction, matches slices 1-5, defense-in-depth. Cons: does NOT reach the unguarded worker paths (needs additional worker-side work). Effort: HIGH (Channel is the max-blast, ~13 grouped callers, credential-bearing; worker-role + credential-resolver redesign are net-new vs slices 1-5).
2. **Do only the guard+RLS flip like slices 1-5, defer worker paths.** Pros: smaller diff. Cons: UNSAFE — either breaks publish (NOBYPASSRLS) or leaves the credential IDOR open (BYPASSRLS). Rejected.

## Recommendation

Approach A, but the slice is NOT mechanically identical to 1-5. It MUST additionally: (1) resolve the worker DB-role/BYPASSRLS question FIRST; (2) bind withTenantContext at the OAuth callback (A8 trigger) + thread accountId into both create paths (OAuth + Bluesky); (3) make the worker credential-resolution + auth-failure + mention-channel paths tenant-safe (guarded client under system context binding the GUC, or explicit accountId scoping); (4) confirm child-table (PublishLog/Analytics/summaries) reads resolve channelId within tenant scope. Strongly consider splitting into chained PRs: PR1 = structural (schema+migrations+guard+API create-path threading+API tests), PR2 = worker-side reconciliation (guarded worker client / GUC binding + credential-resolver scoping + worker tests). Likely >400 lines → Review Workload Guard will fire.

**Ready for Proposal: YES** (with the worker-role question flagged as the load-bearing design decision).
