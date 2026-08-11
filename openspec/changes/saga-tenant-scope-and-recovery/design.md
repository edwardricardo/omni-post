# Design: Saga Tenant Scope and Recovery (N-COR-7 + N-COR-2a)

## Technical Approach

Thread the truth (accountId first-class), declare the context (tenant rehydration + system-scoped scans), then resume — on top of one wiring fix. **Empirical pin (orchestrator probe + source confirmation): the $transaction-bypass hypothesis is REFUTED.** The guard DOES intercept writes inside `$transaction(async (tx) => …)`(mismatch throws in-itx — probe verified). The engine is simply never on the guarded client:`index.ts:41`imports the RAW singleton and`index.ts:687`passes it to`SagaIntegration`, while `setup.ts:61-64`registers the guarded client under`TOKENS.PrismaClient`. The exploration's `setupServices.ts:937-958`"engine resolves guarded client" refers to a`TOKENS.SagaManager` registration that is **never resolved anywhere** (grep: registration site only) — dead wiring. Consequence: no general layer-1 bypass exists; the proposal's TOP risk is resolved-refuted, no standalone security escalation needed. It also means the retry scan is NOT dead today (see D6) — "dead scan" is the POST-fix hazard this design prevents, not the pre-fix cause.

## Architecture Decisions

### D1 — Client wiring: resolve the guarded client at the SagaIntegration construction site

**Choice**: In `index.ts:687`, pass `container.resolve<PrismaClient>(TOKENS.PrismaClient)` instead of the raw `prisma`. Container is configured at `index.ts:266` — ordering feasible. Type unchanged: `setup.ts:63` already casts the extended client `as unknown as PrismaClient` (established pattern), so `SagaIntegrationConfig.prisma: PrismaClient` needs no change.
**Enumeration of engine-internal uses of `config.prisma`** (SagaIntegration passes it only to `SagaManagerImpl`, `SagaIntegration.ts:200`):

| Use                                         | Site                              | Guard behavior post-swap                                                                                      |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `$transaction` → `tx.sagaInstance.upsert`   | `SagaManagerExecution.ts:509-541` | intercepted (probe); where + create injection/validation per `tenantGuard.ts:208-242`                         |
| `eventService.appendEventInTx(tx, …)`       | `Execution:546`                   | `StoredEvent` global table → guard returns early (not in `TENANT_SCOPED_MODELS`)                              |
| `sagaInstance.findUnique`                   | `Execution:606`                   | guarded — needs ctx (D3)                                                                                      |
| `sagaInstance.findMany` (boot + retry scan) | `Lifecycle:314, :388`             | guarded — needs system ctx (D3)                                                                               |
| `$queryRaw\`SELECT 1\`` healthCheck         | `Lifecycle:251`                   | not a model operation — extension-transparent; fitness #23 unaffected (backtick call, regex matches `(` form) |

**Alternatives considered**: resolving `TOKENS.SagaManager` (constructs a SECOND EventService + Redis connection, duplicate scheduler taskIds — rejected); guarding `sagaEventService` too (`index.ts:641` stays raw: it writes only the global `StoredEvent`; in-tx appends already ride the engine's tx client).
**Rationale**: composition-root rule (ARCHITECTURE_CANON §DI) — the bootstrap PASSES the guarded client; the engine keeps receiving `prisma` by constructor injection, imports nothing.

### D2 — Column truth: `SagaContext.accountId` first-class; `userId` kept for audit

**Choice**: `SagaContext` gains `accountId?: string` (`saga.ts:46-53`); `createSagaContext` gains a 5th optional param (`saga.ts:981`); `Lifecycle.startSaga:90-95` threads `contextData.accountId` (today it silently DROPS unknown fields — verified). `SagaIntegration.ts:436-443` passes `customer.accountId` first-class AND keeps `metadata.accountId` (the pivot's fail-closed check `saga.ts:617-624` reads metadata — contract untouched). Persistence (`Execution:523,:537`) writes `accountId: resolveSagaAccountId(context)` = `context.accountId` → valid-string `context.metadata.accountId` fallback (old rows' JSON is not rewritten) → omit. **Never `userId`.** `context.userId` KEPT: audit trail, event payloads, and the route ownership check `SagaIntegration.ts:486` stay keyed on userId → zero product-visible change (same-account-other-user still 404s; guard read-scoping by accountId adds DB-layer depth beneath it). No structural schema change: column, nullability (`String?` — needed for the NULL sentinel), and `@@index([accountId, status])` already exist (`schema.prisma:2058,:2071`). Migration is data-only (D4).
**Rationale**: under D1, writing `userId` would mismatch-throw at the door (`tenantGuard.ts:291-293`) — D1 and D2 are inseparable (same PR).

### D3 — Context declaration: tenant REHYDRATION for per-saga work; QUERY-SCOPED system context for tenant-unknown reads only

> **AMENDED AT GATE (2026-07-31) — C1, C2, S3.** (1) Hard invariant added: **a
> `withSystemContext` callback SHALL NEVER lexically enclose an `executeSagaAsync` /
> `compensateSagaAsync` dispatch.** Mechanics: the guard checks `getSystemContext()` FIRST
> (`tenantGuard.ts:198-201`) and returns before the tenant check at `:203`;
> `withSystemContext` (`tenantContext.ts:131-133`) has no exit primitive, so an inner
> `withTenantContext` CANNOT restore enforcement; and the dispatches are `setImmediate`
> (`Execution:29-37`), through which ALS propagates — a wrap spanning a dispatch would run
> the ENTIRE saga guard-bypassed. Every system wrap below is therefore scoped to the single
> query expression; all dispatches sit lexically outside. The original route-level admin
> wraps and the loop-body scan wraps were restructured accordingly. (2) Reason strings:
> the five ad-hoc strings are replaced by the spec's single fixed constant
> `system:saga-recovery` (exported as `SAGA_SYSTEM_REASON` from `sagaTenant.ts`) — spec
> option (a), no granularity divergence. (3) The engine's per-saga PERSISTENCE runs under
> rehydrated TENANT context (stronger than the delta spec's literal "persistence under
> withSystemContext"); the delta spec is amended in the same commit to state the stronger
> form — flagged as a design-driven spec amendment, not silent divergence.

> **AMENDED AT 4R REVIEW (2026-08-05).** All four adversarial lenses returned
> MERGE-BLOCKING on the first implementation with converging evidence. The core tenant
> scoping was sound (start path airtight, lazy-promise fix real, guard live in-tx, fixtures
> honest); the OPERATIONAL layer around it was not. Five structural decisions replace it.
>
> **(1) Dual-layer primitives, one module.** `sagaTenant.ts` stops being a pair of
> helpers and becomes the single module that owns BOTH isolation layers for the engine.
> `withSagaSystemRead(fn)` binds the ALS system context and awaits `fn` inside its own
> async callback, so the lazy-promise defect is impossible by construction rather than
> prevented by a comment repeated at three call sites. `runSagaSystemTransaction` and
> `runSagaTenantTransaction` additionally bind the RLS GUC (`setTenantGuc(tx,
SYSTEM_TENANT_SCOPE)` / `setTenantGuc(tx, accountId)`) as the transaction's first
> statement, mirroring the seam `PrismaUnitOfWork` owns for API transactions and the
> workers own for theirs. Layer 2 was previously unbound on every engine transaction; the
> WHY now lives once, in this module.
>
> **(2) Column-authoritative resolution.** Resolution reads `SagaInstance.accountId` — the
> DB column — FIRST; both deserializers now carry it onto the instance (they dropped it, so
> a row repaired by the backfill's join step was dead forever: its context carries no
> account and the engine could only ever skip it). Context and metadata become the fallback
> AND a cross-check: when the column and the context both exist and disagree, resolution
> fails CLOSED (counted, logged at ERROR, terminalized) BEFORE any write. That disagreement
> is exactly the cutover-straggler signature — old code wrote `userId` into the column while
> metadata held the account — so it is caught at read time instead of colliding at write
> time in an unbounded retry loop.
>
> **(3) Discriminated skip with a terminal path.** `runAsSagaTenant` returns
> `{ ran: true, value } | { ran: false, reason }` and EVERY caller consumes it (a static
> invariant rejects a discarded result). An admin compensate/continue that could not run
> answers with a 409-class error naming the reason instead of `{success: true}`. A saga
> whose tenant cannot be resolved is TERMINALIZED to FAILED by the timeout checker through
> one narrow, documented system-scoped write path (`failSagaAsSystem`), so it reaches a
> terminal state per the saga canon instead of being logged and counted forever. `startSaga`
> fails closed on an unresolvable account: it rejects before persisting rather than creating
> a row the engine can never scope.
>
> **(4) Observability made real.** The in-process counters are exported as REAL Prometheus
> metrics through the repo's `getOrCreateCounter` pattern:
> `saga_recovery_failures_total{stage}` and `sagas_failed_total{reason}` — the latter is the
> series `prometheus/alerts/saga.yml` already alerts on, previously never emitted. The health
> check degrades when the boot load failed, and every engine catch path reports through the
> repo's Sentry `captureError` with the real error.
>
> **(5) Loops hardened.** The timeout checker and `shutdown()` iterate per-saga inside their
> own try/catch with a counted, logged failure, so one poisoned row cannot block the rest;
> the by-id load distinguishes an infrastructure failure from an absent row instead of
> reporting both as "not found".

**Choice**: new helper `apps/api/src/saga/sagaTenant.ts`:

- `SAGA_SYSTEM_REASON = "system:saga-recovery"` — the ONLY reason string the engine may pass (spec fixed set, `specs/tenant-context-boundaries` MODIFIED block).
- `resolveSagaAccountId(context)` as in D2.
- `runAsSagaTenant(instance, fn)` → `withTenantContext({ accountId }, fn)`; missing accountId → `logger.error` + `rehydrationFailures` counter + skip (fail-loud; impossible for non-terminal rows post-backfill per D4's RAISE).

| Path                                                                                | Context (all system wraps QUERY-scoped, dispatches outside)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startSaga` + awaited first persist (`Lifecycle:127`)                               | UNCHANGED — request tenant ctx (`customerAuthMiddleware.ts:70`); guard validates the write at the door                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `executeSaga` / `compensateSagaSteps` initial `getSaga` load                        | `withSystemContext(SAGA_SYSTEM_REASON, () => getSaga(id))` — the wrap ends at the load; UNIFORM on every trigger path INCLUDING start (reconciliation: the id-only read under system is benign; on the start path the subsequent rehydration binds the same value the request ctx validated — rows 1/2 no longer disagree: row 1 governs `startSaga`'s own persist, which precedes any dispatch)                                                                                                                                                                                                                       |
| `executeSaga` body (step loop + persists), `compensateSagaSteps` body               | `runAsSagaTenant(instance, …)` — resumed CQRS step writes AND engine persists stay tenant-scoped, mismatch protection live on every persist                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| boot `loadActiveSagas` (`Lifecycle:314`)                                            | `const rows = await withSystemContext(SAGA_SYSTEM_REASON, () => findMany(...))`; the for-loop (deserialize, register, re-warm persist under `runAsSagaTenant`) and D5's resume dispatches run AFTER, outside the wrap                                                                                                                                                                                                                                                                                                                                                                                                  |
| retry scan (`Lifecycle:388`)                                                        | `const dueRows = await withSystemContext(SAGA_SYSTEM_REASON, () => findMany(...))`; the dispatch loop (`:397-399`) runs outside the wrap                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| timeout checker `failSaga` (`Lifecycle:425`) + `shutdown` persist (`Lifecycle:290`) | `runAsSagaTenant` (no dispatch on these paths)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| admin `/sagas/:sagaId/continue`, `/compensate` handlers                             | **NO route-level wrap** (restructured per C1: `continueSaga`/`compensateSaga` dispatch at `Lifecycle:155`/`:190` — a route wrap would enclose the dispatch). Instead the engine methods wrap ONLY their internal loads/persists: `continueSaga` loads via the query-scoped system wrap; `compensateSaga` additionally persists COMPENSATING (`Lifecycle:188`) under `runAsSagaTenant`; both dispatch outside any wrap. **S3 — necessity, not scope creep**: `adminAuthMiddleware` binds no tenant context, so post-D1 these loads would throw `TenantContextMissingError` without the engine-internal declared context |
| customer `GET /sagas/:sagaId`                                                       | UNCHANGED — request tenant ctx; guarded `findUnique` gets `where.accountId` injected → cross-tenant → null → 404 (depth under the `:486` app check). Redis fast path (`Execution:595-599`) is guard-blind — app check remains its protection; noted, accepted                                                                                                                                                                                                                                                                                                                                                          |

**Alternatives considered**: blanket `withSystemContext` around all engine work — rejected: resumed step executions run CQRS commands (post.create/update) through guarded repositories; system context would run TENANT work guard-bypassed and unscoped — and per the C1 mechanics it is unrecoverable from inside. Rehydration keeps every resumed write scoped to the saga's own tenant and honors `tenantContext.ts:124`.
**Observability** _(AMENDED AT GATE — W3a/W3b)_: keep the `:338`/`:404` catch blocks (a scan failure must not kill boot/tick); ERROR logs gain a per-run correlation id (`saga-recovery-${randomUUID()}` minted per boot pass / per tick) naming the failing loop + error type, per the spec's observability requirement; add `SagaMetrics` counters `bootLoadFailures`, `recoveryScanFailures`, `rehydrationFailures` (exposed via `/sagas/metrics` + health). The boot pass emits a summary log with `{loaded, resumed, checkerOwned, skipped}` counts and per-row skip reasons (`nextRetryAt-owned-by-checker`, `missing-accountId`, `parked` if the D5 fallback lands). No new Prometheus wiring in this slice.

> **AMENDED AT RE-VERIFY (2026-08-05) — the "no new Prometheus wiring" line is superseded.**
> In-process `SagaMetrics` is readable only through an authenticated admin endpoint, so a
> loop failing on every tick stays invisible to alerting — the exact blindness this
> observability section exists to remove. The slice therefore DOES add Prometheus wiring:
> `apps/api/src/metrics/sagaRecoveryMetrics.ts` exports `saga_recovery_failures_total{stage}`
> and `sagas_failed_total{reason}` (the latter is the series the saga alert rules already
> queried and nothing ever emitted), and `prometheus/alerts/saga.yml` gains
> `SagaTenantMismatch` (any increase on `stage="mismatch"` — the deploy-window straggler
> signal) and `SagaRecoveryLoopFailing`. The label is `stage`, not `loop`: two of its six
> values (`rehydration`, `mismatch`) are per-saga resolution outcomes, not loops, and an
> operator must not go hunting for a background loop named "mismatch".

### D4 — Backfill migration: metadata-first, join-second, sentinel/RAISE per Edward's decision

> **AMENDED AT GATE (2026-07-31) — W1.** The scope predicate missed the NULL-accountId
> row class: `Execution:523` conditionally spreads `...(instance.context.userId && {…})`,
> so a falsy `userId` persists `accountId = NULL`. The metadata-repair step (1) and the
> non-terminal RAISE check (4) now include `OR "accountId" IS NULL`; the join step (2)
> keys on `accountId = cu.id` (NULL naturally excluded) and the terminal-sentinel step (3)
> keeps `IS NOT NULL` scope (NULL terminal rows are already at the sentinel and must not
> inflate the report count).

Data-only SQL migration; idempotent, re-runnable. Steps 1 and 4 scoped to `("accountId" IS NULL OR "accountId" NOT IN (SELECT id FROM "Account"))`; steps 2-3 scoped to `"accountId" IS NOT NULL AND "accountId" NOT IN (SELECT id FROM "Account")`:

1. Metadata-first (authoritative): `SET "accountId" = si.context->'metadata'->>'accountId'` where that value exists in `Account` (repairs userId-corrupted AND NULL rows alike).
2. Join: `SET "accountId" = cu."accountId" FROM "CustomerUser" cu WHERE si."accountId" = cu.id` (`schema.prisma:335-337`).
3. Terminal residuals (`COMPLETED|FAILED|COMPENSATED`): `SET "accountId" = NULL` + `RAISE NOTICE` with count (sentinel = NULL — no fake FK-looking value).
4. Non-terminal residuals (unmappable, INCLUDING `accountId IS NULL` with no usable metadata): `RAISE EXCEPTION` listing ids → migration aborts, deploy halts.

`down.sql` = documented no-op-by-design (proposal §Rollback: post-backfill values are TRUE accountIds, correct regardless of code version). **Ordering**: `migrate deploy` before app cutover (standard). Old-code writes in the gap re-corrupt at worst a handful of rows → caught by D3's fail-loud rehydration; runbook line in the migration header: re-run the (idempotent) backfill statements manually. Verification query = success criterion: zero rows whose `accountId` matches a `CustomerUser.id`.

### D5 — Boot resume: single pass, disjoint from the retry checker; GATED on the crash-replay proof

> **AMENDED AT 4R REVIEW (2026-08-05) — the terminal path is a PR1 prerequisite.** The
> canon requires every saga to reach `COMPLETED`, `FAILED`, or `COMPENSATED`; an infinite
> `RUNNING` is a violation the timeout checker exists to close. The first implementation
> left a hole exactly there: a saga whose tenant cannot be resolved was skipped by the
> rehydration on EVERY path, including the timeout checker's `failSaga`, so it stayed
> non-terminal forever while emitting one ERROR and one counter increment per tick. PR1
> therefore owns the terminal path even though resume behavior stays byte-equivalent: the
> timeout checker, on an unresolvable or mismatched row, terminalizes it to FAILED through
> `failSagaAsSystem` — one narrow cross-tenant admin WRITE, system-ALS + system-GUC scoped,
> used ONLY for terminalization, with no dispatch inside it (C1 holds). PR2's resume pass
> then inherits a table in which "non-terminal" means "actually resumable".

**Choice**: after `loadActiveSagas`, `initialize()` runs ONE pass: `executeSagaAsync(id)` for every loaded PENDING/RUNNING instance with `nextRetryAt == null`. Rows WITH `nextRetryAt` stay owned by the (now-alive) retry checker — the two selection predicates are disjoint (`nextRetryAt IS NULL` vs `nextRetryAt NOT NULL`), so boot cannot double-execute against the checker. Terminal re-execution is already blocked (`Execution:60-72`).

> **AMENDED AT GATE (2026-07-31) — C3.** The original partition orphaned one row class:
> `shutdown()` flips RUNNING→PENDING (`Lifecycle:288-290`) while the persist keeps
> `nextRetryAt` non-null (`Execution:539` update branch) — so a graceful shutdown of a
> retry-pending saga produced `PENDING + nextRetryAt`, skipped by the boot pass
> (nextRetryAt non-null) AND invisible to the checker (`where status: "RUNNING"` only,
> `Lifecycle:390`), leaving it to the 30-min timeout force-FAIL. **Owner assigned: the
> retry checker's where widens to `status: { in: ["RUNNING", "PENDING"] }, nextRetryAt:
{ lte: now, not: null }`.** Safety verified against the code: `PENDING + nextRetryAt`
> arises ONLY via shutdown-of-retry-pending (creation never sets `nextRetryAt` — the
> create branch spreads it only when present on a fresh instance, `Execution:525`; the
> only writer is `scheduleRetry`, `Execution:185`), and `executeSaga` on such a row
> behaves identically to the RUNNING case (non-terminal check passes, status set RUNNING,
> current step re-runs). Single-claim proof still holds — the partition key is
> `nextRetryAt` nullability alone: boot pass claims `IS NULL`, checker claims `NOT NULL
AND lte now`, intersection empty; `@@index([status, nextRetryAt])` serves the widened
> predicate. Coverage argument now closes all four non-terminal load classes: PENDING
> fresh (boot), RUNNING mid-step (boot), RUNNING retry-pending (checker), PENDING
> retry-pending post-shutdown (checker). Test plan gains the spec scenario "restart does
> not orphan a retry-pending saga" (graceful shutdown with `nextRetryAt` set → restart →
> checker claims it → terminal within the retry envelope).
> **Crash-window analysis (crash between `step.execute()` side-effect and persist → resume re-runs the in-flight step):**

| Step                 | Replay effect                                                                                        | Absorber                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| validate             | pure                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                                                         |
| create               | re-issues `cmd-{sagaId}-create-post` (`saga.ts:460`)                                                 | **NONE — CQRSBus has NO command-id dedupe** (`CQRSBus.ts:91-111`, grep dedupe/idempotent = 0, contradicting canon §Saga DedupeKey). Residual: duplicate DRAFT (pre-pivot, no external side-effect). Documented; durable bus dedupe escalated to backlog                                                                                                                                                   |
| **pivot** (schedule) | re-enqueue per channel                                                                               | BullMQ jobId = dedupeKey `publish-${postId}-${channelId}` (`SagaIntegration.ts:271`, `queue-adapter.ts:83`) — `add` is a no-op while the prior job exists. Window is COUNT-bounded: worker `removeOnComplete {count:100}` / `removeOnFail {count:50}` (`consumer-adapter.ts:60-61`) — >100 completions during downtime evicts and dedupe is lost. Honest boundary; acceptable for the crash-replay window |
| wait                 | idempotent read; evicted jobs count as failed, never silently PUBLISHED (`queue-adapter.ts:204-208`) | —                                                                                                                                                                                                                                                                                                                                                                                                         |
| update-status        | re-issues same command id + OCC `expectedVersion`                                                    | _(AMENDED AT GATE — S1)_ expected per the step's JSDoc claim (`saga.ts:762-763`) — a comment, not proof; verified EMPIRICALLY inside the crash-replay test (assert a single consistent `Post.status` outcome and no duplicate side-effect after resume; if tolerance fails, that is an apply-phase finding, not a silent pass)                                                                            |

> **AMENDED AT 4R REVIEW (PR2) (2026-08-10).** Three of the four adversarial lenses
> returned MERGE-BLOCKING on the first recovery implementation. The tenant-isolation
> core they were pointed at was verified CLEAN by all four (`sagaTenant.ts` primitives,
> the account-less persist removal, the static classifier) and is untouched here. What
> failed was the recovery layer's WIRING and its operator CONTRACT. Nine decisions
> replace it.
>
> **(W1) Composition order is part of the design, not an implementation detail.**
> `SagaIntegration.initialize()` ran `sagaManager.initialize()` — which contains the
> boot resume pass — BEFORE `registerSagaDefinitions()`. The pass reads
> `definitions.get(row.definitionId)` synchronously, so the map was empty for its whole
> duration and EVERY inherited saga took the "pivot boundary unknowable" branch: the
> shipped recovery capability was inert in the deployed composition. Registration is
> pure map population with no dependency on an initialized manager, so it moves FIRST.
> Two guards, not one: a static invariant asserts the order in source, and defence in
> depth inside the engine — a boot where EVERY loaded row is declined for want of a
> definition counts a boot-load FAILURE and logs at ERROR (which also degrades the
> health check), because a wiring defect must never present as a fleet of ordinary
> parked sagas. Unregistered-definition parking is also its own disposition
> (`definition-unregistered`), distinct from pivot parking.
>
> **(W2) The harness boots the production composition.** The suite constructed a bare
> `SagaManagerLifecycle` and registered the definition BEFORE `initialize()` — the
> inverse of production — so 9/9 green was evidence for a wiring that does not exist.
> It now boots real `SagaIntegration` instances (real CQRS bus, real handlers, real
> queue adapter, real repositories) and gained the missing HAPPY PATH: a seeded
> pre-pivot row, inherited by a boot, dispatched exactly once, reaching a terminal
> state with no operator action and issuing exactly one command per remaining
> command-issuing step. That test also serves as the POSITIVE synchronization point
> that replaced the two fixed 1.5s sleeps the negative assertions were gated on. Step
> indices derive from `definition.pivotStepIndex`, never a literal. The suite refuses
> to run on a database holding foreign non-terminal rows, because a boot loads and
> DISPATCHES every one of them.
>
> **(W3) The parked contract, made canon-coherent and honest.** The canon forbids an
> infinite non-terminal state, so parked rows DO terminalize — but exactly once and
> under their own name. A parked row is excluded from the ORDINARY timeout sweep (a
> crash-inherited saga is normally already past `startedAt + timeout`, so the sweep gave
> the operator a window of at most one tick and labelled the outcome `timeout`).
> Instead its window opens at the moment of PARKING — tracked in memory,
> `SagaManagerLifecycle.parkedAt` — and lasts one full saga horizon, after which the
> checker fails it as `parked-expired`. Two residuals were PROMOTED into this change
> because parking made them load-bearing: `failSaga` now stops tracking the saga
> (through the same `stopTracking` the completion and compensation paths use), and
> `checkSagaTimeout` refuses to re-visit a terminal row — without both, an expired
> parked row was re-failed and re-audited every 60s forever. Parking is per-process and
> deliberately NOT persisted (the row must stay byte-identical), so a restart re-derives
> it and RE-OPENS the window; that edge is stated plainly in the runbook rather than
> hidden.
>
> **(W4) The checker's pivot claim: ADJUDICATED EMPIRICALLY, closed as
> guarded-by-countermeasure.** R1 argued the retry checker replays a pivot-step row
> after the BullMQ retention window has evicted the job, producing a duplicate publish.
> Measured: it does not. The pivot's `RereadCheck` runs BEFORE `step.execute()`
> (`SagaManagerExecution.ts`) and aborts unless the post is still `DRAFT`, so an
> inherited pivot-step retry whose post has moved on settles as `FAILED` with
> `Reread check failed: Post.status is PUBLISHED, expected DRAFT`, enqueues nothing and
> publishes nothing. That guarantee is STRONGER than the job-id absorber because it is
> upstream of the enqueue and therefore retention-independent. Pinned by an integration
> test plus a static invariant asserting the composition still passes the reread
> implementation (the countermeasure exists only when it does). The
> `nextRetryAt`-nullability partition therefore stands unchanged, including post-pivot
> forward recovery.
>
> **(W5) The pass is bounded and contained.** Per-row `try/catch` (a persisted context
> without its `metadata` object throws during tenant resolution; that must cost one
> saga, not the pass) plus a pass-level `try/catch` so no synchronous throw can reject
> `initialize()` and exit the bootstrap on every subsequent boot. `maxConcurrentSagas`
> becomes REAL — it caps how many inherited sagas advance at once, which required an
> awaitable `executeSaga` on the execution port (a fire-and-forget dispatch cannot be
> counted, so it cannot be capped). `loadActiveSagas` gains `bootLoadLimit` (default
> 500), oldest-first, with the deferred count measured in the same transaction and
> reported. Re-warming moved OUT of the load and INTO the pass, skipping parked rows —
> which is what makes "nothing written to it" true, and lets the suite assert it on
> `updatedAt`.
>
> **(W6) Ownership honesty instead of a claims layer.** The partition is disjoint
> within ONE process. Row claims are NOT built here; instead the constraint is stated
> loudly — more than one API replica with the saga engine enabled is unsupported until
> claims land — in the spec, in `MULTI_TENANT_GUARDS.md`, and as **SMELL-73** with the
> `OutboxClaimService` (`FOR UPDATE … SKIP LOCKED`) pointer. Fixing W1 activates this
> risk, so the constraint is a merge condition of this change, not a footnote.
>
> **(W7) Gate integrity.** `run-tests.sh` now fails on `TOTAL_CANCEL > 0` and captures
> the runner's exit code instead of discarding it. Node reports a broken `before` hook
> as cancelled subtests with `# fail 0`, so the batch this change promotes to
> merge-blocking previously printed OK with its entire setup collapsed.
>
> **(W8) Vocabulary and observability tell the truth.** `parked` keeps ONE meaning
> (pivot / manual review); the graceful-shutdown drain HANDS OFF. Parking leaves the
> failure series for its own `saga_recovery_parked_total{reason}`, with alert rules,
> deploy-window dedup semantics, a `SagaParkedWindowExpired` alert on the new
> `parked-expired` reason, an unpark/terminalize procedure and the SQL that enumerates
> candidate parked rows (parking is not persisted — the query is over non-terminal rows
> at or past the pivot). One log line per disposition, `tenant-mismatch` with its own
> sentence and runbook pointer, and one name — `unresolvable-account` — across the boot
> summary, the rehydration warnings and the failure reasons. `/sagas/metrics` carries
> the parked, deferred and per-row-failure counters.
>
> **(W9) Spec and design state the SHIPPED contract**, including the composition order
> as normative, the happy path as covered, the parked lifecycle, per-process ownership
> with its deployment constraint, and the W4 adjudication.

**Gate (Edward's decision)**: auto-resume ships ONLY if the two-manager crash-replay integration test proves pivot absorption (Testing Strategy). Fallback if unprovable: park pivot-interrupted rows (log `PARKED` + counter, no auto-execute); tasks wire exactly one path after the test verdict. **Seam with change 2** (`saga-engine-terminal-hygiene`): this change delivers truth + context + alive scans + boot resume; change 2 owns `failSaga` `activeInstances.delete`, timeout terminal filter, waiting≠failed step contract, in-flight execution guard, and `handleEvent` amplification. Known accepted noise until change 2: timeout checker may re-fail an already-FAILED in-memory instance (pre-existing, now merely persisted correctly); `COMPENSATING` orphans are not loaded (`Lifecycle:315` filter) → not resumed (pre-existing, carried to change 2).

### D6 — Test 13 root cause CORRECTED: horizon arithmetic today; dead scan only post-fix

Evidence: (a) the engine runs on the RAW client (D1) — the checker's `findMany` CANNOT throw `TenantContextMissingError` today; (b) test 3 (`sagaCustomerFlow.test.ts:306-328`) is the SAME publish-now-with-stub-creds flow with a **60s** horizon and PASSES, while test 13 (`:563`) polls only **30s** — termination empirically lands in (30, 60]s; (c) arithmetic: retry envelope 5+10+20 = 35s (`saga.ts:912-916`) + up-to-5s scan ticks + worker latency. The proposal's "dead checker" claim is inconsistent with (a) and disproven by (b) — it is what WOULD happen after D1 without D3.
**Fix** _(AMENDED AT GATE — W2)_: raise test-13 `waitForTerminal` to **90s** — the gate's empirical run measured 49.2s for test 3's identical flow, so 60s left ≈18% headroom at the analytic worst case (35s backoff + 3×5s tick latency + worker latency); 90s holds ≥45% margin. Wall-time impact: the file's worst case grows to ~110s+ (test 3 at 60s + test 13 at up to 90s + short tests), covered by the PR2 batch `TIMEOUT=180000`. D3 keeps the scan alive under the guarded client. No change-2 prerequisite: `failSaga` persists FAILED fine for a single saga. **Consequence for the proposal's success criterion**: "this change flips the 13th test green" holds only WITH the horizon fix — context declaration alone does not (and never would have).

### D7 — PR seam: PR1 = scope (wiring+context+column+backfill), PR2 = recovery

PR1 = D1+D2+D3+D4 + two-tenant/column-truth tests (inseparable block: guarded client without D2 → 500 at the door; without D3 → dead loops). PR1 alone is independently safe: recovery behavior is byte-equivalent to today (load-without-resume, scans alive), every write becomes truthful + guarded. PR2 = D5 + D6 + crash-replay/kill-restart proof + `run-tests.sh` wiring. Rollback: PR1 revert re-points the wiring to raw (backfilled data stays valid); PR2 revert removes resume + test wiring. Forecast: PR1 ~300-350 authored LOC, PR2 ~250-300 — chained PRs confirmed direction; FINAL decision at tasks via the Review Workload Guard.

## Data Flow

    [request ctx: enterTenantContext(jwt.accountId)]
      startSaga → persist{accountId: ctx.accountId ✓guard-validated} → setImmediate executeSaga (ALS inherited)
    [no ctx: scheduler tick / Redis pub-sub / boot]
      rows = withSystemContext(SAGA_SYSTEM_REASON){ findMany }   // wrap ends HERE
      for row → executeSagaAsync(id)                             // dispatch OUTSIDE any wrap (C1)
        └─ load(id) ← withSystemContext(SAGA_SYSTEM_REASON){ … } // query-scoped
        └─ runAsSagaTenant(instance) → steps (guarded CQRS writes, tenant-scoped) + persists (guard-validated)
    [boot] loadActiveSagas → activeInstances → resume pass (nextRetryAt==null) → executeSagaAsync
                                             → nextRetryAt!=null → retry checker (disjoint)

## File Changes

| File                                                                                            | PR  | Action                 | Description                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/index.ts`                                                                         | 1   | Mod                    | D1: `:687` resolve `TOKENS.PrismaClient`                                                                                                                                                                                       |
| `packages/shared/src/saga.ts`                                                                   | 1   | Mod                    | D2: `SagaContext.accountId`, `createSagaContext` param                                                                                                                                                                         |
| `apps/api/src/saga/SagaIntegration.ts`                                                          | 1   | Mod                    | D2 first-class accountId; no route-level system wrap (C1)                                                                                                                                                                      |
| `apps/api/src/saga/SagaManagerLifecycle.ts`                                                     | 1+2 | Mod                    | D2 threading; D3 scans + counters; PR2: D5 resume pass                                                                                                                                                                         |
| `apps/api/src/saga/SagaManagerExecution.ts`                                                     | 1   | Mod                    | D2 column write; D3 load + rehydration wraps                                                                                                                                                                                   |
| `apps/api/src/saga/sagaTenant.ts`                                                               | 1   | Create                 | D3 helpers                                                                                                                                                                                                                     |
| `apps/api/src/saga/sagaManagerTypes.ts`                                                         | 1   | Mod                    | D3 SagaMetrics counters                                                                                                                                                                                                        |
| `infra/prisma/migrations/{ts}_backfill_saga_instance_account_id/`                               | 1   | Create — **SENSITIVE** | D4 (+ documented no-op down.sql)                                                                                                                                                                                               |
| `apps/api/tests/unit/saga/**`                                                                   | 1   | Mod/Create             | column-source, rehydration, scan-context units                                                                                                                                                                                 |
| `apps/api/tests/integration/sagaTenantIsolation.test.ts`                                        | 1   | Create                 | DB-only two-tenant harness (manager on guarded test client) → `integration:tenant-isolation` batch                                                                                                                             |
| `apps/api/tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts`             | 1   | Create                 | D4 four-class disposition + RAISE                                                                                                                                                                                              |
| `apps/api/scripts/run-tests.sh`                                                                 | 1+2 | Mod                    | PR1: DB-only suites into existing batches; PR2: new live-API batch (`TIMEOUT=180000`, W2 wall-time) for `sagaCustomerFlow` under `full-integration` tier (`run-tests.sh:195-237`)                                              |
| `apps/api/tests/integration/sagaCrashRecovery.test.ts`                                          | 2   | Create                 | D5 two-manager crash-replay + kill-restart proof (incl. C3 shutdown-orphan scenario + S1 OCC-tolerance assertion)                                                                                                              |
| `apps/api/tests/integration/sagaCustomerFlow.test.ts`                                           | 2   | Mod                    | D6 test-13 horizon 30s→90s (W2)                                                                                                                                                                                                |
| `docs/security/MULTI_TENANT_GUARDS.md`                                                          | 1+2 | Mod                    | _(AMENDED AT GATE — W3d)_ record saga posture + residual leg-1/leg-3 gaps per multi-tenant-isolation req 4: Redis fast-path guard-blind read, NULL-sentinel terminal rows, CQRSBus dedupe residual                             |
| `openspec/changes/saga-tenant-scope-and-recovery/specs/tenant-context-boundaries/spec.md`       | 1   | Mod                    | _(AMENDED AT GATE — C1/C2)_ design-driven amendment: per-saga persistence under rehydrated tenant ctx (stronger form); system wraps query-scoped, never enclosing a dispatch; single `system:saga-recovery` constant confirmed |
| `openspec/specs/{multi-tenant-isolation,tenant-context-boundaries,saga-crash-recovery}/spec.md` | 1+2 | Mod/Create             | per proposal Capabilities                                                                                                                                                                                                      |

## Interfaces / Contracts

```typescript
// packages/shared/src/saga.ts
export interface SagaContext {
  /* … */ accountId?: string;
}
export function createSagaContext(
  sagaId: string,
  correlationId: string,
  userId?: string,
  metadata: Record<string, unknown> = {},
  accountId?: string
): SagaContext;

// apps/api/src/saga/sagaTenant.ts
/** The ONLY system-context reason the saga engine may use (spec fixed set). */
export const SAGA_SYSTEM_REASON = "system:saga-recovery" as const;
export function resolveSagaAccountId(context: SagaContext): string | null;
export function runAsSagaTenant<T>(
  instance: SagaInstance,
  fn: () => Promise<T>
): Promise<T | undefined>;

// apps/api/src/saga/sagaManagerTypes.ts — SagaMetrics gains
bootLoadFailures: number;
recoveryScanFailures: number;
rehydrationFailures: number;
```

## Testing Strategy

| Layer                                     | What to Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Approach                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unit (vitest)                             | persist writes `context.accountId` never `userId` (+ metadata fallback, omit-when-null); `resolveSagaAccountId` matrix; `runAsSagaTenant` fail-loud on missing; guard upsert `where {id, accountId}` injection for `sagaInstance` (extended-where shape)                                                                                                                                                                                                                                                                                                                                                                                                         | prisma spy / `tenantGuardCheck` pure fn                                                                  |
| Static (vitest, MERGE-BLOCKING)           | _(AMENDED AT GATE — C1)_ no `executeSagaAsync(` / `compensateSagaAsync(` occurrence lexically inside a `withSystemContext(` callback anywhere in `apps/api/src/saga/**`; every saga `withSystemContext` call site passes `SAGA_SYSTEM_REASON` (spec [static] scenarios)                                                                                                                                                                                                                                                                                                                                                                                          | source-scan test over the saga source files                                                              |
| Integration PR1 (MERGE-BLOCKING, DB-only) | two tenants: column carries TRUE accountId; A cannot read/load B's saga via guarded client — _(AMENDED AT GATE — W4)_ the by-id read proof MUST NOT be satisfiable by the Redis fast path (`Execution:595-599` returns before the guarded read): delete `saga:{id}` from Redis first (or assert via the guarded client directly, not the manager); scans succeed under system ctx with no bound tenant; _(W3c)_ induced context failure: run one scan tick with its declared context removed by the harness → assert ERROR log naming the loop + error type + correlation id AND failure counter increment (never an empty-success scan)                         | own `SagaManagerImpl` on guarded test client (two-manager harness), `integration:tenant-isolation` batch |
| Integration PR1 (migration)               | row classes incl. W1's NULL class: metadata-mappable (userId-corrupted AND NULL), join-mappable, terminal-unmappable→NULL+count, active-unmappable (incl. NULL)→RAISE aborts; idempotent re-run                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | execute migration SQL against test DB (raw allowed in tests)                                             |
| Integration PR2 (MERGE-BLOCKING)          | crash-replay: manager A runs publish-now past pivot on real BullMQ; rewind row to `currentStep=2` + delete `saga:{id}` Redis key (crash-before-persist state); manager B (fresh memory) `initialize()` → resume → assert exactly ONE job per `publish-${postId}-${channelId}`, terminal state, and _(S1)_ a single consistent `Post.status` outcome (OCC re-application tolerance verified, not assumed). _(C3)_ shutdown-orphan scenario: manager A schedules a retry (`nextRetryAt` set), graceful `shutdown()` (→ PENDING + nextRetryAt), manager B boots → widened checker claims it → terminal within the retry envelope. Kill-restart proof = same harness | node:test, real DB+Redis; THE D5 gate                                                                    |
| Integration PR2 (live-API)                | `sagaCustomerFlow` full suite incl. test 13 at 90s (W2 horizon)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | new live-API batch                                                                                       |
| Gate                                      | 0-defect: tsc, eslint --max-warnings 0, fitness (#21 unchanged — index.ts exempt; #23 untouched), LXC-safe regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | per repo obligation                                                                                      |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Data-layer authorization (client wiring + ALS context + data migration); the BullMQ jobId dedupe is an existing data contract exercised, not a new process boundary.

## Migration / Rollout

Chained PRs on `workstream/saga-tenant-scope-and-recovery` (D7). `pnpm db:up` + `omnipost-allow sensitive-edit` at apply (`infra/prisma/**`). Migration deploys before code (standard `migrate deploy` order); idempotent backfill re-runnable for cutover stragglers. D5 auto-resume ships only behind the green crash-replay gate; parking fallback pre-designed.

## Open Questions

- [ ] None blocking. Backlog escalations: (1) **CQRSBus lacks the command-id dedupe the canon asserts** (§Saga DedupeKey vs `CQRSBus.ts:91-111`) — durable dedupe needed to close the create-step replay residual; (2) dead `TOKENS.SagaManager` registration (`setupServices.ts:937-958`) — remove or converge in change 2; (3) `COMPENSATING` orphan resume (change 2); (4) doc drift: `tenantContext.ts:20` claims the guard emits an audit event under system context — `tenantGuard.ts:198-201` does not; (5) Redis saga-cache fast path is guard-blind (app-level ownership check is the control) — revisit if saga reads ever bypass the route check.
