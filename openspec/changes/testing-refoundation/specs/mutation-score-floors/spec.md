# Mutation Score Floors — Specification

> New capability introduced by change `testing-refoundation` (WU-7.1–7.7). Mutation testing returns
> LAST, as the only tool that verifies the both-directions rule at scale — and only once the coverage
> contract is closed and the security and publishing packages are at target.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked configuration or a deterministic CLI gate; **[runtime]** needs a mutation run;
> **[ci]** observable only on a CI run.
>
> A scenario named **Red — …** is the gate's demonstrated failure path (P4).

---

## Purpose

A mutation score over a thin suite measures nothing, and a mutation runner on the wrong runner major
reports every mutant as survived while getting FASTER. So the entry conditions are part of the contract,
not a preference.

---

## Requirements

### Requirement: Mutation is installed only after its entry conditions are measurably met

No mutation tooling MAY be installed or wired until the tracker shows the coverage contract closed
(every scope measured with committed floors) AND the security and publishing-core packages at their
target floors. The tool MUST run ONLY on the held runner major; the documented runner hold is the
reason the migration is a separate change, and running mutation on the other major would silently
falsify every score.

#### Scenario: The entry conditions are read from the tracker before installation [static]

- **GIVEN** the tracker's coverage and backfill rows
- **WHEN** the mutation slice begins
- **THEN** the coverage row shows every scope measured with floors, the security and publishing rows
  show their packages at target, and the runner major matches the documented hold

#### Scenario: Red — a mutation run on the unheld runner major is refused [static]

- **GIVEN** the runner raised past the hold
- **WHEN** the mutation entrypoint runs
- **THEN** it refuses naming the hold and the measured score-collapse reason, rather than producing a
  score

---

### Requirement: The tool is chosen against stated criteria, and the choice is recorded with numbers

The tool MUST be selected against criteria stated in advance: support for the held runner major on the
packages in scope; reliable or verifiable per-test coverage; an incremental mode; a non-zero exit on the
configured failure condition; the ability to disable early termination so every mutant is reported; a
per-mutant and per-test report; and a runtime inside the pull-request budget. The choice MUST be
recorded together with a pilot's measured runtime and confirmed survivors over a small set of packages.

#### Scenario: The decision row carries the pilot's measurements [static]

- **GIVEN** the pilot over the selected packages
- **WHEN** the decision is recorded
- **THEN** the row names the criteria, the measured runtime, and the confirmed survivor count

---

### Requirement: One root configuration, invoked per package — never one configuration per package

There MUST be ONE root configuration plus a per-package invocation entrypoint; per-package
configuration files MUST NOT be created. The mutated set MUST be derived from the source convention
(excluding barrels and type-only modules), early termination MUST be disabled so every mutant is
reported, per-test coverage MUST be enabled, and both a machine-readable and a human-readable reporter
MUST be produced.

#### Scenario: A package is mutated through the root configuration [runtime]

- **GIVEN** the root configuration and the per-package entrypoint
- **WHEN** a package in scope is mutated
- **THEN** no package-local configuration file exists, every mutant is reported, and both reports are
  written

---

### Requirement: Every survivor is CONFIRMED by an isolated re-run before it counts

A reported survivor MUST be re-run ALONE with per-test coverage disabled and the mutant addressed
individually; only a survivor that survives that re-run counts. This guards against upstream
false-survival defects, which is the same failure mode the runner hold exists for.

#### Scenario: An unconfirmed survivor does not count toward the score [runtime]

- **GIVEN** a reported survivor
- **WHEN** it is re-run in isolation with coverage analysis disabled
- **THEN** it counts only if it survives again, and a mutant that dies in isolation is excluded from
  the reported survivor set

---

### Requirement: Mutation floors never descend (#49)

Each in-scope package MUST have a floor equal to its measured score rounded down, recorded in one
place, and a fitness check MUST assert that no floor descends between base and head. The check MUST
fail closed: an unreadable or empty floor set exits 1 rather than reporting a clean pass.

#### Scenario: Red — a lowered floor, or an unreadable floor set, exits non-zero [static]

- **GIVEN** in turn: one package's floor lowered; the floor set emptied
- **WHEN** the complete step runs against the base
- **THEN** each exits non-zero naming the package or the unreadable scope, and the tree restores
  byte-exact

---

### Requirement: The pull-request lane is incremental and blocks on the configured failure condition

A pull-request job MUST compute the changed sources within the in-scope packages, restore the
incremental state from the protected branch, and mutate ONLY the changed set. It MUST BLOCK the merge
when the configured failure condition is met. A scheduled full run MUST refresh the incremental
baseline and update exactly ONE tracking issue rather than opening a new one per run.

#### Scenario: Red — removing the assertion that kills a mutant fails the job [ci]

- **GIVEN** the pilot package with the assertion that kills a known mutant removed
- **WHEN** the incremental job runs
- **THEN** it exits non-zero on the failure condition, and the tree restores byte-exact

#### Scenario: The scheduled full run keeps one tracking issue [ci]

- **GIVEN** two consecutive scheduled full runs
- **WHEN** both complete
- **THEN** the baseline is refreshed and exactly one tracking issue is updated, not duplicated

---

### Requirement: Mutation results feed the ledger, and the both-directions rule is verified at scale

The results MUST feed back into the test ledger: a clean dry run evidences "passes when the code
complies"; a killed mutant evidences "fails when it does not"; a CONFIRMED survivor evidences
unconstrained behaviour; and a test that kills ZERO mutants — reliable only because early termination is
disabled — MUST REOPEN its ledger row under criterion (a) or (d). That reopening is the enforcement
surface for a test that kills nothing, an assertion-free test included: the pull-request lane enforces
only its configured failure condition over the changed sources and is not required to fail on such a
test. The tracker MUST record the minimum, median and floor score per package.

#### Scenario: A test that kills no mutants reopens its ledger row [runtime]

- **GIVEN** a per-test mutation report
- **WHEN** a test kills zero mutants
- **THEN** its ledger row reopens with the criterion named, and the row is adjudicated rather than
  ignored

---

### Requirement: The out-of-scope surfaces are DECLARED gaps with reasons, not silent omissions

The application package whose native dependency is incompatible with the runner's required process
model, and the tier that the tool cannot mutate at all, MUST be recorded as DECLARED GAPS with their
technical reasons and the upstream conditions that would close them. They MUST NOT be presented as
covered, and their absence MUST NOT be inferred from a green score elsewhere.

#### Scenario: The declared gaps name their reason and their closing condition [static]

- **GIVEN** the tracker's declared-gaps table
- **WHEN** the mutation rows are read
- **THEN** each names the technical limit and the upstream condition (runner support, a patched
  dependency, or an alternative execution mode) that would remove the gap
