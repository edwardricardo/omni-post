# Saga Crash Recovery — Living Spec

> Cumulative living specification for the **saga-crash-recovery** capability: what the saga
> engine guarantees about in-flight sagas across a deploy, a crash, or a restart — which
> rows resume, which are deliberately NOT resumed, which may never re-execute, and how each
> guarantee is proven.
>
> Established by change `saga-tenant-scope-and-recovery` (N-COR-7 + N-COR-2a), branch
> `workstream/saga-tenant-scope-and-recovery`, delivered as two chained PRs: PR1 (tenant
> scope + column truth + backfill, merged as #173) and PR2 (recovery). The delta lives in
> `openspec/changes/saga-tenant-scope-and-recovery/specs/saga-crash-recovery/spec.md`; this
> file is the cumulative source of truth and describes the behavior that SHIPPED.
>
> This capability is the RECOVERY axis of the saga engine. It is DISTINCT from — and
> depends on — `tenant-context-boundaries` (which supplies the declared context every
> detached recovery statement runs under) and `multi-tenant-isolation` (which supplies the
> tenant value those statements key on). The operator-facing posture, the residual gaps and
> the runbooks live in `docs/security/MULTI_TENANT_GUARDS.md`.
>
> **The delta's auto-resume requirement was GATED, and the gate returned a negative
> verdict.** The delta specified that automatic resume ships ONLY IF a crash-replay test
> proves a re-executed pivot produces no second external side effect, and that the fallback
> otherwise is PARKING. The verification ran; the pivot replay itself was absorbed, but the
> step AFTER the pivot was rejected by optimistic concurrency and drove a saga that had
> genuinely succeeded into terminal `FAILED`. Auto-resume therefore did NOT ship for
> pivot-interrupted rows. The requirements below state the parked behavior as the normative
> one, and name the condition under which it should be revisited.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge. **[static]** scenarios are proven
> by inspecting source or configuration; **[unit]** scenarios by an isolated test;
> **[integration]** scenarios by a real Postgres + Redis + BullMQ run that crosses a
> simulated process boundary.

## Requirements

### Requirement: The composition registers saga definitions BEFORE the manager initializes [MERGE-BLOCKING]

The boot recovery pass runs inside `sagaManager.initialize()` and resolves each inherited
row's pivot boundary from the registered definitions. The composition root
(`SagaIntegration.initialize()`) SHALL therefore register the saga definitions BEFORE
calling `sagaManager.initialize()`. Registration SHALL have no dependency on an
initialized manager.

The engine SHALL additionally fail loudly on the wiring defect this order prevents: when
EVERY loaded row is declined for want of a registered definition, the pass SHALL count a
boot-load failure and log at ERROR (degrading the saga health check), rather than
reporting a fleet of ordinary parked rows. A row whose definition this process has not
registered SHALL carry its OWN disposition (`definition-unregistered`), distinct from
pivot parking.

Test harnesses SHALL boot through the production composition. A harness that registers
definitions before initializing exercises a wiring production does not have and is
structurally unable to fail on this defect.

#### Scenario: the source order is pinned [static] [MERGE-BLOCKING]

- **GIVEN** the composition root
- **WHEN** the positions of `registerSagaDefinitions()` and `sagaManager.initialize()` are compared
- **THEN** registration precedes initialization

#### Scenario: a boot that inherits only unregistered rows reports a composition defect [unit]

- **GIVEN** non-terminal rows exist and this process has registered no matching definition
- **WHEN** initialization completes
- **THEN** every row is parked as `definition-unregistered`, a boot-load failure is counted, and the health check reports `degraded`

---

### Requirement: Recovery ownership is partitioned so every non-terminal saga has exactly one owner PER PROCESS [MERGE-BLOCKING]

On initialization the engine SHALL load the non-terminal (`PENDING` / `RUNNING`) saga rows
and SHALL run a SINGLE resume pass over exactly what it loaded — never a repeating sweep,
never a per-tick re-dispatch of the same row.

Ownership SHALL be partitioned on `nextRetryAt` nullability alone:

- the boot pass SHALL claim rows WITHOUT a persisted `nextRetryAt`;
- the retry-recovery scan SHALL claim rows WITH a persisted `nextRetryAt` that is due, in
  BOTH `RUNNING` and `PENDING` status.

The two predicates SHALL NOT intersect, so a row is claimed by exactly one owner even
though both mechanisms come alive from the same initialization. The `PENDING` half of the
scan predicate is load-bearing: a graceful shutdown HANDS OFF a retry-pending saga by
flipping it to `PENDING` while the persist keeps `nextRetryAt`, and a scan restricted to
`RUNNING` left that row to no owner at all.

**Scope, stated as a constraint rather than implied:** the partition is disjoint WITHIN
ONE PROCESS. No row is marked as claimed — there is no lease, no claim column and no
`SELECT … FOR UPDATE SKIP LOCKED` — so two processes reading the same table both claim the
same rows. Running MORE THAN ONE API replica with the saga engine enabled is therefore NOT
SUPPORTED until row claims land (tracked as SMELL-73; the follow-up change
`saga-engine-terminal-hygiene` owns it, using the `OutboxClaimService` primitive the repo
already has). A rolling deploy is the same hazard in miniature: the draining process is
still advancing rows the new one inherits.

#### Scenario: an interrupted pre-pivot saga resumes after restart and terminates [integration] [MERGE-BLOCKING]

- **GIVEN** a saga is non-terminal with no `nextRetryAt`, interrupted BEFORE its pivot step
- **WHEN** a process with no memory of it completes initialization through the production composition
- **THEN** the boot pass dispatches it exactly once, it reaches a terminal state without operator action, and it issues exactly one command per remaining command-issuing step

#### Scenario: a retry-pending saga handed off by a graceful shutdown is claimed by the scan [integration]

- **GIVEN** a saga scheduled a retry and a graceful shutdown left it `PENDING` with `nextRetryAt` still set
- **WHEN** a new process boots and the retry-recovery scan ticks
- **THEN** the scan claims the row (the boot pass does not), and it reaches a terminal state within its retry envelope

#### Scenario: retry-owned rows are not double-claimed [integration]

- **GIVEN** a non-terminal saga row carries a `nextRetryAt` when the process starts
- **WHEN** the boot pass runs and the scan subsequently ticks
- **THEN** the boot pass skips the row, the scan resumes it once its retry is due, and the row is executed by exactly one owner

#### Scenario: a pivot-step retry the scan claims is refused by the pivot's countermeasure [integration] [MERGE-BLOCKING]

- **GIVEN** an inherited row whose due `nextRetryAt` sits ON the pivot step, and whose post has already moved out of `DRAFT`
- **WHEN** the retry-recovery scan claims and re-enters it
- **THEN** the pivot's `RereadCheck` aborts BEFORE the enqueue, no second job and no second publish is produced, and the saga settles `FAILED` naming the reread refusal

---

### Requirement: The boot pass is BOUNDED and CONTAINED [MERGE-BLOCKING]

Recovery is a best-effort part of startup and SHALL NOT be able to stop the process from
serving.

- **Per-row containment**: each loaded row SHALL be classified inside its own error
  boundary. A row that cannot be read SHALL be counted
  (`saga_recovery_failures_total{stage="resume-row"}`), logged with its saga id, and
  skipped; the rows behind it SHALL still be recovered.
- **Pass containment**: the pass SHALL NOT be able to reject `initialize()`. A durable
  malformed row must not exit the bootstrap on every subsequent boot.
- **Bounded load**: the boot load SHALL read at most `bootLoadLimit` rows, oldest first,
  and SHALL report the deferred remainder in the log, in `SagaMetrics.bootLoadDeferred`
  and on `/sagas/metrics`. Deferred rows SHALL NOT be silently truncated; they remain
  owned by the retry checker once they schedule a retry, and by the next boot otherwise.
- **Bounded fan-out**: the pass SHALL advance at most `maxConcurrentSagas` sagas at a
  time. A configured concurrency knob that nothing reads SHALL NOT exist.

#### Scenario: one unreadable row costs one saga's recovery [unit] [MERGE-BLOCKING]

- **GIVEN** three inherited rows, the middle one carrying a persisted context without its `metadata` object
- **WHEN** initialization completes
- **THEN** initialization resolves, the two readable rows are advanced, exactly one per-row failure is counted, and the boot is NOT reported as blind

#### Scenario: the fan-out honours the configured ceiling [unit]

- **GIVEN** more inherited rows than the configured `maxConcurrentSagas`
- **WHEN** the pass advances them
- **THEN** the number in flight never exceeds the ceiling, and every row is still advanced

#### Scenario: the load ceiling defers rather than truncates [unit]

- **GIVEN** more non-terminal rows than `bootLoadLimit`
- **WHEN** the boot load runs
- **THEN** exactly `bootLoadLimit` rows are loaded and the remainder is counted as deferred

---

### Requirement: A saga interrupted at or past its pivot SHALL be PARKED, not replayed [MERGE-BLOCKING]

The boot pass SHALL NOT dispatch a non-terminal saga whose `currentStep` is at or past its
definition's `pivotStepIndex`, nor one whose definition this process has not registered (a
row whose pivot boundary is unknowable here). Such a row SHALL be:

- **left exactly as the interruption left it** — non-terminal, nothing dispatched, no
  command issued, nothing written to it at all. Parked rows SHALL be excluded from the
  boot re-warm, so `updatedAt` remains a witness that nothing touched the row;
- **counted**, in process (`SagaMetrics.bootParkedSagas`) and on the scrape endpoint
  (`saga_recovery_parked_total{reason}`). Parking SHALL NOT be recorded on
  `saga_recovery_failures_total`: it is a decision the engine takes correctly, and a
  series that mixes the two makes any unfiltered sum report a designed outcome as a
  malfunction;
- **logged** at WARNING, naming the saga, its step and its pivot index, in the operator's
  vocabulary (`PARKED`), and reported in the pass summary;
- **resolvable by a human** — the continue endpoint remains available, so a replay is a
  decision someone takes with the outcome in view.

Silently resuming such a row is NOT acceptable, and neither is parking without an
executable test pinning it.

**The word `parked` SHALL carry exactly one meaning.** The graceful-shutdown drain HANDS
OFF a running saga (benign, self-recovering, claimed by the retry checker on the next
process); it does not park it. The two are opposite operational states and SHALL NOT share
a term in code, logs, tests, specs or runbooks.

**A parked row SHALL still reach a terminal state.** The saga canon forbids an infinite
non-terminal state, so the promise made about a parked row is bounded and SHALL be stated
as such:

- it SHALL be excluded from the ORDINARY timeout sweep, which measures from `startedAt`
  and would therefore terminalize a crash-inherited row on the first tick after boot;
- its operator window SHALL open at the moment of PARKING and last one full saga horizon;
- when that window expires the timeout checker SHALL terminalize it under its OWN failure
  reason, `parked-expired`, never `timeout`, EXACTLY ONCE — the terminal transition stops
  tracking the saga and the checker SHALL refuse to re-visit a terminal row, so no second
  `SAGA_FAILED` audit event is appended;
- parking SHALL NOT be persisted (the row must stay byte-identical), so it is PER-PROCESS:
  a restart re-derives the parking and RE-OPENS the window. A process that restarts more
  often than the horizon keeps re-opening it; that is a restart-loop incident, and the
  runbook SHALL say so rather than leave the operator to infer it.

**Why**, measured end to end and NOT assumed: a replayed pivot enqueues no second publish
job and causes no second worker execution — the queue adapter passes the step's
deterministic dedupe key through as the job id, and an add on an existing id is a no-op in
every state, including `completed`. The step AFTER the pivot is the problem: it re-issues
its status transition with the version its create step recorded while the first run already
advanced the persisted one, and the use case rejects the stale token. The replayed saga
therefore ends `FAILED` with a version conflict, reporting a publish that succeeded as a
failure.

**Revisit condition (normative for the next change that touches this):** when the
post-pivot transition genuinely tolerates re-application — an idempotent status transition,
or an OCC token re-read at replay time — the parking branch SHALL be removed and the boot
pass SHALL resume pivot-interrupted rows. The evidence test asserts the current `FAILED`
outcome precisely so that it turns RED the day the tolerance holds; that red is the signal
to revisit, not a regression.

#### Scenario: a pivot-interrupted saga is left untouched at boot [integration] [MERGE-BLOCKING]

- **GIVEN** a saga row rewound to its pivot step with its later side effects already applied, and its hot-cache copy removed
- **WHEN** a process with no memory of it completes initialization
- **THEN** the row keeps its status, its step, its empty error and its absent `nextRetryAt`; no job is enqueued, no worker runs, and no command carrying its saga id is dispatched

#### Scenario: the parked saga is counted and named [integration]

- **GIVEN** the same boot
- **THEN** the parked counter increases, a WARNING names the saga id, its step and the `PARKED` decision, and the pass summary reports `loaded`, `resumed`, `checkerOwned`, `skipped` and the per-reason skip breakdown

#### Scenario: the ordinary timeout sweep does not terminalize a parked row [integration] [MERGE-BLOCKING]

- **GIVEN** a parked row whose `startedAt` is already older than the saga horizon
- **WHEN** the timeout checker ticks inside the row's operator window
- **THEN** the row is still non-terminal and no terminal audit event was written

#### Scenario: an expired operator window terminalizes the parked row once, as parked-expired [integration] [MERGE-BLOCKING]

- **GIVEN** a parked row whose operator window has run out
- **WHEN** the timeout checker ticks, and ticks again
- **THEN** the row is `FAILED` under the reason `parked-expired` with an error naming the expired window, and exactly ONE `saga.failed` event exists for it however many further ticks run

#### Scenario: the replay evidence stays executable [integration] [MERGE-BLOCKING]

- **GIVEN** the parked saga is resumed deliberately, the way an operator would resume it
- **WHEN** it runs to a terminal state
- **THEN** exactly one job holds its dedupe key, no worker published a second time, the post keeps a single consistent status — AND the saga ends `FAILED` with a version conflict, which is the recorded justification for parking

---

### Requirement: Terminal sagas SHALL NEVER be re-executed by recovery [MERGE-BLOCKING]

A saga in `COMPLETED`, `FAILED`, or `COMPENSATED` SHALL NOT be loaded for execution,
resumed, retried, or compensated by the boot pass, the retry-recovery scan, or the timeout
checker. Recovery SHALL NOT run any compensation at or past the pivot step: compensation
applies ONLY to compensable steps strictly before `pivotStepIndex`, exactly as in the
non-recovery path.

#### Scenario: terminal rows are untouched by a restart [integration]

- **GIVEN** saga rows exist in each terminal state before a process boots
- **WHEN** initialization completes
- **THEN** none of those rows changes status or `updatedAt`, no command is dispatched for them, and no compensation runs

#### Scenario: a post-pivot failure compensates nothing [integration]

- **GIVEN** a saga whose post-pivot step exhausts its retries
- **WHEN** it reaches its terminal state
- **THEN** it ends `FAILED` (never `COMPENSATED`), no compensating command is issued, and the aggregate created before the pivot survives

---

### Requirement: A post-pivot failure reaches a terminal state within the timeout horizon [MERGE-BLOCKING]

A saga whose post-pivot step fails and persists a `nextRetryAt` SHALL be re-selected by the
live retry-recovery scan and SHALL reach a terminal state within the configured horizon, in
the SAME process and across a restart. Its terminal transition SHALL be PERSISTED: the
database row SHALL NOT stay non-terminal while memory believes the saga failed.

#### Scenario: a post-pivot failure terminates instead of hanging [integration] [MERGE-BLOCKING]

- **GIVEN** a saga whose post-pivot step fails and exhausts its retries
- **WHEN** the retry-recovery scan and the timeout checker run
- **THEN** the saga reaches a terminal state within the configured horizon and the terminal status is read back from the database row, not from memory

---

### Requirement: Every recovery write binds both isolation layers [MERGE-BLOCKING]

Recovery runs detached from any request, so it SHALL bind its own scope. Tenant-unknown
READS (the boot load, the due-set scan, the by-id load) SHALL run under the single declared
saga system reason, scoped to the query. Per-saga work SHALL run under the saga's OWN
rehydrated tenant context. There SHALL be NO account-less persistence path: a saga whose
owning account cannot be resolved SHALL be refused with a typed error before any
transaction opens, rather than written through a transaction that binds neither layer.

A dispatch SHALL NEVER be lexically enclosed by a declared system boundary: dispatches are
detached, the context propagates through them, and a resumed step would then run its tenant
writes with the guard bypassed.

#### Scenario: an unscopable persist is refused, not degraded [unit]

- **GIVEN** a saga instance from which no owning account can be resolved
- **WHEN** the engine is asked to persist it
- **THEN** it rejects with an internal-class error naming the missing account, and no row is written and no scope is bound

#### Scenario: no dispatch sits inside a system boundary [static] [MERGE-BLOCKING]

- **GIVEN** the saga engine sources
- **WHEN** every declared system boundary is balanced and its body inspected
- **THEN** no asynchronous saga dispatch appears inside one

#### Scenario: the engine opens no transaction of its own [static]

- **GIVEN** the saga engine sources
- **WHEN** every `$transaction` call site is located
- **THEN** all of them are inside the tenant primitives that bind the account scope as the transaction's first statement, and none elsewhere

---

### Requirement: Dedupe keys derive only from identity the durable row already carries [MERGE-BLOCKING]

The command dedupe key SHALL derive ONLY from the saga id and the step id (plus the
compensation suffix), and the publish-job dedupe key ONLY from the post id and the channel
id. Neither SHALL read a clock or a random source, so a key minted in one process equals the
key minted for the same work in another — which is the property replay safety rests on.

#### Scenario: the dedupe keys are deterministic across processes [static]

- **GIVEN** the dedupe-key derivations in source
- **WHEN** their interpolated expressions are inspected
- **THEN** the command key derives only from `sagaId` and `stepId` (plus the compensation suffix), the publish-job key only from `postId` and `channelId`, and neither contains `randomUUID()`, `Math.random()` or a clock read

#### Scenario: the publish-job key reaches the queue as the job id [static]

- **GIVEN** the enqueue call site
- **WHEN** it is inspected
- **THEN** the derived dedupe key is passed as the job's dedupe key, which the queue adapter uses as the BullMQ job id

---

### Requirement: Saga suites are wired into the test runner EXPLICITLY [MERGE-BLOCKING]

`apps/api/scripts/run-tests.sh` selects node:test suites by EXPLICIT file list, so a suite
that is not listed never runs. Every saga suite outside the Vitest-collected unit tree SHALL
appear in that list, in the batch matching its dependencies and with a timeout that fits its
worst case. A saga suite SHALL NOT be left discoverable-but-unwired, and no suite SHALL be
committed with `.only` or `.skip`.

**The runner SHALL be able to go red on its own setup.** A CANCELLED test is a test that
did not run, and Node reports a broken `before` hook as cancelled subtests with
`# fail 0`. The runner SHALL therefore fail the run when any test is cancelled, and SHALL
capture the runner's exit code rather than discarding it. A gate that cannot fail on its
setup gates nothing, which matters most for the batches this spec calls merge-blocking.

#### Scenario: a batch whose setup collapses fails the run [static] [MERGE-BLOCKING]

- **GIVEN** a merge-blocking batch pointed at a database that is not reachable
- **WHEN** the runner executes it
- **THEN** the batch is reported FAILED, its output is dumped, and the run exits non-zero — never OK with `0 fail`

#### Scenario: every saga suite appears in the runner list [static]

- **GIVEN** the suites present on disk
- **WHEN** `run-tests.sh` is inspected
- **THEN** every saga suite outside the unit tree appears explicitly in a batch, and none exists on disk without an entry

#### Scenario: the wired saga suites pass in a full run [integration]

- **GIVEN** Postgres and Redis are running, plus a live API for the customer-flow batch
- **WHEN** the batches execute
- **THEN** every saga suite runs (not skipped, not cancelled) and every assertion passes

---

### Requirement: The change lands at zero defects [MERGE-BLOCKING]

The change SHALL land with 0 errors and 0 warnings across the repository gate: ESLint with
`--max-warnings 0`, TypeScript compilation, every CI fitness check at its documented
threshold, and the regression set with zero failed and zero cancelled tests. Pre-existing
failures encountered on the touched paths SHALL be fixed, not deferred, suppressed, or
threshold-relaxed. No new `canon-exception` marker SHALL be introduced without an allowed
scenario, and no raw Prisma query SHALL be added outside the documented fitness exceptions.

#### Scenario: the gate is green end to end [static]

- **GIVEN** the change is complete
- **WHEN** lint, typecheck, the fitness checks and the regression set run
- **THEN** each reports 0 errors and 0 warnings, and zero tests are cancelled or skipped

#### Scenario: no suppression is used to reach green [static]

- **GIVEN** the change diff
- **WHEN** it is inspected for `@ts-ignore`, disabled lint rules, relaxed thresholds, skipped tests and new `canon-exception` markers
- **THEN** none is present, or any marker present cites an allowed scenario with its required follow-up
