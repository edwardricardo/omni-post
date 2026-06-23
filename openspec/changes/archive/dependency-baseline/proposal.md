# Proposal: Dependency-Freshness Baseline (catalogs + single-version pin)

## Intent

Runtime errors trace to **version drift**: the same package resolves to ≥2
versions across 94 manifests. Inventory: **13 direct-dep names drift**, **265
packages resolve to ≥2 versions**, **3 wildcards** (`next-intl:*`, `zustand:*`,
`msw:2.x`) pin nothing. Runtime-critical: `@prisma/client` 7.4.1↔7.6.0 (engine
mismatch), `opossum` 8↔9 (breaker invariants, fitness #25), `prom-client`,
`zustand`, `@opentelemetry/api-logs` (5 versions → OTel no-op signals). Single
version is a **global** invariant managed by **per-package** discipline — it does
not scale. Per ADR-0018, this one-time baseline is the **precondition** for the
Implementation-Plan re-validation walk.

## Scope

### In Scope

- pnpm **catalogs** + `catalogMode: strict` + `savePrefix: ""` + **syncpack**.
- 94 manifests → `catalog:`; kill the 3 wildcards (fold at resolved exact).
- Reconcile the 13 drifters (runtime-critical first).
- Per-family latest-stable bumps (atomic families: tiptap+prosemirror,
  googleapis+google-auth+gaxios, `@langchain/*`, react+react-dom, OTel set).
- **CI guard**: `syncpack lint` + `--frozen-lockfile` + `pnpm dedupe --check`;
  Renovate `rangeStrategy: pin` + family grouping + catalog-aware.
- Absorb §7 standing items where they fit: CONCURRENTLY-BUMP (→10.0.3),
  ESBUILD-OVERRIDE, JOI-GHSA-IGNORE, SHELL-QUOTE-OVERRIDE, UNDOCUMENTED-GHSA-IGNORES
  (give each a dated-debt or remove-when gate).

### Out of Scope

- The re-validation **walk** itself (separate, follows this).
- GVS→repo-scoped `turbopack.root` fix (deferred — SMELL-52).
- webpack/turbo dev-memory accommodation (own revert ledger — SMELL-52).

## Capabilities

### New Capabilities

- `dependency-version-management`: catalog as single source of truth, exact-pin +
  latest-stable invariant, syncpack/Renovate CI guard, the per-item freshness gate.

### Modified Capabilities

- None.

## Approach

**Safe rollout — structure before version:**

1. **Structure-only** commit: catalogs at CURRENT versions + syncpack config; 94
   manifests → `catalog:`. Full build/test/27-fitness green. (Isolates structure
   from version change.)
2. Kill the 3 wildcards.
3. Reconcile the 13 drifters (runtime-critical first).
4. Per-family latest-stable bumps, **verify-after-each**, `--frozen-lockfile`
   between families. Updater `taze -l --maturity-period 7`.
5. Final `syncpack lint` + `pnpm dedupe --check` = the pinned baseline.

Chain: **feature-branch-chain** on tracker `workstream/dep-baseline`; per-family
child PRs target the tracker; only the tracker merges to main.

## Affected Areas

| Area                        | Impact   | Description                                                     |
| --------------------------- | -------- | --------------------------------------------------------------- |
| `pnpm-workspace.yaml`       | Modified | Add `catalog:`/`catalogs:`, `catalogMode: strict`.              |
| `package.json` (root)       | Modified | syncpack config; absorb overrides/GHSA gates; `savePrefix: ""`. |
| 94 workspace `package.json` | Modified | dep specs → `catalog:`.                                         |
| `pnpm-lock.yaml`            | Modified | Re-resolved to single versions.                                 |
| `.github/workflows/`        | Modified | syncpack lint + frozen-lockfile + dedupe gate.                  |
| Renovate config             | New      | `rangeStrategy: pin`, family grouping, catalog-aware.           |

## Risks

| Risk                                                              | Likelihood | Mitigation                                                                       |
| ----------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| Drift-hydra: mass-float breaks locked families (bit us on PR #91) | High       | Structure-before-version; atomic families; `--frozen-lockfile` between families. |
| OOM on 9GB box (install/build/test is HEAVY)                      | Med        | Run apply with Edward's dev stack PAUSED.                                        |
| A latest-stable bump introduces a behavioral break                | Med        | Per-family verify-after-each; full fitness/test gate before next family.         |
| Absorbed GHSA/override removal re-opens a CVE                     | Low        | Only remove when upstream is ready; else dated-debt gate.                        |

## Rollback Plan

Per-family child PRs are independent and revertible. Within a family, revert the
single child PR and re-run `--frozen-lockfile`. At the tracker level, the tracker
is the only branch that merges to main — abandoning it leaves main untouched
(feature-branch-chain = atomic rollback). The structure-only commit (step 1) is
upgrade-free, so it can stand alone if a later family must be dropped.

## Dependencies

- ADR-0018 (Accepted) — the canon + mechanism.
- Approved plan `~/.claude/plans/revalidation-dep-baseline.md`.
- pnpm ≥ catalogs support (current `pnpm@10.16.0` qualifies).

## Success Criteria

- [x] Every DIRECT registry dep resolves to exactly ONE version, exact-pinned, latest-stable. (Transitives consumer-governed per ADR-0018.)
- [x] 3 wildcards eliminated; 13 drifters reconciled.
- [x] `syncpack list-mismatches` + `pnpm dedupe --check` green on the tracker.
- [x] CI guard (`syncpack list-mismatches` + `--frozen-lockfile` + `pnpm dedupe --check`) wired + Renovate pin config landed.
- [x] All 27 fitness functions hard-zero; build + LXC-safe tests green.
- [x] §7 standing dep items absorbed or given a dated-debt/remove-when gate.
