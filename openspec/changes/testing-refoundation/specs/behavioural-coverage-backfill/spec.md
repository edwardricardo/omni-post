# Behavioural Coverage Backfill — Specification

> New capability introduced by change `testing-refoundation` (WU-6.N0–6.N6). Honest infrastructure plus
> declared gaps is not the end of the workstream: the gaps get FILLED, in a measured order, security
> first.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files or a deterministic CLI gate; **[runtime]** needs a test run.
> A scenario named **Red — …** is the demonstrated failure path (P4).
>
> Neighbouring capabilities: the invariants being covered here are OWNED by their own specs
> (`multi-tenant-isolation`, `outbox-event-delivery`, `saga-crash-recovery`, `post-tenant-isolation`
> and the credential specs). This capability adds the behavioural PROOF for them; it MUST NOT restate,
> reinterpret or relax any of those requirements.

---

## Purpose

488 sources against 72 tests in the core, 39 contexts with exactly one test, 36 untested routes, 11
packages with no configuration at all. Writing tests in that state without an order is busywork; the
order is measured, and risk decides the front of the queue.

---

## Requirements

### Requirement: The writing order is measured, not assumed

Before any backfill test is written, the order MUST be produced by crossing three measured inputs: the
per-package coverage measurement, the source-to-test density, and the risk classification. The output
MUST be an ORDERED table naming, per package, the current floor, the target derived from the canon's
layer direction adjusted to what the package can measure, and the gap expressed in files and in
unexecuted functions taken from the coverage report. Packages whose existence is in question MUST be
adjudicated (is anything importing them?) BEFORE a test is written for them.

#### Scenario: The order is derivable and recorded before the first slice [static]

- **GIVEN** the coverage measurement and the density and risk inputs
- **WHEN** the order is produced
- **THEN** the tracker holds an ordered per-package table with floor, target and gap in files and
  unexecuted functions
- **AND** no backfill slice precedes that table

#### Scenario: A package of uncertain purpose is adjudicated before it is tested [static]

- **GIVEN** a package with no importer
- **WHEN** the order is applied
- **THEN** the package is adjudicated as live or retired first, and a retired package receives no
  tests

---

### Requirement: Security first, publishing core second

The first slices MUST cover the security surface: the tenant guard extensions (injection for enrolled
models, NON-injection for documented global tables, transaction-scoped binding, the system-context
escape), the customer-authentication, authentication and API-key contexts, and the untested
authentication, factor and administrative routes — each route asserting BOTH directions (the denied
status AND the successful body). The second group MUST be the publishing core: the domain aggregates
and value objects, the post and channel contexts, the outbox claim, and the saga. Other groups MUST
follow, not precede, these two.

#### Scenario: The tenant guard gains the behavioural proof a structural double cannot give [runtime]

- **GIVEN** the guard extension exercised against a real client
- **WHEN** an enrolled model and a documented global table are each queried
- **THEN** the enrolled query carries the injected tenant predicate and the global table does not,
  proving the enrolment behaviourally rather than by inspection
- **AND** the existing enrolment and denylist gates remain the authority on WHICH models are enrolled

#### Scenario: Every domain invariant has a test that fails when it is violated [runtime]

- **GIVEN** each aggregate invariant, value-object rule and domain event contract
- **WHEN** the invariant is violated and then satisfied
- **THEN** a test fails in the first case and passes in the second

---

### Requirement: Every new test proves in both directions, with the gutted subject as its acceptance

A new test MUST fail when the behaviour is absent and pass when it is present. The acceptance evidence
MUST be the hard probe: with the subject's implementation gutted the test is RED. A new test asserting
only that a result is successful, only that a value exists, or only that a function is defined MUST NOT
be written — the demolition lint rules make that a lint error, and a slice MUST NOT add a suppression
to get around them.

#### Scenario: Red — a new test whose subject is gutted comes back RED [runtime]

- **GIVEN** each new behavioural test
- **WHEN** its subject's exported bodies are gutted
- **THEN** the test fails, and passes again once the subject is restored

#### Scenario: Red — a decorative assertion in new code fails lint, and no suppression is added [static]

- **GIVEN** an existence-only assertion written in a backfill slice
- **WHEN** the complete lint step runs
- **THEN** it exits non-zero, and the slice contains no new suppression for the testing rules

---

### Requirement: New tests consume the shared tooling and the single HTTP double

Every backfill test MUST build its aggregates through the shared domain builders, replace HTTP through
the single interception layer, and build route applications through the shared route-app builder with
the production error plugin. A backfill slice MUST NOT introduce a local builder, a local persistence
or cache double, or a hand-written HTTP stub; the name, cast and stub gates apply unchanged. Every new
file MUST carry the file, description and layer documentation header, and no comment MAY reference a
phase, sprint or roadmap section.

#### Scenario: A slice that reintroduces a local double fails its gates [static]

- **GIVEN** a backfill slice declaring a local builder, a local client double, or a fetch stub
- **WHEN** the lint and boundary gates run
- **THEN** each exits non-zero naming the construct

#### Scenario: Every new file carries its header and no timeline reference [static]

- **GIVEN** the files a slice adds
- **WHEN** the header and comment checks run
- **THEN** each file declares file, description and layer, and no comment names a phase or sprint

---

### Requirement: Each use case is covered on every Result branch, with values asserted

For a context with a single smoke test, coverage MUST be completed per use case across ALL result
branches — validation failure, not-found, conflict, and persistence failure (the branch most commonly
missing) — plus the success path with the VALUES asserted, not merely that the result is successful.
Route coverage MUST assert the complete contract per route: required authentication, schema rejection
with its detail, the asserted success body, and the domain-error-to-status mapping through the
production error plugin.

#### Scenario: Every branch of a covered use case has a test that reaches it [runtime]

- **GIVEN** a use case after its slice
- **WHEN** its coverage report is read
- **THEN** each result branch is executed by a test that asserts the branch's value, not its
  successfulness

---

### Requirement: Each package closes at its target floor or is listed as a declared gap with a reason

A package's slice MUST raise that package's literal floor in the SAME pull request (the ratchet's
auto-update produces the value). The definition of done per package MUST be: the floor at or above the
target, OR an entry in the tracker's declared-gaps table naming why not now and the owning work unit.
The aggregate metric — packages at target over total, and the sum of unexecuted functions — MUST be
updated by each slice.

#### Scenario: A slice that raises coverage without committing the floor is red [ci]

- **GIVEN** a backfill slice raising a package's coverage
- **WHEN** the coverage lane runs under strict ratcheting
- **THEN** it is red until the new floor is committed in that same pull request

#### Scenario: Every package in the order ends at target or in the gaps table [static]

- **GIVEN** the completed backfill
- **WHEN** the order table and the declared-gaps table are read
- **THEN** every package appears in exactly one of them, and every gap names a reason and an owner

---

### Requirement: Parallel writers work in isolated worktrees, and the repository operations stay with one actor

Because the packages are independent and this is the largest group of work, multiple writers MAY work
in PARALLEL — one writer per package, each in an ISOLATED worktree. Each worktree MUST deliver one pull
request of at most 400 CODE lines with its floor raised and its tracker rows updated. Repository
operations MUST remain with the single coordinating actor; a writer MUST NOT perform them. No backfill
test MAY be written before the infrastructure that measures it exists.

#### Scenario: Each parallel writer delivers an independent, budget-respecting slice [static]

- **GIVEN** several writers working concurrently
- **WHEN** their pull requests are inspected
- **THEN** each is scoped to one package, is at most 400 CODE lines, raises its own floor, updates the
  tracker, and was authored in its own worktree

#### Scenario: No backfill precedes the measuring infrastructure [static]

- **GIVEN** the sequence of merged pull requests
- **WHEN** the first backfill slice is located
- **THEN** the reach, verdict, environment and coverage contracts are already in force on its base
