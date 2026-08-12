# Tasks: Saga Engine Terminal Hygiene (N-COR-2c + compensation integrity + SMELL-73)

> Strict-TDD, dependency-ordered — RED precedes GREEN inside every slice. Four chained PRs,
> **stacked-to-main** (cached strategy), on branch `workstream/saga-engine-terminal-hygiene`
> off main 63c10f07: **PR1 = S0 gate honesty (micro-PR)** · **PR2 = S1 durable compensation** ·
> **PR3 = S2 waiting≠failed** · **PR4 = S3+S4 schema slices sharing ADR-1**.
>
> **The design's `AMENDED AT GATE (2026-08-11)` blocks are AUTHORITATIVE** over any conflicting
> original prose: P1's arithmetic is CONFIRMED empirical evidence; C1 replaces the ordinary
> `startedAt` backstop with a COMPENSATING liveness horizon; C2 is a cross-slice MERGE-BLOCKING
> invariant; C3 removes the fitness #23 pair edit (the regex never fires on the claim syntax);
> M1-M6 fix the claim boundary (`withSagaSystemClaim`), the scoped `multi-tenant-isolation`
> delta, the metric unions, the runner wiring rule, and `waitPollMs = 30000`.
>
> **Invariant threaded through PR2 and PR3, codified VERBATIM (C2, MERGE-BLOCKING):**
> **`executeSaga` SHALL REFUSE a row whose persisted status is `COMPENSATING`** (log +
> `recordSagaRecoveryFailure("compensation")`, never a forward run), **and D7b's trailing rerun
> SHALL RE-READ the persisted status before re-entering.** PR2 ships the refusal (it is PR2 that
> makes a durable `COMPENSATING` row exist); PR3 ships the trailing-rerun re-read.
>
> Edward's three product decisions are FIXED inputs: (1) the admin re-drive RESUMES from durable
> per-step progress, never restarts the walk; (2) NO new customer notification accompanies the
> `FAILED → COMPLETED` correction; (3) the `compensatingOrphans` alert thresholds move INSIDE
> PR2's diff.
>
> **Zero-patch rule (Edward, permanent):** if an executed probe diverges from the design's trace
> — P2 in Phase 3 above all — STOP, report, and re-decide the design point. Do not patch around
> a refuted trace.

## Sensitive-edit gate

- **PR1 (S0), PR2 (S1), PR3 (S2): NO token required.** Verified at the gate: D3's durable
  per-step progress needs NO schema change (`compensationResults Json @default("[]")`,
  `infra/prisma/schema.prisma:2055`) and C1's liveness anchor needs none either
  (`updatedAt DateTime @updatedAt @db.Timestamptz(6)`, `:2066`). Nothing under `infra/prisma/**`
  is touched before PR4.
- **PR4 (S3+S4): TOKEN REQUIRED — `omnipost-allow sensitive-edit`** for
  `infra/prisma/schema.prisma` (claim columns on `SagaInstance:2048-2073`; new
  `SagaParkedWindow` model) and both migration directories. **Run `pnpm db:up` FIRST** — never
  skip or defer a migration because the database is not running.
- Tasks marked **[SENSITIVE]** are the only ones that consume the token. Everything else in PR4
  is ordinary code.

## Command legend (LXC-safe, single-file — heap 3072, never the full local suite)

- **DBUP**: `pnpm db:up` (before any migration or DB-backed test)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/api exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **INT-LONG `<file>`**: INT plus `--test-timeout=120000` for `sagaCrashRecovery` (its batch is
  `TIMEOUT=120000`, `run-tests.sh:214`) and `--test-timeout=180000` for `sagaCustomerFlow`
  (`:237`). The 30000 default cancels both.
- **CHAOS `<file>`** (from `apps/api`, **no DB**, in-memory doubles — the Appendix A run line):
  `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **GATE-SELFTEST**: run `apps/api/scripts/run-tests.sh` under `bash` directly with a fixture
  suite / an unreachable `DATABASE_URL`; assert the SCRIPT's exit code. No DB, no CI wiring
  (wiring it into a batch would make the script invoke itself).
- **MIGRATE** \[PR4 only]: DBUP → author `prisma migrate dev --create-only --name <name>`
  (hand-edit SQL) → apply `pnpm db:migrate`
- **LIVE-API** \[PR3 evidence only]: `set -a; source .env; source .env.test; set +a; pnpm dev:api`
  → port 3001; run the suite with `BASE_URL=http://localhost:3001` (the suite signs JWTs with
  the `.env` + `.env.test` pair; a plain-dev server rejects every token). Kill the server and
  verify the port is free afterwards.

**Files the legend applies to in this change** — new: `tests/chaos/sagaWaitAmplification.test.ts`,
`tests/unit/saga/sagaCompensationWalk.test.ts`, `tests/unit/saga/sagaStepOutcome.test.ts`,
`tests/unit/saga/sagaClaimPredicate.test.ts`, `tests/unit/saga/runTestsGate.static.test.ts`,
`tests/integration/sagaCompensationRecovery.test.ts`, `tests/integration/sagaClaimContention.test.ts`,
`tests/integration/sagaParkedWindow.test.ts`; extended: `tests/unit/saga/sagaBootResume.test.ts`,
`tests/unit/saga/sagaContextInvariants.static.test.ts`, `tests/integration/sagaCrashRecovery.test.ts`,
`tests/integration/sagaCustomerFlow.test.ts`.

## Review Workload Forecast

| Field                   | Value                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Estimated changed lines | PR1 ~110-160 · PR2 ~580-700 · PR3 ~600-760 · PR4 ~900-1120 · combined ~2190-2740          |
| 400-line budget risk    | High                                                                                      |
| Chained PRs recommended | Yes                                                                                       |
| Suggested split         | PR 1 (S0 gate honesty, micro) → PR 2 (S1 compensation) → PR 3 (S2 outcome) → PR 4 (S3+S4) |
| Delivery strategy       | ask-on-risk — already RESOLVED by Edward (chained PRs)                                    |
| Chain strategy          | stacked-to-main (cached)                                                                  |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Rationale: the chained-PR question and the chain strategy are both already answered, so no
pre-apply decision remains. Only PR1 fits inside the 400-line budget; PR2-PR4 are over it and the
overage is **test-dominated** (each slice carries a merge-blocking integration proof plus static
invariants). The slice boundaries are the design's own and are NOT re-cuttable downward without
shipping a regression: **S1 cannot be split** (persisting `COMPENSATING` without the boot
disposition and the C2 refusal leaves rows nobody advances), **S2 cannot be split** (the union
rebuild is a compile-wide contract change — a partial union does not compile), and **S3 cannot
precede S1** (there is nothing durable to claim). The only lawful sub-split, if a reviewer demands
≤400: PR4 splits back into `PR4a = S3 claims + ADR-1` then `PR4b = S4 parked window` — both are
independently additive migrations. Escalate that sub-split only on request.

### Suggested Work Units

| Unit | Goal                                                                                                                                                                              | Likely PR | Focused test command                                                                                                          | Runtime harness                                                                                                                                                            | Rollback boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Gate honesty: the run exits non-zero whenever any batch is recorded failed; the dead second-engine registration is gone; the planning record matches the code                     | PR 1      | VITEST `tests/unit/saga/runTestsGate.static.test.ts`                                                                          | GATE-SELFTEST: fixture suite exiting non-zero with `# fail 0 / # cancelled 0` → script exit 1; plus the dead-`DATABASE_URL` reproduction on `integration:saga-recovery`    | **WHOLE-COMMIT REVERT ONLY** (`git revert <sha>`). A script-only revert is NOT a valid mitigation: the merge-blocking `runTestsGate.static.test.ts` and `runTestsGate.behavior.test.ts` live under `tests/unit/**`, so a shard job asserts the gate's shape and its exit code — reverting `run-tests.sh` alone turns those suites red in a DIFFERENT job, i.e. the mitigation itself breaks CI. The commit also fuses two rollback domains on purpose: the runner change is CI-immediate (effective next run, no deploy) and the composition-root deletion is effective only at redeploy. Reverting either reverts both; the consequence is bounded because the deleted registration is provably inert (lazy factory, zero resolvers) | \| true`, and the deleted registration/token. No runtime behavior depends on it |
| 2    | Durable, honest compensation: `COMPENSATING` written before the walk, per-step progress durable, boot resumes the WALK, liveness horizon terminalizes a stalled one, gauge honest | PR 2      | VITEST `tests/unit/saga/sagaBootResume.test.ts` + `sagaCompensationWalk.test.ts`; INT-LONG `sagaCompensationRecovery.test.ts` | DBUP + real Postgres: kill between per-step persists → boot through the production composition → walk completes, no forward step, terminal `COMPENSATED` read from the row | Revert removes the write-ahead transition, the per-step persists, the `compensation-resumed` disposition, the C2 refusal, the liveness branch and the alert edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3    | waiting ≠ failed: three-state outcome, no budget burned by sibling events, one advancer per saga, the four-channel publish COMPLETES                                              | PR 3      | CHAOS `tests/chaos/sagaWaitAmplification.test.ts`; VITEST `tests/unit/saga/sagaStepOutcome.test.ts`                           | CHAOS harness (`createChaosHarness`, zero timers, in-memory doubles) + INT-LONG `sagaCrashRecovery.test.ts` for the D8 evidence split                                      | Revert restores the boolean `SagaStepResult` and today's budget path; legacy rows keep replaying either way (the normalizer is read-side only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4    | Row ownership + durable park window: both readers claim at selection, starvation closed, bounds settable in production, the operator window survives restarts                     | PR 4      | INT `tests/integration/sagaClaimContention.test.ts`; INT `tests/integration/sagaParkedWindow.test.ts`                         | DBUP + two managers against one real DB (each row advanced by exactly one) + restart-survival run with part of the window elapsed                                          | Revert drops the columns/table (additive down migrations); pre-change code ignores claim/park metadata, so a code-only revert is also safe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

# PR1 — S0: gate honesty (micro-PR, lands first)

Every later "the tests pass" claim in this change depends on this PR.

## Phase 0: RED — the gate cannot see a runner crash

- [x] 0.1 [RED] **[MERGE-BLOCKING]** Create `apps/api/tests/unit/saga/runTestsGate.static.test.ts`
      (vitest, `@file`/`@description`/`@layer infrastructure`) — parses
      `apps/api/scripts/run-tests.sh` as text and asserts: (a) the FINAL gate condition (`:279`)
      references `FAILED_BATCHES` (or the aggregated runner exit) so no path exists on which a
      batch is recorded failed and the script exits zero; (b) the vitest phase (`:122`) does NOT
      discard its runner exit with `|| true`, and a non-zero vitest exit appends `vitest-unit` to
      `FAILED_BATCHES` even with 0 parsed failures; (c) the header comment (`:4`) carries no rotted
      test count. RED at main on all three.
      **Evidence:** VITEST `tests/unit/saga/runTestsGate.static.test.ts` at main → **7 failed / 3
      passed (10)**. The 3 green are the non-vacuity anchor plus the two halves that already
      shipped (`run_batch` records a failed batch on `runner_exit != 0`; the count-based
      `vitest-unit` append). RED for the named mechanisms: `finalGateCondition()` lacked
      `FAILED_BATCHES`; the vitest line ended `|| true`; the header read
      `# All 283 unit tests (tests/unit/**) have been migrated to Vitest.`
- [x] 0.2 [RED] Create the two reproduction fixtures under
      `apps/api/tests/fixtures/run-tests-gate/` (`.fixture.ts` suffix — outside vitest's
      `tests/unit/**` include at `vitest.config.ts:45` and outside every explicit node:test batch
      list, so neither collector ever picks them up): (a) `cleanExitNonZero.fixture.ts` — one
      passing test, then a hook that exits the process non-zero AFTER the TAP summary
      (`# fail 0`, `# cancelled 0`, runner exit ≠ 0 — the exact shape `run-tests.sh:66-68`
      names and the current gate cannot see); (b) `brokenHook.fixture.ts` — a throwing `before`
      hook (cancelled subtests with `# fail 0`, the shape 9R.7 already covers, kept as the
      control that must stay red).
      **DIVERGENCE from the task's fixture mechanics, reported not patched around.** Shape (a) as
      written is UNREACHABLE: node:test isolates every file in a child process and reports a child
      that ends non-zero as a FAILED file-level test, so a hook inside the fixture yields
      `# fail 1` — measured: `# tests 2 / # pass 1 / # fail 1 / # cancelled 0`, runner exit 1 —
      which is the shape the gate ALREADY caught. Only the runner process itself can end non-zero
      with clean counts, which is what "crashed after the summary" means. Two `--import`-based
      attempts to reach the parent were also refuted (node does not apply user `--import` to the
      test-runner parent: the module loaded once, with `NODE_TEST_CONTEXT=child-v8`). The design
      point D1 is UNAFFECTED and in fact strengthened — the class is reachable by more routes than
      the fixture assumed. Shipped: `cleanExitNonZero.fixture.ts` is the clean-counts PASSING half,
      and the non-zero runner exit is injected at the runner in the two ways that really occur
      (a batch listing a path that no longer exists; a `node` shim that turns a zero exit
      non-zero). `crashAfterSummary.fixture.ts` was authored and DELETED once refuted.
- [x] 0.3 [RED] GATE-SELFTEST both shapes and record the exit codes as evidence: shape (a) must
      currently print `[FAIL]` for its batch and still exit **0** (the defect); shape (b) must
      already exit 1 (the control). Also re-run the previous change's dead-`DATABASE_URL`
      reproduction against `integration:saga-recovery` (`run-tests.sh:214`) to confirm the
      cancelled path is unaffected by this slice. Run VITEST 0.1 → RED for the right reasons.
      **Evidence (BEFORE, `TIER=full-integration`, derived copies whose `run_batch` and final gate
      are byte-identical to the real script — only the batch inventory is substituted):**
      **A1** `gate-selftest-clean` `1 tests 1 pass 0 fail 0 cancel exit 0 [OK]` +
      `gate-selftest-missing` `0 tests 0 pass 0 fail 0 cancel exit 1 [FAIL]` →
      `TOTAL: 1 tests, 1 pass, 0 fail, 0 cancel` → **SCRIPT_EXIT=0** (the defect).
      **A2** `gate-selftest-clean` `1 tests 1 pass 0 fail 0 cancel exit 3 [FAIL]` →
      `TOTAL: 1 tests, 1 pass, 0 fail, 0 cancel` → **SCRIPT_EXIT=0** (the defect).
      **B** `gate-selftest-brokenhook` `2 tests 0 pass 0 fail 2 cancel exit 1 [FAIL]` →
      **SCRIPT_EXIT=1** (control, already red). **C** healthy `exit 0 [OK]` → **SCRIPT_EXIT=0**.
      **E** vitest phase forced to `exit 4` while printing `12 passed` → **SCRIPT_EXIT=0** (the
      defect). **D** `integration:saga-recovery` against an unreachable `DATABASE_URL` →
      `17 tests 0 pass 0 fail 17 cancel exit 1 [FAIL]` → **SCRIPT_EXIT=1**.
      Neither A1 nor A2 printed `FAILED batches:` at all before the fix — the gate never fired. D
      reproduces the previous change's recorded numbers verbatim (17 cancelled, exit 1).

## Phase 1: D1 — GREEN, one source of failure truth

- [x] 1.1 [GREEN] `apps/api/scripts/run-tests.sh:279` — final gate becomes
      `if [ "$TOTAL_FAIL" -gt 0 ] || [ "$TOTAL_CANCEL" -gt 0 ] || [ -n "$FAILED_BATCHES" ]`.
      `FAILED_BATCHES` is already populated on `runner_exit != 0` (`:97-100`), so no second
      accumulator is introduced (a `TOTAL_RUNNER_EXIT` integer was rejected in D1: it duplicates
      state and hides WHICH batch failed). Print a dedicated ERROR line when the gate fires with
      `fail=0 cancel=0` so CI logs say why.
      **Shipped verbatim** as the three-term condition; no `TOTAL_RUNNER_EXIT` accumulator. The
      dedicated line fires on `TOTAL_FAIL -eq 0 && TOTAL_CANCEL -eq 0`; the pre-existing cancelled
      message moves to the `elif` and is unchanged.
- [x] 1.2 [GREEN] `run-tests.sh:122` — capture the vitest runner exit (`|| vitest_exit=$?`
      instead of `|| true`) and append `vitest-unit` to `FAILED_BATCHES` when it is non-zero,
      independently of `VITEST_FAILED` (`:135-137` keeps its count-based append).
      **Shipped** as `VITEST_EXIT=0` + `|| VITEST_EXIT=$?`; the count-based append is untouched and
      the new branch is guarded on `VITEST_FAILED -eq 0` so a doubly-failing run is not listed
      twice. It also prints `[FAIL] vitest-unit: runner exited N with 0 parsed failures`.
      **Evidence:** vitest phase forced to exit 4 while printing `12 passed` → BEFORE `SCRIPT_EXIT=0`
      (silent), AFTER `SCRIPT_EXIT=1` with `FAILED batches: vitest-unit`; clean control
      (exit 0, `12 passed`) → `SCRIPT_EXIT=0` both ways.
- [x] 1.3 [GREEN] `run-tests.sh:4` — replace the rotted "All 283 unit tests" header comment with a
      statement that does not carry a count (counts rot; the batch lists are the truth).
      **Shipped**: the header now points at `vitest.config.ts` for unit collection and at the batch
      lists as the node:test inventory, and states why no total appears. Pinned by the static
      assertion "states no test count" (rejects any 2+ digit run in the header block).
- [x] 1.4 [GREEN] Delete the dead second-engine registration:
      `apps/api/src/infrastructure/container/setupServices.ts:936-958` (the whole
      `container.register<SagaManagerImpl>(TOKENS.SagaManager, …)` block) + the now-orphaned
      import `setupServices.ts:83` + the token `apps/api/src/infrastructure/container/types.ts:188`.
      Blast radius re-verified before deleting: zero resolvers repo-wide; `createRedisConnection`
      and `EventService` imports have other users and STAY.
      **Blast radius re-verified before deleting (own grep, never assumed):**
      `rg 'TOKENS\.SagaManager\b|SagaManager:\s*Symbol' apps packages infra --type ts` → exactly
      **2 hits**, the declaration (`types.ts:188`) and the registration (`setupServices.ts:938`);
      **zero resolvers**. `SagaManagerImpl` appeared only in the dead block (3 hits, all deleted);
      `createRedisConnection` has 10 other call sites and `EventService` 3, so both imports STAY.
      After deletion: `rg 'TOKENS\.SagaManager|Symbol\.for\("SagaManager"\)'` repo-wide (excluding
      `openspec/`) → 0. A comment at the deleted registration's spot states where the one engine
      IS constructed, so the next reader does not re-add it.
- [x] 1.5 Run VITEST 0.1 → GREEN; re-run GATE-SELFTEST 0.3 shape (a) → the script now exits **1**
      with the batch named, shape (b) still exits 1, and a fully green run still exits 0
      (no false positive).
      **Evidence (AFTER, same derived copies, same commands):**
      **A1** → **SCRIPT_EXIT=1**, `FAILED batches: gate-selftest-missing`, plus the new
      `ERROR: every test that ran reported passing, yet a batch runner exited non-zero. …`.
      **A2** → **SCRIPT_EXIT=1**, `FAILED batches: gate-selftest-clean` (1 pass, 0 fail, 0 cancel,
      runner exit 3), same ERROR line. **B** → **SCRIPT_EXIT=1**,
      `ERROR: 2 test(s) were CANCELLED …` (control unchanged). **C** → **SCRIPT_EXIT=0** (no false
      positive). **G** the REAL DB-free `chaos` batch `1 tests 1 pass 0 fail 0 cancel exit 0 [OK]`
      → **SCRIPT_EXIT=0** (no false positive on real work). **E** vitest crash → **SCRIPT_EXIT=1**,
      `FAILED batches: vitest-unit`; the clean vitest control still **SCRIPT_EXIT=0**.
      **D** → **SCRIPT_EXIT=1**, 17 cancelled, message byte-identical to BEFORE (this slice does
      not touch the cancelled path).
      VITEST `runTestsGate.static.test.ts` → **10 passed / 0 failed**; `bash -n run-tests.sh` → 0.

## Phase 2: docs + PR1 gate

- [x] 2.1 `docs/product/MASTER_PLAN_ES.md:159` (and the paired `:164`) — record N-COR-2(b) as
      CLOSED at main; the code and the planning record must stop disagreeing (delta requirement
      "the planning record states the closed item as closed").
      **Verified against the code before writing the correction**, never taken from the doc:
      `failSaga` drops the saga from the tracked set through the shared `stopTracking` helper
      (`apps/api/src/saga/SagaManagerExecution.ts:526`) and `checkSagaTimeout` refuses a terminal
      row (`apps/api/src/saga/SagaManagerLifecycle.ts:1127`). `:159` now records (b) CLOSED at main
      with both citations and narrows the carry to (c) + `handleEvent` amplification + the
      in-flight guard; `:164` stops listing `activeInstances.delete` and the terminal filter as
      carried and states they were PROMOTED into `saga-tenant-scope-and-recovery`.
- [x] 2.2 `docs/security/MULTI_TENANT_GUARDS.md:906` — closure note on the carried-list entry for
      the dead `TOKENS.SagaManager` registration (deleted in 1.4); leave every other carried
      residual open and pointing at PR2/PR3/PR4.
      **Done**; residuals 1-4 and the whole terminal-hygiene carry list are untouched. The paired
      backlog entry **SMELL-72** in `docs/reports/roadmap-detected-smells-backlog.md:125` moved
      `PENDING → RESOLVED` in the same PR (one cell, one changed line after prettier) — leaving it
      PENDING would have been the same doc-drift class this slice exists to close. SMELL-71 and
      SMELL-73 stay PENDING.
- [x] 2.3 **0-defect gate (PR1)**: `tsc -b apps/api` = 0; `eslint --max-warnings 0` on touched
      `.ts` = 0; `prettier --check` clean (including the shell script's neighbours); fitness
      **#8 / #9 / #10 / #21 / #23 = 0**; `bash -n run-tests.sh` clean; the affected unit set green
      with 0 failed / 0 cancelled.
      **Measured:** `bash -n run-tests.sh` 0 · `tsc -b apps/api` 0 · `eslint --max-warnings 0` over
      the 5 touched `.ts` 0 · `prettier --check` over the 5 `.ts` + 3 `.md` clean · fitness
      **#8 = 0 · #9 = 0 · #10 = 0 · #21 = 0 · #23 = 0** (plus #5 = 0, 0 `canon-exception` markers,
      0 `.only`/`.skip`) · saga unit surface **18 files / 219 tests, 0 failed, 0 cancelled**
      (was 17/209 — this PR adds the 10th-to-19th assertions in one new file) · the four
      container-composing route suites **4 files / 116 tests, 0 failed**.
- [x] 2.4a **4R full-tier adversarial review** (risk · resilience · readability · reliability) on
      the PR1 diff. **Verdicts: R1 PASS · R2 PASS-with-findings · R3 APPROVE-with-findings ·
      R4 PASS-with-findings — zero slice blockers**, resolved in one corrective pass (commit 2 of
      PR1). What the review changed, beyond wording:
      **(a) The gate had no executable proof.** R3 demonstrated by mutation that piping ONE
      `run_batch` call (`| tee -a /dev/null`) puts it in a subshell, discards its accumulator
      writes and reverts the fix — while the static suite stayed **10/10 green**. New
      `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts` spawns the REAL script with a stub
      `node` first on `PATH` (no suite executes, no DB, no recursion) and asserts exit codes plus
      batch accounting; it takes the mutant from 10/10 green to **2 failed / 5 passed**.
      **(b) The Vitest summary parse read the wrong line** — `grep -oP '\d+ passed' | head -1`
      takes `Test Files`, not `Tests`, so the printed TOTAL was 18 where the real figure was 219.
      Now anchored on `^[[:space:]]*Tests[[:space:]]`.
      **(c) The ERROR text named a cause the same commit files as undetectable** (a missing path in
      a MULTI-file batch is dropped silently — SMELL-74). Scoped to the single-file shape, plus the
      Vitest cause and a pointer to the on-screen artifacts.
      **(d) A batch collecting ZERO tests still reported OK.** Now FAIL for tier-driven runs.
      **(e) `forbidOnly` was missing** in `apps/admin` and `apps/client` — the same silent-green
      class, out of the original diff.
      **(f) SMELL-75 filed**: 21 integration suites collected by no collector, independently
      reproduced (613 on disk = 529 Vitest + 63 listed + **21 orphans**).
- [ ] 2.4b Push and require every CI workflow green before merge to main. **Blocked on a baseline
      that is not green** (R4-F5): `Package Tests` is 14/15 on main because
      `packages/providers/tiktok/tests/authService.test.ts` compared a real clock against a 1 ms
      boundary. Fixed deterministically with fake timers in a SEPARATE commit (73/73, stable 3/3);
      `Production CI/CD` container-security jobs stay chronically red per the paused
      containerization workstream.

---

# PR2 — S1: durable, honest compensation (REBUILD of the walk)

## Phase 3: RED — P2 probe first (the slice's gate)

- [x] 3.1 [RED] **[MERGE-BLOCKING] Execute probe P2** (design Appendix B) by extending
      `apps/api/tests/unit/saga/sagaBootResume.test.ts`: seed via the suite's `makeRow` a crashed
      mid-auto-compensation row exactly as the durable layer records it — `status: "RUNNING"`,
      `currentStep: 1`, `stepResults[1] = {success:false}`, `compensationResults: []`,
      `retryCount: 3`, and **both variants**: A `nextRetryAt` stale past-due (the retry-scan
      reader), B `nextRetryAt: null` (the boot reader). Step doubles carry `executeAttempts` /
      `compensateAttempts` counters. Assert RED at main: `step1.executeAttempts === 1` (forward
      re-execution over partially-undone state) and `step0.compensateAttempts === 0`.
      **Executed on a REAL `SagaManagerImpl` over the in-memory doubles** (the boot-resume suite's
      engine SPY cannot observe a forward re-execution — it records a dispatch either way), with
      `makeRow` seeding the crash shape and `defineSaga` building two compensable + pivot +
      retryable steps carrying the counters.
- [x] 3.2 Run VITEST 3.1 → **RED for the traced reason**. Variant A must arrive through
      `scheduler.triggerTask("saga-retry-recovery")` (`SagaManagerLifecycle.ts:1027-1046`), variant
      B through the boot dispatch (`disposeLoadedSaga`'s `nextRetryAt` check, `:357-359`).
      **If the observed behavior diverges from the P2 trace, STOP and report** — D2's
      `nextRetryAt: null` and D4's status-first ordering both rest on it; a divergence reopens the
      design, it does not get patched around.
      **VERDICT: the trace is CONFIRMED on every point D2/D4 rest on, and DIVERGES on one secondary
      assertion — reported, not patched around.** Raw evidence at main (VITEST
      `sagaBootResume.test.ts`, both variants green while asserting main's behaviour): **variant A**
      boot summary `skipReasons = {"nextRetryAt-owned-by-checker": 1}` and
      `step1.executeAttempts === 0` immediately after boot (the boot pass did NOT dispatch); after
      `scheduler.triggerTask("saga-retry-recovery")` → `step1.executeAttempts === 1` (FORWARD
      re-execution), `pivot.executeAttempts === 0`. **Variant B** boot summary `resumed = 1` and the
      same `step1.executeAttempts === 1` through the boot dispatch. The reader attribution
      (A = retry scan, B = boot) and the forward re-execution — the whole basis of D2's
      `nextRetryAt: null` and D4's status-first ordering — are verbatim.
      **DIVERGENCE:** `step0.compensateAttempts === 1`, not `0`. The walk does not RESUME, as traced;
      but the forward re-execution fails again with the budget already exhausted, and that failure
      starts a WHOLE NEW walk, which compensates step 0 a second time with no record that the first
      walk ever ran (measured terminal state `COMPENSATED`, with the step-0 success recorded in
      `compensationResults`). The divergence makes the defect STRICTLY WORSE
      than traced (a forward re-execution AND an unrecorded second undo) and contradicts no design
      point — D2's write-ahead status and D3's durable per-step record close both. No design point
      reopened; the batch continued.
- [x] 3.3 [RED] Extend the same file with the boot-disposition RED cases: a `COMPENSATING` row is
      (a) not loaded at all today (`loadActiveSagas` predicate, `SagaManagerLifecycle.ts:952`),
      and (b) once loaded, must be reported under its OWN disposition alongside a
      forward-resumable row and a parked row (spec: "the compensation disposition is its own
      word").
      **Shipped** as three cases, and the boot-load double was made to HONOUR the status predicate
      (it previously returned every seeded row, which would have reported a widened predicate as
      already shipped). RED at main: `activeInstances.has("saga-compensating")` false; both dispatch
      cases timed out waiting for a walk that never came.
- [x] 3.4 [RED] Create `apps/api/tests/unit/saga/sagaCompensationWalk.test.ts` (vitest,
      `@file`/`@description`/`@layer infrastructure`) with the walk's behavioral RED set:
      (a) the row reads `COMPENSATING` in the store BEFORE any `compensate()` is invoked, and the
      persist is awaited, not dispatched; (b) each step's outcome is durable BEFORE the next
      `compensate()` runs (persist-per-step, not once at `SagaManagerExecution.ts:398`);
      (c) a resumed walk skips steps already recorded succeeded and re-dispatches only the rest;
      (d) a walk with a failed `compensate()` leaves the row `COMPENSATING` (today `:363-368`
      logs and still terminalizes `COMPENSATED` — dishonest); (e) a failed compensation is
      recorded as ATTEMPTED, distinguishable from never-attempted.
      **Shipped** with the REAL engine over the doubles; ordering is proven from INSIDE
      `compensate()` — each step reads the durable row at the moment it is invoked, because an
      assertion taken after the walk cannot tell "persisted before the next step" from "persisted
      once at the end". The shared double now stamps `updatedAt` on every upsert exactly as
      `@updatedAt` does, since the liveness horizon is measured from it.
- [x] 3.5 [RED] Create `apps/api/tests/integration/sagaCompensationRecovery.test.ts` (node:test,
      real Postgres + Redis, `@file`/`@description`/`@layer infrastructure`), booting the REAL
      `SagaIntegration` composition (the 9R.2 production-faithful pattern, not hand-wired doubles):
      (a) a process killed mid-walk leaves `COMPENSATING`, never `RUNNING`, never terminal;
      (b) a fresh-memory process resumes the WALK — no forward step executes, no command re-issues
      the failed step's work; (c) a walk interrupted after two of four recorded compensations
      re-dispatches only the remaining two; (d) an operator re-drive of a `COMPENSATING` row
      reaches terminal `COMPENSATED` read back FROM THE ROW. The suite refuses to run when the
      table holds foreign non-terminal rows, and cleans its fixtures (0-leak).
      **DEVIATION, reported: this suite was authored AFTER the GREEN code, not before.** Its RED-ness
      is therefore proven by MUTATION rather than by history: removing the single write-ahead line
      (`await this.beginCompensation(instance, errMsg)`) takes it from **2 pass / 0 fail / 0
      cancelled** to **0 pass / 2 fail**, failing on "the triggering error is on the row" and "the
      re-drive RESUMES from the durable record". The line was restored and the suite re-run green.
      The interruption is a `compensate()` that never returns (the exact durable state a kill
      leaves); the "process with no memory" is a SECOND `SagaIntegration` with its own step
      instances over the same database. Probe definition = 5 compensable + pivot + retryable,
      registered on the manager BEFORE `integration.initialize()`, where production registers its
      own. Post-run leak check: 0 `saga-comp-*` rows, 0 `stream:Saga:saga-comp-*` events, 0
      fixture accounts.
- [x] 3.6 Run VITEST 3.3-3.4 + INT-LONG 3.5 (DBUP first) → RED across the set, each for its named
      mechanism.
      **Evidence:** `sagaCompensationWalk.test.ts` at main → **8 failed / 2 passed (10)**, each for
      its own mechanism: status `RUNNING` at compensate time (D2 absent); durable outcomes
      `[[], [], []]` instead of `[[], [2], [1,2]]` (D3 absent); "engine.compensateSaga is not a
      function" (no awaitable walk); `COMPENSATED` on a failed compensation (D5 absent); `RUNNING`
      written by a forward dispatch on a COMPENSATING row (C2 absent); "not in a failed state:
      COMPENSATING" (re-drive refused); "Saga timeout exceeded" instead of a compensation
      reason (C1 absent); a row terminalized despite a missing `updatedAt` (task 7.2 absent). The 2
      green were the already-true halves (a failed compensation IS recorded; a terminal saga IS
      refused).

## Phase 4: D2 — `COMPENSATING` persists BEFORE the walk dispatches

- [x] 4.1 [GREEN] `apps/api/src/saga/SagaManagerExecution.ts:253-263` (retries-exhausted,
      class `compensable`): set `status = "COMPENSATING"`, `error = errMsg`,
      `nextRetryAt = undefined`, persist in the same tenant-scoped transaction shape WITH the
      `SAGA_COMPENSATION_STARTED` event, **await it**, and only then dispatch the walk. Fixes the
      durable-null `error` finding (today `:257` sets it AFTER the persist at `:253`).
      **Shipped as ONE named transition, `beginCompensation(instance, error?)`**, so the entry points
      cannot drift into two shapes — the walk itself calls it defensively too, which is what makes
      the delta's static scenario ("no site begins a walk from a row whose persisted status is still
      RUNNING") true by construction rather than by inspection.
- [x] 4.2 [GREEN] Nulling `nextRetryAt` is load-bearing, not cosmetic — it is what removes the row
      from the retry scan's predicate (`:1027-1046`) and from `disposeLoadedSaga`'s
      checker-owned branch (`:357-359`), so neither reader can convert a compensation into a
      forward retry (P2 variant A). Pin it with an explicit assertion in 3.4(a).
- [x] 4.3 [GREEN] Converge the admin path: `SagaManagerLifecycle.ts:734`'s transition writes the
      same shape as 4.1 (one transition, two entry points) so the operator path and the automatic
      path cannot drift.
- [x] 4.4 Run VITEST 3.4(a) → GREEN.
      **GREEN:** the step reads `COMPENSATING`, the durable triggering error and a null retry marker
      from the store at the moment its `compensate()` is invoked.

## Phase 5: D3 — per-step durable progress in `compensationResults`

- [x] 5.1 [GREEN] `SagaManagerExecution.ts:324-406` — rebuild the walk: record each step's outcome
      at today's `:361` / `:371` and **persist the instance immediately after each `compensate()`
      returns**, replacing the single post-loop persist at `:398`. Cost: ≤ one extra upsert per
      compensable step (the publish saga has 2).
- [x] 5.2 [GREEN] Resume predicate: skip step `i` iff
      `compensationResults[i]?.outcome === "succeeded"` (legacy `success === true` normalized —
      the normalizer lands in PR3/D6; until then read both shapes at this one site and delete the
      dual read when D6 lands). Keep the canon skips: index ≥ `pivotStepIndex`, non-compensable,
      step not succeeded.
- [x] 5.3 [GREEN] State the machine's guarantees in the walk's docblock, as design D3 words them:
      status honesty, monotonic durable progress (crash window = exactly ONE in-flight step),
      a persisted per-step success is never re-executed, and `COMPENSATED` only when every
      eligible step holds a persisted success. `compensate()` idempotency stays a canon
      obligation — this reduces the reliance, it does not remove it.
- [x] 5.4 Run VITEST 3.4(b)(c)(e) → GREEN.
      **GREEN:** walk order `[2,1,0]` with durable outcomes `[[], [2], [1,2]]` observed from inside
      each `compensate()`; a resumed walk with index 2 already recorded dispatches only 1 and 0; a
      failed compensation is durable and distinguishable from a hole.

## Phase 6: D4 — boot predicate + the `compensation-resumed` disposition

- [x] 6.1 [GREEN] `SagaManagerLifecycle.ts:952` — widen `loadActiveSagas` to
      `status ∈ {RUNNING, PENDING, COMPENSATING}`. The same-snapshot count queries stay inside the
      same declared read boundary.
- [x] 6.2 [GREEN] `disposeLoadedSaga` — check `status === "COMPENSATING"` **FIRST, before the
      `nextRetryAt` check at `:357-359`**, and return the NEW disposition
      `compensation-resumed`, whose dispatch is `compensateSagaAsync` (the walk), never
      `executeSaga`. Status-first ordering makes even a legacy pre-deploy admin-created
      `COMPENSATING` row (possibly stale fields) resume the walk.
      **Refinement, reported:** the status check sits ahead of the retry marker but AFTER the tenant
      and definition guards, so 6.3's "guards run exactly as for forward rows" holds literally. The
      dispatch is the AWAITABLE `compensateSaga` on the SAME bounded runner as the forward resumes
      (new port member), not the detached form: an undo opens the same transactions a forward step
      does, so exempting it from `maxConcurrentSagas` would reintroduce the burst the ceiling exists
      to prevent — and only a counted dispatch can be followed by the gauge re-measurement 9.4
      needs.
- [x] 6.3 [GREEN] Tenant/definition guards run for the new disposition exactly as for forward rows
      (`unresolvable-account`, `definition-unregistered`, `row-failed` unchanged). The
      pivot-parking branch does NOT apply — a compensating saga is pre-pivot by construction;
      state that in the branch comment.
- [x] 6.4 [GREEN] Boot summary + one log line per disposition carry `compensation-resumed`
      (`SagaManagerLifecycle.ts:228-236` ownership/summary block), so an operator can tell
      "finishing an interrupted undo" from "finishing an interrupted publish".
- [x] 6.5 Run VITEST 3.1 (both variants) + 3.3 → GREEN: `step1.executeAttempts === 0`,
      `step0.compensateAttempts === 1`, terminal `COMPENSATED`, disposition
      `compensation-resumed` in BOTH variants.
      **Measured**, with the probe's fixture moved to the shape the durable layer now records
      (`COMPENSATING`): both variants report `skipReasons = {"compensation-resumed": 1}`,
      `step1.executeAttempts === 0`, `pivot.executeAttempts === 0`, `step0.compensateAttempts === 1`,
      terminal `COMPENSATED` with `compensationResults = [{success:true, data:{compensated:"step-0"}}]`.
      Variant A additionally fires `scheduler.triggerTask("saga-retry-recovery")` AFTER the resume
      and proves the scan cannot see the row at all.
      **A THIRD case pins the residual the fix cannot reach:** a row left `RUNNING` mid-walk by
      PRE-CHANGE code carries nothing that distinguishes it from a saga interrupted mid-step, so it
      is still resumed FORWARD (`step1.executeAttempts === 1`). Bounded to rows crashed mid-walk at
      the moment of the deploy, not a regression, and documented in the runbook instead of being
      described as closed.

## Phase 7: C1 — the COMPENSATING liveness horizon (supersedes the ordinary backstop)

- [x] 7.1 [GREEN] Carry `updatedAt` through the read path: `apps/api/src/saga/sagaInstanceRow.ts`
      (`SagaInstanceRow` + `deserializeSagaInstanceRow`, casts at `:50-51`) and
      `packages/shared/src/saga.ts` (`SagaInstance` gains an OPTIONAL `updatedAt`, alongside
      `stepResults`/`compensationResults` at `:271-272`). The column already exists
      (`schema.prisma:2066`) — no migration.
      **Schema claim re-verified before relying on it:** `compensationResults Json @default("[]")`
      and `updatedAt DateTime @updatedAt @db.Timestamptz(6)` are both present on `SagaInstance`;
      nothing under `infra/prisma/**` is touched by this slice.
- [x] 7.2 [GREEN] **Undefined-`updatedAt` rule — DECIDED HERE, do not leave implicit.**
      `startSaga` builds a `SagaInstance` in memory without `updatedAt`, so an in-process
      COMPENSATING row can carry `undefined`. **Rule: `undefined` is treated as SUSPICIOUS (the
      conservative branch), never as "fresh"** — it routes straight to the fresh re-read path
      below, which is authoritative. Document the rule at the field's declaration and at the
      branch; pin it with a unit case (an instance with no `updatedAt` triggers a re-read and is
      NOT terminalized on the strength of the missing value).
      **Completed with the FRESH-side fallback stated too:** when even the re-read row carries no
      `updatedAt`, the anchor is `startedAt` — a real anchor — so the canon's "every saga terminates"
      holds without ever resting on an absent value.
- [x] 7.3 [GREEN] `SagaManagerLifecycle.checkSagaTimeout` — branch on `status === "COMPENSATING"`
      BEFORE the parked branch (`:1137-1161`) and before the ordinary `startedAt` sweep. Suspicion
      forms on the carried (possibly stale, therefore conservative) `updatedAt`; before
      terminalizing, RE-READ the fresh row via `withSagaSystemRead` — the established
      distrust-the-stale-copy pattern of `terminalizeUnscopableSaga` (`:1191-1226`) — and fail it
      only if the FRESH horizon has elapsed. A live walk (which writes at the transition and after
      every step) never expires; a stalled one does.
      **A related defect surfaced and was fixed at the source, not in the test:** the boot pass
      re-warms the rows it leaves in play, and a re-warm goes through the ordinary persist — which
      would reset the liveness anchor of a walk that has made NO progress, letting a crash-looping
      process defer that row's terminal guarantee one restart at a time (the exact hazard D11 closes
      for parking). Compensation-resumed rows are therefore excluded from the re-warm, exactly as
      parked rows already are; the walk's own writes warm the cache when it actually advances.
- [x] 7.4 [GREEN] `apps/api/src/metrics/sagaRecoveryMetrics.ts:82-83` — add
      `"compensation-expired"` to the closed `SagaFailureReason` union and `"compensation"` to
      `SagaRecoveryStage`. Terminalization uses the new reason, never `"timeout"`.
- [x] 7.5 [GREEN] Unit-pin the two spec scenarios: an unfinishable walk terminalizes under a
      reason naming the compensation failure; a stalled `COMPENSATING` row is terminalized
      EXACTLY ONCE (the terminal transition stops tracking; the checker refuses to re-visit a
      terminal row) however many further ticks run.

## Phase 8: C2 — `executeSaga` REFUSES a persisted `COMPENSATING` row (MERGE-BLOCKING)

- [x] 8.1 [RED] Extend `apps/api/tests/unit/saga/sagaContextInvariants.static.test.ts` with the
      invariant codified VERBATIM: **`executeSaga` SHALL REFUSE a row whose persisted status is
      `COMPENSATING`** — log + `recordSagaRecoveryFailure("compensation")`, never a forward run.
      Static half: the refusal set at `SagaManagerExecution.ts:82-86` includes `COMPENSATING`
      alongside the three terminal states, and no dispatch path reaches
      `runSagaSteps:130-131` (which sets `RUNNING` unconditionally) for such a row.
      **Shipped** as three static assertions (the refusal exists and PRECEDES `runSagaSteps`; the
      refusal is COUNTED; the boot disposition takes the status decision ahead of the retry marker),
      plus one that every walk begins through the single durable transition. NOTE for future scans in
      this file: the sanitized copy blanks STRING LITERALS, so a status comparison is only visible in
      the original — the new helper slices the original over the sanitized copy's balanced offsets.
- [x] 8.2 [RED] Unit half in `sagaCompensationWalk.test.ts`: a direct `executeSaga` call on a
      persisted `COMPENSATING` row performs no step, writes no `RUNNING`, logs, and counts one
      `stage="compensation"` failure.
- [x] 8.3 [GREEN] Implement the refusal at `SagaManagerExecution.ts:74-86`. Record in the branch
      comment which dispatch paths this closes and which are already safe after D2/D4
      (`handleEvent` requires RUNNING `:799`; the retry scan needs a due `nextRetryAt`, nulled by
      D2; `continueSaga` requires RUNNING/PENDING `:686`; boot routes COMPENSATING to the walk;
      `startSaga` is new) — **and that the remaining hole, D7b's trailing rerun, is closed in
      PR3 (Phase 14.4)**. Run VITEST 8.1-8.2 → GREEN.
      **Measured:** the refused dispatch performs no step, leaves the row `COMPENSATING`, and adds
      exactly one `stage="compensation"` failure (read off the prom registry, not inferred).

## Phase 9: D5 — counted exits, admin re-drive, honest gauge and its alert

- [x] 9.1 [GREEN] `SagaManagerExecution.compensateSagaSteps` — the three silent exits get a log at
      ERROR naming saga + cause AND a `recordSagaRecoveryFailure("compensation")` counter: the two
      returns at `:294-296` and `:299-301`, plus the `!outcome.ran` path at `:309-314` (which
      logs today but does not count).
      **A FOURTH exit is counted too** — the rebuilt walk's "ended with an un-compensated step"
      return, which is new in this slice and would otherwise have been the only silent one left.
- [x] 9.2 [GREEN] `SagaManagerLifecycle.compensateSaga:730-732` accepts
      `status ∈ {FAILED, COMPENSATING}`; for COMPENSATING it dispatches the walk, which RESUMES
      from durable progress (Edward's decision 1 — never restarts from step 0; "restart" falls out
      naturally as "no persisted successes yet"). Terminal sagas stay refused, and the re-drive is
      not a way around the canon re-execution guard.
- [x] 9.3 [GREEN] Unit-pin the re-drive: a `COMPENSATING` row is accepted (not refused for wrong
      status); with two of four compensations recorded, only the remaining two are dispatched; a
      terminal row is still refused and dispatches nothing.
- [x] 9.4 [GREEN] `compensatingOrphans` keeps its boot-count gauge semantics but now measures the
      PRODUCTION path. Rewrite the docblock at `sagaRecoveryMetrics.ts:163-172` and the boot WARN
      at `SagaManagerLifecycle.ts:992-999` — both currently say "detection only / the engine does
      not resume these", which D4 makes FALSE.
      **Refinement forced by the spec's own scenario, reported:** a boot-ONLY measurement cannot
      satisfy "a transient walk does not page" — the gauge would keep reading the inherited count
      until the next restart even after the engine finished every walk, so ANY window function still
      fires. Each process therefore publishes the level TWICE: at the boot read and again once its
      resume pass drains. It remains a GAUGE (a level each process re-measures), never an event
      counter, exactly as the spec requires. `/sagas/metrics` and the boot WARN carry the new
      meaning.
- [x] 9.5 [GREEN] `prometheus/alerts/saga.yml` **in this same PR** (Edward's decision 3):
      `SagaCompensatingOrphans` description at `:84` rewritten (the engine DOES resume these now),
      its condition re-tuned from "any > 0 is admin-endpoint leakage" to "a COMPENSATING count
      that does not drain across two boot observations" so a transient walk does not page; and
      `SagaRecoveryLoopFailing`'s `stage=~` regex at `:98` gains `compensation`.
      **Shipped:** `max(saga_compensating_orphans) > 0` → `min_over_time(saga_compensating_orphans[10m]) > 0`
      with `for: 5m` — the FLOOR of the window, so a walk that drains puts a zero in the series; the
      window is deliberately shorter than the compensation horizon so an operator hears about a stuck
      undo BEFORE the engine terminalizes it. Summary and description rewritten around the resume,
      the durable per-step record and the re-drive.
      **One alert ADDED beyond the two named edits, reported:** `SagaCompensationExpired` on
      `sagas_failed_total{reason="compensation-expired"}` — the new terminal reason is matched by no
      existing rule (`SagaTimeoutSpike` keys on `reason="timeout"`), so without it the engine would
      terminalize an unfinished rollback silently.
- [x] 9.6 [GREEN] Unit-pin the alert semantics the spec demands: a walk that starts and finishes
      inside the evaluation window does NOT satisfy the condition.
      **Shipped** in the static suite: the window is PARSED out of the shipped rule and the condition
      evaluated against two synthetic series — a transient walk (`[0,3,0,0…]` → floor 0, does not
      fire) and a stuck one (all samples non-zero → fires) — so the pin follows the rule if the rule
      is re-tuned, instead of restating a literal.

## Phase 10: PR2 wiring, docs, gate

- [x] 10.1 [M4] `apps/api/scripts/run-tests.sh` — append
      `tests/integration/sagaCompensationRecovery.test.ts` to the `integration:saga-recovery`
      batch (`:214`, `CONCURRENCY=1 TIMEOUT=120000`). **A suite no batch lists is a suite that
      never runs**; extend the existing static assertion that every saga suite on disk has an
      explicit entry.
      **Appended** to `integration:saga-recovery`. The existing "lists every one of them explicitly"
      assertion needed no extension — it enumerates the saga suites ON DISK, so it covered the new
      file the moment it existed. `bash -n run-tests.sh` clean.
- [x] 10.2 `docs/observability/SLO.md` — the saga section reflects the resumed-COMPENSATING
      lifecycle and the new `compensation-expired` reason.
      **Done:** the orphan SLI row now reads `min_over_time(...)` under a renamed "COMPENSATING sin
      drenar" target ("un walk en curso NO cuenta"), a new "Rollbacks sin terminar" row covers
      `compensation-expired`, the recovery-health regex gains `compensation`, and a new note explains
      the lifecycle and why the alert is a FLOOR rather than a `max()`.
- [x] 10.3 `docs/security/MULTI_TENANT_GUARDS.md` — rewrite the compensating-orphan runbook
      section for the resume + admin re-drive path (it currently instructs the operator around a
      class the engine could not resume); state the accepted residual verbatim from the spec:
      this resume ships BEFORE row claims, so a rolling deploy can produce a second walk, bounded
      by durable per-step progress and canon idempotency — and note that `shutdown()`
      (`SagaManagerLifecycle.ts:875-876`) skips non-RUNNING rows, so a draining process's detached
      walk keeps writing past teardown (accepted; bounded by PR4's lease and by the liveness
      horizon).
      **Done:** the section now describes the resume, the four guarantees of the walk, the
      twice-published gauge, and a four-step runbook (read `compensationResults` to see what is
      already undone → fix the cause → re-drive, which RESUMES → otherwise the liveness horizon
      terminalizes it as `compensation-expired`, which reads "the rollback did not finish", not "the
      publish failed"). BOTH residuals are stated verbatim, and the carried-list entry #1 is marked
      CLOSED with its ownership residual restated rather than silently inherited.
- [x] 10.4 Mirror the PR2 requirements into the living
      `openspec/specs/saga-crash-recovery/spec.md` (the COMPENSATING deferral is REVERSED) and
      record the new `saga-compensation-integrity` capability.
      **Done:** the deferral paragraph is struck through (kept, with the reversal and its WHY above
      it) and superseded by the inherit-and-walk requirement plus three scenarios; the new living
      capability `openspec/specs/saga-compensation-integrity/spec.md` records the seven shipped
      requirements and the two accepted residuals.
- [x] 10.5 **0-defect gate (PR2)**: `tsc -b apps/api` + `tsc -b packages/shared` = 0;
      `eslint --max-warnings 0` on touched `.ts` = 0; prettier clean; fitness
      **#3 / #4 / #5 / #8 / #9 / #10 / #11 / #14 / #21 / #23 = 0**; no `.only` / `.skip`; no new
      `@ts-ignore` and no new `canon-exception` marker; LXC-safe regression set green with
      **0 failed / 0 cancelled**: `sagaBootResume`, `sagaCompensationWalk`,
      `sagaContextInvariants.static`, the saga unit surface, `sagaCompensationRecovery`,
      `sagaCrashRecovery`, `sagaTenantIsolation`, `chaos/saga-step-retry-recovery`; post-run leak
      check (0 fixture rows, 0 stray `stream:Saga:*`, 0 `bull:*`).
      **Measured:** `tsc -b apps/api packages/shared` = **0** · `eslint --max-warnings 0` over
      `apps/api/src/saga`, `sagaRecoveryMetrics.ts`, `apps/api/tests/unit/saga`, the two touched
      integration suites, `sagaManager.test-helpers.ts` and `packages/shared/src/saga.ts` = **0** ·
      `prettier --check` over every touched `.ts`/`.yml`/`.md` clean · `bash -n run-tests.sh` clean ·
      fitness **#3 = 0 · #4 = 0 · #5 = 0 · #8 = 0 · #9 = 0 · #10 = 0 · #11 = 0 · #14 = 0 · #20 = 0 ·
      #21 = 0 · #23 = 0**, 0 `.only`/`.skip`, 0 new `@ts-ignore`, 0 new `canon-exception` markers ·
      **saga unit surface 33 files / 368 tests, 0 failed, 0 cancelled** (`tests/unit/saga` 20/252 +
      the 13 saga suites under `tests/unit`) · `sagaCompensationRecovery` **2/2**, `sagaCrashRecovery`
      **17/17**, `sagaTenantIsolation` **18/18**, `sagaAccountIdBackfill` **10/10**,
      `chaos/saga-step-retry-recovery` **1/1** — every one 0 failed / 0 cancelled · post-run leak
      check clean (0 fixture rows, 0 fixture accounts, 0 `stream:Saga:saga-comp-*` events).
- [ ] 10.6 **4R full-tier adversarial review** on the PR2 diff BEFORE push (publish hot path);
      then push and require every CI workflow green before merge to main.
      **4R RAN. Verdicts: R4 BLOCK (1 blocker + 5 criticals) · R3 CHANGES-REQUESTED (2
      blockers + 4 criticals, every one probe-reproduced) · R1 ADVISORY (2 criticals) · R2
      coherent-rebuild (2 criticals).** All four validated the happy-path machine; the error
      EDGES around it failed. One corrective re-run applied — see Phase 10c.

## Phase 10c: the corrective re-run (E1-E12)

- [x] E1 **[R4-BLOCKER + R3-C5]** The write-ahead is an ORDERING, never a GATE. A failed
      transition persist is logged, counted `stage="compensation"`, and the walk is
      dispatched ANYWAY (main's always-dispatch restored as the fallback; the walk's first
      per-step persist re-establishes durability). It can no longer reach `failSaga` with a
      step-failure reason, and the rollback is never skipped because its bookkeeping failed.
      **RED** (R3 probe B, upsert throws once on the COMPENSATING write): the walk never ran
      and the suite timed out waiting for a settled row. **GREEN**: `compensateAttempts === 1`,
      terminal `COMPENSATED`, `error` is NOT the DB message, exactly one compensation failure
      counted.
- [x] E2 **[R3-BLOCKER-1]** The C2 refusal decides on the DURABLE row. `executeSaga` reads
      the persisted status through a new one-column `readPersistedStatus` (system-scoped PK
      read) instead of trusting `getSaga`, whose fast path is the fire-and-forget Redis copy
      the engine is designed to survive losing. An UNREADABLE status refuses too (counted
      `stage="instance-load"`): "not compensating" cannot be established from a read that
      failed. **RED**: DB `COMPENSATING` + Redis `RUNNING` → the failed step re-executed
      forward. **GREEN**: no step runs, the row stays COMPENSATING, one compensation failure.
      The same durable check now guards the WALK's entry, so a terminal row cannot be
      resurrected by the defensive transition.
- [x] E3 **[R3-BLOCKER-2]** Behavioural pin of the write-ahead ORDERING: `executeSaga` is
      awaited, which returns at the exact moment the walk is queued and not yet run, and the
      durable row is asserted to already read `COMPENSATING` + the error + a null retry
      marker. **Mutation proof**: replacing ONLY the write-ahead call with the pre-change
      `instance.error = errMsg` (leaving the defensive walk-side call in place) takes
      `sagaCompensationWalk.test.ts` from **19 passed** to **2 failed / 17 passed**. Restored
      and re-run green.
- [x] E4 **[R3-C3]** Post-pivot rollbacks are OPERATOR-owned. The boot pass checks the pivot
      for a COMPENSATING row and PARKS it (`reason=pivot`, operator window) instead of
      auto-walking it. The false invariant ("a compensating saga is pre-pivot by
      construction") is corrected in place with the refutation: the operator door compensates
      FAILED sagas at ANY step. **RED**: a COMPENSATING row at `pivot+1` was walked by the
      boot pass. **GREEN**: parked, `bootParkedSagas === 1`, nothing dispatched.
- [x] E5 **[R4-C3 + R3-C4]** The orphans gauge is a prom-client `collect()` callback that
      runs the COUNT at SCRAPE time (a provider the engine installs at `initialize` and
      detaches at `shutdown`). The double-publish machinery is deleted, and its five doc
      statements are rewritten to the collect semantics. The `min_over_time` window keeps its
      shape and its rationale is re-derived honestly against `for: 5m` — the rule pages after
      ~15 minutes (10m lookback that never saw a zero, held for 5), and the description now
      says so. Throw paths counted: `resumeCompensationWalkAsync`'s catch and the boot
      dispatch catch both record `stage="compensation"`. **Test**: the gauge is read the way
      Prometheus reads it (`register.getMetricsAsJSON()`, which awaits collect) — 1 at boot,
      0 once the walk drains, 2 while a walk cannot finish.
- [x] E6 **[R4-C5 + R3-C6 + R1-F2 aggravation]** In-process walk claim, promoted into this
      slice. A per-sagaId in-flight set on the engine; the operator endpoint answers **409**
      while a walk is in flight; the boot pass skips claimed ids. **RED**: a second
      `resumeCompensationWalk` ran the hanging step again (`compensateAttempts 2`) and the
      operator re-drive was accepted mid-walk. **GREEN**: the second walk is refused and the
      endpoint rejects with a conflict.
- [x] E7 **[R4-C1 + R4-C2 + R3-W7 + R1-F4]** The horizon gains an ABSOLUTE anchor: the
      durable `saga.compensation.started` event (written in the transition's own transaction)
      is the rollback's birth, read once per saga and remembered, with the row's `startedAt`
      as the fallback for pre-change rows. Terminalization fires when EITHER liveness stalls
      OR the age exceeds **3 × timeout** — chosen because the liveness horizon (1×) already
      catches a walk that stopped writing, so this bound exists only for the walk that keeps
      writing and keeps failing; it must survive a legitimately long multi-step undo across a
      deploy while still bounding a crash loop (90 min at the default). The
      definition-unregistered early return no longer skips COMPENSATING rows (the horizon
      needs a duration, not a definition — `defaultTimeout` supplies it), which was the one
      class the alert surfaces most. R1-F4: the walk re-reads the durable status before its
      own writes and ABANDONS rather than resurrect a terminal row. **RED**: both the
      restart-loop row and the unregistered-definition row stayed COMPENSATING forever.
      **GREEN**: both terminalize under `compensation-expired`.
- [x] E8 **[R1-F1]** `runAsSagaTenant(fresh, …)` in `checkCompensationLiveness` — the scope
      is bound from the row being written, not from the copy the method exists to distrust.
      Covered by the new two-tenant scenarios (E11).
- [x] E9 **[R1-F2]** Per-step progress is merged BY INDEX against a fresh read (a recorded
      SUCCESS always wins), before the walk decides AND before every write — so a walk
      holding an older array can neither re-dispatch a step another walk recorded nor erase
      it. The residual's stated bound is corrected in the runbook and the spec: it is NOT "at
      most one step repeated", it is "no recorded success is lost, and a step may be repeated
      once per concurrent walk". **RED**: the older copy re-compensated a step already
      recorded. **GREEN**: skipped, and the record survives.
- [x] E10 **[R2-C1/C2 + R2 warnings + R1-F5/F6 + R3-S12/S13/S14]** Vocabulary and honesty:
      the gauge HELP and the `SagaMetrics.compensatingOrphans` JSDoc now say what the engine
      does; the engine port's `compensateSaga`/`compensateSagaAsync` become
      `resumeCompensationWalk`/`resumeCompensationWalkAsync` (the private step is
      `loadAndRunCompensationWalk`), leaving ONE meaning per name and the operator door
      keeping `compensateSaga`; the dead `outcome` cast branch is deleted (the union lands in
      S2 with its normalizer) and the terminal audit tally now uses the same predicate as the
      walk; the Redis deserializer carries `updatedAt` symmetrically with the writer;
      `skipReasons` no longer files `compensation-resumed` (it has its own summary field);
      the `P2`/diff-relative test names are behavioural; the "publishes twice" claim is gone
      everywhere with E5; and every count below carries its exact command.
- [x] E11 **[R1-F3 + R3 coverage]** New tests: two-tenant COMPENSATING scenarios in the
      isolation suite (the transition writes under the saga's OWN account and leaves the
      other tenant untouched; a contradicted row is refused before a transaction opens), the
      stale-cache guard, the post-pivot park, the persist-failure fallback, the concurrent
      walk and its 409, the absolute deadline, the unregistered-definition horizon, and the
      by-index merge. `sagaCompensationRecovery` now states its clean-table precondition and
      WHY it is a precondition rather than tidiness.
- [x] E12 **[R4-W1 + R3-W11]** Docs are honest about the boot page: COMPENSATING rows sort to
      the FRONT of the `bootLoadLimit` page (they are older by construction) and can defer
      forward rows past the ceiling, and the runbook's horizon promise is scoped to rows the
      process TRACKS — deferred rows are covered by `SagaBootLoadDeferred` and the next boot.
- [x] E-gate **0-defect gate (corrective)**: `tsc -b apps/api packages/shared` = **0** ·
      `eslint --max-warnings 0` over `apps/api/src/saga`, `sagaRecoveryMetrics.ts`,
      `apps/api/tests/unit/saga`, both touched integration suites,
      `sagaManager.test-helpers.ts`, `packages/shared/src/saga.ts` = **0** ·
      `prettier --check` clean · `bash -n run-tests.sh` clean · fitness
      **#3/#4/#5/#8/#9/#10/#11/#14/#20/#21/#23 = 0**, 0 `.only`/`.skip`, 0 new
      `canon-exception` · `pnpm exec vitest run tests/unit/saga` → **20 files / 268 tests**,
      0 failed, 0 cancelled · the 13 saga suites under `tests/unit` (named explicitly on the
      command line) → **13 files / 116 tests** · node:test, each single-file with
      `--test-timeout=120000`: `sagaCompensationRecovery` **2/2** · `sagaCrashRecovery`
      **17/17** · `sagaTenantIsolation` **20/20** (was 18 — two tenant scenarios added) ·
      `sagaAccountIdBackfill` **10/10** · `chaos/saga-step-retry-recovery` **1/1** — all
      0 failed / 0 cancelled · post-run leak check: **0** non-terminal saga rows, 0
      `saga-comp-*` rows, 0 `stream:Saga:saga-comp-*` events.

---

# PR3 — S2: waiting ≠ failed (N-COR-2c)

## Phase 11: RED — the corrected P1 probe

- [ ] 11.1 [RED] **[MERGE-BLOCKING]** Create `apps/api/tests/chaos/sagaWaitAmplification.test.ts`
      **verbatim from design Appendix A** (corrected fixture: `channelIds` INSIDE
      `metadata.postData`, because `ValidatePostDataStep` reads
      `context.metadata.postData.channelIds` — `readPostData`, `packages/shared/src/saga.ts:330-333`,
      check `:391-395`; a root-level `channelIds` kills the saga at step 0 and the probe proves
      nothing). Harness: `createChaosHarness` + the real `createPostPublishingSagaDefinition`.
- [ ] 11.2 Run CHAOS 11.1 → RED reproducing the CONFIRMED arithmetic: `rc=1` on the initial wait
      (pending=4) → `rc=2` (J1) → `rc=3` (J2) → **FAILED on J3's event** with
      `/still in progress/i` → J4 lands on the terminal row while all four channels published.
      Zero timers. If the run diverges from this trace, STOP and report (the gate executed it;
      a divergence means the harness, not the design, changed).
- [ ] 11.3 [RED] Create `apps/api/tests/unit/saga/sagaStepOutcome.test.ts` (vitest) with the
      contract RED set: (a) the wait step returns `waiting` while any sibling job is pending and
      `failed` only for a real failure (`packages/shared/src/saga.ts:694`, `:731-733`, `:746-751`);
      (b) repeated `waiting` leaves `retryCount`, `error` and `currentStep` untouched and the saga
      non-terminal; (c) a real failure after several `waiting` outcomes consumes exactly one
      retry; (d) legacy `{success:true|false}` rows normalize to `succeeded`/`failed` at both
      deserialization seams; (e) three dispatch sources firing at once advance the saga exactly
      once, and the saga is advanceable again after an execution ends normally, terminally, and by
      throwing.
- [ ] 11.4 [RED] Extend `sagaContextInvariants.static.test.ts`: no consumer infers "still pending"
      from an error string or a boolean; every `SagaStepResult` consumer branches on the
      discriminator exhaustively; the in-flight guard is described as IN-PROCESS in code, logs and
      docs and never as a cross-process guarantee; **no notification / email / push / in-app
      message dispatch is added on the outcome transition** (Edward's decision 2 — the
      static scenario "no notification path is added on this transition").
- [ ] 11.5 Run VITEST 11.3-11.4 → RED for the named mechanisms.

## Phase 12: D6 — `SagaStepResult` union REBUILD (compile-wide)

- [ ] 12.1 [GREEN] `packages/shared/src/saga.ts:34-39` — replace the boolean shape with the
      discriminated union on `outcome`: `{outcome:"succeeded", data?, compensationData?}` |
      `{outcome:"failed", error, compensationData?}` | `{outcome:"waiting", reason, data?}`.
      Update the `SagaStep.execute` / `compensate` signatures (`:135`, `:148`) so a fourth outcome
      would be a compile-time obligation on every consumer.
- [ ] 12.2 [GREEN] **Producers** (full inventory from D6): step classes at
      `packages/shared/src/saga.ts:376`, `:415`, `:449`, `:527`, `:595`, and the wait step at
      `:694` — `pending > 0` becomes `{outcome:"waiting", reason:"publishing jobs still in
progress"}` while `failed > 0` stays `failed` (`:746-751`); engine-synthesized countermeasure
      results at `SagaManagerExecution.ts:170-179`, `:187-190`, `:198-201` → `failed`; catch
      wrappers `:197-202` and `:369-375`.
- [ ] 12.3 [GREEN] **Consumers**: event-type pick `SagaManagerExecution.ts:206`; failure branch
      `:229`; walk eligibility `:349` (`stepResult?.outcome === "succeeded"`); compensation result
      checks `:363` and `:389` (retire the PR2 dual read from task 5.2); terminal-event tallies
      `:430-431` and `:509-510`. Straighten the `runSagaSteps` countermeasure control flow
      (`:153-196`) that used result-truthiness as flow control.
- [ ] 12.4 [GREEN] **Persistence seams** — `normalizeLegacyStepResults` mapping
      `{success:true,…} → succeeded` / `{success:false,…} → failed` at BOTH:
      `apps/api/src/saga/sagaInstanceRow.ts:50-51` (row deserializer) and the Redis-cache
      deserializer at `SagaManagerExecution.ts:828-829`. Read-side forever — **no data
      migration**; pre-deploy rows keep replaying.
- [ ] 12.5 [GREEN] Peripheral surfaces in the same PR: `SagaInstance.stepResults` /
      `compensationResults` types (`packages/shared/src/saga.ts:271-272`);
      `apps/client/lib/api/clients/sagaClient.ts:83-88` `SagaStepResultView` → union view;
      `docs/api/saga.md:34-46` contract; the test helpers `chaos-helpers.ts`,
      `sagaManager.test-helpers.ts`, `sagaTenantIsolation.test.ts:146` and the boot-resume /
      crash-recovery fixtures.
- [ ] 12.6 Run VITEST 11.3(a)(d) + `tsc -b packages/shared` + `tsc -b apps/api` → GREEN /
      exhaustiveness enforced by the compiler.

## Phase 13: D7a — `waiting` consumes no retry budget

- [ ] 13.1 [GREEN] `SagaManagerExecution.runSagaSteps` — NEW branch for `outcome === "waiting"`:
      `retryCount` untouched, no error recorded on the saga, `currentStep` unchanged,
      `nextRetryAt = now + waitPollMs`, persist WITHOUT a step event (no audit spam per poll;
      DEBUG log), return. `failed` keeps today's budget path (`shouldRetryStep`, `:539-546`)
      untouched.
- [ ] 13.2 [GREEN] **[M5]** `waitPollMs` is a DEDICATED config field, **default 30000 ms** — NOT
      the definition's `backoffMs` (5 s) the original D7 prose named. Add it to
      `apps/api/src/saga/sagaManagerTypes.ts` and forward it from
      `apps/api/src/saga/SagaIntegration.ts:61-98` into the manager config at `:200-211`
      (conditional spread, `exactOptionalPropertyTypes`). Record the sizing WHY in the field's
      docblock: a flat 5 s re-arm turns the wait step into up to 360 polls per saga over the
      30-min horizon; 30 s bounds it at ≤ 60, and events remain the primary advance.
- [ ] 13.3 [GREEN] The wait step's bound becomes the saga horizon: a never-completing job set
      still terminalizes honestly through the ordinary sweep. Unit-pin the spec scenario "a step
      that never stops waiting still terminalizes" under a reason naming the timeout.
- [ ] 13.4 Run VITEST 11.3(b)(c) → GREEN.

## Phase 14: D7b — in-flight guard, coalescing, trailing rerun with the C2 status re-read

- [ ] 14.1 [GREEN] `SagaManagerExecution.ts:74` — `private readonly inFlight = new Map<string, { rerun: boolean }>()`
      at the `executeSaga` entrance, the single funnel every dispatcher uses (boot dispatch `:549`,
      retry scan, `handleEvent`, continue endpoint, `startSaga`). Entry present ⇒ set
      `rerun = true` and return (the event is COALESCED, not lost).
- [ ] 14.2 [GREEN] `compensateSagaSteps` shares the SAME map — one saga, one advancer, either
      direction. This is also PR2's walk re-entry guard, now made structural.
- [ ] 14.3 [GREEN] `finally`: if `rerun`, execute once more; else delete the entry. Fail-safe, never
      deadlock — normal, terminal and throwing exits all release. Not a `*Cache` map (fitness #14
      unaffected): per-process coordination state matching the documented single-replica
      deployment; PR4's claims are its cross-process sibling.
- [ ] 14.4 [GREEN] **[C2, MERGE-BLOCKING]** The trailing rerun **RE-READS the persisted status
      before re-entering** — a sibling event arriving during the final failing attempt would
      otherwise re-enter after PR2's D2 persisted `COMPENSATING`, and forward execution would
      overwrite it with `RUNNING` and re-run the failed step over partially-undone state (PR2's
      headline defect, reintroduced by PR3 in the same file). PR2's refusal (task 8.3) is the
      backstop; this re-read is the primary. Unit-pin BOTH halves.
- [ ] 14.5 [GREEN] `SagaManagerLifecycle.handleEvent:794-810` — rework onto the guard: no
      per-event budget burn, and an event whose saga identity is absent or not a usable value is
      ignored EXPLICITLY and observably (typed `sagaId` read, counted), never coerced into an
      identifier and dispatched. Keep the step-identity filter at `:803`.
- [ ] 14.6 [GREEN] Concurrent dispatches share ONE in-memory instance (`getSaga` returns the
      `activeInstances` object, `:781-788`), so the guard is also the fix for concurrent walkers
      mutating shared `currentStep` / `retryCount` — state that in the guard's docblock as the
      second justification (P1 trace).
- [ ] 14.7 Run CHAOS 11.1 → **GREEN**: `retryCount` stays 0 across sibling events, terminal
      COMPLETED after the last event's trailing rerun, all four channels published. Run VITEST
      11.3(e) + 11.4 → GREEN.

## Phase 15: D8 — evidence-test split + the outcome correction

- [ ] 15.1 [GREEN] `apps/api/tests/integration/sagaCrashRecovery.test.ts:1122-1127` — restructure
      the parked-replay evidence into TWO independently labeled assertions, with **(1) evaluated
      BEFORE (2)** so the FIRST failure message a red run prints is the revisit trigger:
      (1) `assert.notStrictEqual(terminal.status, "COMPLETED", …)` — ONLY this failing is the
      parking revisit trigger; (2) `assert.strictEqual(terminal.status, "FAILED")` plus the
      `/version conflict/i` match — slice-owned mechanics, allowed to evolve with the union.
- [ ] 15.2 [GREEN] `apps/api/src/saga/SagaManagerLifecycle.ts:441-446` — update the parking
      branch's revisit comment to name assertion (1) as the signal, so a mechanics regression can
      never masquerade as the post-pivot tolerance holding.
- [ ] 15.3 [GREEN] Record the derived outcome in the PR description and in the living spec: under
      this change the replayed row's wait step finds `pending=0` (`succeeded`), then
      `UpdatePostStatusStep` fails on the stale OCC token with a hard CONFLICT → `failed` → budget
      path → FAILED. **PR3 does NOT flip the status**; it may lawfully change failure-reason text
      and retry timing.
- [ ] 15.4 [GREEN] The customer-facing correction: a multi-channel publish whose channels all
      succeed reaches terminal SUCCESS on the EXISTING status surfaces, and **no new
      notification, email, push or in-app message is introduced** (Edward's decision 2). Prove it
      with the 11.4 static scenario plus an integration assertion on the existing saga status
      surface (`tests/integration/sagaCustomerFlow.test.ts`, LIVE-API evidence run).
- [ ] 15.5 Run INT-LONG `sagaCrashRecovery.test.ts` (DBUP first) → GREEN, 0 cancelled; run
      `sagaCustomerFlow.test.ts` under LIVE-API → GREEN, 0 cancelled, and record the wall time.

## Phase 16: PR3 wiring, docs, gate

- [ ] 16.1 [M4] `run-tests.sh` — append `tests/chaos/sagaWaitAmplification.test.ts` to the
      DB-free `chaos` batch (`:180-181`). Re-run the static "every saga suite is listed"
      assertion.
- [ ] 16.2 `docs/api/saga.md` + `docs/security/MULTI_TENANT_GUARDS.md` — the three-state contract,
      the in-process scope of the guard (never a cross-process guarantee), and the closure of the
      carried residuals (waiting≠failed, in-flight guard, `handleEvent` amplification).
- [ ] 16.3 Mirror the `saga-step-outcome-contract` capability into the living specs and record the
      parked-evidence restatement in `openspec/specs/saga-crash-recovery/spec.md`.
- [ ] 16.4 **0-defect gate (PR3)**: `tsc` over `@apps/api`, `@shared/types`, `@apps/client` = 0;
      `eslint --max-warnings 0` on touched files = 0; prettier clean; fitness
      **#3 / #4 / #5 / #8 / #9 / #10 / #14 / #21 / #23 / #26 = 0** (#26 because
      `apps/client/lib/**` is a bundler-compiled frontend dir — no `.js`-on-`.ts` relative
      imports); no `.only` / `.skip`; regression set green with 0 failed / 0 cancelled:
      `sagaWaitAmplification`, the saga unit surface, `sagaContextInvariants.static`,
      `sagaCrashRecovery`, `sagaCompensationRecovery`, `chaos/saga-step-retry-recovery`,
      `sagaCustomerFlow` (LIVE-API).
- [ ] 16.5 **4R full-tier adversarial review** on the PR3 diff BEFORE push; then push and require
      every CI workflow green before merge to main.

---

# PR4 — S3 + S4: row claims and the durable parked window [SCHEMA-GATED]

Both slices share ADR-1 and one migration slot per the design's rollout note.

## Phase 17: RED — ownership and window proofs

- [ ] 17.1 [RED] Create `apps/api/tests/integration/sagaClaimContention.test.ts` (node:test, real
      Postgres, production-faithful composition): (a) two readers selecting the same due set at
      the same moment — each row claimed by exactly ONE, none dispatched by both; (b) a slow head
      no longer starves the rows behind it (more due rows than one page; after several ticks the
      rows beyond page 1 are advanced and the in-flight head is NOT re-selected each tick);
      (c) rows claimed by a process that disappears become selectable again after the lease
      elapses and reach a terminal state.
- [ ] 17.2 [RED] Create `apps/api/tests/unit/saga/sagaClaimPredicate.test.ts` (vitest): the
      `nextRetryAt` partition is UNCHANGED by the claim — the boot pass still takes only rows
      without `nextRetryAt`, the scan still takes only due rows with one in BOTH `RUNNING` and
      `PENDING`, and the claim only narrows each set further (orthogonal predicates, never one
      expressed in terms of the other).
- [ ] 17.3 [RED] Extend `sagaContextInvariants.static.test.ts`: the ownership report and the
      operator docs read **at-least-once, pending SMELL-71** and never state or imply
      multi-replica support; the claim runs under the ALREADY-DECLARED saga recovery system reason
      with NO new reason added; the claim statement writes ONLY `claimedAt` / `claimedBy`
      (it can never express an `accountId`, a context, or any payload column).
- [ ] 17.4 [RED] Create `apps/api/tests/integration/sagaParkedWindow.test.ts` (node:test, real
      Postgres): (a) a parked row's window survives a restart — it continues from the ORIGINAL
      parking moment, is not re-opened, and the remaining window is shorter than a full horizon;
      (b) the saga row stays BYTE-IDENTICAL (status, step, error, `nextRetryAt`, `updatedAt`
      exactly as the interruption left them); (c) the durable record is cleared when the row
      leaves parking (operator continue, and separately expiry), and a later parking opens a fresh
      window; (d) a durable record whose saga no longer exists blocks nothing and is not treated
      as a parked saga.
- [ ] 17.5 Run INT 17.1 + 17.4 (DBUP first) + VITEST 17.2-17.3 → RED for the named mechanisms
      (no claim columns, no window table, `take: 50` hard-coded at
      `SagaManagerLifecycle.ts:1027-1046`).

## Phase 18: schema + migrations [SENSITIVE — token + DBUP]

- [ ] 18.1 **[SENSITIVE]** DBUP, then `infra/prisma/schema.prisma` `SagaInstance` (`:2048-2073`):
      add `claimedAt DateTime? @db.Timestamptz(6)` and `claimedBy String?` — additive, nullable,
      NO default (the SMELL-70 nullability flip stays OUT of scope). **No new index**: both claim
      SELECTs are served by the existing `@@index([status, startedAt])` / `@@index([status, nextRetryAt])`,
      and the claim predicate is a residual filter over an already-paged candidate set (≤ 500
      rows); an index on a column that is NULL for the whole steady-state table buys nothing —
      record that reasoning in the model comment.
- [ ] 18.2 **[SENSITIVE]** `infra/prisma/schema.prisma`: new GLOBAL model `SagaParkedWindow`
      (`sagaId String @id`, `parkedAt DateTime @db.Timestamptz(6)`, `reason String`,
      `parkedBy String`, `createdAt DateTime @default(now()) @db.Timestamptz(6)`). Like
      `OutboxEvent` / `StoredEvent`: no `accountId`, **NOT** added to `TENANT_SCOPED_MODELS`
      (`infra/prisma/src/extensions/tenantGuard.ts`), no RLS policy — it stores engine ownership
      metadata (a timestamp + reason keyed by saga id), zero customer data; the referenced
      `SagaInstance` row keeps full tenant protection. Typed Prisma API only.
- [ ] 18.3 **[SENSITIVE]** MIGRATE both changes (may share one migration or ship as two adjacent
      ones); hand-verify the SQL is additive only; author `down.sql` dropping the columns and the
      table with a comment stating that claim/park metadata is operational state pre-change code
      simply ignores, so a code revert without a schema revert is safe.
- [ ] 18.4 Apply with `pnpm db:migrate`; run `prisma validate` + `prisma migrate status` → clean
      and up to date.

## Phase 19: D9/M6 — `withSagaSystemClaim` + `SagaClaimService`

- [ ] 19.1 [GREEN] **[M6]** EXTEND `apps/api/src/saga/sagaTenant.ts` with a NEW exported narrow
      surface `withSagaSystemClaim<T>(prisma, fn)` delegating to the same unexported
      `runSagaSystemTransaction` (which binds `setTenantGuc(tx,'__system__')` as the FIRST
      statement, `:229-241`). **Do NOT route the claim UPDATE through `withSagaSystemRead`** —
      its docblock (`:170-192`) and its non-export rationale (`:222-228`) promise reads plus
      exactly ONE terminal write (`failSagaAsSystem`); a write through it makes both sentences
      false. `runSagaSystemTransaction` stays unexported; the docblock at `:222-228` gains the
      third named surface in the same edit.
- [ ] 19.2 [GREEN] Create `apps/api/src/saga/SagaClaimService.ts`
      (`@file`/`@description`/`@layer infrastructure`) with the `OutboxClaimService` SQL SHAPE
      (`apps/api/src/infrastructure/outbox/OutboxClaimService.ts:75-102`):
      `UPDATE "SagaInstance" SET "claimedAt"=…, "claimedBy"=… WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`
      — full row returned so the reader loses its second read. Surface per the design:
      `claimBootRows(tx, limit)`, `claimDueRetries(tx, pageSize, now)`, `release(tx, sagaId)`.
      The service opens NO boundary of its own; it executes against the tx its caller provides.
      `workerId = ${hostname()}-${process.pid}` (the `setupCrisisUseCases` precedent).
- [ ] 19.3 [GREEN] **[C3]** The file docblock states the EXACT call syntax
      (`tx.$queryRaw<SagaInstanceRow[]>(Prisma.sql\`UPDATE …\`)`) and notes that fitness **#23 is
BLIND to it** — the regex requires the paren immediately after the method name, so it
matches neither the generic-parameter form nor tagged templates. **No CLAUDE.md and no
`.github/workflows/fitness.yml` edit in this change**: the planned exclusion would install a
      permanently dead exclusion satisfying the delta's merge-blocking scenario cosmetically while
      the gate stays blind.
- [ ] 19.4 [GREEN] Construction wired in `SagaManagerLifecycle` (no DI token needed, per the
      design's interface note); lease duration comes from config (`claimLeaseMs`, Phase 21).

## Phase 20: D9 — both readers claim at selection; release; ownership downgraded

- [ ] 20.1 [GREEN] Boot reader `SagaManagerLifecycle.loadActiveSagas:958-969` — SELECT+claim
      inside `withSagaSystemClaim`, predicate
      `status IN ('RUNNING','PENDING','COMPENSATING') AND ("claimedAt" IS NULL OR "claimedAt" < leaseExpiry) ORDER BY "startedAt" LIMIT bootLoadLimit`.
      The same-snapshot count queries (deferred remainder, compensating orphans) ride the SAME
      transaction and stay Prisma-typed.
- [ ] 20.2 [GREEN] Retry scan `SagaManagerLifecycle.ts:1027-1046` — SELECT+claim inside
      `withSagaSystemClaim`, predicate
      `status IN ('RUNNING','PENDING') AND "nextRetryAt" <= now AND "nextRetryAt" IS NOT NULL AND (claim-free-or-expired) ORDER BY "nextRetryAt" LIMIT retryScanPageSize`.
      **Starvation closes by construction**: a claimed slow head is skipped on the next tick, so
      the page reaches rows 51+. The `nextRetryAt` partition is UNTOUCHED — the claim is an
      additional orthogonal predicate.
- [ ] 20.3 [GREEN] **Release** = `claimedAt`/`claimedBy` → NULL at the in-flight guard's exit
      (PR3's D7b `finally`, `SagaManagerExecution.ts` guard) when the saga went dormant (terminal,
      retry-scheduled, waiting-scheduled) — ONE release point because the guard is the one funnel.
      The release call site opens its own `withSagaSystemClaim` (the guard is not a reader and has
      no tx in hand). Crash release is lease expiry, never a manual sweep.
- [ ] 20.4 [GREEN] `SagaManagerLifecycle.ts:228-236` — rewrite the boot ownership log to
      `recoveryOwnership: "row-claims", delivery: "at-least-once", multiReplicaSupported: false, pending: "SMELL-71"`.
      This is a DOWNGRADE of the constraint, never a lift; mirror the same language in
      `docs/security/MULTI_TENANT_GUARDS.md`, `docs/observability/SLO.md` and the living spec.
      State the operational consequence honestly: an expired lease under a live holder ⇒ a second
      dispatcher ⇒ duplicate step execution across processes; deterministic job ids + OCC +
      semantic locks absorb the known paths, and the duplicate-DRAFT path stays real until
      SMELL-71.
- [ ] 20.5 Run INT 17.1 + VITEST 17.2-17.3 → GREEN.

## Phase 21: D10 — the unwired knobs close at the seam they recurred on

- [ ] 21.1 [GREEN] `apps/api/src/saga/sagaManagerTypes.ts` — add `retryScanPageSize` and
      `claimLeaseMs` (`bootLoadLimit` already exists at `:58`); the lifecycle reads
      `this.config.retryScanPageSize ?? 50` instead of the hard-coded `take: 50`.
- [ ] 21.2 [GREEN] `apps/api/src/saga/SagaIntegration.ts:61-98` — `SagaIntegrationConfig` gains
      optional `bootLoadLimit`, `retryScanPageSize`, `claimLeaseMs` (and keeps PR3's
      `waitPollMs`), forwarded into the `SagaManagerImpl` config at `:200-211` via conditional
      spread (`exactOptionalPropertyTypes`). **`bootLoadLimit` is finally passed on the PRODUCTION
      path** — the documented-but-unwired operator knob is the defect this closes.
- [ ] 21.3 [GREEN] **Lease = 10 min default (`claimLeaseMs`)**, with the justification in the
      field's docblock: it must exceed the worst legitimate hold (a boot batch of `bootLoadLimit`
      = 500 rows draining through `maxConcurrentSagas` = 100 with multi-second steps) and stay
      well under the 30-min saga horizon minus one recovery cycle, so an expired claim can still
      be re-claimed and completed before the timeout sweep terminalizes the row. The outbox's
      5 min is tuned to single-event dispatch; saga holds are batch-drain-shaped ⇒ 2×.
- [ ] 21.4 [GREEN] Static-pin both spec scenarios: a value set on the production composition
      surface reaches the boot load, and a value set there reaches the scan's page size — neither
      is a compile-time constant on the production path.
- [ ] 21.5 Record the measured boot-drain timings from the 17.1 run against the 10-min default and
      confirm or adjust it (design open question: `claimLeaseMs` production value).

## Phase 22: D11 — `SagaParkedWindow` lifecycle

- [ ] 22.1 [GREEN] `SagaManagerLifecycle.park:473-477` — additionally upsert the window with
      **create-only semantics** (`update: {}` — an existing row's `parkedAt` is NEVER overwritten:
      the window opens exactly ONCE, at first parking). This is what closes the crash-loop edge
      (today each reboot re-parks and re-opens a fresh window, so a crash-looping pod defers the
      terminal guarantee indefinitely).
- [ ] 22.2 [GREEN] Boot hydration: after the resume pass, load windows for parked-disposition rows
      into the in-memory `parkedAt` map (`:151`), which becomes a READ CACHE over the table;
      `checkSagaTimeout` (`:1137-1161`) reads the map unchanged.
- [ ] 22.3 [GREEN] Deletion at the async terminal / unpark sites — `continueSaga:712`, window
      expiry `:1160`, `terminalizeUnscopableSaga:1224` — awaited best-effort; `stopTracking` stays
      sync (map only).
- [ ] 22.4 [GREEN] **Boot-time GC sweep** is the invariant keeper: windows whose saga is terminal
      or absent are garbage-collected during hydration, so a missed delete can never terminalize a
      future row.
- [ ] 22.5 [GREEN] State the new contract precisely in code + runbook: a parked row's window opens
      at FIRST parking and elapses in wall-clock time across restarts
      (`parkedFor = now − SagaParkedWindow.parkedAt`); the **downtime edge is ACCEPTED and
      STATED** — a window that fully elapses during an outage is terminalized `parked-expired` on
      the first post-boot tick, because the operator HAD the window when parking happened. The
      saga row stays byte-identical throughout.
- [ ] 22.6 Run INT 17.4 → GREEN.

## Phase 23: ADR-1, the scoped delta, the SMELL entry, docs

- [ ] 23.1 Create `docs/technical/ADR-NNNN-saga-row-ownership-and-park-record.md` (ADR-0001
      template: Status/Date/Deciders/Context/Decision/Rationale/Alternatives/Consequences/
      Revisit-if/Risks/References). Status Proposed → Accepted; Deciders Edward. Decisions:
      (1) lease-based row claims taken at SELECTION time in both readers via `SagaClaimService`
      inside the saga system boundary; (2) lease 10 min = 2× outbox, bounded by batch-drain below
      and the 30-min horizon above; (3') **fitness #23 is BLIND to the claim SQL's syntax**
      (`$queryRaw<T>(Prisma.sql…)`) and to tagged templates — no exclusion is added because none
      would ever fire; the measured **8-file raw-SQL baseline** is recorded and the regex fix is
      delegated to a house-level canon change; (4) `SagaParkedWindow` as the durable park record
      (option C — byte-identity preserved); (5) ownership reporting downgraded to at-least-once,
      pending SMELL-71; plus the `withSagaSystemClaim` boundary (M6) and the scoped
      `multi-tenant-isolation` delta (M1). Rejected: per-process ownership, `nextRetryAt`-as-
      pseudo-lease, a park column on the saga row, `updatedAt`-derived window. Revisit if:
      SMELL-71 lands, or `compensation-expired` fires in production (dedicated compensation retry
      policy).
- [ ] 23.2 **[M1]** Create
      `openspec/changes/saga-engine-terminal-hygiene/specs/multi-tenant-isolation/spec.md` — a
      SCOPED MODIFIED delta recording the claim UPDATE as the **second** named cross-tenant write
      surface (after `failSagaAsSystem`), normatively constrained to `claimedAt` / `claimedBy`
      ONLY, so the living requirement's FAIL-LOUDLY clause stays true by construction; note that
      layer 2 still evaluates it (the RLS policy's `USING` + `WITH CHECK` both admit the
      `__system__` sentinel — verified against migration `20260527000000`).
- [ ] 23.3 **[C3]** `docs/reports/roadmap-detected-smells-backlog.md` — new SMELL: "fitness #23
      regex blind to generic / tagged-template raw-query forms", with the 8-file baseline attached
      so the ramp-down starts from measured reality.
- [ ] 23.4 `docs/security/MULTI_TENANT_GUARDS.md` — claim posture, the third named system surface,
      the parked-window runbook rewritten for a DURABLE window (the per-process wording and the
      restart-loop hazard are both obsolete), and the unpark/terminalize procedure updated.
- [ ] 23.5 Mirror the PR4 delta requirements into the living
      `openspec/specs/saga-crash-recovery/spec.md` and
      `openspec/specs/multi-tenant-isolation/spec.md`.

## Phase 24: PR4 wiring, gate

- [ ] 24.1 [M4] `run-tests.sh` — append `tests/integration/sagaClaimContention.test.ts` and
      `tests/integration/sagaParkedWindow.test.ts` to the `integration:saga-recovery` batch
      (`:214`, `TIMEOUT=120000`); re-run the static "every saga suite is listed" assertion.
- [ ] 24.2 **0-defect gate (PR4)**: `tsc` over `@apps/api`, `@shared/types`, `@infra/prisma` = 0;
      `eslint --max-warnings 0` on touched files = 0; prettier clean; fitness
      **#3 / #4 / #5 / #8 / #9 / #10 / #14 / #21 / #23 = 0** (#23 stays 0 by blindness — verify by
      running the exact CLAUDE.md command, and record the count in the PR body so the claim is
      measured, not assumed); `prisma validate` + `prisma migrate status` clean; no `.only` /
      `.skip`; regression set green with 0 failed / 0 cancelled: `sagaClaimContention`,
      `sagaParkedWindow`, `sagaCompensationRecovery`, `sagaCrashRecovery`, `sagaTenantIsolation`,
      `sagaAccountIdBackfill`, the saga unit surface, `chaos` batch; post-run leak check.
- [ ] 24.3 **4R full-tier adversarial review** on the PR4 diff BEFORE push (schema + publish hot
      path); then push and require every CI workflow green before merge to main.
- [ ] 24.4 Close-out: confirm every Success Criterion in `proposal.md` has a landed task, and hand
      the residuals (SMELL-71 command-id dedupe as the gate for ever lifting the multi-replica
      constraint; the `CQRSBus` `redis.keys()` hazard; the #23 regex fix) to the backlog with
      pointers.
