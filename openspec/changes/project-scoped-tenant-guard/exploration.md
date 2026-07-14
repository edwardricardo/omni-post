# Exploration: project-scoped-tenant-guard (Cluster C — N-SEC-3 + N-SEC-4)

Security exploration. Every claim verified at source with file:line. Read-only; no source touched.

## LEAD FINDING — Channel credential-disclosure hypothesis: REFUTED at the HTTP boundary, but the underlying guard gap is REAL

Hypothesis: a tenant could read another tenant's Channel and have the system decrypt its social credentials.

Verdict: **No live cross-tenant credential-disclosure path exists through the customer HTTP surface.** `apps/api/src/channels/channelRoutes.ts` gates EVERY channel-by-id endpoint (get/update/delete/set-primary) through `assertCallerOwnsChannel` (lines 206-233), which loads the channel then verifies `channel.project.accountId === customer.accountId` and returns 404 on mismatch. `createChannel`/`listChannelsByProject`/`connectBluesky` gate via `assertCallerOwnsProject` (173-199). So the route layer enforces ownership in application code.

BUT the defense is by-convention, not by-construction, and it is thin:

1. `PrismaChannelRepository.findById` (PrismaChannelRepository.ts:133-143) queries `where: { id, deletedAt: null }` — NO tenant join — and `toDomain` (line 92) DECRYPTS credentials via `credentialsCrypto.decrypt` BEFORE any ownership check runs. The ownership check happens one call later in the route. Any current or future caller of `channelRepo.findById(attackerSuppliedId)` that forgets the follow-up project check gets a fully-decrypted foreign Channel. The safety is one `if` in a route handler, not a structural guarantee.
2. Confirmed callers of `channelRepository.findById` that validate EXISTENCE ONLY (no ownership): `SchedulePostUseCase.ts:147`, `PostCommandHandlers.ts` `validateChannels()` (58-74) + `resolvedChannels` loop (374-385), `SendReplyUseCase`, `SyncProviderCommentsUseCase`, `IngestChannelAnalyticsUseCase`, `SetPrimaryChannelUseCase`, `OAuthTokenRefresher`. These trust that the channelId was already authorized upstream.
3. The one HTTP path that reaches a channel-by-id WITHOUT an ownership gate is the CQRS publish route `POST /api/cqrs/posts/:postId/publish` (CQRSIntegration.ts:224-255) → `PublishPostCommandHandler` (PostCommandHandlers.ts:329-385): it validates channelIds by existence only and emits a publish-job event per attacker-supplied channelId — a cross-tenant PUBLISH primitive, worse than a read. **However `CQRSIntegration` is instantiated ONLY in tests** (grep: `new CQRSIntegration` appears only under apps/api/tests/\*_), so `/api/cqrs/_` is UNWIRED DEAD CODE today — latent, not live. If anyone wires it without adding ownership gating, it becomes a live cross-tenant publish IDOR.

Bottom line on Channel: not an open credential-disclosure hole right now, but Channel sits entirely outside BOTH tenant-isolation layers, so its only protection is per-route discipline — exactly the "one forgotten check = leak" failure mode the guard was built to eliminate.

## 1. The tenant guard's actual scope (VERIFIED)

`infra/prisma/src/extensions/tenantGuard.ts` — `TENANT_SCOPED_MODELS` (lines 90-141) contains 50 lowerCamel model names. The guard logic (line 186-188): `if (!TENANT_SCOPED_MODELS.has(lowerModel)) return query(args);` → any model NOT in the set is fully bypassed (no injection, no validation, no missing-context throw).

Of the 9 plan-named models, ZERO are in the set. Confirmed NOT present: `channel`, `post`, `trackedLink`, `campaign`, `projectMember`, `externalNotificationConfig`, `generatedImage`, `recurringPost`, `scheduledReport`. They are all `projectId`-only (FK to Project which holds accountId).

`docs/security/MULTI_TENANT_GUARDS.md §Transitively-scoped tables` (lines 139-179) is the prescribed compensating pattern. Verbatim: "The repository adapters MUST do an explicit join in the where clause" — `where: { id: postId, project: { accountId: requireTenantContext().accountId } }` (CORRECT) vs `where: { id: postId }` (WRONG — leaks across tenants). It lists all 9 models and says "S2.1d will audit every adapter touching these tables and add the joined-filter pattern where missing." The plan's note that the audit "no lo evidenció" is CORRECT — see §2.

## 2. Is the compensating join actually present? (VERIFIED — INCONSISTENT / MOSTLY ABSENT on primary paths)

The join exists only in a handful of OPT-IN helper methods; the PRIMARY findById/findByProjectId of every adapter queries by id/projectId alone:

- Channel — PrismaChannelRepository.ts: `findById:133` id-only (DECRYPTS). `findByProjectId:148` projectId-only. Compensating helpers DO exist but are opt-in: `findConnectionViewsByProjectScopedToAccount:161-195` (joins project.accountId, no decryption) and `findOwnerAccountIdByChannelId:202-215`. `delete:403` and `hardDelete:424` accept ChannelId with no tenant filter.
- ExternalNotificationConfig (CREDENTIAL-BEARING — encrypted webhookUrl, crypto at line 38-41) — PrismaExternalNotificationConfigRepository.ts: `findById:85` id-only, `findByProjectId:103` projectId-only, `delete:135` id-only. NO compensating join anywhere. `findById(id: string)` signature carries no account context at all.
- Post — PrismaPostRepository.ts: `findById:59-61` id-only (opt-in helper `findOwnerAccountId:431-436` exists but unused by the aggregate load path).
- TrackedLink — PrismaTrackedLinkRepository.ts: `findById:89-91` `findUnique({where:{id}})`, `findByShortCode:106`, `delete:147-148` id-only. NO join.
- Campaign — PrismaCampaignQueryRepository.ts: `findByProjectId:70-83` projectId-only, no accountId.
- RecurringPost — PrismaRecurringPostRepository.ts: `findById:106` id-only. Has compensating bits: `findByProjectId:136` takes optional `callerAccountId` (139) and `findOwnerAccountId:162-165` — but base findById is unguarded.
- ScheduledReport — PrismaScheduledReportRepository.ts: `findById:89` id-only, `delete:134-143` id-only.
- GeneratedImage — PrismaGeneratedImageRepository.ts: `findMany:74` projectId-only.
- ProjectMember — PrismaCustomerUserRepository.ts: `findMany:119-120` projectId-only.

Conclusion: the compensating join is present sporadically as bespoke helpers, absent on the default read/delete paths. Enforcement rests entirely on route handlers remembering to call an ownership helper first. This is the by-convention control the audit could not evidence — because it genuinely is not uniformly there.

## 3. RLS layer 2 (VERIFIED — DOES NOT COVER the 9 models)

`infra/prisma/migrations/20260527000000_add_rls_tenant_isolation/migration.sql` — the `tenant_tables` array (line 64+) grep for `Channel|Post|TrackedLink|Campaign|ProjectMember|ExternalNotificationConfig|GeneratedImage|RecurringPost|ScheduledReport` returns ZERO matches. RLS protects only the same ~50 `accountId`-bearing tables. The 9 projectId-only tables have NO RLS policy.

Additionally, even for tables that ARE under RLS, the migration header (lines 40-45) states RLS applies only to queries inside a UoW transaction (the GUC is set by `PrismaUnitOfWork.executeInTransaction`). Single-statement reads outside a tx (every `findById`) depend on Layer 1 alone. Since these 9 tables are in neither Layer 1 nor Layer 2, there is NO defense-in-depth for them at all — the sole control is application-code ownership checks.

This single fact sets severity: the gap is NOT mitigated at the DB level. The plan's ALTA on N-SEC-3 is justified.

## 4. The IDOR itself — TrackedLink (VERIFIED — LIVE)

`apps/api/src/links/linkRoutes.ts`: `GET /links/:id` (getLink:96-115), `GET /links/:id/stats` (getLinkStats:121-140), `DELETE /links/:id` (deleteLink:146-167). All three are `preHandler: [requireClientAuth]` (lines 240-263). requireClientAuth binds TenantContext (`customerAuthMiddleware.ts:70 enterTenantContext({accountId})`) — but TrackedLink is not tenant-scoped, so the guard is inert.

Each handler passes `params.id` straight to its use case with NO ownership parameter:

- GetTrackedLinkUseCase / GetLinkStatsUseCase / DeleteTrackedLinkUseCase all take `{ linkId }` only.
- `DeleteTrackedLinkUseCase.execute` (DeleteTrackedLinkUseCase.ts:29-64): step 2 `repository.findById(linkId)` verifies EXISTENCE, step 3 `repository.delete(linkId)`. No accountId anywhere in signature or flow.
- `PrismaTrackedLinkRepository.findById:90 = findUnique({where:{id}})`, `.delete:147-160` deletes by id + cascades linkClick.

Exploit shape (LIVE): authenticated tenant A → `DELETE /links/{tenantB_link_id}` with A's valid JWT → passes requireClientAuth → DeleteTrackedLinkUseCase finds the link (exists), deletes it + all its LinkClick rows. Same for `GET /links/{id}` (reads B's originalUrl/target) and `GET /links/{id}/stats` (reads B's click analytics). CWE-639, confirmed, no mitigating layer. This is the concrete N-SEC-3 IDOR and it is exploitable today.

## 5. N-SEC-4 — AI response cache (VERIFIED — CONFIRMED, exactly as plan states)

`apps/api/src/ai/orchestrator.ts`:

- Key #1 `generateCacheKey:220-228`: `ai:${task.type}:${sha256(stableStringify({type,data,promptTemplate}))}` — NO accountId.
- Key #2 `generateStructured:520`: `ai:structured:${sha256(...)}` — NO accountId. (Plan's "ambas keys" = these two.)
- The orchestrator holds a single `private readonly cache: CachePort` (constructor line 94).

Shared across BYOK and pool — DECISIVE: `AIRequestExecutorAdapter.ts` builds the BYOK orchestrator (`executeWithApiKey:51-70`) and the pool orchestrator (`executeWithPool:72-115`) BOTH with the same injected `this.cache` (lines 63 and 108). One cache namespace, no per-account partition. `aiService.ts:131 generateContent(messages, options, accountId)` HAS accountId in scope at the boundary and routes BYOK when present (`executeRequest({accountId, task})`, line 140), but accountId is dropped before the cache key is computed.

What leaks: `executeTask:274-292` — on a cache hit it returns the stored AI RESPONSE CONTENT of whichever tenant computed it first, to any tenant whose (type,data,promptTemplate) hashes equal. Concrete scenario: tenant A optimizes caption "Buy our SaaS now"; tenant B submits the identical text → B receives A's generated variant/analysis from cache (A's AI OUTPUT, potentially reflecting A's brandVoice passed in task.data). Cross-tenant inference/content disclosure.

Billing skew (VERIFIED): the cache-hit return sets `metadata.tokensUsed: 0` (line 287) and short-circuits before `updateMetrics`/the `onUsage` callback → the tenant serving a cache hit records zero tokens. BYOK/pool usage accounting undercounts on every hit. Confirmed at source.

Severity: plan says MEDIA. The content-leak surface is narrow (requires identical normalized input incl. same promptTemplate version) which caps practical exploitability, but it IS a genuine cross-tenant confidentiality boundary crossing plus a billing-integrity defect. MEDIA is defensible; the billing-integrity angle is the stronger, always-on impact.

## 5b. Documentation defect discovered (report to fix in scope)

`MULTI_TENANT_GUARDS.md` Layer 3 (lines 86-100) claims fitness #23 "catches the antipattern of a Prisma adapter on a tenant-scoped table that doesn't include accountId in its where clause." FALSE. CLAUDE.md fitness #23 only blocks raw `$queryRaw/$executeRaw` outside the tenant-guard exceptions — it does NOT scan typed-Prisma adapters for missing joins. So the documented "Layer 3" control for the transitively-scoped tables does not exist. This is precisely why the join gap went un-caught. Any fix must not rely on the phantom #23.

## 6. Fix space — recommendation

Judge each: closes by CONSTRUCTION or by CONVENTION?

(A) Denormalise accountId onto the 9 models + migration + backfill + add to TENANT_SCOPED_MODELS + RLS table array.

- Pro: reuses the guard we already built; both layers then cover them automatically; uniform with the other 50 tables; closes by CONSTRUCTION (guard auto-injects, RLS enforces). Every future read of these tables inherits isolation with zero per-call discipline.
- Con: schema change on 9 tables; backfill from Project.accountId; every writer must set accountId (guard auto-injects on create, mitigating this); FKs/uniques unaffected; migration must run RLS enable + policy per table. Largest change, but it is the ONLY option that makes the control structural for these tables.
- Effort: High.

(B) Secondary transitive guard in the Prisma $extends — resolve projectId→accountId via injected join/subquery.

- Pro: no schema change.
- Con: the $extends `$allOperations`hook can rewrite`args.where`, but it CANNOT cheaply verify a transitive accountId without either (i) injecting a relational filter `where.project = { accountId }`(only works when the model HAS a`project` relation — inconsistent across the 9; relation NAMES vary) or (ii) a pre-query lookup (extra roundtrip per query). Fragile: relation-name-dependent, no RLS equivalent, performance cost, and delete/updateMany by id still need special handling. Closes by construction only partially and brittlely.
- Effort: High, higher risk than A for less coverage.

(C) Per-adapter compensating joins + a real fitness function.

- Pro: minimal code; matches the documented pattern.
- Con: discipline is not a control — the S2.1d audit that was SUPPOSED to evidence this could not, proving the failure mode empirically. A fitness regex on typed-Prisma joins is notoriously false-positive/negative prone (the phantom #23 shows the org already believed it had this and didn't). Closes by CONVENTION only. Read paths outside UoW get no RLS backstop.
- Effort: Low-Medium, but does not durably close the hole.

RECOMMENDATION: **(A) Denormalise accountId onto the 9 models and fold them into the existing 2-layer guard.** It is the only approach that closes the gap by CONSTRUCTION (guard auto-injection + RLS), matching the isolation guarantee the other 50 tables already have, instead of depending on every future developer remembering a join. Sequence per SECURITY_CANON 3-step + MULTI_TENANT_GUARDS rotation: (1) add nullable accountId → backfill from Project.accountId → set NOT NULL; (2) add each model to `TENANT_SCOPED_MODELS`; (3) add each PascalCase table to the RLS migration array (new migration). Ship the TrackedLink IDOR (N-SEC-3 primary) FIRST as an independent slice since it is live and cheap to fix even ahead of the full denormalisation (add project.accountId join to the 3 link use cases + repository, gated by requireTenantContext). N-SEC-4: incorporate accountId into BOTH ai cache keys AND fix the tokensUsed=0 billing path so cache hits still attribute usage — smaller, independent slice.

For N-SEC-4 specifically, adding accountId to the key partitions the cache per tenant (closes leak by construction) but sacrifices cross-tenant cache sharing (acceptable — the shared cache was never a designed feature, it was the bug). Consider whether pool (non-BYOK) responses MAY still be shared: if the pool response is deterministic and tenant-independent, a `pool` partition is defensible; BYOK MUST be per-account. Decide in design.

## 7. Canon research (fetched)

- OWASP API1:2023 Broken Object Level Authorization: mandates object-level checks in EVERY function that uses client input to access a record; prefer unpredictable GUIDs; write tests and do not deploy changes that make them fail. Approach (A) satisfies this structurally at the data-access layer rather than per-handler. <https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/>
- OWASP Authorization Cheat Sheet: "The technology used to perform such checks should allow for global, application-wide configuration rather than needing to be applied individually"; "deny access by default"; "even if just a single access control check is missed, the confidentiality and/or integrity of a resource can be jeopardized"; "Centralize the logic for handling failed access control checks." Directly supports a centralized/data-layer control over per-handler discipline → argues AGAINST option (C). <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
- Defense-in-depth (app-layer guard + DB RLS) is the pattern the repo already documents (ADR-0014, MULTI_TENANT_GUARDS.md). The 9 tables are the hole in that otherwise-sound design.

Does canon contradict the plan's DoD? No — canon REINFORCES the plan. The plan's instinct to "verify the compensating join per adapter" (option C flavor) is exactly what canon warns against as a sole control; the DoD should require the structural fix (A), not merely evidencing joins.

## Risks

- (A) requires a DB migration + backfill on 9 tables in a memory-capped LXC — coordinate carefully; backfill must run before NOT NULL.
- Writers that construct these rows outside a bound TenantContext (workers, system sweeps) will hit the guard's TenantContextMissingError once the models are scoped — audit apps/workers + withSystemContext call sites BEFORE flipping the set.
- The unwired `/api/cqrs/*` publish route is a latent cross-tenant publish primitive; recommend deleting it or gating it as part of this change so it can't be wired later without ownership checks.
- Phantom fitness #23 documentation must be corrected so the org stops believing a control exists that doesn't.

## Ready for Proposal: YES. Recommended next: sdd-propose.
