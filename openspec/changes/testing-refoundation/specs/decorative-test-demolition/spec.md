# Decorative Test Demolition — Specification

> New capability introduced by change `testing-refoundation` (WU-2.0–2.10). It fixes what a test
> must do to survive: a test that cannot fail is not evidence, and the repository demolishes those
> FIRST, by listed verdict, before anything is re-founded on top of them.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files or a deterministic CLI gate; **[runtime]** needs a test run.
> A scenario named **Red — …** is the gate's demonstrated failure path (P4): the planted
> violation, the non-zero exit on the COMPLETE step, and the byte-exact restore.

---

## Purpose

The decorative mass is measured at block level, not file level, and the machine's verdict is an
upper bound. So the machine classifies, the hard probe decides the doubtful cases, a human
approves the delete set, and only then is anything removed.

---

## Requirements

### Requirement: "Decorative" is one of four stated criteria, proven per file

A test block or file MUST be classified decorative only under at least one of: **(a)** it
restricts no behaviour — it asserts only existence, type or truthiness; **(b)** it points at
something that does not exist (the subject the name promises is never imported, or the route is
absent); **(c)** it skips itself under the conditions CI provides; **(d)** it cannot fail by
construction (literal-vs-literal, an unconditional success print, a guarded return, a
conditional-only assertion). No fifth criterion MAY be invented in a slice. When the class is in
doubt the **hard probe** decides: gut the subject's implementation — if the test stays green it is
decorative under (d).

#### Scenario: Every classified block names its criterion and its evidence [static]

- **GIVEN** the committed ledger
- **WHEN** any DELETE or REWRITE row is read
- **THEN** it names the criterion letter, the block titles, and either a probe outcome or a human
  confirmation
- **AND** no row cites a criterion outside (a)–(d)

#### Scenario: A title that contradicts its assertion is classified, not guessed [static]

- **GIVEN** a test whose title promises "returns undefined" while asserting positive existence, or
  promises "throws" with no throw assertion
- **WHEN** the classifier runs
- **THEN** the block is reported as a title contradiction for human adjudication, and is not
  deleted by machine verdict alone

---

### Requirement: Nothing is deleted without a listed ledger row and human approval

Deletion MUST be a two-step: list, then delete. The ledger, the probe outcomes and the human
overlay MUST be committed BEFORE the first deletion slice. The unambiguous DELETE set MUST be
approved by the repository owner in one pass, and each adjudicated row slice by slice. A slice
MUST NOT delete a file or block that has no approved row.

#### Scenario: The listing lands before any deletion [static]

- **GIVEN** the demolition slices in order
- **WHEN** the first deletion PR is inspected
- **THEN** the ledger, probe outcomes and overlay are already committed on the base
- **AND** every file or block it deletes has an approved row

#### Scenario: Red — a deletion with no approved row is rejected [static]

- **GIVEN** a slice deleting a block absent from the approved set
- **WHEN** the ledger check runs
- **THEN** it exits 1 naming the unapproved path, and the tree restores byte-exact

---

### Requirement: The classifier is a tested workspace package, calibrated on both frameworks

The classifier MUST live as a workspace package with its own tests, parse syntactically (no
typecheck), and cover BOTH test frameworks in use. Every assertion class and every block class
MUST have a positive AND a negative fixture. Helper-based assertions imported from another module
MUST be marked **opaque** and routed to human review rather than silently classified.

#### Scenario: Each class has a positive and a negative fixture in both frameworks [static]

- **GIVEN** the classifier's test suite
- **WHEN** it runs
- **THEN** every assertion class and block class is exercised by a fixture that must be flagged
  and one that must not, in both frameworks

#### Scenario: An opaque helper is escalated, never assumed decorative [static]

- **GIVEN** a block whose only assertion is a call to an imported helper
- **WHEN** the classifier runs
- **THEN** the block is marked opaque and lands in the adjudicate set

---

### Requirement: The ledger is deterministic, re-derivable, and predicts the drop

The ledger MUST be reproducible byte-for-byte from the tree (no timestamps), MUST be re-derivable
by the command it names, and MUST carry a per-file machine verdict of DELETE / REWRITE / KEEP /
ADJUDICATE plus the human overlay's confirmed status. A `--check` mode MUST exit 1 on any drift
between the committed ledger and the tree. An area mode MUST print the exact
`file:line:title` list and the EXPECTED test-count drop for a slice, so the slice's real drop can
be compared against its prediction.

#### Scenario: A slice's real drop equals its predicted drop [runtime]

- **GIVEN** the area prediction for a deletion slice
- **WHEN** the slice lands and the affected suites run
- **THEN** the observed test-count drop equals the prediction
- **AND** a difference is explained in the PR, never absorbed

#### Scenario: Red — ledger drift exits 1 [static]

- **GIVEN** a test file changed without re-deriving the ledger
- **WHEN** the check mode runs
- **THEN** it exits 1 naming the drifted path

---

### Requirement: The hard probe runs in an isolated worktree and never mutates the working tree

The probe MUST gut the subject inside a detached, separately-installed worktree, run only the
single block under test, and classify the outcome as GREEN (decorative under (d)), RED (restricts
behaviour — weak evidence of value) or LOAD-ERROR (inconclusive). It MUST restore that worktree
and MUST leave the main working tree untouched. Its output MUST record the subject and test
hashes, the exact command, the outcome and the commit, so a probe can be re-run and compared.

#### Scenario: The main tree is untouched and the probe is reproducible [runtime]

- **GIVEN** a probe run over the doubtful set
- **WHEN** it finishes
- **THEN** the main tree's status is clean, the probe worktree is restored, and each result carries
  hashes, command, outcome and commit

#### Scenario: A class is promoted to a lint rule only on measured agreement [static]

- **GIVEN** a candidate class whose probes are recorded
- **WHEN** promotion is considered
- **THEN** the class becomes a lint rule only when at least 90 % of its probes are GREEN, and a
  seeded random sample of behavioural blocks is probed to measure the false-negative rate

---

### Requirement: The durable form is a lint rule pinned at `error`, with suppressions as a shrinking baseline

Each calibrated class MUST become an ESLint rule so the defect cannot re-enter, and every such
rule MUST be pinned at `error` by a fitness check (**#48**) — a rule demoted to `warn` is a rule
that stops gating. Existing violations MUST be captured as bulk suppressions, which form a
baseline that only shrinks. A slice that removes a suppressed block MUST prune its suppression in
the same slice; a stale suppression MUST fail the lint run. `console` output MUST be an error in
test globs. Rules that would flag the other framework's files MUST be scoped to the files the
vitest collector owns.

#### Scenario: Red — a planted decorative block fails lint in both frameworks [static]

- **GIVEN** an existence-only block planted once under vitest and once under the tier framework
- **WHEN** the complete lint step runs
- **THEN** it exits non-zero naming each block, and the tree restores byte-exact

#### Scenario: Red — a stale suppression fails the run [static]

- **GIVEN** a suppressed block deleted without pruning its suppression
- **WHEN** lint runs
- **THEN** it exits non-zero on the unused suppression

#### Scenario: Red — demoting a rule below `error` exits 1 [static]

- **GIVEN** one testing rule changed from `error` to `warn`
- **WHEN** the pin check runs
- **THEN** it exits 1 naming the rule

---

### Requirement: The coverage descent demolition causes is admitted only through a named canon exception

Coverage counts execution, not assertion, so deleting decorative tests LOWERS measured coverage
and the floor ratchet rejects a descent without a marker. A `decorative-demolition` exception
scenario MUST exist in the canon exception list with an ADR behind it, and it MUST land BEFORE the
first block-deletion slice in the largest measured package. Every slice that lowers a floor MUST
carry the marker; a slice that forgets it MUST go red.

#### Scenario: The exception scenario and its ADR land before the first descent [static]

- **GIVEN** the demolition sequence
- **WHEN** the first slice that lowers a floor is inspected
- **THEN** the exception scenario and its ADR are already on the base, and the slice carries the
  marker

#### Scenario: Red — a floor lowered without the marker exits 1 [static]

- **GIVEN** a floor lowered with no marker
- **WHEN** the complete floor-ratchet step runs against the base
- **THEN** it exits 1; with the marker restored it exits 0 and logs what it accepted

---

### Requirement: Weak-but-behavioural tests are rewritten, never deleted, and the rewrite is probe-proven

A file that constrains behaviour weakly (a promised failure path never activated, a happy path
asserting only success, a masking assertion by inequality) MUST be REWRITTEN rather than deleted.
A file whose subject is misnamed MUST be renamed rather than deleted, with the untested surface it
was pretending to cover recorded as a declared gap. Every rewrite's acceptance MUST be a hard
probe that comes back RED.

#### Scenario: Each rewrite comes back RED under the probe [runtime]

- **GIVEN** the rewritten files
- **WHEN** the probe guts each subject
- **THEN** every rewritten test fails, and the gap the rename exposed is listed with an owner

---

### Requirement: Every demolition slice closes at zero, with its accounting visible

Each slice MUST land with: the ledger check green; suppressions for the touched files pruned to
zero; the tracker's decorative counters, the predicted drop and the real drop updated in the SAME
PR; the canon marker when a floor descends; lint at zero errors and zero warnings; a typecheck; a
formatting check; and the affected suites run. Slices inside the largest measured package MUST be
serial (the coverage floor moves with each), while slices across independent packages MAY run in
parallel.

#### Scenario: A slice that skips any closing item is not mergeable [static]

- **GIVEN** a slice missing a pruned suppression, the tracker update, or the marker
- **WHEN** the gates run
- **THEN** at least one exits non-zero naming the omission

#### Scenario: A batch never reaches zero collected tests [runtime]

- **GIVEN** a deletion slice inside the tier
- **WHEN** the tier runs
- **THEN** no execution unit reports zero tests, and the total stays above zero
