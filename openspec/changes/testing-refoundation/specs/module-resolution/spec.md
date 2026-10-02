# Delta for module-resolution

> Change `testing-refoundation` (WU-1.2b, 1.3, 1.7, 1.16). One ADDED requirement and two MODIFIED
> requirements. The MODIFIED blocks are the FULL requirement text from
> `openspec/specs/module-resolution/spec.md` with the change applied, so the archive replaces them
> without losing a scenario.
>
> Scenario tags keep the living spec's meaning: **[empirical]** was reproduced in the original RCA and
> is the literal pass/fail bar; a scenario named **Red — …** is a demonstrated failure path.

---

## ADDED Requirements

### Requirement: The unit runner resolves alias-less workspace packages from `src`

The unit test runner does NOT honour the `development` condition on the command line — it honours only
its own resolution conditions — so a BARE workspace import inside a collected test resolves through
`exports` to `dist`. The alias factory covers the packages that have an alias entry, but **18
workspace packages have none**, so under that runner they resolve to a `dist` that may be absent or
stale: the same defect class the command-line condition closes, in the runner that condition does not
reach. The shared test configuration factory MUST therefore declare the `development` condition in the
runner's server-side resolution conditions, and the reach contract MUST assert that every workspace
package imported by a collected test resolves under that package's `src/`.

The alias factory MUST be KEPT as the working fallback; collapsing the two mechanisms into one is a
separately-verified follow-up and is NOT part of this change (the `build-pipeline` no-regression
requirement that names the factory stays satisfied). The exact spelling of the condition option MUST be
verified against the INSTALLED runner version before it is written into the factory, since the
documentation quote comes from a later major.

#### Scenario: an alias-less workspace package resolves to src under the unit runner [runtime]

- **Given** one of the 18 workspace packages that has no alias entry, imported by bare specifier from a
  collected test, with that package's `dist` absent
- **When** the test runs under the unit runner with the condition declared in the factory
- **Then** the import resolves to that package's `src` entry
- **And** there is **zero** `ERR_MODULE_NOT_FOUND` attributable to a missing `dist`

#### Scenario: Red — removing the condition or an alias fails naming the package [runtime]

- **Given** the declared condition removed, or one alias entry deleted
- **When** the reach assertion runs over the collected set
- **Then** it fails naming the package that resolved to an absent `dist`, and the tree restores
  byte-exact

#### Scenario: the alias factory survives as the fallback [static]

- **Given** the shared factory after the change
- **When** it is inspected
- **Then** the alias factory is still present and still applied, and the condition is additive

---

## MODIFIED Requirements

### Requirement: Node-family source consumers resolve workspace packages from `src` against an unbuilt tree

A Node-family **source** consumer — `tsx <file>`, `node --import tsx <file>`, or
`node --import tsx --test <file>` — that resolves a transpile-only workspace package by its **bare
specifier** (e.g. `@observability/logger`, `@infra/prisma`) against a tree where the package's `dist`
is **absent**, MUST resolve to the package's **`src`**, not its `dist`. Resolution MUST succeed with
**zero** `ERR_MODULE_NOT_FOUND` / `Cannot find module` errors attributable to a missing `dist`
artifact.

This applies to the consumers the production decision (ADR-0017's unconditional `exports`→`dist`)
regressed: the Prisma seed and the security-suite consumers. The security suites are no longer reached
through dedicated per-subject scripts — those scripts are deleted and the suites are collected by the
integration collector, per file — so the requirement now attaches to the collector's invocation rather
than to those script names. The original RCA evidence stands as the historical proof of the mechanism.
(Previously: the second scenario named the deleted `test:auth` / `test:rbac` / `test:security` scripts
as the consumer.)

#### Scenario: Prisma seed resolves @observability/logger from src with dist absent [empirical]

- **Given** every transpile-only workspace package's `dist` directory is absent (unbuilt tree)
- **And** the seed entry imports `@observability/logger` by bare specifier
- **When** the seed runs as the dev/test/CI source consumer (a `tsx`-based invocation)
- **Then** `@observability/logger` resolves to its `src` entry (the `.ts` source)
- **And** there is **zero** `ERR_MODULE_NOT_FOUND` / `Cannot find module` for `@observability/logger`
- **And** execution proceeds past module loading to runtime logic (a database-not-reachable stop is
  acceptable — DB-down is the expected stop point, module-resolution failure is not)

#### Scenario: A security suite resolves the @infra/prisma extensions subpath from src with dist absent [empirical]

- **Given** the Prisma package's `dist` directory is absent (unbuilt tree)
- **And** a security module imports `@infra/prisma/extensions/tenantGuard.js` (a written `.js`
  specifier over `.ts` source), loaded transitively by the security suites
- **When** those suites run as the source consumer through the integration collector's per-file
  invocation
- **Then** the specifier resolves through the package's `extensions` subpath to the `.ts` source in
  `src`
- **And** the run reports **0 cancelled** tests
- **And** a search for `MODULE_NOT_FOUND` / `Cannot find module` over the run output returns **0**
  (remaining failures, if any, are HTTP/localhost-server, never module loading)

---

### Requirement: Source-mode invocations opt in via `--conditions development` on the command

Every dev/test/CI **source** consumer that resolves an unbuilt workspace package by bare specifier
MUST opt into the `development` condition by passing `--conditions development` **directly on the
invocation** — NOT via `NODE_OPTIONS` (the CI platform restricts `NODE_OPTIONS` from its environment
file) and NOT via tsconfig `customConditions` alone (the loader does not auto-read tsconfig
`customConditions`).

The covered invocations are: the Prisma seed, and the integration collector's per-file
`node --import tsx --test` invocations. The per-subject `test:auth` / `test:rbac` / `test:security`
scripts are REMOVED (they were a second collector for files the integration collector already
collects), so they are no longer covered invocations. The collector now invokes ONE FILE PER PROCESS
and takes its verdict from the runner's structured test-event stream rather than from formatted
output — and it MUST still carry `--conditions development` on every such invocation. This condition
is a Node-family mechanism; the unit runner does not honour it and is covered by the added
requirement above.
(Previously: the covered list named the three per-subject security scripts and a batched collector
invocation.)

#### Scenario: The seed invocation carries the flag [static]

- **Given** the Prisma seed script
- **When** it is invoked in dev/test/CI
- **Then** the command includes `--conditions development`
- **And** the flag is on the command, not in `NODE_OPTIONS`

#### Scenario: Every per-file collector invocation carries the flag [static]

- **Given** the integration collector after it collects by convention and invokes one file per process
- **When** its invocation is inspected
- **Then** each `node --import tsx --test` invocation includes `--conditions development`
- **And** the flag survives the change of verdict surface, which reads structured test events and
  parses no formatted reporter output

#### Scenario: The deleted per-subject scripts are not reintroduced [static]

- **Given** the manifests and the workflows
- **When** they are searched for the per-subject test scripts
- **Then** none exists, and the suites they used to run are collected exactly once by the integration
  collector

#### Scenario: No source-mode runtime invocation relies on a global env for the condition [static]

- **Given** the CI environment, which restricts `NODE_OPTIONS` from its environment file
- **When** a source consumer needs the `development` condition
- **Then** the condition is supplied per-invocation on the command line
- **And** correctness does not depend on `NODE_OPTIONS` being honored
