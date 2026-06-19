# ADR-0018: Dependency-Freshness Canon — latest stable, pinned exact, single version

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: Edward Velasquez, Platform engineering

## Context

Recent sessions surfaced runtime errors traced to **dependency version drift** —
the same package installed at different versions across the ~94 workspace
`package.json`. A static inventory found: **0** open ranges and **0** pre-releases
in deps/devDeps (already disciplined there), but **13 direct-dep names drift**,
**265 packages resolve to ≥2 versions** in the store, and **3 wildcards**
(`next-intl:*`, `zustand:*`, `msw:2.x`) pin nothing. Runtime-critical offenders:
`@prisma/client` (7.4.1 vs 7.6.0 — engine/client mismatch), `opossum` (8 vs 9 —
circuit-breaker invariants, fitness #25), `prom-client`, `zustand`, and
`@opentelemetry/api-logs` (5 versions — the OTel "multiple API instances → no-op
signals" trap). Root cause: single-version is a **global** invariant being managed
by **per-package** discipline, which does not scale across 94 manifests.

A prior mass-update (PR #91) also showed the **drift-hydra**: floating all
transitives at once breaks version-locked families (google-auth/googleapis,
@tiptap, @langchain).

## Decision

**Every registry dependency resolves to exactly ONE version, expressed as an EXACT
pin (no `^ ~ * >= x`), at the LATEST STABLE release (no RC/beta/alpha/next). One
version. Pinned. Fresh. Repo-wide.**

- **Single source of truth**: shared versions live in `pnpm-workspace.yaml`
  **catalogs**; manifests reference `catalog:`. `catalogMode: strict` makes an
  off-catalog `pnpm add` error before CI. `workspace:*` for local packages stays.
- **Latest stable** = the npm `latest` dist-tag (excludes pre-releases). Updater:
  **`taze -l --maturity-period 7`** (7-day buffer against yanked/broken releases);
  `newest`/`greatest`/`--pre` forbidden.
- **Version-locked families move atomically** (tiptap+prosemirror,
  googleapis+google-auth+gaxios, `@langchain/*`, react+react-dom, the OTel set).
- **Consistency enforced** by `syncpack` (exact-range + single-version groups);
  `syncpack lint` is a CI gate.

### Per-item dependency-freshness gate (re-validation walk)

Sited **between SCOPE and RE-VERIFY** of each Implementation-Plan item: shared deps
are **asserted** equal to the catalog pin (never edited mid-walk; staleness logged
as a catalog-bump candidate); private deps (one manifest, that item only) may be
freshened, contained, then `pnpm install --frozen-lockfile` + `syncpack lint`
before RE-VERIFY. Catalog-bump candidates drain after the walk as one root PR.

### CI guard

`syncpack lint` + `pnpm install --frozen-lockfile` + `pnpm dedupe --check` per PR.
Renovate `rangeStrategy: pin` + family grouping + catalog-aware.

## Rationale

Catalogs make duplicate versions structurally un-representable (one edit point);
pinning exact + latest-stable gives reproducibility plus freshness; the per-item
gate weaves freshness into the re-validation pass while strict-catalog + syncpack
make it mechanically impossible for any of the 67 items to re-create drift.

## Alternatives considered

- **Per-package discipline** (status quo) — does not scale; is the current defect.
- **`ncu` instead of `taze`** — no maturity buffer; grabs just-published versions
  in the yank window.
- **Range-based (`^`) deps** — reintroduces drift + non-reproducible installs.
- **stacked-to-main rollout** — no atomic rollback; rejected for the baseline
  (uses feature-branch-chain via tracker `workstream/dep-baseline`).

## Consequences

- A one-time **baseline migration** (94 manifests → catalogs, reconcile 13
  drifters, kill 3 wildcards, per-family latest-stable bumps with
  verify-after-each) ships on `workstream/dep-baseline` before the re-validation
  walk.
- A **universal DoD addendum** on every Implementation-Plan item (the gate above).
- New `syncpack` + Renovate config + the CI guard.

## Revisit if

pnpm catalogs are deprecated, or a better single-version mechanism emerges.

## Risks

The baseline sweep is itself breaking-prone (the drift-hydra). Contained by:
structure-before-version (the catalog-introduction commit is upgrade-free), atomic
families with verify-after-each, and `--frozen-lockfile` between families (a
drifted lockfile becomes a hard failure, not a silent re-resolve).

## References

- Plan: `~/.claude/plans/revalidation-dep-baseline.md`
- Inventory + design: workflow `wf_69bb9921`
- Drift-hydra incident: engram obs 151 (PR #91)
- Consolidated inventory: `docs/product/PENDING_WORK_INVENTORY.md`
