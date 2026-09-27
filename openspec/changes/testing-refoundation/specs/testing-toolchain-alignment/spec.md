# Testing Toolchain Alignment — Specification

> New capability introduced by change `testing-refoundation` (WU-T.4). It fixes how the
> **testing** toolchain is kept current: the comparator, what a lag must carry to be legal, and
> which lags are deliberate. Neighbouring capability: `dependency-version-management` owns the
> general dependency model (catalogs, exact pins, CVE floors); this capability owns the freshness
> comparator and the holds table that the general model's CI guard now reads.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting manifests, the lockfile or the holds table; **[runtime]** needs an install, build or
> test run. A scenario named **Red — …** is the gate's demonstrated failure path (P4).

---

## Purpose

Re-founding the test system on a version that must be migrated afterwards is building twice.
The toolchain is therefore aligned BEFORE the reach work, family by family, to the latest
**mature** version — with each deliberate lag written down where a gate can read it.

---

## Requirements

### Requirement: The freshness comparator is "latest mature", never "latest"

For every DIRECT testing dependency the target version MUST be the latest **mature** release:
stable (no pre-release identifier) and published at least **7 days** ago. `latest` MUST NOT be
the comparator, because the newest release is frequently younger than the buffer and pulling it
converts the buffer into decoration. The maturity of each candidate MUST be measured from the
registry's publish time, and re-measured at apply time because the buffer is a moving target
across a multi-week change.

#### Scenario: A candidate younger than the buffer is not the target [static]

- **GIVEN** a package whose `latest` was published fewer than 7 days ago
- **WHEN** the target is computed
- **THEN** the target is the newest stable release at least 7 days old, not `latest`
- **AND** no pre-release identifier (`-rc`, `-beta`, `-alpha`, `-next`, `-canary`) is ever a target

#### Scenario: Every pin records the date its maturity was measured [static]

- **GIVEN** the toolchain table in the progress tracker
- **WHEN** it is inspected
- **THEN** every row carries the installed version, the latest-mature target, and the date the
  measurement was taken

---

### Requirement: Every lag below latest mature carries a documented hold, and a gate proves it

A testing dependency that stays below its latest-mature target MUST have a hold row in the canon
holds table carrying a measured reason, the date, and a **remove-when** condition that can
actually fire. A CI step MUST compare the holds table against the measured lag set and fail when a
lag has no row. The step MUST fail closed: zero parsed holds rows, or an unreadable table, exits 1
rather than reporting a clean zero.

#### Scenario: Red — a lag with no hold row exits 1 [static]

- **GIVEN** a testing dependency pinned below its latest-mature target with no holds row
- **WHEN** the complete gate step runs
- **THEN** it exits 1 naming the package, the installed version and the target
- **AND** the tree restores byte-exact

#### Scenario: Red — a hold row without a remove-when, or an unreadable table, exits 1 [static]

- **GIVEN** in turn: a holds row whose remove-when is absent; a holds table from which zero rows
  parse
- **WHEN** the gate runs
- **THEN** each exits 1, and neither prints a clean zero

#### Scenario: A remove-when names a condition that can be observed [static]

- **GIVEN** each surviving hold row
- **WHEN** its remove-when is read
- **THEN** it names an observable upstream event (a published release, a merged fix, a peer range)
  rather than a restatement of the hold

---

### Requirement: vitest holds at 4.1.11 with its measured reason, and mutation runs only on vitest 4

vitest MUST remain at 4.1.11 as a documented hold. The reason is measured, not preferential: the
only stable Stryker vitest runner reports every covered mutant as Survived on vitest 5 (score
collapsing from ~47 to ~3 while the run gets faster), its peer range warns nothing, and the 4→5
move is a behavioural migration across the whole test tree. The remove-when MUST be a stable
runner carrying the upstream fix PLUS re-measured maturity, and the migration MUST be a SEPARATE
change. Mutation testing MUST run only on vitest 4 while this hold stands.

#### Scenario: The hold is recorded with its measured collapse and a separate-change remove-when [static]

- **GIVEN** the holds table and the tracker's toolchain row for vitest
- **WHEN** both are read
- **THEN** the row names the measured score collapse, the upstream issue, the date, and a
  remove-when requiring a stable runner with the fix plus re-measured maturity
- **AND** the remove-when states that the migration is its own change

#### Scenario: Red — bumping vitest past the hold exits 1 [static]

- **GIVEN** the catalog raised to a vitest 5 line with the hold row still in place
- **WHEN** the holds gate runs
- **THEN** it exits 1 naming the contradiction between the pin and the hold

---

### Requirement: `@types/node` tracks the runtime major, downward if necessary, and `engines.node` is declared

`@types/node` MUST be pinned to the major of the Node runtime the repository actually runs, even
when a higher major is published — this is a named exception to "never pin lower", because types
ahead of the runtime describe APIs the runtime does not have. Every workspace manifest MUST
declare `engines.node` at that runtime major so the drift is gateable rather than folklore.
(The exception clause and the declaration are mirrored into
`dependency-version-management`.)

#### Scenario: The types major equals the runtime major [static]

- **GIVEN** the declared `engines.node` major and the `@types/node` catalog pin
- **WHEN** both are read
- **THEN** the pin is on the same major as the runtime, and the newest published major is NOT used

#### Scenario: Red — a manifest with no `engines.node`, or a mismatched types major, exits 1 [static]

- **GIVEN** in turn: one manifest with `engines.node` removed; `@types/node` raised a major above
  the runtime
- **WHEN** the gate runs
- **THEN** each exits 1 naming the manifest or the mismatch

---

### Requirement: Each family moves as one PR, validated empirically, at the minimal mature version

A version-locked family (the runner and its coverage/UI/eslint companions; the browser driver and
its install step; the testing-library set) MUST move together in ONE pull request of at most 400
CODE lines, pinned to the minimal mature version rather than the newest, and validated
empirically before the next family moves: the affected packages' tests green, a typecheck build,
and a formatting check.

#### Scenario: A family bump lands validated and atomic [runtime]

- **GIVEN** a family bump PR
- **WHEN** it is verified
- **THEN** every family member moved in that PR, the affected packages' tests are green, the
  typecheck build and the formatting check pass, and the pin is the minimal mature version

#### Scenario: Red — a split family fails its own gate [static]

- **GIVEN** one family member raised while a sibling stays behind
- **WHEN** the single-version and family gates run
- **THEN** they exit non-zero naming the split members

---

### Requirement: A test tool no workflow runs is removed, and Jest leaves the tree with it

A declared testing tool that no workflow and no script executes MUST be removed unless a consumer
is proven. The Storybook test runner is the named subject: it is the sole source of Jest and its
satellite chain. Removing it MUST remove that whole chain, and the canon statement that Jest is
not a framework of this repository MUST become true in the tree rather than aspirational. If a
real consumer IS proven, the tool MUST be documented as the only carrier of Jest.

#### Scenario: The unused runner and its whole chain leave together [static]

- **GIVEN** no workflow and no script invoke the Storybook test runner
- **WHEN** it is removed
- **THEN** Jest, its coverage tool, its process manager, its wait helper and the stray types major
  are all absent from the lockfile
- **AND** no file imports Jest

#### Scenario: A proven consumer keeps the tool and names it in canon [static]

- **GIVEN** a script that genuinely runs it
- **WHEN** the adjudication is recorded
- **THEN** the tool is kept and documented as the only carrier of Jest, with the consumer named

---

### Requirement: A bump that crosses into production or raises the runtime floor is its own decision

A "test-only" bump that pulls a production transitive, changes a CVE-override band, or raises the
required Node version MUST be adjudicated separately inside this capability, with its three
preconditions named, and MUST NOT ride along with a test-tool family. The named subject is the
DOM implementation major: it requires a higher Node minimum, moves a fetch library outside an
existing CVE override band, and is additionally a production transitive.

#### Scenario: The crossing bump is adjudicated with its preconditions stated [static]

- **GIVEN** the DOM implementation major
- **WHEN** its row is read
- **THEN** it names the Node floor, the override band it leaves, and the production transitive
- **AND** it is either taken as its own PR with all three resolved, or held with those reasons

#### Scenario: Red — the crossing bump inside a family PR is rejected [static]

- **GIVEN** the major added to a test-tool family PR
- **WHEN** the review gate and the holds gate run
- **THEN** the change is rejected naming the production transitive and the runtime floor
