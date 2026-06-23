# Archive Report — dependency-baseline

> Closure record for the `dependency-baseline` SDD change. Archived 2026-06-23.
> Store: openspec. Canon: `docs/technical/ADR-0018-dependency-freshness-canon.md` (Accepted).

## Outcome

The monorepo-wide dependency-freshness baseline is complete and merged to `main`. Every
**DIRECT** registry dependency across the 94 workspace manifests is now sourced from a
single pnpm **catalog** entry (default `catalog:` + the named `catalogs.otel`), exact-pinned
at its **latest stable** release, with `catalogMode: strict` + `save-prefix=""` making a
duplicate version structurally un-representable. The 3 wildcards (`next-intl:*`, `zustand:*`,
`msw:2.x`) are eliminated and the 13 drifters collapsed to one version each.

**The model evolved mid-flight (codified in ADR-0018):** the "single version, latest stable,
pinned" rule governs **DIRECT** deps only. **TRANSITIVE** deps are **consumer-governed** —
pnpm resolves each to the highest version within its consumers' declared ranges, and multiple
versions MAY legitimately coexist. A `pnpm.overrides` entry on a transitive is justified ONLY
by a real CVE floor at the **minimal patched version**, never to chase the latest major (the
"drift-hydra"). Validated empirically: of 6 Step-4 transitive-major overrides, 4 (`diff`,
`fast-uri`, `@xmldom/xmldom`, `protobufjs`) surfaced no advisory and were removed; 2
(`tough-cookie`, `@hono/node-server`) were real CVE floors and kept at the minimal patch.

## Delivered scope

- **Catalogs as single source of truth for direct deps** — default `catalog:` (~34 entries)
  - named `catalogs.otel` (~14 entries); 94 manifests / 411 specs on `catalog:`/`catalog:otel`;
    `catalogMode: strict`; `save-prefix=""` in `.npmrc`.
- **Dual-role overrides reference the catalog** (`"catalog:"` / `"catalog:otel"`), never a
  duplicated literal — the catalog stays the one edit point.
- **Latest-stable direct deps** — per-family atomic bumps (TS 6.0.3, react 19.2.7, OTel 0.219
  line, googleapis 10.7.0/173.0.0, prisma 7.8.0, next-intl 4.13.0, uuid 14.0.0, jsdom 29.1.1,
  @types/node 25.9.3, @tanstack/react-query 5.101.0, @anthropic-ai/sdk 0.104.1, …), resolved
  via a 7-day publish-age filter (the `taze --maturity-period 7` equivalent; pre-releases
  excluded; "never pin lower").
- **Consumer-governed transitives** — transitive-only CVE floors kept in `pnpm.overrides` at
  the minimal patched version; non-CVE transitive-major overrides removed; `pnpm update` ran
  to keep in-range transitives fresh. `pnpm dedupe --check` exits **0** (fully converged).
- **Three documented HOLDs** (sanctioned consumer-governed coexistence, NOT regressions):
  - **vite 7.3.5** for the 2 JSX frontends (`@vitejs/plugin-react@5.1.4` peer-requires vite
    `^4||^5||^6||^7`; the ~83 plain-TS backend packages auto-install vite 8). Vite 8 is a
    coupled frontend-toolchain follow-up.
  - **eslint toolchain transitives** (`minimatch ^3.1.2` consumers) — not force-pinned to
    minimatch 10 / brace-expansion 5 (which removed the callable-default export the eslint
    plugins use); coexistence preserved.
- **CI guard** — the `dependency-consistency` job in `.github/workflows/fitness.yml`:
  `syncpack list-mismatches` + `pnpm install --frozen-lockfile` + `pnpm dedupe --check` (the
  dedupe step uses a single-retry wrapper to absorb the pnpm 10.16 false-positive). Applied
  in commit `07601968` with the `omnipost-allow sensitive-edit` token.
- **Renovate** — `.github/renovate.json`: `rangeStrategy: pin`, `pnpm-catalog` catalog-aware
  manager, family `groupName`s, `minimumReleaseAge: 7 days` (14 for the runtime-critical P0
  set). `dependency-updates.yml` marked `# superseded-by-renovate` (its `pnpm audit` analysis
  job retained).
- **§7 absorptions** — `CONCURRENTLY-BUMP` closed-by-removal; `ESBUILD-OVERRIDE` +
  `SHELL-QUOTE-OVERRIDE` kept with dated-debt/remove-when; 3 ignored GHSAs converted to
  dated-debt lines (2026-06-19) with remove-when; an "Audited audit-ignores" table added to
  `SECURITY_CANON.md` (fitness #24 hard-zero preserved).

## Capabilities / specs applied

The change's delta spec was folded into the cumulative living specification, reflecting the
EVOLVED consumer-governed-transitives model (NOT the original blanket "single version for
everything" wording):

- `dependency-version-management` → `openspec/specs/dependency-version-management/spec.md`
  (NEW capability — created at archive time; no prior main spec existed).

## Task completion / reconciliation

All 47 tasks (`T0.1`–`T5.11`) are `[x]`. At archive time, stale per-task markers were
reconciled to `[x]` — the work was applied + merged but the markers lagged actual execution:

- **Steps 2 + 3 were ABSORBED** — T1.12 folded the 3 wildcards in Step 1; the 13 drifters
  reconciled UP in Step 1's catalog migration; the latest bumps landed in Step 4. The Step 2/3
  tasks were verification-only by the time they would have run.
- **T5.2 / T5.3 were guard-blocked** (`.github/workflows/` sensitive path) then applied with
  the `sensitive-edit` token in commit `07601968`.
- **T4.10 (vite)** is a resolved consumer-governed HOLD, not incomplete work.

Reconciliation is backed by `apply-progress.md` + the PR #95 merge (every closed task carries
a per-task `_DONE …_` annotation with its commit/proof). This is the exceptional
archive-time stale-checkbox reconciliation the gentle-ai archive policy permits when
apply-progress + the merge prove completion.

## Verification status (no separate verify-report)

No `sdd-verify` report exists in Engram or openspec for this change. The change was validated
through its CI gate instead: the final tracker→main PR #95 merged with **all required checks
green** — the new `dependency-consistency` job, the 27 fitness functions (hard-zero each), and
build/test/typecheck. There are **no CRITICAL verification issues** blocking archive. The
deterministic invariant subset (`syncpack list-mismatches` exit 0, `--frozen-lockfile` exit 0,
`dedupe --check` exit 0, `audit --audit-level moderate` exit 0, 27 fitness hard-zero) was also
confirmed locally. The orchestrator explicitly authorized this archive on the basis of the
merge.

## Merge reference

- PR: **#95** (tracker→main, merged)
- Merge commit: **`552c63a9`**
- Tracker branch: `workstream/dep-baseline` (feature-branch-chain; only the tracker merged to
  main — atomic rollback boundary preserved)
- Date archived: **2026-06-23**

## Follow-up

- **vite 8 upgrade** — coupled frontend-toolchain decision (bump `@vitejs/plugin-react` to a
  vite-8 major + Storybook's vite plugin); tracked as a follow-up, NOT part of this baseline.
- **The re-validation WALK** — the per-item dependency-freshness gate across the
  Implementation-Plan items (ADR-0018 §Per-item gate); this baseline was its precondition.
