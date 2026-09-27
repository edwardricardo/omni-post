# Delta for dependency-version-management

> Change `testing-refoundation` (WU-T.4). Two ADDED requirements and two MODIFIED requirements.
> The MODIFIED blocks are the FULL requirement text from `openspec/specs/dependency-version-management/spec.md`
> with the change applied, so the archive replaces them without losing a scenario.
>
> Scenario tags keep the living spec's meaning: **[static]** checkable without installing or building;
> **[runtime]** requires a build or test run.

---

## ADDED Requirements

### Requirement: Every workspace manifest declares `engines.node` at the runtime major

Every workspace manifest MUST declare `engines.node` at the major of the Node runtime the repository
actually runs, so a runtime/type/tooling drift is a gate rather than folklore. Today no manifest
declares it, which is why the `@types/node` major was free to run ahead of the runtime unnoticed.
The declaration MUST be consistent across manifests, and the package manager's own engine check is
the enforcement inside this project (a stricter global mode is NOT required).

#### Scenario: every manifest declares the runtime major [static]

- **Given** the workspace manifests
- **When** each is inspected
- **Then** each declares `engines.node`, and every declaration names the same runtime major

#### Scenario: a manifest without the declaration fails the gate [static]

- **Given** one manifest with `engines.node` removed
- **When** the dependency guard runs
- **Then** it exits non-zero naming the manifest

---

### Requirement: Every audited ignore and floor names the chain that actually delivers the package

An entry in the audited-ignore or CVE-floor record MUST name the dependency chain that actually
resolves the package, because the entry's **remove-when** fires off that chain: an entry whose chain
is wrong describes a condition that can never be observed, so the debt becomes permanent while
reading as tracked. The record MUST be corrected whenever the real chain is measured to differ from
the documented one (measured instance: the advisory attributed to a wait helper's chain is in fact
delivered through a JSON-processing tool's DOM dependency).

#### Scenario: each entry's chain matches the lockfile [static]

- **Given** each audited-ignore and CVE-floor entry
- **When** the chain named in the entry is compared against the resolved chains in the lockfile
- **Then** each entry names a chain the lockfile actually contains

#### Scenario: a corrected chain makes the remove-when observable [static]

- **Given** an entry whose documented chain was wrong
- **When** it is corrected
- **Then** the entry's remove-when names a condition on the real chain, and the correction lands in
  the same slice that measured it

#### Scenario: the lockfile is parsed, not grepped [static]

- **Given** a multi-document lockfile
- **When** consumers of a pinned package are enumerated
- **Then** the enumeration parses the lockfile documents rather than matching lines, so a consumer
  that declares the dependency itself is not missed

---

## MODIFIED Requirements

### Requirement: Pinned DIRECT versions are the latest stable release, with no pre-releases

Every catalog-pinned DIRECT registry version MUST correspond to the latest **mature** release: the
package's npm `latest` dist-tag subject to a 7-day maturity buffer, never `latest` taken literally.
A candidate younger than the buffer is NOT the target; the target is the newest stable release at
least 7 days old. No spec MAY pin or resolve to a pre-release identifier — `rc`, `beta`, `alpha`,
`next`, `canary`, or any version carrying a SemVer pre-release tag. The sanctioned updater is a
maturity-bounded updater with that 7-day buffer; `newest` / `greatest` / `--pre` are forbidden.
"Never pin lower": when a current catalog value already exceeds the maturity-bounded candidate, the
current value is kept — **with one named exception**: `@types/node` MUST track the **runtime major
downward**, because types ahead of the runtime describe APIs the runtime does not have. A DIRECT
dependency that stays below its latest-mature target for any other reason MUST carry a documented
hold row with a date and an observable remove-when; documented holds are the ONLY sanctioned lag.
The measurement date MUST be recorded beside each pin, because the maturity buffer is a moving
target across a multi-week change.
(Previously: the comparator was the `latest` dist-tag, "never pin lower" had no exception, and a lag
needed no documented hold.)

#### Scenario: no pre-release identifiers appear in any spec [static]

- **Given** all manifests and the workspace catalogs
- **When** every registry version spec is inspected
- **Then** **0** specs contain a pre-release tag (`-rc`, `-beta`, `-alpha`, `-next`, `-canary`, or any
  `-<prerelease>` SemVer suffix)

#### Scenario: no pre-release versions appear in the lockfile [static]

- **Given** the lockfile after the baseline
- **When** resolved versions are inspected
- **Then** no registry dependency resolves to a pre-release version

#### Scenario: catalog pins match the latest MATURE release [runtime]

- **Given** a representative sample of catalog-pinned DIRECT packages
- **When** each pin is compared against the newest stable release at least 7 days old
- **Then** each pin equals that latest-mature version, or carries a documented hold row
- **And** no pin is a version younger than the buffer, and none is a pre-release

#### Scenario: `@types/node` tracks the runtime major, downward if necessary [static]

- **Given** the declared runtime major and the `@types/node` catalog pin
- **When** both are read
- **Then** the pin is on the runtime's major even when a higher major is published, and this descent
  is recorded as the named exception rather than as a hold

#### Scenario: every pin records the date its maturity was measured [static]

- **Given** the toolchain rows recording the measurements
- **When** they are inspected
- **Then** each names the installed version, the latest-mature target, and the measurement date

---

### Requirement: The CI guard holds the single-version line on every PR

CI MUST gate every pull request with the dependency guard, now FOUR parts: the single-version and
literal-range check (`list-mismatches`, not `lint`, because the tooling cannot evaluate the catalog
protocol and reports those references as unsupported-mismatch noise), a frozen-lockfile install (a
drifted lockfile becomes a hard failure, not a silent re-resolve), a deduplication check (no
duplicate versions for DIRECT/catalog-managed deps), and a **freshness-lag check** that compares the
documented holds table against the measured lag set and FAILS when a dependency sits below its
latest-mature target with no hold row. The freshness check MUST fail closed: zero parsed hold rows or
an unreadable table exits non-zero rather than reporting a clean pass. The guard is wired as the
dependency-consistency job in the fitness workflow (that workflow is the invariant home, not a new
one). The automated updater MUST be configured to pin, to group version-locked families, and to be
catalog-aware so automated bumps preserve the invariant.
(Previously: the guard had three parts and no freshness-lag check.)

#### Scenario: the four CI gate steps are wired [static]

- **Given** the dependency-consistency job in the fitness workflow
- **When** it is inspected
- **Then** there is a step running the mismatch check, a step running the frozen-lockfile install, a
  step running the deduplication check, and a step comparing the holds table against the measured
  lag set — each gating the PR (non-zero exit fails the PR)

#### Scenario: a drifted lockfile fails frozen-lockfile [static]

- **Given** a PR whose manifest changes are not reflected in the lockfile
- **When** the frozen-lockfile step runs
- **Then** the step fails (the drift is surfaced as a hard error, not silently re-resolved)

#### Scenario: a lag with no hold row fails the freshness step [static]

- **Given** a DIRECT dependency pinned below its latest-mature target with no hold row
- **When** the freshness step runs
- **Then** it exits non-zero naming the package, the installed version and the target

#### Scenario: an unreadable or empty holds table fails closed [static]

- **Given** a holds table from which zero rows parse
- **When** the freshness step runs
- **Then** it exits non-zero rather than reporting zero lags

#### Scenario: the automated updater is configured to pin and group [static]

- **Given** the automated updater's configuration
- **When** it is inspected
- **Then** it pins rather than widening ranges, groups the version-locked families, and is
  catalog-aware (bumps update the catalog entry, not inline manifest specs)
