# Root-cause verdict — `integration:saga-live` × 3 timeouts on `main`

## 1. The answer

**H3, with H1 refuted and H2 arithmetically excluded.** The suite is wired into a CI tier that boots the API alone and never starts `apps/workers`, so the publish jobs the three failing tests enqueue have no consumer; the saga correctly parks in `waiting` and its only remaining terminalizer is the 30-minute saga horizon, against a 120 s test budget.

**Production is NOT affected. No saga can hang.** I verified this directly, not by inference: in `api.log`, three worker-free publish sagas terminalized on their own at the horizon (`"error":"Saga timeout exceeded","reason":"timeout"`, 1815 s after start), and three _other_ sagas that sat parked for 22 minutes resumed and terminalized within seconds of a worker finally draining the queue (`"reason":"step-failure"`). The engine parks, re-arms, and recovers exactly as designed. **Do not rewrite the engine.**

What #184 actually did was correct and should stand: it removed a defect that was _masking_ this CI gap. Before #184, "no consumer" was itself a step failure that burned the retry budget and produced a fake `FAILED` in ~35 s — which is the only reason these tests were ever green in a worker-free CI. The tests were passing on the bug.

---

## 2. The mechanism

**The wait step (post-pivot, `retryable`) is level-triggered on queue state and, post-#184, spends no retry budget while undecided.**

`packages/shared/src/saga.ts:811-815` — the only live emitter of `waiting`:

```ts
if (status.pending > 0) {
  return { outcome: "waiting", reason: "Publishing jobs still in progress" };
}
```

`pending` comes from `packages/adapters/queue-bullmq/src/queue-adapter.ts:211-213`:

```ts
if (state === "completed") aggregate.completed++;
else if (state === "failed") aggregate.failed++;
else aggregate.pending++; // waiting / active / delayed / unknown
```

A BullMQ job with no consumer stays in `waiting` forever → `pending > 0` forever → `outcome: "waiting"` forever.

The engine's handling, `apps/api/src/saga/SagaManagerExecution.ts:515-545`, re-arms and returns — no retry consumed, no terminal transition:

```ts
if (stepResult.outcome === "waiting") {
  const armedBefore = instance.nextRetryAt;
  instance.nextRetryAt = new Date(Date.now() + this.waitPollMs());
```

Poll interval: `apps/api/src/config/env.ts:266` `SAGA_WAIT_POLL_MS … .default(30_000)`, wired at `apps/api/src/index.ts:710`. Scan tick: `SagaManagerLifecycle.ts:1319-1373` (`saga-retry-recovery`, `5000` ms) with predicate `status IN (RUNNING,PENDING) AND nextRetryAt <= now AND not null` (`:1342-1344`). Cadence per cycle = 30 s + ≤5 s.

The only terminalizer left is the horizon: `packages/shared/src/saga.ts:1006` `timeout: 30 * 60 * 1000`, swept by `saga-timeout-checker` (`SagaManagerLifecycle.ts:1378-1379`, 60 s granularity).

**The arithmetic that kills H2:** 1 800 s + ≤60 s ≈ **1815 s vs a 120 s budget — 15×**. Even the pessimal _worker-present_ path (jobs terminalize, every event lost, full 5+10+20 s post-pivot envelope per `saga.ts:1007-1011`, plus scan granularity) lands ≈85 s — inside 120 s. No runner speed, no tuning, closes a 15× gap.

**The missing piece (H3):** `.github/workflows/ci.yml:328-343` boots exactly one process — `pnpm --filter @apps/api dev:test &` — and `apps/api/package.json:9` starts `src/index.ts` only. The sole `QUEUE_NAMES.PUBLISH` consumer is `apps/workers/src/publishWorker.ts:194`; every `QUEUE_NAMES.PUBLISH` reference in `apps/api/src` is producer/admin/health (`index.ts:317`, `setupServices.ts:646,683`, `healthRoutes.ts:72`, `admin/queueRoutes.ts:260`). `rg -n 'apps/workers|dev:workers' .github/workflows/` returns **only fitness.yml grep-pattern strings** — no workflow in the repo has ever started the workers.

The test file states the requirement itself, `apps/api/tests/integration/sagaCustomerFlow.test.ts:13-14`:

> `The dev environment (`pnpm dev`) MUST be up — API on 3000, workers consuming the publish queue.`

And root `package.json:28` is `"dev": "turbo run dev --filter=@apps/api --filter=@apps/workers"`. **Locally both halves run; in CI only one does.** That is the whole defect.

---

## 3. The evidence that decided it

### OBSERVED — local A/B, same commit (`8e89b21f`), same API process, only variable = workers

| Test                                                    | Run A (API only)                     | Run B (API + workers)                |
| ------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| runs publish-now end-to-end through the worker pipeline | ✖ **120159.236 ms**                  | ✔ **59700.950 ms**                   |
| reports a multi-channel publish … three-state contract  | ✖ **120093.305 ms**                  | ✔ **50004.559 ms**                   |
| does NOT compensate steps at or after the pivot …       | ✖ **120101.573 ms**                  | ✔ **59653.451 ms**                   |
| other 11                                                | ✔ (1.1–225.9 ms)                     | ✔ (1.3–223.3 ms)                     |
| suite                                                   | **11 pass / 3 fail — 361289.311 ms** | **14 pass / 0 fail — 170283.472 ms** |

Artifacts read and confirmed: `/tmp/claude-0/-root-omni-post/0c4404f3-535e-4fdd-84ff-6c4c1dcf6a70/scratchpad/runA-noworkers.txt`, `.../runB-withworkers.txt`.

Run A reproduces CI's own signature. From #184's **own** job log (run `31910707460`, job `95075209447`):

```
22:04:18.2725850Z  integration:saga-live  14 tests  11 pass  3 fail  0 cancel  0 skip  exit 1  [FAIL]
   not ok 3 - runs publish-now end-to-end through the worker pipeline      duration_ms: 120215.299968
   not ok 4 - reports a multi-channel publish …                            duration_ms: 120117.751217
   not ok 14 - does NOT compensate steps at or after the pivot …           duration_ms: 120087.284602
   error: 'Saga … did not reach terminal state within 120000ms'
```

Batch wall: `21:58:15.967 → 22:04:18.273` = **362.3 s ≈ 3 × 120 s + ~2 s** — i.e. nothing else in the batch was slow. Three exact budget burns with zero partial progress is not "slow", it is "nothing is finishing".

### OBSERVED — the saga's actual fate, from `api.log` (this is what settles H1)

`api.log` is written by the long-running API (pid 361980) and predates my work. Two independent facts:

**(a) The horizon is the real terminalizer, measured.** Saga `821038ec` first polled at epoch `1786859424421` = `2026-08-16T05:50:24.421Z`; terminal at:

```json
{
  "time": "2026-08-16T06:20:39.825Z",
  "sagaId": "saga-post-publishing-saga-821038ec-…",
  "error": "Saga timeout exceeded",
  "reason": "timeout",
  "msg": "Saga failed"
}
```

Δ = **1815.4 s** = 1800 s horizon + one 60 s checker tick. Two siblings did the same at 06:22:39.824 and 06:24:39.825. **This is a direct measurement of the 30-minute bound on a worker-free publish saga.** It also independently corroborates the reported DB trajectory (`retryCount` pinned at 0): had the step been spending retry budget, these would have died at ~35 s, not ~1815 s.

**(b) A 22-minute-parked saga resumed on the first real signal.** Run A's three orphans, still `RUNNING` when workers were started at 17:16:30:

```json
{"time":"2026-08-16T17:17:21.836Z","sagaId":"…b4a52729…","error":"2 out of 2 publishing jobs failed","reason":"step-failure"}
{"time":"2026-08-16T17:17:26.837Z","sagaId":"…9f15eeee…","error":"1 out of 1 publishing jobs failed","reason":"step-failure"}
{"time":"2026-08-16T17:17:26.837Z","sagaId":"…5026a48c…","error":"1 out of 1 publishing jobs failed","reason":"step-failure"}
```

`9f15eeee` was parked **1355 s** (22.6 min, i.e. _before_ the horizon at 1800 s) and terminalized via `step-failure` — the arriving worker event, not a timeout. **A hung engine does not do that.**

### OBSERVED — the regression bracket, from run data

`gh run list --workflow=ci.yml --branch main`:

| Merge    | SHA        | Run             | Result      | saga-live                                                 |
| -------- | ---------- | --------------- | ----------- | --------------------------------------------------------- |
| #182     | `5661adf9` | 31554773777     | success     | —                                                         |
| #183     | `699be4ff` | 31565326977     | success     | `13 tests 13 pass 0 fail exit 0 [OK]`, wall **98.5 s**    |
| **#184** | `57374636` | **31910707460** | **failure** | `14 tests 11 pass 3 fail exit 1 [FAIL]`, wall **362.3 s** |
| #185     | `8e89b21f` | 31926262264     | failure     | same three, `120034 / 120191 / 120157 ms`                 |

**CI wiring did not change.** `git diff --stat 699be4ff..57374636 -- .github/ apps/api/scripts/` → no `.github/` file at all; `run-tests.sh` +3/−1, and that hunk only adds `sagaWaitAmplification.test.ts` to the `chaos` batch. The saga-live batch line, its tier, and `TIMEOUT=180000` are byte-identical (`apps/api/scripts/run-tests.sh:283-284`).

### OBSERVED — why it used to pass

`git show 699be4ff:packages/shared/src/saga.ts` (lines 743-745):

```ts
if (status.pending > 0) {
  return { success: false, error: "Publishing jobs still in progress" };
}
```

A step **failure**, spending the post-pivot retry budget (`maxRetries: 3, backoffMs: 5000, exponential: true`) = 5+10+20 ≈ 35 s to a terminal `FAILED`, which `waitForTerminal`'s `TERMINAL` set accepts (`sagaCustomerFlow.test.ts:75`). Old budgets were 60 s and 90 s. 13 tests × ~98.5 s wall fits exactly.

INFERRED (only this link): that the pre-#184 greens were produced by that path _specifically_ rather than by a worker — the timing is equally consistent with a worker present, but no worker was ever started in CI (structural, above), so the amplification path is the only one available.

---

## 4. What was refuted — do not re-derive these

1. **H1 — a real engine hang shipped by S2.** Refuted twice over: statically (both re-entry seams are level-triggered — a dropped `scan` costs ≤5 s because `SagaManagerLifecycle.ts:1342-1348` re-queries the same durable `nextRetryAt` every tick, and a dropped event costs ≤1 poll because `saga.ts:796` re-reads `checkJobsStatus` on every entry and carries no per-event state), and empirically (§3b: a 22-minute-parked saga terminalized within seconds of a real event).
2. **H2 — CI slowness against a 120 s budget.** Refuted by arithmetic: worker-free the bound is 1815 s (measured), 15× the budget; worker-present the pessimal bound is ~85 s. There is no configuration of "slow runner" in between that produces three identical 120 s burns.
3. **"The suite was newly wired in #184."** False. `git log -S 'integration:saga-live' -- apps/api/scripts/run-tests.sh` → single commit `8e11245d` (2026-08-05, PR #173). It ran and passed on main at #173, #180, #181, #182, #183.
4. **"The batch is a rate-limiting victim."** Checked and dead: `EXPENSIVE_ENDPOINT_RULES` / `STANDARD_ROUTE_RULES` in `apps/api/src/security/httpRateLimitPreHandler.ts:55-109` contain no `/sagas` path, so `waitForTerminal`'s 200 ms polling is not throttled.
5. **"The `curl: (7)` lines mean a service was missing."** No — that is the health-poll succeeding: 6 retries then `Server listening at http://127.0.0.1:3000` and a 200 on `/health`, ~11 s of a 90 s budget, and 33/33 + 69/69 live-API tests passed downstream in the same job.
6. **"Jobs were never enqueued (saga stuck pre-pivot)."** Excluded arithmetically: a missing job counts as `failed` (`queue-adapter.ts:204-206`), so `pending` would reach 0 and the step would terminalize in ~35 s, not 120 s.
7. **"All three failures are simply 'the publish-now tests'."** Imprecise — 7 of the 14 tests send `mode: "publish-now"` and 4 of them pass. The real discriminator is _tests that successfully start a saga and then call `waitForTerminal`_.
8. **`TIMEOUT=180000` is a batch wall.** It is not; it is the per-test `--test-timeout`. `0 cancel` in every run confirms no test was killed by it.
9. **Citation corrections carried into the record:** the CI boot step is `ci.yml:328-343` (not 324-348); the batch line is `run-tests.sh:283-284` (not 284-285); the test docstring is at `:13-14` (not 15-16); the three "run IDs" quoted in one angle (`95114234871` etc.) are **job** IDs and belonged to #185's run, not #184's — #184's real run/job are `31910707460` / `95075209447`, and I re-quoted every number above from that log.

---

## 5. The minimal fix, in order

**Fix 1 — CI wiring (this is the whole failure). Start `apps/workers` in the push tier.**
`.github/workflows/ci.yml`, alongside the existing `Start API in background` step (`:328-343`), add a worker boot with the same env, and health/readiness-gate it before the full-tier step at `:346`. Measured outcome: Run B, same commit, same API → **14/14 in 170.3 s**.

**Fix 2 — make the wiring self-enforcing (test-side).** The suite's precondition is a comment (`:13-14`) and a `checkApiAvailable()` probe that only checks the API. Add a fail-loud precondition that the publish queue has a live consumer (e.g. assert `Queue.getWorkersCount() > 0`, or extend the existing health probe) so a worker-less environment fails in seconds with "no publish worker" instead of burning 6 minutes and reporting "did not reach terminal state". Per project canon this is the "fail loud rather than skip" shape the file already claims.

**Fix 3 — separate, real, and not the CI cause: `SagaManagerExecution.ts:523-541`.** On the **first** entry into the wait step, `armedBefore` is always `undefined` (the pivot cleared it at `:641` and persisted `nextRetryAt: null` at `:1400`). So the persist-failure branch at `:528-529` restores `undefined`, leaving a durable row `RUNNING` with `nextRetryAt = NULL` — which the scan predicate `nextRetryAt: { lte: now, not: null }` (`:1343-1344`) **can never select**. The log line at `:536-539` says the opposite ("re-selected on the existing schedule"). Bounded by the horizon, requires a DB write failure, so it is not this bug — but it is a genuine defect with a lying log, and it should be fixed on its own merits.

**Do NOT do any of these:**

- **Do not raise the 120 s budget.** Worker-free, _no_ budget under 30 minutes can pass; a 30-minute budget would be a 30-minute CI job asserting nothing.
- **Do not raise / touch the 30-minute horizon (`saga.ts:1006`) or `waitPollMs`** to make CI green. That re-hides the gap.
- **Do not revert #184's `waiting` outcome.** Reverting restores the amplification defect (`git show 699be4ff:packages/shared/src/saga.ts:743-745`) that the new `apps/api/tests/chaos/sagaWaitAmplification.test.ts` exists to prevent — and that defect turns a worker outage into a _false_ `FAILED` on posts that may still publish.
- **Do not delete or skip the three tests.** They are the only end-to-end coverage of the publish path.

_Residual to price, not to fix now:_ with workers, the two long tests land at 59.70 s / 59.65 s against 120 s — two poll intervals of headroom on a homelab. A GitHub runner sharing ~4 vCPU across API + workers + Postgres + Redis is slower. If it proves tight, the correct lever is lowering `SAGA_WAIT_POLL_MS` in the CI env (floor 1000, `env.ts:266`), which shortens the deterministic tail — **not** raising the budget.

---

## 6. Blast radius

**Production: none from this mechanism.** The engine terminalizes worker-free sagas at 1815 s (measured) and resumes parked ones on the first real event (measured). Both halves of the canon terminal guarantee hold.

**One production-relevant behavior change worth telling operators about (not a hang):** post-#184, a publish-worker outage surfaces as a saga failure after **~30 minutes** instead of ~35 seconds. That is _more_ correct — the old 35 s `FAILED` was a lie about posts that could still publish — but it changes the detection window. If nothing alerts on "sagas RUNNING > N minutes" or on publish-queue depth, that is now the gap to close. The code comment at `saga.ts:801-805` already names this trade-off for the unreadable-queue case.

**Elsewhere on main: nothing else is affected.** Every other batch in the same #184 job passed, including `chaos 3/3`, `integration:saga-recovery 19/19`, `flow 34/34`, `remaining 167/167`. Those exercise the engine through harnesses/stubs, not a live BullMQ consumer.

**Are the other 11 green for the right reason? Yes — structurally, not by luck.** Tests 1, 2 and 13 use `mode: "draft"` / `"schedule"`, and the wait step short-circuits those before it ever reads the queue (`packages/shared/src/saga.ts:762-780`: `if (mode === "draft" || mode === "schedule") … return { outcome: "succeeded", data: { skipped: true … } }`). Tests 5–12 assert 400/404/401 and never create a saga. None of them can be affected by a missing consumer, in CI or anywhere else. The partition is exact once you draw it on the right attribute (starts a saga **and** waits for terminal), not on `mode: "publish-now"`.

---

## 7. The process failure (`N-CI-2`) and its fix

**Confirmed on the exact PR that shipped this.** PR #184's own pre-merge run (`31897704078`, event `pull_request`, conclusion **success**) ran with `TIER: pr-integration` and executed 7 DB-only batches — `repositories, sync, outbox, consumers, chaos, tenant-isolation, saga-recovery` — and stopped. No `Start API` step, no `integration:routes`, no `integration:flows`, **no `integration:saga-live`**.

The mechanism is two lines:

- `apps/api/scripts/run-tests.sh:58-61` — `run_live_api_batches() { [ -z "$TIER" ] || [ "$TIER" = "full-integration" ]; }`, guarding the block at `:268` that contains the saga-live batch at `:283`.
- `.github/workflows/ci.yml:310-315` — PRs get `TIER: pr-integration`; only `github.event_name == 'push'` gets `TIER: full-integration` (`:350`).

So a saga-touching PR is merged on evidence that structurally excludes the saga's live path, and the first signal arrives on `main` — after the merge. That is exactly how this landed, twice.

**What should change, concretely:** gate PRs that touch saga surfaces on the live tier. A path-filtered job (`packages/shared/src/saga.ts`, `apps/api/src/saga/**`, `apps/workers/src/publish*`, `packages/adapters/queue-bullmq/**`, `apps/api/tests/integration/sagaCustomerFlow.test.ts`) that runs the same steps the push tier runs — boot API **and** workers, `TIER: full-integration` — and is a required check. Fix 1 above must land first, or the new gate is red by construction.

**The trade-off, with real numbers:**

- PR-tier Integration Tests today: `17:13:44Z → 17:16:41Z` = **2 m 57 s**.
- Push-tier Integration Tests on the last green main (#183): `05:04:29Z → 05:10:31Z` = **6 m 02 s**.
- `integration:saga-live` alone: **98.5 s** green pre-#184, **362.3 s** in the failing state, **170.3 s** locally with workers (i.e. expect the batch to roughly double once the workers actually run and the tests take their real path).

So: **roughly +3 to +4 minutes on saga-touching PRs, unconditionally, to stop merging saga changes on evidence that cannot see them.** Path filtering keeps the cost off every other PR. The alternative — leaving the current split — has now cost two red merges on `main` and a full diagnosis session; the batch is cheaper than the incident.

If the full delta is judged too expensive, the acceptable-but-weaker fallback is a PR-tier _smoke_ variant: boot API + workers and run only the three worker-dependent cases (~60 s each, run in sequence ≈ 3 min) rather than the whole 14. Do **not** settle for "run saga-live on PRs without workers" — that is the current failure with extra steps.

---

## 8. Confidence, and what I could not settle

**Very high (≥95%) that H3 is the cause and that production is unaffected.** It rests on four independent legs, each with a durable artifact: the workflow boots one process and no workflow in the repo mentions the workers; the A/B flips exactly the three tests and nothing else, reproducing CI's durations to the millisecond band; `api.log` shows the 1815 s horizon terminalization _and_ the 1355 s parked-then-resumed recovery; and the pre-#184 source at `699be4ff:saga.ts:743-745` explains every prior green.

**High (~90%) that H1 is dead as a _production_ concern.** The static trace shows both re-entry seams are level-triggered, and the empirical resume at 17:17 is a direct counter-example to "hung". The residual uncertainty is a rare interleaving under a persist failure — bounded in every case by the horizon, which I measured firing correctly.

**What I could not settle:**

1. **The per-cycle DB trajectory could not be re-verified by me.** Postgres 5432 and Redis 6379 are both `Connection refused` now (checked), so the reported `retryCount = 0` / `nextRetryAt` +35.00 s samples are not re-runnable. They are, however, corroborated by a durable independent fact: a saga that terminalized at 1815 s cannot have been spending a 35 s retry budget. The `waiting` re-arm itself is `logger.debug` and `api.log` contains no level-20 lines, so the per-poll log is absent by configuration, not by failure.
2. **No CI-side telemetry exists for the failing window.** The API's stdout stops appearing in the job log at `21:55:50` (its last `/health` response), five seconds before the test step opens; `rg -i saga` past that point returns only TAP output. So the CI-side chain (jobs stay `waiting` → `pending > 0` → 30-min horizon) is deduced from code plus the local reproduction, not read off a CI log. Cheap confirmation if anyone wants it before touching the tier: assert on `data.currentStep` / `data.stepResults` inside `waitForTerminal`'s throw, or add a `redis-cli LLEN bull:publish:wait` probe after the batch.
3. **Whether the 120 s budget is comfortable on a GitHub runner** once workers are started. Measured 59.7 s on a homelab; the runner is slower and will be sharing CPU with two more processes. Watch it after Fix 1; the lever is `SAGA_WAIT_POLL_MS`, not the budget.
