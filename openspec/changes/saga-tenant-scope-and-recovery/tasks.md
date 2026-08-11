# Tasks: Saga Tenant Scope and Recovery (N-COR-7 + N-COR-2a)

> Strict-TDD, dependency-ordered. RED precedes each GREEN. Two chained PRs on the design's
> D7 seam: **PR1 = scope** (D1 guarded-client wiring + D2 column truth + D3 context
> declaration + D4 backfill + two-tenant/column proofs — recovery behavior stays
> byte-equivalent to today); **PR2 = recovery** (D5 boot resume + C3 widened checker + D6
> horizon + crash-replay proof + runner wiring). Branch
> `workstream/saga-tenant-scope-and-recovery`.
>
> **The design's `AMENDED AT GATE` and `AMENDED AT 4R REVIEW` blocks are AUTHORITATIVE**
> over any conflicting original prose. Hard invariant threaded through every task below
> (C1): a `withSystemContext` callback SHALL NEVER lexically enclose a saga dispatch —
> `executeSagaAsync`, `compensateSagaAsync`, or the awaited `executeSaga` the bounded boot
> pass uses. System wraps are QUERY-scoped; per-saga work runs under rehydrated
> `withTenantContext`.

## Sensitive-edit gate

**Token REQUIRED: YES — `omnipost-allow sensitive-edit`.** Sensitive path: `infra/prisma/**`
(the backfill migration pair in Phase 5). D2 needs **no** structural schema change
(`SagaInstance.accountId String?` + `@@index([accountId, status])` already exist,
`schema.prisma:2058,:2071`) — if a schema touch becomes necessary, it needs the same token.
Every other file in this change is non-sensitive.

## Command legend (LXC-safe, single-file — heap 3072, never the full local suite)

- **DBUP**: `pnpm db:up` (before any migration or integration test)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/api exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **INT-LONG `<file>`**: same as INT plus `--test-timeout=180000`. Required for
  `sagaCustomerFlow` (W2: test 3 at 60s + test 13 at up to 90s ⇒ file worst case ~110s+).
  `run_batch` maps `TIMEOUT=` → `--test-timeout` (`run-tests.sh:60,:72`); the default
  30000 would cancel these tests.
- **LIVE-API**: `pnpm dev:api` in a second shell — `sagaCustomerFlow` fetches
  `http://localhost:3000` and belongs to the live-API tier (`run-tests.sh:195-237`)
- **MIGRATE**: author `prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply `pnpm db:up && pnpm db:migrate`

## Review Workload Forecast

| Field                   | Value                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Estimated changed lines | PR1 ~520–620 · PR2 ~320–400 · combined ~840–1020                     |
| 400-line budget risk    | High                                                                 |
| Chained PRs recommended | Yes                                                                  |
| Suggested split         | PR 1 (scope: wiring + column + context + backfill) → PR 2 (recovery) |
| Delivery strategy       | ask-on-risk — already RESOLVED by Edward (chained PRs)               |
| Chain strategy          | stacked-to-main (cached)                                             |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Rationale: the chained-PR question and the chain strategy are both already answered
(chained, stacked-to-main), so no pre-apply decision remains. PR1 is over budget and the
overage is **test-dominated**: ~230 production lines (index.ts 2, `saga.ts` 12,
`SagaIntegration` 12, `Lifecycle` ~70, `Execution` ~45, new `sagaTenant.ts` ~80,
`sagaManagerTypes` 6) + ~80 migration SQL vs ~540 test lines + ~70 docs/spec.
**The D1-without-D3 split is FORBIDDEN**: the guarded client without declared context
turns both background loops into throwing-and-swallowed dead loops — a regression, not a
slice (design D7 "inseparable block"). The only safe sub-split if a reviewer demands
≤400 is `PR1a = D2 + D4` (column truth + backfill, engine still on the raw client, values
become correct with byte-equivalent behavior) then `PR1b = D1 + D3` (wiring + context +
integration proofs). Prefer the D7 two-PR shape; escalate the sub-split only on request.

### Suggested Work Units

| Unit | Goal                                                                                                                                                                                | Likely PR | Focused test command                                                                                     | Runtime harness                                                                                                                                                                                                                               | Rollback boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Column truth + declared context + guarded client: every saga write carries the TRUE account and is guard-validated; scans alive under query-scoped system context; history repaired | PR 1      | VITEST `tests/unit/saga/`; INT `tests/integration/sagaTenantIsolation.test.ts`                           | DBUP + two-tenant real-DB run (A cannot read/load/mutate B's saga through the guarded client; scans see both accounts; induced context failure logs + counts)                                                                                 | revert branch pre-merge; post-merge revert re-points `index.ts:687` to the raw singleton (backfilled values stay valid); migration `down.sql` is a documented no-op by design                                                                                                                                                                                                                                                                                                                           |
| 2    | Recovery: single-pass boot resume disjoint from the widened retry checker, crash-replay dedupe proven, post-pivot failures terminal within the horizon, suites wired                | PR 2      | INT `tests/integration/sagaCrashRecovery.test.ts`; INT-LONG `tests/integration/sagaCustomerFlow.test.ts` | DBUP + Redis + real BullMQ harness booting the REAL `SagaIntegration` (composition A past pivot → rewind → composition B `initialize()` → exactly one job per `publish-${postId}-${channelId}`, one consistent `Post.status`, terminal state) | revert removes the boot resume pass and its bounds, the checker predicate widening, the parked lifecycle (window + `parked-expired` + the two promoted terminal-hygiene fixes), the composition-order swap, the runner's cancel gate and the runner batch — AND restores the account-less persist fallback removed in 11.0, which is the one PR2 item that rewrites a PR1 code path. The horizon bump is NOT in this revert surface: it landed in PR1 (7R.9). PR1's scope/wiring is otherwise untouched |

## Phase 0: Artifact reconciliation — BEFORE any code (gate residuals)

- [x] 0.1 `design.md` File Changes table (`SagaIntegration.ts` row): the cell still reads
      "D3 admin-route system ctx", contradicting amended D3 row 7 (**NO route-level wrap** —
      a route wrap would enclose the `continueSaga`/`compensateSaga` dispatch at
      `Lifecycle:155`/`:190`, violating C1). Replace with the engine-internal query-scoped
      shape: "D2 first-class accountId; no route-level system wrap (C1)".
- [x] 0.2 `design.md` Testing Strategy, row "Integration PR2 (live-API)": still says test 13
      "at 60s". The amended W2 horizon is **90s** (design lines 125/160 already say 90s).
      Correct the cell to 90s so the tasks/apply/verify chain reads one number.
- [x] 0.3 `specs/tenant-context-boundaries/spec.md` preamble (non-normative prose, ~lines
      5–13): (a) it claims the process-owned internals "become a DECLARED system-context
      boundary" — the amended requirement is narrower and stronger (system context ONLY for
      tenant-unknown queries; per-saga persistence under **rehydrated tenant context**);
      (b) it claims both background loops "are DEAD today" — REFUTED: the engine runs on the
      RAW client (`index.ts:41,:687`), the live run shows the loops working, and the test-13
      failure was horizon arithmetic (design D6). Rewrite the preamble to match; leave every
      normative `## ADDED` / `## MODIFIED` block untouched.

---

# PR1 — Scope (wiring + column truth + context + backfill)

## Phase 1: RED — unit + static (vitest, no DB)

- [x] 1.1 [RED] `apps/api/tests/unit/saga/sagaTenant.test.ts` (new, `@file`/`@description`/
      `@layer infrastructure`): `resolveSagaAccountId` matrix — `context.accountId` wins →
      valid-string `context.metadata.accountId` fallback → `null` when neither (never
      `userId`, never `""`); `runAsSagaTenant` runs `fn` inside `withTenantContext({accountId})`
      on hit, and on miss logs ERROR + increments `rehydrationFailures` + SKIPS `fn`
      (fail-loud, never a system-context fallback). RED until 3.1.
- [x] 1.2 [RED] `apps/api/tests/unit/saga/sagaPersistence.column.test.ts` (new): prisma spy
      over `persistSagaInstance` — BOTH upsert branches (`Execution:523` create,
      `:537` update) write `resolveSagaAccountId(context)`; assert the written value equals
      the account and `!== context.userId`; assert the key is OMITTED (not `undefined`,
      `exactOptionalPropertyTypes`) when the resolver returns null. Add the guard-shape
      assertion: `sagaInstance.upsert` `where` carries `{id, accountId}` after injection
      (`tenantGuard.ts:208-242`), exercised through `tenantGuardCheck` as a pure fn.
- [x] 1.3 [RED] **[MERGE-BLOCKING]** `apps/api/tests/unit/saga/sagaContextInvariants.static.test.ts`
      (new, source-scan over `apps/api/src/saga/**` + the bootstrap): (a) **C1 dispatch
      invariant** — no `executeSagaAsync(` / `compensateSagaAsync(` occurrence lexically
      inside a `withSystemContext(` callback (balance the callback body, do not regex a
      single line); (b) **C2 reason constant** — every saga `withSystemContext(` call site
      passes `SAGA_SYSTEM_REASON`, never an ad-hoc string; (c) no bare context-less reach:
      each of the six `config.prisma` sites is inside a declared wrap or documented
      extension-transparent; (d) **spec static scenario "no engine construction path takes
      the raw singleton"** — no saga-engine construction site receives the raw
      `@infra/prisma` import; (e) each of the boot-load / retry-scan / timeout-checker catch
      blocks logs at ERROR and increments a counter (no silent discard). RED until Phase 3–4.
- [x] 1.4 Run VITEST on 1.1–1.3 → expect RED for the right reasons (module `sagaTenant.ts`
      absent; column writes `userId`; zero `withSystemContext` in `apps/api/src/saga/**`).

## Phase 2: D2 — column truth threaded end to end → turns 1.2 GREEN

- [x] 2.1 [GREEN] `packages/shared/src/saga.ts` (`:46-53`): `SagaContext` gains
      `accountId?: string`; `createSagaContext` (`:981`) gains a 5th optional `accountId`
      param. Keep `userId` (audit trail, event payloads, and the route ownership check
      `SagaIntegration.ts:486` stay keyed on it).
- [x] 2.2 [GREEN] `apps/api/src/saga/SagaIntegration.ts` (`:436-443`): pass
      `customer.accountId` first-class AND **keep** `metadata.accountId` — the pivot's
      fail-closed check (`saga.ts:617-624`) reads metadata; that contract is untouched.
- [x] 2.3 [GREEN] `apps/api/src/saga/SagaManagerLifecycle.ts` `startSaga` (`:90-95`): thread
      `contextData.accountId` into the constructed context (today unknown fields are
      silently DROPPED — verified).
- [x] 2.4 [GREEN] `apps/api/src/saga/SagaManagerExecution.ts` (`:523`, `:537`): both upsert
      branches write `accountId: resolveSagaAccountId(context)`; **never `context.userId`**.
      Run VITEST 1.2 → GREEN.

## Phase 3: D3 — helper + context declaration (C1/C2/S3) → turns 1.1 GREEN

- [x] 3.1 [GREEN] Create `apps/api/src/saga/sagaTenant.ts` (`@file`/`@description`/
      `@layer infrastructure`): `export const SAGA_SYSTEM_REASON = "system:saga-recovery" as const`
      (the ONLY reason the engine may use — spec fixed set), `resolveSagaAccountId(context)`,
      `runAsSagaTenant(instance, fn)` → `withTenantContext({accountId}, fn)` with fail-loud
      miss handling. No `any`; `Result`-free (infrastructure helper, throws stay inside).
- [x] 3.2 [GREEN] `apps/api/src/saga/sagaManagerTypes.ts`: `SagaMetrics` gains
      `bootLoadFailures`, `recoveryScanFailures`, `rehydrationFailures` (initialized 0,
      surfaced through `/sagas/metrics` + health; no new Prometheus wiring in this slice).
- [x] 3.3 [GREEN] `SagaManagerExecution.ts`: the initial by-id load (`:606`
      `sagaInstance.findUnique`) runs inside a QUERY-scoped
      `withSystemContext(SAGA_SYSTEM_REASON, () => …)` — the wrap ends at the load, uniform
      on every trigger path including start. The `executeSaga` step loop + persists and the
      `compensateSagaSteps` body run under `runAsSagaTenant(instance, …)`. The `setImmediate`
      dispatches (`:29-37`) stay lexically OUTSIDE every wrap (C1 — ALS propagates through
      `setImmediate`).
- [x] 3.4 [GREEN] `SagaManagerLifecycle.ts` boot load (`:314`):
      `const rows = await withSystemContext(SAGA_SYSTEM_REASON, () => findMany(...))`; the
      deserialize/register for-loop and every re-warm persist run AFTER the wrap, the persist
      under `runAsSagaTenant`.
- [x] 3.5 [GREEN] `SagaManagerLifecycle.ts` retry scan (`:388`): `dueRows` fetched under the
      same query-scoped wrap; the dispatch loop (`:397-399`) runs outside it.
- [x] 3.6 [GREEN] `SagaManagerLifecycle.ts` timeout-checker `failSaga` (`:425`) and
      `shutdown` persist (`:290`) run under `runAsSagaTenant` (no dispatch on these paths).
- [x] 3.7 [GREEN] Admin `/sagas/:sagaId/continue` + `/compensate`: **NO route-level wrap**
      (C1 — `continueSaga`/`compensateSaga` dispatch at `Lifecycle:155`/`:190`). The engine
      methods wrap only their internals: `continueSaga` loads under the query-scoped system
      wrap; `compensateSaga` additionally persists `COMPENSATING` (`:188`) under
      `runAsSagaTenant`; both dispatch outside any wrap. (S3 — necessity, not scope creep:
      `adminAuthMiddleware` binds no tenant context, so post-D1 these loads would throw
      `TenantContextMissingError` without an engine-internal declared context.)
- [x] 3.8 [GREEN] Observability (W3a/W3b): KEEP the `:338` / `:404` catches (a scan failure
      must not kill boot or a tick) but make each log at ERROR with the failing loop name,
      the error type, and a per-run correlation id (`saga-recovery-${randomUUID()}`, minted
      once per boot pass / per tick) AND increment `bootLoadFailures` /
      `recoveryScanFailures`. Run VITEST 1.1 + 1.3 → GREEN except 1.3(d) (needs Phase 4).

## Phase 4: D1 — put the engine on the guarded client → turns 1.3(d) GREEN

- [x] 4.1 [GREEN] `apps/api/src/index.ts` (`:687`): construct `SagaIntegration` with
      `container.resolve<PrismaClient>(TOKENS.PrismaClient)` instead of the raw `prisma`
      imported at `:41` (container is configured at `:266` — ordering feasible). No type
      change needed: `setup.ts:63` already casts the extended client
      `as unknown as PrismaClient`. Leave `index.ts:641` `sagaEventService` on the raw
      singleton (it writes only the global `StoredEvent`; in-tx appends ride the engine's tx
      client). Do NOT resolve `TOKENS.SagaManager` (dead registration,
      `setupServices.ts:937-958` — a second EventService + Redis connection + duplicate
      scheduler taskIds).
- [x] 4.2 Verify the six `config.prisma` sites behave per the D1 table:
      `Execution:509` `$transaction`→`tx.sagaInstance.upsert` (intercepted; where + create
      injection), `Execution:546` `appendEventInTx` (global `StoredEvent` → guard early
      return), `Execution:606` `findUnique` (guarded — Phase 3.3 context),
      `Lifecycle:314` + `:388` `findMany` (guarded — Phase 3.4/3.5 context),
      `Lifecycle:251` `` $queryRaw`SELECT 1` `` (not a model op, extension-transparent;
      fitness **#23 unaffected** — the regex matches the `(` form, this is a backtick call),
      `SagaIntegration:200` (pass-through into `SagaManagerImpl`). Run VITEST 1.3 → GREEN.

## Phase 5: D4 — backfill migration [SENSITIVE — token]

- [x] 5.1 [RED] Create
      `apps/api/tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts`
      (node:test, real DB, raw SQL allowed in tests): seed the four disposition classes
      **including W1's NULL class** — (a) metadata-mappable, both `accountId = <CustomerUser.id>`
      AND `accountId IS NULL` (the falsy-`userId` spread at `Execution:523` persists NULL);
      (b) join-mappable via `CustomerUser.id → CustomerUser.accountId`
      (`schema.prisma:335-337`); (c) terminal unmappable → sentinel NULL + reported count,
      never deleted; (d) non-terminal unmappable (incl. NULL with no usable metadata) →
      `RAISE EXCEPTION` aborts with NO partial commit and surfaces the offending ids. Plus:
      idempotent re-run is a no-op, row count preserved, and the success query returns **0**
      rows whose `accountId` matches any `CustomerUser.id`. RED until 5.2.
- [x] 5.2 [SENSITIVE][GREEN] Author
      `infra/prisma/migrations/{ts}_backfill_saga_instance_account_id/migration.sql` —
      data-only, idempotent, re-runnable, in ONE transaction, in this order:
      (1) metadata-first (authoritative) `SET "accountId" = si.context->'metadata'->>'accountId'`
      where that value exists in `Account`, scoped
      `("accountId" IS NULL OR "accountId" NOT IN (SELECT id FROM "Account"))` (repairs
      userId-corrupted AND NULL rows alike); (2) join
      `SET "accountId" = cu."accountId" FROM "CustomerUser" cu WHERE si."accountId" = cu.id`,
      scoped `"accountId" IS NOT NULL AND "accountId" NOT IN (SELECT id FROM "Account")`
      (NULL naturally excluded); (3) terminal residuals
      (`COMPLETED|FAILED|COMPENSATED`, same `IS NOT NULL` scope) → `SET "accountId" = NULL` + `RAISE NOTICE` with the count (sentinel = NULL, no fake FK-looking value);
      (4) non-terminal residuals (`IS NULL OR NOT IN Account`) → `RAISE EXCEPTION` listing
      the ids. Header comment carries the cutover runbook line (old-code writes in the
      migrate-deploy→cutover gap re-corrupt at worst a handful of rows; the statements are
      idempotent — re-run manually; D3's fail-loud rehydration catches the rest).
- [x] 5.3 [SENSITIVE][GREEN] `down.sql`: documented **no-op by design** — restoring
      corrupted user ids is not a rollback goal; post-backfill values are true accountIds
      and stay correct even if the code reverts.
- [x] 5.4 DBUP + MIGRATE apply → clean; run INT 5.1 → GREEN, 0 cancelled. Verify the
      success criterion on the dev DB: zero rows whose `accountId` matches any
      `CustomerUser.id`; row count preserved.

## Phase 6: RED→GREEN — two-tenant saga isolation (MERGE-BLOCKING)

- [x] 6.1 [RED] Create `apps/api/tests/integration/sagaTenantIsolation.test.ts` (node:test,
      real DB, `@file`/`@description`/`@layer infrastructure`). Build the production shape
      in-test: own `SagaManagerImpl` on a guarded test client
      (`$extends(tenantGuardExtension)` + the real ALS provider), two accounts A and B, and a
      fixture that **asserts `customerUser.id !== account.id`** (spec static scenario — no
      proof may pass by accidental equality). Assert:
      (a) a started saga persists `accountId === A.id` and `!== customerUser.id`, no
      `TenantContextMismatchError`;
      (b) under A's context, listing returns ZERO of B's rows and the by-id read of B's saga
      resolves NOT_FOUND — never 403, never 500 — and no mutation of B's row is possible;
      **(W4 pin)** the by-id proof MUST NOT be satisfiable by the Redis fast path
      (`Execution:595-599` returns before the guarded read) — DELETE the `saga:{id}` key
      first, or assert through the guarded client directly rather than the manager;
      (c) a persist carrying account B under A's bound context raises
      `TenantContextMismatchError`, writes no row, and is visible in logs — including inside
      the `$transaction`;
      (d) both scans succeed with NO bound tenant and observe rows of BOTH accounts under
      the declared system context, raising no `TenantContextMissingError`;
      (e) **(W3c)** induced context failure: run one scan tick with its declared context
      removed by the harness → an ERROR log naming the loop + error type + correlation id is
      emitted AND the failure counter increments — the tick does NOT report as an empty
      successful scan.
- [x] 6.2 [GREEN] `apps/api/scripts/run-tests.sh`: add `tests/integration/sagaTenantIsolation.test.ts`
      and `tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts` to the
      DB-only `integration:tenant-isolation` batch (`:173-189`).
- [x] 6.3 Run the batch (DBUP first) → GREEN, 0 failed, 0 cancelled, 0 skipped.

## Phase 7R: 4R rework — operational layer (2026-08-05)

All four adversarial lenses returned MERGE-BLOCKING on the Phase 1–7 result. The tenant
scoping itself held; the operational layer around it was rebuilt. Design D3/D5 carry the
`AMENDED AT 4R REVIEW` blocks that authorize this phase.

- [x] 7R.1 `sagaTenant.ts` becomes the dual-layer module: `withSagaSystemRead` (awaits
      inside its own async callback, so the lazy-promise defect is structural, not a
      comment repeated at three call sites), `runSagaTenantTransaction` /
      `runSagaSystemTransaction` binding `setTenantGuc` as the transaction's first
      statement (RLS layer was unbound on every engine transaction).
- [x] 7R.2 Column-authoritative resolution: `SagaInstance.accountId` first, context then
      metadata as fallback AND cross-check; both deserializers carry the column (new
      `sagaInstanceRow.ts`, single definition); a column/context disagreement fails CLOSED
      before any write, which is the cutover-straggler signature.
- [x] 7R.3 `runAsSagaTenant` returns `{ran:true,value}|{ran:false,reason}`; every call site
      consumes it; a static invariant rejects a discarded result.
- [x] 7R.4 Terminal path: the timeout checker terminalizes an unresolvable/contradicted
      saga through `failSagaAsSystem` (the engine's one cross-tenant write, no dispatch
      inside); admin compensate answers 409 with the reason instead of a success envelope;
      `startSaga` fails closed (400) on an unresolvable or self-contradicting account.
- [x] 7R.5 Loops hardened: per-saga try/catch in the timeout checker and the shutdown
      drain with their own counters; by-id load distinguishes infrastructure failure from
      an absent row; the bootstrap's shutdown closure always reaches `app.close()`.
- [x] 7R.6 Observability made real: `saga_recovery_failures_total{stage}` and
      `sagas_failed_total{reason}` (the series the saga alert rules already query) via the
      repo's `getOrCreateCounter` pattern; `healthCheck()` reports `degraded` when the boot
      load failed; `captureError` on every engine catch path; `/sagas/metrics` recovery
      block gains a contract test.
- [x] 7R.7 Test corrections: static-suite anchor fixed to the method DECLARATION (it was
      scanning the caller's catch block), per-loop assertions, two new invariants;
      `createSagaContext` takes a parameter object; correlation-id factory; retry scan
      ordered by `nextRetryAt`; backfill audit scoped by the immutable `startedAt` with a
      non-empty-population guard; chaos fixture owns an account; new scenarios for
      mismatch, straggler terminalization, start fail-closed, per-iteration isolation,
      shutdown resilience and the metrics contract.
- [x] 7R.8 Docs corrected: `SagaInstance` HAS the RLS policy (leg 3) since
      `20260527000000` — the four documents claiming otherwise are fixed and the TRUE leg-1
      residual is stated with its consequence; legs defined inline once; runbook gains the
      P3009 recovery procedure, the READ COMMITTED race note, `SET LOCAL` timeouts for the
      manual re-run and the rollback blast radius; the "guard-audited reason" claim is
      replaced by what is true.
- [x] 7R.9 `sagaCustomerFlow` wired into `run-tests.sh` (own live-API batch,
      `TIMEOUT=180000`) with test 13's horizon raised to 90s. Pulled forward from 10.1/10.2
      because wiring a knowingly-red suite is not wiring. The live run (10.3) still needs
      a running API and stays pending.

## Phase 7R2: re-verification corrective pass (2026-08-05)

The re-run of the four lenses cleared R2, R4 and most of R1, and returned one new CRITICAL
plus three warnings against the reworked operational layer. This phase closes all of them.

- [x] 7R2.1 **[CRITICAL]** The backfill audit test now ESTABLISHES its audited population
      instead of assuming one. The window is `startedAt < finished_at` of the applied
      migration; on an ephemeral database the table is empty when the migration runs and
      every later row starts after it, so the window was empty and the `total > 0` guard
      could only ever fail there. The test seeds its own rows with an explicit `startedAt`
      backdated relative to the recorded `finished_at`, inside the existing rolled-back
      harness, covering both audited dispositions. Every assertion stays an equality over
      the WHOLE window, so a legacy database's own rows are audited alongside the seeded
      ones. Verified empirically: backdated rows fall inside the window, a row started after
      the migration does not.
- [x] 7R2.2 `continueSaga` consumes the rehydration outcome exactly as `compensateSaga`
      does — 409 with the skip reason instead of a 200 for a saga the engine will silently
      skip. The two admin endpoints are now symmetric.
- [x] 7R2.3 The customer start route's tenant scope is PINNED: `context.accountId` and
      `context.metadata.accountId` are both asserted, closing a coverage claim that had no
      assertion behind it.
- [x] 7R2.4 The repaired chaos suite is wired into `run-tests.sh` as its own DB-free
      `chaos` batch; the previous state left it gated by nothing.
- [x] 7R2.5 `withSagaSystemRead` binds BOTH layers: it opens its own transaction and binds
      the system sentinel first, because the boot load, retry scan and by-id load were
      single statements outside any transaction and would return ZERO rows with no error
      under a `NOBYPASSRLS` role. `runSagaSystemTransaction` is now module-PRIVATE, leaving
      `withSagaSystemRead` and `failSagaAsSystem` as the only exported cross-tenant surfaces.
- [x] 7R2.6 The static invariant classifies the matched operation instead of only requiring
      a boundary: a READ may be declared either way, a WRITE is satisfied ONLY by
      `runSagaTenantTransaction`, and a system wrap makes a write FAIL. Non-vacuous by
      construction — the classifier is exercised against synthetic controls in both
      directions. An export-surface invariant locks the privatization.
- [x] 7R2.7 `failSagaAsSystem` reaches parity with the ordinary terminal transition: the
      `SAGA_FAILED` event commits in the SAME transaction as the row and the saga's semantic
      locks are released. The containment docstring names the now-three bounded operations.
- [x] 7R2.8 The timeout checker RE-READS the row before terminalizing and refreshes instead
      of failing when a repair made it resolvable; `MULTI_TENANT_GUARDS.md` scopes the
      terminalization guarantee to sagas this process loaded and names the remedy for the
      rest.
- [x] 7R2.9 `prometheus/alerts/saga.yml` gains `SagaTenantMismatch` (any increase on
      `stage="mismatch"`) and `SagaRecoveryLoopFailing`; the recovery-failure series was
      previously exported and alerted on by nothing.
- [x] 7R2.10 The metric label `loop` is renamed `stage` (`SagaRecoveryStage`) — two of its
      six values are per-saga resolution outcomes, not loops. Renamed before deploy, when it
      is free.
- [x] 7R2.11 Documentation truth pass: both halves of the RLS binding stated precisely; the
      "every wrap callback must be `async`" bullet reworded so nobody restores the old call
      shape; the migration freeze rationale and role/session `lock_timeout` guidance for the
      automated deploy added to the runbook; the boot load's no-in-process-retry behavior
      recorded; design D3's stale "no new Prometheus wiring" line amended; the retracted
      "leg 3 (no RLS policy)" claim corrected in 7.1 above; the backfill test's five-hop
      path climb named `REPO_ROOT`.
- [x] 7R2.12 **Evidence, restated honestly.** The previously recorded "full API suite
      8210/8210" was the VITEST UNIT PHASE only (526 files) — the node:test batches are
      additional and were not part of that number. The "saga unit 183" figure did not
      reconcile as a single surface; the real breakdown is below. This pass re-ran only the
      files it touched plus their suites (LXC memory caps forbid a full local run), so the
      numbers below are exactly what was executed, nothing inferred:

### Re-verification pass — what was actually executed

| Surface                                                                                           | Command            | Result                                                |
| ------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| `tests/unit/saga/sagaTenant.test.ts`                                                              | VITEST single file | 29 passed (29)                                        |
| `tests/unit/saga/sagaContextInvariants.static.test.ts`                                            | VITEST single file | 25 passed (25)                                        |
| `tests/unit/saga/sagaPersistence.column.test.ts`                                                  | VITEST single file | 9 passed (9)                                          |
| `tests/unit/sagaIntegration.routes.test.ts`                                                       | VITEST single file | 13 passed (13)                                        |
| `tests/unit/sagaIntegration.monitoring.test.ts`                                                   | VITEST single file | 7 passed (7)                                          |
| `tests/unit/security/tenantContext.test.ts`                                                       | VITEST single file | 15 passed (15)                                        |
| saga unit surface (`tests/unit/saga` + `tests/unit/sagaIntegration*` + `tests/unit/sagaManager*`) | VITEST filter      | 16 files, 179 passed (179)                            |
| `tests/integration/sagaTenantIsolation.test.ts`                                                   | INT single file    | tests 18 · pass 18 · fail 0 · cancelled 0 · skipped 0 |
| `tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts`                        | INT single file    | tests 10 · pass 10 · fail 0 · cancelled 0 · skipped 0 |
| `tests/chaos/saga-step-retry-recovery.test.ts`                                                    | INT single file    | tests 1 · pass 1 · fail 0 · cancelled 0 · skipped 0   |
| `chaos` batch, invoked exactly as `run-tests.sh` defines it                                       | `run_batch`        | 1 tests · 1 pass · 0 fail · 0 cancel · 0 skip · [OK]  |
| `tsc -b apps/api`                                                                                 | —                  | exit 0                                                |
| `eslint --max-warnings 0` (10 changed `.ts`)                                                      | —                  | exit 0                                                |
| `prettier --check` (15 changed files)                                                             | —                  | All matched files use Prettier code style!            |
| fitness #3 / #4 / #5 / #8 / #9 / #10 / #21 / #23                                                  | —                  | 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0                         |

## Phase 7R3: re-verification residuals (2026-08-05)

Both re-verifications returned clean; four named residuals plus one operational
observation remained.

- [x] 7R3.1 The static classifier now matches BOTH client shapes. It had matched only
      `config.prisma.<model>.<op>`, of which real sources contain zero — every one of the
      six real operations had moved to the `(tx) => tx.<model>.<op>(…)` house idiom, so the
      real-source scan passed vacuously and R1's named hazard
      (`withSagaSystemRead(prisma, (tx) => tx.sagaInstance.update(…))` — a cross-tenant WRITE
      through the READ primitive) was invisible to all three invariants. The scan now
      collects transaction-client bindings (primitive callback parameters and
      `SagaTransactionClient` delegate parameters) and classifies by which primitive
      encloses the call: reads legal inside `withSagaSystemRead` or
      `runSagaTenantTransaction`, writes legal ONLY inside `runSagaTenantTransaction`, with
      exactly ONE named allowance for `failSagaAsSystem`'s own `tx.sagaInstance.update` —
      asserted to be the single system-scoped write, so a second one fails the suite.
      Non-vacuity is self-enforcing: the found operations are pinned as an exact set plus a
      minimum count, so pattern rot fails loudly instead of returning the scan to zero
      matches. Verified empirically by injecting the hazard into a real source and
      confirming three assertions go red at the exact file:line, then reverting.
- [x] 7R3.2 `terminalizeUnscopableSaga` passes the FRESH row to `failSagaAsSystem`, not the
      stale in-memory instance the re-read exists to distrust; the audit event's duration
      and step tallies now come from the state the database actually holds.
- [x] 7R3.3 `failSagaAsSystem` asserts its event-service collaborator instead of testing for
      it, matching the ordinary terminal path's reachability exactly. The anomalous
      transition can no longer be the only one that silently skips its audit event.
      `lockStore` keeps its warn-and-continue semantics, which are correct.
- [x] 7R3.4 The straggler isolation test cleans up its `stream:Saga:<id>` events, closing a
      one-stored-event-per-run leak the orphan test never had.
- [x] 7R3.5 **Operational residual, documented not closed.** `withSagaSystemRead` now opens
      an interactive transaction per read — `BEGIN` / `set_config` / query / `COMMIT`, four
      round trips where there was one, holding a pool connection for the span. This applies
      to the boot load, the 5s retry scan, and `loadSagaInstance` on EVERY Redis miss (the
      per-resume read path). `P2024` (pool timeout) and `P2028` (transaction API) are
      therefore reachable on paths where they were not, they land in
      `instanceLoadFailures` / `recoveryScanFailures` / `bootLoadFailures`, and a burst can
      trip `SagaRecoveryLoopFailing`. Recorded in `MULTI_TENANT_GUARDS.md` so those alerts
      are read as "the engine could not read", pool pressure included. Not closed: the
      alternative (unscoped single-statement reads) returns zero rows silently under a
      hardened `NOBYPASSRLS` role, which is strictly worse. Revisit with pool sizing if the
      alert fires under load.

### Residuals pass — what was actually executed

| Surface                                                | Command            | Result                                                |
| ------------------------------------------------------ | ------------------ | ----------------------------------------------------- |
| `tests/unit/saga/sagaContextInvariants.static.test.ts` | VITEST single file | 33 passed (33)                                        |
| `tests/unit/saga/sagaTenant.test.ts`                   | VITEST single file | 30 passed (30)                                        |
| saga unit surface (filter)                             | VITEST filter      | 16 files, 188 passed (188)                            |
| `tests/integration/sagaTenantIsolation.test.ts`        | INT single file    | tests 18 · pass 18 · fail 0 · cancelled 0 · skipped 0 |
| injected-hazard control (reverted)                     | VITEST single file | 3 failed / 30 passed — caught at the exact file:line  |
| stored-event leak, before / after                      | DB count           | 72 orphaned `stream:Saga:saga-iso-%` rows → 0         |
| `tsc -b apps/api`                                      | —                  | exit 0                                                |
| `eslint --max-warnings 0` (5 changed `.ts`)            | —                  | exit 0                                                |
| `prettier --check` (7 changed files)                   | —                  | All matched files use Prettier code style!            |

## Phase 7: Docs + spec sync + PR1 0-defect gate

- [x] 7.1 `docs/security/MULTI_TENANT_GUARDS.md` (W3d): record the saga posture (engine on
      the guarded client, `SAGA_SYSTEM_REASON` boundary, rehydrated per-saga tenant context)
      AND the residual gaps per multi-tenant-isolation Req 4 — `SagaInstance` leg 1 is the
      ONLY schema residual (nullable `accountId`, no `Account` relation,
      `schema.prisma:2058`; cannot flip non-null while NULL sentinel rows exist). Leg 3 is
      SATISFIED: the table has carried the `tenant_isolation` policy since
      `20260527000000_add_rls_tenant_isolation`; the earlier "no RLS policy" wording was
      retracted. Also record the Redis fast-path guard-blind read and the CQRSBus dedupe
      residual. File the tracked backlog item for completing enrollment — the gap SHALL NOT
      be presented as closed.
- [x] 7.2 Mirror the PR1 delta requirements into the living
      `openspec/specs/multi-tenant-isolation/spec.md` and
      `openspec/specs/tenant-context-boundaries/spec.md` (including the Phase-0.3 preamble
      correction and the C1/C2 amended wording).
- [x] 7.3 **0-defect gate (PR1)**: `tsc` (@apps/api, @shared/types, @infra/prisma build) = 0;
      `eslint --max-warnings 0` on touched files = 0; prettier clean; fitness
      **#3 / #8 / #9 / #10 / #21 / #23 = 0** (`index.ts` is an explicit #21 exemption; #23
      untouched — `Lifecycle:251` is the backtick form, migration SQL is not TS);
      `prisma validate` + `migrate status` up-to-date; `integration:tenant-isolation` batch
      green; affected unit set green, 0 cancelled.

---

# PR2 — Recovery

## Phase 8: RED — crash-replay + shutdown-orphan (MERGE-BLOCKING)

- [x] 8.1 [RED] Create `apps/api/tests/integration/sagaCrashRecovery.test.ts` (node:test,
      real DB + Redis + real BullMQ, `@file`/`@description`/`@layer infrastructure`).
      **Crash-replay (THE D5 gate)**: manager A runs a publish-now saga past the pivot;
      rewind the row to `currentStep = 2` and DELETE the `saga:{id}` Redis key
      (crash-before-persist state); a fresh-memory manager B `initialize()` → resumes →
      assert **exactly ONE** BullMQ job per `publish-${postId}-${channelId}` (jobId =
      dedupeKey, `SagaIntegration.ts:271`, `queue-adapter.ts:83`), a terminal state, and
      **(S1)** a single consistent `Post.status` outcome with no duplicate side effect —
      the OCC/`expectedVersion` re-application tolerance is verified EMPIRICALLY here, not
      assumed from the step's JSDoc (`saga.ts:762-763`). A tolerance failure is an
      apply-phase finding, never a silent pass.
- [x] 8.2 [RED] Same file, **(C3) shutdown-orphan scenario**: manager A schedules a retry
      (`nextRetryAt` set via `scheduleRetry`, `Execution:185`), then graceful `shutdown()`
      flips RUNNING→PENDING (`Lifecycle:288-290`) while the persist keeps `nextRetryAt`
      non-null (`Execution:539`); manager B boots → the widened checker claims the row →
      terminal within the retry envelope. RED until 9.2.
- [x] 8.3 [RED] Same file, **terminal safety**: rows in `COMPLETED` / `FAILED` /
      `COMPENSATED` before restart change neither status nor `updatedAt`, dispatch no
      command, and run no compensation; a saga interrupted at or past the pivot compensates
      NO pivot/post-pivot step on later terminal failure.
- [x] 8.4 [RED] Extend the Phase-1.3 static test: the dedupe key derives ONLY from `sagaId` + `stepId` (+ the compensation suffix), contains no `randomUUID()` / `Math.random()`,
      and evaluates identically in two processes; **and** no saga suite exists on disk
      without an explicit entry in `run-tests.sh` (spec static scenario).
- [x] 8.5 Run INT 8.1–8.3 (DBUP first) + VITEST 8.4 → expect RED (no resume pass exists;
      the checker's `where` is `status: "RUNNING"` only).

## Phase 9: D5 — boot resume + widened checker ownership → turns 8.1–8.3 GREEN

- [x] 9.1 [GREEN] `SagaManagerLifecycle.initialize()`: after `loadActiveSagas`, run ONE pass
      (never a repeating sweep, never a per-tick re-dispatch) calling `executeSagaAsync(id)`
      for every loaded PENDING/RUNNING instance with `nextRetryAt == null`. The dispatch
      loop sits OUTSIDE every `withSystemContext` wrap (C1). Terminal re-execution stays
      blocked by the existing guard (`Execution:60-72`).
- [x] 9.2 [GREEN] `SagaManagerLifecycle.ts:390` — widen the retry checker's predicate to
      `status: { in: ["RUNNING", "PENDING"] }, nextRetryAt: { lte: now, not: null }` (C3).
      Single-claim proof: the partition key is `nextRetryAt` nullability alone — the boot
      pass claims `IS NULL`, the checker claims `NOT NULL AND lte now`, intersection empty;
      `@@index([status, nextRetryAt])` serves the widened predicate. Coverage now closes all
      four non-terminal load classes: PENDING fresh (boot), RUNNING mid-step (boot), RUNNING
      retry-pending (checker), PENDING retry-pending post-shutdown (checker).
- [x] 9.3 [GREEN] Boot summary log: emit `{loaded, resumed, checkerOwned, skipped}` counts
      plus per-row skip reasons (`nextRetryAt-owned-by-checker`, `missing-accountId`, and
      `parked` if 9.4 lands) so an operator can tell "recovered nothing" from "never ran".
      **SUPERSEDED BY 9R.8** on two points: `missing-accountId` is now
      `unresolvable-account` (one name across the summary, the rehydration warnings and
      the failure reasons), and the summary carries `deferred` plus the two dispositions
      added by the rework (`definition-unregistered`, `row-failed`).
- [x] 9.4 **D5 gate fork — wire EXACTLY ONE path after the 8.1 verdict.** If 8.1 is GREEN
      (pivot replay absorbed, no second external side effect): ship auto-resume as 9.1.
      If 8.1 cannot be proven green: do NOT ship auto-resume — PARK pivot-interrupted rows
      (exclude them from the boot resume set, leave them non-terminal, log `PARKED` +
      increment a counter, flag for manual review) and RECORD the fallback decision in the
      apply notes and `docs/security/MULTI_TENANT_GUARDS.md`. Silent resume without the
      proof is not acceptable.
- [x] 9.5 Run INT 8.1–8.3 → GREEN, 0 cancelled.

## Phase 10: D6 — horizon recalibration + runner wiring

- [x] 10.1 [GREEN — landed in 7R.9] `apps/api/tests/integration/sagaCustomerFlow.test.ts` (`:563`): raise
      test 13's `waitForTerminal` horizon **30s → 90s** (W2). Justification to keep in the
      test comment as WHY, not history: the analytic worst case is the 35s retry envelope
      (`saga.ts:912-916`, 5+10+20) + up to 3×5s scan-tick latency + worker latency; the
      gate's empirical run measured 49.2s for test 3's identical flow, so 60s leaves ≈18%
      headroom while 90s holds ≥45%.
- [x] 10.2 [GREEN — landed in 7R.9] `apps/api/scripts/run-tests.sh`: add a new live-API batch under the
      `full-integration` tier (`:195-237`) running `tests/integration/sagaCustomerFlow.test.ts`
      with `CONCURRENCY=1 TIMEOUT=180000` (W2 wall-time: the file's worst case grows to
      ~110s+ — test 3 at 60s + test 13 at up to 90s + the short tests; the 30000 default
      would cancel them). Closes the N-CI-2 blind spot — the suite has never been listed.
- [x] 10.3 Run INT-LONG `tests/integration/sagaCustomerFlow.test.ts` with LIVE-API up →
      **13/13 GREEN**, 0 cancelled. The previously failing post-pivot assertion (saga stuck
      non-terminal past the horizon) must now pass with the terminal status PERSISTED to the
      DB row, not only believed in memory.
      **Evidence (run against the boot-resume engine):** 13/13 pass, 0 cancelled, suite
      wall 96.4s (TIMEOUT=180000 holds ≥46% headroom); the post-pivot no-compensation test
      completed in 49.6s inside the 90s horizon with the terminal status read back from the
      DB row. **Live-boot recipe (runbook):** the suite signs customer JWTs with the
      `.env`+`.env.test` pair (`.env.test` overrides `CUSTOMER_JWT_SECRET`), so the API MUST
      boot with the same pair (`set -a; source .env; source .env.test; set +a; pnpm dev:api`
      → port 3001 from `.env.test`) and the suite runs with `BASE_URL=http://localhost:3001`.
      A server booted with plain dev env rejects every suite token with
      `JsonWebTokenError: invalid signature` — the suite's "start with pnpm dev" hint
      predates the env split. Kill the server (verify port free) after the run.

## Phase 11: Docs + spec sync + PR2 0-defect gate

- [x] 11.0 **Residual #8 — remove the account-less persist fallback**
      (`SagaManagerExecution.persistSagaInstance`, the `else` branch that opened a bare
      `prisma.$transaction` when no account resolved). It was the LAST engine write binding
      neither isolation layer, and it was dead: every caller reaches the method through
      `runAsSagaTenant`, which returns without running on exactly the two resolutions that
      would reach it, and if it ever executed the Prisma guard would throw
      `TenantContextMissingError`. Replaced by an explicit typed refusal (`AppError.internal`,
      thrown before any transaction opens, mirroring the sibling `AppError.conflict` for the
      contradicted row); `writeSagaState`'s `accountId` parameter is no longer nullable and
      the column is written unconditionally. Pinned by two unit assertions (refusal writes
      nothing and binds no scope; the refusal is classified as an engine defect, not a client
      error) and by a new static invariant asserting the engine opens NO `$transaction`
      outside the two tenant primitives. Effect: "every engine write binds both layers" is a
      statement without an asterisk.
- [x] 11.1 `docs/security/MULTI_TENANT_GUARDS.md` + the backlog: record the recovery posture
      (single-pass boot resume, checker ownership partition) and the accepted residuals
      carried to change 2 (`saga-engine-terminal-hygiene`): `failSaga` missing
      `activeInstances.delete`, the timeout checker's absent terminal filter,
      `COMPENSATING` orphans not loaded (`Lifecycle:315` filter), the waiting≠failed step
      contract, the in-flight execution guard, and `handleEvent` amplification. Escalate the
      two open backlog items: CQRSBus has NO command-id dedupe (`CQRSBus.ts:91-111`) despite
      `ARCHITECTURE_CANON §Saga DedupeKey`, and the dead `TOKENS.SagaManager` registration
      (`setupServices.ts:937-958`).
- [x] 11.2 Mirror the `saga-crash-recovery` delta into a new living
      `openspec/specs/saga-crash-recovery/spec.md`. The living spec states the SHIPPED
      behavior: the delta's gated auto-resume requirement is recorded as GATED-AND-REFUSED
      (parking is the normative path for pivot-interrupted rows), with the revisit condition
      written as normative for the next change and tied to the evidence test that turns RED
      when the post-pivot tolerance finally holds.
- [x] 11.3 **0-defect gate (PR2)**: `tsc` (@apps/api, @shared/types) = 0;
      `eslint --max-warnings 0` on touched files = 0; prettier clean; fitness
      **#3 / #8 / #9 / #10 / #20 / #21 / #23 = 0**; no `.only` / `.skip` committed; no new
      `@ts-ignore` and no new `canon-exception` marker; the full LXC-safe regression set
      green with 0 failed and 0 cancelled; all CI workflows green.
      **Evidence:** `tsc -b apps/api` = 0, `tsc -b packages/shared` = 0, isolated `tsc` over
      the PR2 test files = 0; `eslint --max-warnings 0` over the 7 touched `.ts` files = 0;
      `prettier --check` over all 12 touched files = clean; fitness #3/#8/#9/#10/#20/#21/#23
      all 0; `.only`/`.skip` = 0; the three `@ts-ignore`/`canon-exception` matches in the
      diff are the WORDS inside this task text and the living spec's own requirement, not
      markers in code. Regression set, single-file per the LXC recipe:
      `sagaCrashRecovery` 9/9, `sagaTenantIsolation` 18/18, `sagaAccountIdBackfill` 10/10,
      `chaos/saga-step-retry-recovery` 1/1 (all `0 fail / 0 cancelled / 0 skipped`), saga
      unit set 16 files / 199 tests green, `sagaCustomerFlow` 13/13 from 10.3. Post-run leak
      check: 0 fixture rows, 0 recent saga rows, 0 `bull:*` keys. CI workflows are the
      orchestrator's gate after the push.

## Phase 9R: 4R rework — the recovery layer (2026-08-10)

Three of the four adversarial lenses returned MERGE-BLOCKING on PR2. The tenant-isolation
core was verified CLEAN by all four and is untouched; what failed was the recovery layer's
wiring and its operator contract. The design's `AMENDED AT 4R REVIEW (PR2)` block is
AUTHORITATIVE for the decisions below.

- [x] 9R.1 **[W1] Composition order.** `SagaIntegration.initialize()` registers the saga
      definitions BEFORE `sagaManager.initialize()`. Verified first that
      `registerSagaDefinitions()` has no dependency on an initialized manager (it is pure
      map population over config the constructor already holds), so no restructuring into
      phases was needed. Defence in depth in `resumeLoadedSagas`: a row whose definition
      is unregistered gets its OWN disposition (`definition-unregistered`), and a boot in
      which EVERY loaded row lands there counts a boot-load FAILURE and logs at ERROR —
      the wiring defect can never present as a fleet of ordinary parked sagas.
- [x] 9R.2 **[W2] Production-faithful harness + the missing happy path.**
      `sagaCrashRecovery.test.ts` now boots real `SagaIntegration` instances (real
      `CQRSBusImpl` with the real post handlers, real queue adapter, real repositories,
      real Fastify + subscriber). RED first, in production order: `resumed=0`, the
      inherited pre-pivot row still `RUNNING at step 0` after 20s. New happy path: seeded
      `RUNNING` / `nextRetryAt=null` / `currentStep < pivotStepIndex` / resolvable account
      → boot → `summary.resumed === 1` → COMPLETED with no operator action → exactly
      `["post.create", "post.update"]` for that saga id. The two fixed 1.5s sleeps are
      replaced by that canary's terminal state as a POSITIVE synchronization point. Every
      index derives from `definition.pivotStepIndex` / `steps.length`. The suite refuses
      to run when the table holds foreign non-terminal rows, naming them.
- [x] 9R.3 **[W3] Parked contract, canon-coherent.** Parked rows leave the ordinary
      timeout sweep; their window opens at PARKING (`SagaManagerLifecycle.parkedAt`) and
      lasts one full saga horizon, after which the checker terminalizes them as
      `parked-expired` (its own `SagaFailureReason`, its own error text, its own alert).
      Residuals #1 and #2 were PROMOTED into this change and their entries DELETED from
      the carried list: `failSaga` now goes through `stopTracking` like the completion and
      compensation paths, and `checkSagaTimeout` refuses to re-visit a terminal row —
      without both, an expired parked row was re-failed and re-audited every 60s forever.
      Alert, runbook and spec state the REAL contract, including that a restart re-derives
      the parking and re-opens the window.
- [x] 9R.4 **[W4] Checker pivot claim — ADJUDICATED EMPIRICALLY, closed as
      guarded-by-countermeasure.** Test: an inherited pivot-step retry sitting on the
      pivot index, with a due `nextRetryAt` and its retry budget spent, whose post has
      already left `DRAFT`. Measured: the pivot's `RereadCheck` aborts BEFORE
      `step.execute()`, so the saga settles `FAILED` with the reread refusal naming
      `PUBLISHED` where `DRAFT` was expected, the queue holds exactly the jobs it held
      before, and no worker publishes
      again. The guarantee is STRONGER than the job-id absorber because it is upstream of
      the enqueue and therefore retention-independent, so the checker does NOT need to
      park inherited pivot rows and the `nextRetryAt` partition stands. Pinned by the
      integration test plus a static invariant that the composition still passes the
      reread implementation (the countermeasure exists only when it does).
- [x] 9R.5 **[W5] Bounded, contained boot.** Per-row `try/catch` in the pass (counted as
      `stage="resume-row"`, logged with the saga id) plus a pass-level `try/catch` so no
      synchronous throw can reject `initialize()`. `maxConcurrentSagas` is now REAL — it
      caps how many inherited sagas advance at once, which required an awaitable
      `executeSaga` on the execution port. `loadActiveSagas` gained `bootLoadLimit`
      (default 500), oldest-first, with the deferred count measured in the SAME
      transaction as the page. Re-warm moved out of the load and into the pass, skipping
      parked rows — which makes "nothing written to it" true and lets the suite assert it
      on `updatedAt`.
- [x] 9R.6 **[W6] Ownership honesty.** No claims machinery in this change. The per-process
      scope is stated as a DEPLOYMENT CONSTRAINT — more than one API replica with the saga
      engine enabled is unsupported until row claims land — in the living spec, the delta,
      `MULTI_TENANT_GUARDS.md` and a new backlog entry **SMELL-73** with the
      `OutboxClaimService` (`FOR UPDATE … SKIP LOCKED`) pointer.
- [x] 9R.7 **[W7] Gate integrity.** `run-tests.sh` fails the run on `TOTAL_CANCEL > 0` and
      captures the runner's exit code instead of discarding it; a cancelled or non-zero
      batch is marked FAILED and its output dumped. Reproduced against R3's scenario: the
      `integration:saga-recovery` batch with a dead `DATABASE_URL` reports
      `15 tests / 0 pass / 0 fail / 15 cancelled` and now exits 1 with the batch named —
      the same tallies exited 0 and printed OK before.
- [x] 9R.8 **[W8] Vocabulary + observability truth.** `parked` keeps one meaning; the
      shutdown drain HANDS OFF (code, logs, tests, docs, spec). New
      `saga_recovery_parked_total{reason}` replaces the old parked stage on the failures
      series; `SagaParkedAtPivot` moves to it with deploy-window dedup
      (`for: 15m`) and a new `SagaParkedWindowExpired` covers the terminal side. The
      runbook gained the unpark/terminalize procedure and the SQL that enumerates
      CANDIDATE parked rows (parking is not persisted). `/sagas/metrics` carries the
      parked, deferred and per-row-failure counters. One log line per disposition, with
      `tenant-mismatch` given its own sentence and runbook pointer, and one name —
      `unresolvable-account` — across summary, warnings and failure reasons. The stale
      `writeSagaState` JSDoc ("account-less paths") is corrected, the pre-replay assertion
      messages and `beforeReplay` fixtures are gone with the scenario split, manager
      fixtures carry role names, the parking branch carries its `see` line and a revisit
      trigger narrowed to the exact FAILED→COMPLETED transition, and the live-boot recipe
      moved to `docs/development/saga-test-suites.md` with a pointer left behind. The SLO
      doc gained the two SLIs its `#saga` anchor was being cited for.
- [x] 9R.9 **[W9] Spec + design sync.** Living spec states the SHIPPED contract
      (composition order normative, happy path covered, parked lifecycle, per-process
      ownership + constraint, cancel gate); the delta carries its own amendment block for
      this rework; `design.md` D5 carries the nine-decision amendment; the Unit-2
      rollback boundary is corrected (the horizon bump landed in PR1; the persist-fallback
      removal IS part of PR2's revert surface).
- [x] 9R.10 **Rework gate.** RED evidence captured for every behavioural fix before its
      GREEN, in the production-faithful harness, failing for the named mechanism.

## Phase 9R2: 4R re-verification — advisory closures (2026-08-10)

All four lenses re-verified the 9R rework and returned nothing merge-blocking (R1
advisory-clear, R2 PASS, R3 PASS, R4 advisory). This phase closes the convergent
advisories before push.

- [x] 9R2.1 **[M1] `bootLoadDeferred` is alertable.** New Prometheus GAUGE
      `saga_recovery_deferred_rows` (a level each process re-measures at boot — a counter
      would sum the same backlog once per restart), emitted where the ceiling defers, with
      the `SagaBootLoadDeferred` alert and an SLO row. The `/sagas/metrics` exact-set pin
      was updated with it.
- [x] 9R2.2 **[M2] COMPENSATING orphans are DETECTED.** The boot counts them inside the
      SAME declared read boundary as the load — never loading, tracking or dispatching
      them — and publishes the count in `SagaMetrics.compensatingOrphans`, on
      `/sagas/metrics`, as the gauge `saga_compensating_orphans` and as a boot WARN, with
      the `SagaCompensatingOrphans` alert. Detection only, said so in the code, the alert,
      the guards doc and the living spec: resuming a compensation walk without a row claim
      is a second walk over steps a dead process may already have applied. The FIX stays
      with `saga-engine-terminal-hygiene`.
- [x] 9R2.3 **[M3] The single-replica constraint is in the process's own output.** One
      INFO line per boot naming per-process ownership, `multiReplicaSupported: false` and
      SMELL-73.
- [x] 9R2.4 **[M4] `stopTracking` releases the parked window.** A stale `parkedAt` entry
      outlived the row it described, so a saga an operator resumed by hand could later be
      terminalized as `parked-expired` while actively retrying. `continueSaga` also
      releases it explicitly — that endpoint IS the unpark — and logs the release. Pinned
      by a unit test.
- [x] 9R2.5 **[M5] The last drain-sense "parks".** The retry-checker predicate comment now
      says the graceful shutdown HANDS OFF a retry-pending saga. No drain-sense use of the
      word survives in the repo.
- [x] 9R2.6 **[M6] Docs honesty.** (a) The eviction boundary no longer claims to be
      "measured": the RETAINED case is measured, the eviction side is read from the
      consumer config and labelled as such. (b) SMELL-73 gained the retry-scan
      head-of-line starvation (`take: 50` + `nextRetryAt` cleared only after success ⇒ the
      same oldest page re-selected every tick, rows 51+ starved) and the
      take:50-vs-boot-ceiling asymmetry, both also stated in the guards doc. (c) The
      successor carry-list now names the parked-window-does-not-survive-restart edge, so a
      crash-looping pod re-opening the window indefinitely is owned, not folklore.
- [x] 9R2.7 **[M7] Pivot re-entry residual — ADJUDICATED and stated honestly.** The only
      production code that promotes a post out of `DRAFT` is the inbound provider webhook
      processors (`apps/api/src/webhooks/processors/*WebhookProcessor.ts`, each writing
      `status: "PUBLISHED"`). Neither the saga nor the publish worker ever writes that
      column: `UpdatePostCommandHandler` explicitly IGNORES `data.status`, and
      `PostAggregate.markAsPublished` has NO production caller. So the RereadCheck's
      retention-independence holds ONLY once a webhook has arrived; in the still-`DRAFT`
      window the countermeasure passes and the retention-bounded job id is the whole
      protection. A new integration scenario proves the re-entry really happens there (the
      saga walks past the pivot and dies on the post-pivot OCC token, not on a reread
      refusal) and that the retained job id absorbs it. The guards doc states both windows
      and cites the promoting path precisely.
- [x] 9R2.8 **[M8] Static-suite and harness nits.** The `>= 2` transaction-opener floor is
      named and explained; the duplicated command-id literal carries its multiplicity
      rationale (two steps mint a forward id from the same expression); the describe title
      no longer contradicts its first `it`; `ProcessedJob.jobId` is now load-bearing (the
      DRAFT-window scenario asserts every recorded execution carries the one original job
      id, so a second publish shows up as a second id rather than as a count).
