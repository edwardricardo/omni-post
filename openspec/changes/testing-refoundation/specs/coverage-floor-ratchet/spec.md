# Coverage Floor Ratchet — Specification

> New capability introduced by change `testing-refoundation` (WU-5.1–5.10). It fixes coverage from
> "measured in one scope out of 86, against canon targets no gate can reach" to "measured everywhere,
> with literal per-package floors that never descend".
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked configuration or a deterministic CLI gate; **[runtime]** needs a coverage run;
> **[ci]** observable only on a CI run.
>
> A scenario named **Red — …** is the gate's demonstrated failure path (P4): the planted violation,
> the non-zero exit on the COMPLETE step, and the byte-exact restore.

---

## Purpose

A target that no gate can enforce teaches contributors to ignore gates. The floors become MEASURED
values that only rise, the layer targets become a tracked distance rather than a gate, and every
scope is either measured or listed with a reason.

---

## Requirements

### Requirement: Coverage defaults live in the shared factory, and are inert without the flag

The shared vitest factory MUST supply the coverage provider, include and exclude sets, reporters and
output directory, so a scope cannot be measured differently from its siblings by accident. Coverage
MUST stay DISABLED unless explicitly requested, so a focused single-file run never trips a floor.
Scopes without a conventional source directory MUST declare their own includes. The coverage task
MUST NOT be cached by the task runner.

#### Scenario: A requested coverage run writes a summary; an unrequested one does not [runtime]

- **GIVEN** any package using the factory
- **WHEN** its suite runs with coverage requested, and then without
- **THEN** the first writes a machine-readable summary to the conventional directory and the second
  measures nothing and trips no floor

#### Scenario: Red — a dead coverage include, or a cached coverage task, exits 1 [static]

- **GIVEN** in turn: one package's coverage include pointed at a directory that does not exist; the
  coverage task left cacheable
- **WHEN** the scope gate and the second consecutive task run respectively execute
- **THEN** the first exits 1 naming the config and the glob, and the second is not reported as a
  cache hit

---

### Requirement: Every scope is measured BEFORE any floor is fixed

The four coverage metrics MUST be measured for every vitest scope, on a CI runner AND on a developer
host, with the drift between them recorded — floors MUST NOT be predicted. A CI step MUST assert that
the number of coverage summaries produced equals the number of measured scopes and fail otherwise.
The measurement MUST be recorded per scope in the tracker.

#### Scenario: Every scope produces a summary, and the drift is recorded [ci]

- **GIVEN** the coverage lanes over all scopes
- **WHEN** they run
- **THEN** the summary count equals the scope count, and the per-scope CI-versus-local drift is
  recorded in the tracker

#### Scenario: Red — a scope that produces no summary exits 1 [ci]

- **GIVEN** one config with coverage disabled
- **WHEN** the summary-count step runs
- **THEN** it exits 1 naming the missing scope

---

### Requirement: Floors are literal values per config, in a form the runner can rewrite

Each scope's floors MUST be four LITERAL numbers in its own config, expressed in the merged form the
runner's auto-update accepts — a config whose export is a bare factory call cannot be rewritten, and
a single shared ratchet file would lose auto-update, need a bespoke rewriter and relocate the
exception marker. Each floor MUST be derived from the measured minimum of the two environments by ONE
shared function, `floor = (⌊measured × 10⌋ − 1) / 10`, defined in exactly one place. Each package MUST
expose the canonical coverage script, and the superseded per-package coverage script variants MUST be
removed.

#### Scenario: The runner rewrites the literals when coverage rises [runtime]

- **GIVEN** a scope whose floors are at their measured values
- **WHEN** a test is added that raises coverage by at least 0.2 percentage points and the coverage
  script runs
- **THEN** the runner REWRITES the literals in that config, proving the form is auto-updatable

#### Scenario: Red — deleting a test in a floored scope fails on thresholds [runtime]

- **GIVEN** a scope with its measured floors committed
- **WHEN** one of its test files is deleted and the coverage script runs
- **THEN** it exits non-zero on the thresholds, and the tree restores byte-exact

---

### Requirement: The floor ratchet covers every config, keyed by package name, and fails closed

The ratchet MUST compare head against base for EVERY tracked config, not one. Each config's base
counterpart MUST be located by PACKAGE NAME, so moving a directory cannot reset a floor. Each config
MUST declare exactly ONE global thresholds block with the four literals; zero, more than one, or a
duplicated metric MUST exit 1 rather than reporting a clean pass. A descent MUST be accepted only
with a valid canon-exception marker on or immediately above the lowered literal, and the acceptance
MUST be logged.

#### Scenario: Red — five ratchet violations each exit 1 [static]

- **GIVEN** in turn: one scope's line floor lowered; a thresholds block deleted; a metric duplicated
  inside the global block; a package directory renamed together with a lowered floor; and a lowered
  floor carrying a valid exception marker
- **WHEN** the complete step runs against the base reference
- **THEN** the first four exit 1 naming the scope and the rule, the fifth exits 0 and logs what it
  accepted, and the tree restores byte-exact after each

---

### Requirement: A floor that could rise is committed in the same pull request

When the drift between environments is small enough to trust, a coverage run whose measured value
exceeds the committed floor MUST make the pull request RED with the exact diff to commit — the pull
request that moves the metric commits the new floor. When the drift is too large to trust, the
surfacing MUST remain a warning, and the decision MUST be recorded with the measured drift.

#### Scenario: Red — a risen floor left uncommitted fails with the diff [ci]

- **GIVEN** strict ratcheting in force and a change that raises a scope's coverage by at least 0.2
  percentage points
- **WHEN** the coverage lane runs
- **THEN** it exits non-zero printing the exact floor diff to commit

#### Scenario: A pull request that drops a scope below its floor is red [ci]

- **GIVEN** a draft pull request deleting a test in a floored scope
- **WHEN** the coverage lane runs
- **THEN** it is red on that scope's thresholds

---

### Requirement: Every package is measured or listed with a reason, and the list only shrinks

A denominator gate MUST assert that every workspace package with runtime source either has a
coverage-measured config or an entry in an exclusion list carrying a machine-checkable reason
(types-only, scaffold, pending-retirement with a reference, pending-tests with an owning work unit)
and a since-date. A types-only claim MUST be VERIFIED, not asserted. The list MUST only shrink
relative to base.

#### Scenario: Red — an unmeasured package, a grown list, or a false types-only claim exits 1 [static]

- **GIVEN** in turn: a new package with runtime source and no config; an entry added relative to
  base; a package with runtime behaviour marked types-only
- **WHEN** the complete step runs
- **THEN** each exits 1 naming the package and the rule

---

### Requirement: The canon states measured floors as the gate and layer targets as direction

The coding standard MUST be amended so the enforced contract is "per-package measured floors with a
ratchet that never descends", while the per-layer percentages become a tracked DISTANCE to target
recorded in the progress tracker — not a gate. The amendment MUST land with the ratchet, not before
it.

#### Scenario: The canon no longer states an unenforceable gate [static]

- **GIVEN** the amended coding standard
- **WHEN** its testing coverage section is read
- **THEN** it names the measured floors and the ratchet as the enforced contract, names the tracker
  as the home of the distance-to-target, and no longer presents the layer percentages as floors
