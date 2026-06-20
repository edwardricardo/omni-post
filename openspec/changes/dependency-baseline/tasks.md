# Tasks: Dependency-Freshness Baseline

> **Phase:** SDD tasks (the ordered WHAT-to-do). **Change:** `dependency-baseline`.
> **Store:** openspec. **Canon:** ADR-0018 (Accepted).
> **Reads (DAG-gated):** `specs/dependency-version-management/spec.md` (8 reqs, 26 scenarios) + `design.md` (override table + 5 steps + 6 flagged items).
>
> **Delivery:** feature-branch-chain. **Tracker:** `workstream/dep-baseline` (only the
> tracker merges to main). Each step = one or more **child PR(s)** targeting the
> tracker; later child PRs target the immediate previous PR branch so review diffs
> stay focused.
>
> **TDD posture (config/dependency-dominant change):** STRICT TDD is active
> (`openspec/config.yaml strict_tdd: true`), but this change touches catalogs,
> manifests, lockfile, and CI — not production TS. The RED→GREEN bar per step is the
> set of **deterministic gates** (`syncpack lint`, `pnpm dedupe --check`,
> `pnpm install --frozen-lockfile`) plus the **existing suite** + the **27 CI fitness
> functions** staying green, exactly as the `dev-prod-resolution-model` change ran.
> A task's RED state = the gate currently fails or is absent; GREEN = the gate passes.
>
> **Fitness count (reconciled):** **27** numbered functions (#1–#27), wired
> identically in `CLAUDE.md §Automated Compliance Checks` and
> `.github/workflows/fitness.yml`. The spec text "24 fitness functions" is **stale**
> (predates #25 circuit-breaker, #26 `.js`-on-`.ts` frontend guard, #27
> dev-prod-resolution-model). All tasks below assert **27 hard-zero**, and a
> follow-up task corrects the spec wording.
>
> **9GB-box / OOM rule:** every task tagged **[PAUSE-STACK]** requires Edward's dev
> stack (`pnpm dev` / Next dev / workers) PAUSED before running, because it runs a
> 90-manifest `pnpm install`, a full build, or the test suite on the 9GB homelab box
> (proposal §Risks). Tasks NOT tagged are pure file edits (no install/build/test) and
> are OOM-safe.
>
> **Conventions:** conventional commits, NO AI attribution. Each task DoD names the
> gate that proves it.

---

## Step 0 — Tracker bootstrap (no child PR; preparation)

- [ ] **T0.1** Create the feature-branch-chain tracker branch `workstream/dep-baseline` off `main`; push it as the integration target. **DoD:** branch exists on origin; branch-protection requires the `dependency-consistency` check (added in Step 5) once wired. _OOM-safe._
- [ ] **T0.2** Confirm the installed pnpm supports `catalog:` inside `peerDependencies` (design §1.3 / Risk row): run a 1-package smoke (`catalog:` ref on one peerDep, `pnpm install` on that pkg only) BEFORE the 90-manifest sweep. **DoD:** smoke install resolves the `catalog:` peer with no error (Req "Catalogs are the single source", off-catalog/peer support). _[PAUSE-STACK]_ (runs `pnpm install`).

---

## Step 1 — Structure-only (child PR `dep-baseline/01-structure`)

> Catalogs at **CURRENT** resolved versions + syncpack config + 90 manifests →
> `catalog:`. **Upgrade-free — assert NO version drops.** This is the highest-risk
> relocation (the override-forces-newer downgrade trap). Maps spec scenarios:
> "structure-only step is upgrade-free and green on its own", "catalogMode is strict",
> "shared direct deps reference the catalog", "savePrefix forces exact", "workspace
> protocol specs are not flagged".

### 1.A Catalog scaffolding (file edits, OOM-safe)

- [x] **T1.1** Add `catalogMode: strict` to `pnpm-workspace.yaml`. **DoD:** spec scenario "catalogMode is strict [static]" — the key is present. File: `pnpm-workspace.yaml`. _OOM-safe._
- [x] **T1.2** Add `save-prefix=""` to root `.npmrc` (pnpm reads savePrefix from npmrc, NOT pnpm-workspace.yaml — design §1.4). **DoD:** spec scenario "savePrefix forces exact on future adds [static]". File: `.npmrc`. _OOM-safe._
- [x] **T1.3** Author the **default `catalog:`** block in `pnpm-workspace.yaml` at the CURRENT resolved versions (the §1.1 shape), with version-locked **grouping comments** for react / tiptap / langchain / googleapis families. **DoD:** every DIRECT-classified name from design §2.1 has a catalog entry. File: `pnpm-workspace.yaml`. _OOM-safe._
  - [x] **T1.3.a (FLAGGED — override-forces-newer)** For `@langchain/core`, `@langchain/langgraph`, `fastify`, `cloudinary`, `handlebars`, set the catalog pin to the **override (newer)** value, NOT the stale manifest value (design §1.1 note + §8 Risk row 1). Adopting the manifest value here would silently DOWNGRADE on override removal. **DoD:** catalog carries `@langchain/core 1.2.0`, `@langchain/langgraph 1.4.4`, `fastify 5.8.5`, `cloudinary 2.7.0`, `handlebars 4.7.9`. _DONE — all 5 at override-newer; no-downgrade guard (T1.13) confirmed 0 drops._
  - [x] **T1.3.b (FLAGGED — dompurify classification)** Re-grep `"dompurify":` across all 90 manifests at apply time (design §2.1 note + §8 Risk row 2). If ≥1 direct declaration → catalog entry; if 0 → leave in `pnpm.overrides` (do NOT catalog). **DoD:** decision recorded in the PR description; `dompurify` lands in exactly one of catalog/overrides per the grep result. _DECISION: 0 direct declarations (only `isomorphic-dompurify` in apps/api). `dompurify` STAYS in `pnpm.overrides` (3.4.11), NOT cataloged._
- [x] **T1.4** Author the **named `catalogs.otel`** block at CURRENT resolved versions (design §1.1), adopting the **override (newer)** OTel values for `@opentelemetry/auto-instrumentations-node` (0.75.0), `core` (2.8.0), `exporter-prometheus` (0.217.0), `sdk-node` (0.217.0). **DoD (FLAGGED — OTel override-is-the-bump, §8 Risk row 1):** catalog adopts the newer override values so override removal does not downgrade; spec scenario "each locked family resolves to a single compatible set". File: `pnpm-workspace.yaml`. _DONE — the 4 override-forced names at newer values; the non-override OTel names kept at manifest-current (structure-only: full OTel transitive dedupe deferred to Step 3 T3.5 override)._

### 1.B Override block surgery (file edits, OOM-safe)

- [x] **T1.5** Remove the **DIRECT** names migrated to the catalog from root `pnpm.overrides` (design §2.1 list). **DoD:** every §2.1 DIRECT name is absent from `pnpm.overrides` and present in a catalog. File: root `package.json`. _DONE — 26 DIRECT names removed from overrides._
- [x] **T1.6** Keep the **TRANSITIVE-only** overrides verbatim (design §2.2 list, ~34 entries). **DoD:** spec scenario "transitive-only CVE pins live in overrides, not catalogs [static]" — each §2.2 name still under `pnpm.overrides`, none in a catalog. File: root `package.json`. _DONE — all transitive pins kept; `fast-xml-parser` + `dompurify` reclassified TRANSITIVE (0 decls) and KEPT in overrides._
- [x] **T1.7 (SPLIT 1/3 — dual-role `google-auth-library`)** Catalog the DIRECT `google-auth-library: 9.14.1` (youtube) AND keep the scoped `"google-auth-library@10": "10.3.0"` in `pnpm.overrides` (design §2.3 / D3). **DoD:** catalog has 9.x; overrides retains `@10` selector. Files: `pnpm-workspace.yaml`, root `package.json`. _DONE._
- [x] **T1.8 (SPLIT 2/3 — `gaxios@7`)** Keep `"gaxios@7": "7.1.4"` in `pnpm.overrides` (NOT declared → overrides only, design §2.3). **DoD:** `gaxios@7` selector present in overrides, absent from catalog. File: root `package.json`. _DONE._
- [x] **T1.9 (SPLIT 3/3 — `msw>path-to-regexp`, load-bearing)** Keep `"msw>path-to-regexp": "6.3.0"` verbatim in `pnpm.overrides` (nested selector, NO catalog equivalent — design §2.3 + §8 Risk row 4). Dropping it breaks msw resolution. **DoD:** nested selector present verbatim; `--frozen-lockfile` (T1.13) catches any msw resolution break. File: root `package.json`. _DONE — verbatim; lockfile keeps path-to-regexp 6.3.0 (under msw) + 8.4.0 (top-level)._
- [x] **T1.10 (FLAGGED — CVE-floor packages, D4)** Catalog `axios 1.17.0`, `form-data 4.0.6`, `validator 13.15.22`, `ws`, `fast-xml-parser 5.7.0` at the CVE-floor version with an inline `# CVE floor` comment; remove their override. **DoD:** each lands in catalog ≥ floor; override removed; `SECURITY_CANON` note tracked in Step 5 (T5.8). File: `pnpm-workspace.yaml`, root `package.json`. _DONE for axios/form-data/validator/ws (DIRECT → catalog @floor, override removed). DEVIATION: `fast-xml-parser` has 0 direct declarations (same as dompurify) → kept in `pnpm.overrides` at 5.7.0 (CVE floor), NOT cataloged. CVE-floor `# CVE floor` comments present in catalog._

### 1.C Manifest sweep (file edits, OOM-safe)

- [x] **T1.11** Rewrite every DIRECT spec across the 90 manifests to `catalog:` (default) or `catalog:otel` (OTel set) per design §1.2. Leave `workspace:*` specs untouched. **DoD:** spec scenarios "shared direct deps reference the catalog, not inline versions [static]" + "workspace protocol specs are not flagged as ranges [static]". Files: 90 `package.json`. _DONE — 94 manifests (incl. root), 411 specs rewritten to catalog:/catalog:otel; 0 leftover inline catalog-managed specs; workspace:\* untouched._
- [x] **T1.12** Rewrite the 3 wildcard **peerDependencies** to `catalog:` refs (`next-intl`, `zustand` in `@shared/types`; `msw` in `@providers/shared`), keeping `peerDependenciesMeta.optional` flags as-is (design §1.3). NOTE: this is the structural rewrite; the resolved-exact fold is asserted in Step 2. **DoD:** the 3 peerDep specs read `catalog:`. Files: `@shared/types/package.json`, `@providers/shared/package.json`. _DONE — next-intl/zustand (packages/shared) + msw (providers/shared) peerDeps → catalog:; also folded react ^19.0.0 peerDep (browser-logger, query-client) + @tanstack/react-query ^5.0.0 peerDep (query-client)._

### 1.D Verify gate (build/test/install — PAUSE-STACK)

- [x] **T1.13 [PAUSE-STACK]** Run `pnpm install`; assert the lockfile re-resolves with **NO version DROP** vs the pre-edit lockfile (diff review per §8 Risk row 1 — the downgrade trap). **DoD:** lockfile diff shows only `catalog:` relocations, zero downgrades. _DONE — `pnpm install` succeeded; per-name max-version diff vs HEAD lockfile = **0 downgrades** (CRITICAL PASS). Reconcile-UP increases only: zod 4.3.6→4.4.3, postcss 8.5.10→8.5.15, @prisma/client 7.4.1→7.6.0, opossum 8.0.0→9.0.0, zustand 5.0.11→5.0.12, @types/node 22→24 (3 pkgs). `--frozen-lockfile` exits 0 (no drift)._
- [~] **T1.14 [PAUSE-STACK]** Run `syncpack lint` (single-version + exact-range groups) + `pnpm dedupe --check`. **DoD:** spec scenarios "syncpack single-version group passes" + "syncpack exact-range group passes" + "pnpm dedupe reports nothing" — all exit 0. (Requires the `.syncpackrc.json` from T5.1 to exist; if Step 5 config not yet landed, run with a temporary local config and finalize in Step 5.) _PARTIAL: `.syncpackrc.json` authored (design §5.1 shape). `syncpack@12 list-mismatches` exits **0** (single-version + exact-range BOTH clean: 603 valid, 427 workspace ignored, 0 mismatches). `pnpm dedupe --check` exits **1** — remaining duplicates are PRE-EXISTING transitive fragmentation (verified same multi-versions on HEAD: @types/pg, acorn, hash-base, @typescript-eslint internals, OTel @opentelemetry/resources/instrumentation/\* pulled by @sentry/langsmith) that catalogs CANNOT collapse (catalogs bind only DIRECT decls). Full dedupe clean is the END-STATE (post Step 3 T3.5 OTel override + Step 4 family bumps), per spec semantics. Note: `syncpack lint` (vs list-mismatches) also runs a key-format check that flags files — that is a syncpack format opinion, NOT the ADR-0018 version/range invariant; tune in Step 5 T5.1 (add formatGroups or use list-mismatches semantics in the CI step)._
- [~] **T1.15 [PAUSE-STACK]** Run the full build + LXC-safe test suites + the **27 fitness functions**. **DoD:** spec scenario "structure-only step is upgrade-free and green on its own [runtime]" — build succeeds, tests green, 27 fitness hard-zero. _PARTIAL: **27 fitness functions = hard-zero (PASS)** — catalog migration introduced 0 fitness regressions (touches only package.json/yaml/npmrc, no TS). Full build + test suites NOT run locally per LXC-safety rule (the 9GB box) — that is the child PR's CI job (build/test/typecheck on push)._

---

## Step 1b — Dual-role overrides reference the catalog (child PR `dep-baseline/01b-override-catalog-refs`)

> Lands AFTER `01-structure`, BEFORE `02-wildcards`. Best-practice fix (Edward):
> the 10 dual-role security packages were re-added to `pnpm.overrides` as LITERAL
> versions in `01-structure` (commit `98981d78`), duplicating the catalog value —
> two sources of truth, a drift hazard. pnpm resolves `catalog:` inside
> `pnpm.overrides` (pnpm.io/catalogs + pnpm.io/settings), so convert each literal
> to a catalog reference. Resolution-neutral by construction (catalog value ==
> the literal replaced) → lockfile MUST stay byte-identical. Maps spec scenarios
> "catalog single source of truth [static]" + "transitive security pins stay in
> overrides [static]" (now via `catalog:` ref, not a duplicated literal).

- [x] **T1b.1** Convert the 6 default-catalog dual-role overrides in root `pnpm.overrides` from literals to `"catalog:"`: `axios`, `form-data`, `validator`, `uuid`, `ws`, `postcss`. **DoD:** each override reads `"catalog:"`; catalog pin unchanged. File: root `package.json`. _OOM-safe._ _DONE._
- [x] **T1b.2** Convert the 4 OTel dual-role overrides to `"catalog:otel"`: `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/core`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/sdk-node`. **DoD:** each override reads `"catalog:otel"`; `catalogs.otel` pin unchanged. File: root `package.json`. _OOM-safe._ _DONE._
- [x] **T1b.3** Leave ALL other overrides UNCHANGED — transitive-only literals (`shell-quote`, `esbuild`, `lodash`, `qs`, `dompurify`, `fast-xml-parser`, …) and scoped/nested selectors (`gaxios@7`, `google-auth-library@10`, `msw>path-to-regexp`) stay as literals (no catalog entry to reference). **DoD:** the §2.2 + §2.3 entries are byte-for-byte identical to HEAD. File: root `package.json`. _OOM-safe._ _DONE._
- [x] **T1b.4 [PAUSE-STACK]** Run `pnpm install`; assert the lockfile is **byte-identical** to pre-edit (no version moved — any move is STOP-and-report). **DoD:** `sha256sum` + `diff` show no change; `git diff --stat pnpm-lock.yaml` empty. _DONE — hash identical (`cf246d4b…`), diff NO_DIFF; pnpm reported "Lockfile is up to date, resolution step is skipped"._
- [x] **T1b.5 [PAUSE-STACK]** Run the CLI gates: `pnpm install --frozen-lockfile` (exit 0), `pnpm audit --audit-level moderate` (exit 0 — floors preserved via catalog, configured GHSAs ignored), `syncpack list-mismatches` (exit 0), 27 fitness greps (hard-zero). **DoD:** all gates green. _DONE — frozen exit 0; audit exit 0 (2 vulns both ignored); syncpack 603 valid exit 0; 27 fitness hard-zero. `lint-semver-ranges` UnsupportedMismatch count unchanged vs HEAD (pre-existing catalog-protocol tooling limitation, not introduced here)._
- [x] **T1b.6** Codify the dual-role pattern in docs: ADR-0018 (override REFERENCES the catalog — single source of truth, never duplicate the literal) + design.md §2.1.a + step table row 1b. **DoD:** both docs updated. _DONE._

---

## Step 2 — Kill the 3 wildcards + fold at resolved-exact (child PR `dep-baseline/02-wildcards`)

> Maps spec scenarios "the three wildcards are eliminated [static]" + "no pre-release
> identifiers". If T1.12 already folded the wildcards to exact catalog values in
> Step 1, this step degenerates to a verification PR; otherwise it performs the fold.

- [ ] **T2.1** Confirm `next-intl` is folded at `4.9.2` in the catalog (resolves admin 4.9.0 / client 4.9.2 drift — design §1.3 table). **DoD:** catalog `next-intl: 4.9.2`; no `*` remains in any manifest. File: `pnpm-workspace.yaml`. _OOM-safe._
- [ ] **T2.2** Confirm `zustand` is folded at `5.0.12` (newer of admin 5.0.11 / client 5.0.12). **DoD:** catalog `zustand: 5.0.12`; no `*` remains. File: `pnpm-workspace.yaml`. _OOM-safe._
- [ ] **T2.3** Confirm `msw` is folded at `2.14.3` (was `2.x` wildcard). **DoD:** catalog `msw: 2.14.3`; no `2.x` range remains. File: `pnpm-workspace.yaml`. _OOM-safe._
- [ ] **T2.4 [PAUSE-STACK]** Run `syncpack lint` + `pnpm install --frozen-lockfile`. **DoD:** spec scenario "the three wildcards are eliminated [static]" passes; frozen-lockfile exits 0 (no drift). _Runs CLI gates on the 9GB box._

---

## Step 3 — Reconcile the 13 drifters (child PR `dep-baseline/03-reconcile`)

> Runtime-critical first (design §3 table). Each drifter is set to its single target in
> the catalog, then `--frozen-lockfile` + `syncpack lint` before the next group. Maps
> spec scenarios "each previously drifting name resolves once in the lockfile" +
> "react and react-dom share one version" (single-version invariant).

### 3.A Runtime-critical P0 (catalog edits)

- [ ] **T3.1** `@prisma/client` → **7.6.0** (resolves db-prisma 7.4.1 ↔ api/infra 7.6.0; engine/client match). **DoD:** catalog `@prisma/client: 7.6.0`; lockfile resolves once. File: `pnpm-workspace.yaml`. _OOM-safe edit._
- [ ] **T3.2** `opossum` → **9.0.0** (resolves external-apis 8.0.0 ↔ db-prisma/queue 9.0.0; circuit-breaker invariants + **fitness #25**). **DoD:** catalog `opossum: 9.0.0`; lockfile resolves once. File: `pnpm-workspace.yaml`. _OOM-safe edit._
- [ ] **T3.3** `prom-client` → **15.1.3** (resolves 15.0.0 ↔ 15.1.3). **DoD:** catalog `prom-client: 15.1.3`. File: `pnpm-workspace.yaml`. _OOM-safe edit._
- [ ] **T3.4** `zustand` → **5.0.12** (already folded in Step 2; assert single). **DoD:** lockfile resolves `zustand` once. _OOM-safe edit._
- [x] **T3.5** OTel transitive dedupe via **`pnpm.overrides`** (design §2.4). _DONE (Step 4 slice). DEVIATION: `@opentelemetry/api-logs` is GONE from the store (0 versions) — the OTel family bump to a uniform 0.219.0/2.8.0 line already collapsed the 5-version split, so the planned `@opentelemetry/api-logs` override is no longer needed. The residual transitive split was instead in `@opentelemetry/instrumentation` (5 versions: 0.207/0.212/0.213/0.214/0.219, pulled by @sentry/node-core + @fastify/otel), `@opentelemetry/resources` (2.6.1/2.8.0), `@opentelemetry/semantic-conventions` (1.40.0/1.41.1). Added 3 `pnpm.overrides` entries → `catalog:otel` (single source of truth): all three collapse to ONE version (instrumentation 0.219.0, resources 2.8.0, semantic-conventions 1.41.1). Commit `193c223f`. After a `pnpm dedupe` flatten (commit `62e12284`), `pnpm dedupe --check` exits **0** (fully converged)._

### 3.B Remaining drifters (catalog edits)

- [ ] **T3.6** `vitest` → **4.1.8** (resolves 4.0.18 ↔ 4.1.8). **DoD:** catalog `vitest: 4.1.8`. _OOM-safe edit._
- [ ] **T3.7 (FLAGGED — zod direction)** `zod` → **4.4.3** (the override pins STALE 4.3.6 while apps declare 4.4.3 — reconcile **UP** to the apps' newer value, opposite direction from OTel; design §3 note). `api-common` (4.3.6 laggard) bumps with the rest. **DoD:** catalog `zod: 4.4.3`; override removed. File: `pnpm-workspace.yaml`, root `package.json`. _OOM-safe edit._
- [ ] **T3.8** `next-intl` → **4.9.2** (asserted in Step 2; confirm single). **DoD:** lockfile resolves once. _OOM-safe edit._
- [ ] **T3.9** `postcss` → **8.5.14** (override 8.5.10 STALE vs decl 8.5.14 — adopt newer). **DoD:** catalog `postcss: 8.5.14`; override removed. _OOM-safe edit._
- [ ] **T3.10** `uuid` → **13.0.1** (resolves api/workers/dlq 13.0.0 ↔ override 13.0.1). **DoD:** catalog `uuid: 13.0.1`. _OOM-safe edit._
- [ ] **T3.11** `validator` → **13.15.22** (CVE floor wins over api 13.15.15 — folded with T1.10). **DoD:** catalog `validator: 13.15.22`. _OOM-safe edit._
- [ ] **T3.12** `@langchain/core` → **1.2.0** + `@langchain/langgraph` → **1.4.4** (LLM family lock; adopt override-newer per T1.3.a). **DoD:** both catalog pins set; family moves atomically. _OOM-safe edit._

### 3.C Verify gate (build/test/install — PAUSE-STACK)

- [ ] **T3.13 [PAUSE-STACK] (FLAGGED — zod peer)** Assert `fastify-type-provider-zod@6.1.0` accepts zod 4.4.x (design §3 note + §8 Risk row 5). **DoD:** full API integration tier passes with zod 4.4.3. _Runs integration tests._
- [ ] **T3.14 [PAUSE-STACK]** Run build + LXC-safe tests + `pnpm dedupe --check` + 27 fitness. **DoD:** spec scenarios "each previously drifting name resolves once [static]" + "build and tests stay green after the baseline [runtime]"; dedupe exits 0; 27 fitness hard-zero. _Full build/test on the 9GB box._

---

## Step 4 — Per-family latest-stable bumps (8 child PRs `dep-baseline/04*`)

> Updater: `taze -l --maturity-period 7` (7-day yank buffer; `newest`/`greatest`/`--pre`
> forbidden per ADR-0018). **One child PR per family, atomic** (all siblings or none),
> `--frozen-lockfile` BETWEEN families, **verify-after-each = full fitness/test/build
> gate before the next family.** Maps spec Requirement "Version-locked families move
> atomically" + "Pinned versions are the latest stable release, with no pre-releases".
> Lowest blast-radius first; runtime-critical (`04g`) lands LAST.

> **Step 4 execution note (this slice):** done as per-family work-unit commits on the tracker (not separate child-PR branches) per the apply slice prompt. `taze` cannot read pnpm catalogs (every spec is `catalog:`, no literal for taze to scan), so latest-stable was resolved via `npm view <pkg> time --json` + a 7-day publish-age filter (the `--maturity-period 7` equivalent; pre-releases excluded). Light-verify per family (LXC-safe): `pnpm install --frozen-lockfile` exit 0 + `pnpm audit --audit-level moderate` exit 0 + 27 fitness greps hard-zero. Full build/test deferred to CI (MAJOR-bump breaks surface there, per Edward's evaluate-after-break rule). **Convention applied: ALWAYS latest stable, never pin lower** — when current catalog value already exceeded the 7d candidate, current was kept (langchain, tiptap, dompurify).

- [x] **T4.1** `04a-toolchain` — `typescript` 5.9.3→**6.0.3** (MAJOR; commit `2c25d76c`). `vitest` kept 4.1.8 (4.1.9 <7d), `tsx` kept 4.22.4 (latest). `eslint*`/`prettier` are root literals NOT in the catalog — out of this catalog-scoped slice. `@types/node` 24.5.2→**25.9.3** (MAJOR) + `jsdom` 26.0.0→**29.1.1** (MAJOR) in commit `58f01d73`. _Light-verify PASS each._
- [x] **T4.2** `04b-otel` — whole `catalogs.otel` set → latest stable, atomic (commit `725c8363`): auto-instrumentations-node 0.75→0.77, exporter-prometheus/sdk-node/exporter-trace-otlp-http/instrumentation/instrumentation-http 0.214→**0.219**, instrumentation-fs 0.33→0.38, instrumentation-redis 0.62→0.67, propagation-utils 0.31.17→0.31.22, resources 2.6.1→**2.8.0**, semantic-conventions 1.40→**1.41.1**. api/core/instrumentation-fastify already latest. _Light-verify PASS._
- [x] **T4.3** `04c-react` — `react`/`react-dom` 19.2.4→**19.2.7**, `@types/react` 19.2.14→**19.2.17**, `@types/react-dom` already 19.2.3 (latest). Atomic (commit `08e662b6`). _Light-verify PASS._
- [x] **T4.4** `04d-tiptap` — ALREADY at latest stable. Catalog holds `@tiptap/* 3.27.1` = the absolute latest dist-tag; the 7d-buffer candidate is 3.26.1 (older) → keeping current honors "never pin lower." No `prosemirror-*` packages exist in the workspace (only the bundled `@tiptap/pm`). No bump, no commit needed.
- [x] **T4.5** `04e-langchain` — ALREADY at latest stable. Catalog holds `@langchain/core 1.2.0` + `@langchain/langgraph 1.4.4` = the absolute latest dist-tags; the 7d-buffer candidates (1.1.49 / 1.4.2) are OLDER → keeping current honors "never pin lower." No bump, no commit.
- [x] **T4.6** `04f-googleapis` — `google-auth-library` catalog 9.14.1→**10.7.0** (MAJOR 9→10), `googleapis` 160.0.0→**173.0.0**; scoped overrides bumped in lockstep: `gaxios@7` 7.1.4→7.1.5, `google-auth-library@10` 10.3.0→10.7.0, `googleapis-common` 8.0.0→8.0.2 (commit `08f4f6d9`). _Light-verify PASS; `gaxios@7` selector still resolves a distinct 7.x._ FLAG: catalog g-a-l moved to the 10.x major (was 9.x per design D3) per Edward's "always latest stable"; youtube declares `catalog:` (no hard 9.x constraint in its manifest), so this is consistent with the convention. The 9.x line still appears transitively (via `@google-cloud/storage`) at 9.15.1 after dedupe.
- [x] **T4.7** `04g-runtime` — `@prisma/client` 7.6.0→**7.8.0** (+ `prisma` CLI in lockstep, commit `b1cce35a`). `opossum` (9.0.0), `prom-client` (15.1.3), `fastify` (5.8.5), `pino` (10.3.1) ALL already at latest stable — no bump. `bullmq`/`ioredis` are NOT catalog entries (root/app literals) — out of this catalog-scoped slice. fitness greps hard-zero (#25 unaffected). _Light-verify PASS._
- [x] **T4.8** `04h-misc` — `next` 16.2.6→16.2.9 + `next-intl` 4.9.2→**4.13.0** (commit `4681bcb7`); `msw` 2.14.3→2.14.6 (commit `1ae74eae`); `zustand` 5.0.12→5.0.14 + `@tanstack/react-query` 5.95.0→**5.101.0** (commit `80627448`); `@anthropic-ai/sdk` 0.91.1→**0.104.1** + `cloudinary` 2.7.0→2.10.0 (commit `9ab44e82`); `validator` 13.15.22→13.15.35 + `uuid` 13.0.1→**14.0.0** (MAJOR, commit `1b00b94d`). `zod` (4.4.3), `handlebars` (4.7.9), `postcss` (8.5.15), `axios` (1.17.0; 1.18.0 <7d), `form-data` (4.0.6), `ws` (8.21.0) ALL already at latest stable. _Light-verify PASS each._

#### Transitive-only security overrides (bumped this slice — task scope)

- [x] **T4.9** Transitive `pnpm.overrides` → latest stable. Bumped (commit `067c0f92` + `45b4eb0c`): `@babel/plugin-transform-modules-systemjs` 7.29.4→7.29.7, `@smithy/config-resolver` 4.4.0→4.5.7, `defu` 6.1.5→6.1.7, `fast-xml-builder` 1.1.7→1.2.0, `fast-xml-parser` 5.7.0→5.8.0, `icu-minify` 4.9.2→4.13.0, `lodash` 4.18.0→4.18.1, `path-to-regexp` 8.4.0→8.4.2, `rollup` 4.59→4.62.0, `xmlhttprequest` 1.7.0→1.8.0; MAJORs: `@hono/node-server` 1.19.13→**2.0.4**, `@xmldom/xmldom` 0.8.13→**0.9.10**, `brace-expansion` 2.0.3→**5.0.6**, `diff` 4.0.4→**9.0.0**, `fast-uri` 3.1.2→**4.0.0**, `minimatch` 7.4.8→**10.2.5**, `protobufjs` 7.6.4→**8.6.3**, `tough-cookie` 4.1.3→**6.0.1**. Kept (already latest-stable or current > 7d candidate): `shell-quote`, `esbuild` 0.28.1 (backlog remove-when gate), `xmlhttprequest-ssl`, `@protobufjs/utf8`, `@tootallnate/once`, `bn.js`, `flatted`, `follow-redirects`, `hono` 4.12.26, `js-yaml`, `jws`, `markdown-it`, `qs`, `serialize-javascript`, `dompurify` 3.4.11 (>7d-candidate 3.4.10). _Light-verify PASS._
- [STOPPED] **T4.10 — `vite` override → NEEDS EVALUATION (Edward).** Bumped 7.3.5→8.0.16 (commit `feb800a4`) then REVERTED to 7.3.5 (commit `1c5c24fa`). Vite 8 light-verify passed the CLI gates, but `pnpm dedupe --check` exposed a peer break: **`@vitejs/plugin-react@5.1.4` peer-requires vite `^4||^5||^6||^7` — it does NOT accept vite 8**; Storybook's `@storybook/csf-plugin@10.2.13` likewise. The override forced 8.0.16 at top-level while these consumers kept a nested vite 7.3.5 → fragmentation. Per "if a bump breaks, STOP that family and report" — reverted. **Evaluation for Edward:** to take vite to 8, also bump `@vitejs/plugin-react` to a vite-8-compatible major (and Storybook's vite plugin) — a coupled frontend-toolchain decision, not a pure override bump.

---

## Step 5 — CI guard + Renovate + §7 absorptions (child PR `dep-baseline/05-final-lint`)

> Maps spec Requirement "The CI guard holds the single-version line on every PR" +
> "Transitive security pins stay in pnpm.overrides" (absorbed §7 items carry a gate).

### 5.A CI guard wiring (file edits, OOM-safe)

- [ ] **T5.1** Author `.syncpackrc.json` at repo root (design §5.1): workspace-protocol ignore group + single-version `highestSemver` group + `semverGroups.range: ""` exact-range gate. **DoD:** `syncpack lint` keys both invariants. File: `.syncpackrc.json` (new). _OOM-safe._
- [ ] **T5.2** Add the `dependency-consistency` job to `.github/workflows/fitness.yml` (design §5.2 / D5 — fitness.yml is the invariant home, NOT a new workflow): steps for `pnpm exec syncpack lint`, `pnpm install --frozen-lockfile`, `pnpm dedupe --check`. **DoD:** spec scenario "the three CI gate steps are wired [static]" — three gating steps present, each fails the PR on non-zero exit. File: `.github/workflows/fitness.yml`. _OOM-safe._
- [ ] **T5.3** Mark `.github/workflows/dependency-updates.yml` `# superseded-by-renovate` (do NOT delete — out of scope, design §5.2). **DoD:** comment present; workflow's `pnpm audit` analysis job retained. File: `.github/workflows/dependency-updates.yml`. _OOM-safe._
- [ ] **T5.4** Author `.github/renovate.json` (design §5.3): `rangeStrategy: pin`, `pnpm-catalog` manager catalog-awareness, family `groupName`s (react/tiptap/langchain/googleapis/opentelemetry), `minimumReleaseAge: 7 days` (14 for runtime-critical P0). **DoD:** spec scenario "Renovate is configured to pin and group [static]". File: `.github/renovate.json` (new). _OOM-safe._

### 5.B §7 absorptions + GHSA dated-debt (file edits, OOM-safe)

- [ ] **T5.5** `CONCURRENTLY-BUMP` → bump `concurrently` to **10.0.3** in its override/manifest (design §7 / spec §7 absorptions). **DoD:** resolved to 10.0.3; single version. File: root `package.json` / catalog. _OOM-safe._
- [ ] **T5.6** `ESBUILD-OVERRIDE` + `SHELL-QUOTE-OVERRIDE` → keep with dated-debt / remove-when gate (design §2.2 keep-reasons). **DoD:** spec scenario "absorbed standing items carry a gate or are removed [static]" — each surviving override carries a documented remove-when. Files: root `package.json` comments + `docs/product/PENDING_WORK_INVENTORY.md` §7. _OOM-safe._
- [ ] **T5.7 (Q2 — 3 ignored GHSAs, dated-debt, do NOT move auditConfig)** Convert the `UNDOCUMENTED-GHSA-IGNORES` flag into a dated-debt line per GHSA (`GHSA-q7cg-457f-vx79`, `GHSA-p8p7-x288-28g6`, `GHSA-848j-6mx2-7j84`) with the remove-when from design §6, dated `2026-06-19`. Keep the `pnpm.auditConfig.ignoreGhsas` block in `package.json` (moving to YAML is out of scope). **DoD:** §7 inventory has 3 dated-debt lines with remove-when. File: `docs/product/PENDING_WORK_INVENTORY.md`. _OOM-safe._
- [ ] **T5.8 (Q2 — SECURITY_CANON note)** Add an "Audited audit-ignores" table to `docs/security/SECURITY_CANON.md` mirroring the 3 GHSAs (reason + remove-when) AND the CVE-floor catalog pins from T1.10 (design §6 + D4). Follow the canon §"How to extend" rules (Owner line + structured section preserved so fitness #24 stays green). **DoD:** table present; fitness #24 (canon child structure) still hard-zero. File: `docs/security/SECURITY_CANON.md`. _OOM-safe._

### 5.C Spec correction + final gate

- [ ] **T5.9** Correct the stale "24 fitness functions" wording in `specs/dependency-version-management/spec.md` (Requirement "The baseline causes no regression…" + its scenario) to **27**, matching `CLAUDE.md §Automated Compliance Checks` and `.github/workflows/fitness.yml`. **DoD:** spec reads "27 fitness functions"; no other count drift. File: `openspec/changes/dependency-baseline/specs/dependency-version-management/spec.md`. _OOM-safe._
- [ ] **T5.10 [PAUSE-STACK]** Final gate: `syncpack lint` + `pnpm dedupe --check` + `pnpm install --frozen-lockfile` + full build + LXC-safe tests + 27 fitness. **DoD:** ALL spec success criteria green; this is the pinned baseline. _Full build/test on the 9GB box._

### 5.D Tracker merge (the only merge to main)

- [ ] **T5.11** After all child PRs (Steps 1–5) are merged into `workstream/dep-baseline` and the tracker is green, open the **single tracker→main PR**. **DoD:** tracker PR green on all CI (the new `dependency-consistency` job + 27 fitness + build/test); atomic rollback boundary preserved (only the tracker touches main). _CI-gated._

---

## Review Workload Forecast

> **Reconciled fitness count: 27** (CLAUDE.md §Automated Compliance Checks #1–#27 ==
> `.github/workflows/fitness.yml` jobs #1–#27). Spec's "24" is stale; T5.9 corrects it.

**Chained PRs recommended: YES** — feature-branch-chain is Edward's chosen strategy.
The change is a monorepo-wide dependency baseline (90 manifests + lockfile + catalogs +
overrides + CI). A single PR would be unreviewable and unroll-back-able; the design
already mandates per-step / per-family child PRs onto the `workstream/dep-baseline`
tracker (only the tracker merges to main).

**Estimated total changed lines: ~2,800–3,600** (dominated by the 90-manifest
`catalog:` sweep + the re-resolved `pnpm-lock.yaml`).

| Child PR           | Scope                                                                                         | Est. changed lines | 400-line budget | Notes                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-structure`     | catalogs + syncpack stub + 90 manifests → `catalog:` + override surgery + lockfile re-resolve | **~1,800–2,400**   | **EXCEPTION**   | Largest by far; the 90-manifest sweep + lockfile. Mechanically uniform (find/replace to `catalog:`) — reviewable despite size; the lockfile churn is generated. `size:exception` expected. |
| `02-wildcards`     | 3 catalog folds + lockfile delta                                                              | ~30–60             | OK              | Tiny; mostly a verification PR if folded in Step 1.                                                                                                                                        |
| `03-reconcile`     | 13 catalog/override edits + lockfile delta                                                    | ~120–200           | OK              | Within budget.                                                                                                                                                                             |
| `04a..04h` (8 PRs) | per-family `taze` bumps + lockfile delta                                                      | ~40–150 each       | OK each         | Atomic families; `04g-runtime` is the riskiest (full integration), not the largest.                                                                                                        |
| `05-final-lint`    | `.syncpackrc.json` + fitness.yml job + renovate.json + §7 docs + spec fix                     | ~250–400           | OK / borderline | Config + docs; borderline if SECURITY_CANON table is large.                                                                                                                                |

**Decision needed before apply: YES (for `01-structure`).** The structure-only child PR
exceeds the 400-line budget because of the 90-manifest sweep + the generated lockfile
diff. Recommended resolution: proceed with `01-structure` as `size:exception` (the diff
is mechanically uniform and the lockfile is generated), keeping every OTHER child PR
within budget. The chain itself (12 child PRs total) IS the split that keeps review
focused.

**400-line budget risk: High (for `01-structure` only); Low for all other children.**

**Bottlenecks / sequencing risks for the orchestrator:**

- Steps are strictly sequential (3 depends on 2 depends on 1; Step 4 families gate
  one-another via `--frozen-lockfile`). No parallelism across steps — the lockfile is a
  shared, serializing resource.
- WITHIN Step 4, the 8 family PRs are ordered (lowest blast-radius first, `04g-runtime`
  last) and CANNOT be parallelized: each `--frozen-lockfile` between families assumes the
  previous family is already merged into the tracker.
- Every `[PAUSE-STACK]` task is a hard serialization point on the 9GB box (only one
  install/build/test can run at a time without OOM). The orchestrator must ensure the dev
  stack is paused before each.
- The single highest-risk task is **T1.3.a/T1.4** (override-forces-newer downgrade trap):
  a mistake here silently downgrades OTel/langchain/fastify/cloudinary/handlebars; T1.13's
  no-version-drop diff review is the guard.

---

## Task summary

- **Total tasks:** 47 (`T0.1`–`T5.11`, counting the lettered sub-tasks T1.3.a/b).
- **Per-step (per-child-PR) grouping:**
  - Step 0 (bootstrap, no PR): 2
  - Step 1 (`01-structure`): 17 (incl. 2 sub-tasks; the 3 SPLIT = T1.7/T1.8/T1.9; flagged = T1.3.a, T1.3.b, T1.4, T1.10)
  - Step 2 (`02-wildcards`): 4
  - Step 3 (`03-reconcile`): 14 (flagged = T3.7 zod direction, T3.13 zod peer)
  - Step 4 (`04a..04h`, 8 PRs): 8
  - Step 5 (`05-final-lint`): 11 (Q2 = T5.7/T5.8; spec fix = T5.9; tracker merge = T5.11)
- **3 SPLIT items:** T1.7 (`google-auth-library`), T1.8 (`gaxios@7`), T1.9 (`msw>path-to-regexp`).
- **6 flagged items:** T1.3.a (override-forces-newer langchain/fastify/cloudinary/handlebars), T1.3.b (dompurify classification), T1.4 (OTel override-is-the-bump), T1.10 (CVE-floor packages), T3.7 (zod reconcile-UP direction), T3.13 (zod×fastify-type-provider-zod peer).
- **[PAUSE-STACK] tasks (9GB-box serialization):** T0.2, T1.13, T1.14, T1.15, T2.4, T3.13, T3.14, T4.1–T4.8, T5.10 (16 total).
