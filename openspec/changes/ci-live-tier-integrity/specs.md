# CI Live-Tier Integrity — Delta Specs

> Change: `ci-live-tier-integrity` · branch `workstream/ci-live-tier-integrity` (from `main` = `8e89b21f`)
> Inputs: `openspec/changes/ci-live-tier-integrity/explore.md` (adversarially verified; 15 claims refuted)

## Purpose

The end-to-end publish suite asserts that a customer's publish reaches a terminal state. It runs in an
automated environment where **nothing consumes the publish queue**, so the jobs it enqueues are never
picked up, the saga's wait step correctly parks, and the only remaining terminalizer is the 30-minute
saga horizon — against a 120-second per-test budget. Before the three-state outcome contract landed,
"nobody is consuming" was misread as a step failure and burned the retry budget into a false terminal
`FAILED` in ~35 s, which is the only reason the suite was ever green: **the tests were passing on a bug**.
Fixing the bug exposed the environment.

Two further defects are the reason this cost two red merges instead of one red pull request: the tier that
executes the publish path **never runs before merge**, so a saga-touching change is approved on evidence
that structurally cannot see the saga's live path; and the suite states its environmental precondition in a
comment, so a missing consumer is reported six minutes later as "did not reach terminal state" rather than
immediately as "nothing is consuming the publish queue".

These specs state WHAT must be true of the environment, of the merge gate, and of operational detection.
They state no mechanism: no process names, no file paths, no configuration syntax, no libraries. Those
belong to design.

**Production is not the subject of this change.** The engine parks, re-arms, terminalizes at its horizon,
and resumes on the first real event — all measured. Nothing here changes it.

## Conventions

RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked **[MERGE-BLOCKING]**
must be proven green before the slice merges.

Scenario tags name the proof: **[static]** — proven by inspecting source or configuration;
**[unit]** — proven by an isolated test; **[integration]** — proven against real datastores, a real queue
and a real consumer; **[ci-outcome]** — proven by an observable result of an automated run (which job ran,
what it reported, how long it took); **[intent]** — explicitly NOT backed by an automated check, stated as
an obligation with its manual verification named. Per project rule, nothing is written as a guarantee
unless a test or check backs it; everything else is labelled `[intent]` and reads as intent.

**Measured baselines these specs reference** (from the exploration; all durations observed, not estimated):

| Fact                                               | Value                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Live publish suite, environment without a consumer | 11 pass / 3 fail, three tests at ~120 s, batch wall **362.3 s**        |
| Same commit, same API, consumer present            | **14 pass / 0 fail, 170.3 s**; the two long tests at 59.70 s / 59.65 s |
| Worker-free saga's real terminalization            | **1815 s** (30-minute horizon + one checker tick)                      |
| Saga parked 1355 s, then a consumer attached       | terminalized **within seconds** of the first real event                |
| Pre-merge tier today                               | ~2 m 57 s, and it executes **zero** live publish batches               |
| Push tier today                                    | ~6 m 02 s                                                              |
| Live publish batch alone                           | 98.5 s green pre-change · 362.3 s failing · 170.3 s with a consumer    |

---

# Capability: `publish-pipeline-test-environment`

## ADDED Requirements

### R1 — An environment that exercises the publish pipeline HAS a live consumer for every queue that pipeline enqueues to [MERGE-BLOCKING]

This is a property of the ENVIRONMENT, stated as a property. It is not "start a second process": any
arrangement that makes the property true satisfies it, and an arrangement that starts a process without
making the property true does not.

- **R1-a.** Wherever a suite that exercises the end-to-end publish pipeline runs, every queue that pipeline
  enqueues to SHALL have at least one consumer that is **attached and consuming** at the moment the suite
  starts, and for as long as it runs.
- **R1-b.** "Attached and consuming" SHALL be an OBSERVABLE property, distinguishable from three things it
  is routinely confused with: a process having been started; the datastores that process depends on being
  reachable; and jobs having been enqueued. A readiness signal that reports ready while nothing is attached
  to the publish queue does NOT satisfy this requirement, and SHALL be corrected rather than relied on.
- **R1-c.** The environment SHALL be established BEFORE the suite starts, and establishment SHALL be gated
  on that readiness signal, with a bounded wait. When the wait expires, the run SHALL fail naming the
  consumer that never became ready. Advancing on a fixed delay does NOT satisfy this requirement.
- **R1-d.** The set of queues the property must hold for SHALL be DERIVED from what the pipeline actually
  enqueues to, not maintained as an independent list. Adding a queue to the publish pipeline without a
  consumer in the environment SHALL fail a check rather than pass silently.
- **R1-e.** The property SHALL hold identically in the automated environment and on a developer's machine,
  so the suite's verdict means the same thing in both. A suite that is meaningful in one place and vacuous
  in the other is the defect this requirement exists to close.

#### R1.1 — readiness means attached, not started [integration] [MERGE-BLOCKING]

- **GIVEN** an environment prepared for the live publish suite
- **WHEN** its readiness is queried before the suite starts
- **THEN** it reports ready only once a consumer is attached to the publish queue, and it reports NOT ready
  in an environment where that consumer's datastores are healthy but nothing is attached to that queue

#### R1.2 — with the property held, every publish case terminalizes inside its budget [integration] [MERGE-BLOCKING]

- **GIVEN** an environment satisfying R1
- **WHEN** the full live publish suite runs
- **THEN** every case that starts a saga reaches a terminal state and asserts on it, no case reaches its
  per-test budget without a terminal state, and the suite reports zero failures

#### R1.3 — establishment is gated on readiness, not on elapsed time [static] [MERGE-BLOCKING]

- **GIVEN** the environment's preparation sequence
- **WHEN** it is inspected
- **THEN** each required consumer is awaited on its readiness signal under a bounded wait whose expiry
  fails the run and names the consumer, and no step advances on a fixed sleep

#### R1.4 — the required-consumer set tracks the pipeline [static]

- **GIVEN** the publish pipeline's enqueue surface and the environment's required-consumer set
- **WHEN** they are compared
- **THEN** the sets agree, and a queue present in the pipeline and absent from the required set fails the
  check

---

### R2 — A suite that depends on a background consumer FAILS FAST and NAMES the missing capability [MERGE-BLOCKING]

- **R2-a.** Before any fixture is created and before any saga is started, a suite that depends on R1 SHALL
  verify it for every queue the suite depends on, and SHALL fail the run when it does not hold.
- **R2-b.** The failure SHALL NAME the missing capability — which queue has no consumer — in the message a
  reader sees first. It SHALL NOT surface as a per-test timeout, as "did not reach terminal state", or as an
  unclassified assertion. The current message is a symptom four inference steps away from the cause; the new
  one SHALL be the cause.
- **R2-c. Time bound.** The verdict SHALL be reached within **5 seconds** of suite setup beginning, and the
  whole batch SHALL terminate within **60 seconds** in an environment lacking the consumer — against the
  measured **362.3 s** the same batch burns today before reporting a misleading cause.
- **R2-d.** The verdict SHALL be a FAILURE. It SHALL NOT be a skip, SHALL NOT be a pass, and SHALL NOT be
  a warning. A batch whose setup collapsed SHALL be reported red — including when the runner reports its
  cases as cancelled rather than failed, and including when it collects zero cases.
- **R2-e.** The check SHALL be honest about what it proves: it SHALL NOT pass because a DIFFERENT queue has
  a consumer, SHALL NOT pass because a process exists that is not consuming, and SHALL NOT pass because the
  queue is merely reachable.
- **R2-f.** When the property holds, the check SHALL cost no more than **2 seconds** of the suite's runtime,
  so it is never the reason someone removes it.

#### R2.1 — a consumer-less environment fails in seconds, naming the cause [integration] [MERGE-BLOCKING]

- **GIVEN** an environment with healthy datastores, a healthy API, and no consumer attached to the publish queue
- **WHEN** the live publish suite is run
- **THEN** it fails within 5 seconds of setup, the failure names the publish queue and the absent consumer,
  the batch terminates within 60 seconds, no case reports a terminal-state timeout, and no fixture was created

#### R2.2 — the check is cheap when the property holds [integration]

- **GIVEN** an environment satisfying R1
- **WHEN** the live publish suite is run
- **THEN** the precondition passes, adds no more than 2 seconds, and the suite proceeds to its cases

#### R2.3 — the failure path is a failure, not a skip [static] [MERGE-BLOCKING]

- **GIVEN** the suite
- **WHEN** its precondition and its cases are inspected
- **THEN** the precondition runs before any fixture creation and before any saga start, its failure path
  fails rather than skips, and no case is conditionally skipped on the absence of a service

#### R2.4 — a collapsed setup cannot report green [ci-outcome] [MERGE-BLOCKING]

- **GIVEN** a run in which the suite's setup fails the precondition
- **WHEN** the batch result is reported
- **THEN** the batch is reported as failed and the overall run is non-zero, whether the runner classified the
  cases as failed, as cancelled, or collected none

---

### R3 — A publish-path failure is DIAGNOSABLE from the run alone

The last incident could not be diagnosed from its own automated run: the failure message carried no saga
state, and no consumer output existed to read. The diagnosis required a local reproduction.

- **R3-a.** When a case fails because a saga did not reach a terminal state, the failure SHALL carry the
  saga's last observed status, its current step, and the aggregate state of the jobs that saga is waiting on.
- **R3-b.** A run of the live publish tier SHALL retain the consumer's output alongside the API's, so the
  two halves of the pipeline can be read together after the fact.

#### R3.1 — a non-terminal failure reports what the saga was doing [unit]

- **GIVEN** a saga deliberately held non-terminal past the wait bound
- **WHEN** the wait helper gives up
- **THEN** the failure carries the saga's status, its current step, and the aggregated state of its jobs, and
  not only the elapsed time

#### R3.2 — the consumer's output is retained with the run [ci-outcome]

- **GIVEN** a completed run of the live publish tier, passing or failing
- **WHEN** its output is inspected
- **THEN** the consumer's output is present and attributable to the same run

---

# Capability: `ci-tier-trigger-coverage`

## ADDED Requirements

### R4 — The tier that exercises an area RUNS on the trigger that can still block the merge [MERGE-BLOCKING]

This is item `N-CI-2`. Today a change to the saga engine is approved by a tier that boots no API, starts no
consumer, and executes no live publish batch; the first signal arrives after the merge. That has now cost
two red merges on the trunk.

- **R4-a.** For every area whose behaviour is exercised only by the live publish tier, a proposed change
  touching that area SHALL be evaluated by that tier BEFORE it can merge. Evidence produced by a tier that
  structurally cannot execute the area SHALL NOT satisfy the merge gate for that area.
- **R4-b. The enumerated areas** (stated as capabilities, resolved to concrete locations in design): the
  saga engine's execution, recovery, retry-scan and timeout paths; the publish saga's definition including
  its wait step and its pivot; the queue abstraction and its job-state aggregation; the background publish
  consumer; the live publish end-to-end suite itself; and the definition of the environments and tiers that
  run it.
- **R4-c.** The area-to-tier mapping SHALL be data the gate reads, not knowledge distributed among
  reviewers. A check SHALL fail when an enumerated area has no tier that executes it.
- **R4-d.** The gate SHALL report a value for EVERY proposed change. A gate that is absent because its
  filter did not match SHALL NOT be indistinguishable from a gate that passed: a not-applicable verdict SHALL
  be reported explicitly, derived from the areas the change touches.
- **R4-e.** The gate SHALL NOT be satisfiable by a run of the live suite in an environment that violates R1.
  "Run the live suite on proposed changes, without a consumer" is the current failure with extra steps and
  is explicitly forbidden.
- **R4-f. Cost containment.** A change touching none of the enumerated areas SHALL NOT pay for the tier.
  The added wall-clock on a matching change SHALL be measured and recorded against the baselines above
  (pre-merge tier ~2 m 57 s today; the live publish batch ~170 s with a consumer).
- **R4-g. Reduced variant.** If the full tier proves too expensive, a reduced variant MAY be used, provided
  it (i) satisfies R1 and (ii) includes EVERY case that starts a saga and waits for a terminal state. A
  variant that drops one of those cases does not satisfy R4.

#### R4.1 — a change touching an enumerated area is evaluated by the tier that exercises it [ci-outcome] [MERGE-BLOCKING]

- **GIVEN** a proposed change touching an enumerated area
- **WHEN** the automated pipeline runs
- **THEN** the live publish tier executes with R1 satisfied, its result is reported, and the change cannot be
  merged while that result is failing or absent

#### R4.2 — an unrelated change does not pay for the tier, and is not blocked by it [ci-outcome] [MERGE-BLOCKING]

- **GIVEN** a proposed change touching none of the enumerated areas
- **WHEN** the automated pipeline runs
- **THEN** the live publish tier does not execute, the gate reports an explicit not-applicable verdict, the
  change is not blocked, and its total wall-clock is unchanged from the current baseline

#### R4.3 — every enumerated area maps to a tier that executes it [static] [MERGE-BLOCKING]

- **GIVEN** the enumerated areas and the tiers
- **WHEN** the mapping is checked
- **THEN** each area maps to at least one tier that actually executes it, and an area with no such tier fails
  the check

#### R4.4 — absence is not success [ci-outcome] [MERGE-BLOCKING]

- **GIVEN** a proposed change touching an enumerated area for which the live publish tier did not run
- **WHEN** the merge gate is evaluated
- **THEN** it does not report success, and the change is not mergeable on the strength of the missing run

#### R4.5 — the reduced variant keeps the cases that matter [static]

- **GIVEN** a reduced variant, if one is used
- **WHEN** its case list is compared with the suite's cases that start a saga and wait for a terminal state
- **THEN** every such case is present, and the variant runs in an environment satisfying R1

#### R4.6 — the required-check configuration is recorded and manually verifiable [intent]

- **GIVEN** that the merge-blocking configuration lives outside the repository and cannot be proven by any
  check inside it
- **WHEN** this change is delivered
- **THEN** it records which gate names must be marked required and the exact procedure to verify them, and
  this obligation is stated as intent rather than as a guarantee

---

# Capability: `publish-consumer-outage-detection`

## ADDED Requirements

### R5 — Absence of publish CONSUMPTION is detectable well before the terminal horizon [MERGE-BLOCKING]

The three-state outcome contract is correct and stays. It also moved a real operational boundary: a publish
consumer outage used to convert into terminal failures within ~35 seconds (a lie about posts that could still
publish); it now converts into sagas that wait, and surfaces only when the 30-minute horizon terminalizes the
cohort. That is more correct and much quieter. **Nothing watches the quiet window today.**

The existing backlog rule requires more than 50 waiting sagas held continuously for roughly 25 minutes. A
publish consumer outage at this system's volume never reaches that floor, so the outage is invisible for a
full horizon and then arrives as a cohort of timeouts.

- **R5-a.** The system SHALL expose a signal that distinguishes three states that today collapse into one:
  publish work is enqueued and **nothing is consuming it**; work is being consumed **slowly**; and the
  queue's state **cannot be read**.
- **R5-b.** An alert SHALL fire on the first of those states. Its firing condition SHALL be satisfiable
  within at most **one third of the saga terminal horizon** (≤ 10 minutes) from the onset of the outage, and
  its own window arithmetic — lookback plus hold — SHALL be strictly less than the horizon, so an operator
  hears about the outage before the affected sagas terminalize under it.
- **R5-c. Volume independence.** The firing condition SHALL NOT depend on a backlog count. A single affected
  publish SHALL be sufficient. The existing backlog rule SHALL remain, unchanged, for its own purpose, and
  SHALL NOT be counted as satisfying this requirement.
- **R5-d. No noise floor.** The condition SHALL be tied to unconsumed ENQUEUED work. An environment with no
  consumer and no enqueued publish work MAY be reported at a lower severity or not at all.
- **R5-e. The operator meaning SHALL travel with the alert**, in the alert's own text: that affected sagas
  stay non-terminal for up to the horizon and then terminalize under the timeout reason; that a terminal
  failure under that reason does **NOT** mean nothing was published; and that the provider must be checked
  before anything is retried. The alert SHALL name a runbook that EXISTS and that covers this cause.

#### R5.1 — the signal reports the outage, and only the outage [unit] [MERGE-BLOCKING]

- **GIVEN** enqueued publish work and no consumer attached
- **WHEN** the signal is read
- **THEN** it reports the no-consumer state; and **GIVEN** the same enqueued work with a consumer attached
  and draining, it does not

#### R5.2 — an unreadable queue is not reported as a missing consumer [unit] [MERGE-BLOCKING]

- **GIVEN** a queue whose state cannot be read
- **WHEN** the signal is read
- **THEN** it reports the unknown state, distinct from the no-consumer state, and the alert for a missing
  consumer does not fire on it

#### R5.3 — the alert's window is strictly inside the horizon [static] [MERGE-BLOCKING]

- **GIVEN** the alert definition for the no-consumer signal
- **WHEN** its lookback and hold are added together and compared with the saga terminal horizon
- **THEN** the sum is strictly less than the horizon and no greater than one third of it, and the definition
  carries a runbook reference

#### R5.4 — the condition carries no backlog threshold, and the backlog rule is untouched [static] [MERGE-BLOCKING]

- **GIVEN** the new alert definition and the pre-existing waiting-backlog alert
- **WHEN** both are inspected
- **THEN** the new condition contains no count threshold that a single affected publish would fail to reach,
  and the pre-existing backlog alert's expression, threshold and hold are unchanged

#### R5.5 — the operator text states the new window and its correct reading [static] [MERGE-BLOCKING]

- **GIVEN** the new alert's text and the runbook it names
- **WHEN** they are read
- **THEN** the runbook exists, the text states the detection window and the terminal reason the affected
  cohort will take, and it states that a terminal failure under that reason does not prove nothing was
  published

#### R5.6 — an idle environment with nothing enqueued does not page [unit]

- **GIVEN** no enqueued publish work and no consumer attached
- **WHEN** the firing condition is evaluated
- **THEN** the paging condition is not satisfied

---

# Capability: `publish-pipeline-ci-invariants`

These requirements ADD guards over behaviour that already exists and must survive this change. Each one
names a "fix" that would make the automated pipeline green by re-hiding the defect it exists to expose.

## ADDED Requirements

### R6 — The terminal horizon, the poll cadence default, and the suite's budget SHALL NOT move to make the pipeline green [MERGE-BLOCKING]

- **R6-a.** The saga terminal horizon SHALL remain at its current value. It is the outer bound of the
  engine's terminal guarantee, and it was measured firing correctly.
- **R6-b.** The wait-step poll cadence SHALL remain at its current default, and its enforced lower bound
  SHALL remain enforced.
- **R6-c.** The live publish batch's per-test budget SHALL NOT be raised. In an environment without a
  consumer no budget under thirty minutes can pass, and a thirty-minute budget is a thirty-minute run
  asserting nothing.
- **R6-d.** If, once R1 holds, the suite proves short of headroom on a slower machine, the ONLY permitted
  lever is shortening the poll cadence **in the automated test environment alone** — never below its floor,
  never in the default configuration, and never in place of raising the budget.
- **R6-e.** Headroom SHALL be measured and reported, not assumed. A run in which a publish-waiting case
  consumes more than two thirds of its budget SHALL trigger R6-d, not a budget increase.

#### R6.1 — the horizon, the cadence default and the budget are unchanged [static] [MERGE-BLOCKING]

- **GIVEN** the change diff
- **WHEN** the saga terminal horizon, the poll cadence default and its floor, and the live publish batch's
  per-test budget are compared with their values before the change
- **THEN** all are unchanged

#### R6.2 — any cadence override is confined to the test environment and respects the floor [static] [MERGE-BLOCKING]

- **GIVEN** any environment-specific override of the poll cadence introduced by this change
- **WHEN** it is inspected
- **THEN** it applies only to the automated test environment, its value is at or above the enforced floor,
  and the default configuration is untouched

#### R6.3 — headroom is observable in the run [ci-outcome]

- **GIVEN** a run of the live publish tier in an environment satisfying R1
- **WHEN** its per-case durations are read
- **THEN** each publish-waiting case's duration against its budget is observable from the run's own output

---

### R7 — `waiting` remains a first-class outcome that consumes no retry budget [MERGE-BLOCKING]

The symptom this change addresses appeared the moment this contract became correct. Restoring the previous
interpretation would turn the automated pipeline green and simultaneously restore a customer-facing defect:
a consumer outage reported as a terminal FAILED on posts that may still publish.

- **R7-a.** The three-state outcome contract — succeeded, failed, waiting — SHALL remain.
- **R7-b.** The wait step SHALL continue to report waiting while any of its channel jobs is pending, and
  waiting SHALL continue to consume no retry budget, record no error, and advance nothing.
- **R7-c.** No part of this change SHALL restore an interpretation in which "still pending" is a step
  failure, and none SHALL infer "still pending" from an error string or a boolean.
- **R7-d.** The guard that pins the amplification defect closed SHALL remain present and SHALL run in a tier
  that executes before merge.

#### R7.1 — repeated waiting leaves the retry budget intact [unit] [MERGE-BLOCKING]

- **GIVEN** a step that returns waiting several times in a row
- **WHEN** each outcome is handled
- **THEN** the retry count is unchanged, no error is recorded, the current step is unchanged, and the saga is
  still non-terminal

#### R7.2 — the amplification guard still exists and still runs before merge [static] [MERGE-BLOCKING]

- **GIVEN** the guard that pins the amplification defect closed
- **WHEN** the tiers are inspected
- **THEN** the guard is present, unskipped, and belongs to a batch that executes on proposed changes

#### R7.3 — nothing infers "still pending" from an error string [static]

- **GIVEN** the change diff
- **WHEN** the consumers of the step outcome are inspected
- **THEN** each branches on the discriminated outcome, and none derives "still pending" from message text or
  a bare boolean

---

### R8 — The three end-to-end publish cases SHALL continue to exist, run, and assert [MERGE-BLOCKING]

They are the only end-to-end coverage of the publish path. Deleting, skipping, or weakening them removes the
only evidence that would have caught this, and is not an acceptable resolution of a red run.

- **R8-a.** The cases that start a saga and wait for a terminal state SHALL remain present and unskipped.
- **R8-b.** They SHALL continue to wait for a terminal state and assert on it. Weakening a case to stop
  waiting, or to accept a non-terminal state, does not satisfy this requirement.
- **R8-c.** They SHALL belong to a batch that executes in the push tier and, where R4 applies, on proposed
  changes.
- **R8-d.** A batch naming this suite that collects zero cases SHALL be reported as a failure, so a suite
  that silently stops being found cannot read as green.

#### R8.1 — the three cases exist, unskipped, still waiting for terminal [static] [MERGE-BLOCKING]

- **GIVEN** the live publish suite
- **WHEN** its cases are inspected
- **THEN** the publish-now end-to-end case, the multi-channel three-state-contract case, and the
  post-pivot non-compensation case are all present, none is skipped or exclusive, and each still waits for a
  terminal state and asserts on it

#### R8.2 — the suite is claimed by a batch, and an empty collection is red [static] [MERGE-BLOCKING]

- **GIVEN** the tier definitions and the batch gate
- **WHEN** they are inspected
- **THEN** the suite is named by a batch in every tier R4 requires, and a batch collecting zero cases is
  reported as failed

#### R8.3 — they execute and pass where R4 requires [ci-outcome] [MERGE-BLOCKING]

- **GIVEN** a run in the push tier, and a run on a proposed change touching an enumerated area
- **WHEN** both complete
- **THEN** all three cases executed and passed in each

---

### R9 — Production behaviour SHALL NOT change [MERGE-BLOCKING]

- **R9-a.** This change alters the automated test environment, the merge gate, and the observability of
  consumption. It SHALL NOT alter the engine's terminal guarantees, its recovery behaviour, its parking
  behaviour, or any customer-facing outcome.
- **R9-b.** Two measured behaviours SHALL still hold afterwards: a saga whose jobs are never consumed
  terminalizes at the horizon under the timeout reason; and a saga parked while no consumer existed resumes
  and terminalizes on the first real event once a consumer drains the queue — observed within seconds after
  22 minutes parked.
- **R9-c.** Any engine-side addition made by this change SHALL be observation only — reading and reporting
  state — and SHALL NOT participate in any decision that advances, terminalizes, retries, or compensates a
  saga.

#### R9.1 — the change adds observation, not decisions, to the engine [static] [MERGE-BLOCKING]

- **GIVEN** the change diff
- **WHEN** every engine-side line it touches is inspected
- **THEN** each is reading or reporting state, and none alters a branch that advances, terminalizes, retries
  or compensates a saga

#### R9.2 — an unconsumed saga still terminalizes at its horizon [unit] [MERGE-BLOCKING]

- **GIVEN** an isolated engine configured with a shortened horizon (the production default being unchanged
  per R6) and a saga whose jobs are never consumed
- **WHEN** the horizon passes
- **THEN** the saga reaches a terminal state under the timeout reason

#### R9.3 — a parked saga still resumes on the first real signal [integration] [MERGE-BLOCKING]

- **GIVEN** a saga waiting because nothing consumed its jobs
- **WHEN** a consumer attaches and drains the queue
- **THEN** the saga reaches a terminal state within one poll cadence plus one scan tick of the draining, and
  not at the horizon

---

## Out of scope — filed, not fixed here

Stated so a reviewer can tell a deferral from an omission. None of these blocks the requirements above, and
none of them is a cause of the failure these specs address.

- **The `nextRetryAt = NULL` engine defect.** On first entry to the wait step the previously-armed value is
  always absent, so the persist-failure branch restores absence and leaves a durable non-terminal row the
  retry scan's predicate can never select — while the log line claims the opposite. It is bounded by the
  horizon and requires a write failure, so it is not this bug. It belongs with the slices that already own
  that file.
- **The remaining unwired suites** tracked as `SMELL-75`.
- **The 36 route files with no test of any kind.**
