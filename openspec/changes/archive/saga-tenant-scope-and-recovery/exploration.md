# Exploration mirror — N.B core-publishing correctness

> **Hybrid-trail mirror of Engram obs #429** (`sdd/core-publishing-correctness/explore`,
> saved 2026-07-31). This exploration covers the WHOLE N.B workstream (N-COR-1..7).
> The change `saga-tenant-scope-and-recovery` consumes the **N-COR-7 + N-COR-2a**
> portions. An addendum at the bottom records empirical corrections that POSTDATE
> the exploration and supersede its N-COR-7 escalation framing.

---

# Exploration: N.B core-publishing correctness (re-verified vs main, 2026-07-31)

Branch `workstream/channel-tenant-guard-archive` (HEAD = main + docs-only commits). All
verdicts from static reading of CURRENT code. Engram `mem_search`/`mem_get_observation`
were NOT available in this executor's toolset (only `mem_save`) — no prior-decision
retrieval was possible; everything below is code-derived.

## Headline

N-COR-7 has ESCALATED from "latent, harmless because the engine uses the raw client" to a
probable hard outage: `TOKENS.PrismaClient` IS the tenant-GUARDED client
(`apps/api/src/infrastructure/container/setup.ts:61-64`), `sagaInstance` IS enrolled in
`TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts:132`), and the engine
still writes `accountId: context.userId`
(`apps/api/src/saga/SagaManagerExecution.ts:523,537`). Under a bound customer tenant
context the guard's `injectAccountIdIfMissing` throws `TenantContextMismatchError`
(tenantGuard.ts:282-295) on the upsert's `create` payload, so
`POST /sagas/post-publishing/start` should 500 on the FIRST persist. The confirming test
(`apps/api/tests/integration/sagaCustomerFlow.test.ts`) is NOT wired into
`apps/api/scripts/run-tests.sh` — this is exactly the N-CI-2 blind spot.

## Per-item verdicts

### N-COR-1 — UpdatePostStatusStep no-op — LIVE (partially evolved)

- `packages/shared/src/saga.ts:806-822` emits `post.update` with `status` + `publishedAt`
  - `expectedVersion`.
- `apps/api/src/cqrs/handlers/PostCommandHandlers.ts:220-225` logs a warn and DISCARDS
  `status`. `UpdatePostUseCase` (packages/core/posts/src/UpdatePostUseCase.ts:65-163) has
  no status branch at all.
- `packages/shared/src/cqrs.ts:193-218`: schema now accepts `status` and
  `expectedVersion` but has NO `publishedAt` key — Zod strips it silently.
- OCC IS wired end-to-end (`expectedVersion` honoured at UpdatePostUseCase.ts:113-120) —
  that half of the June DoD is done.
- Worker never promotes Post either: `apps/workers/src/publishHandler.ts:638-642` updates
  the `Tweet` sub-entity only; no `prisma.post` write exists anywhere in apps/workers.
- CONSTRAINT the June DoD missed: `PublishStatus` VALID_TRANSITIONS
  (packages/core/domain/src/value-objects/PublishStatus.ts:29-51) has NO DRAFT→PUBLISHED
  edge. Legal path is DRAFT→PUBLISHING→PUBLISHED. So the fix REQUIRES a PUBLISHING
  transition at/around the pivot, not just a status write at the tail. `markAsPublished`
  / `markAsFailed` exist (PostAggregate.ts:399,431).
- Chain confirmed: SagaIntegration.ts:406-410 rejects non-DRAFT, so posts stuck at DRAFT
  stay re-publishable.
- Tests: none assert Post.status after a publish-now saga.

### N-COR-2 — saga runtime — LIVE, root cause deeper than described

- (a) `SagaManagerLifecycle.loadActiveSagas()` (:312-341) loads PENDING/RUNNING into
  `activeInstances` but NEVER calls `executeSagaAsync`. Worse: it runs at boot with no
  tenant/system context → `prisma.sagaInstance.findMany` hits the guard →
  `TenantContextMissingError` → swallowed by the catch at :338. So boot recovery does not
  even LOAD, let alone resume.
- Same defect in `startRetryRecoveryChecker` (:382-410) — the 5s scan is dead for the same
  reason (throw → catch at :404).
- (b) `SagaExecutionEngine.failSaga` (SagaManagerExecution.ts:402-439) does NOT
  `activeInstances.delete` — compare `completeSaga` (:367) and `compensateSagaSteps`
  (:325) which do. `startTimeoutChecker` (Lifecycle:412-431) iterates `activeInstances`
  with NO terminal filter → re-fails forever every 60s. Because `persistSagaInstance`
  throws (no context), the FAILED status is never persisted, `releaseAllLocks` never runs
  (semantic locks leak to TTL) and the DB row stays RUNNING. Different shape than June
  described (EventStore does NOT grow unbounded) but the loop is real.
- (c) `WaitForPublishingCompletionStep` (saga.ts:717-719) returns `success:false` on
  `pending > 0` → consumes `retryCount` (Execution:180-197, maxRetries 3, 5s/10s/20s).
  AMPLIFICATION June missed: `handleEvent` (Lifecycle:212-228) re-enters the step on
  EVERY `publish.job.completed`, so each completed channel of a multi-channel publish
  burns one retry. ≥4 channels ⇒ guaranteed FAILED.
- EXTRA: no in-flight guard on `executeSaga`. `handleEvent` and the retry checker can
  invoke it concurrently for the same sagaId; the checker never clears `nextRetryAt`, so a
  saga is re-selected every 5s tick until the step resolves.
- EXTRA: the compensation trigger inside `executeSaga` (:206-208) sets `instance.error`
  and dispatches compensation WITHOUT persisting or setting COMPENSATING (only the public
  `compensateSaga()` sets it) — a terminal-state-hygiene gap vs ARCHITECTURE_CANON §Saga.
- Tests: `sagaExecution.terminal-guard.test.ts` covers only the `executeSaga` guard.
  No coverage for boot resume, failSaga cleanup, or the timeout terminal filter.

### N-COR-3 — client publishing — PARTIALLY FIXED (2 of 5 live, 1 new)

- (a) static content — LIVE, relocated. `ClientContentEditor.handlePublish`
  (apps/client/components/editor/ClientContentEditor.tsx:168-174) sends
  `body: initialContent` (the PROP, default `""` at :53). Live text only reaches
  `saveDraft` via `handleContentChange` (:131-146); it is never held in component state.
  `/posts/new` passes no `initialContent`. It also omits `selectedChannelIds` entirely.
- (b) fake publish — LIVE. `usePostDraft.publishPost`
  (apps/client/lib/hooks/useAutoSave.ts:314-325) calls `updatePost` or
  `useCreateDraftViaSaga` (mode `"draft"`). Never publish-now. Toast at
  ClientContentEditor.tsx:176-179 says "published".
- (c) `/admin/*` 401 — FIXED. `useSchedulePostViaSaga` now hits
  `apiClient.startPostPublishingSaga` (customer `/sagas/post-publishing/start`). No
  `/admin/` reference remains in `apps/client/lib`.
- (d) query key — LIVE. `queryKeys.posts()` = `["posts", undefined]`
  (apps/client/lib/api/hooks.ts:40); TanStack partial matching fails against
  `["posts", {projectId}]`. NEW: `useSchedulePostViaSaga` invalidates `["posts","list"]`
  (useSchedulePostViaSaga.ts:114) — no query is ever registered under that key, so it is a
  dead invalidation. Two conflicting key conventions in one app.
- (e) autosave flush — LIVE. `useAutoSave` unmount cleanup only `clearTimeout`s
  (useAutoSave.ts:173-177), actively DISCARDING the pending 15s-debounced save. No
  `pagehide`/`beforeunload` anywhere in apps/client. Note `handleSchedule` DOES flush via
  `saveNow()` (ClientContentEditor.tsx:224) — the flush primitive exists, it's just not on
  unload.
- EVOLVED: the post-detail page has a genuine publish-now flow
  (apps/client/app/[locale]/dashboard/posts/[id]/page.tsx:132-146). Its "postPublished"
  toast is still a lie until N-COR-1 lands (refetch shows DRAFT) — hard evidence that
  N-COR-3 UX correctness DEPENDS on N-COR-1.

### N-COR-4 — billing dunning — PARTIALLY FIXED

- provider re-derivation LIVE: `GatewayBillingService.handlePaymentFailed`
  (packages/core/billing/src/GatewayBillingService.ts:859-861) and
  `handlePaymentSucceeded` (:942-944) infer provider from
  `String(data.subscription_id ?? "").startsWith("sub_")`. The route HAS `provider` and
  already passes it to `extractCustomerId`
  (apps/api/src/billing/billingWebhookRoutes.ts:85) but not to these two calls (:131,
  :140). Stripe invoice payloads carry the subscription under `subscription` /
  `parent.subscription_details.subscription`, not top-level `subscription_id` →
  misclassified PADDLE → `findByGatewayCustomerId` miss → `ACCOUNT_NOT_FOUND` → dunning
  never runs.
- "processed=true irreversible / swallowed silently" — HALF FALSE now. The claim is
  atomic-CAS by design (billingWebhookRoutes.ts:69-83) and failures ARE persisted via
  `markBillingEventError` (:163-165, service :774-776) with an explicit comment
  acknowledging the manual-retry tradeoff. Remaining gap is only auto-retry/alerting, not
  silence.

### N-COR-5 — cascade delete non-transactional — LIVE, 4 sites (June listed 1)

- `apps/api/src/projects/projectRoutes.ts:293-326` (5 sequential writes, no tx)
- `apps/api/src/infrastructure/repositories/PrismaProjectRepository.ts:209-244` (~20 writes)
- `apps/api/src/accounts/accountRoutes.ts:316-329`
- `apps/api/src/infrastructure/repositories/PrismaAccountRepository.ts:192-249` (~20 writes)
- EXTRA smell: the route duplicates the repository cascade AND deletes FEWER children (no
  PublishLog/Analytics/ContentVersion/Thread/Tweet) → the route path can hit FK errors the
  repo path avoids. The route should delegate to the repo, not re-implement it.

### N-COR-6 — scheduling ignores timezone/DST — LIVE and worse than described

- `computeNextRun` is a hand-rolled parser DUPLICATED in two domain entities:
  `packages/core/domain/src/entities/RecurringPost.ts:526-547` and
  `packages/core/domain/src/entities/ScheduledReport.ts:268+`.
- It parses ONLY literal numeric minute+hour. Day-of-month, month and day-of-week are
  IGNORED — `0 9 * * 1` (Mondays) fires EVERY day. Anything non-literal falls back to
  "now + 1 hour". This is a cron-correctness bug, not merely a TZ bug.
- `next.setMinutes/setHours` use server-local `Date` methods. `RecurringPost._timezone`
  (defaulted "UTC" at :286) is stored and only ever read in `toJSON` — never passed to
  `computeNextRun`.
- Fix implies cron-parser + IANA tz + a backfill of existing `nextScheduledAt`/`nextRunAt`.

### N-COR-7 — SagaInstance.accountId + guard bypass — LIVE, ESCALATED

- (a) column mismatch LIVE: `SagaManagerExecution.ts:523,537` writes
  `accountId: instance.context.userId`. `SagaContext` (packages/shared/src/saga.ts:46-53)
  still has NO first-class `accountId`.
- PARTIALLY EVOLVED: `metadata.accountId = customer.accountId` IS now populated
  (SagaIntegration.ts:439) and the pivot fails closed without it (saga.ts:617-624). The
  authoritative value is already in hand — it is simply not used for the column.
- (b) "engine uses the RAW prisma client" — REFUTED. `setupServices.ts:948` resolves
  `TOKENS.PrismaClient`, which `setup.ts:61-64` registers as
  `prisma.$extends(tenantGuardExtension(...))`. The engine gets the GUARDED client.
  Prisma query extensions do fire inside `$transaction` (prisma/prisma#17948 — extensions
  apply; only `this` binds to the base client), so `persistSagaInstance`'s
  `tx.sagaInstance.upsert` IS guarded.
- Consequence: `requireClientAuth` binds `enterTenantContext({accountId: payload.accountId})`
  (apps/api/src/auth/customerAuthMiddleware.ts:70) while `customerUser.id = payload.sub`
  (:60) — distinct values. `upsert.create.accountId = userId ≠ ctx.accountId` →
  `injectAccountIdIfMissing` throws `TenantContextMismatchError` (tenantGuard.ts:291-293)
  → SagaIntegration.ts:457-466 → 500 on every saga start.
- `SagaInstance.accountId` is `String?` with no FK (infra/prisma/schema.prisma:2058), so
  nothing else catches the mismatch.
- HARD SEQUENCING: N-COR-7 must land BEFORE the pending N-SEC-3 tail item
  `api-guarded-client-injection`, and its backfill must repair rows already written with a
  userId.

## Dependency graph

```
N-COR-7 (tenant scope of saga persistence)  ──┐
N-COR-2a (boot/background context + resume)  ─┴─> same root cause: saga runs with no
                                                  tenant/system context bound
        │
        ├──> N-COR-2b/2c (engine hygiene: terminal filter, waiting≠failed)
        │            │
        │            └──> N-COR-1 (status transition; also needs DRAFT→PUBLISHING edge)
        │                        │
        │                        └──> N-COR-3 (client publish/UX truth)
N-COR-4 / N-COR-5 / N-COR-6 : fully independent of the above and of each other
```

Verified: the "4/5/6 independent, 1+2+7 a cluster" intuition holds. CORRECTION: N-COR-2a
is NOT separable from N-COR-7 — both are the missing tenant/system-context story for saga
persistence. N-COR-2b/2c are separable engine hygiene.

## Canon deltas (ARCHITECTURE_CANON §Saga / SECURITY_CANON §Multi-tenant)

- `SagaContext` carries no tenant identity; tenant lives in untyped `metadata`.
- Terminal-state invariant is enforced in `executeSaga` but bypassed by the timeout
  checker calling `failSaga` directly; `failSaga` omits the activeInstances cleanup its
  two sibling terminal paths perform.
- Internal compensation dispatch does not set COMPENSATING nor persist before dispatch.
- Background saga work is neither `withSystemContext()` nor `withTenantContext()` wrapped —
  the canon-sanctioned path for cross-tenant/system jobs.
- Domain logic (`computeNextRun`) duplicated across two aggregates.

## Proposed slicing — 5 SDD changes

| #   | Change                                               | Contents                                                                                                                                                                                                                                                | Size / chained-PR risk                                                                                            |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `saga-tenant-scope-and-recovery`                     | N-COR-7 (accountId first-class in SagaContext from `metadata.accountId`, column write, backfill migration) + N-COR-2a (bind system/tenant context for `loadActiveSagas` + retry checker; resume PENDING/RUNNING without `nextRetryAt`)                  | ~400-500 LOC incl. migration + two-tenant integration test. HIGH → split PR1 tenant-scope+backfill / PR2 recovery |
| 2   | `saga-engine-terminal-hygiene`                       | N-COR-2b (`activeInstances.delete` in failSaga, terminal filter in timeout checker, persist-before-compensate, COMPENSATING status) + N-COR-2c (waiting≠failed step contract so pending does not consume retryCount) + in-flight guard on `executeSaga` | ~250-350 LOC. MEDIUM                                                                                              |
| 3   | `post-status-transition-on-publish`                  | N-COR-1: DRAFT→PUBLISHING at the pivot, PUBLISHING→PUBLISHED/FAILED after the wait, via a real transition use case with OCC; add `publishedAt` to `UpdatePostCommandSchema` or a dedicated command                                                      | ~300-400 LOC. MEDIUM                                                                                              |
| 4   | `client-publishing-composer`                         | N-COR-3: lift composer content state, wire handlePublish to publish-now with `selectedChannelIds`, unify query-key convention (kill `["posts", undefined]` and `["posts","list"]`), `pagehide` flush                                                    | ~250-350 LOC. MEDIUM                                                                                              |
| 5   | `standalone-correctness-trio` OR three micro-changes | N-COR-4 (pass provider from route; ~80 LOC, LOW) · N-COR-5 (4 cascade sites into UoW + collapse route→repo duplication; ~200 LOC, LOW-MED) · N-COR-6 (cron-parser + IANA tz, de-duplicate `computeNextRun`, backfill; ~250 LOC + migration, MEDIUM)     | keep as 3 separate small changes — different bounded contexts                                                     |

Delivery order: 1 → 2 → 3 → 4, with N-COR-4/5/6 slotted anywhere (recommend N-COR-4 first
as a fast pipeline warm-up while change 1's design is written). Rationale: publishing is
currently 500-ing at the door (change 1); nothing downstream is observable until the
engine both starts and survives; N-COR-1 needs a running engine to have an integration
test at all; the client toast can only be made honest after N-COR-1.

## Risks

- The N-COR-7 escalation is static-evidence-based. FIRST ACTION of the propose/design
  phase must be running `apps/api/tests/integration/sagaCustomerFlow.test.ts` against a
  live API+DB to confirm the 500. It is not in `run-tests.sh` (N-CI-2).
- Change 1 carries a data migration over `SagaInstance.accountId` rows currently holding
  userIds; needs a mapping via the persisted `context` JSON or CustomerUser→Account lookup.
- Fixing the wait-starvation without an idempotency/in-flight guard risks double-executing
  `UpdatePostStatusStep`; changes 2 and 3 are best reviewed together even if shipped apart.
- N-COR-6's backfill changes when existing recurring posts fire — needs an explicit
  product decision on whether to shift or preserve current (wrong) next-run times.
- Changes 1-3 touch the publish hot path; per the repo's own trigger rules that is a
  full-4R review tier, not a single lens.

---

## ADDENDUM — post-exploration empirical corrections (propose phase, 2026-07-31)

These corrections POSTDATE the exploration above and supersede its N-COR-7 framing.
Source: live run of `sagaCustomerFlow.test.ts` against API+DB (orchestrator) + propose-phase
source re-verification.

1. **The predicted 500 did NOT reproduce.** 12/13 tests pass; sagas start and persist
   fine; zero `TenantContextMismatchError` in the server log. N-COR-7 is therefore a
   **DATA-CORRUPTION defect** (wrong value stored, isolation semantics broken), not an
   availability outage.
2. **Mechanism (verified constraints):** `startSaga` AWAITS the first
   `persistSagaInstance` in the request context (`SagaManagerLifecycle.ts:127`); the
   fixture's `customerUser.id` ≠ `account.id` (no coincidental match); zero
   `withSystemContext`/`getSystemContext` usage exists in `apps/api/src/saga/**`. With
   the engine on the guarded client and a bound mismatched context, the ONLY mechanism
   consistent with all observations is that **writes inside
   `prisma.$transaction(async (tx) => …)` are not intercepted by the guard's query
   extension at runtime** in the installed Prisma version — contradicting the
   exploration's reading of prisma#17948. This is a candidate layer-1 bypass BEYOND the
   saga engine and must be empirically pinned in design and escalated if confirmed
   general.
3. **The 1 live failure** ("does NOT compensate steps at or after the pivot…"): saga
   stuck non-terminal past 30s. Verified mechanics: post-pivot step failure →
   `scheduleRetry` persists `nextRetryAt` (Execution:180-197) → resumption depends
   ENTIRELY on the retry-recovery checker → the checker's context-less `findMany` on
   the guarded model throws `TenantContextMissingError`, swallowed at Lifecycle:404 →
   retries never resume → saga stuck RUNNING. Root cause = the dead recovery scan
   (context declaration), NOT failSaga/timeout hygiene — ownership assigned to change 1
   (`saga-tenant-scope-and-recovery`).
