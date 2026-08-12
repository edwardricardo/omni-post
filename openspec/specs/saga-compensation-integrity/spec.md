# Saga Compensation Integrity — Living Spec

> Cumulative living specification for the **saga-compensation-integrity** capability: what
> the saga engine guarantees about a compensation once it has decided to run one — that the
> decision is durable before it is acted on, that a resumed walk goes backwards and never
> forwards, that progress survives the process that made it, that a human can re-drive it,
> and that the gauge measuring it measures the real path.
>
> Established by change `saga-engine-terminal-hygiene` (S1), branch
> `workstream/saga-engine-terminal-hygiene`, delivered as PR2 of four chained PRs. The delta
> lives in `openspec/changes/saga-engine-terminal-hygiene/specs/saga-compensation-integrity/spec.md`;
> this file is the cumulative source of truth and describes the behavior that SHIPPED.
>
> This capability is the RECOVERY-TRUTH axis of the saga engine. `saga-crash-recovery` owns
> WHICH rows a boot inherits and under what disposition; this capability owns what the walk
> then does. The operator-facing posture, the runbook and the residuals live in
> `docs/security/MULTI_TENANT_GUARDS.md`.
>
> **It needed no schema change.** `compensationResults` (`Json @default("[]")`) and
> `updatedAt` (`@updatedAt`) already existed on `SagaInstance`; the defect was persistence
> CADENCE and status honesty, not shape.

## Requirements

### Requirement: Compensation state is DURABLE before the walk is acted on

The engine SHALL persist `COMPENSATING` — with the triggering error on the row and
`nextRetryAt` cleared — and SHALL AWAIT that persist, before dispatching the compensation
walk. The decision to compensate and the durable record of it SHALL NOT be separated by a
dispatch, a step execution or any external call. This SHALL hold for the AUTOMATIC path,
not only for the operator-initiated one.

Clearing `nextRetryAt` is normative, not cosmetic: it is what removes the row from the
retry scan's predicate and from the boot pass's checker-owned disposition, so no reader can
convert a compensation into a forward retry.

ONE transition SHALL serve every entry point — the automatic path, the operator re-drive
and the walk's own defensive check — so the doors cannot drift into different shapes.

#### Scenario: the automatic walk persists its status before it compensates anything [unit]

- **GIVEN** a saga whose compensable pre-pivot step has exhausted its retries
- **WHEN** the engine decides to compensate
- **THEN** the row reads `COMPENSATING`, carries the triggering error and carries no retry marker, before any step's `compensate()` is invoked

#### Scenario: a process killed mid-walk leaves COMPENSATING behind [integration]

- **GIVEN** a saga is compensating and the process is interrupted part-way through the walk
- **WHEN** the row is read back with no engine in memory
- **THEN** its status is `COMPENSATING`, and it is neither `RUNNING` nor terminal

---

### Requirement: A crash-inherited compensation resumes the WALK, never the saga

A `COMPENSATING` row SHALL be resumed in the compensation direction only. The engine SHALL
NOT re-enter forward execution for such a row under any disposition, SHALL NOT re-execute
the step whose failure triggered the compensation, and SHALL NOT advance the saga's current
step. `executeSaga` SHALL REFUSE a row whose persisted status is `COMPENSATING` — logging
and counting the refusal — so forward execution and the walk can never both own one row.

#### Scenario: an inherited COMPENSATING row is dispatched backwards [unit] [integration]

- **GIVEN** a `COMPENSATING` row exists at boot whose recorded step is a compensable pre-pivot step
- **WHEN** a process with no memory of it completes initialization
- **THEN** the row is dispatched into the compensation walk, its current step is not advanced, and the failed step is not re-executed forward

#### Scenario: forward execution refuses a compensating row [unit] [static]

- **GIVEN** a persisted `COMPENSATING` row
- **WHEN** forward execution is dispatched for it by any trigger
- **THEN** no step runs, `RUNNING` is not written, and one `stage="compensation"` failure is counted

---

### Requirement: Per-step compensation progress is DURABLE

The walk SHALL persist each step's compensation outcome BEFORE proceeding to the next step,
and SHALL record failed compensations as well as successful ones, so a resumed walk can tell
"attempted and failed" from "never attempted". A resumed walk SHALL NOT re-dispatch the
compensation of a step already recorded as succeeded.

The record SHALL be merged BY INDEX against the row as it stands, so a walk holding an older
copy can never erase a success another walk recorded, and a walk SHALL NOT write over a row
that has reached a terminal state.

The honest bound: a crash between a step's compensation and the recording of that outcome
MAY still compensate that ONE step twice. The canon obligation that `compensate()` be
idempotent is reduced upon, never removed.

#### Scenario: progress is recorded step by step, not once at the end [unit]

- **GIVEN** a saga with several compensable steps to undo
- **WHEN** the walk runs
- **THEN** each step's compensation outcome is durable before the next step's `compensate()` is invoked

#### Scenario: a resumed walk skips what it already undid [integration]

- **GIVEN** a walk interrupted after two of four compensations were recorded
- **WHEN** a new process resumes it
- **THEN** it dispatches compensation for the remaining steps only

---

### Requirement: An operator can re-drive a stalled compensation, and the re-drive RESUMES

The operator-facing compensation endpoint SHALL accept `COMPENSATING` in addition to
`FAILED`, SHALL resume from the durable per-step progress rather than restarting the walk,
and SHALL continue to refuse a terminal saga. The operator path and the automatic path SHALL
converge on the same walk with the same progress semantics.

#### Scenario: the re-drive resumes rather than restarts [unit] [integration]

- **GIVEN** a `COMPENSATING` row whose durable progress records two of four compensations complete
- **WHEN** an operator re-drives it
- **THEN** the request is accepted, only the steps with no recorded completion are dispatched, and the terminal `COMPENSATED` state is read back from the row

---

### Requirement: One walk per saga, and a re-drive says so

A process SHALL run at most ONE compensation walk per saga at a time. The operator endpoint
SHALL answer with a conflict while a walk is in flight rather than starting a second one, and
the boot pass SHALL skip a saga already claimed. Canon `compensate()` idempotency is a promise
about REPEATED invocation and does not extend to CONCURRENT invocation.

#### Scenario: a second walk is refused while one is in flight [unit]

- **GIVEN** a compensation walk that is mid-flight for a saga
- **WHEN** the same saga is dispatched again, automatically or by an operator
- **THEN** no second walk starts and the operator receives a conflict

---

### Requirement: A post-pivot rollback is OPERATOR-owned

A `COMPENSATING` row whose recorded step is at or past its `pivotStepIndex` SHALL NOT be
auto-resumed by the boot pass. It SHALL be PARKED under the same human gate the pivot parking
imposes on forward replay: a human opened that rollback, and rolling back pre-pivot steps of a
saga whose point of no return already fired is a decision a boot pass must not take
unattended, on every restart.

#### Scenario: a post-pivot COMPENSATING row is parked, not walked [unit]

- **GIVEN** an inherited `COMPENSATING` row whose recorded step is at or past the pivot
- **WHEN** initialization completes
- **THEN** it is parked, holds an operator window, and no compensation is dispatched for it

---

### Requirement: A durable COMPENSATING row still reaches a TERMINAL state

A walk whose eligible steps all compensate SHALL settle `COMPENSATED`. A walk that ends with
any eligible step not recorded as succeeded SHALL leave the row `COMPENSATING` rather than
claim a rollback that did not happen.

Every `COMPENSATING` row SHALL nonetheless terminate, under TWO independent bounds:

- the LIVENESS horizon — its last durable write rather than `startedAt` — which SHALL treat a
  stale or absent liveness value as SUSPICIOUS rather than as fresh and SHALL re-read the
  FRESH row before terminalizing, so a live walk is never killed;
- an ABSOLUTE deadline measured from the rollback's BIRTH, which no later write can move. A
  walk that keeps failing keeps rewriting the row, so liveness alone lets a process restarting
  more often than the horizon defer the terminal guarantee indefinitely.

Both SHALL apply whether or not the process has the saga's definition registered — "a
definition this process has not registered" is a named cause of a stuck rollback, and a bound
that skips it is not a bound. Terminalization SHALL use a reason naming the compensation
(`compensation-expired`), never `timeout`, SHALL bind its tenant scope from the FRESH row it
is writing, and SHALL happen exactly once however many further ticks run.

#### Scenario: an unfinishable walk terminalizes instead of hanging [unit]

- **GIVEN** a compensation walk that stops making progress for a full horizon
- **WHEN** the timeout mechanism ticks
- **THEN** the row is terminalized exactly once under a reason naming the compensation failure

#### Scenario: a walk that keeps rewriting the row still terminalizes [unit]

- **GIVEN** a rollback older than the absolute deadline whose walk rewrites the row on every restart
- **WHEN** the timeout mechanism ticks
- **THEN** it is terminalized under the compensation reason, however recently it last wrote

#### Scenario: a live walk is never terminalized on a stale copy [unit]

- **GIVEN** a tracked instance whose carried liveness value is stale or absent
- **WHEN** the timeout mechanism ticks
- **THEN** the decision is re-taken against the fresh row, and a row still being written is left alone

---

### Requirement: A compensation that cannot run is OBSERVABLE, never a silent return

A walk that cannot start or cannot proceed — the instance cannot be loaded, its definition is
not registered in this process, its account cannot be resolved, a step's compensation keeps
failing — SHALL log at ERROR naming the saga and the cause AND increment a failure counter
under its own stage. No exit path SHALL be silent.

#### Scenario: no compensation exit path is silent [unit] [static]

- **GIVEN** the compensation sources
- **WHEN** every early-return path in the walk is inspected
- **THEN** each logs and counts its cause

---

### Requirement: The orphan gauge measures the PRODUCTION path, and its alert moves with it

The gauge SHALL reflect the automatic path, SHALL remain a gauge, and SHALL be measured at
SCRAPE time, so a level that appears between process starts is visible and a level the engine
or an operator has since resolved stops being reported. A level published only at boot is
blind to the population the automatic transition creates and latches until the next restart. The alert SHALL key on a level that never drained, SHALL NOT assert that the engine
cannot resume these rows, and SHALL ship in the same change as the code that changed the
metric's meaning. A terminal `compensation-expired` SHALL have its own alert, since the
timeout alert matches `reason="timeout"` only.

#### Scenario: a transient walk does not page [unit]

- **GIVEN** a compensation walk that starts and finishes within the alert's evaluation window
- **WHEN** the alert condition is evaluated against the emitted series
- **THEN** the condition is not satisfied

## Accepted residuals

1. **The walk claim is per PROCESS; row claims are a later slice.** A rolling deploy in which
   a draining process is still walking a row can produce a second walk in another process.
   Bounded, precisely: no recorded success can be lost (the record is merged by index and a
   success always wins) and a step already recorded is not re-dispatched, but two walks CAN
   invoke the same step's `compensate()` concurrently, because each decides from a read the
   other has not yet written. It is NOT "at most one step repeated in total".
   `shutdown()` skips non-RUNNING rows, so a draining process's detached walk keeps writing
   past teardown. Both close with the row claims (SMELL-73) and are bounded meanwhile by the
   two horizons.
2. **A row left `RUNNING` mid-walk by PRE-CHANGE code is still resumed forward.** Nothing on
   such a row distinguishes it from a saga interrupted mid-step. Two consequences, named: the
   failed step is re-executed with its side effects, and pre-pivot effects the dead walk
   already reverted are undone a second time. The class is bounded (rows crashed mid-walk at
   the moment of the deploy) and is pinned by test rather than described as closed.

3. **The horizons only bound rows the process TRACKS.** A `COMPENSATING` row deferred past the
   boot load ceiling is neither dispatched nor bounded by that process;
   `SagaBootLoadDeferred` is its signal and the next boot's oldest-first page picks it up.
   COMPENSATING rows also sort to the front of that page, so a backlog of them can defer newer
   forward-resumable rows past the ceiling.
