# Integration Tier Preconditions — Specification

> New capability introduced by change `testing-refoundation` (WU-4.1–4.9, 4.X1–4.X2). It fixes the
> tier that today converts a missing service into a pass: availability becomes a throwing
> precondition, ordering hacks become the contaminating test's own responsibility, and the
> runner-choice fork is decided by measurement rather than preference.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files or a deterministic CLI gate; **[runtime]** needs the services or a test
> run; **[ci]** observable only on a CI run and evidenced by a run id.
>
> A scenario named **Red — …** is the gate's demonstrated failure path (P4). Neighbouring
> capabilities: `outbox-event-delivery` owns delivery semantics and `saga-crash-recovery` owns
> recovery semantics — this capability only changes how their suites are REACHED and PRECONDITIONED,
> never what they assert.

---

## Purpose

114 runtime skip sites mean the tier's green is conditional on an environment nobody verified. A
tier that cannot tell "the service is absent" from "the behaviour is correct" is not evidence.

---

## Requirements

### Requirement: Availability is a throwing precondition, never a skip

Every helper that skips a test because a service is unreachable MUST be replaced by an assertion in
the suite's setup that THROWS, naming the command that starts what is missing. After the change the
tier MUST contain zero runtime skip sites and zero availability-skip helpers, so the skip detector
can go hard-zero on the runtime form.

#### Scenario: A missing service stops the suite by name [runtime]

- **GIVEN** the API not running and a live-tier suite
- **WHEN** the suite's setup runs
- **THEN** it throws naming the missing service and the command that starts it
- **AND** no test reports as skipped or passed

#### Scenario: Red — zero skip sites is asserted, and a reintroduced helper fails [static]

- **GIVEN** the tier after the replacement
- **WHEN** the repository is searched for runtime skips and availability-skip helpers
- **THEN** the count is zero
- **AND** reintroducing one makes the skip detector exit 1 naming the file

---

### Requirement: The tier closes at zero skipped, zero cancelled, zero failed on two consecutive runs

The tier's acceptance MUST be TWO consecutive CI runs of both phases reporting zero skipped, zero
cancelled and zero failed, with every suite named exactly once and the reach gate at zero. The run
identifiers MUST be recorded in the tracker; a single green run is not acceptance.

#### Scenario: Two consecutive runs are recorded with their ids [ci]

- **GIVEN** the tier after its fixes
- **WHEN** both phases run twice consecutively
- **THEN** each run reports 0 skipped / 0 cancelled / 0 failed, each suite appears exactly once, and
  both run ids are written into the tracker

---

### Requirement: A test that contaminates shared state restores it

A suite that exhausts a shared budget or mutates shared state MUST restore it in its own teardown,
bounded by the signal the service itself provides plus a margin, and MUST throw if the state does
not recover. The runner MUST NOT encode an ordering dependency to work around it, and removing the
restoration MUST be observably red.

#### Scenario: Red — removing the restoration breaks the next suite, proving the coupling was real [runtime]

- **GIVEN** the restoring teardown removed
- **WHEN** the previously-dependent suite runs immediately afterwards
- **THEN** it fails with the exhausted-budget response, and with the teardown restored it passes in
  the same position

---

### Requirement: A shared-subject race is closed by topology, not by a sentinel

Where a suite owns rows that a real background relay would also consume, isolation MUST come from
TOPOLOGY: the database-only phase MUST run BEFORE the application and workers are started, and the
live phase after. A harness that constructs its own relay MUST additionally assert that no foreign
relay is running — probing the application's health and failing within seconds, naming both the boot
site and the claiming service. A sentinel row, switching the relay off in the production boot path,
and asserting through the real relay are all REJECTED: the first cannot cover rows the use case
writes inside its own transaction, the second puts a test switch in production, and the third moves a
database-only subject into a tier where workers also consume.

#### Scenario: Red — running the database-only phase with the application up fails in seconds [runtime]

- **GIVEN** the database-only phase and a running application
- **WHEN** the harness builds its relay
- **THEN** it exits non-zero within two seconds naming the foreign relay's boot site and the
  claiming service
- **AND** with the application down the same phase is green

#### Scenario: Ten consecutive runs show no cross-consumption [ci]

- **GIVEN** the phase ordering in CI
- **WHEN** the tier runs ten consecutive times
- **THEN** zero outbox cross-consumption failures occur, and the run ids are recorded

---

### Requirement: Dark suites are admitted by MEASURED tier, never by a guess

Every suite no runner reaches MUST be run ALONE to measure its tier — with datastores up and the
application down — and MUST be named by the measured result: passing with zero skips means the
services tier, otherwise the live tier. Suites that also pass with the datastores down MUST be
recorded as hermetic, feeding the ledger and the runner experiment. A grep heuristic MUST NOT decide
the tier. Renaming MUST be a pure rename: the typecheck baseline diff MUST show the same multiset of
findings re-keyed to the new paths, and every documentation and constant reference MUST move with it.

#### Scenario: Each dark suite is admitted under its measured tier [runtime]

- **GIVEN** each previously unreached suite
- **WHEN** it is run alone under the measured conditions
- **THEN** its suffix is the one the measurement dictates, and the quarantine loses its entry
- **AND** a suite that still fails stays quarantined with a reason and an owning work unit

#### Scenario: The rename is pure [static]

- **GIVEN** the rename slice
- **WHEN** the typecheck baseline diff is inspected
- **THEN** it is a re-key only, with an unchanged finding multiset per path, and no documentation
  reference is left dangling

---

### Requirement: A suite that prints its own success, or accepts either outcome, is rewritten to assert exactly

An unconditional success print MUST be removed; a duplicated health assertion MUST be removed; a
test whose title contradicts its assertion MUST be corrected. An authorization assertion MUST assert
EXACTLY one status code plus the domain error code — never a disjunction of an allowed and a denied
status. A quota assertion MUST use a known subscription and assert the exact limit. Diagnostic
console output MUST be removed.

#### Scenario: The rewritten suite asserts exact outcomes [runtime]

- **GIVEN** the rewritten suite
- **WHEN** it runs in its phase
- **THEN** no unconditional success is printed, the authorization case asserts one status and one
  domain code, the quota case asserts the exact limit, and the hard probe over the account-creation
  path comes back RED

---

### Requirement: The scheduled duplicate of the tier is removed; its scenarios run in every pull request

The chaos scenarios MUST be collected by the tier on EVERY pull request, and the separate scheduled
workflow that re-ran the whole tier under a different identity MUST be deleted. The order dimension
that workflow nominally added MUST be preserved by the reverse-order scheduled run
(`merge-verdict-composition`), not by a duplicate collector.

#### Scenario: The scenarios are collected per pull request and the duplicate workflow is gone [static]

- **GIVEN** the tier's collected set and the workflow directory
- **WHEN** both are inspected
- **THEN** the chaos scenarios appear in the per-pull-request tier exactly once, and the duplicate
  workflow file does not exist

---

### Requirement: The runner fork is decided by a measured table against stated hypotheses

Whether the services and live tiers keep their current runner or consolidate onto the unit runner
MUST be decided from a MEASURED table produced on the same commit and the same environment, on both
a CI runner and a developer host, with repeated runs: verdict parity, runtime, failure-naming
quality over a fixed set of red cases, hanging-process handling, the cost of expressing the
skip/cancel/zero guards, migration cost, coverage mergeability, flakiness and peak memory. Only the
evidence is merged; the experimental migration MUST NOT be merged with it.

#### Scenario: The decision applies the stated rule to the measured table [runtime]

- **GIVEN** the completed table
- **WHEN** the rule is applied
- **THEN** consolidation happens only if ALL hard hypotheses hold — full verdict parity across
  repeats; every red case exiting non-zero; the guards expressible in configuration plus a reporter
  within the stated size; migration with no assertion changes; and CI runtime within the stated
  factor and the job budget
- **AND** if a hard hypothesis fails, the incumbent runner is kept and the failed criterion is
  written down as the defect class only it observes

#### Scenario: A workaround disqualifies the candidate rather than rescuing it [runtime]

- **GIVEN** the candidate runner requiring a mock, an alias or a stub so the persistence client or
  the saga engine can run under it
- **WHEN** the migration-cost hypothesis is evaluated
- **THEN** the candidate FAILS that hypothesis by the no-workarounds rule, and the patch is not
  adopted to make it pass
