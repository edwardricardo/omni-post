# Testing Canon and Tracker — Specification

> New capability introduced by change `testing-refoundation` (WU-T.1–T.3, 8.1–8.9). It fixes the
> documentation layer: one living testing document, a canon that states the rules the gates actually
> enforce, and a progress tracker whose every row is re-derivable by a named command.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked documents or a deterministic CLI gate; **[runtime]** needs the re-derivation
> command to run. A scenario named **Red — …** is the gate's demonstrated failure path (P4).

---

## Purpose

Eight documents that contradict each other and a canon whose coverage targets no gate can reach teach
contributors to ignore both. A document is kept only if it is true, and a metric is believed only if a
command reproduces it.

---

## Requirements

### Requirement: Every tracker metric is re-derivable by the command it names

The tracker MUST carry, per metric, a baseline, the current value, a target, the command that
re-derives it, and the pull request that last moved it. A single script MUST print the whole metric
table from the tree and the generated artefacts, and at the baseline commit it MUST reproduce the
baseline column BYTE FOR BYTE. A metric without a re-derivation command MUST NOT be added.

#### Scenario: The script reproduces the baseline column byte for byte [runtime]

- **GIVEN** the baseline commit
- **WHEN** the metrics script runs
- **THEN** its output equals the tracker's baseline column exactly

#### Scenario: Red — a metric with no re-derivation command is rejected [static]

- **GIVEN** a new metric row whose re-derivation cell is empty
- **WHEN** the tracker is reviewed
- **THEN** the row is rejected until it names a command that produces the value

---

### Requirement: The pull request that moves a metric updates the tracker in the same pull request

A metric MUST be updated by the pull request that moved it — never by a separate tracker pull request.
The single exception is a re-plan, which MUST be recorded in the decisions log with its date and its
reason. Baselines MUST be MEASURED and committed, never predicted.

#### Scenario: A metric-moving pull request carries its tracker rows [static]

- **GIVEN** a pull request that changes a measured value
- **WHEN** its diff is inspected
- **THEN** it updates the affected metric rows, work-unit rows and, where applicable, the gates row

#### Scenario: A re-plan is logged rather than silently applied [static]

- **GIVEN** a change to the fixed plan section
- **WHEN** the tracker is inspected
- **THEN** the decisions log carries the re-plan with its date, its fork and the chosen option

---

### Requirement: Every new or modified gate is recorded with its demonstrated red

The tracker MUST hold a gates table with, per gate: its kind, the exact command used to demonstrate its
red, the observed non-zero exit, the restore evidence (a checksum and a clean working tree), and the
pull request. A gate whose red was demonstrated only on a script body rather than the COMPLETE step
MUST NOT be recorded as proven.

#### Scenario: Every gate row carries command, exit and restore evidence [static]

- **GIVEN** the gates table
- **WHEN** each row is read
- **THEN** it names the command, the non-zero exit, and the byte-exact restore evidence
- **AND** the count of proven gates equals the count of new or modified gates

---

### Requirement: Declared gaps are counted, never faked

Every surface deliberately left uncovered MUST appear in a declared-gaps table naming why not now and
the owning work unit or change. A gap MUST NOT be represented in the tree as a skipped test, a
todo-marked test, or a test that cannot fail. The gaps table and the metrics MUST agree.

#### Scenario: Red — a gap represented as a skipped or todo test is rejected [static]

- **GIVEN** a surface listed as a gap and also present as a skipped or todo-marked test
- **WHEN** the skip detector runs
- **THEN** it exits non-zero, and the gap remains only in the table

---

### Requirement: The coding standard states the framework per BOUNDARY, the both-directions rule, and the criterion

The testing section of the coding standard MUST be replaced by a framework-per-BOUNDARY table — pure
logic, in-process HTTP route, persistence and transactions, process topology, component and hook,
outbound HTTP, cross-process journey, latency under load, and test quality — each naming the tool and
the lowest layer that can see the defect. It MUST state the both-directions rule and the four-part
decorative criterion with the hard probe. It MUST state the true position of any framework present only
as a transitive dependency. Its example builder MUST be the canonical shared builder, not a literal
object that bypasses the aggregate. The amendment MUST land WITH the executable rule that backs it,
never ahead of it.

#### Scenario: Every row of the boundary table is backed by a gate or a collector [static]

- **GIVEN** the amended testing section
- **WHEN** each row is read
- **THEN** the named tool is one the reach contract actually collects and a required check runs
- **AND** the section states the both-directions rule, the criterion, and the hard probe

#### Scenario: The canon's claims about the tree are true when they are written [static]

- **GIVEN** the amended section
- **WHEN** its statements about frameworks, scripts and paths are checked against the tree
- **THEN** each is true at the commit that writes it

---

### Requirement: Each stale document is adjudicated — corrected, or archived as frozen with a pointer

Every testing document MUST be adjudicated explicitly: a document that is still true MUST be CORRECTED
in place; a document whose subject no longer exists MUST be ARCHIVED with a frozen header pointing at
the living document for state and at the canon for rules, after any still-true pattern is folded
forward. A removed blocker MUST be stated as removed rather than left implied. Every document MUST live
under the documentation tree, and every link to a moved document MUST be updated in the same slice.

#### Scenario: No adjudicated document leaves a dangling reference [static]

- **GIVEN** the adjudicated set
- **WHEN** the link checker runs
- **THEN** every reference resolves, each archived document carries its frozen header and its pointer,
  and each corrected document's numbers match the tree

#### Scenario: A removed subject is stated as removed [static]

- **GIVEN** a document describing a workflow, script or path that this change deleted
- **WHEN** it is adjudicated
- **THEN** it names the removal and where the behaviour went, rather than being silently trimmed

---

### Requirement: One living testing document, re-measured and protected from deletion

There MUST be exactly ONE living document carrying the MEASURED state of the test system, with the
rules in the canon and the state in that document. It MUST be re-measured at close, each closed finding
recorded with the pull request that closed it, and it MUST be added to the canon-document anti-deletion
check WITHOUT becoming an auto-imported context (state does not belong in every session's prompt).
Findings MUST keep their original numbering, reconciled once the measuring report is on the protected
branch.

#### Scenario: The living document is protected without being auto-imported [static]

- **GIVEN** the anti-deletion check and the memory imports
- **WHEN** both are inspected
- **THEN** the living document is in the protected list, and it is not an auto-imported context

#### Scenario: Red — deleting the living document or stripping its required structure fails CI [static]

- **GIVEN** the document deleted, or its owner line or extension section removed
- **WHEN** the complete step runs
- **THEN** it exits 1 naming the document and the missing section

---

### Requirement: The workstream has one tracking entry, and the follow-ups it subsumes point at it

The master plan MUST carry ONE entry for this workstream, with the measured findings, the signed points,
the definition of done, what it subsumes and what it depends on, and its sub-items mapped to the phases —
while the STATE lives only in the tracker. Every roadmap follow-up this workstream subsumes MUST be
marked as subsumed and MUST point at the single section that now owns it, so no follow-up is tracked in
two places.

#### Scenario: Every subsumed follow-up points at its new owner [static]

- **GIVEN** the master plan entry and the roadmap section
- **WHEN** each subsumed follow-up is read
- **THEN** it is marked subsumed and names the section that owns it, and the canon-document check stays
  green
