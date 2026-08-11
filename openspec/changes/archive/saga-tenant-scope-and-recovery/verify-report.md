```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:70ef055fe0c03b0153bf4bbe7d374e2e765a7529e1b29f17c5e438d5eb99c060
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 17/17
scenarios: 46/46
test_command: node --import tsx --conditions development --test --test-force-exit --test-concurrency=1 --test-timeout=120000 --env-file=../../.env --env-file=../../.env.test tests/integration/sagaCrashRecovery.test.ts tests/integration/sagaTenantIsolation.test.ts tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts tests/chaos/saga-step-retry-recovery.test.ts
test_exit_code: 0
test_output_hash: sha256:70ef055fe0c03b0153bf4bbe7d374e2e765a7529e1b29f17c5e438d5eb99c060
build_command: pnpm exec tsc -b apps/api packages/shared
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: saga-tenant-scope-and-recovery (N-COR-7 + N-COR-2a)
**Version**: PR1 #173 + PR2 #180, merged to main `bd1adbb4`; verified at branch tip `10b72d6a`
**Mode**: Strict TDD
**Artifact store**: hybrid (files authoritative; engram obs 437 carries apply progress). NOTE: the file half of hybrid persistence was deliberately skipped — the verify launch prompt forbade modifying any file. The admitted report bytes live here.

### Completeness

| Metric           | Value |
| ---------------- | ----- |
| Tasks total      | 92    |
| Tasks complete   | 92    |
| Tasks incomplete | 0     |

Phases 0-11 plus the four rework phases (7R, 7R2, 7R3, 9R, 9R2) are all checked. No task claims completion without a corresponding artifact.

### Build & Tests Execution

**Build**: PASSED — `pnpm exec tsc -b apps/api packages/shared` exit 0, empty output.

**Tests**: every suite the change owns reproduced at runtime, single-file per the LXC recipe.

| Suite                                                                              | Tier     | Result                                                |
| ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| `tests/integration/sagaCrashRecovery.test.ts`                                      | INT      | 17 tests · 17 pass · 0 fail · 0 cancelled · 0 skipped |
| `tests/integration/sagaTenantIsolation.test.ts`                                    | INT      | 18 · 18 · 0 · 0 · 0                                   |
| `tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts`         | INT      | 10 · 10 · 0 · 0 · 0                                   |
| `tests/chaos/saga-step-retry-recovery.test.ts`                                     | INT      | 1 · 1 · 0 · 0 · 0                                     |
| Combined envelope command (the four above)                                         | INT      | 46 · 46 · 0 · 0 · 0, exit 0                           |
| `tests/integration/sagaCustomerFlow.test.ts` (live API, port 3001)                 | INT-LONG | 13 · 13 · 0 · 0 · 0, wall 99.7s                       |
| `tests/unit/saga/sagaBootResume.test.ts`                                           | VITEST   | 8 passed                                              |
| `tests/unit/saga/sagaContextInvariants.static.test.ts`                             | VITEST   | 45 passed                                             |
| `tests/unit/saga/sagaTenant.test.ts` + `sagaPersistence.column.test.ts`            | VITEST   | 40 passed                                             |
| saga unit surface (17 files)                                                       | VITEST   | 209 passed                                            |
| `preAuthBillingTenantIsolation` + `preAuthInboundWebhookTenantIsolation` (carried) | INT      | 2 · 2 · 0 · 0 · 0                                     |

Every number above was measured in this verification. Zero cancelled, zero skipped, zero `.only`/`.skip` anywhere in the saga surface.

Runner-gate reproduction (the MERGE-BLOCKING cancel-gate scenario), executed end to end against `TIER=pr-integration` with an unreachable `DATABASE_URL`:

```text
integration:saga-recovery   17 tests   0 pass  0 fail  17 cancel  0 skip  exit 1  [FAIL]
TOTAL: 390 tests, 12 pass, 11 fail, 331 cancel, 36 skip
FAILED batches: ... integration:saga-recovery
RUNNER_SCRIPT_EXIT=1
```

The batch that would previously have printed OK with `# fail 0` now fails the run.

**Quality gate**: ESLint `--max-warnings 0` over the saga sources, metrics module and saga tests → exit 0. Prettier `--check` over the same set plus the living spec and `MULTI_TENANT_GUARDS.md` → clean. Fitness #3 / #5 / #8 / #9 / #10 / #21 / #23 = 0 / 0 / 0 / 0 / 0 / 0 / 0. Zero `canon-exception` markers in the saga surface.

**Coverage**: not collected — the LXC memory cap forbids the instrumented full run, and the change's own gate (tasks 7.3 / 11.3) never claimed a coverage figure. Not a failure.

### Spec Compliance Matrix

Inventory: the SHIPPED contract = living `saga-crash-recovery` spec (10 reqs / 28 scenarios, authoritative per its own amendment block) + `multi-tenant-isolation` delta (4 / 9) + `tenant-context-boundaries` delta (3 / 9) = **17 requirements / 46 scenarios**.

| Requirement                                              | Scenario                                                             | Evidence                                                                                                                                                                                                                         | Result    |
| -------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| CR-1 composition registers definitions BEFORE initialize | source order pinned [static]                                         | `sagaContextInvariants.static` › "registers the saga definitions BEFORE the manager initializes"                                                                                                                                 | COMPLIANT |
| CR-1                                                     | boot of only-unregistered rows reports a composition defect [unit]   | `sagaBootResume` › "reports a boot in which EVERY row is unregistered as a composition defect" (asserts `bootLoadFailures=1` AND `health.status==="degraded"`)                                                                   | COMPLIANT |
| CR-2 ownership partitioned, one owner per process        | pre-pivot saga resumes and terminates [integration]                  | `sagaCrashRecovery` › "resumes the saga interrupted before its pivot and drives it to a terminal state"                                                                                                                          | COMPLIANT |
| CR-2                                                     | graceful-shutdown hand-off claimed by the scan [integration]         | `sagaCrashRecovery` › "is claimed by the retry checker and reaches a terminal state"                                                                                                                                             | COMPLIANT |
| CR-2                                                     | retry-owned rows not double-claimed [integration]                    | `sagaCrashRecovery` › "leaves the saga PENDING with its pending retry intact"                                                                                                                                                    | COMPLIANT |
| CR-2                                                     | pivot retry refused by the countermeasure [integration]              | `sagaCrashRecovery` › "aborts the pivot re-entry through its reread countermeasure" + "produces no second job and no second publish"                                                                                             | COMPLIANT |
| CR-3 boot pass BOUNDED and CONTAINED                     | COMPENSATING orphans counted, never resumed [unit]                   | `sagaBootResume` › "counts the COMPENSATING orphans without loading or dispatching them"                                                                                                                                         | COMPLIANT |
| CR-3                                                     | one unreadable row costs one saga [unit]                             | `sagaBootResume` › "skips a row it cannot read and still recovers the rows behind it"                                                                                                                                            | COMPLIANT |
| CR-3                                                     | fan-out honours the ceiling [unit]                                   | `sagaBootResume` › "advances no more sagas at once than the configured ceiling"                                                                                                                                                  | COMPLIANT |
| CR-3                                                     | load ceiling defers rather than truncates [unit]                     | `sagaBootResume` › "defers the rows past its load ceiling, counted and never silently truncated"                                                                                                                                 | COMPLIANT |
| CR-4 pivot-interrupted saga PARKED, not replayed         | left untouched at boot [integration]                                 | `sagaCrashRecovery` › "parks the saga interrupted at the pivot instead of replaying it" + "dispatches nothing at all for the parked saga" + "leaves the parked saga's post in a single consistent state"                         | COMPLIANT |
| CR-4                                                     | parked saga counted and named [integration]                          | `sagaCrashRecovery` › "counts the parked saga and names it in the logs" + "reports one resume and one parked row in the boot summary"                                                                                            | COMPLIANT |
| CR-4                                                     | ordinary sweep does not terminalize a parked row [integration]       | `sagaCrashRecovery` › "does not terminalize a parked row whose ordinary timeout has already passed"                                                                                                                              | COMPLIANT |
| CR-4                                                     | expired window terminalizes once as `parked-expired` [integration]   | `sagaCrashRecovery` › "terminalizes the parked row once its operator window expires, exactly once and as parked-expired"                                                                                                         | COMPLIANT |
| CR-4                                                     | replay evidence stays executable [integration]                       | `sagaCrashRecovery` › "records what a replay actually does: the queue absorbs the pivot, the step after it is rejected" (observed `Post version conflict: expected 0, found 1` → FAILED, the recorded justification for parking) | COMPLIANT |
| CR-5 terminal sagas never re-executed                    | terminal rows untouched by a restart [integration]                   | `sagaCrashRecovery` › "leaves a saga that was already terminal untouched when a manager boots"                                                                                                                                   | COMPLIANT |
| CR-5                                                     | post-pivot failure compensates nothing [integration]                 | `sagaCrashRecovery` › "compensates no pivot or post-pivot step..." + `sagaCustomerFlow` › "does NOT compensate steps at or after the pivot when saga fails post-pivot"                                                           | COMPLIANT |
| CR-6 post-pivot failure terminal within the horizon      | terminates instead of hanging [integration]                          | `sagaCustomerFlow` 13/13, the post-pivot assertion completing in 49.6s inside the 90s horizon                                                                                                                                    | COMPLIANT |
| CR-7 every recovery write binds both layers              | unscopable persist refused, not degraded [unit]                      | `sagaPersistence.column` / `sagaTenant` (40 passed); `persistSagaInstance` throws `AppError.internal` before any transaction opens                                                                                               | COMPLIANT |
| CR-7                                                     | no dispatch inside a system boundary [static]                        | `sagaContextInvariants.static` › "keeps every dispatch lexically outside every declared system boundary"                                                                                                                         | COMPLIANT |
| CR-7                                                     | the engine opens no transaction of its own [static]                  | `sagaContextInvariants.static` › "opens none anywhere else in the engine"; repo-wide grep confirms the only two `$transaction` call sites are the two `sagaTenant.ts` primitives                                                 | COMPLIANT |
| CR-8 dedupe keys derive only from durable identity       | deterministic across processes [static]                              | `sagaContextInvariants.static` › "derives every command id from the saga id and the step id alone" + "reads no clock and no randomness in any dedupe key"                                                                        | COMPLIANT |
| CR-8                                                     | publish-job key reaches the queue as the job id [static]             | `sagaContextInvariants.static` › "hands that key to the queue as the job's dedupe key"                                                                                                                                           | COMPLIANT |
| CR-9 saga suites wired EXPLICITLY                        | a batch whose setup collapses fails the run [static]                 | reproduced live: `integration:saga-recovery` 17 cancelled, exit 1, run exits 1                                                                                                                                                   | COMPLIANT |
| CR-9                                                     | every saga suite appears in the runner list [static]                 | `sagaContextInvariants.static` › "lists every one of them explicitly in run-tests.sh"                                                                                                                                            | COMPLIANT |
| CR-9                                                     | the wired saga suites pass in a full run [integration]               | every wired saga suite executed: 17 + 18 + 10 + 1 + 13, all green, 0 cancelled                                                                                                                                                   | COMPLIANT |
| CR-10 zero defects                                       | gate green end to end [static]                                       | tsc 0, eslint 0, prettier clean, 7 fitness checks at 0, 0 cancelled / 0 skipped                                                                                                                                                  | COMPLIANT |
| CR-10                                                    | no suppression used to reach green [static]                          | 0 `.only`/`.skip`, fitness #5 (`@ts-ignore`) = 0, 0 `canon-exception` in the saga surface                                                                                                                                        | COMPLIANT |
| MT-1 accountId carries the TRUE tenant                   | the two identifiers are distinct [static]                            | `sagaTenantIsolation` fixture asserts `customerUser.id !== account.id`                                                                                                                                                           | COMPLIANT |
| MT-1                                                     | a started saga persists the account, not the user [integration]      | `sagaTenantIsolation` (18/18)                                                                                                                                                                                                    | COMPLIANT |
| MT-1                                                     | two-tenant isolation through the guarded client [integration]        | `sagaTenantIsolation` — list excludes B, by-id resolves NOT_FOUND, Redis fast path defeated per W4                                                                                                                               | COMPLIANT |
| MT-2 engine on the guarded client                        | no construction path takes the raw singleton [static]                | `sagaContextInvariants.static` › "never passes a binding imported from the raw prisma module" + "resolves the client from the container instead"                                                                                 | COMPLIANT |
| MT-2                                                     | a mismatched account fails loudly [integration]                      | `sagaTenantIsolation` — `TenantContextMismatchError`, including in-transaction                                                                                                                                                   | COMPLIANT |
| MT-3 backfill integrity                                  | mappable rows corrected [integration]                                | `sagaAccountIdBackfill` 10/10                                                                                                                                                                                                    | COMPLIANT |
| MT-3                                                     | unmappable terminal row gets the sentinel [integration]              | `sagaAccountIdBackfill`                                                                                                                                                                                                          | COMPLIANT |
| MT-3                                                     | unmappable non-terminal halts the migration [deploy-time]            | `sagaAccountIdBackfill` RAISE case; verified live: migration `20260731000000` applied, `SELECT count(*) ... accountId IN (SELECT id FROM "CustomerUser")` = 0, `down.sql` a documented no-op                                     | COMPLIANT |
| MT-4 residual structural leg recorded                    | gap documented and tracked [static]                                  | `MULTI_TENANT_GUARDS.md` + SMELL-73 backlog entry; leg-1 residual verified in schema (`accountId String?`, no `Account` relation)                                                                                                | COMPLIANT |
| TC-1 engine internals a declared boundary                | each loop declares its context [static]                              | `sagaContextInvariants.static` (45/45), incl. the read/write classifier with synthetic controls in both directions                                                                                                               | COMPLIANT |
| TC-1                                                     | the loops actually execute after the declaration [integration]       | `sagaTenantIsolation` — both scans observe both accounts, no `TenantContextMissingError`                                                                                                                                         | COMPLIANT |
| TC-1                                                     | request-scoped persistence stays tenant-bound [integration]          | `sagaTenantIsolation`                                                                                                                                                                                                            | COMPLIANT |
| TC-1                                                     | system context never leaks into customer-visible reads [integration] | `sagaTenantIsolation` + `sagaCustomerFlow` › "returns 404 from GET /sagas/:sagaId for a saga owned by another customer"                                                                                                          | COMPLIANT |
| TC-2 context failures observable, never swallowed        | no background catch discards its error [static]                      | `sagaContextInvariants.static` › "discards no error in any background loop catch block"                                                                                                                                          | COMPLIANT |
| TC-2                                                     | induced context failure visible in logs and metrics [integration]    | `sagaTenantIsolation` › "counts and logs the boot-load failure..." + "...a failing retry tick instead of reporting an empty successful scan"                                                                                     | COMPLIANT |
| TC-3 (MODIFIED) system-context webhook seams             | billing webhook under the declared context [integration]             | `preAuthBillingTenantIsolation` — re-run green in this verification                                                                                                                                                              | COMPLIANT |
| TC-3                                                     | inbound-webhook seam wraps the worker callbacks [integration]        | `preAuthInboundWebhookTenantIsolation` — re-run green                                                                                                                                                                            | COMPLIANT |
| TC-3                                                     | the saga reason constant is fixed and audited [static]               | `sagaContextInvariants.static` › "passes the declared reason constant at every call site"; `SAGA_SYSTEM_REASON = "system:saga-recovery"` is the sole engine reason                                                               | COMPLIANT |

**Compliance summary**: 46/46 scenarios COMPLIANT. 0 UNTESTED, 0 FAILING, 0 PARTIAL.

### Correctness (Static Evidence) — the load-bearing claims, spot-checked

| Claim                                                              | Status                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column-authoritative tenant resolution                             | Implemented                    | `resolveSagaTenant` reads the column first, context/metadata as fallback AND cross-check; a disagreement returns `tenant-mismatch` and fails CLOSED before any write                                                                                                                                                                                                                                                   |
| Dual-layer binding on every engine read/write                      | Implemented                    | `withSagaSystemRead` → private `runSagaSystemTransaction` → `withSystemContext(SAGA_SYSTEM_REASON)` + `$transaction` + `setTenantGuc(SYSTEM_TENANT_SCOPE)` as the first statement; `runSagaTenantTransaction` binds `setTenantGuc(accountId)` likewise. Verified empirically that the `tenant_isolation` policy honours `__system__` as a full bypass, so the system read genuinely returns rows under a hardened role |
| `failSagaAsSystem` is the only exported cross-tenant WRITE         | Implemented                    | `runSagaSystemTransaction` is module-private (export-surface invariant pins it); the terminal write commits the `SAGA_FAILED` event in the SAME transaction and releases the semantic locks after; no dispatch inside                                                                                                                                                                                                  |
| Production composition order + three-tier defence                  | Implemented                    | `SagaIntegration.initialize()` calls `registerSagaDefinitions()` then `sagaManager.initialize()`; defended by (1) the static source-order invariant, (2) the `definition-unregistered` disposition, (3) the all-rows-unregistered ERROR that degrades the health check                                                                                                                                                 |
| Pivot PARKING with the window measured from `parkedAt`             | Implemented                    | `park()` records `Date.now()`; `checkSagaTimeout` returns early inside the window and terminalizes as `parked-expired` after one full horizon, exactly once (`stopTracking` + terminal-state guard)                                                                                                                                                                                                                    |
| Ownership partition by `nextRetryAt` nullability                   | Implemented                    | boot claims `nextRetryAt === undefined`; the scan claims `nextRetryAt: { lte: now, not: null }` across `RUNNING` and `PENDING`. Predicates provably disjoint                                                                                                                                                                                                                                                           |
| Bounded boot: `bootLoadLimit` + `maxConcurrentSagas` actually read | Implemented                    | `loadActiveSagas` reads `config.bootLoadLimit` (default 500, oldest-first, deferred counted in the SAME transaction); `dispatchResumableSagas` reads `config.maxConcurrentSagas` and awaits `executeSaga` to cap in-flight work                                                                                                                                                                                        |
| Per-row containment                                                | Implemented                    | per-row `try/catch` counting `stage="resume-row"`, plus a pass-level `try/catch` so no throw can reject `initialize()`                                                                                                                                                                                                                                                                                                 |
| Cancel gate in `run-tests.sh`                                      | Implemented, with one residual | `TOTAL_CANCEL > 0` fails the run (reproduced live). The runner exit code is captured per batch but does not itself gate the script exit — see WARNING 1                                                                                                                                                                                                                                                                |
| Account-less persist removed (residual #8)                         | Implemented                    | `persistSagaInstance` throws `AppError.internal` before any transaction opens; the only two `$transaction` call sites in the whole engine are the two tenant primitives                                                                                                                                                                                                                                                |
| Observability                                                      | Implemented                    | `saga_recovery_failures_total{stage}`, `saga_recovery_parked_total{reason}`, `saga_recovery_deferred_rows`, `saga_compensating_orphans`, `sagas_failed_total{reason}` all exported; 7 alert rules present incl. `SagaParkedWindowExpired`, `SagaBootLoadDeferred`, `SagaCompensatingOrphans`                                                                                                                           |

### Documented residuals — accuracy audit

| Residual                                                                               | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-process ownership / multi-replica unsupported (SMELL-73)                           | ACCURATE. Stated in the living spec, the delta, `MULTI_TENANT_GUARDS.md`, the backlog, AND emitted as one INFO line per boot (`multiReplicaSupported: false`). Blast radius correctly traced through SMELL-71 to a second real publish                                                                                                                                                                                                                  |
| `parkedAt` does not survive a restart                                                  | ACCURATE. Stated as per-process, window re-opens on restart, restart-loop named as an incident with a runbook line                                                                                                                                                                                                                                                                                                                                      |
| Retry-scan `take: 50` head-of-line starvation                                          | ACCURATE. Documented with its mechanism (`nextRetryAt` cleared only after success), and the take:50-vs-boot-ceiling asymmetry stated as a consequence of the same missing claim rather than a tuning problem                                                                                                                                                                                                                                            |
| Duplicate DRAFT / no CQRS bus dedupe (SMELL-71) + dead `TOKENS.SagaManager` (SMELL-72) | ACCURATE. Both in the backlog with mechanism, measured consequence, and remediation. SMELL-71 correctly bounded to duplicate DRAFT rows, not duplicate publishes                                                                                                                                                                                                                                                                                        |
| `COMPENSATING` detection-only                                                          | ACCURATE. Counted in the same declared read boundary, published in process / on `/sagas/metrics` / as a gauge / at WARN, and explicitly NOT loaded, tracked, resumed or compensated                                                                                                                                                                                                                                                                     |
| `image-size` magic-byte gate (advisory wave 9)                                         | ACCURATE. `isAcceptedImageFormat` admits only JPEG/PNG/GIF/WebP by leading bytes before `imageSize` is ever called; `BlueskyClient.ts` is the only production caller in the repo, and the unit pin exists                                                                                                                                                                                                                                               |
| Still-`DRAFT` pivot re-entry residual (M7)                                             | ACCURATE, and unusually honest. The guards doc names the only production writer of `Post.status = "PUBLISHED"` (the five inbound webhook processors), states that `UpdatePostCommandHandler` ignores `data.status` and `PostAggregate.markAsPublished` has no production caller, and concludes the RereadCheck's retention-independence holds ONLY post-promotion — with the checker path explicitly exposed. Both windows have an integration scenario |
| RLS leg 3 correction (7R.8)                                                            | VERIFIED TRUE against the live database: `SagaInstance` carries the `tenant_isolation` policy (`cmd=ALL`) and `relrowsecurity = t`. The delta's original "no leg-3 policy" claim was correctly retracted, and the living spec's singular "structural leg" is right                                                                                                                                                                                      |

### Coherence (Design)

| Decision                                                      | Followed? | Notes                                                                                                                                               |
| ------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 guarded client at the construction site                    | Yes       | pinned by a static invariant                                                                                                                        |
| D2 column truth, `userId` kept for audit                      | Yes       | strengthened by 7R.2 to column-authoritative                                                                                                        |
| D3 rehydrated tenant ctx + query-scoped system ctx (C1/C2/S3) | Yes       | amendments authoritative; dispatch invariant pinned statically                                                                                      |
| D4 backfill metadata-first / join-second / sentinel / RAISE   | Yes       | verified applied, criterion = 0                                                                                                                     |
| D5 boot resume single pass, GATED on crash-replay             | Yes       | gate returned NEGATIVE; parking shipped as the designed fallback, with the revisit condition tied to a test that turns RED when the tolerance holds |
| D6 horizon 30s → 90s                                          | Yes       | measured 49.6s in the 90s window this run                                                                                                           |
| D7 PR seam PR1 = scope, PR2 = recovery                        | Yes       | both merged; Unit-2 rollback boundary corrected in 9R.9                                                                                             |
| Amendment blocks referenced where behavior diverged           | Mostly    | one stale interface block — see WARNING 4                                                                                                           |

### TDD Compliance

| Check                            | Result | Details                                                                                                                                                                   |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TDD evidence reported            | PASS   | RED-before-GREEN recorded per phase; 9R.10 records RED evidence in the production-faithful harness for every behavioural fix                                              |
| All tasks have tests             | PASS   | every behavioural task maps to a suite that exists on disk                                                                                                                |
| RED confirmed (test files exist) | PASS   | 9/9 saga test files present                                                                                                                                               |
| GREEN confirmed (tests pass now) | PASS   | 46/46 node:test + 209 vitest + 13 live-API, re-measured this run                                                                                                          |
| Triangulation adequate           | PASS   | the pivot re-entry is triangulated across BOTH windows (post promoted vs still `DRAFT`); the static classifier is exercised against synthetic controls in both directions |
| Safety net for modified files    | PASS   | each rework phase re-ran the suites it touched                                                                                                                            |

**TDD compliance**: 6/6 checks passed.

### Test Layer Distribution

| Layer                                             | Tests   | Files  | Tools                       |
| ------------------------------------------------- | ------- | ------ | --------------------------- |
| Unit (vitest)                                     | 209     | 17     | vitest                      |
| Integration (node:test, real DB + Redis + BullMQ) | 46      | 4      | node:test                   |
| Live-API integration                              | 13      | 1      | node:test + running Fastify |
| Carried tenant-boundary integration               | 2       | 2      | node:test                   |
| **Total measured**                                | **270** | **24** |                             |

### Assertion Quality

Audited the suites this change created or reworked. No tautologies, no assertion without a production-code call, no ghost loops, no smoke-only tests. Two patterns are notably strong: `ProcessedJob.jobId` was made load-bearing so a second publish surfaces as a second id rather than as a count, and the static classifier pins the found operations as an exact set plus a minimum count so pattern rot fails loudly instead of returning the scan to zero matches. Negative assertions in the crash-recovery suite are gated on a POSITIVE synchronization point (the happy-path canary's terminal state) rather than on fixed sleeps.

**Assertion quality**: All assertions verify real behavior — 0 CRITICAL, 0 WARNING.

### Quality Metrics

**Linter**: no errors, no warnings (`--max-warnings 0`, exit 0).
**Type checker**: no errors (`tsc -b apps/api packages/shared`, exit 0).
**Formatter**: Prettier clean over all inspected paths.
**Fitness**: #3, #5, #8, #9, #10, #21, #23 = 0.

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. **`run-tests.sh` captures the runner exit code per batch but never propagates it to the run's exit status.** `run_batch` marks a batch FAILED when `runner_exit != 0` (`apps/api/scripts/run-tests.sh:97-99`) and appends it to `FAILED_BATCHES`, but the final gate (`:279`) tests only `TOTAL_FAIL` and `TOTAL_CANCEL`. A batch that exits non-zero with `0 fail / 0 cancel` — a crash after the TAP summary, a post-summary unhandled rejection — prints `[FAIL]`, dumps its output, and the script still exits 0 without even printing `FAILED batches:`. Reproduced with the verbatim gate block extracted from the script (`FAILED_BATCHES` non-empty, `TOTAL_FAIL=0`, `TOTAL_CANCEL=0` → exit 0). Narrow: the MERGE-BLOCKING scenario the spec names (DB unreachable → cancelled subtests) IS closed, and was reproduced end to end. The residual is only the clean-counts case, so the spec sentence "SHALL capture the runner's exit code rather than discarding it" is half-honoured — captured for display, not for the gate.

2. **A drain-sense use of "park" survives in a test, contradicting task 9R2.5 [M5] and a normative SHALL.** The living spec says the word `parked` "SHALL carry exactly one meaning" and "SHALL NOT share a term in code, logs, tests, specs or runbooks", and 9R2.5 claims "No drain-sense use of the word survives in the repo". But `apps/api/tests/integration/sagaTenantIsolation.test.ts:1168` is `describe("shutting down while a saga cannot be parked", ...)` and `:1203` asserts `"the failed park must surface at ERROR"` — both describing the graceful-shutdown drain persist, which the shipped contract says HANDS OFF. Vocabulary only; no code path, log line, metric, alert or runbook is affected. Every other site is correct (`SagaManagerLifecycle.ts`: "The drain HANDS OFF, it does not park").

3. **The change's final evidence of record understates the shipped tree.** Task 11.3 (the PR2 0-defect gate) records `sagaCrashRecovery 9/9` and `saga unit set 16 files / 199 tests`; the shipped tree measures 17/17 and 17 files / 209 tests. Task 9R.7's reproduction figure ("15 tests ... 15 cancelled") is now 17/17. The cause is structural: phases 9R and 9R2 landed after 11.3 in time and, unlike 7R2 and 7R3, carry no "what was actually executed" table of their own, so the last table in the file predates the rework that grew the suites. Every stale figure understates, never overstates, so no claim is false — but a reader taking 11.3 as the gate of record would under-count the shipped coverage.

4. **`design.md §Interfaces / Contracts` was never refreshed and now contradicts the shipped signatures.** It declares `resolveSagaAccountId(context: SagaContext)` (shipped takes a `SagaInstance`), `runAsSagaTenant(...): Promise<T | undefined>` (shipped returns the discriminated `SagaWorkOutcome<T>`), and a three-field `SagaMetrics` addition (shipped adds ten counters plus `compensatingOrphans`). The D3 `AMENDED AT 4R REVIEW` block states the discriminated outcome in prose and is authoritative, so the contract is not violated — but the code block is stale and is exactly what the successor change (`saga-engine-terminal-hygiene`) would read first.

**SUGGESTION**:

1. The proposal's `## Success Criteria` checkboxes are all still `- [ ]` although every one of the seven is met (each verified in this run). Tick them at archive so the proposal reads as closed.
2. The runner has a cancel gate but no skip gate. In the reproduction run, `integration:sync` reported `36 tests / 0 pass / 36 skip / exit 0 [OK]`. The zero-defect scenario says "zero tests are cancelled **or skipped**", but only the cancelled half is enforced. Out of this change's scope; a natural companion for `saga-engine-terminal-hygiene`.
3. The live-API suite leaves six `saga:*` Redis cache entries (~24 h TTL) for sagas whose DB rows are already gone. Harmless and self-expiring, but the documented post-run leak check counts only DB rows and `bull:*` keys.

### Verdict

**PASS WITH WARNINGS** — all 17 requirements and 46 scenarios are compliant with runtime evidence reproduced in this verification, every load-bearing claim spot-checked true, and every documented residual accurate; four non-blocking warnings remain, all artifact-hygiene or vocabulary except one narrow runner-gate residual that does not affect the merge-blocking scenario. Nothing blocks archive.

### Verification environment

- DB `omnipost-infra:5432/omnipostdb`, Redis `omnipost-infra:6379` — both up throughout.
- Live API booted per the documented recipe (`set -a; source .env; source .env.test; set +a; pnpm dev:api` → port 3001) and shut down afterwards; port confirmed free.
- No repository file was modified. Post-run state: 0 non-terminal saga rows, 0 saga rows started in the last hour; the six residual `saga:*` cache keys carry TTLs and expire on their own.

---

**Archive-time note (2026-08-11):** all four warnings above were closed as part of the
`sdd-archive` phase — see `archive-report.md` in this folder for the disposition of each.
