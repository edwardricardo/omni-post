# Delta for saga-crash-recovery

> Change `saga-engine-terminal-hygiene` (N-COR-2c + compensation integrity + SMELL-73).
> The living spec at `openspec/specs/saga-crash-recovery/spec.md` describes what SHIPPED in
> `saga-tenant-scope-and-recovery`. This delta states the five requirement-level changes this
> change makes to it, plus one addition that closes the composition hazard slice 0 removes.
>
> Three of the five are deferrals the living spec itself named and handed to this change: the
> `COMPENSATING` class it counted but could not resume, the row claims it declared missing,
> and the parked window it left per-process. The other two are defects the exploration found
> at `main` = 63c10f07: an operator ceiling nothing in production can set, and a final test
> gate that cannot see a runner crash.
>
> **The COMPENSATING deferral is REVERSED, and the reason it was deferred is answered rather
> than ignored.** The living spec declined to resume that class because "a compensation walk
> resumed without a row claim is a second walk over steps a dead process may already have
> applied". The answer is not that claims arrive first — they arrive LATER, in slice 3 — but
> that the class was unresumable for a more basic reason: the automatic path never wrote the
> status, so there was nothing durable to resume. The new capability
> `saga-compensation-integrity` makes compensation state durable and its per-step progress
> recorded, which is what makes a resumed walk bounded and observable rather than blind. The
> residual double-walk exposure across a rolling deploy is the SAME residual the forward boot
> resume already carries, and it stays reported, not silently closed.
>
> **Each MODIFIED block below is the FULL requirement — every unchanged clause and every
> unchanged scenario is copied verbatim**, because the archive step replaces the living
> requirement with this block. Changed and added scenarios are marked inline.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. **[MERGE-BLOCKING]**
> requirements MUST be proven green before the slice that carries them merges. **[static]**
> scenarios are proven by inspecting source or configuration; **[unit]** scenarios by an
> isolated test; **[integration]** scenarios by a real Postgres + Redis + BullMQ run that
> crosses a simulated process boundary.
>
> **[SCHEMA-GATED]** marks requirements and scenarios that ship only in this change's
> schema-bearing slices (row claims, durable parked window). Those slices need a
> sensitive-path authorization and a migration, so their obligations are merge-blocking FOR
> THE PR THAT CARRIES THEM and are NOT preconditions for the earlier code-only slices. A
> schema-gated requirement SHALL NOT be quietly dropped if the slices are re-cut; it moves
> with the schema.

## ADDED Requirements

### Requirement: The composition exposes exactly ONE saga engine, and the recovery record matches the code

The process SHALL have exactly one saga engine. A registration that constructs a second
engine SHALL NOT exist in the composition root, even unresolved: an inert factory nobody
calls is one accidental resolution away from a second boot recovery pass, a second retry
scan, a second timeout checker and a duplicate set of scheduler task ids over the same
database. It is also the wrong answer to the reader who greps for where the engine is wired.

The operator-facing record of this capability SHALL match the code. A tracked defect that is
closed in the code and open in the planning record makes the record unusable as a source of
what is left to do, and the correction SHALL land with the change that establishes the
discrepancy rather than being carried forward again.

This requirement is deliberately not merge-blocking on its own: it is a deletion and a
documentation correction, and it carries no runtime behavior to prove. It lands first because
the gate honesty requirement below lands with it.

#### Scenario: only one saga engine construction exists [static]

- **GIVEN** the composition root and the bootstrap
- **WHEN** every saga engine construction and registration site is enumerated
- **THEN** exactly one construction remains, no unresolved registration constructs a second engine, and no token for a second engine remains declared

#### Scenario: no scheduler task id can be registered twice by construction [static]

- **GIVEN** the recurring saga task registrations
- **WHEN** their task ids are enumerated against the engine construction sites
- **THEN** each id is registered by exactly one engine, so no duplicate registration is reachable

#### Scenario: the planning record states the closed item as closed [static]

- **GIVEN** the planning record for the saga terminal-hygiene items
- **WHEN** the item the code already closed is read
- **THEN** it is recorded as closed, and the record and the code no longer disagree

## RENAMED Requirements

### Requirement: Recovery ownership is partitioned so every non-terminal saga has exactly one owner PER PROCESS → Recovery rows are CLAIMED at selection time, and ownership is reported as AT-LEAST-ONCE

(Reason: ownership stops being an in-process property of two disjoint predicates and becomes
a property recorded on the row itself. The old name asserts the very scope this change
changes, so keeping it would leave the requirement's title contradicting its body.)

(Migration: the full replacement block is under MODIFIED Requirements below and carries every
scenario from the old requirement. Operator documentation and the engine's own ownership
report SHALL be updated together with it — see the at-least-once scenario. No test is renamed
by this alone; tests follow the scenarios, which are preserved.)

## MODIFIED Requirements

### Requirement: The boot pass is BOUNDED and CONTAINED [MERGE-BLOCKING]

(Previously: the pass counted `COMPENSATING` rows and SHALL NOT have loaded, tracked, resumed
or compensated them, deferring that class to this change; and the ceilings were stated without
requiring that they be settable where the engine actually runs.)

Recovery is a best-effort part of startup and SHALL NOT be able to stop the process from
serving.

- **Per-row containment**: each loaded row SHALL be classified inside its own error boundary.
  A row that cannot be read SHALL be counted
  (`saga_recovery_failures_total{stage="resume-row"}`), logged with its saga id, and skipped;
  the rows behind it SHALL still be recovered.
- **Pass containment**: the pass SHALL NOT be able to reject `initialize()`. A durable
  malformed row must not exit the bootstrap on every subsequent boot.
- **Bounded load**: the boot load SHALL read at most `bootLoadLimit` rows, oldest first, and
  SHALL report the deferred remainder in the log, in `SagaMetrics.bootLoadDeferred` and on
  `/sagas/metrics`. Deferred rows SHALL NOT be silently truncated; they remain owned by the
  retry checker once they schedule a retry, and by the next boot otherwise.
- **Bounded fan-out**: the pass SHALL advance at most `maxConcurrentSagas` sagas at a time. A
  configured concurrency knob that nothing reads SHALL NOT exist.
- **Alertable bounds**: the deferred remainder SHALL be published as a Prometheus GAUGE (a
  level each process re-measures at boot, not an event), so "N inherited sagas are uncovered
  by this process" is an alertable condition and not only a log line.
- **Settable bounds** _(NEW)_: the boot load ceiling and the retry-recovery scan's page size
  SHALL be configurable through the PRODUCTION composition surface. A ceiling that is
  declared, documented as operator-facing, and reachable only from a test constructor is
  worse than an undocumented constant: it reads as a knob in the runbook and is not one. This
  generalizes the fan-out clause above — **a configured recovery bound that the production
  composition cannot set SHALL NOT exist.** Defaults remain; what is required is that an
  operator can change them without a code change.

Recovery SHALL also ACT ON the rows no other mechanism claims _(CHANGED)_. In the same
declared read boundary the boot SHALL count the `COMPENSATING` sagas, publish the count in
process, on `/sagas/metrics` and as a gauge, and SHALL LOAD AND RESUME each one's
compensation walk. It SHALL NOT re-enter forward execution for such a row. The behavior of
that resumed walk — its direction, its pivot boundary, its use of durable per-step progress,
its own disposition vocabulary, and the ownership caveat it inherits from shipping before row
claims — is specified in the `saga-compensation-integrity` capability and SHALL NOT be
restated differently here. What changes for the gauge is that it now measures a class the
engine acts on, so its alert moves with it.

#### Scenario: COMPENSATING rows are loaded and resumed in the compensation direction [unit] [MERGE-BLOCKING]

_(REPLACES "COMPENSATING orphans are counted, never resumed".)_

- **GIVEN** rows exist in `COMPENSATING` alongside a forward-resumable non-terminal row
- **WHEN** initialization completes
- **THEN** the `COMPENSATING` rows are loaded, counted and dispatched into their compensation walk, none of them is dispatched into forward execution, and the forward-resumable row is unaffected

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

#### Scenario: the boot load ceiling is settable through the production composition [static] [MERGE-BLOCKING]

_(NEW.)_

- **GIVEN** the production composition surface for the saga engine
- **WHEN** the boot load ceiling is traced from that surface to the value the boot load reads
- **THEN** a value set on the production surface reaches the boot load, and the ceiling is not fixed to a compile-time constant on the production path

#### Scenario: the retry-scan page size is settable through the production composition [static] [MERGE-BLOCKING]

_(NEW.)_

- **GIVEN** the production composition surface for the saga engine
- **WHEN** the scan's page size is traced from that surface to the value the scan reads
- **THEN** a value set on the production surface reaches the scan, and the page size is not a hard-coded literal on the production path

---

### Requirement: Recovery rows are CLAIMED at selection time, and ownership is reported as AT-LEAST-ONCE [MERGE-BLOCKING] [SCHEMA-GATED]

(Previously: "Recovery ownership is partitioned so every non-terminal saga has exactly one
owner PER PROCESS" — the partition was disjoint only within one process, no row was marked as
claimed, and multi-replica operation was declared NOT SUPPORTED pending SMELL-73.)

On initialization the engine SHALL load the non-terminal (`PENDING` / `RUNNING`) saga rows
and SHALL run a SINGLE resume pass over exactly what it loaded — never a repeating sweep,
never a per-tick re-dispatch of the same row.

Ownership SHALL be partitioned on `nextRetryAt` nullability:

- the boot pass SHALL take rows WITHOUT a persisted `nextRetryAt`;
- the retry-recovery scan SHALL take rows WITH a persisted `nextRetryAt` that is due, in BOTH
  `RUNNING` and `PENDING` status.

The two predicates SHALL NOT intersect. The `PENDING` half of the scan predicate is
load-bearing: a graceful shutdown HANDS OFF a retry-pending saga by flipping it to `PENDING`
while the persist keeps `nextRetryAt`, and a scan restricted to `RUNNING` left that row to no
owner at all.

**Both readers SHALL claim the rows they select, at selection time** _(NEW)_. The boot load
and the retry-recovery scan SHALL each mark the rows they select as being advanced by this
process, in the same operation that selects them. Claiming at dispatch time is NOT sufficient:
the double-selection and the starvation below are properties of the SELECT, and a claim taken
afterwards has already lost the race it exists to settle.

**The starvation SHALL be closed** _(NEW)_. A row a process is currently advancing SHALL NOT
be re-selected by a later tick while its claim holds. Rows behind a slow head SHALL be reached
within a bounded number of ticks rather than waiting for the head to finish. The current
behavior — a fixed page whose slow head is re-selected and re-dispatched every tick while the
rows behind it are never reached — SHALL NOT survive this change.

**A claim SHALL expire** _(NEW)_. A process that dies holding claims SHALL NOT strand its
rows: after a bounded validity period the rows SHALL become selectable again by another pass,
so a crash degrades to a delayed recovery rather than to a permanently unowned row. The
relationship between that validity period and the saga timeout horizon SHALL be decided and
recorded, not left implicit.

**The `nextRetryAt` partition SHALL survive untouched** _(NEW)_. The claim is an ADDITIONAL
condition on both readers, not a replacement for the partition: `nextRetryAt` continues to
mean "a retry is due" and the claim means "a process is currently advancing this row". The two
SHALL remain orthogonal; expressing one in terms of the other would break the boot pass's own
predicate.

**Scope, DOWNGRADED rather than lifted** _(CHANGED)_. An expiring claim yields at-least-once
exactly as the outbox does: an expired claim while the first owner is still working produces a
second dispatch. The engine's own ownership report and the operator documentation SHALL
therefore read **at-least-once, pending command-id dedupe (SMELL-71)** — never "multi-replica
supported". Declaring multi-replica operation supported requires the command bus to dedupe by
command id or a per-step idempotency proof, and neither is in this change. A rolling deploy
remains the same hazard in miniature, now bounded by the claim rather than unbounded.

**The claim SHALL NOT widen the tenancy bypass** _(NEW)_. It runs on rows of a tenant-enrolled
model with no tenant in hand, so it SHALL execute under the single already-declared saga
recovery system reason, SHALL NOT add a new reason to the fixed set, SHALL NOT introduce an
ambient bypass, and SHALL NOT read or write rows outside that declared boundary. Where the
claim bypasses the query-level tenant guard, the bypass SHALL be declared through the
repository's documented exception mechanism — catalogued, mirrored in CI, and justified by an
architecture decision record — in the SAME change, since an undeclared bypass turns the
repository gate red and an undocumented one turns it into a lie.

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

#### Scenario: two concurrent readers do not both take the same row [integration] [MERGE-BLOCKING] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** a set of due non-terminal rows and two readers selecting from it at the same moment
- **WHEN** both selections complete
- **THEN** each row is claimed by exactly one of them, and no row is dispatched by both

#### Scenario: a slow head no longer starves the rows behind it [integration] [MERGE-BLOCKING] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** more due rows than one scan page, whose first page is being advanced slowly
- **WHEN** several scan ticks elapse
- **THEN** the rows beyond the first page are selected and advanced, and the slow rows already being advanced are not re-selected and re-dispatched on each tick

#### Scenario: a claim held by a dead process expires [integration] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** rows claimed by a process that then disappears without releasing them
- **WHEN** the claim's validity period elapses and a later pass selects
- **THEN** the rows are selectable again and reach a terminal state, rather than remaining unowned

#### Scenario: the retry partition is unchanged by the claim [unit] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** rows with and without a persisted `nextRetryAt`, some claimed and some not
- **WHEN** the boot pass and the scan select
- **THEN** the boot pass still takes only rows without `nextRetryAt`, the scan still takes only due rows with one in both `RUNNING` and `PENDING`, and the claim only narrows each set further

#### Scenario: ownership is reported as at-least-once, not as multi-replica support [static] [MERGE-BLOCKING] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** the engine's ownership reporting and the operator-facing documentation
- **WHEN** they are read after the claims land
- **THEN** they state at-least-once ownership pending the command-id dedupe, and neither states nor implies that running multiple replicas with the saga engine enabled is supported

#### Scenario: the claim's guard bypass is declared, mirrored and justified [static] [MERGE-BLOCKING] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** the change diff
- **WHEN** the claim's tenancy boundary and the repository's compliance gate are inspected
- **THEN** the claim runs under the already-declared saga recovery reason with no new reason added, and any query-level guard bypass it introduces is catalogued and justified by an architecture decision record in the same change — mirrored in the CI gate where the gate's pattern can match the statement's syntax, or, where the gate's pattern provably cannot match it (verified empirically against the exact call form), the blindness and its pre-existing baseline recorded in that same architecture decision record

---

### Requirement: A saga interrupted at or past its pivot SHALL be PARKED, not replayed [MERGE-BLOCKING] [SCHEMA-GATED]

(Previously: parking SHALL NOT have been persisted at all, so the operator window was
PER-PROCESS — a restart re-derived the parking and RE-OPENED the window, with a restart-loop
named as the resulting incident.)

The boot pass SHALL NOT dispatch a non-terminal saga whose `currentStep` is at or past its
definition's `pivotStepIndex`, nor one whose definition this process has not registered (a row
whose pivot boundary is unknowable here). Such a row SHALL be:

- **left exactly as the interruption left it** — non-terminal, nothing dispatched, no command
  issued, nothing written to it at all. Parked rows SHALL be excluded from the boot re-warm,
  so `updatedAt` remains a witness that nothing touched the row;
- **counted**, in process (`SagaMetrics.bootParkedSagas`) and on the scrape endpoint
  (`saga_recovery_parked_total{reason}`). Parking SHALL NOT be recorded on
  `saga_recovery_failures_total`: it is a decision the engine takes correctly, and a series
  that mixes the two makes any unfiltered sum report a designed outcome as a malfunction;
- **logged** at WARNING, naming the saga, its step and its pivot index, in the operator's
  vocabulary (`PARKED`), and reported in the pass summary;
- **resolvable by a human** — the continue endpoint remains available, so a replay is a
  decision someone takes with the outcome in view.

Silently resuming such a row is NOT acceptable, and neither is parking without an executable
test pinning it.

**The word `parked` SHALL carry exactly one meaning.** The graceful-shutdown drain HANDS OFF a
running saga (benign, self-recovering, claimed by the retry checker on the next process); it
does not park it. The two are opposite operational states and SHALL NOT share a term in code,
logs, tests, specs or runbooks.

**A parked row SHALL still reach a terminal state.** The saga canon forbids an infinite
non-terminal state, so the promise made about a parked row is bounded and SHALL be stated as
such:

- it SHALL be excluded from the ORDINARY timeout sweep, which measures from `startedAt` and
  would therefore terminalize a crash-inherited row on the first tick after boot;
- its operator window SHALL open at the moment of PARKING and last one full saga horizon;
- when that window expires the timeout checker SHALL terminalize it under its OWN failure
  reason, `parked-expired`, never `timeout`, EXACTLY ONCE — the terminal transition stops
  tracking the saga and the checker SHALL refuse to re-visit a terminal row, so no second
  `SAGA_FAILED` audit event is appended;
- **the operator window SHALL be DURABLE, and the saga row SHALL STILL be byte-identical**
  _(CHANGED)_. These are not in tension: the byte-identity promise was always about the SAGA
  ROW — that `updatedAt` remains a witness that nothing touched it — and never about nothing
  anywhere recording the decision. The parked window SHALL therefore be recorded durably
  OUTSIDE the saga row. Consequently a restart SHALL NOT re-open the window; the window opens
  once, at the moment of parking, and continues to run across restarts. The restart-loop
  hazard the previous wording described — a process restarting more often than the horizon
  indefinitely re-opening the window, so the row can never expire — is CLOSED, and the runbook
  SHALL be updated to say so rather than continuing to describe a per-process window. The
  durable record SHALL be cleared when the row stops being parked (an operator continues it,
  or its expiry terminalizes it) so a later parking of the same saga opens a fresh window; and
  a durable record whose saga no longer exists SHALL NOT block progress and SHALL NOT be
  treated as a parked saga.

**Why**, measured end to end and NOT assumed: a replayed pivot enqueues no second publish job
and causes no second worker execution — the queue adapter passes the step's deterministic
dedupe key through as the job id, and an add on an existing id is a no-op in every state,
including `completed`. The step AFTER the pivot is the problem: it re-issues its status
transition with the version its create step recorded while the first run already advanced the
persisted one, and the use case rejects the stale token. The replayed saga therefore ends
`FAILED` with a version conflict, reporting a publish that succeeded as a failure.

**Revisit condition (normative for the next change that touches this):** when the post-pivot
transition genuinely tolerates re-application — an idempotent status transition, or an OCC
token re-read at replay time — the parking branch SHALL be removed and the boot pass SHALL
resume pivot-interrupted rows. The evidence test asserts the current `FAILED` outcome
precisely so that it turns RED the day the tolerance holds; that red is the signal to revisit,
not a regression. **This change can flip that same assertion for an unrelated reason** (the
step-outcome correction), so the `saga-step-outcome-contract` capability requires the two
causes to be separated explicitly; a flip caused by the outcome correction SHALL NOT be read
as satisfying this revisit condition.

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
- **THEN** exactly one job holds its dedupe key, no worker published a second time, the post keeps a single consistent status — AND the saga's terminal outcome matches the outcome derived in advance for this change, with the cause named (see `saga-step-outcome-contract`), so the parking justification is not silently replaced

#### Scenario: the operator window survives a restart [integration] [MERGE-BLOCKING] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** a pivot-interrupted row parked in one process, with part of its window elapsed
- **WHEN** the process restarts and re-derives the parking
- **THEN** the window continues from its original parking moment and is not re-opened, and the remaining window is shorter than a full horizon

#### Scenario: the parked saga row stays byte-identical [integration] [MERGE-BLOCKING] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** a pivot-interrupted row that is parked, with the durable window recorded
- **WHEN** the row is read back
- **THEN** its status, step, error, `nextRetryAt` and `updatedAt` are exactly what the interruption left, and nothing was written to the saga row itself

#### Scenario: the durable window is cleared when the row leaves parking [unit] [SCHEMA-GATED]

_(NEW.)_

- **GIVEN** a parked row with a durable window
- **WHEN** an operator continues it, and separately when its expiry terminalizes it
- **THEN** the durable record is cleared in both cases, and a subsequent parking of the same saga opens a fresh window

---

### Requirement: Saga suites are wired into the test runner EXPLICITLY [MERGE-BLOCKING]

(Previously: the runner SHALL fail on cancelled tests and SHALL CAPTURE the runner's exit code
— but capturing is not acting on it, and the final gate reads only the test totals.)

`apps/api/scripts/run-tests.sh` selects node:test suites by EXPLICIT file list, so a suite that
is not listed never runs. Every saga suite outside the Vitest-collected unit tree SHALL appear
in that list, in the batch matching its dependencies and with a timeout that fits its worst
case. A saga suite SHALL NOT be left discoverable-but-unwired, and no suite SHALL be committed
with `.only` or `.skip`.

**The runner SHALL be able to go red on its own setup.** A CANCELLED test is a test that did
not run, and Node reports a broken `before` hook as cancelled subtests with `# fail 0`. The
runner SHALL therefore fail the run when any test is cancelled, and SHALL capture the runner's
exit code rather than discarding it. A gate that cannot fail on its setup gates nothing, which
matters most for the batches this spec calls merge-blocking.

**The captured runner exit code SHALL reach the FINAL gate** _(NEW)_. A batch's runner exit is
captured per batch and used to mark that batch failed, but the final gate reads only the
accumulated failed and cancelled test totals. A batch whose runner process exits non-zero while
reporting zero failures and zero cancellations therefore prints as failed, dumps its output, is
listed among the failed batches — and the run still exits zero. That is the exact class the
capture was introduced to catch, and a gate that reports a failure and then exits successfully
is worse than one that never noticed. The run SHALL exit non-zero when ANY batch's runner
exited non-zero, independently of the test totals, and independently of whether the failure
surfaced as a failed test, a cancelled test, a zero-test collection, or none of the three.
Equivalently: **the run SHALL NOT exit zero while any batch is recorded as failed.** Every
later claim in this change that "the tests pass" depends on this, which is why it lands first.

#### Scenario: a batch whose setup collapses fails the run [static] [MERGE-BLOCKING]

- **GIVEN** a merge-blocking batch pointed at a database that is not reachable
- **WHEN** the runner executes it
- **THEN** the batch is reported FAILED, its output is dumped, and the run exits non-zero — never OK with `0 fail`

#### Scenario: a batch whose runner crashes with zero reported failures fails the run [static] [MERGE-BLOCKING]

_(NEW — the reproduction the previous scenario does not cover: a non-zero runner exit with `# fail 0` AND `# cancelled 0`.)_

- **GIVEN** a batch whose runner process exits non-zero while reporting zero failed and zero cancelled tests
- **WHEN** the runner executes it
- **THEN** the batch is reported FAILED, its output is dumped, and the run exits non-zero — never OK

#### Scenario: the final gate acts on the captured runner exit [static] [MERGE-BLOCKING]

_(NEW.)_

- **GIVEN** the test runner script
- **WHEN** the final gate is inspected against the per-batch runner exit capture
- **THEN** the gate's condition includes the aggregated runner exit (or equivalently the recorded failed-batch set), so no path exists on which a batch is recorded failed and the script exits zero

#### Scenario: every saga suite appears in the runner list [static]

- **GIVEN** the suites present on disk
- **WHEN** `run-tests.sh` is inspected
- **THEN** every saga suite outside the unit tree appears explicitly in a batch, and none exists on disk without an entry

#### Scenario: the wired saga suites pass in a full run [integration]

- **GIVEN** Postgres and Redis are running, plus a live API for the customer-flow batch
- **WHEN** the batches execute
- **THEN** every saga suite runs (not skipped, not cancelled) and every assertion passes
