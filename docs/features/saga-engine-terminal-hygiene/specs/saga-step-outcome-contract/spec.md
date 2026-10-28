# Saga Step Outcome Contract Specification

## Purpose

A saga step has three possible outcomes: it succeeded, it failed, or it has not finished
yet. The engine's contract models two. `SagaStepResult` is a boolean plus optional fields,
so the publish wait step signals "the channels are still publishing" with the same value it
would use for "this step failed" — and the engine, unable to tell them apart, spends a
retry on it.

That type-level modelling error composes with two dispatch-level ones into a deterministic,
customer-facing bug:

- every worker completion event for a publish job re-dispatches the wait step, with no
  coalescing and no in-flight guard;
- while ANY sibling channel is still pending, the re-dispatched wait step reports the
  not-finished-yet outcome as a failure and burns one retry;
- the wait step's whole budget is three retries.

**An N-channel publish therefore consumes up to N-1 retries on sibling completion events
alone, independent of latency. A four-channel publish can reach `FAILED` with all four
channels successfully published.** The customer is told their post failed; it did not.

This capability specifies WHAT the engine must guarantee about step outcomes: that
"not finished yet" is a first-class outcome, that it costs no retry budget, that
event-driven advancement does not scale with channel count, and that only one execution
advances a saga at a time. It is the CORRECTNESS axis of step execution and is independent
of any schema work — nothing in it waits on a migration.

Mechanisms — the type's exact shape, how events are coalesced, what the guard is keyed on —
belong to the design phase. This document states behavior only.

RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
**[MERGE-BLOCKING]** MUST be proven green before the slice merges. **[static]** scenarios
are proven by inspecting source or configuration; **[unit]** scenarios by an isolated test;
**[integration]** scenarios by a real Postgres + Redis + BullMQ run with real worker events.

> **The N-channel arithmetic is pending an empirical probe.** The exploration derived
> "up to N-1 retries" statically from the retry policy (3 retries, 5/10/20 s = a 35-second
> budget) and the per-event dispatch, but never executed it. The DESIGN phase runs that
> probe through the existing chaos harness. The requirements below are written as
> INVARIANTS ("SHALL NOT grow with the channel count"), not as a measured constant, so they
> hold whatever the probe reports; the probe fixes the fixture size and the timing the
> merge-blocking integration scenario uses.

## ADDED Requirements

### Requirement: A step outcome is exactly one of THREE states [MERGE-BLOCKING]

The step-execution contract SHALL express three mutually exclusive outcomes — **succeeded**,
**failed**, and **waiting** (not yet decided) — as a single discriminated outcome value. A
consumer SHALL NOT have to inspect a boolean and then guess which of two meanings a falsy
value carries.

- `waiting` SHALL be a first-class outcome, not an optional flag bolted onto a failure. A
  representation in which a step can be simultaneously "failed" and "waiting", or in which
  `waiting` is inferred from the text of an error message, does NOT satisfy this
  requirement.
- The engine SHALL branch on the outcome exhaustively: every outcome SHALL have an explicit
  handling path, and adding a fourth outcome later SHALL be a compile-time obligation on
  every consumer rather than a silent fall-through to the failure branch.
- Compensation outcomes SHALL use the same contract, so a compensation that has not
  finished is not reported as a compensation that failed.

The publish wait step SHALL return `waiting` while any of its channel jobs is still pending,
and SHALL reserve `failed` for an actual failure — a job that ended in error, a status it
cannot read, a job that no longer exists.

#### Scenario: the outcome type admits exactly three cases [static] [MERGE-BLOCKING]

- **GIVEN** the step-outcome contract and its consumers
- **WHEN** they are inspected
- **THEN** the contract expresses succeeded, failed and waiting as mutually exclusive cases, every consumer branches on the discriminator exhaustively, and no consumer infers "still pending" from an error string or a boolean

#### Scenario: the wait step reports waiting while siblings are pending [unit] [MERGE-BLOCKING]

- **GIVEN** a publish saga whose channel jobs report some completed and at least one still pending
- **WHEN** the wait step executes
- **THEN** it returns the waiting outcome, and it does not return a failure

#### Scenario: a genuinely failed job is still a failure [unit]

- **GIVEN** a publish saga one of whose channel jobs ended in error
- **WHEN** the wait step executes
- **THEN** it returns the failed outcome carrying the cause, and it does not return waiting

---

### Requirement: `waiting` consumes NO retry budget and advances nothing [MERGE-BLOCKING]

A `waiting` outcome SHALL NOT be treated as an attempt against the step's retry policy. It
SHALL NOT increment the retry count, SHALL NOT consume a retry, SHALL NOT record an error on
the saga, and SHALL NOT contribute to any decision that drives the saga toward `FAILED` or
toward compensation.

A `waiting` outcome SHALL NOT advance the saga either: the current step SHALL remain the
same step, and the saga SHALL remain non-terminal. `waiting` means "ask again later", and
the engine SHALL keep an arrangement by which it does ask again — the step SHALL NOT be left
with no mechanism scheduled to re-enter it.

A step that waits SHALL still be bounded by the saga's terminal-state guarantee: an
indefinitely-waiting step SHALL reach a terminal state through the timeout horizon rather
than waiting forever. `waiting` removes the retry budget as the bound; it SHALL NOT remove
every bound.

#### Scenario: repeated waiting leaves the retry budget intact [unit] [MERGE-BLOCKING]

- **GIVEN** a step that returns waiting several times in a row
- **WHEN** each outcome is handled
- **THEN** the retry count is unchanged, no error is recorded on the saga, the current step is unchanged, and the saga is still non-terminal

#### Scenario: a real failure after waiting still consumes budget [unit]

- **GIVEN** a step that returned waiting several times and then genuinely fails
- **WHEN** the failure is handled
- **THEN** exactly one retry is consumed for that failure, and the earlier waiting outcomes did not reduce the budget available to it

#### Scenario: a step that never stops waiting still terminalizes [unit]

- **GIVEN** a step that returns waiting past the saga's timeout horizon
- **WHEN** the timeout mechanism ticks
- **THEN** the saga reaches a terminal state under a reason naming the timeout, and it does not wait indefinitely

---

### Requirement: Event-driven advancement SHALL NOT amplify with the channel count [MERGE-BLOCKING]

The number of retry-budget-consuming step executions caused by the completion events of an
N-channel publish SHALL NOT grow with N. Worker completion and failure events SHALL be
handled so that the arrival of a sibling channel's event does not, by itself, cost the saga
progress toward `FAILED`.

**The customer-facing invariant, stated as the thing that must never happen again: a publish
in which every channel succeeds SHALL reach a terminal SUCCESS outcome, whatever the number
of channels and whatever order or spacing their completion events arrive in.** A publish
whose channels all succeeded SHALL NOT be reported to the customer as failed.

The retry-recovery scan and the worker events SHALL NOT compound each other: a saga being
advanced by one SHALL NOT simultaneously be advanced by the other in a way that consumes
budget twice for the same waiting condition.

Event handling SHALL also stop guessing at its own inputs: an event whose saga identity
cannot be established SHALL be ignored explicitly and observably, not coerced into an
identifier and dispatched.

#### Scenario: a multi-channel publish where every channel succeeds COMPLETES [integration] [MERGE-BLOCKING]

- **GIVEN** a publish saga fanned out to four channels, each of whose jobs completes successfully at a different moment, each emitting its own completion event
- **WHEN** the saga runs to a terminal state
- **THEN** it reaches a terminal success outcome, no retry was consumed by a sibling's completion event, and it does not reach `FAILED`

#### Scenario: sibling events do not multiply budget-consuming executions [unit] [MERGE-BLOCKING]

- **GIVEN** a saga on its wait step and several completion events for its sibling channels arriving in quick succession
- **WHEN** the events are handled
- **THEN** the number of executions that could consume retry budget does not grow with the number of events, and the retry count after the burst reflects real failures only

#### Scenario: an event with no resolvable saga is ignored observably [unit]

- **GIVEN** a worker event whose saga identity is absent or not a usable value
- **WHEN** it is handled
- **THEN** no execution is dispatched, and the discarded event is observable rather than silently coerced

---

### Requirement: At most ONE execution advances a saga at a time in this process [MERGE-BLOCKING]

While an execution is advancing a saga, a second execution of the SAME saga SHALL NOT begin
in the same process. The boot pass, the retry-recovery tick, a worker event and an operator
action are four independent sources of dispatch for one row, and today nothing prevents them
from overlapping.

The guard SHALL be in-process, which is exactly the scope the documented single-replica
deployment has, and its scope SHALL be REPORTED as such. It SHALL NOT be described,
logged, or documented as a cross-process guarantee, and it SHALL NOT be read as lifting the
multi-replica constraint that `saga-crash-recovery` owns.

The guard SHALL fail safe rather than deadlock: a saga whose execution ends — normally,
terminally, or by throwing — SHALL become eligible for advancement again, and a crashed
process SHALL NOT leave a durable lock behind (an in-process guard leaves nothing durable by
construction, and this requirement SHALL NOT be satisfied by introducing something durable).

#### Scenario: concurrent dispatches from different sources advance the saga once [unit] [MERGE-BLOCKING]

- **GIVEN** one saga and three dispatch sources firing at effectively the same moment
- **WHEN** they are handled
- **THEN** exactly one execution advances the saga, and the others do not begin a concurrent execution of the same row

#### Scenario: a saga is advanceable again after its execution ends [unit] [MERGE-BLOCKING]

- **GIVEN** a saga whose execution ends by completing, by failing terminally, and by throwing, in three separate runs
- **WHEN** a subsequent dispatch arrives in each case
- **THEN** the saga is advanceable again in all three, and no run leaves it permanently blocked

#### Scenario: the guard's scope is reported as in-process [static]

- **GIVEN** the engine's ownership reporting and the operator-facing documentation
- **WHEN** the in-flight guard is described
- **THEN** it is stated as in-process, and neither states nor implies that it makes concurrent replicas safe

---

### Requirement: The corrected outcome is COMPLETED, with NO new customer notification [MERGE-BLOCKING]

Publishes that reach `FAILED` today for the amplification reason above SHALL reach a
terminal success outcome after this change. This is a CORRECTION: the saga's new outcome is
the one that was always true of the underlying publish.

**No new customer-facing notification, message, email or push SHALL be introduced for this
outcome change.** The existing saga and post status surfaces SHALL report the corrected
outcome, and any messaging about it belongs to the separate client-experience change. A
system that starts telling customers "the post you were told failed actually succeeded"
would be a new product behavior, and this change does not introduce product behavior.

The corrected outcome SHALL be visible where the wrong one was visible: an operator or a
customer reading the existing status surfaces SHALL see the terminal success, with no new
surface required to discover it.

#### Scenario: the corrected outcome appears on the existing status surface [integration] [MERGE-BLOCKING]

- **GIVEN** a multi-channel publish that would have reached `FAILED` before this change
- **WHEN** it runs to a terminal state and the existing saga status surface is read
- **THEN** it reports the terminal success outcome, and no new surface was needed to observe it

#### Scenario: no notification path is added on this transition [static] [MERGE-BLOCKING]

- **GIVEN** the change diff
- **WHEN** it is inspected for new notification, email, push, or in-app message dispatches tied to the outcome change
- **THEN** none is present

#### Scenario: a genuinely failed publish still fails [integration]

- **GIVEN** a multi-channel publish in which a channel's job genuinely errors
- **WHEN** the saga runs to a terminal state
- **THEN** it still reaches a failure outcome carrying the real cause, and the correction has not masked real failures

---

### Requirement: The parked-replay evidence keeps its stated MEANING

`saga-crash-recovery` pins pivot-interrupted parking with an evidence test whose deliberate
resume asserts a terminal `FAILED` with a version conflict, and states a normative revisit
condition: **that assertion turning red is the signal that the post-pivot transition now
tolerates re-application, and therefore that the parking branch should be removed.**

This change can flip that same assertion for a DIFFERENT reason — the outcome correction
above — which would fabricate the revisit signal without the tolerance actually holding.

Therefore: if this change alters that evidence's outcome, the change SHALL record WHICH
cause altered it, and SHALL NOT treat the flip as satisfying the parking revisit condition
unless the post-pivot re-application tolerance is independently demonstrated. The parking
branch SHALL NOT be removed on the strength of an assertion this change flipped for an
unrelated reason. If the evidence no longer distinguishes the two causes, it SHALL be
restated so that it does.

The resolution SHALL be reached in the DESIGN phase with the two causes separated
explicitly, not discovered when CI turns red.

#### Scenario: the evidence's outcome is derived explicitly, not discovered [static]

- **GIVEN** the change's design record and the parked-replay evidence
- **WHEN** the evidence's expected terminal outcome under this change is compared with the outcome it asserted before
- **THEN** the expected outcome is stated in advance with its cause named, and the two causes (outcome correction versus post-pivot re-application tolerance) are distinguished

#### Scenario: the parking branch is not removed on a borrowed signal [static]

- **GIVEN** the change diff
- **WHEN** the pivot-interrupted parking behavior is inspected
- **THEN** parking is still in force, or its removal is justified by an independent demonstration of post-pivot re-application tolerance rather than by this change's outcome correction
