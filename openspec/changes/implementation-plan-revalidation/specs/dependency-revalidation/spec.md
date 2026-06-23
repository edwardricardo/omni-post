# Dependency Re-validation Walk — Specification (Phase B per-item gate)

> The END STATE the per-item re-validation walk MUST satisfy for each of the 67
> Implementation-Plan items before it may be re-marked `[x]`. Consistent with the
> ADR-0018 consumer-governed-transitives model. RFC 2119 keywords are normative.

## Requirements

### Requirement: Each item passes the full per-item gate before `[x]`

An item MUST NOT be re-marked `[x]` until it passes, in order: SCOPE →
dep-freshness gate → `pnpm install --frozen-lockfile` + `syncpack list-mismatches`
green → RE-VERIFY (tests + DoD + 0-defect canon + the CONFIRMED §2 caveats for
that item's area) → `[x]`. All 67 items MUST be walked INDIVIDUALLY (no
batch-assert), section-ordered B → Fase 0 → 1 → 2 → 3, honoring `🔗 dep:` and §8.5
(no Fase 3 item re-marked while any Fase 1 item is open). RE-VERIFY runs against
the merged-main tree.

#### Scenario: item re-marked only after green gate

- GIVEN an item under re-validation
- WHEN frozen-lockfile install and syncpack are green AND RE-VERIFY passes
- THEN the item is re-marked `[x]`

#### Scenario: failing RE-VERIFY blocks the mark

- GIVEN an item whose RE-VERIFY (tests, DoD, 0-defect, or a confirmed §2 caveat) fails
- WHEN the walk reaches that item
- THEN the item is NOT re-marked `[x]` and is fixed first

#### Scenario: §8.5 ordering is honored

- GIVEN at least one Fase 1 item still open
- WHEN the walk evaluates a Fase 3 item
- THEN that Fase 3 item is not re-marked `[x]`

### Requirement: Shared deps are asserted equal to the catalog pin, never edited mid-walk

A SHARED dependency (≥2 manifests, a version-locked family, or present in the
catalog) MUST be ASSERTED equal to its catalog pin. If stale, it MUST be logged
as a catalog-bump candidate and validated against the CURRENT pin — never edited
mid-walk. Transitive deps remain consumer-governed (ADR-0018): they MUST NOT be
force-pinned to chase latest; a transitive override is justified only by a real
CVE floor at the minimal patched version.

#### Scenario: shared dep equals the pin

- GIVEN an item that consumes a shared/cataloged dependency
- WHEN the dep-freshness gate runs
- THEN the resolved version is asserted equal to the catalog pin and the gate passes

#### Scenario: stale shared dep becomes a catalog-bump candidate

- GIVEN a shared dep whose latest stable exceeds the catalog pin
- WHEN the gate detects the staleness
- THEN it is logged as a catalog-bump candidate and validated against the CURRENT pin; the catalog is NOT edited during the walk

### Requirement: Private deps may be freshened, contained, before RE-VERIFY

A PRIVATE dependency (one manifest, that item only) MAY be freshened
(`taze` private-only, contained to that item), after which `pnpm install
--frozen-lockfile` + `syncpack list-mismatches` MUST be green before RE-VERIFY.

#### Scenario: private dep freshened then re-verified

- GIVEN an item with a private dep below its latest stable
- WHEN the dep is freshened (contained) and frozen-lockfile install + syncpack pass
- THEN RE-VERIFY proceeds for that item

### Requirement: Catalog-bump candidates drain as one post-walk root PR

Catalog-bump candidates logged during the walk MUST be drained AFTER the walk as
ONE root PR — zero mid-walk catalog edits.

#### Scenario: candidates drained once at the end

- GIVEN catalog-bump candidates accumulated across the walk
- WHEN the walk completes
- THEN they are applied as a single root PR, not piecemeal during the walk
