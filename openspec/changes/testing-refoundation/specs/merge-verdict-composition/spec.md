# Merge Verdict Composition — Specification

> New capability introduced by change `testing-refoundation` (WU-3.1–3.13). It fixes the
> **verdict** contract: every layer emits an exit code and a readable report, and the merge gate
> COMPOSES those verdicts with no path by which a red becomes a counted success.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> parsing tracked workflow and ruleset files; **[runtime]** needs a local run of the complete step;
> **[ci]** observable only on a CI run and evidenced by a run id.
>
> A scenario named **Red — …** is the gate's demonstrated failure path (P4): the planted violation,
> the non-zero exit on the COMPLETE step (never on a step's script body alone), the byte-exact
> restore verified by checksum, and the re-green.
>
> Composition rules are labelled **V1–V7** throughout; they are the rules of the new verdict
> fitness check (**#44**) and are unrelated to any PR numbering.

---

## Purpose

Nineteen required contexts in a non-strict gate, two `needs:` chains without `always()`, five gates
that cannot fail and a workflow summary that miscounts its own invariants are not a merge gate.
The unit of protection is the COMPOSITION, not any single runner.

---

## Requirements

### Requirement: The fitness inventory is contiguous, and its count is derived (#47)

The workflow summary MUST become a gate. The ordered set of check numbers declared across all jobs
MUST equal `1..N` with no duplicate and no hole; the canon document's check headings MUST be the
same set; the canon's stated count MUST equal the derived `N`; and the summary MUST print the
DERIVED count rather than a typed literal. Every `::error` this gate emits MUST be paired with a
non-zero exit in the same step.

#### Scenario: Red — a renumber, a missing heading, or a stale count exits 1 [static]

- **GIVEN** in turn: one check renumbered onto an existing number; one canon heading deleted; the
  canon's count sentence left at the previous value
- **WHEN** the complete step runs
- **THEN** each exits 1 naming the discontinuity, duplicate or mismatch
- **AND** the tree restores byte-exact and the step re-greens

---

### Requirement: Every layer emits a named, readable report — a shard is never blind

Reporter selection MUST live in configuration, not in a command-line flag at one call site, so
every runner reports identically wherever it is invoked. A sharded run MUST still print the file,
the test name and the diff for each failure while also writing its machine-readable blob for the
merge step, and the environment variables those reporters key on MUST be passed through the task
runner's strict environment mode.

#### Scenario: Red — a planted failure in a shard names the test and still writes its blob [runtime]

- **GIVEN** a failing assertion planted in the sharded suite
- **WHEN** the exact shard command runs with the sharded flag set
- **THEN** it exits non-zero, the log names the file and the test with a diff, and the blob exists
  where the upload step reads it
- **AND** the tree restores byte-exact

---

### Requirement: A skipped test fails CI

Under CI, a run that reports any skipped, pending or todo test MUST fail, naming each as
`file > full name`. The verdict MUST NOT depend on text parsing, and MUST hold even if the runner
resets the process exit code. Every runner in the composition MUST be subject to the same rule.

#### Scenario: Red — a runtime skip under CI exits non-zero naming the test [runtime]

- **GIVEN** a test that skips itself at runtime in one package
- **WHEN** that package's suite runs with CI set
- **THEN** the run exits non-zero and names the skipped test
- **AND** with the skip removed the same command exits 0

---

### Requirement: The coverage step runs when the suite is red, and refuses to certify it

The coverage-merge job MUST run even when the test job failed, so failures are rendered from the
collected reports rather than hidden behind a skipped job. It MUST assert the expected number of
shard reports and fail when the count differs. It MUST then REFUSE to certify: when the test job's
result is not success, it MUST emit an error and exit non-zero. Upload steps MAY still run
unconditionally.

#### Scenario: Red — with a failing unit test the merge job runs, prints it, and exits non-zero [ci]

- **GIVEN** a draft PR with one planted failing unit test
- **WHEN** CI runs
- **THEN** the coverage-merge job executes (not "skipped"), the failing test is named in its output,
  and the job exits non-zero on the refusal step

#### Scenario: Red — a missing shard report exits 1 [runtime]

- **GIVEN** one fewer shard report than expected
- **WHEN** the count step runs
- **THEN** it exits 1 naming the expected and actual counts

---

### Requirement: Exactly one job emits each required context, and duplicated or piggy-backed gates are separated

Each required context MUST be produced by EXACTLY ONE job (rule **V1**): zero means a pull request
waits forever for a check nobody emits, and two means two jobs answer for one name. A check that
today rides inside another job on a matrix condition MUST become its own job with no `needs:` and no
`if:`. A duplicated audit job and a duplicated test-and-build job MUST be removed, and the required
context list MUST be updated by an administrator BEFORE the removing PR merges — otherwise the PR
waits forever for the check it deleted.

#### Scenario: Red — a duplicated or missing emitter exits 1 under V1 [static]

- **GIVEN** in turn: a second job declaring an existing required context's name; the job that emits
  a required context deleted
- **WHEN** the complete V1 step runs
- **THEN** each exits 1 naming the context and the offending job count

#### Scenario: The extracted drift check is its own required job [ci]

- **GIVEN** the contract-drift check moved out of the sharded test job
- **WHEN** a pull request runs
- **THEN** it reports as its own context, with no `needs:` and no job-level `if:`
- **AND** a schema changed without regenerating the client types makes it exit 1 with the diff

---

### Requirement: No required job can report a skip, swallow an exit, or be filtered away (V2–V5, V7)

**V2**: a required job MUST NOT carry a job-level `if:` unless the expression is on an allowlist of
expressions always true for a pull request — a skipped required job counts as success. **V3**: a
required job with `needs:` MUST carry an `if:` containing `!cancelled()` or `always()` AND a step
whose `run` reads each needed job's result, so an upstream red cannot become a downstream skip.
**V4**: no step of a required job MAY set continue-on-error unless its name explicitly declares it
never gates. **V5**: no line invoking a gate tool MAY be suffixed with a truth-forcing operator.
**V7**: a workflow producing a required context MUST NOT restrict its pull-request trigger by
changed paths.

#### Scenario: Red — each of V2, V3, V4, V5 and V7 exits 1 on its planted violation [static]

- **GIVEN** in turn: a push-only condition on a required job; the `!cancelled()` guard removed from
  the coverage job; continue-on-error on a gating step; a truth-forcing suffix on a gate tool
  invocation; a path filter on the pull-request trigger of a required workflow
- **WHEN** the complete step runs for each
- **THEN** each exits 1 naming the rule and the location, and the tree restores byte-exact

#### Scenario: A clean composition reports zero for all seven rules [static]

- **GIVEN** the workflows and the committed ruleset at head
- **WHEN** the verdict check runs
- **THEN** V1–V7 each report zero violations

---

### Requirement: The required-context list is versioned in the repository, with an up-to-date-branch policy

The merge gate's composition MUST be committed as a ruleset file in the repository — the classic
protection surface is unreadable from CI with the workflow token, so no drift gate is possible over
it. The ruleset MUST require branches to be up to date before merging, and MUST forbid force pushes
and branch deletion, with no bypass. Applying it and clearing the classic required checks are
administrator actions that MUST be stated as explicit sequencing steps with their commands in the
PR, never as footnotes. Until it is applied, the committed file MUST mirror the existing contexts so
the reach and verdict rules have a source to read.

#### Scenario: The committed ruleset is the source the other rules read [static]

- **GIVEN** the committed ruleset file
- **WHEN** the reach registry rule and V1 run
- **THEN** both resolve required contexts from that file, and every collector's job name is present

#### Scenario: A required red blocks the merge, observably [ci]

- **GIVEN** a draft PR with one required context red
- **WHEN** the PR is viewed
- **THEN** merging is reported as blocked, and the run id is recorded in the tracker

---

### Requirement: Drift between the committed ruleset and the live gate is detected, and fails closed (V6)

**V6** MUST compare the live rules the platform reports for the protected branch against the
committed ruleset — contexts AND the up-to-date policy — and MUST run on pushes to the protected
branch, on the nightly schedule and on manual dispatch, but NOT on pull requests (a PR that edits
the ruleset would otherwise be red until an administrator applies it). An empty response MUST be
treated as a failure, never as "nothing required": a ruleset in evaluate mode is invisible to that
endpoint. The response MUST be paginated. A network failure MUST retry a bounded number of times and
then report "could not measure" with a non-zero exit — never a silent green.

#### Scenario: Red — a fabricated context, an empty array, or an unreachable endpoint each fail [static]

- **GIVEN** in turn: a context in the committed ruleset that the live gate does not require; an
  empty live response; an endpoint that fails every attempt
- **WHEN** the complete V6 step runs
- **THEN** each exits non-zero, the empty case names the evaluate-mode possibility, and the
  unreachable case reports "could not measure" after its bounded retries

---

### Requirement: The secret scan reads the pull request's commits, and fails closed on an empty scan

The secret scan MUST scan the commit range the pull request actually introduces, with pipeline
failures propagated. It MUST fail closed when the reported number of scanned commits is below one —
the previous form scanned a staging area that is always empty in CI, so it could not fail. The
scanner version MUST stay pinned and its flags verified against that version.

#### Scenario: Red — a planted secret in a PR commit exits non-zero, and the old form did not [runtime]

- **GIVEN** a disposable clone with a committed planted token
- **WHEN** the new step runs over that commit range
- **THEN** it exits non-zero naming the finding
- **AND** the previous form over the same clone exits 0, evidencing that the old gate was blind

#### Scenario: Red — zero commits scanned exits 1 [runtime]

- **GIVEN** a range that yields no commits
- **WHEN** the step runs
- **THEN** it exits 1 rather than reporting a clean scan

---

### Requirement: A required gate either can fail or is removed — measured, then decided

A required check that cannot fail MUST NOT stay required. The vulnerability scanner MUST first be
MEASURED against the existing audit tooling and its findings classified; then either (a) it becomes
a real gate — binary pinned by digest, audited findings ignored individually with a reason and an
expiry, and the error-swallowing removed — or (b) the job is deleted and removed from the required
list. The measurement and the decision MUST be recorded.

#### Scenario: The decision follows the measurement, with the classification recorded [static]

- **GIVEN** the scanner's findings and the audit tooling's findings over one commit
- **WHEN** they are classified by severity, alias, existing ignore and dev-only status
- **THEN** the table is recorded, and the outcome is either a real gate or a deletion — never a
  required check that still cannot fail

#### Scenario: Red — with the gate kept, removing one audited ignore exits 1 [runtime]

- **GIVEN** the gate form with its ignore list
- **WHEN** one ignore is removed and the step runs
- **THEN** it exits 1 naming the finding

---

### Requirement: The scheduled run has one alarm, and duplicate schedules are removed

The scheduled run MUST add a dimension the pull-request gate does not have (reverse execution
order over the full tier) and MUST NOT duplicate pull-request checks. It MUST raise at MOST ONE
open alarm: on failure it comments on the existing alarm or creates it; on success it closes it
with a link. A separate scheduled workflow that re-runs a tier already covered by every pull
request MUST be deleted.

#### Scenario: Red — a planted tier failure creates one alarm, then closes it [ci]

- **GIVEN** a dispatch on a scratch branch with an integration failure planted
- **WHEN** it runs twice and then runs with the plant removed
- **THEN** the first run creates one alarm, the second adds a comment rather than a second alarm,
  and the clean run closes it with the run link

---

### Requirement: A script entrypoint cannot swallow its own failure (#45)

No tracked script entrypoint MAY terminate a promise chain by logging the error to the console: a
failing entrypoint that logs and exits zero is a gate that cannot fail. The check MUST be hard-zero
over the tracked tree, and MUST be independent of installed dependencies.

#### Scenario: Red — a planted console-terminated rejection exits 1 [static]

- **GIVEN** a console-terminated promise chain planted in a script entrypoint
- **WHEN** the complete step runs
- **THEN** it exits 1 naming the file and line, and the tree restores byte-exact

#### Scenario: Load-generation and reporting entrypoints fail on absent input [runtime]

- **GIVEN** a reporting entrypoint pointed at a directory with no results
- **WHEN** it runs
- **THEN** it exits 1 rather than producing an empty report and exiting 0
