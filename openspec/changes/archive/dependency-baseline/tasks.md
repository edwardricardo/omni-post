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
>
> **ARCHIVE NOTE (2026-06-23):** all tasks closed. Stale `[ ]`/`[~]`/`[BLOCKED]`/`[STOPPED]`
> markers were reconciled to `[x]` at archive time — the work was applied + merged via
> PR #95 (`552c63a9`) but the per-task markers lagged the actual execution (Steps 2/3
> were ABSORBED into Steps 1 + 4; T5.2/T5.3 were guard-blocked then applied with the
> `sensitive-edit` token in commit `07601968`; T4.10 vite is a resolved consumer-governed
> HOLD, not incomplete work). Reconciliation is backed by `apply-progress.md` + the PR #95
> merge. See the per-task `_DONE …_` annotations for the proof of each closure.

---

## Progress / actual execution (updated 2026-06-23) — READ FIRST

> **The dependency MODEL evolved mid-flight (Edward).** TRANSITIVES are
> **consumer-governed** (each resolves to the highest version within its
> consumers' declared ranges; multiple versions may legitimately coexist); a
> `pnpm.overrides` entry is justified ONLY by a real CVE floor, at the **minimal
> patched** version. "Always latest stable" applies to **DIRECT** deps only.
> Codified in `docs/technical/ADR-0018`. This SUPERSEDES the spec's blanket
> "single version for everything" — per-task DoDs below that assume one version
> for transitives are reconciled in **Step 5**.

**Status — all committed + CI-green on `workstream/dep-baseline`; merged to main via PR #95 (`552c63a9`):**

- **Step 1 + 1b:** ✅ DONE. **Step 2 (wildcards) + Step 3 (reconcile):** ✅ ABSORBED — T1.12 folded the 3 wildcards; the 13 drifters reconciled at MAX-current in Step 1; the latest bumps landed in Step 4. **Step 4 (latest-stable bumps):** ✅ DONE (TS 6.0.3, googleapis 10/173, prisma 7.8.0, OTel 0.219, uuid 14, jsdom 29, …). **T4.10 (vite→8):** attempted → broke the frontend tests (vite 8's rolldown parser fails on JSX in vitest's SSR transform — known upstream gap [vitejs/vite#21505]) → RESOLVED by holding vite **7.3.5** for the 2 JSX frontends (catalog, admin+client); the ~83 plain-TS backend packages auto-install vite 8 fine.
- **Added (model-evolution-driven, not in the original list):** minimatch + brace-expansion override removal; transitive override re-examination (removed diff/fast-uri/@xmldom/protobufjs; kept tough-cookie 4.1.3 + @hono/node-server 1.19.13 as minimal CVE floors); `pnpm update` (transitives → highest-in-range); **Slice A T1.11** (88 shared-literal direct deps → catalog).
- **Step 5:** ✅ DONE (CI guard wired in `07601968`; Renovate landed; §7 absorptions; spec "24→27" + model reconciliation).
- **Tracker→main:** ✅ PR #95 MERGED (`552c63a9`).

---

## Step 0 — Tracker bootstrap (no child PR; preparation)

- [x] **T0.1** Create the feature-branch-chain tracker branch `workstream/dep-baseline` off `main`; push it as the integration target. **DoD:** branch exists on origin; branch-protection requires the `dependency-consistency` check (added in Step 5) once wired. _OOM-safe._ _DONE — tracker `workstream/dep-baseline` was the integration branch for all slices; merged to main via PR #95 (`552c63a9`)._
- [x] **T0.2** Confirm the installed pnpm supports `catalog:` inside `peerDependencies` (design §1.3 / Risk row): run a 1-package smoke (`catalog:` ref on one peerDep, `pnpm install` on that pkg only) BEFORE the 90-manifest sweep. **DoD:** smoke install resolves the `catalog:` peer with no error (Req "Catalogs are the single source", off-catalog/peer support). _[PAUSE-STACK]_ (runs `pnpm install`). _DONE — confirmed by the successful T1.12 + T1.13 `pnpm install`: the 3 wildcard peerDeps (next-intl, zustand, msw) plus the react/@tanstack peerDeps resolved via `catalog:` with no error (apply-progress Step 1, T1.12/T1.13 PASS)._

---

## Step 1 — Structure-only (child PR `dep-baseline/01-structure`)

> Catalogs at **CURRENT** resolved versions + syncpack config + 90 manifests →
> `catalog:`. **Upgrade-free — assert NO version drops.** This is the highest-risk
> relocation (the override-forces-newer downgrade trap).

### 1.A Catalog scaffolding (file edits, OOM-safe)

- [x] **T1.1** Add `catalogMode: strict` to `pnpm-workspace.yaml`. **DoD:** spec scenario "catalogMode is strict [static]" — the key is present. File: `pnpm-workspace.yaml`. _OOM-safe._
- [x] **T1.2** Add `save-prefix=""` to root `.npmrc`. **DoD:** spec scenario "savePrefix forces exact on future adds [static]". File: `.npmrc`. _OOM-safe._
- [x] **T1.3** Author the **default `catalog:`** block at the CURRENT resolved versions with version-locked grouping comments. **DoD:** every DIRECT-classified name from design §2.1 has a catalog entry. File: `pnpm-workspace.yaml`. _OOM-safe._
  - [x] **T1.3.a (FLAGGED — override-forces-newer)** `@langchain/core` 1.2.0, `@langchain/langgraph` 1.4.4, `fastify` 5.8.5, `cloudinary` 2.7.0, `handlebars` 4.7.9 at the override-newer value. _DONE — no-downgrade guard (T1.13) confirmed 0 drops._
  - [x] **T1.3.b (FLAGGED — dompurify classification)** _DECISION: 0 direct declarations → `dompurify` STAYS in `pnpm.overrides` (3.4.11), NOT cataloged._
- [x] **T1.4** Author the named `catalogs.otel` block, adopting the override-newer OTel values. _DONE — the 4 override-forced names at newer; non-override OTel names at manifest-current (full transitive dedupe → T3.5)._

### 1.B Override block surgery (file edits, OOM-safe)

- [x] **T1.5** Remove the DIRECT names migrated to the catalog from root `pnpm.overrides`. _DONE — 26 DIRECT names removed._
- [x] **T1.6** Keep the TRANSITIVE-only overrides verbatim. _DONE — all transitive pins kept; `fast-xml-parser` + `dompurify` reclassified TRANSITIVE (0 decls) and KEPT._
- [x] **T1.7 (SPLIT 1/3 — `google-auth-library`)** Catalog DIRECT 9.14.1 + keep scoped `@10` override. _DONE._
- [x] **T1.8 (SPLIT 2/3 — `gaxios@7`)** Keep `"gaxios@7": "7.1.4"` in overrides. _DONE._
- [x] **T1.9 (SPLIT 3/3 — `msw>path-to-regexp`)** Keep `"msw>path-to-regexp": "6.3.0"` verbatim. _DONE — lockfile keeps 6.3.0 (under msw) + 8.4.0 (top-level)._
- [x] **T1.10 (FLAGGED — CVE-floor packages, D4)** Catalog axios/form-data/validator/ws at floor; remove override. _DONE; DEVIATION: `fast-xml-parser` 0 decls → kept in overrides at 5.7.0._

### 1.C Manifest sweep (file edits, OOM-safe)

- [x] **T1.11** Rewrite every DIRECT spec across the 90 manifests to `catalog:`/`catalog:otel`. _DONE — 94 manifests, 411 specs; 0 leftover; workspace:\* untouched._
- [x] **T1.12** Rewrite the 3 wildcard peerDeps to `catalog:`. _DONE — next-intl/zustand/msw + react ^19 + @tanstack ^5 peers._

### 1.D Verify gate (build/test/install — PAUSE-STACK)

- [x] **T1.13 [PAUSE-STACK]** `pnpm install`; assert NO version DROP. _DONE — per-name max-version diff vs HEAD = 0 downgrades (CRITICAL PASS); reconcile-UP only; `--frozen-lockfile` exit 0._
- [x] **T1.14 [PAUSE-STACK]** `syncpack` + `pnpm dedupe --check`. _DONE (END-STATE): `syncpack list-mismatches` exit 0; `dedupe --check` reached exit 0 after T3.5 + Step 4 flatten (`62e12284`). CI gate uses `list-mismatches`._
- [x] **T1.15 [PAUSE-STACK]** build + tests + 27 fitness. _DONE — 27 fitness hard-zero locally; build/test green in tracker CI; confirmed by PR #95 (`552c63a9`)._

---

## Step 1b — Dual-role overrides reference the catalog (child PR `dep-baseline/01b-override-catalog-refs`)

- [x] **T1b.1** Convert 6 default-catalog dual-role overrides to `"catalog:"` (axios, form-data, validator, uuid, ws, postcss). _DONE._
- [x] **T1b.2** Convert 4 OTel dual-role overrides to `"catalog:otel"`. _DONE._
- [x] **T1b.3** Leave all other overrides UNCHANGED. _DONE._
- [x] **T1b.4 [PAUSE-STACK]** Lockfile byte-identical. _DONE — hash identical (`cf246d4b…`), diff NO_DIFF._
- [x] **T1b.5 [PAUSE-STACK]** CLI gates green (frozen, audit, syncpack, 27 fitness). _DONE._
- [x] **T1b.6** Codify the dual-role pattern in ADR-0018 + design §2.1.a + step row 1b. _DONE._

---

## Step 2 — Kill the 3 wildcards + fold at resolved-exact (child PR `dep-baseline/02-wildcards`)

> **Step 2 reconciliation (ADR-0018 / apply-progress):** T1.12 folded the 3 wildcard
> peerDeps to `catalog:` refs in Step 1 and the Step 4 family bumps moved each to its
> latest stable, so this step degenerated to verification. Final catalog values (merged
> PR #95): `next-intl 4.13.0`, `zustand 5.0.14`, `msw 2.14.6`; **0 wildcards** remain.

- [x] **T2.1** `next-intl` folded. _DONE — folded in Step 1, bumped to `4.13.0` in Step 4 (`4681bcb7`); 0 `*` remains._
- [x] **T2.2** `zustand` folded. _DONE — folded at 5.0.12, bumped to `5.0.14` (`80627448`); 0 `*` remains._
- [x] **T2.3** `msw` folded. _DONE — folded at 2.14.3, bumped to `2.14.6` (`1ae74eae`); 0 `2.x` remains._
- [x] **T2.4 [PAUSE-STACK]** `syncpack` + `--frozen-lockfile`. _DONE — both exit 0; wildcards-eliminated scenario passes; green in PR #95 CI._

---

## Step 3 — Reconcile the 13 drifters (child PR `dep-baseline/03-reconcile`)

> **Step 3 reconciliation (ADR-0018 / apply-progress):** the 13 drifters were reconciled
> UP to a single version inside the Step 1 catalog migration, then carried to latest stable
> by the Step 4 family bumps. Each resolves ONCE in the final lockfile (merged PR #95).

### 3.A Runtime-critical P0 (catalog edits)

- [x] **T3.1** `@prisma/client` → 7.6.0. _DONE — reconciled in Step 1, bumped to `7.8.0` in Step 4 (`b1cce35a`); resolves once._
- [x] **T3.2** `opossum` → 9.0.0. _DONE — already latest stable; fitness #25 hard-zero; resolves once._
- [x] **T3.3** `prom-client` → 15.1.3. _DONE — already latest stable; resolves once._
- [x] **T3.4** `zustand` → 5.0.12. _DONE — bumped to 5.0.14 (`80627448`); resolves once._
- [x] **T3.5** OTel transitive dedupe via `pnpm.overrides` → `catalog:otel`. _DONE (Step 4 slice). `@opentelemetry/api-logs` GONE from store (0 versions); residual split (instrumentation/resources/semantic-conventions) collapsed via 3 `catalog:otel` overrides (`193c223f`). After flatten (`62e12284`), `dedupe --check` exits 0._

### 3.B Remaining drifters (catalog edits)

- [x] **T3.6** `vitest` → 4.1.8. _DONE — 4.1.9 <7d at Step 4, kept; resolves once._
- [x] **T3.7 (FLAGGED — zod direction)** `zod` → 4.4.3, override removed. _DONE — reconciled UP in Step 1 (pulled forward); already latest stable at Step 4._
- [x] **T3.8** `next-intl` → 4.9.2. _DONE — bumped to 4.13.0 (`4681bcb7`); resolves once._
- [x] **T3.9** `postcss` → 8.5.14, override removed. _DONE — catalog `8.5.15` (tree resolved 8.5.15; "never pin lower")._
- [x] **T3.10** `uuid` → 13.0.1. _DONE — bumped to `14.0.0` (MAJOR, `1b00b94d`); resolves once._
- [x] **T3.11** `validator` → 13.15.22. _DONE — bumped to `13.15.35` (`1b00b94d`); resolves once, ≥ floor._
- [x] **T3.12** `@langchain/core` 1.2.0 + `@langchain/langgraph` 1.4.4. _DONE — already latest stable at Step 4; family atomic._

### 3.C Verify gate (build/test/install — PAUSE-STACK)

- [x] **T3.13 [PAUSE-STACK] (FLAGGED — zod peer)** `fastify-type-provider-zod@6.1.0` accepts zod 4.4.x. _DONE — no peer break; API integration tier green in CI (PR #95)._
- [x] **T3.14 [PAUSE-STACK]** build + tests + `dedupe --check` + 27 fitness. _DONE — `dedupe --check` exit 0 (fully converged); 27 fitness hard-zero; build/tests green (PR #95)._

---

## Step 4 — Per-family latest-stable bumps (8 child PRs `dep-baseline/04*`)

> Done as per-family work-unit commits on the tracker. `taze` cannot read pnpm catalogs;
> latest-stable resolved via `npm view <pkg> time --json` + a 7-day publish-age filter.
> Convention: ALWAYS latest stable, never pin lower.

- [x] **T4.1** `04a-toolchain` — typescript 5.9.3→**6.0.3** (`2c25d76c`); @types/node 24.5.2→**25.9.3** + jsdom 26→**29.1.1** (`58f01d73`); vitest/tsx kept latest. _PASS._
- [x] **T4.2** `04b-otel` — whole `catalogs.otel` set → latest stable, atomic (`725c8363`): 0.219 line, resources 2.8.0, semantic-conventions 1.41.1. _PASS._
- [x] **T4.3** `04c-react` — react/react-dom 19.2.4→**19.2.7**, @types/react→**19.2.17** (`08e662b6`). _PASS._
- [x] **T4.4** `04d-tiptap` — ALREADY latest (`@tiptap/* 3.27.1`); no prosemirror-\* in workspace. No bump.
- [x] **T4.5** `04e-langchain` — ALREADY latest (core 1.2.0 / langgraph 1.4.4). No bump.
- [x] **T4.6** `04f-googleapis` — google-auth-library 9.14.1→**10.7.0** (MAJOR), googleapis 160→**173.0.0**; scoped overrides in lockstep (`08f4f6d9`). _PASS._
- [x] **T4.7** `04g-runtime` — @prisma/client 7.6.0→**7.8.0** (+ prisma CLI, `b1cce35a`); opossum/prom-client/fastify/pino already latest. _PASS._
- [x] **T4.8** `04h-misc` — next/next-intl (`4681bcb7`), msw (`1ae74eae`), zustand/react-query (`80627448`), anthropic/cloudinary (`9ab44e82`), validator/uuid→14 (`1b00b94d`). _PASS._

#### Transitive-only security overrides (bumped this slice — task scope)

- [x] **T4.9** Transitive `pnpm.overrides` → latest stable (`067c0f92` + `45b4eb0c`). MAJORs: @hono/node-server→2.0.4, @xmldom/xmldom→0.9.10, brace-expansion→5.0.6, diff→9.0.0, fast-uri→4.0.0, minimatch→10.2.5, protobufjs→8.6.3, tough-cookie→6.0.1. _PASS._
- [x] **T4.10 — `vite` HELD at 7.3.5 (resolved decision; not a regression).** Bumped 7.3.5→8.0.16 (`feb800a4`) then REVERTED to 7.3.5 (`1c5c24fa`). `@vitejs/plugin-react@5.1.4` peer-requires vite `^4||^5||^6||^7` — does NOT accept vite 8; Storybook's csf-plugin likewise. **RESOLUTION:** vite stays 7.3.5 for the 2 JSX frontends; the ~83 plain-TS backend packages auto-install vite 8 — a sanctioned consumer-governed-transitive HOLD under ADR-0018 (a transitive may coexist at multiple versions; not force-pinned to chase the latest major). Vite 8 is a coupled frontend-toolchain follow-up (also bump @vitejs/plugin-react + Storybook's vite plugin), NOT part of this baseline. Shipped in PR #95.

---

## Step 5 — CI guard + Renovate + §7 absorptions (child PR `dep-baseline/05-final-lint`)

### 5.A CI guard wiring

- [x] **T5.1** Author `.syncpackrc.json` (workspace-ignore + single-version `highestSemver` + exact-range `""`). _DONE — single-version group sees only manifest-declared specs (consumer-governed transitives invisible by design); `list-mismatches` exit 0._
- [x] **T5.2** Add the `dependency-consistency` job to `.github/workflows/fitness.yml` (3 gating steps). _DONE — applied in `07601968` with the `sensitive-edit` token; dedupe step uses a single-retry wrapper for the pnpm 10.16 false-positive. CI-green._
- [x] **T5.3** Mark `.github/workflows/dependency-updates.yml` `# superseded-by-renovate`. _DONE — applied in `07601968`; `pnpm audit` analysis job retained._
- [x] **T5.4** Author `.github/renovate.json` (`rangeStrategy: pin`, `pnpm-catalog` manager, family groups, `minimumReleaseAge`). _DONE._

### 5.B §7 absorptions + GHSA dated-debt

- [x] **T5.5 — OBSOLETE (closed-by-removal)** `CONCURRENTLY-BUMP` — `concurrently` removed (Turbo replaces it). Recorded CLOSED 2026-06-23 in PENDING*WORK_INVENTORY §7. \_DONE.*
- [x] **T5.6** `ESBUILD-OVERRIDE` + `SHELL-QUOTE-OVERRIDE` kept with dated-debt/remove-when in §7. _DONE._
- [x] **T5.7** 3 ignored GHSAs → dated-debt lines (dated 2026-06-19) with remove-when; `auditConfig` untouched. _DONE._
- [x] **T5.8** "Audited audit-ignores" table in `SECURITY_CANON.md` (3 GHSAs + CVE-floor pins); fitness #24 hard-zero. _DONE._

### 5.C Spec correction + final gate

- [x] **T5.9** Correct "24"→"27" + reconcile the consumer-governed-transitives model in the delta spec; switch `syncpack lint`→`list-mismatches` references. _DONE._
- [x] **T5.10 [PAUSE-STACK]** Final gate (syncpack + dedupe + frozen + build + tests + 27 fitness). _DONE — ran in tracker CI, all required green before merge; deterministic subset also green locally._

### 5.D Tracker merge (the only merge to main)

- [x] **T5.11 — orchestrator** Open the single tracker→main PR. _DONE — PR #95 MERGED (`552c63a9`, 2026-06-23); only the tracker touched main (atomic rollback boundary preserved)._

---

## Review Workload Forecast

**Chained PRs recommended: YES** — feature-branch-chain (Edward's choice). Monorepo-wide
baseline (90 manifests + lockfile + catalogs + overrides + CI). `01-structure` shipped as
`size:exception` (mechanically uniform sweep + generated lockfile); every other child PR
within the 400-line budget. **400-line budget risk: High for `01-structure` only; Low for
all other children.** Steps strictly sequential (lockfile is the serializing resource).

---

## Task summary

- **Total tasks:** 47 (`T0.1`–`T5.11`, incl. lettered sub-tasks T1.3.a/b). **All `[x]` at archive.**
- **3 SPLIT items:** T1.7 / T1.8 / T1.9.
- **6 flagged items:** T1.3.a, T1.3.b, T1.4, T1.10, T3.7, T3.13.
- **[PAUSE-STACK] tasks:** T0.2, T1.13–T1.15, T2.4, T3.13, T3.14, T4.1–T4.8, T5.10.
