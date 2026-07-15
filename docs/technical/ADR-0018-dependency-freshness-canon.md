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

**Every DIRECT registry dependency resolves to exactly ONE version, expressed as an
EXACT pin (no `^ ~ * >= x`), at the LATEST STABLE release (no RC/beta/alpha/next).
One version. Pinned. Fresh. — TRANSITIVE deps are consumer-governed (highest
in-range; multiple versions may coexist), NOT force-pinned; see the transitive
policy below.**

> **Config-location update (ADR-0019, 2026-07-15).** This ADR placed the
> `pnpm.overrides` block, `pnpm.auditConfig.ignoreGhsas`, and
> `patchedDependencies` in the root `package.json` `pnpm` field. As of the
> **pnpm 10.16.0 → 11.13.0 migration**, pnpm 11 no longer reads the `pnpm` field
> in `package.json`, so all three moved **verbatim** into `pnpm-workspace.yaml`
> (alongside the catalogs). Every reference below to `pnpm.overrides` /
> `auditConfig` "in root `package.json`" now resolves to `pnpm-workspace.yaml`.
> The _content_ (single-version invariant, exact pins, CVE-floor policy) is
> unchanged; only the file home moved. See
> `docs/technical/ADR-0019-pnpm-11-migration.md`.

- **Single source of truth**: shared versions live in `pnpm-workspace.yaml`
  **catalogs**; manifests reference `catalog:`. `catalogMode: strict` makes an
  off-catalog `pnpm add` error before CI. `workspace:*` for local packages stays.
- **Dual-role packages reference the catalog from the override** — a package that
  is BOTH a direct dependency (declared in ≥1 manifest, so it has a catalog entry)
  AND must be force-pinned onto transitive copies (so it also needs a
  `pnpm.overrides` entry) keeps **both** entries, but the override **REFERENCES the
  catalog** via the `catalog:` protocol (`"catalog:"` for the default catalog,
  `"catalog:<name>"` for a named one) instead of duplicating the literal version.
  pnpm resolves `catalog:` inside `pnpm.overrides` (see pnpm.io/catalogs +
  pnpm.io/settings), so the catalog stays the single source of truth and the
  override merely extends that one value to the transitive subtree. **Never
  duplicate the literal version across the catalog and the override** — two literal
  copies are a drift hazard the catalog exists to eliminate. A transitive-only pin
  (no direct declaration anywhere) has no catalog entry and stays a literal in
  `pnpm.overrides`; a scoped/nested selector (`pkg@major`, `parent>child`) also
  stays a literal because the catalog cannot express the selector.
- **Latest stable** = the npm `latest` dist-tag (excludes pre-releases). Updater:
  **`taze -l --maturity-period 7`** (7-day buffer against yanked/broken releases);
  `newest`/`greatest`/`--pre` forbidden.
- **Version-locked families move atomically** (tiptap+prosemirror,
  googleapis+google-auth+gaxios, `@langchain/*`, react+react-dom, the OTel set).
- **Consistency enforced** by `syncpack` (exact-range + single-version groups);
  `syncpack lint` is a CI gate.
- **Transitive deps are consumer-governed — never force-pinned to chase latest.**
  The "one version / latest / repo-wide" rule above governs **direct** deps (the
  ones we declare). A **transitive** dep (no direct declaration; pulled in by a
  package we consume) is left to its consumers' declared ranges — pnpm resolves
  each to the highest in-range version, and multiple versions may legitimately
  coexist. **Do NOT add a `pnpm.overrides` entry to force the latest major of a
  transitive:** forcing a major a consumer's range does not allow breaks consumers
  that have not migrated to the new API — the **"drift-hydra"**. (Concrete: Step 4
  forced `minimatch` 10 + `brace-expansion` 5, both of which removed the
  callable-default export the eslint toolchain still uses —
  `eslint-plugin-jsx-a11y@6.10.2` + `eslint-plugin-react@7.37.5`, both at latest,
  both declaring `minimatch ^3.1.2` — crashing `pnpm lint` while build/test/typecheck
  passed.) A transitive override is justified ONLY by a real **CVE floor** — a
  vulnerability that `pnpm audit` confirms would otherwise resolve through a
  consumer's range — and is set to the **minimal patched version** (lowest secure
  version compatible with the consumers), never the absolute-latest major.
  **Method (empirical):** remove the override → `pnpm install` → `pnpm audit`; if
  no advisory surfaces it was de-dup-only → keep it removed; if an advisory
  surfaces → re-add at the minimal patched floor. To keep in-range transitives
  fresh, run **`pnpm update`** (bumps to highest-in-range; never out of range).
  (Validated 2026-06-22: of 6 Step-4 transitive-major overrides, 4 — `diff`,
  `fast-uri`, `@xmldom/xmldom`, `protobufjs` — surfaced no advisory and were
  removed; 2 — `tough-cookie` and `@hono/node-server` — were real CVE floors and
  kept at the minimal patch, 4.1.3 and 1.19.13.)

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
- Config-location reversal (pnpm 11): `docs/technical/ADR-0019-pnpm-11-migration.md`
