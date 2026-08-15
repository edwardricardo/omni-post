# Saga Step Outcome Contract — Living Spec

> Cumulative living specification for the **saga-step-outcome-contract** capability: what a
> saga step is allowed to SAY about itself, what each answer costs the saga, and how many
> executions may advance one row at a time.
>
> Established by change `saga-engine-terminal-hygiene` (S2), branch
> `workstream/saga-engine-terminal-hygiene`, delivered as PR3 of four chained PRs. The delta
> lives in `openspec/changes/saga-engine-terminal-hygiene/specs/saga-step-outcome-contract/spec.md`;
> this file is the cumulative source of truth and describes the behavior that SHIPPED.
>
> This capability is the CORRECTNESS axis of step execution. `saga-crash-recovery` owns which
> rows a boot inherits; `saga-compensation-integrity` owns what a walk does once compensation
> is decided; this capability owns what one step execution means. The operator-facing contract
> lives in `docs/api/saga.md`, and the residual closure notes in
> `docs/security/MULTI_TENANT_GUARDS.md`.
>
> **It needed no schema change and no data migration.** Rows written with the previous boolean
> shape are normalized read-side, forever, at both deserialization seams.

## Requirements

### Requirement: A step outcome is exactly one of THREE states

`SagaStepResult` SHALL be a discriminated union on `outcome` with exactly three cases —
`succeeded`, `failed` and `waiting` — mutually exclusive by construction:

```typescript
type SagaStepResult =
  | { outcome: "succeeded"; data?: unknown; compensationData?: unknown }
  | { outcome: "failed"; error: string; compensationData?: unknown }
  | { outcome: "waiting"; reason: string; data?: unknown };
```

- A cause SHALL belong only to the case that has one: `error` on `failed`, `reason` on
  `waiting`. No representation SHALL permit a step to be simultaneously failed and waiting,
  and no consumer SHALL infer "still pending" from the text of an error or from a boolean.
- The engine SHALL branch on the discriminator exhaustively, so a fourth outcome would be a
  compile-time obligation on every consumer rather than a silent fall-through into the
  failure branch.
- Compensations SHALL use the same contract, so a rollback that has not finished is never
  recorded as one that failed.
- The publish wait step SHALL return `waiting` while any of its channel jobs is OBSERVED
  pending, and SHALL reserve `failed` for a real failure — a job that ended in error,
  scheduling data that was never recorded, or a job state it could not read at all.
- **A failed OBSERVATION is `failed`, never `waiting`.** "I could not read the queue" is not
  evidence that work is still in progress, and a reader that answers an all-pending aggregate
  for an outage hands the step the one shape it cannot tell from healthy in-flight work — with
  no retry spent, no error recorded and no metric moved. The status reader therefore SHALL
  express observation failure distinctly (a `Result`), and the step SHALL map it to `failed`,
  so an unreadable dependency stays bounded by the retry policy as it was before this contract.

**The authoring rule SHALL live at the contract**, not in one step's body: `waiting` is what
BECOMES DECIDABLE BY ASKING AGAIN; anything that cannot is `failed`.

#### Scenario: the outcome type admits exactly three cases

- **GIVEN** the step-outcome contract and its consumers
- **WHEN** they are inspected
- **THEN** succeeded, failed and waiting are mutually exclusive cases, every consumer branches on the discriminator, and no consumer infers pending work from an error string or a boolean

#### Scenario: the wait step reports waiting while siblings are pending

- **GIVEN** a publish saga whose channel jobs report some completed and at least one still pending
- **WHEN** the wait step executes
- **THEN** it returns `waiting`, and it does not return a failure

#### Scenario: an unreadable job status is a failure, not a wait

- **GIVEN** a publish saga whose job-status reader cannot reach the queue
- **WHEN** the wait step executes
- **THEN** it returns `failed` carrying the cause, spends retry budget, and does not report the saga as waiting

#### Scenario: a genuinely failed job is still a failure

- **GIVEN** a publish saga one of whose channel jobs ended in error
- **WHEN** the wait step executes
- **THEN** it returns `failed` carrying the cause, and it does not return waiting

---

### Requirement: `waiting` consumes NO retry budget and advances nothing

A `waiting` outcome SHALL NOT be treated as an attempt. It SHALL NOT increment the retry
count, SHALL NOT record an error on the saga, SHALL NOT advance `currentStep`, SHALL NOT
write a step event (one audit line per channel check is noise, not history), and SHALL NOT
contribute to any decision driving the saga toward `FAILED` or toward compensation.

The engine SHALL keep an arrangement to ask again: a waiting step SHALL re-arm on a
DEDICATED poll cadence, `waitPollMs`, default **30 000 ms**, settable on both config
surfaces (`SagaManagerConfig` and `SagaIntegrationConfig`). The cadence SHALL NOT be the
definition's retry backoff: a waiting step is not failing, so an interval that grows with a
retry count that never moves would be meaningless, and at the retry policy's own 5 s a
waiting step would be re-entered up to 360 times per saga across the 30-minute horizon.

Worker completion events remain the PRIMARY advance; the poll is the safety net for an event
that never arrives. The consequence SHALL be stated rather than discovered: when a completion
event races the queue's own state update, the saga waits up to one poll interval before it
can observe the outcome.

A waiting step SHALL still be bounded by the saga's terminal-state guarantee: `waiting`
removes the retry budget as the bound, never every bound. **That bound SHALL NOT depend on
bookkeeping.** Because the budget no longer terminalizes an untracked row, EVERY advancer
SHALL check the horizon before advancing a saga and terminalize it if it has been outlived —
one implementation, shared with the timeout checker, preserving the parked window and the
compensation liveness horizon. A row this process never tracked (deferred past the boot
ceiling, or loaded by id) SHALL therefore still reach a terminal state.

A re-arm that cannot be PERSISTED SHALL NOT terminalize the saga: it is bookkeeping, the row
keeps the marker it already holds, and the failure is counted on its own stage. The waiting
population SHALL be published as a level an operator can alert on, because it no longer
converts into failures inside a retry budget.

#### Scenario: repeated waiting leaves the retry budget intact

- **GIVEN** a step that returns waiting several times in a row
- **WHEN** each outcome is handled
- **THEN** the retry count is unchanged, no error is recorded on the saga, the current step is unchanged, and the saga is still non-terminal

#### Scenario: a real failure after waiting still consumes budget

- **GIVEN** a step that returned waiting several times and then genuinely fails
- **WHEN** the failure is handled
- **THEN** exactly one retry is consumed for that failure, and the earlier waiting outcomes did not reduce the budget available to it

#### Scenario: an untracked waiting row still terminalizes

- **GIVEN** a saga past its horizon that this process does not track
- **WHEN** any dispatcher advances it
- **THEN** it is terminalized under a reason naming the timeout, and no step runs

#### Scenario: a re-arm that cannot be persisted does not end the saga

- **GIVEN** a waiting step whose poll re-arm fails to persist
- **WHEN** the failure is handled
- **THEN** the saga stays non-terminal, the row keeps its existing scheduled re-entry, and the failure is counted

#### Scenario: a step that never stops waiting still terminalizes

- **GIVEN** a step that returns waiting past the saga's timeout horizon
- **WHEN** the timeout checker ticks
- **THEN** the saga reaches a terminal state under a reason naming the timeout

---

### Requirement: Event-driven advancement SHALL NOT amplify with the channel count

The number of retry-budget-consuming executions caused by the completion events of an
N-channel publish SHALL NOT grow with N.

**The customer-facing invariant: a publish in which every channel succeeds SHALL reach a
terminal SUCCESS, whatever the number of channels and whatever the order or spacing of their
completion events.**

The measured defect this closes, at the branch point of this change: a four-channel publish
burned `1 + (N-1)` retries on its own siblings — `rc` 1 → 2 → 3, then `FAILED` on the third
sibling event with "Publishing jobs still in progress" — while all four channels had
published. Zero timers were involved; the arithmetic alone was deterministic for N ≥ 4.

An event whose saga identity is absent or not a usable string SHALL be discarded explicitly
and observably (counted as `saga_recovery_failures_total{stage="event-dispatch"}`), never
coerced into an identifier and dispatched.

#### Scenario: a multi-channel publish where every channel succeeds COMPLETES

- **GIVEN** a publish saga fanned out to four channels, each completing at a different moment and emitting its own completion event
- **WHEN** the saga runs to a terminal state
- **THEN** it reaches COMPLETED, no retry was consumed by a sibling's completion event, and it does not reach FAILED

#### Scenario: sibling events do not multiply budget-consuming executions

- **GIVEN** a saga on its wait step and several completion events for its sibling channels arriving in quick succession
- **WHEN** the events are handled
- **THEN** the executions that could consume budget do not grow with the number of events, and the retry count after the burst reflects real failures only

#### Scenario: an event with no resolvable saga is ignored observably

- **GIVEN** a worker event whose saga identity is absent or not a usable value
- **WHEN** it is handled
- **THEN** no execution is dispatched and the discarded event is counted

---

### Requirement: At most ONE execution advances a saga at a time in this process

Every dispatcher — the boot pass, the retry-recovery scan, worker events, the operator
endpoints and the start path — SHALL funnel through one entry point that admits a single
execution per saga at a time in this process.

- A forward dispatch arriving while a forward execution holds the saga SHALL be COALESCED
  into ONE trailing pass, so the event is answered rather than dropped and N simultaneous
  events never become N executions.
- **The trailing pass SHALL re-read the PERSISTED status before it re-enters.** A sibling
  event arriving during a final failing attempt would otherwise re-enter after the
  compensation transition persisted `COMPENSATING`, and forward execution would overwrite it
  with `RUNNING` and re-run the failed step over partially-undone state. The refusal inside
  the pass (`saga-compensation-integrity`) is the backstop; this re-read is structural.
- **Only a dispatch that carries NEWS may coalesce.** A worker event does; a retry-scan
  re-selection does not, because the scan does not claim the row and re-selects the same due
  saga on every tick — treating that as news turns one slow pass into a chain of them.
- A compensation walk SHALL NOT coalesce into a forward pass. When a FORWARD execution holds
  the saga, the walk SHALL be HANDED OFF — dispatched when that execution releases — because
  nothing else re-drives it in-process: the compensation transition clears the retry marker,
  boot recovery runs only at startup, and the liveness horizon terminalizes rather than rolls
  back. A second WALK is refused outright while the first runs.
- Refusals that lose nothing SHALL NOT be counted as compensation failures; the series an
  operator pages on is for rollbacks that are really stuck.
- The operator re-drive SHALL refuse with a conflict while ANY advancer holds the saga, and
  SHALL NOT answer a success envelope for a walk the claim would turn away.
- The guard SHALL release on EVERY exit — normal, terminal, refused and throwing — and SHALL
  leave nothing durable behind.
- **The guard is IN-PROCESS, and its scope SHALL be reported as such** in code, logs and
  operator documentation. It SHALL NOT be stated or implied to make concurrent replicas safe,
  and it SHALL NOT be read as lifting the multi-replica constraint `saga-crash-recovery` owns.

#### Scenario: concurrent dispatches from different sources advance the saga once

- **GIVEN** one saga and three dispatch sources firing at effectively the same moment
- **WHEN** they are handled
- **THEN** exactly one execution advances the saga, no two executions of it overlap, and the arrivals are answered by at most one trailing pass

#### Scenario: a saga is advanceable again after its execution ends

- **GIVEN** a saga whose execution ends normally, by throwing, and terminally, in separate runs
- **WHEN** a subsequent dispatch arrives in each case
- **THEN** the saga is advanceable again (or refused for being terminal), and no run leaves it permanently blocked

#### Scenario: a walk refused by a forward pass still runs

- **GIVEN** a pre-pivot step whose failure orders a rollback while a trailing pass is still running
- **WHEN** the walk is dispatched and finds the saga held
- **THEN** it is handed to that execution's release and runs, and the saga reaches COMPENSATED

#### Scenario: the re-drive refuses while any advancer holds the saga

- **GIVEN** a forward execution holding a saga whose durable status is COMPENSATING
- **WHEN** an operator re-drives its compensation
- **THEN** the endpoint answers a conflict rather than reporting a rollback that has not started

#### Scenario: the trailing pass refuses a row the walk now owns

- **GIVEN** a dispatch that arrived during the final failing attempt of a pre-pivot step
- **WHEN** that attempt exhausts the budget and persists COMPENSATING
- **THEN** the trailing pass re-reads the durable status, refuses, and no step runs forward

---

### Requirement: The corrected outcome is COMPLETED, with NO new customer notification

Publishes that reached `FAILED` for the amplification reason SHALL reach a terminal success
outcome. This is a CORRECTION: the new outcome is the one that was always true of the
underlying publish.

**No new customer-facing notification, message, email or push SHALL be introduced for this
outcome change.** The existing saga and post status surfaces SHALL report the corrected
outcome; messaging about the correction belongs to the separate client-experience change.

The saga status endpoint SHALL report step outcomes in the same vocabulary, so a step still
waiting on channels is visible as waiting rather than as one that failed — plus ONE case the
engine does not have: a step index the saga never wrote SHALL be reported as `not-reached`.
"Not started" and "blocked on external work" are different facts, and giving them one word at
the boundary would rebuild the ambiguity this contract deletes. That case is VIEW vocabulary
only; the step-result union stays three-state.

#### Scenario: the corrected outcome appears on the existing status surface

- **GIVEN** a multi-channel publish that would have reached FAILED before this change
- **WHEN** it runs to a terminal state and the existing saga status surface is read
- **THEN** it reports the outcome in the three-state contract, with no new surface required to observe it, and no publish ends because its own channels had not finished

#### Scenario: a step nobody reached is not reported as waiting

- **GIVEN** a saga whose step results contain an index no step ever wrote
- **WHEN** the status surface is read
- **THEN** that index is reported as not-reached, with no `reason`, and the rest keep their own outcomes

#### Scenario: no notification path is added on this transition

- **GIVEN** the change diff
- **WHEN** it is inspected for new notification, email, push or in-app message dispatches tied to the outcome change
- **THEN** none is present

---

### Requirement: Pre-change rows keep replaying, read-side, at BOTH seams

Step outcomes persisted in the previous boolean shape SHALL be normalized when read —
`{ success: true }` to `succeeded`, `{ success: false }` to `failed` — at BOTH deserialization
seams: the durable row and the Redis hot copy. An unreadable entry SHALL remain a HOLE (an
index no step wrote), never a failure the engine would act on.

**The discriminator SHALL be resolved FIRST.** An entry carrying both keys resolves by
`outcome`, never by the boolean beside it: this normalization is read-side forever over
"whichever shape the row was written with", so the precedence IS the guarantee — resolving
`success: true` ahead of `outcome: "waiting"` would turn a step that never finished into one
that succeeded, and a succeeded step is what the walk undoes. An entry with NEITHER key is a
hole, which is a deliberate change from the pre-change tally that counted it as a failure.

There SHALL be no data migration. A normalization present at only one seam is a defect: it
hands the engine a shape it cannot branch on through the other.

#### Scenario: a mixed shape resolves by its outcome

- **GIVEN** a persisted entry carrying both an `outcome` and a boolean `success` that disagree
- **WHEN** it is read back
- **THEN** the `outcome` decides, and the boolean is ignored

#### Scenario: an entry with neither key is a hole

- **GIVEN** persisted entries that are empty, malformed, or not objects at all
- **WHEN** they are read back
- **THEN** each is a hole — counted as neither completed nor failed, and never treated as an effect to undo

#### Scenario: a legacy row replays under the new contract

- **GIVEN** a saga row whose step results were written in the boolean shape
- **WHEN** it is read back through either seam
- **THEN** its outcomes are the three-state values, holes are preserved, and the engine branches on them normally
