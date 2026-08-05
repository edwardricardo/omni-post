# Saga Crash Recovery Specification

## Purpose

In-flight sagas MUST survive a deploy, crash, or restart. Today they do not: `initialize()`
loads non-terminal sagas into memory but never resumes them, the 5-second retry-recovery
scan is dead, and the timeout checker only iterates the in-memory map that a restart
empties. A post-pivot step failure therefore persists `nextRetryAt` that nothing ever
reads, and the saga stays non-terminal forever — a direct violation of
`ARCHITECTURE_CANON §Saga` ("Sagas MUST reach `COMPLETED`, `FAILED`, or `COMPENSATED`;
infinite `RUNNING` is a canon violation").

This capability specifies WHAT recovery must guarantee: which rows resume, which never
re-execute, what safety proof gates auto-resume, and how the guarantees are verified in
CI. The context declaration these behaviors depend on lives in the
`tenant-context-boundaries` capability; the tenant value they key on lives in
`multi-tenant-isolation`.

RFC 2119 keywords are normative. **[MERGE-BLOCKING]** requirements MUST be proven green
before merge. **[static]** scenarios are checkable by inspecting source or configuration;
**[unit]** scenarios are proven by an isolated test; **[integration]** scenarios require a
real-DB run including a process restart.

## Requirements

### Requirement: Non-terminal sagas resume at boot, once per process start [MERGE-BLOCKING]

On initialization the engine SHALL load the non-terminal (`PENDING` / `RUNNING`) saga rows
and SHALL resume those WITHOUT a persisted `nextRetryAt` by dispatching asynchronous
execution. Rows WITH a persisted `nextRetryAt` SHALL remain owned by the retry-recovery
scan and SHALL NOT also be resumed by the boot pass, so a row is claimed by exactly one
owner. The boot resume SHALL be a SINGLE pass per process start — never a repeating sweep,
and never a per-tick re-dispatch of the same row.

Recovery SHALL be observable: the boot pass SHALL log the number of rows loaded, resumed,
and skipped (with the skip reason), so an operator can tell "recovered nothing" apart from
"never ran".

#### Scenario: an interrupted saga resumes after restart and terminates [integration]

- **GIVEN** a saga is `RUNNING` with no `nextRetryAt` and the process is killed mid-execution
- **WHEN** the process restarts and initialization completes
- **THEN** the saga is resumed exactly once and reaches a terminal state (`COMPLETED`, `FAILED`, or `COMPENSATED`) without operator action

#### Scenario: retry-owned rows are not double-claimed [integration]

- **GIVEN** a non-terminal saga row carries a future `nextRetryAt` when the process starts
- **WHEN** the boot pass runs and the retry-recovery scan subsequently ticks
- **THEN** the boot pass skips the row, the scan resumes it once its retry is due, and the row is executed by exactly one owner

#### Scenario: the boot pass reports what it recovered [integration]

- **GIVEN** a mix of resumable, retry-owned, and terminal rows exists at boot
- **WHEN** initialization completes
- **THEN** a log entry reports the loaded, resumed, and skipped counts with skip reasons, and the counts match the rows in the database

---

### Requirement: Terminal sagas SHALL NEVER be re-executed by recovery [MERGE-BLOCKING]

Recovery SHALL respect the canon re-execution guard: a saga in `COMPLETED`, `FAILED`, or
`COMPENSATED` SHALL NOT be loaded for execution, resumed, retried, or compensated by the
boot pass, the retry-recovery scan, or the timeout checker. Recovery SHALL NOT run any
compensation at or past the pivot step: compensation applies ONLY to compensable steps
strictly before `pivotStepIndex`, exactly as in the non-recovery path.

#### Scenario: terminal rows are untouched by a restart [integration]

- **GIVEN** saga rows exist in each terminal state before the process restarts
- **WHEN** initialization and the first scan ticks complete
- **THEN** none of those rows changes status or `updatedAt`, no command is dispatched for them, and no compensation runs

#### Scenario: a resumed saga does not compensate at or past the pivot [integration]

- **GIVEN** a saga that was interrupted at or after its pivot step resumes
- **WHEN** it subsequently fails terminally
- **THEN** no compensation is executed for the pivot or any post-pivot step, and only compensable pre-pivot steps may be compensated

---

### Requirement: Auto-resume is GATED on a proven pivot-replay dedupe [MERGE-BLOCKING]

Automatic boot resume SHALL be enabled ONLY IF an end-to-end verification proves that the
canonical deterministic dedupe key (`cmd-${sagaId}-${stepId}`) absorbs a re-executed pivot
after a crash between a step's execution and its persistence — that is, the replay produces
NO second external side effect (no duplicate publish job enqueued, no duplicate provider
command dispatched, no duplicate outbox message delivered). The verification SHALL be an
executable crash-replay test, not an argument from the canon.

If that verification cannot be proven green, auto-resume SHALL NOT ship: pivot-interrupted
sagas SHALL instead be PARKED — left non-terminal, flagged for manual review, and excluded
from the boot resume set — and the parked disposition SHALL be recorded. Silently enabling
auto-resume without the proof is NOT acceptable.

#### Scenario: a crash between pivot execution and persistence replays exactly once [integration] [MERGE-BLOCKING]

- **GIVEN** a saga is killed after its pivot step executed but before its state was persisted
- **WHEN** the process restarts and the saga resumes, re-issuing the pivot command
- **THEN** the re-issued command carries the identical deterministic dedupe key, the downstream side effect is observed EXACTLY ONCE, and the saga proceeds past the pivot

#### Scenario: the dedupe key is deterministic across processes [static]

- **GIVEN** the command dedupe key construction
- **WHEN** it is inspected and evaluated for the same saga and step in two processes
- **THEN** it derives only from `sagaId` and `stepId` (plus the compensation suffix), contains no `randomUUID()` or `Math.random()`, and produces an identical value in both processes

#### Scenario: an unproven dedupe falls back to parking, not to silent resume [static]

- **GIVEN** the crash-replay verification cannot be proven green
- **WHEN** the recovery behavior is inspected
- **THEN** pivot-interrupted sagas are excluded from the boot resume set, flagged for manual review, and the fallback decision is recorded — auto-resume is NOT enabled

---

### Requirement: A post-pivot failure reaches a terminal state within the timeout horizon [MERGE-BLOCKING]

A saga whose post-pivot step fails and persists a `nextRetryAt` SHALL be re-selected by
the live retry-recovery scan and SHALL reach a terminal state within the configured
timeout horizon, in the SAME process and across a restart. A saga SHALL NOT remain
non-terminal past that horizon, and its terminal transition SHALL be PERSISTED (the
database row SHALL NOT stay `RUNNING` while memory believes it failed).

#### Scenario: a post-pivot failure terminates instead of hanging [integration] [MERGE-BLOCKING]

- **GIVEN** a saga whose post-pivot step fails and exhausts its retries
- **WHEN** the retry-recovery scan and the timeout checker run
- **THEN** the saga reaches a terminal state within the configured horizon, the terminal status is persisted to the database row, and the currently failing `sagaCustomerFlow` post-pivot assertion passes

#### Scenario: a restart does not orphan a retry-pending saga [integration]

- **GIVEN** a saga with a due `nextRetryAt` while the process is restarted
- **WHEN** the new process completes initialization
- **THEN** the saga is re-selected by the scan (not lost with the emptied in-memory map) and progresses to a terminal state

---

### Requirement: Saga recovery suites are wired into the test runner EXPLICITLY [MERGE-BLOCKING]

`apps/api/scripts/run-tests.sh` selects integration suites by EXPLICIT file list, so a
suite that is not listed never runs. `tests/integration/sagaCustomerFlow.test.ts` and every
new suite introduced by this change SHALL be added to that list, in the group matching
their dependencies. A saga suite SHALL NOT be left discoverable-but-unwired, and no suite
SHALL be committed with `.only` or `.skip`.

#### Scenario: every saga suite appears in the runner list [static]

- **GIVEN** the change is applied
- **WHEN** `run-tests.sh` is inspected
- **THEN** `sagaCustomerFlow.test.ts` and each new saga suite appear explicitly in a suite list, and no saga suite exists on disk without a corresponding entry

#### Scenario: the wired saga suite passes in a full run [integration]

- **GIVEN** the database and Redis are running
- **WHEN** the full API test run executes
- **THEN** the saga suites execute (not skipped, not cancelled) and every assertion passes, including the previously failing post-pivot assertion

---

### Requirement: The change lands at zero defects [MERGE-BLOCKING]

The change SHALL land with 0 errors and 0 warnings across the repository gate: ESLint with
`--max-warnings 0`, TypeScript compilation, every CI fitness check at its documented
threshold, the full test run with zero failed and zero cancelled tests, and all CI
workflows green. Pre-existing failures encountered on the touched paths SHALL be fixed,
not deferred, suppressed, or threshold-relaxed. No new `canon-exception` marker SHALL be
introduced without an allowed scenario, and no raw Prisma query SHALL be added outside the
documented fitness exceptions.

#### Scenario: the gate is green end to end [static]

- **GIVEN** the change is complete
- **WHEN** lint, typecheck, the fitness checks, and the full test suite run
- **THEN** each reports 0 errors and 0 warnings, zero tests are cancelled or skipped, and every CI workflow is green

#### Scenario: no suppression is used to reach green [static]

- **GIVEN** the change diff
- **WHEN** it is inspected for `@ts-ignore`, disabled lint rules, relaxed thresholds, skipped tests, and new `canon-exception` markers
- **THEN** none is present, or any marker present cites an allowed scenario with its required follow-up
