# Dependency Version Management — Living Spec

> Cumulative living specification for the `dependency-version-management` capability.
> Established by change `dependency-baseline` (archived 2026-06-23, merged via PR #95 /
> `552c63a9`). Canon: `docs/technical/ADR-0018-dependency-freshness-canon.md` (Accepted).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement carries
> Given/When/Then acceptance scenarios. Scenarios marked **[static]** are checkable without
> installing or building — by inspecting manifests, lockfile, `pnpm-workspace.yaml`, or a
> deterministic CLI gate (`syncpack list-mismatches`, `pnpm dedupe --check`,
> `pnpm install --frozen-lockfile`). Scenarios marked **[runtime]** require a build/test run.
>
> **Governing model (ADR-0018).** "Always latest stable, single version, pinned exact"
> governs **DIRECT** (manifest-declared, catalog-managed) registry dependencies only.
> **TRANSITIVE** deps (declared by no manifest; pulled in by a package we consume) are
> **consumer-governed**: pnpm resolves each to the highest version within its consumers'
> declared ranges, and multiple versions MAY legitimately coexist. A transitive
> `pnpm.overrides` entry is justified ONLY by a real CVE floor at the minimal patched
> version — never to chase the latest major (the "drift-hydra"). This model SUPERSEDES any
> blanket "single version for everything" reading.

---

## Requirements

### Requirement: Every DIRECT registry dependency resolves to exactly one version repo-wide

The single-version invariant applies to **DIRECT** (manifest-declared / catalog-managed)
registry dependencies. **TRANSITIVE** deps are **consumer-governed** — pnpm resolves each to
the highest version in its consumers' declared ranges, and multiple versions MAY legitimately
coexist (e.g. vite 7.3.5 + 8.x for the JSX-frontend hold; minimatch multi-versions for the
eslint toolchain). A transitive override is justified ONLY by a real CVE floor at the minimal
patched version, never to chase the latest major.

Every DIRECT registry (non-`workspace:`) dependency declared by any of the workspace
manifests MUST resolve to **exactly one** version across the entire repo (sourced from a
catalog). After the baseline, `pnpm dedupe --check` MUST report no duplicate-version work to
do for any DIRECT/catalog-managed dep (the converged store may still carry coexisting
TRANSITIVE versions the model permits, as long as `dedupe --check` cannot flatten them
further), and the syncpack single-version group (which sees only manifest-declared specs)
MUST pass.

#### Scenario: pnpm dedupe reports nothing to deduplicate [static]

- **Given** the baseline is applied (catalogs in place, manifests on `catalog:`, lockfile re-resolved, transitive overrides reconciled)
- **When** `pnpm dedupe --check` runs
- **Then** it exits **0** with no proposed changes (no DIRECT/catalog-managed package is installed at ≥2 versions; permitted consumer-governed transitives are not flattenable)

#### Scenario: syncpack single-version group passes [static]

- **Given** the syncpack config defines a single-version-group over registry deps
- **When** `syncpack list-mismatches` runs (the CI gate command — `syncpack lint` is not used because syncpack@12 reports every `catalog:` reference as an `UnsupportedMismatch` under the exact-range semverGroup, which is catalog-protocol tooling noise, not a range violation)
- **Then** the single-version check reports **0** mismatches across all manifests

#### Scenario: each previously drifting name resolves once in the lockfile [static]

- **Given** the 13 drifting direct-dep names (including `@prisma/client`, `opossum`, `prom-client`, `zustand`, `@opentelemetry/api-logs`)
- **When** `pnpm-lock.yaml` is inspected for each name
- **Then** each name resolves to **exactly one** version (e.g. `@prisma/client` is no longer both `7.4.1` and `7.6.0`; the OTel family collapsed to a single line)

---

### Requirement: Registry dependency specs are exact pins, never ranges

No registry dependency in any manifest's `dependencies` or `devDependencies` MAY use a range
or wildcard specifier (`^`, `~`, `*`, `>=`, `x`, or any other open range). Every such spec
MUST be either an **exact** version string or a `catalog:` reference that itself resolves to an
exact pin. `workspace:*` (and other `workspace:` protocol forms) for local packages is
**explicitly allowed** and is NOT a violation. `savePrefix: ""` (`save-prefix=""` in `.npmrc`)
MUST be set so a future `pnpm add` writes exact, not caret-prefixed, specs.

#### Scenario: exact ranges are enforced (no `^ ~ * >=` on registry specs) [static]

- **Given** registry deps are catalog-managed (`catalog:` refs) and the catalog values are exact pins, with `catalogMode: strict` + `save-prefix=""` set
- **When** `syncpack list-mismatches` runs over the literal (non-catalog) specs and the manifests are inspected for any `^ ~ * >= x` range
- **Then** **0** non-exact registry specs remain (catalog values are exact by construction; `save-prefix=""` keeps future `pnpm add` exact; `catalog:` refs themselves report `UnsupportedMismatch` under `syncpack lint`, which is catalog-protocol tooling noise — so the CI gate uses `list-mismatches`)

#### Scenario: the three wildcards are eliminated [static]

- **Given** the pre-baseline wildcards `next-intl:*`, `zustand:*`, and `msw:2.x`
- **When** every manifest is inspected after the baseline
- **Then** none of the three wildcard specs remain — each is folded to its resolved exact version (via `catalog:` reference)

#### Scenario: workspace protocol specs are not flagged as ranges [static]

- **Given** a local package referenced as `workspace:*` (or another `workspace:` form)
- **When** `syncpack list-mismatches` runs
- **Then** the `workspace:` spec is **not** reported as a range violation (the `workspace protocol` versionGroup is `isIgnored`; only registry deps are subject to the exact-pin rule)

#### Scenario: savePrefix forces exact on future adds [static]

- **Given** the root `.npmrc` sets `save-prefix=""`
- **When** the config is inspected
- **Then** `save-prefix` is the empty string, so a subsequent `pnpm add` writes an exact spec rather than a caret range

---

### Requirement: Pinned DIRECT versions are the latest stable release, with no pre-releases

Every catalog-pinned DIRECT registry version MUST correspond to the package's npm `latest`
dist-tag at baseline time (latest stable). No spec MAY pin or resolve to a pre-release
identifier — `rc`, `beta`, `alpha`, `next`, `canary`, or any version carrying a SemVer
pre-release tag. The sanctioned updater is `taze -l --maturity-period 7` (a 7-day buffer
against yanked/broken releases); `newest` / `greatest` / `--pre` are forbidden. "Never pin
lower": when a current catalog value already exceeds the 7-day-buffer candidate, the current
value is kept.

#### Scenario: no pre-release identifiers appear in any spec [static]

- **Given** all manifests and the `pnpm-workspace.yaml` catalogs
- **When** every registry version spec is inspected
- **Then** **0** specs contain a pre-release tag (`-rc`, `-beta`, `-alpha`, `-next`, `-canary`, or any `-<prerelease>` SemVer suffix)

#### Scenario: no pre-release versions appear in the lockfile [static]

- **Given** `pnpm-lock.yaml` after the baseline
- **When** resolved versions are inspected
- **Then** no registry dependency resolves to a pre-release version

#### Scenario: catalog pins match the latest stable dist-tag [runtime]

- **Given** a representative sample of catalog-pinned DIRECT packages
- **When** their pinned version is compared against the npm `latest` dist-tag (subject to the 7-day maturity buffer)
- **Then** each pin equals the latest stable release (no version is newer than `latest`, none is a pre-release)

---

### Requirement: Catalogs are the single source for direct dependencies, enforced strict

Direct (registry) dependencies shared across manifests MUST be sourced from
`pnpm-workspace.yaml` catalogs via a `catalog:` reference rather than an inline version.
`catalogMode: strict` MUST be set so that an off-catalog `pnpm add` errors before reaching CI
(a duplicate version becomes structurally un-representable — one edit point). All manifests
MUST reference catalogs for their shared registry deps; no manifest may carry an inline
version for a catalog-managed dependency.

#### Scenario: catalogMode is strict [static]

- **Given** `pnpm-workspace.yaml`
- **When** it is inspected
- **Then** `catalogMode: strict` is set (an off-catalog `pnpm add` would error)

#### Scenario: shared direct deps reference the catalog, not inline versions [static]

- **Given** any manifest declaring a catalog-managed registry dependency
- **When** that dependency's spec is read
- **Then** it is a `catalog:` reference (default or named catalog), not an inline version string

#### Scenario: an off-catalog add is rejected under strict mode [runtime]

- **Given** `catalogMode: strict` is active
- **When** a `pnpm add <pkg>@<version>` is attempted for a package that would bypass the catalog
- **Then** the command errors (off-catalog adds do not silently succeed)

---

### Requirement: Transitive deps are consumer-governed; security pins stay in pnpm.overrides at the minimal CVE floor

Transitive deps (declared by no manifest) are **consumer-governed**: pnpm resolves each to the
highest version within its consumers' declared ranges, and multiple versions MAY coexist. A
`pnpm.overrides` entry on a transitive is justified ONLY by a real CVE floor (a vulnerability
`pnpm audit` confirms would otherwise resolve through a consumer's range), set to the
**minimal patched version** — never the absolute-latest major. Forcing a major onto a
consumer's range that has not migrated is the drift-hydra and is forbidden.

Security pins that force a version on a transitive-only package MUST remain in the root
`package.json` `pnpm.overrides` block — they MUST NOT be migrated into catalogs (catalogs cover
**declared** direct deps; overrides cover **undeclared transitives**). A **dual-role** package
(declared in ≥1 manifest AND force-pinned onto transitive copies) keeps both entries, but the
override **REFERENCES the catalog** via the `catalog:` protocol (`"catalog:"` /
`"catalog:<name>"`) rather than duplicating the literal — the catalog stays the single source
of truth. The absorbed standing items (`ESBUILD-OVERRIDE`, `JOI-GHSA-IGNORE`,
`SHELL-QUOTE-OVERRIDE`, `UNDOCUMENTED-GHSA-IGNORES`, `CONCURRENTLY-BUMP`) MUST each be kept with
a dated-debt / remove-when gate or removed only when upstream is ready.

#### Scenario: transitive-only CVE pins live in overrides, not catalogs [static]

- **Given** a CVE-forcing pin for a package not declared by any manifest's `dependencies`/`devDependencies`
- **When** the root `package.json` and `pnpm-workspace.yaml` are inspected
- **Then** the pin appears under `pnpm.overrides` and **not** under a catalog, set at the minimal patched version

#### Scenario: dual-role overrides reference the catalog, never a duplicated literal [static]

- **Given** a dual-role package (a direct dep with a catalog entry that also needs a transitive force)
- **When** its `pnpm.overrides` entry is inspected
- **Then** the override reads `"catalog:"` / `"catalog:<name>"` (it references the single catalog value), not a duplicated literal version

#### Scenario: a transitive major is NOT force-pinned to chase latest [static]

- **Given** a transitive dep whose latest major removes API a non-migrated consumer still uses (e.g. `minimatch` 10 / `brace-expansion` 5 vs the eslint toolchain's `^3.1.2`)
- **When** the override block is inspected
- **Then** no `pnpm.overrides` entry forces that latest major absent a confirmed CVE floor (consumer-governed coexistence is preserved)

#### Scenario: absorbed standing items carry a gate or are removed [static]

- **Given** each absorbed standing item (`ESBUILD-OVERRIDE`, `JOI-GHSA-IGNORE`, `SHELL-QUOTE-OVERRIDE`, `UNDOCUMENTED-GHSA-IGNORES`, `CONCURRENTLY-BUMP`)
- **When** the override/ignore config and `docs/product/PENDING_WORK_INVENTORY.md §7` are inspected
- **Then** each surviving item carries a dated-debt or remove-when gate (a documented removal condition), and any item whose upstream is ready is removed

---

### Requirement: Version-locked families move atomically

Packages within a version-locked family MUST be pinned to a mutually-compatible set — no
family member may drift to a version incompatible with its siblings. The families are:
**tiptap + prosemirror**, **googleapis + google-auth + gaxios**, **`@langchain/*`**,
**react + react-dom**, and the **OpenTelemetry set**. A latest-stable bump of any family MUST
move all members together (verify-after-each), never floating one member independently — this
is the drift-hydra mitigation.

#### Scenario: react and react-dom share one version [static]

- **Given** `react` and `react-dom` after the baseline
- **When** their catalog pins (and lockfile resolutions) are inspected
- **Then** both resolve to the same compatible version (no split between `react` and `react-dom`)

#### Scenario: each locked family resolves to a single compatible set [static]

- **Given** each family (tiptap+prosemirror, googleapis+google-auth+gaxios, `@langchain/*`, react+react-dom, the OTel set)
- **When** the catalog pins for that family are inspected
- **Then** all members of the family resolve to a single, mutually-compatible version set (no member is left at an incompatible older/newer version)

#### Scenario: a family bump is applied atomically with verify-after-each [runtime]

- **Given** a per-family latest-stable bump during the apply walk
- **When** the family is bumped
- **Then** all members move together in one step, `pnpm install --frozen-lockfile` is run before the next family, and the full fitness/test gate passes before proceeding

---

### Requirement: The CI guard holds the single-version line on every PR

CI MUST gate every pull request with the three-part dependency guard: `syncpack
list-mismatches` (single-version + literal-range invariant — `list-mismatches`, not `lint`,
because syncpack@12 cannot evaluate the `catalog:` protocol and reports those refs as
`UnsupportedMismatch` noise), `pnpm install --frozen-lockfile` (a drifted lockfile becomes a
hard failure, not a silent re-resolve), and `pnpm dedupe --check` (no duplicate versions for
DIRECT/catalog-managed deps). The guard is wired as the `dependency-consistency` job in
`.github/workflows/fitness.yml` (fitness.yml is the invariant home, not a new workflow).
Renovate MUST be configured with `rangeStrategy: pin`, family grouping, and catalog-awareness
so automated bumps preserve the invariant.

#### Scenario: the three CI gate steps are wired [static]

- **Given** the `dependency-consistency` job in `.github/workflows/fitness.yml` after the baseline
- **When** it is inspected
- **Then** there is a step running `syncpack list-mismatches`, a step running `pnpm install --frozen-lockfile`, and a step running `pnpm dedupe --check`, each gating the PR (non-zero exit fails the PR)

#### Scenario: a drifted lockfile fails frozen-lockfile [static]

- **Given** a PR whose manifest changes are not reflected in `pnpm-lock.yaml`
- **When** the `pnpm install --frozen-lockfile` step runs
- **Then** the step fails (the drift is surfaced as a hard error, not silently re-resolved)

#### Scenario: Renovate is configured to pin and group [static]

- **Given** the Renovate config (`.github/renovate.json`) landed by the baseline
- **When** it is inspected
- **Then** it sets `rangeStrategy: pin`, groups the version-locked families, and is catalog-aware (bumps update the catalog entry, not inline manifest specs)

---

### Requirement: The baseline causes no regression to fitness, build, or tests

After the baseline is fully applied, the existing 27 CI fitness functions MUST remain
hard-zero, the build MUST succeed, and the test suites MUST stay green (LXC-safe). The baseline
is a structural/version change only — it MUST NOT introduce any new fitness violation, break
the build, or fail a previously-passing test.

#### Scenario: all 27 fitness functions stay hard-zero [static]

- **Given** the baseline is applied
- **When** the 27 CI fitness checks run
- **Then** each reports its expected count (hard-zero) — no new violation is introduced by the catalog migration or the version bumps

#### Scenario: build and tests stay green after the baseline [runtime]

- **Given** the baseline is applied with the dev stack paused (OOM mitigation on the 9GB box)
- **When** the build and the LXC-safe test suites run
- **Then** the build succeeds and the tests pass — no previously-passing build/test regresses

#### Scenario: structure-only step is upgrade-free and green on its own [runtime]

- **Given** the structure-only commit (catalogs at CURRENT versions + syncpack config; manifests → `catalog:`) before any version bump
- **When** the full build/test/fitness gate runs against that commit alone
- **Then** it is green (structure is isolated from version change; the commit can stand alone if a later family must be dropped)
