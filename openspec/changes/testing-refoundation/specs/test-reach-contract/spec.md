# Test Reach Contract — Specification

> New capability introduced by change `testing-refoundation` (WU-1.1–1.16). It fixes the
> **reach** contract: which runner collects which file, that a file counts as reached only when its
> collector is actually executed by a required check, and that an unreached file is a red build
> rather than invisible.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every requirement carries
> Given/When/Then scenarios. Tags: **[static]** decidable by inspecting tracked files or a
> deterministic CLI gate with no services; **[runtime]** needs a build or test run; **[ci]**
> observable only on a CI run and evidenced by a run id.
>
> A scenario named **Red — …** is the gate's demonstrated failure path (P4): the planted
> violation, the non-zero exit on the COMPLETE step, and the byte-exact restore verified by
> checksum. A requirement whose only scenario is the happy path is incomplete.

---

## Purpose

One collector per test-shaped file, chosen by filename convention, with membership proven by
asking each runner what it collects — never by a hand-maintained list. Neighbouring capability:
`module-resolution` owns HOW a specifier resolves; this spec only asserts that the reach gate
verifies the outcome.

---

## Requirements

### Requirement: The filename suffix is the collector router

The suffix, not a directory or a hand list, MUST decide the collector and the environment
profile: `*.test.ts(x)` → the package's vitest config (`hermetic`); `*.integration.test.ts` →
the services tier; `*.live.test.ts` → the live tier; `*.spec.ts` → Playwright; `*.k6.js` → k6.
`*.fixture.ts` and `*.test-helpers.ts` have **no** collector by design. "Test-shaped" MUST be
the basename match `/\.(test|spec)\.[cm]?[jt]sx?(\..+)?$/` or `/\.k6\.js$/`, so a disabled or
renamed suffix (`.test.ts.disabled`, `.test.ts.old`) stays in scope and `.env.test.example`
stays out. The disk set MUST be `git ls-files` over the WHOLE repository, so a new directory
needs no configuration to be seen. The suffix names the **tier**, not the runner, so the router
survives a runner change (WU-4.X2).

#### Scenario: Each suffix is claimed by exactly one collector [static]

- **GIVEN** the tracked test-shaped set and the reserved-suffix excludes in the vitest factory
- **WHEN** each collector is asked what it collects
- **THEN** a `*.integration.test.ts` / `*.live.test.ts` / `*.spec.ts` file is absent from every
  vitest collection, and each appears in exactly one tier collector
- **AND** `*.fixture.ts` and `*.test-helpers.ts` appear in no collection

#### Scenario: Red — a reserved suffix planted under a vitest include is not collected [runtime]

- **GIVEN** `apps/api/tests/unit/x.integration.test.ts` containing one passing vitest test
- **WHEN** `vitest list` runs for `apps/api`
- **THEN** the file is NOT listed (the reserved excludes hold), so the reach gate reports it
  unreached and exits 1
- **AND** the tree is restored byte-exact

---

### Requirement: Every test-shaped file has exactly one collector, and every executing job of that collector is required

**"Reached" means BOTH**: the file is collected by exactly ONE collector, **AND** that collector has
at least one EXECUTING JOB. The gate MUST assert `disk − ⋃ collected-by-an-executed-collector = ∅`
and that no file is collected twice.

For every collector the registry MUST name EITHER an **empty executing-job list** — `executedBy: []`
is LEGAL and means the collector exists but no job runs it yet (the browser and load collectors
until their jobs land) — OR one or more executing jobs, and each named job MUST exist in a workflow,
MUST invoke the entrypoint in a `run:` step, and its rendered name MUST be a required context in the
committed ruleset (`merge-verdict-composition` owns the ruleset itself). A file collected ONLY by a
collector with an empty executing-job list is therefore **NOT reached** and MUST be quarantined until
that job exists. Membership MUST come from asking each runner (vitest specifications, the tier
collector's `--list`, the browser runner's list, the load glob) — never from a path appearing
anywhere in a script, and never from a hand-written manifest.

#### Scenario: A clean tree reports zero unreached and zero doubly-collected files [ci]

- **GIVEN** the "Test Contracts" job on a tree whose quarantine is empty and whose every collector
  has at least one executing job
- **WHEN** the reach gate runs
- **THEN** unreached test-shaped files = 0 and files with two collectors = 0
- **AND** the job finishes inside its 6-minute budget

#### Scenario: A collector with no executing job yet is legal, and its files are unreached [static]

- **GIVEN** a registry entry whose executing-job list is empty
- **WHEN** the gate runs
- **THEN** the entry itself is accepted (an empty list is not a violation)
- **AND** every file that collector collects is reported unreached unless it is quarantined

#### Scenario: Red — an orphan file exits 1 naming it [static]

- **GIVEN** `apps/api/tests/integration/orphan.test.ts` (no tier suffix, so no collector)
- **WHEN** the complete gate step runs
- **THEN** it exits 1 naming the file as unreached, and the tree restores byte-exact

#### Scenario: Red — a file collected twice exits 1 [static]

- **GIVEN** a second vitest config whose `include` reaches a file another config already collects
- **WHEN** the gate runs
- **THEN** it exits 1 naming the file and both collectors

#### Scenario: Red — a NAMED job that is missing or not required exits 1 [static]

- **GIVEN** a registry entry whose executing-job list NAMES a job id no workflow defines, or names a
  job whose rendered name is absent from the committed ruleset's required contexts, or names a job
  that does not invoke the entrypoint in a `run:` step
- **WHEN** the complete gate step runs
- **THEN** it exits 1 naming the collector and the missing job, context or entrypoint
- **AND** the tree restores byte-exact (an empty list is legal; a WRONG name never is)

---

### Requirement: The reach gate fails closed

A zero is only trustworthy when the scope was read. The gate MUST exit 1 — never print a clean
zero — when the disk set falls below its measured floor, when fewer configs than the measured
count resolve, when a resolved config collects zero files, when a config fails to parse, or when
any collector returns an empty FILE set (an empty EXECUTING-JOB list is a different thing and is
legal).

#### Scenario: Red — an empty or truncated scope exits 1 [static]

- **GIVEN** in turn: a disk set below the floor, zero resolved vitest configs, a config that
  collects nothing, and a config with a syntax error
- **WHEN** the gate runs for each
- **THEN** each exits 1 with a message naming which scope could not be read
- **AND** no case prints a clean zero

---

### Requirement: Quarantine is temporary and only shrinks

Until it is retired (WU-1.15), a quarantine file MAY exempt a named test-shaped file from the
reach rule, and every entry MUST carry a path, a reason, an owner and a since-date. The head
entry set MUST be a subset of the base entry set: an entry may only be removed. Each entry MUST
be printed as `QUARANTINED (not run): <path> — <reason>` on every run, so the exemption is never
silent. An entry is CONTRADICTORY — and MUST fail — only when its file is collected by a collector
that HAS an executing job; a file collected by a collector whose executing-job list is empty is
exactly what the quarantine is for, and MUST be exemptible. After retirement the gate MUST be
hard-zero with no exemption path at all.

#### Scenario: A quarantined file is announced on every run [static]

- **GIVEN** a quarantine entry for a file that no collector reaches, and one for a file collected
  only by a collector with an empty executing-job list
- **WHEN** the tier collector and the reach gate run
- **THEN** both print each entry with its reason, and the gate stays green

#### Scenario: Red — growing, stale or contradictory quarantine exits 1 [static]

- **GIVEN** in turn: an entry added relative to base; an entry whose file no longer exists; an
  entry for a file collected by a collector that HAS an executing job
- **WHEN** the gate runs for each
- **THEN** each exits 1 naming the entry and which rule it broke
- **AND** an entry for a file collected only by a collector with an empty executing-job list does
  NOT fail

#### Scenario: Red — after retirement there is no exemption path [static]

- **GIVEN** the quarantine file and its handling are deleted
- **WHEN** an unreached file is planted
- **THEN** the gate exits 1 with no way to exempt it

---

### Requirement: One execution unit per file, and the services tier runs serially

The services and live tiers MUST execute **one file per runner process**, so the verdict names
the file and the zero-test guard applies per file. Concurrency in those tiers MUST be 1 — a
stated invariant asserted by the contracts package, not a habit — because `cleanupTenant` deletes
by aggregate type and is safe only serially (`shared-test-tooling` additionally scopes it to the
tenant it seeded). Per-file overhead MUST be measured and MUST NOT exceed 60 s over the baseline
run, and the tier job MUST stay inside its 15-minute budget.

#### Scenario: The verdict names the file and the tier stays inside budget [ci]

- **GIVEN** the tier collector invoked by convention over the collected set
- **WHEN** CI runs it
- **THEN** every failure names the file and the test, concurrency is 1, the job is ≤ 15 min, and
  the per-file overhead over the baseline run is ≤ 60 s

#### Scenario: Red — a file with zero tests, or a zero total, exits 1 [runtime]

- **GIVEN** in turn: an empty `*.integration.test.ts`; a `before` hook that throws; a total of
  zero tests for the tier
- **WHEN** the collector runs under a declared tier
- **THEN** each exits 1 (zero-tests, cancelled, and zero-total guards respectively)

#### Scenario: Red — a declared concurrency above 1 exits 1 [static]

- **GIVEN** the tier invoked with concurrency > 1
- **WHEN** the contracts assertion runs
- **THEN** it exits 1 naming the serial invariant and the `cleanupTenant` reason

---

### Requirement: Timing and ordering needs live in the test, not in the runner

A test that needs more time MUST declare it in the test (`describe(name, { timeout })`); the
runner MUST NOT carry per-file timeout tables. A test that contaminates shared state (an
exhausted rate-limit window) MUST restore it in its own teardown; the runner MUST NOT encode an
ordering hack. Before every live file the runner MUST probe API and worker readiness and, on
failure, MUST stop the tier naming both the file about to run and the file that ran before it.

#### Scenario: A declared timeout governs and the contaminator restores [runtime]

- **GIVEN** a suite declaring `{ timeout: 120_000 }` and a suite that exhausts the `/health`
  rate-limit window and restores it in `after()`
- **WHEN** the tier runs with a default timeout of 30 s and no ordering hack
- **THEN** the long suite passes, and the suite that used to depend on ordering passes
  immediately after the contaminating suite

#### Scenario: Red — a missing restore or a dead process stops the tier by name [runtime]

- **GIVEN** in turn: the restoring teardown removed; the workers killed mid-run
- **WHEN** the live tier runs
- **THEN** the per-file probe exits 1 naming the file that left the environment unready, and the
  tree restores byte-exact

---

### Requirement: The tier collector reads structured runner EVENTS, not formatted text

The runner declares its reporter OUTPUT unstable, so the collector MUST take its verdict from the
runner's structured test-event stream — a custom reporter consuming those events, or the
programmatic run API — and MUST NOT parse a formatted report. There is **no built-in JSON reporter**
on the pinned runtime (the shipped reporters are the dot, spec, tap, junit and lcov forms), so a
JSON reporter flag MUST NOT be named as the parsing surface. Counts MUST come from the summary
event's own counters, cross-checked against the per-event tallies the stream provides, and
cancellation MUST be read from the event data rather than inferred from text. The four guards —
failed, cancelled, skipped-under-a-declared-tier, and zero tests — MUST survive the migration with
identical semantics whatever the surface, their pins MUST be updated in the same PR, and each MUST
have its red re-demonstrated after the change.

#### Scenario: All four guards keep their verdict after the surface change [runtime]

- **GIVEN** the collector taking its verdict from the structured event stream
- **WHEN** a failure, a cancellation, a runtime skip and a zero-test file are each planted in turn
- **THEN** each exits 1 with the same guard semantics as before the migration
- **AND** the guard pins reference the new form in the same change

#### Scenario: The verdict does not depend on formatted output [static]

- **GIVEN** the collector after the migration
- **WHEN** its invocation and its verdict path are inspected
- **THEN** no formatted reporter output is parsed, no JSON reporter flag is used, and the counts are
  read from the summary event's counters and cross-checked against the per-event tallies

---

### Requirement: The reach gate asserts that collected tests resolve workspace packages from source

Under vitest a bare workspace import can resolve to an absent `dist`. The contracts package MUST
assert that every workspace package imported by a collected test resolves to that package's
`src/`. The resolution mechanism itself is owned by `module-resolution` (its new
`ssr.resolve.conditions` requirement); this capability only owns the assertion and its red path.

#### Scenario: Every workspace package a collected test imports resolves to src [runtime]

- **GIVEN** the 18 workspace packages that have no alias entry
- **WHEN** the assertion runs over the vitest-collected set
- **THEN** every imported workspace package resolves under that package's `src/`

#### Scenario: Red — removing the condition or an alias fails naming the package [runtime]

- **GIVEN** the `development` condition (or one alias entry) deleted
- **WHEN** the assertion runs
- **THEN** it fails naming the package that resolved to an absent `dist`, and the tree restores

---

### Requirement: Skips, focus and disabled tests are detected over the syntax tree of every test-shaped file

The skip gate MUST parse the disk set with the TypeScript compiler (syntax only) rather than
matching lines, and MUST flag: a member access `.skip|.only|.fixme|.todo|.skipIf|.runIf` on
`it|test|describe|suite|test.describe`, whether called or merely referenced; a `skip`, `only` or
`todo` property in an options object; and `test.skip(` / `test.fixme(` in any position. `.todo`
MUST NOT be exempt. The gate MUST cover EVERY test-shaped file, including specs, `security/`,
`performance/` and package trees.

#### Scenario: Red — each evasive form is caught, and a lookalike is not [static]

- **GIVEN** in turn: `test.fixme(` in a spec; `const d = describe.skip;`; `it("x", { skip: true },
…)`; and `{ skip: 2 }` inside a Prisma call
- **WHEN** the complete gate step runs
- **THEN** the first three exit 1 naming file and construct, the Prisma `skip` is NOT flagged
  (count 0), and the tree restores byte-exact

#### Scenario: A repo-wide clean tree reports zero [static]

- **GIVEN** a tree with no committed skip, only, fixme or todo in any test-shaped file
- **WHEN** the gate runs over the whole disk set
- **THEN** the count is 0, including for specs and non-workspace directories

---

### Requirement: Every positive include glob matches at least one file, in every scope

For each resolved config the gate MUST verify that every POSITIVE `test.include` glob matches ≥ 1
tracked file, across all scopes — a positive glob matching nothing is a scope reporting green over
code it never read. Negations MUST be ignored (an inert exclusion is harmless fat; flagging it
would teach authors to delete real exclusions).

#### Scenario: Red — a dead positive glob or an unreadable config exits 1 [static]

- **GIVEN** in turn: one package's include changed to a directory that does not exist; a config
  whose syntax is broken
- **WHEN** the gate runs
- **THEN** each exits 1 naming the config and the glob, and a negation matching zero files does
  not fail

---

### Requirement: Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts

No workflow step MAY invoke `vitest`, `node --test`, `playwright test` or `k6 run` with a
positional path except in a form the collector registry declares. Every `pnpm … <script>` or
`turbo run <task>` beginning with `test` MUST be one of `test`, `test:coverage`,
`test:integration`, `test:e2e`. Every package with a vitest config MUST declare
`test` = `vitest run` (never a watch invocation). `--passWithNoTests` MUST NOT appear anywhere in
the repository, and the tier collector's zero-collection guards MUST remain pinned.

#### Scenario: Red — an unregistered invocation, a watch script, or a vacuous-pass flag exits 1 [static]

- **GIVEN** in turn: a workflow step running vitest with a positional path; a package whose
  `test` script is bare `vitest`; a planted `--passWithNoTests`
- **WHEN** the respective gate steps run
- **THEN** each exits 1 naming the offending line
- **AND** `pnpm --filter @apps/client test` terminates under a 60 s timeout after the fix

---

### Requirement: The integration collector is a collector only, and refuses to guess a database

The tier collector MUST NOT source the repository `.env`. With a tier declared and
`DATABASE_URL` unset it MUST exit 2 naming the environment entrypoint, and MUST run nothing —
the current fallback points destructive cleanup fixtures at the DEVELOPMENT database, so this is
a data-loss refusal, not a convenience. The collector MUST NOT host a vitest phase; unit and
tier runs are separate entrypoints.

#### Scenario: Red — a declared tier with no database URL exits 2 and runs nothing [runtime]

- **GIVEN** `DATABASE_URL` unset and a declared integration tier
- **WHEN** the collector is invoked
- **THEN** it exits 2 naming `scripts/test-env.sh run`, executes no test file, and touches no
  database

#### Scenario: The collector no longer runs a vitest phase [static]

- **GIVEN** the collector after the change
- **WHEN** its behaviour gate runs
- **THEN** no vitest phase exists, and the unit entrypoint is invoked separately
