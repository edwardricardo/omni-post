# Tasks: Saga Tenant Scope and Recovery (N-COR-7 + N-COR-2a)

> Strict-TDD, dependency-ordered. RED precedes each GREEN. Two chained PRs on the design's
> D7 seam: **PR1 = scope** (D1 guarded-client wiring + D2 column truth + D3 context
> declaration + D4 backfill + two-tenant/column proofs — recovery behavior stays
> byte-equivalent to today); **PR2 = recovery** (D5 boot resume + C3 widened checker + D6
> horizon + crash-replay proof + runner wiring). Branch
> `workstream/saga-tenant-scope-and-recovery`.
>
> **The design's `AMENDED AT GATE` blocks (C1, C2, C3, S1, S3, W1–W4) are AUTHORITATIVE**
> over any conflicting original prose. Hard invariant threaded through every task below
> (C1): a `withSystemContext` callback SHALL NEVER lexically enclose an
> `executeSagaAsync` / `compensateSagaAsync` dispatch — system wraps are QUERY-scoped,
> per-saga work runs under rehydrated `withTenantContext`.

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

| Unit | Goal                                                                                                                                                                                | Likely PR | Focused test command                                                                                     | Runtime harness                                                                                                                                                                                                | Rollback boundary                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Column truth + declared context + guarded client: every saga write carries the TRUE account and is guard-validated; scans alive under query-scoped system context; history repaired | PR 1      | VITEST `tests/unit/saga/`; INT `tests/integration/sagaTenantIsolation.test.ts`                           | DBUP + two-tenant real-DB run (A cannot read/load/mutate B's saga through the guarded client; scans see both accounts; induced context failure logs + counts)                                                  | revert branch pre-merge; post-merge revert re-points `index.ts:687` to the raw singleton (backfilled values stay valid); migration `down.sql` is a documented no-op by design |
| 2    | Recovery: single-pass boot resume disjoint from the widened retry checker, crash-replay dedupe proven, post-pivot failures terminal within the horizon, suites wired                | PR 2      | INT `tests/integration/sagaCrashRecovery.test.ts`; INT-LONG `tests/integration/sagaCustomerFlow.test.ts` | DBUP + Redis + real BullMQ two-manager harness (manager A past pivot → rewind → manager B `initialize()` → exactly one job per `publish-${postId}-${channelId}`, one consistent `Post.status`, terminal state) | revert removes the resume pass, the checker predicate widening, the horizon bump and the runner batch — PR1's scope/wiring untouched                                          |

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

- [ ] 1.1 [RED] `apps/api/tests/unit/saga/sagaTenant.test.ts` (new, `@file`/`@description`/
      `@layer infrastructure`): `resolveSagaAccountId` matrix — `context.accountId` wins →
      valid-string `context.metadata.accountId` fallback → `null` when neither (never
      `userId`, never `""`); `runAsSagaTenant` runs `fn` inside `withTenantContext({accountId})`
      on hit, and on miss logs ERROR + increments `rehydrationFailures` + SKIPS `fn`
      (fail-loud, never a system-context fallback). RED until 3.1.
- [ ] 1.2 [RED] `apps/api/tests/unit/saga/sagaPersistence.column.test.ts` (new): prisma spy
      over `persistSagaInstance` — BOTH upsert branches (`Execution:523` create,
      `:537` update) write `resolveSagaAccountId(context)`; assert the written value equals
      the account and `!== context.userId`; assert the key is OMITTED (not `undefined`,
      `exactOptionalPropertyTypes`) when the resolver returns null. Add the guard-shape
      assertion: `sagaInstance.upsert` `where` carries `{id, accountId}` after injection
      (`tenantGuard.ts:208-242`), exercised through `tenantGuardCheck` as a pure fn.
- [ ] 1.3 [RED] **[MERGE-BLOCKING]** `apps/api/tests/unit/saga/sagaContextInvariants.static.test.ts`
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
- [ ] 1.4 Run VITEST on 1.1–1.3 → expect RED for the right reasons (module `sagaTenant.ts`
      absent; column writes `userId`; zero `withSystemContext` in `apps/api/src/saga/**`).

## Phase 2: D2 — column truth threaded end to end → turns 1.2 GREEN

- [ ] 2.1 [GREEN] `packages/shared/src/saga.ts` (`:46-53`): `SagaContext` gains
      `accountId?: string`; `createSagaContext` (`:981`) gains a 5th optional `accountId`
      param. Keep `userId` (audit trail, event payloads, and the route ownership check
      `SagaIntegration.ts:486` stay keyed on it).
- [ ] 2.2 [GREEN] `apps/api/src/saga/SagaIntegration.ts` (`:436-443`): pass
      `customer.accountId` first-class AND **keep** `metadata.accountId` — the pivot's
      fail-closed check (`saga.ts:617-624`) reads metadata; that contract is untouched.
- [ ] 2.3 [GREEN] `apps/api/src/saga/SagaManagerLifecycle.ts` `startSaga` (`:90-95`): thread
      `contextData.accountId` into the constructed context (today unknown fields are
      silently DROPPED — verified).
- [ ] 2.4 [GREEN] `apps/api/src/saga/SagaManagerExecution.ts` (`:523`, `:537`): both upsert
      branches write `accountId: resolveSagaAccountId(context)`; **never `context.userId`**.
      Run VITEST 1.2 → GREEN.

## Phase 3: D3 — helper + context declaration (C1/C2/S3) → turns 1.1 GREEN

- [ ] 3.1 [GREEN] Create `apps/api/src/saga/sagaTenant.ts` (`@file`/`@description`/
      `@layer infrastructure`): `export const SAGA_SYSTEM_REASON = "system:saga-recovery" as const`
      (the ONLY reason the engine may use — spec fixed set), `resolveSagaAccountId(context)`,
      `runAsSagaTenant(instance, fn)` → `withTenantContext({accountId}, fn)` with fail-loud
      miss handling. No `any`; `Result`-free (infrastructure helper, throws stay inside).
- [ ] 3.2 [GREEN] `apps/api/src/saga/sagaManagerTypes.ts`: `SagaMetrics` gains
      `bootLoadFailures`, `recoveryScanFailures`, `rehydrationFailures` (initialized 0,
      surfaced through `/sagas/metrics` + health; no new Prometheus wiring in this slice).
- [ ] 3.3 [GREEN] `SagaManagerExecution.ts`: the initial by-id load (`:606`
      `sagaInstance.findUnique`) runs inside a QUERY-scoped
      `withSystemContext(SAGA_SYSTEM_REASON, () => …)` — the wrap ends at the load, uniform
      on every trigger path including start. The `executeSaga` step loop + persists and the
      `compensateSagaSteps` body run under `runAsSagaTenant(instance, …)`. The `setImmediate`
      dispatches (`:29-37`) stay lexically OUTSIDE every wrap (C1 — ALS propagates through
      `setImmediate`).
- [ ] 3.4 [GREEN] `SagaManagerLifecycle.ts` boot load (`:314`):
      `const rows = await withSystemContext(SAGA_SYSTEM_REASON, () => findMany(...))`; the
      deserialize/register for-loop and every re-warm persist run AFTER the wrap, the persist
      under `runAsSagaTenant`.
- [ ] 3.5 [GREEN] `SagaManagerLifecycle.ts` retry scan (`:388`): `dueRows` fetched under the
      same query-scoped wrap; the dispatch loop (`:397-399`) runs outside it.
- [ ] 3.6 [GREEN] `SagaManagerLifecycle.ts` timeout-checker `failSaga` (`:425`) and
      `shutdown` persist (`:290`) run under `runAsSagaTenant` (no dispatch on these paths).
- [ ] 3.7 [GREEN] Admin `/sagas/:sagaId/continue` + `/compensate`: **NO route-level wrap**
      (C1 — `continueSaga`/`compensateSaga` dispatch at `Lifecycle:155`/`:190`). The engine
      methods wrap only their internals: `continueSaga` loads under the query-scoped system
      wrap; `compensateSaga` additionally persists `COMPENSATING` (`:188`) under
      `runAsSagaTenant`; both dispatch outside any wrap. (S3 — necessity, not scope creep:
      `adminAuthMiddleware` binds no tenant context, so post-D1 these loads would throw
      `TenantContextMissingError` without an engine-internal declared context.)
- [ ] 3.8 [GREEN] Observability (W3a/W3b): KEEP the `:338` / `:404` catches (a scan failure
      must not kill boot or a tick) but make each log at ERROR with the failing loop name,
      the error type, and a per-run correlation id (`saga-recovery-${randomUUID()}`, minted
      once per boot pass / per tick) AND increment `bootLoadFailures` /
      `recoveryScanFailures`. Run VITEST 1.1 + 1.3 → GREEN except 1.3(d) (needs Phase 4).

## Phase 4: D1 — put the engine on the guarded client → turns 1.3(d) GREEN

- [ ] 4.1 [GREEN] `apps/api/src/index.ts` (`:687`): construct `SagaIntegration` with
      `container.resolve<PrismaClient>(TOKENS.PrismaClient)` instead of the raw `prisma`
      imported at `:41` (container is configured at `:266` — ordering feasible). No type
      change needed: `setup.ts:63` already casts the extended client
      `as unknown as PrismaClient`. Leave `index.ts:641` `sagaEventService` on the raw
      singleton (it writes only the global `StoredEvent`; in-tx appends ride the engine's tx
      client). Do NOT resolve `TOKENS.SagaManager` (dead registration,
      `setupServices.ts:937-958` — a second EventService + Redis connection + duplicate
      scheduler taskIds).
- [ ] 4.2 Verify the six `config.prisma` sites behave per the D1 table:
      `Execution:509` `$transaction`→`tx.sagaInstance.upsert` (intercepted; where + create
      injection), `Execution:546` `appendEventInTx` (global `StoredEvent` → guard early
      return), `Execution:606` `findUnique` (guarded — Phase 3.3 context),
      `Lifecycle:314` + `:388` `findMany` (guarded — Phase 3.4/3.5 context),
      `Lifecycle:251` `` $queryRaw`SELECT 1` `` (not a model op, extension-transparent;
      fitness **#23 unaffected** — the regex matches the `(` form, this is a backtick call),
      `SagaIntegration:200` (pass-through into `SagaManagerImpl`). Run VITEST 1.3 → GREEN.

## Phase 5: D4 — backfill migration [SENSITIVE — token]

- [ ] 5.1 [RED] Create
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
- [ ] 5.2 [SENSITIVE][GREEN] Author
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
- [ ] 5.3 [SENSITIVE][GREEN] `down.sql`: documented **no-op by design** — restoring
      corrupted user ids is not a rollback goal; post-backfill values are true accountIds
      and stay correct even if the code reverts.
- [ ] 5.4 DBUP + MIGRATE apply → clean; run INT 5.1 → GREEN, 0 cancelled. Verify the
      success criterion on the dev DB: zero rows whose `accountId` matches any
      `CustomerUser.id`; row count preserved.

## Phase 6: RED→GREEN — two-tenant saga isolation (MERGE-BLOCKING)

- [ ] 6.1 [RED] Create `apps/api/tests/integration/sagaTenantIsolation.test.ts` (node:test,
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
- [ ] 6.2 [GREEN] `apps/api/scripts/run-tests.sh`: add `tests/integration/sagaTenantIsolation.test.ts`
      and `tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts` to the
      DB-only `integration:tenant-isolation` batch (`:173-189`).
- [ ] 6.3 Run the batch (DBUP first) → GREEN, 0 failed, 0 cancelled, 0 skipped.

## Phase 7: Docs + spec sync + PR1 0-defect gate

- [ ] 7.1 `docs/security/MULTI_TENANT_GUARDS.md` (W3d): record the saga posture (engine on
      the guarded client, `SAGA_SYSTEM_REASON` boundary, rehydrated per-saga tenant context)
      AND the residual gaps per multi-tenant-isolation Req 4 — `SagaInstance` leg 1
      (nullable `accountId`, no `Account` relation, `schema.prisma:2058`; cannot flip
      non-null while NULL sentinel rows exist) and leg 3 (no RLS policy), the Redis
      fast-path guard-blind read, and the CQRSBus dedupe residual. File the tracked backlog
      item for completing enrollment — the gap SHALL NOT be presented as closed.
- [ ] 7.2 Mirror the PR1 delta requirements into the living
      `openspec/specs/multi-tenant-isolation/spec.md` and
      `openspec/specs/tenant-context-boundaries/spec.md` (including the Phase-0.3 preamble
      correction and the C1/C2 amended wording).
- [ ] 7.3 **0-defect gate (PR1)**: `tsc` (@apps/api, @shared/types, @infra/prisma build) = 0;
      `eslint --max-warnings 0` on touched files = 0; prettier clean; fitness
      **#3 / #8 / #9 / #10 / #21 / #23 = 0** (`index.ts` is an explicit #21 exemption; #23
      untouched — `Lifecycle:251` is the backtick form, migration SQL is not TS);
      `prisma validate` + `migrate status` up-to-date; `integration:tenant-isolation` batch
      green; affected unit set green, 0 cancelled.

---

# PR2 — Recovery

## Phase 8: RED — crash-replay + shutdown-orphan (MERGE-BLOCKING)

- [ ] 8.1 [RED] Create `apps/api/tests/integration/sagaCrashRecovery.test.ts` (node:test,
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
- [ ] 8.2 [RED] Same file, **(C3) shutdown-orphan scenario**: manager A schedules a retry
      (`nextRetryAt` set via `scheduleRetry`, `Execution:185`), then graceful `shutdown()`
      flips RUNNING→PENDING (`Lifecycle:288-290`) while the persist keeps `nextRetryAt`
      non-null (`Execution:539`); manager B boots → the widened checker claims the row →
      terminal within the retry envelope. RED until 9.2.
- [ ] 8.3 [RED] Same file, **terminal safety**: rows in `COMPLETED` / `FAILED` /
      `COMPENSATED` before restart change neither status nor `updatedAt`, dispatch no
      command, and run no compensation; a saga interrupted at or past the pivot compensates
      NO pivot/post-pivot step on later terminal failure.
- [ ] 8.4 [RED] Extend the Phase-1.3 static test: the dedupe key derives ONLY from `sagaId` + `stepId` (+ the compensation suffix), contains no `randomUUID()` / `Math.random()`,
      and evaluates identically in two processes; **and** no saga suite exists on disk
      without an explicit entry in `run-tests.sh` (spec static scenario).
- [ ] 8.5 Run INT 8.1–8.3 (DBUP first) + VITEST 8.4 → expect RED (no resume pass exists;
      the checker's `where` is `status: "RUNNING"` only).

## Phase 9: D5 — boot resume + widened checker ownership → turns 8.1–8.3 GREEN

- [ ] 9.1 [GREEN] `SagaManagerLifecycle.initialize()`: after `loadActiveSagas`, run ONE pass
      (never a repeating sweep, never a per-tick re-dispatch) calling `executeSagaAsync(id)`
      for every loaded PENDING/RUNNING instance with `nextRetryAt == null`. The dispatch
      loop sits OUTSIDE every `withSystemContext` wrap (C1). Terminal re-execution stays
      blocked by the existing guard (`Execution:60-72`).
- [ ] 9.2 [GREEN] `SagaManagerLifecycle.ts:390` — widen the retry checker's predicate to
      `status: { in: ["RUNNING", "PENDING"] }, nextRetryAt: { lte: now, not: null }` (C3).
      Single-claim proof: the partition key is `nextRetryAt` nullability alone — the boot
      pass claims `IS NULL`, the checker claims `NOT NULL AND lte now`, intersection empty;
      `@@index([status, nextRetryAt])` serves the widened predicate. Coverage now closes all
      four non-terminal load classes: PENDING fresh (boot), RUNNING mid-step (boot), RUNNING
      retry-pending (checker), PENDING retry-pending post-shutdown (checker).
- [ ] 9.3 [GREEN] Boot summary log: emit `{loaded, resumed, checkerOwned, skipped}` counts
      plus per-row skip reasons (`nextRetryAt-owned-by-checker`, `missing-accountId`, and
      `parked` if 9.4 lands) so an operator can tell "recovered nothing" from "never ran".
- [ ] 9.4 **D5 gate fork — wire EXACTLY ONE path after the 8.1 verdict.** If 8.1 is GREEN
      (pivot replay absorbed, no second external side effect): ship auto-resume as 9.1.
      If 8.1 cannot be proven green: do NOT ship auto-resume — PARK pivot-interrupted rows
      (exclude them from the boot resume set, leave them non-terminal, log `PARKED` +
      increment a counter, flag for manual review) and RECORD the fallback decision in the
      apply notes and `docs/security/MULTI_TENANT_GUARDS.md`. Silent resume without the
      proof is not acceptable.
- [ ] 9.5 Run INT 8.1–8.3 → GREEN, 0 cancelled.

## Phase 10: D6 — horizon recalibration + runner wiring

- [ ] 10.1 [GREEN] `apps/api/tests/integration/sagaCustomerFlow.test.ts` (`:563`): raise
      test 13's `waitForTerminal` horizon **30s → 90s** (W2). Justification to keep in the
      test comment as WHY, not history: the analytic worst case is the 35s retry envelope
      (`saga.ts:912-916`, 5+10+20) + up to 3×5s scan-tick latency + worker latency; the
      gate's empirical run measured 49.2s for test 3's identical flow, so 60s leaves ≈18%
      headroom while 90s holds ≥45%.
- [ ] 10.2 [GREEN] `apps/api/scripts/run-tests.sh`: add a new live-API batch under the
      `full-integration` tier (`:195-237`) running `tests/integration/sagaCustomerFlow.test.ts`
      with `CONCURRENCY=1 TIMEOUT=180000` (W2 wall-time: the file's worst case grows to
      ~110s+ — test 3 at 60s + test 13 at up to 90s + the short tests; the 30000 default
      would cancel them). Closes the N-CI-2 blind spot — the suite has never been listed.
- [ ] 10.3 Run INT-LONG `tests/integration/sagaCustomerFlow.test.ts` with LIVE-API up →
      **13/13 GREEN**, 0 cancelled. The previously failing post-pivot assertion (saga stuck
      non-terminal past the horizon) must now pass with the terminal status PERSISTED to the
      DB row, not only believed in memory.

## Phase 11: Docs + spec sync + PR2 0-defect gate

- [ ] 11.1 `docs/security/MULTI_TENANT_GUARDS.md` + the backlog: record the recovery posture
      (single-pass boot resume, checker ownership partition) and the accepted residuals
      carried to change 2 (`saga-engine-terminal-hygiene`): `failSaga` missing
      `activeInstances.delete`, the timeout checker's absent terminal filter,
      `COMPENSATING` orphans not loaded (`Lifecycle:315` filter), the waiting≠failed step
      contract, the in-flight execution guard, and `handleEvent` amplification. Escalate the
      two open backlog items: CQRSBus has NO command-id dedupe (`CQRSBus.ts:91-111`) despite
      `ARCHITECTURE_CANON §Saga DedupeKey`, and the dead `TOKENS.SagaManager` registration
      (`setupServices.ts:937-958`).
- [ ] 11.2 Mirror the `saga-crash-recovery` delta into a new living
      `openspec/specs/saga-crash-recovery/spec.md`.
- [ ] 11.3 **0-defect gate (PR2)**: `tsc` (@apps/api, @shared/types) = 0;
      `eslint --max-warnings 0` on touched files = 0; prettier clean; fitness
      **#3 / #8 / #9 / #10 / #20 / #21 / #23 = 0**; no `.only` / `.skip` committed; no new
      `@ts-ignore` and no new `canon-exception` marker; the full LXC-safe regression set
      green with 0 failed and 0 cancelled; all CI workflows green.
