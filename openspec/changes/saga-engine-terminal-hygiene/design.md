# Design: Saga Engine Terminal Hygiene (N-COR-2c + compensation integrity + SMELL-73)

## Technical Approach

Make the truth durable first, then hand out ownership of it. S0 makes the proof surface honest (gate aggregation + dead-token deletion). S1 REBUILDS the compensation walk as a durable, resumable, status-honest state machine using the columns the row already has. S2 REBUILDS `SagaStepResult` as a three-state discriminated union and closes the event amplification with a budget exemption plus an in-process in-flight guard. S3 adds lease-based row claims at selection time in both recovery readers (SQL shape from `OutboxClaimService`, wrapped in the saga system boundary), wires `bootLoadLimit` + scan page size. S4 makes the parked operator window durable in a sibling table, preserving the saga row's byte-identity promise. Fixed constraints honored: slicing/order approved verbatim; walk and step-result are rebuilds; `sagaTenant.ts` extended, never modified; CQRSBus out of scope; multi-replica downgrades to at-least-once; claim columns additive/nullable; `SagaParkedWindow` is option C.

## Empirical Evidence — probes P1 / P2

**Status: authored + line-traced, NOT executed.** This design executor ran without a shell tool, so the mandated probes could not be run here. Both probe scripts are carried verbatim in Appendix A/B and are designated the **first RED step of slices 2 and 1 respectively** (strict TDD makes them the failing tests anyway). Spec assertions that depend on exact arithmetic MUST NOT freeze until they run. The traces below are branch-by-branch, file:line-cited; two findings REFINE the exploration.

> **AMENDED AT GATE (2026-08-11) — M2 + probe adjudication.** **P1 WAS EXECUTED at the
> fresh-context gate** (corrected fixture, real engine, in-memory doubles, zero timers) and
> the arithmetic is **CONFIRMED, not refuted**:
>
> ```
> B0  rc=1 step=3 wait   nextRetryAt +4969ms    (initial, pending=4)
> J1  rc=2 step=3 wait   nextRetryAt +9970ms    (pending 3)
> J2  rc=3 step=3 wait   nextRetryAt +19970ms   (pending 2)
> J3  status=FAILED rc=3  err="Publishing jobs still in progress"  (pending 1)
> J4  status=FAILED       (all 4 channels published)
> waitCallsSeq = [4,3,2,1]
> ```
>
> `1 + (N−1)` burns; N ≥ 4 ⇒ deterministic FAILED on sibling events alone with every channel
> published. The original probe run stalled for a FIXTURE defect, not a design one: it put
> `channelIds` at the metadata ROOT, while `ValidatePostDataStep` reads
> `context.metadata.postData.channelIds` (`readPostData`, `packages/shared/src/saga.ts:330-333`;
> check at `:391-395`) — the saga died at step 0. The mechanism that then gated re-execution is
> **`handleEvent`'s STEP-IDENTITY filter (`SagaManagerLifecycle.ts:803`)**: step 0's id is not
> `wait-publishing-completion`, so `executeSagaAsync` was never called. There is **no
> `nextRetryAt` guard anywhere** on the `executeSagaAsync → executeSaga → runSagaSteps` dispatch
> path. Also observed: `nextRetryAt` is overwritten on every event-driven re-execution and stays
> SET on the FAILED row — corroborating P2's stale-`nextRetryAt` finding. `createChaosHarness`
> is the RIGHT harness; Appendix A carries the corrected fixture. D7 depends on no refuted
> claim; **P2 remains unexecuted** and stays the slice-1 RED gate.

### P1 trace — amplification arithmetic (slice 2)

Budget = 4 failing attempts total: initial + `maxRetries: 3` (`packages/shared/src/saga.ts:926-930`; `shouldRetryStep` at `SagaManagerExecution.ts:539-546`). For an N-channel publish where the initial wait attempt precedes all completions: attempt 1 = initial arrival at the wait step (pending=N → `success:false`, `:731-733` → retryCount 1); each sibling `publish.job.completed` re-dispatches via `handleEvent` (`SagaManagerLifecycle.ts:794-810`) and finds pending>0. **Attempts consumed by events alone = 1 + (N−1)** (the Nth event finds pending=0). Exhaustion at the 4th failing attempt ⇒ **N ≥ 4 reaches FAILED deterministically with zero timer involvement**: rc 1 (initial, pending=4) → 2 (J1) → 3 (J2) → J3's event exhausts (`:229-246`, then `:253-262` → `failSaga`, step class `retryable`). J4's event lands on a terminal row and is ignored (`:795-799` status check; terminal guard `:82-93`). N = 3 survives pure event flow but still dies when 5 s retry ticks (`:1070`) interleave. Also traced: concurrent `executeSagaAsync` dispatches share ONE in-memory instance (`getSaga` returns the `activeInstances` object, `SagaManagerLifecycle.ts:781-788`) — concurrent walkers mutate shared `currentStep`/`retryCount`, the in-flight guard's second justification.

### P2 trace — crash-mid-auto-compensation (slice 1)

Crash shape at the durable layer (auto path `SagaManagerExecution.ts:253-263`, walk `:324-406`): status `RUNNING` (never flipped), `currentStep` = failed step index, `stepResults[failed] = {success:false}`, `compensationResults` EMPTY (memory-only until the single persist at `:398`), **`error` = null** (set at `:257` AFTER the persist at `:253` — new finding: the triggering error is not durable), and — **second new finding** — **`nextRetryAt` = stale past-due timestamp**: it is set on every retry scheduling (`:235`), persisted on the final failing attempt (`:253` → `writeSagaState` `:623` writes the in-memory value), and only step SUCCESS clears it (`:269`). Consequence: boot classifies the crashed row `nextRetryAt-owned-by-checker` (`disposeLoadedSaga` first check, `SagaManagerLifecycle.ts:357-359`), and the **retry scan** (`:1027-1046`, `nextRetryAt <= now`) — not the boot resume — re-dispatches `executeSaga` within 5 s, which re-executes the failed step FORWARD over partially-undone state. The exploration's `resumed` disposition occurs only for definitions without a retry policy. **Defect identical, reader different — S1 must neutralize BOTH readers**, which D2's `nextRetryAt: null` on the COMPENSATING transition does.

## Architecture Decisions

### D1 (S0) — Final gate keys on `FAILED_BATCHES`; vitest runner exit captured

**Choice**: (a) final gate becomes `if [ "$TOTAL_FAIL" -gt 0 ] || [ "$TOTAL_CANCEL" -gt 0 ] || [ -n "$FAILED_BATCHES" ]; then … exit 1` — `FAILED_BATCHES` is already populated on `runner_exit != 0` (`run-tests.sh:97-100`), so aggregating its non-emptiness closes all three proven reproduction shapes the `:66-68` comment names (crash after summary, unhandled rejection, failed hook with cancelled subtests) without a second accumulator; a dedicated error line prints when the gate fires with `fail=0 cancel=0` so CI logs say WHY. (b) The vitest phase has the same defect: `:122` `|| true` discards the runner exit — capture it (`|| vitest_exit=$?`) and append `vitest-unit` to `FAILED_BATCHES` when non-zero even if 0 parsed failures. (c) Fix the rotted "283 unit tests" header comment (`:4`). (d) Delete the dead registration `setupServices.ts:936-958` + token `types.ts:188` + the now-orphaned `SagaManagerImpl` import (`setupServices.ts:83`). Blast radius verified by repo grep: zero resolvers; `createRedisConnection`/`EventService` imports have other users and stay; remaining references are docs/archive (MULTI_TENant_GUARDS.md:906 gets the closure note, MASTER_PLAN_ES.md:159/164 the drift fix).
**Alternatives**: a `TOTAL_RUNNER_EXIT` integer accumulator — rejected: duplicates state `FAILED_BATCHES` already carries and can mask which batch failed.
**Rationale**: one source of failure truth; the gate goes red exactly when any batch printed `[FAIL]`.

### D2 (S1) — `COMPENSATING` persists BEFORE the walk dispatches; the transition nulls `nextRetryAt` and carries the error

**Choice**: in the retries-exhausted compensable branch (`SagaManagerExecution.ts:256-258`), the engine sets `status = "COMPENSATING"`, `error = errMsg`, `nextRetryAt = undefined`, persists (same tenant-scoped transaction shape, with the `SAGA_COMPENSATION_STARTED` event), and only THEN dispatches the walk. The admin path's transition (`SagaManagerLifecycle.ts:734`) converges on the same write.
**Alternatives**: flipping status inside the walk's first iteration — rejected: leaves a crash window before the first persist, which is the whole defect.
**Rationale**: write-ahead intent. Per P2, nulling `nextRetryAt` is load-bearing: it is what removes the row from the retry scan's predicate and the checker-owned disposition, so no reader can convert compensation into a forward retry. Persisting `error` fixes the durable-null finding.

### D3 (S1) — Durable per-step progress lives in `compensationResults` (existing column), persisted after EVERY step

**Choice**: the rebuilt walk persists the instance after each `compensate()` returns (result recorded at today's `:361`/`:371` then immediately persisted), instead of once after the loop (`:398`). The resume predicate skips step `i` iff `compensationResults[i]?.outcome === "succeeded"` (legacy `success === true` normalized, D6).
**Alternatives**: a `SagaCompensationProgress` table — rejected: a new table for data the row already has a JSON column for, plus a second write path outside the atomic saga+event transaction. `context.stepData` — rejected: step-facing surface, wrong owner.
**Rationale**: `compensationResults` IS the progress record; the defect was persistence cadence, not shape. Zero schema change keeps S1 token-free. Cost: ≤ one extra upsert per compensable step (the publish saga has 2).

**What the machine ADDITIONALLY guarantees beyond canon `compensate()` idempotency**: (1) status honesty — `COMPENSATING` is durable before any undo side-effect; (2) monotonic durable progress — the crash window is exactly ONE in-flight step, so idempotency is relied on for at most one re-invocation, never the whole walk; (3) a persisted per-step success is never re-executed — the engine-side record Edward's re-drive decision requires; (4) terminal honesty — `COMPENSATED` only when every eligible step holds a persisted success (D5).

### D4 (S1) — Boot predicate + new disposition `compensation-resumed`; shipped partition preserved

**Choice**: `loadActiveSagas` widens to `status ∈ {RUNNING, PENDING, COMPENSATING}` (`SagaManagerLifecycle.ts:952`). `disposeLoadedSaga` checks `status === "COMPENSATING"` FIRST — before the `nextRetryAt` check — and returns a new disposition `compensation-resumed`, whose dispatch is `compensateSagaAsync` (the walk, never `executeSaga`). Tenant/definition guards run for it exactly as for forward rows (mismatch/unresolvable/unregistered dispositions unchanged). The pivot-parking branch does NOT apply: a compensating saga is pre-pivot by construction.
**Alternatives**: reusing `resumed` with a direction flag — rejected: the disposition vocabulary exists precisely so five operator situations don't share a runbook; direction is a sixth.
**Rationale**: the shipped partition ("checker owns due retries, boot owns the rest, parked/mismatch/unregistered aside") is untouched for RUNNING/PENDING; COMPENSATING is a NEW third share that D2 guarantees carries no `nextRetryAt`, so it cannot collide with the checker. The status-first ordering makes even a legacy pre-deploy COMPENSATING row (admin-created, possibly stale fields) resume the walk.

### D5 (S1) — Failed compensation ⇒ stays `COMPENSATING`; gauge + re-drive + alert move

> **AMENDED AT GATE (2026-08-11) — C1 + minors. The ordinary-horizon backstop below is
> SUPERSEDED: COMPENSATING gets its OWN horizon, anchored at durable compensation liveness.**
> The original text sent COMPENSATING rows to the ordinary `startedAt` sweep — which, for a
> row inherited after an outage longer than the 30-min saga timeout, terminalizes it on the
> FIRST tick (+60 s) with the wrong reason (`"timeout"`), ZERO operator re-drive window (a
> terminal row is refused at `:730-732`), and a write race against the in-flight walk on the
> same shared in-memory instance — the exact hazard the parked branch documents at
> `:1109-1115`, applied to parking and not to COMPENSATING. Corrected mechanism (token-free):
>
> 1. `SagaInstanceRow` + `deserializeSagaInstanceRow` (and `SagaInstance` as an optional
>    field) carry **`updatedAt`**. The row IS written at the COMPENSATING transition (D2) and
>    after every step (D3), so `updatedAt` tracks WALK LIVENESS — a live walk never expires,
>    only a stalled one does. Using `updatedAt` is safe HERE, unlike the parked case where
>    byte-identity forced its rejection: a compensating row makes no byte-identity promise,
>    it is written by design.
> 2. `checkSagaTimeout` branches on `status === "COMPENSATING"` BEFORE the parked and
>    ordinary branches. Suspicion forms on the carried (possibly stale, therefore
>    conservative) `updatedAt`; before terminalizing, the checker re-reads the FRESH row via
>    `withSagaSystemRead` — the established distrust-the-stale-copy pattern of
>    `terminalizeUnscopableSaga` (`:1191-1226`) — and only an elapsed fresh horizon fails it.
> 3. Terminalization uses a **NEW `SagaFailureReason` member `"compensation-expired"`**,
>    added to the closed union at `sagaRecoveryMetrics.ts:82-83` (the original prose promised
>    the reason without adding it). The `prometheus/alerts/saga.yml` changes ship in the same
>    PR: the `SagaCompensatingOrphans` description (":84 — the engine does not resume these")
>    becomes FALSE after D4 and is rewritten; the `SagaRecoveryLoopFailing` `stage=~` regex
>    (`:98`) gains the new **`SagaRecoveryStage` member `"compensation"`** that D5's
>    silent-exit counters emit; thresholds re-tuned per Edward's decision 3. `SLO.md` and the
>    `MULTI_TENANT_GUARDS.md` compensating-orphan runbook section update with it, as does the
>    boot WARN at `loadActiveSagas:992-999` (its "detection only" text becomes false).
> 4. **Rejected alternative**: an in-memory `compensatingAt` map mirroring `parkedAt` — a
>    crash loop re-opens the window on every reboot, the exact hazard D11 closes for parking;
>    a durable anchor the walk already maintains costs nothing and survives restarts.
>
> Minor corrections to the prose below: the silent exits at `compensateSagaSteps` are TWO
> returns (`:294-296`, `:299-301`) plus the `!outcome.ran` path (`:309-314`) which logs but
> does not count — all three get counters under the new `"compensation"` stage. Concrete
> producer note for the resume-before-claims caveat (adjudicated SOUND — D3 bounds the
> overlap to one in-flight step and canon requires idempotent `compensate()`): `shutdown()`
> (`:875-876`) skips non-RUNNING rows, so it does NOT hand off a COMPENSATING row — a
> draining process's detached walk keeps writing past teardown; accepted and stated, the
> lease (S3) and the liveness horizon (this amendment) bound it.

**Choice**: the rebuilt walk no longer marks `COMPENSATED` when a step's `compensate()` failed (today `:363-368` logs and the saga still terminalizes as COMPENSATED — dishonest). A walk ending with any non-succeeded eligible step leaves the row `COMPENSATING`; the ordinary timeout horizon (`checkSagaTimeout`, measured from `startedAt`) remains the canon backstop that terminalizes it to FAILED (`compensation-expired` reason) — no infinite COMPENSATING. The three silent-return exits (`compensateSagaSteps` `:293-301`) each get a log + `recordSagaRecoveryFailure` counter. `compensateSaga` (admin) accepts `status ∈ {FAILED, COMPENSATING}` (`:730-732`); for COMPENSATING it dispatches the walk, which resumes from durable progress per D3 — Edward's decision (never restarts from step 0; restart falls out naturally as "no persisted successes yet"). `compensatingOrphans` keeps its boot-count semantics but now measures the production path (the auto walk writes the status); its alert threshold moves INSIDE slice 1's PR (Edward's decision 3), re-tuned from "any > 0 is admin-endpoint leakage" to "COMPENSATING count that does not drain across two boot observations".
**Alternatives**: dedicated compensation retry policy with its own backoff — deferred: adds a second retry state machine; the timeout backstop + admin re-drive + boot resume already bound the state. Named in ADR-1 as a revisit trigger if `compensation-expired` fires in production.
**Rationale**: honest terminal states; every exit is counted; the operator can always re-drive.

### D6 (S2) — `SagaStepResult` REBUILD: discriminated union on `outcome`; legacy rows normalized at the two deserialization seams

**Choice**:

```typescript
export type SagaStepResult =
  | { outcome: "succeeded"; data?: unknown; compensationData?: unknown }
  | { outcome: "failed"; error: string; compensationData?: unknown }
  | { outcome: "waiting"; reason: string; data?: unknown };
```

Full consumer inventory (repo grep, `SagaStepResult` + `.success` on results): **producers** — `packages/shared/src/saga.ts` step classes (`:376`, `:415`, `:449`, `:527`, `:595`, `:694` wait step — `pending>0` becomes `{outcome:"waiting", reason:"publishing jobs still in progress"}`; `failed>0` stays `failed` — `:746-751` [cite corrected at gate; `:789` is `UpdatePostStatusStep.execute`]), engine-synthesized countermeasure results (`SagaManagerExecution.ts:170-179`, `:187-190`, `:198-201` → `failed`), catch-wrappers (`:197-202`, `:369-375`); **consumers** — engine event-type pick `:206`, failure branch `:229`, walk eligibility `:349` (`stepResult?.outcome === "succeeded"`), compensation result checks `:363`, `:389`, terminal-event tallies `:430-431`, `:509-510`; **type surfaces** — `SagaStep.execute/compensate` signatures (`saga.ts:135`, `:148`), `SagaInstance.stepResults/compensationResults` (`:271-272`); **persistence seams** — `deserializeSagaInstanceRow` (`sagaInstanceRow.ts:50-51`, casts) and the Redis-cache deserializer (`SagaManagerExecution.ts:828-829`): both gain `normalizeLegacyStepResults` mapping `{success:true,…}→succeeded` / `{success:false,…}→failed` so pre-deploy rows keep replaying; **frontend view** — `apps/client/lib/api/clients/sagaClient.ts:83-88` `SagaStepResultView` (knip-baselined unused, updated to the union view in the same PR); **tests/helpers** — `chaos-helpers.ts`, `sagaManager.test-helpers.ts`, `sagaTenantIsolation.test.ts:146`, boot-resume/crash-recovery fixtures; **docs** — `docs/api/saga.md:34-46`.
**Alternatives**: `waiting?: boolean` flag on the current shape — rejected by the approved verdict (type-level modelling error stays); parallel `WaitOutcome` type only for the wait step — rejected: every consumer of the boolean would still guess.
**Rationale**: three domain states, compiler-enforced; the union straightens the `runSagaSteps` countermeasure control flow (`:153-196`) that used result-truthiness as flow control.

### D7 (S2) — De-amplification: `waiting` consumes no retry budget + in-flight guard with trailing rerun (coalescing)

> **AMENDED AT GATE (2026-08-11) — C2 + M5.**
>
> **(C2) Cross-slice MERGE-BLOCKING invariant — tasks MUST codify it verbatim:**
> **`executeSaga` SHALL REFUSE a row whose persisted status is `COMPENSATING`** (log +
> `recordSagaRecoveryFailure("compensation")`, never a forward run), **and D7b's trailing
> rerun SHALL RE-READ the persisted status before re-entering.** Why: `runSagaSteps:130-131`
> unconditionally sets `RUNNING` + persists, and `executeSaga`'s refusal set (`:82-86`) is
> only the three terminal states. Five of the six dispatch paths are safe after D2/D4
> (`handleEvent` requires RUNNING `:799`; the retry scan needs a due `nextRetryAt`, which D2
> nulls; `continueSaga` requires RUNNING/PENDING `:686`; boot routes COMPENSATING to the
> walk; `startSaga` is new) — **the one hole is the trailing rerun itself**: a sibling event
> arriving during the final failing attempt sets `rerun = true`, the `finally` re-enters
> after D2 persisted COMPENSATING, and forward execution would overwrite it with RUNNING and
> re-run the failed step over partially-undone state — slice 1's headline defect,
> reintroduced by slice 2 in the same file. The refusal is slice 2's; slice 1's boot
> disposition relies on it from the moment both are on main.
>
> **(M5) The `waiting` re-arm cadence is a dedicated `waitPollMs`, default 30 000 ms** —
> deliberately slower than the 5 s scan tick, NOT the definition's `backoffMs` (5 s) the
> original prose named. Sizing: with a flat 5 s re-arm, `waiting` turns the wait step from
> ≤ 4 executions ever into up to **360 per saga** over the 30-min horizon (each a `getSaga` +
> real job-status read + persist, each re-entering the 5 s retry-scan page). At 30 s the
> worst case is **≤ 60 polls per saga**, and events remain the PRIMARY advance (the guard's
> trailing rerun delivers completion promptness); the poll is the safety net for a lost
> event. Config: `waitPollMs` on `SagaManagerConfig` + forwarded through
> `SagaIntegrationConfig` alongside D10's fields.

**Choice**: two cooperating mechanisms.
(a) **Budget exemption**: in `runSagaSteps`, `outcome === "waiting"` takes a NEW branch: `retryCount` untouched, `nextRetryAt = now + retryPolicy.backoffMs` (flat — a poll cadence, not an error backoff), persist without a step event (no audit spam per poll; DEBUG log), return. The wait step's overall bound becomes the saga horizon (30 min timeout) — a never-completing job set still terminalizes honestly via the ordinary sweep. `failed` keeps today's budget path untouched.
(b) **In-process in-flight guard, at the `executeSaga` entrance** (`SagaManagerExecution.ts:74`) — the single funnel all dispatchers use (boot dispatch `:549`, retry scan, `handleEvent`, continue endpoint, `startSaga`): `private readonly inFlight = new Map<string, { rerun: boolean }>()`. Entry present ⇒ set `rerun = true`, return (the event is coalesced, not lost). On run completion (finally): if `rerun`, execute once more; else delete. `compensateSagaSteps` shares the same map — one saga, one advancer, either direction; this is also S1's walk re-entry guard. The trailing rerun is what makes coalescing lossless: an event arriving after the in-flight check read `pending=1` still triggers exactly one more check.
**Alternatives considered for de-amplification**: pure event coalescing (debounce window) — rejected: adds a timer per saga and still burns budget per coalesced flush without (a); waiting-exemption alone — rejected: leaves concurrent executions racing on the shared in-memory instance (P1 trace); dedicated wait-poll ownership (a poll loop owning the wait step, events ignored) — rejected: loses completion promptness and adds a fourth dispatch mechanism to a file that already has three.
**Rationale**: (a) removes the harm (no budget to burn), (b) removes the waste and the race. Fitness #14 unaffected (not a `*Cache` map; per-process coordination state matching the documented single-replica deployment; S3's claims are the cross-process sibling).

### D8 (S2) — Parking-evidence-test collision: split the assertion so CI cannot confuse the two flip reasons

The risk: `sagaCrashRecovery.test.ts:1122-1127` asserts the operator-resumed parked saga ends `FAILED` + `/version conflict/i`, and `SagaManagerLifecycle.ts:441-446` names "this assertion changing to COMPLETED" as the drop-the-parking-branch signal. Trace under S2: the replayed row's wait step finds jobs already completed (`pending=0` → `succeeded` — same as today's `success:true`), then `UpdatePostStatusStep` fails on the stale OCC token with a hard CONFLICT → `failed` (never `waiting`) → budget path → FAILED. **S2 does not flip the status**, but it can lawfully change failure-reason TEXT and retry timing, and a reason-only red would masquerade as the revisit trigger.
**Choice**: in slice 2's PR, restructure the evidence test into two independently-labeled assertions: (1) `assert.notStrictEqual(terminal.status, "COMPLETED", …)` — ONLY this failing is the parking revisit trigger; (2) `assert.strictEqual(terminal.status, "FAILED")` + the `/version conflict/i` match — slice-owned mechanics allowed to evolve with the union. Assertion (1) is evaluated BEFORE (2), so the FIRST failure message a red run prints is the revisit trigger, never the mechanics drift (gate minor). Update the `:441-446` comment to name assertion (1) as the signal.
**Rationale**: the trigger becomes machine-distinguishable; a mechanics regression reddens (2) without touching (1), and only genuine post-pivot tolerance flips (1).

### D9 (S3) — Claims: `SagaClaimService` reusing the EXISTING system boundary; claim at selection in BOTH readers; release at guard exit; lease 10 min

> **AMENDED AT GATE (2026-08-11) — M6 + M1.**
>
> **(M6) The claim boundary is a NEW narrow named surface, `withSagaSystemClaim`, exported
> from `sagaTenant.ts`** and delegating to the same unexported `runSagaSystemTransaction` —
> chosen over routing the claim UPDATE through `withSagaSystemRead`, whose docblock
> (`sagaTenant.ts:170-192`) and non-export rationale (`:222-228`) promise "reads" plus
> exactly ONE terminal write (`failSagaAsSystem`); a write through the read surface would
> make both sentences false. The module's own extension pattern (narrow, named,
> purpose-limited surfaces) is followed; `sagaTenant.ts` is EXTENDED, never modified, and
> `runSagaSystemTransaction` stays unexported. The docblock at `:222-228` gains the third
> named surface in the same edit. Both readers run their SELECT+claim inside
> `withSagaSystemClaim`; the same-snapshot count queries of `loadActiveSagas` ride the same
> transaction.
>
> **(M1) — decided NOW: S3 ships a scoped `multi-tenant-isolation` MODIFIED delta.** The
> living spec's "Saga persistence executes on the guarded client" requirement states that a
> saga write whose `accountId` disagrees with the bound context SHALL FAIL LOUDLY; the raw
> claim UPDATE is a saga write outside layer 1's `$extends` reach, so leaving the capability
> untouched would archive a contradiction. The delta records the claim UPDATE as the SECOND
> named cross-tenant write surface (after `failSagaAsSystem`), normatively constrained to
> the claim columns ONLY (`claimedAt`, `claimedBy`) — it can never express an `accountId`,
> a context, or any payload column, so the FAIL-LOUDLY clause remains true by construction;
> layer 2 still evaluates it (the RLS policy's `USING` + `WITH CHECK` both admit the
> `__system__` sentinel — gate-verified against migration `20260527000000`). ADR-1 (D12)
> carries the same statement.

**Choice**: new `apps/api/src/saga/SagaClaimService.ts` holding the `OutboxClaimService` SQL SHAPE (`UPDATE "SagaInstance" SET "claimedAt"=now,"claimedBy"=worker WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *` — `OutboxClaimService.ts:87-102` pattern, columns included so the claim returns the full row and the reader loses its second read). It executes inside the readers' EXISTING `withSagaSystemRead` boundary (`sagaTenant.ts:187-192`), which already delegates to the unexported `runSagaSystemTransaction` and binds `setTenantGuc(tx,'__system__')` as the FIRST statement (`:229-241`) — the sentinel is the RLS bypass the raw SQL needs, and `sagaTenant.ts` is extended only by the new service's use, never modified; `runSagaSystemTransaction` stays unexported. Boot reader (`loadActiveSagas`) claim predicate: `status IN ('RUNNING','PENDING','COMPENSATING') AND ("claimedAt" IS NULL OR "claimedAt" < leaseExpiry) ORDER BY "startedAt" LIMIT bootLoadLimit` (counts stay Prisma-typed in the same tx). Retry scan: `status IN ('RUNNING','PENDING') AND "nextRetryAt" <= now AND "nextRetryAt" IS NOT NULL AND (claim-free-or-expired) ORDER BY "nextRetryAt" LIMIT retryScanPageSize`. The `nextRetryAt` partition is untouched — the claim is an ADDITIONAL orthogonal predicate. **Starvation closes by construction**: a claimed slow head is skipped on the next tick, so the page reaches rows 51+. **Release** = `claimedAt/claimedBy → NULL` at the in-flight guard's exit (D7b) when the saga went dormant (terminal, retry-scheduled, waiting-scheduled) — one release point because the guard is the one funnel; crash release is lease expiry. `workerId = ${hostname()}-${process.pid}` (setupCrisisUseCases precedent).
**Lease = 10 min, config `claimLeaseMs`.** Justification: it must exceed the worst legitimate hold — a boot batch of `bootLoadLimit` (500) rows draining through `maxConcurrentSagas` (100) with multi-second steps (measured saga suites put a step round-trip in seconds; 5 waves × worst-case tens of seconds ≪ 10 min) — and stay well under the 30-min saga horizon minus one recovery cycle, so an expired claim can still be re-claimed and completed before the timeout sweep terminalizes the row. The outbox's 5 min is tuned to single-event dispatch; saga holds are batch-drain-shaped → 2×.
**At-least-once, operationally**: an expired lease under a live holder ⇒ second dispatcher ⇒ duplicate step execution across processes; deterministic job ids + OCC + semantic locks absorb the known paths, the duplicate-DRAFT path stays real until SMELL-71. The boot ownership log (`SagaManagerLifecycle.ts:228-236`) is rewritten to `recoveryOwnership: "row-claims", delivery: "at-least-once", multiReplicaSupported: false, pending: "SMELL-71"` — a DOWNGRADE of the constraint, never a lift.
**Alternatives**: claiming at dispatch (`executeSaga` entrance) — rejected: the double-read already happened, starvation is a SELECT property; a new exported general system-transaction — rejected: the exact reuse hazard `sagaTenant.ts:222-228` exists to prevent; extending claims to event dispatches — deferred to the SMELL-71 conversation (ADR-1 notes it).

### D10 (S3) — Claim columns, index posture, fitness #23 three-part edit, config wiring

> **AMENDED AT GATE (2026-08-11) — C3 (factual). The "fitness #23 three-part edit" below is
> SUPERSEDED: there is NO exclusion to add, because #23 never fires on the claim SQL.**
> Empirical reality (the gate ran the exact CLAUDE.md #23 command): **count = 0 today**, with
> 8 raw-SQL files under `apps/api/src` in the tree. #23's regex
> `\.\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\(` requires the paren
> IMMEDIATELY after the method name — it matches neither the generic-parameter form
> `this.prisma.$queryRaw<Array<{…}>>(Prisma.sql\`…\`)`(the exact`OutboxClaimService.ts:75-87`syntax the claim service copies:`tx.$queryRaw<SagaInstanceRow[]>(Prisma.sql\`UPDATE …\`)`)
nor tagged templates (`SagaManagerLifecycle.ts:825`). Adding the planned exclusion would
> install a PERMANENT DEAD EXCLUSION satisfying the delta's MERGE-BLOCKING scenario
> cosmetically while the gate stays blind. Corrected disposition:
>
> 1. **No CLAUDE.md / fitness.yml edit in this change.** The claim service states its exact
>    call syntax in its file docblock and notes #23's blindness to it.
> 2. **ADR-1 carries the baseline decision**: #23 is blind to `$queryRaw<T>(` and
>    tagged-template forms; the pre-existing raw-SQL files (8 found; 4 outside the current
>    exception comments) are the baseline; whether #23's regex gets fixed is a HOUSE-LEVEL
>    canon change, out of this change's scope.
> 3. **New SMELL backlog entry recommended** (`docs/reports/roadmap-detected-smells-backlog.md`):
>    "fitness #23 regex blind to generic/tagged-template raw-query forms" — with the 8-file
>    baseline attached, so the ramp-down starts from measured reality.

**Choice**: `claimedAt DateTime? @db.Timestamptz(6)` + `claimedBy String?` on `SagaInstance` — additive, nullable, NO default (SMELL-70 nullability flip stays out, per constraint). **No new index**: both claim SELECTs are served by the existing `@@index([status, startedAt])` / `@@index([status, nextRetryAt])`; the claim predicate is a residual filter over an already-paged candidate set (≤ 500 rows), and an index on a column that is NULL for the entire steady-state table buys nothing. Fitness **#23** coordinated three-part edit in slice 3's PR: (1) CLAUDE.md #23 gains `grep -vE "/saga/SagaClaimService\.ts"` with an audited-safe comment (system boundary + `__system__` GUC first statement + lease claim SQL, ADR-1-linked); (2) byte-identical mirror in `.github/workflows/fitness.yml`; (3) ADR-1 records the exception — regex drift between doc and workflow is the named failure mode, so the edit is one copy-paste. Config: `SagaIntegrationConfig` (`SagaIntegration.ts:61-98`) gains optional `bootLoadLimit`, `retryScanPageSize`, `claimLeaseMs`, forwarded into the `SagaManagerImpl` config at `:200-211` (conditional spread, `exactOptionalPropertyTypes` pattern); `sagaManagerTypes.ts` gains `retryScanPageSize` + `claimLeaseMs` (`bootLoadLimit` exists at `:58` — the unwired-knob defect closes at the seam it recurred on); the lifecycle reads `this.config.retryScanPageSize ?? 50`.

### D11 (S4) — `SagaParkedWindow`: global sibling table; window survives restarts; crash-loop edge closed

**Choice**:

```prisma
model SagaParkedWindow {
  sagaId    String   @id
  parkedAt  DateTime @db.Timestamptz(6)
  reason    String   // "pivot" | "definition-unregistered"
  parkedBy  String
  createdAt DateTime @default(now()) @db.Timestamptz(6)
}
```

GLOBAL table (like `OutboxEvent`/`StoredEvent`): no `accountId`, not added to `TENANT_SCOPED_MODELS`, no RLS policy — it stores engine ownership metadata (a timestamp + reason keyed by saga id), zero customer data; the referenced `SagaInstance` row keeps full tenant protection. Typed Prisma API only (upsert/delete/findMany) ⇒ no new fitness #23 surface. **Lifecycle**: `park()` (`SagaManagerLifecycle.ts:473-477`) additionally upserts with **create-only semantics** (`update: {}` — an existing row's `parkedAt` is NEVER overwritten: the window opens exactly once, at first parking). Boot hydration: after the resume pass, load windows for parked-disposition rows into the `parkedAt` in-memory map (which becomes a read cache over the table; `checkSagaTimeout` `:1137-1161` reads the map unchanged). Deletion at the async terminal/unpark sites (`continueSaga` `:712`, window expiry `:1160`, `terminalizeUnscopableSaga` `:1224`) awaited best-effort; `stopTracking` stays sync (map only); the invariant keeper is a **boot-time sweep**: windows whose saga is terminal or absent are garbage-collected during hydration, so a missed delete can never terminalize a future row.
**New contract, stated precisely**: a parked row's operator window opens at FIRST parking and elapses in wall-clock time across restarts; `parkedFor = now − SagaParkedWindow.parkedAt`. **Crash-loop edge (closed)**: today each reboot re-parks and re-opens a fresh window, so a crash-looping pod defers the terminal guarantee indefinitely — with the durable record the first surviving process terminalizes once the ORIGINAL window has elapsed. **Downtime edge (accepted, stated)**: a window that fully elapses during an outage is terminalized `parked-expired` on the first post-boot tick — the operator HAD the window (it opened, was logged and counted, when parking happened); this differs from rejected option B (`updatedAt` derivation), which never granted a window at all. The saga row remains byte-identical throughout — the promise was about the row.
**Alternatives**: options A (column on `SagaInstance` — retracts the byte-identity decision), B (`updatedAt` derivation — zero-window failure, rejected by the exploration), D (monitoring only — leaves a canon deviation in a doc). Option C fixed by the proposal.

### D12 — ADR-1 skeleton: "Saga recovery row ownership and the durable park record" (lands with slice 3's PR)

> **AMENDED AT GATE (2026-08-11) — C3 + M1 + M6 propagation.** The skeleton's item (3)
> "fitness #23 exception (three-part coordinated edit)" is REPLACED by: (3') record that
> fitness #23 is BLIND to the claim SQL's syntax (`$queryRaw<T>(Prisma.sql…)`) and to tagged
> templates — no exclusion is added because none would ever fire; the 8-file raw-SQL
> baseline is recorded and the regex fix is delegated to a house-level canon change (new
> SMELL backlog entry). The ADR additionally records: the claim boundary is the named
> surface `withSagaSystemClaim` (third narrow surface of `sagaTenant.ts`, per D9's M6
> amendment), and the scoped `multi-tenant-isolation` MODIFIED delta constraining the claim
> UPDATE to `claimedAt`/`claimedBy` only (per D9's M1 amendment).

Status Proposed → Accepted; Deciders Edward. **Context**: recovery readers had no ownership (SMELL-73); the parked window was per-process. **Decision**: (1) lease-based row claims (`claimedAt`/`claimedBy`, additive nullable) taken at selection time in both readers via `SagaClaimService` inside the saga system boundary; (2) lease 10 min = 2× outbox default, bounded by batch-drain worst case below and the 30-min saga horizon above; (3) fitness #23 exception for the one raw claim statement (three-part coordinated edit); (4) `SagaParkedWindow` as the durable park record (option C — byte-identity preserved); (5) ownership reporting downgraded to at-least-once, pending SMELL-71. **Rejected**: per-process ownership (status quo), `nextRetryAt`-as-pseudo-lease (breaks the boot partition), park column on the saga row, updatedAt-derived window. **Revisit if**: SMELL-71 lands (claims may extend to event dispatches; multi-replica statement re-opens); `compensation-expired` fires in production (dedicated compensation retry policy). One conversation, not four — per the approved exploration.

## Data Flow — the rebuilt compensation machine

    step fails, retries exhausted, class=compensable
      │  persist { status: COMPENSATING, error, nextRetryAt: null } + event   ← D2 (write-ahead)
      ▼
    compensation walk (in-flight guard held, D7b)
      │  for i = currentStep-1 … 0 (skip: ≥ pivot, non-compensable,
      │      step not succeeded, compensationResults[i] already succeeded ← D3 resume predicate)
      │  compensate(i) → record result → persist row               ← D3 (per-step durability)
      ▼
    all eligible succeeded ──► persist { status: COMPENSATED } + event ──► stopTracking
    any failed/interrupted ──► row stays COMPENSATING
            │                        │
            │ boot: disposition compensation-resumed → walk resumes   ← D4
            │ admin: compensateSaga accepts COMPENSATING → walk resumes ← D5
            └ backstop: COMPENSATING liveness horizon (fresh updatedAt re-read)
                        → FAILED (compensation-expired)          ← D5 as AMENDED (C1)

    INVARIANT (C2, MERGE-BLOCKING): executeSaga REFUSES persisted COMPENSATING
    (log + failure counter, never a forward run); the in-flight guard's trailing
    rerun re-reads persisted status before re-entering. Forward execution and the
    walk can never both own a COMPENSATING row.

## File Changes

| File                                                                                 | Action        | Slice | Description                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/scripts/run-tests.sh`                                                      | Modify        | S0    | Final gate keys on `FAILED_BATCHES`; vitest exit captured; header comment fixed (D1)                                                                                                                                                                                                                                                                                                      |
| `apps/api/scripts/run-tests.sh`                                                      | Modify        | S1-S4 | AMENDED AT GATE (M4): every new node:test suite appended to its batch's explicit list — an unlisted suite never runs                                                                                                                                                                                                                                                                      |
| `apps/api/src/infrastructure/container/setupServices.ts`                             | Modify        | S0    | Delete dead registration `:936-958` + orphaned `SagaManagerImpl` import `:83`                                                                                                                                                                                                                                                                                                             |
| `apps/api/src/infrastructure/container/types.ts`                                     | Modify        | S0    | Delete `SagaManager` token `:188`                                                                                                                                                                                                                                                                                                                                                         |
| `docs/product/MASTER_PLAN_ES.md`                                                     | Modify        | S0    | N-COR-2(b) drift correction (`:159`, `:164`)                                                                                                                                                                                                                                                                                                                                              |
| `apps/api/src/saga/SagaManagerExecution.ts`                                          | Modify        | S1+S2 | Compensation walk REBUILD (D2-D5); union handling + waiting branch + countermeasure flow straightened (D6-D7); in-flight guard + trailing rerun with status re-read + COMPENSATING refusal in `executeSaga` (D7b as amended, C2)                                                                                                                                                          |
| `apps/api/src/saga/SagaManagerLifecycle.ts`                                          | Modify        | S1-S4 | Boot predicate + `compensation-resumed` disposition (D4); `compensateSaga` accepts COMPENSATING (D5); COMPENSATING liveness branch in `checkSagaTimeout` + boot WARN rewrite `:992-999` (C1/M3); `handleEvent` reworked (guard-coalesced, typed sagaId read); claim-aware readers + page config (D9-D10); park window write-through + hydration + GC sweep (D11); ownership log downgrade |
| `packages/shared/src/saga.ts`                                                        | Modify        | S2    | `SagaStepResult` union REBUILD; step classes emit `outcome`; wait step returns `waiting` (D6); `SagaInstance` gains optional `updatedAt` (C1)                                                                                                                                                                                                                                             |
| `apps/api/src/saga/sagaInstanceRow.ts`                                               | Modify        | S1+S2 | `updatedAt` carried on row + deserializer (C1); `normalizeLegacyStepResults` at the row seam (D6)                                                                                                                                                                                                                                                                                         |
| `apps/api/src/saga/sagaTenant.ts`                                                    | Extend        | S3    | AMENDED AT GATE (M6): new exported narrow surface `withSagaSystemClaim` (third named surface; delegates to the unexported `runSagaSystemTransaction`); docblock `:222-228` names it                                                                                                                                                                                                       |
| `apps/api/src/saga/SagaClaimService.ts`                                              | Create        | S3    | Claim SQL shape inside `withSagaSystemClaim` (D9 as amended); file docblock states the exact `$queryRaw<T>(Prisma.sql…)` syntax + #23 blindness note (C3)                                                                                                                                                                                                                                 |
| `apps/api/src/saga/SagaIntegration.ts`                                               | Modify        | S2+S3 | `waitPollMs` (M5) + `bootLoadLimit` / `retryScanPageSize` / `claimLeaseMs` forwarded (D10)                                                                                                                                                                                                                                                                                                |
| `apps/api/src/saga/sagaManagerTypes.ts`                                              | Modify        | S2+S3 | New config fields incl. `waitPollMs` (D10, M5)                                                                                                                                                                                                                                                                                                                                            |
| `apps/api/src/metrics/sagaRecoveryMetrics.ts`                                        | Modify        | S1    | AMENDED AT GATE (M3): `SagaFailureReason` += `"compensation-expired"`; `SagaRecoveryStage` += `"compensation"`; gauge docblock `:163-172` rewritten (detection-only text becomes false)                                                                                                                                                                                                   |
| `prometheus/alerts/saga.yml`                                                         | Modify        | S1    | AMENDED AT GATE (M3): `SagaCompensatingOrphans` description fixed (`:84` "engine does not resume these" false post-D4); `SagaRecoveryLoopFailing` `stage=~` regex `:98` gains `compensation`; thresholds move with the slice (Edward decision 3)                                                                                                                                          |
| `docs/observability/SLO.md`                                                          | Modify        | S1    | AMENDED AT GATE (M3): saga section reflects the resumed-COMPENSATING lifecycle                                                                                                                                                                                                                                                                                                            |
| `docs/security/MULTI_TENANT_GUARDS.md`                                               | Modify        | S1    | AMENDED AT GATE (M3): compensating-orphan runbook section rewritten for the resume + re-drive path                                                                                                                                                                                                                                                                                        |
| `infra/prisma/schema.prisma` + migration                                             | Modify/Create | S3    | `claimedAt`/`claimedBy` additive nullable — SENSITIVE (D10)                                                                                                                                                                                                                                                                                                                               |
| `infra/prisma/schema.prisma` + migration                                             | Modify/Create | S4    | `SagaParkedWindow` table — SENSITIVE (D11)                                                                                                                                                                                                                                                                                                                                                |
| `openspec/changes/saga-engine-terminal-hygiene/specs/multi-tenant-isolation/spec.md` | Create        | S3    | AMENDED AT GATE (M1): scoped MODIFIED delta — claim UPDATE as second named cross-tenant write surface, claim-columns-only constraint                                                                                                                                                                                                                                                      |
| `docs/reports/roadmap-detected-smells-backlog.md`                                    | Modify        | S3    | AMENDED AT GATE (C3): new SMELL — fitness #23 blind to generic/tagged-template raw-query forms (8-file baseline)                                                                                                                                                                                                                                                                          |
| `docs/technical/ADR-NNNN-saga-row-ownership-and-park-record.md`                      | Create        | S3    | ADR-1 per D12 skeleton as amended (no #23 exclusion; blindness + baseline recorded)                                                                                                                                                                                                                                                                                                       |
| `apps/client/lib/api/clients/sagaClient.ts`                                          | Modify        | S2    | `SagaStepResultView` → union view (D6)                                                                                                                                                                                                                                                                                                                                                    |
| `docs/api/saga.md` + `docs/security/MULTI_TENANT_GUARDS.md`                          | Modify        | S2/S0 | Contract + carry-list closure notes                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/tests/**` (chaos, unit/saga, integration)                                  | Create/Modify | all   | P1/P2 RED tests (Appendix A/B), walk-resume proofs, claim contention, parked-window restart survival, evidence-test split (D8), C2-invariant refusal test                                                                                                                                                                                                                                 |

SUPERSEDED AT GATE (C3): the former `CLAUDE.md` + `.github/workflows/fitness.yml` row (fitness #23 exception pair) is REMOVED — the regex never fires on the claim syntax, so the exclusion would be permanently dead (see D10 amendment).

## Interfaces / Contracts

Union: see D6. Claim service surface:

```typescript
export class SagaClaimService {
  constructor(opts: { workerId: string; leaseDurationMs: number });
  claimBootRows(tx: SagaTransactionClient, limit: number): Promise<SagaInstanceRow[]>;
  claimDueRetries(
    tx: SagaTransactionClient,
    pageSize: number,
    now: Date
  ): Promise<SagaInstanceRow[]>;
  release(tx: SagaTransactionClient, sagaId: string): Promise<void>;
}
```

(Executes against the tx the readers' boundary provides — the service opens no boundary of its own; construction wired in `SagaManagerLifecycle`, no DI token needed.) `SagaIntegrationConfig` additions: `bootLoadLimit?: number; retryScanPageSize?: number; claimLeaseMs?: number; waitPollMs?: number` (last one per M5). Prisma: claim columns + `SagaParkedWindow` per D10/D11.

> **AMENDED AT GATE (2026-08-11) — M6.** The boundary the readers hand to the claim service
> is `withSagaSystemClaim` (the new third named surface of `sagaTenant.ts`, per D9's
> amendment), NOT `withSagaSystemRead` — the read surface keeps its read-only promise:
>
> ```typescript
> export async function withSagaSystemClaim<T>(
>   prisma: SagaEngineClient,
>   fn: (tx: SagaTransactionClient) => Promise<T>
> ): Promise<T>; // delegates to the unexported runSagaSystemTransaction
> ```

## Testing Strategy

| Tier                                                      | What                                                                                                                                                                                                                                                                                       | Approach                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| S0 harness self-test                                      | Gate exits non-zero on runner-crash-with-clean-counts; vitest-crash shape                                                                                                                                                                                                                  | Fixture batch whose runner exits 1 with `# fail 0` (broken-hook file), assert script exit 1; run under `bash` directly, no DB |
| Unit (Vitest + node:test unit/saga)                       | Union exhaustiveness (tsc), legacy normalization, waiting branch budget-untouched, in-flight guard coalescing (rerun-once), walk resume predicate, disposition table incl. `compensation-resumed`, claim predicate SQL shape                                                               | Existing `sagaBootResume` harness + mock doubles; P2 (Appendix B) is the S1 RED test                                          |
| Chaos (node:test, no services)                            | P1 amplification (Appendix A) as S2 RED → post-fix asserts COMPLETED with rc unchanged by sibling events; concurrent-dispatch guard proof                                                                                                                                                  | `createChaosHarness` + real `createPostPublishingSagaDefinition`                                                              |
| Integration (DB+Redis, `integration:saga-recovery` batch) | Crash-mid-walk resume against real Postgres (kill between per-step persists → boot → walk completes, no forward step); claim contention (two managers, one row advanced once — at-least-once documented); parked-window restart survival + crash-loop non-reopen; evidence-test split (D8) | `sagaCrashRecovery` harness patterns; `TIMEOUT=120000`; fixtures cleaned per suite (0-leak)                                   |
| Static/invariant                                          | Fitness greps (#8, #21; #23 stays 0 by blindness — C3, no pair edit), C2 refusal invariant pinned, `sagaDeterministicIds` untouched, boot-log ownership downgrade pinned                                                                                                                   | Existing static-test pattern from the archived change                                                                         |

## Threat Matrix

Assessed against `references/threat-matrix.md` — all rows N/A: no routing, subprocess, VCS/PR automation, or executable-classification boundary changes. S0 edits an existing CI gate shell script but adds no command execution and consumes no new input (it aggregates exit codes already captured); Git repository selection / commit / push / PR rows do not apply (no automation touched). Documentation-like-path row N/A (no classification logic).

## Migration / Rollout

S0-S2: code-only, clean reverts. S3, S4: additive migrations (`omnipost-allow sensitive-edit` + `pnpm db:up` first, per proposal). Ordered: claim columns (S3) and `SagaParkedWindow` (S4) may share one PR slot if ADR-1 lands together. Down migrations drop column/table; pre-change code ignores claim/park metadata, so code-revert-without-schema-revert is safe. Legacy `{success}` step results are normalized read-side forever (D6) — no data migration. Deploy note for S1: `compensatingOrphans` alert rules ship in the same PR (Edward's decision 3).

## Open Questions

- [x] ~~P1 execution~~ — RESOLVED AT GATE (2026-08-11): executed with the corrected fixture, arithmetic CONFIRMED (see the amended Empirical Evidence section). D7 rests on evidence, not inference.
- [ ] P2 execution — remains the slice-1 RED gate; divergence from the trace reopens D2.
- [ ] `claimLeaseMs` production value confirmation once boot-drain timings exist from the S3 integration suite (design default 10 min).

## Appendix A — Probe P1 (slice 2 RED test; place at `apps/api/tests/chaos/sagaWaitAmplification.test.ts`)

Run: `cd /root/omni-post/apps/api && NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=/root/omni-post/.env --env-file=/root/omni-post/.env.test tests/chaos/sagaWaitAmplification.test.ts` (no DB required — in-memory doubles).

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPostPublishingSagaDefinition } from "@shared/types/saga.js";
import { createChaosHarness, type ChaosHarness } from "./chaos-helpers.js";

const flushDispatch = async (): Promise<void> => {
  // executeSagaAsync defers via setImmediate; one macrotask turn plus slack
  // drains the dispatch and its awaited persists against in-memory doubles.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 25));
};

describe("P1 - sibling completion events burn the wait step's retry budget", () => {
  let harness: ChaosHarness;
  let pending = 4; // 4-channel publish: J1..J4
  before(async () => {
    harness = await createChaosHarness();
    const definition = createPostPublishingSagaDefinition(
      async () => ({ success: true, data: { postId: "post-p1", version: 1 } }),
      async (job) => `probe-${String(job.channelId)}`,
      async () => ({ completed: 4 - pending, failed: 0, pending })
    );
    harness.manager.registerSaga(definition);
  });
  after(async () => harness.teardown());

  it("a 4-channel publish reaches FAILED on the 3rd sibling event while all jobs complete", async () => {
    const instance = await harness.manager.startSaga("post-publishing-saga", {
      accountId: harness.accountId,
      metadata: {
        accountId: harness.accountId,
        mode: "publish-now",
        projectId: "proj-p1",
        // channelIds MUST live inside postData: readPostData reads
        // context.metadata.postData.channelIds (saga.ts:330-333, check :391-395).
        // Fixture corrected at gate — root-level channelIds killed step 0.
        postData: {
          locale: "en",
          body: "probe body",
          tags: [],
          mediaIds: [],
          channelIds: ["ch-1", "ch-2", "ch-3", "ch-4"],
        },
      },
    });
    await flushDispatch();
    let saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.retryCount, 1, "initial wait attempt burned retry 1 (pending=4)");

    // Expected burn: rc 1->2 (J1, pending 3), 2->3 (J2, pending 2), then J3's
    // event finds rc=3 == maxRetries -> exhausted -> retryable class -> failSaga.
    for (const _job of ["J1", "J2", "J3"]) {
      pending -= 1;
      await harness.manager.handleEvent({
        type: "publish.job.completed",
        metadata: { sagaId: instance.id },
      } as never);
      await flushDispatch();
    }
    saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.status, "FAILED", "FAILED from sibling events alone, no timer fired");
    assert.match(String(saga?.error), /still in progress/i);

    pending = 0; // the last job lands on a terminal row
    await harness.manager.handleEvent({
      type: "publish.job.completed",
      metadata: { sagaId: instance.id },
    } as never);
    await flushDispatch();
    saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.status, "FAILED", "all 4 channels published, saga stays FAILED");
  });
});
```

Post-fix (GREEN) expectation: rc stays 0 across sibling events (`waiting` exempt), terminal COMPLETED after the last event's trailing rerun.

**REPLACED AT GATE (2026-08-11, M2) — the earlier review annotation misdiagnosed
the break; this is the CONFIRMED diagnosis.** The signature matched and
`createChaosHarness` is the RIGHT harness; only the metadata shape was wrong:
`channelIds` sat at the metadata ROOT, while `ValidatePostDataStep` reads
`context.metadata.postData.channelIds` (`readPostData`, saga.ts:330-333; check
at :391-395) — the saga died at step 0. What gated re-execution was
**`handleEvent`'s step-identity filter (`SagaManagerLifecycle.ts:803`)**: step
0's id is not `wait-publishing-completion`, so `executeSagaAsync` was never
called. It is NOT a `nextRetryAt` guard — none exists anywhere on the dispatch
path. With the corrected fixture (now above) the gate CONFIRMED the arithmetic:
rc 1→2→3, FAILED on J3's event, all 4 channels published, zero timers;
`nextRetryAt` overwritten per event and left SET on the FAILED row
(corroborating P2). The de-amplification assertions of slice 2 may freeze on
this evidence. Do NOT rebuild on `saga-step-retry-recovery.test.ts` — that
instruction is withdrawn.

## Appendix B — Probe P2 (slice 1 RED test; extend `apps/api/tests/unit/saga/sagaBootResume.test.ts` harness)

Seed via the suite's `makeRow` with observable step doubles (attempt counters on `execute`/`compensate`), definition: two compensable + pivot + retryable, `retryPolicy { maxRetries: 3, backoffMs: 5000, exponential: true }`.

```typescript
// Crashed mid-auto-compensation, as the durable layer actually records it
// (trace: status never flipped; error null; nextRetryAt stale from the last
// retry scheduling; compensationResults never persisted mid-walk):
const row = makeRow("saga-p2-compcrash", {
  status: "RUNNING",
  currentStep: 1, // failed compensable step index
  stepResults: [
    { success: true, compensationData: { stepId: "step-0" } },
    { success: false, error: "retries exhausted" },
  ],
  compensationResults: [],
  retryCount: 3,
  nextRetryAt: new Date(Date.now() - 60_000), // variant A: stale past-due
});
// Variant B: nextRetryAt: null (no-retry-policy definitions).

// Act A: boot -> expect disposition "nextRetryAt-owned-by-checker"; then
// scheduler.triggerTask("saga-retry-recovery") dispatches it.
// Act B: boot -> expect disposition "resumed"; boot dispatches directly.

// Assert (both variants, RED at main):
//   step1.executeAttempts   === 1   // failed step re-executed FORWARD
//   step0.compensateAttempts === 0  // the walk never resumed
// GREEN after slice 1: disposition "compensation-resumed" in both variants
// (status-first check), step1.executeAttempts === 0,
// step0.compensateAttempts === 1, terminal COMPENSATED.
```
