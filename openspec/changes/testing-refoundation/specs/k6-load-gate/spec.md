# Load Gate — Specification

> New capability introduced by change `testing-refoundation` (WU-6.K1–6.K4, 6.P1–6.P2). A load tool
> that has never executed — its scenarios reading a variable the workflow does not pass, registering
> users through a route that does not exist, importing from the public internet — either becomes a
> merge gate with calibrated thresholds, or is deleted with the numbers that justified deleting it.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files; **[runtime]** needs the stack and a load run; **[ci]** observable only on
> a CI run.
>
> A scenario named **Red — …** is the demonstrated failure path (P4).

---

## Purpose

Latency under concurrency is a defect class nothing else in the battery observes. It is worth a tool
only if that tool BLOCKS a merge; a load job that cannot fail is a cost with no verdict.

---

## Requirements

### Requirement: One real scenario, and its thresholds are assertions

The fiction scenarios, their shared configuration modules and their helper that registers users
through a non-existent route MUST be deleted. Exactly ONE scenario MUST remain, exercising the REAL
customer authentication route with seeded load users, a read and a write, at a declared arrival rate
for a declared duration. Its thresholds MUST be ASSERTIONS — a failed-request rate ceiling and a
per-endpoint latency ceiling — so breaching one makes the tool exit non-zero.

#### Scenario: Red — an unsatisfiable threshold makes the run exit non-zero [runtime]

- **GIVEN** the scenario with a latency threshold set to an impossible value
- **WHEN** it runs against the started stack
- **THEN** the tool exits non-zero on the threshold, and the tree restores byte-exact

#### Scenario: Only the real routes are exercised [static]

- **GIVEN** the surviving scenario
- **WHEN** its requests are read
- **THEN** each targets a route the application actually serves, users come from the seeded load
  identities, and no module is fetched from a remote URL at runtime

---

### Requirement: The base URL is required, the image is digest-pinned, and results land where the upload reads

The scenario MUST read its base URL from the environment and THROW when it is absent — the existing
fallback to a local address is exactly the default that hid the fact the tool never ran (P3). The
workflow MUST pass the variable the scenario reads. The runner image MUST be pinned by digest, and the
summary handler MUST write its machine-readable and human-readable results to the SAME path the upload
step collects.

#### Scenario: Red — a missing base URL throws before any request [runtime]

- **GIVEN** the base-URL variable unset
- **WHEN** the scenario starts
- **THEN** it throws naming the variable and issues no request

#### Scenario: The uploaded artefact is the produced artefact [ci]

- **GIVEN** a completed run
- **WHEN** the upload step executes
- **THEN** the results it uploads are the files the summary handler wrote, with no empty-directory
  path

---

### Requirement: Thresholds are calibrated over ten runs, and may only tighten

Before the gate is enabled, the scenario MUST be run TEN times against the protected branch, and every
observed value MUST be recorded. Thresholds MUST then be set to the WORST observed latency multiplied
by two. Once set, a threshold MAY only be tightened; loosening it MUST be a recorded decision, not a
quiet edit.

#### Scenario: The calibration numbers are recorded and the thresholds derive from them [ci]

- **GIVEN** ten calibration runs
- **WHEN** the thresholds are written
- **THEN** each equals twice the worst observed value for its metric, and all ten runs' numbers are
  recorded in the tracker

---

### Requirement: The keep-or-delete decision follows a numeric criterion, either way with numbers

The tool MUST be DELETED if, over the ten calibration runs, the coefficient of variation of ANY gated
latency threshold exceeds 50 %, OR a non-zero failed-request rate appears in at least THREE runs with
no application defect behind it — thresholds that shared runners cannot reproduce are decoration.
Otherwise the tool MUST become a merge-gate job that runs per pull request through the environment
contract. Either outcome MUST be recorded with its numbers and reported to the repository owner.

#### Scenario: The criterion decides, and the decision is recorded [ci]

- **GIVEN** the ten runs' variation and failure rates
- **WHEN** the criterion is applied
- **THEN** either the tool is deleted with the numbers recorded, or the merge-gate job exists and is
  required
- **AND** in both cases the decision, the numbers and the date are in the tracker

#### Scenario: The gated job has no dependency that can skip it [static]

- **GIVEN** the merge-gate form
- **WHEN** the workflow is parsed by the verdict-composition rules
- **THEN** the job has no dependency chain that can render it skipped, and its context is required

---

### Requirement: The retired performance scripts leave with their files

The synthetic memory probe — which exercises a leaking function of its own rather than the
application — and the database stress script — 600 lines with zero assertions that always exits zero —
MUST be retired together with their duplicated script entries. The database class they nominally cover
is observed by the load scenario THROUGH the application: two tools for one class means one is
redundant. If the owner elects to keep either, it MUST first gain a real verdict (a non-zero exit path)
rather than remain as it is.

#### Scenario: The retired scripts and their entries are gone [static]

- **GIVEN** the repository after retirement
- **WHEN** the performance directories and the manifests are inspected
- **THEN** the synthetic probe, the stress script and their duplicated script entries are absent, and
  no workflow references them

#### Scenario: A kept script must first be able to fail [runtime]

- **GIVEN** a decision to keep one of them
- **WHEN** its thresholds are breached
- **THEN** it exits non-zero rather than logging a warning and exiting zero
