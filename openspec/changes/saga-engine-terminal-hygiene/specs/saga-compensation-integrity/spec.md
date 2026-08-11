# Saga Compensation Integrity Specification

## Purpose

Compensation is the only mechanism by which a pre-pivot saga failure undoes what it already
did. Today the engine **does not tell the truth about it**: the automatic walk goes
`RUNNING → COMPENSATED` and never persists `COMPENSATING` at all (only the manual admin
endpoint writes that status). Three consequences follow from that one omission, and all
three are customer-visible or data-visible:

- a crash mid-automatic-compensation leaves a `RUNNING` row, which the boot pass classifies
  as resumable and **re-executes FORWARD over state a partial compensation already undid** —
  a data-integrity hole, not a liveness one;
- the `compensatingOrphans` gauge can only ever see rows the admin endpoint produced, so the
  production path is invisible to the operator watching it;
- the operator cannot re-drive such a row, because the re-drive endpoint demands `FAILED`.

Per-step walk progress is memory-only, so a resumed walk has no engine-side record at all
and rests entirely on each step's `compensate()` idempotency.

This capability specifies WHAT the engine must guarantee about compensation state: that it
is durable before it is acted on, that a resumed walk goes backwards and never forwards,
that progress survives the process that made it, that a human can re-drive it, and that the
gauge measuring it measures the real path. It is the RECOVERY-TRUTH axis and is a
prerequisite for `saga-crash-recovery`'s row-ownership work — before this capability there
is no durable compensation state to own.

Mechanisms — where progress is recorded, what shape the record takes, how the walk is
re-entered — belong to the design phase. This document states behavior only.

RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
**[MERGE-BLOCKING]** MUST be proven green before the slice merges. **[static]** scenarios
are proven by inspecting source or configuration; **[unit]** scenarios by an isolated test;
**[integration]** scenarios by a real Postgres + Redis run that crosses a simulated process
boundary.

> **One assertion in this capability is pending an empirical probe.** The exploration that
> produced it had no Bash tool, so the crash-mid-compensation forward-resume path is
> file:line-verified but never executed. The DESIGN phase runs that probe through the
> existing boot-resume harness. The requirements below state the INVARIANT, which does not
> depend on the probe; the probe fixes the reproduction fixture the merge-blocking
> integration scenarios are written against.

## ADDED Requirements

### Requirement: Compensation state is DURABLE before the walk is acted on [MERGE-BLOCKING]

When a compensable step exhausts its retries and the engine decides to compensate, it SHALL
persist the `COMPENSATING` status **before** dispatching the compensation walk, and SHALL
await that persist. The decision to compensate and the durable record of that decision SHALL
NOT be separated by a dispatch, a step execution, or any external call.

The consequence is the one this requirement exists for: **a process that dies at any point
between the decision and the end of the walk SHALL leave a `COMPENSATING` row, never a
`RUNNING` one.** A `RUNNING` row means "this saga is moving forward"; a saga that has begun
undoing itself is not moving forward, and a status that says otherwise is what makes the
forward re-execution in the requirement below possible.

This SHALL hold for the AUTOMATIC path, not only for the operator-initiated one. A status
that only the admin endpoint writes is a status the production path never produces.

#### Scenario: the automatic walk persists its status before it compensates anything [unit] [MERGE-BLOCKING]

- **GIVEN** a saga whose compensable pre-pivot step has exhausted its retries
- **WHEN** the engine decides to compensate
- **THEN** the row reads `COMPENSATING` in the database before any step's `compensate()` is invoked, and the persist is awaited rather than dispatched

#### Scenario: every compensation dispatch is preceded by its durable status [static] [MERGE-BLOCKING]

- **GIVEN** the saga engine sources
- **WHEN** every site that begins a compensation walk is located
- **THEN** each is preceded by an awaited persist of `COMPENSATING`, and no site begins a walk from a row whose persisted status is still `RUNNING`

#### Scenario: a process killed mid-walk leaves COMPENSATING behind [integration] [MERGE-BLOCKING]

- **GIVEN** a saga is compensating and the process is killed part-way through the walk
- **WHEN** the row is read back with no engine in memory
- **THEN** its status is `COMPENSATING`, and it is neither `RUNNING` nor terminal

---

### Requirement: A crash-inherited compensation resumes the WALK, never the saga [MERGE-BLOCKING]

A `COMPENSATING` row inherited at boot SHALL be resumed **in the compensation direction
only**. The engine SHALL NOT re-enter forward execution for such a row under any
disposition, SHALL NOT re-execute the step whose failure triggered the compensation, and
SHALL NOT advance the saga's current step.

The resumed walk SHALL obey the same canon boundary the original walk obeys: compensation
applies ONLY to compensable steps strictly before `pivotStepIndex`, in reverse order. A
resumed walk SHALL NOT cross the pivot, whatever the inherited row's recorded step says.

The row's disposition SHALL be its OWN, distinct from `resumed` (forward) and from the
parked and `definition-unregistered` dispositions, so the boot summary and the operator
runbook can tell "this process is finishing an interrupted undo" apart from "this process
is finishing an interrupted publish". Reusing the forward disposition vocabulary for it is
NOT acceptable.

**Ownership caveat, stated rather than implied.** This resume ships BEFORE row claims (a
later slice), so it inherits exactly the ownership constraint the forward boot resume
already has: the walk is owned per process, and a rolling deploy in which a draining
process is still walking the same row produces a second walk. That is tolerable only
because canon already requires every `compensate()` to be idempotent AND because the
durable per-step record below makes the overlap bounded and observable. It SHALL NOT be
reported as a claimed row, and the ownership language in `saga-crash-recovery` remains the
authority on what is and is not supported.

#### Scenario: an inherited COMPENSATING row is dispatched backwards, not forwards [unit] [MERGE-BLOCKING]

- **GIVEN** a `COMPENSATING` row exists at boot whose recorded step is a compensable pre-pivot step
- **WHEN** initialization completes
- **THEN** the row is dispatched into the compensation walk, its current step is not advanced, and the failed step is not re-executed forward

#### Scenario: a crash mid-compensation does not become a forward retry [integration] [MERGE-BLOCKING]

- **GIVEN** a saga was killed part-way through its automatic compensation, with some of its pre-pivot effects already undone
- **WHEN** a process with no memory of it completes initialization through the production composition
- **THEN** no forward step executes, no command re-issues the failed step's work, and the aggregate the partial walk already undid is not re-advanced

#### Scenario: the resumed walk stops at the pivot [unit] [MERGE-BLOCKING]

- **GIVEN** an inherited `COMPENSATING` row whose recorded step is at or past its definition's `pivotStepIndex`
- **WHEN** the walk resumes
- **THEN** only compensable steps strictly before the pivot are compensated, and no compensation is attempted for the pivot or any step after it

#### Scenario: the compensation disposition is its own word [unit]

- **GIVEN** a boot that inherits a `COMPENSATING` row alongside a forward-resumable row and a parked row
- **WHEN** the pass summary is emitted
- **THEN** each row is reported under a distinct disposition, and the compensation disposition is not reported as `resumed`

---

### Requirement: Per-step compensation progress is DURABLE [MERGE-BLOCKING]

The walk SHALL record durably, as it goes, which compensable steps it has already
compensated — before it proceeds to the next step, not once after the loop finishes. A
process that dies mid-walk SHALL leave an engine-side record of how far the walk got.

A resumed walk SHALL use that record: it SHALL NOT re-dispatch the compensation of a step
whose compensation is already recorded as complete.

**The honest bound, stated rather than assumed:** a crash between a step's compensation and
the recording of that outcome MAY still cause that one step to be compensated twice. This
capability therefore reduces re-compensation to a single-step window; it does not eliminate
it, and it does NOT relieve any step of the canon obligation that `compensate()` be
idempotent and retryable. What it removes is the current state of affairs, in which the
engine has no record at all and idempotency is the ONLY thing standing between a resume and
a full second walk.

Compensation outcomes SHALL be recorded whether the step's compensation succeeded or
failed, so a resumed walk can tell "not yet attempted" from "attempted and failed".

#### Scenario: progress is recorded step by step, not once at the end [unit] [MERGE-BLOCKING]

- **GIVEN** a saga with several compensable steps to undo
- **WHEN** the walk runs
- **THEN** each step's compensation outcome is durable before the next step's `compensate()` is invoked

#### Scenario: a resumed walk skips what it already undid [integration] [MERGE-BLOCKING]

- **GIVEN** a walk over four compensable steps was interrupted after two were recorded as compensated
- **WHEN** a new process resumes the walk
- **THEN** it dispatches compensation for the remaining steps only, and the two recorded steps are not re-dispatched

#### Scenario: a failed compensation is recorded as attempted [unit]

- **GIVEN** a step whose `compensate()` returns a failure during the walk
- **WHEN** the walk is later resumed
- **THEN** the record distinguishes that step from one never attempted, and the resumed walk can act on the difference

---

### Requirement: An operator can re-drive a stalled compensation, and the re-drive RESUMES [MERGE-BLOCKING]

The operator-facing compensation endpoint SHALL accept a saga in `COMPENSATING` in addition
to `FAILED`. A row left mid-walk by a crash SHALL be re-drivable by a human without database
surgery; answering such a request with a client error because the row is "not FAILED" is the
current behavior and is NOT acceptable.

**A re-drive RESUMES from the durable per-step progress. It SHALL NOT restart the walk from
the first compensable step.** Steps already recorded as compensated SHALL NOT be
re-dispatched by an operator-initiated re-drive any more than by an automatic one — the two
entry points SHALL converge on the same walk with the same progress semantics, so the
operator's action is not a second, differently-behaved code path.

A terminal saga (`COMPLETED`, `FAILED-after-compensation`, `COMPENSATED`) SHALL remain
refused, and the re-drive SHALL NOT be a way around the canon re-execution guard.

#### Scenario: a COMPENSATING row is accepted for re-drive [unit] [MERGE-BLOCKING]

- **GIVEN** a saga row left in `COMPENSATING` by a crashed walk
- **WHEN** an operator invokes the compensation endpoint for it
- **THEN** the request is accepted rather than refused for having the wrong status

#### Scenario: the re-drive resumes rather than restarts [unit] [MERGE-BLOCKING]

- **GIVEN** a `COMPENSATING` row whose durable progress records two of four compensations complete
- **WHEN** an operator re-drives it
- **THEN** compensation is dispatched only for the steps with no recorded completion, and the two recorded steps are not re-dispatched

#### Scenario: an operator re-drive reaches a terminal state [integration]

- **GIVEN** an interrupted compensation that no automatic pass has finished
- **WHEN** an operator re-drives it and the walk completes
- **THEN** the saga reaches `COMPENSATED`, and the row is terminal in the database rather than only in memory

#### Scenario: a terminal saga is still refused [unit]

- **GIVEN** a saga in a terminal state
- **WHEN** an operator invokes the compensation endpoint for it
- **THEN** the request is refused and no compensation is dispatched

---

### Requirement: A durable COMPENSATING row still reaches a TERMINAL state [MERGE-BLOCKING]

Persisting `COMPENSATING` creates a durable NON-TERMINAL state that did not exist before
this change, and the saga canon forbids an unbounded non-terminal state
(`ARCHITECTURE_CANON §Saga §Terminal state`). Every `COMPENSATING` row SHALL therefore reach
`COMPENSATED` or `FAILED` — never remain `COMPENSATING` indefinitely.

- A walk whose steps all compensate SHALL settle `COMPENSATED`.
- A walk that cannot finish — a step whose `compensate()` keeps failing, a definition this
  process cannot resolve — SHALL settle under a terminal state naming the compensation
  failure, rather than being left mid-walk with no owner.
- The timeout mechanism that bounds every other non-terminal state SHALL cover this one
  too. A `COMPENSATING` row SHALL NOT be able to outlive the saga horizon unnoticed because
  its status is not in the sweep's predicate.

Introducing a durable status without extending the bound that makes statuses terminate would
trade one silent hole for another.

#### Scenario: an unfinishable walk terminalizes instead of hanging [unit] [MERGE-BLOCKING]

- **GIVEN** a compensation walk whose step compensation fails on every attempt
- **WHEN** its attempts are exhausted
- **THEN** the saga reaches a terminal state naming the compensation failure, and the row is not left `COMPENSATING`

#### Scenario: a COMPENSATING row is inside the terminal-bound sweep [unit] [MERGE-BLOCKING]

- **GIVEN** a `COMPENSATING` row older than the saga horizon that no walk is advancing
- **WHEN** the timeout mechanism ticks
- **THEN** the row is terminalized exactly once under a reason naming its cause, and further ticks write nothing further

#### Scenario: a completed walk settles COMPENSATED in the database [integration]

- **GIVEN** a compensation walk that undoes every compensable step
- **WHEN** it finishes
- **THEN** the persisted row reads `COMPENSATED`, and the terminal status is read back from the database rather than from memory

---

### Requirement: A compensation that cannot run is OBSERVABLE, never a silent return

A compensation walk that cannot start or cannot proceed — the instance cannot be loaded, its
definition is not registered in this process, its account cannot be resolved — SHALL log at
ERROR naming the saga and the cause, AND SHALL increment a failure counter. It SHALL NOT
return silently.

Silence here is worse than in most places: the caller is a detached dispatch with nobody
waiting on it, so a silent return produces a saga that simply never gets undone, with no log
line, no metric and no row change to notice it by.

#### Scenario: an unresolvable walk is counted and logged [unit]

- **GIVEN** a compensation dispatched for a saga whose definition this process has not registered
- **WHEN** the walk attempts to start
- **THEN** an ERROR names the saga and the missing definition, a failure is counted, and the walk does not return silently

#### Scenario: no compensation exit path is silent [static]

- **GIVEN** the compensation sources
- **WHEN** every early-return path in the walk is inspected
- **THEN** each logs and counts its cause, and none returns without doing either

---

### Requirement: The orphan gauge measures the PRODUCTION path, and its alert moves with it [MERGE-BLOCKING]

Once the automatic path persists `COMPENSATING`, the orphan gauge stops measuring
"rows an admin endpoint left behind" and starts measuring "rows that are mid-undo". The
gauge SHALL reflect the production path — a pre-pivot step exhausting its retries SHALL be
visible to the operator watching it.

**The meaning of the metric changes, so its alert SHALL change in the SAME change.** The
existing rule fires on any non-zero value sustained over a window, on the stated grounds
that the engine cannot resume these rows. That premise is exactly what this capability
removes: after it, a non-zero value during normal operation is a walk in progress, not a
stuck row. Shipping the code without the alert would convert a correct engine into a paging
operator; shipping the alert without the code would blind the gauge. The alert rule, its
summary text and its runbook wording SHALL be updated alongside, and the alert SHALL
distinguish "a walk is running" from "a walk is stuck".

The gauge SHALL remain a gauge — a level each process re-measures — and SHALL NOT be
converted into an event counter as part of this change.

#### Scenario: an automatic compensation is visible on the gauge [unit] [MERGE-BLOCKING]

- **GIVEN** a saga entering compensation through the automatic path, with no admin endpoint involved
- **WHEN** the boot pass measures the orphan level
- **THEN** the row is counted, and the count is published in process and on the metrics endpoint

#### Scenario: the alert rule ships in the same change as what it measures [static] [MERGE-BLOCKING]

- **GIVEN** the change diff
- **WHEN** the saga alert rules and their annotations are inspected
- **THEN** the orphan alert no longer asserts that the engine cannot resume these rows, its condition distinguishes a stuck row from a walk in progress, and the update is present in the same change as the code that changed the metric's meaning

#### Scenario: a transient walk does not page [unit]

- **GIVEN** a compensation walk that starts and finishes within the alert's evaluation window
- **WHEN** the alert condition is evaluated against the emitted series
- **THEN** the condition is not satisfied by the transient walk alone
