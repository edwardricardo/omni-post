# Tasks: Testing Re-foundation (`testing-refoundation`)

**Change:** `testing-refoundation` · **Date:** 2026-09-27 · **Phase:** tasks
**Inputs:** the 18 specs under `openspec/changes/testing-refoundation/specs/*/spec.md` (127 requirements / 239 scenarios), `openspec/changes/testing-refoundation/design.md` (revision 2; **design §7 is the ordering authority**), `openspec/changes/testing-refoundation/proposal.md`, `openspec/changes/testing-refoundation/research.md` §Errata, and the approved plan (work-unit catalogue, decisions D1–D20 — held outside the repository, read-only).

> **Slice index** (slice → branch → depends on → tasks → CODE → gates with red proof → tracker rows) is the last section of this file: [§Slice index](#slice-index). It is written after the phases so the two cannot drift.

---

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | **CODE ~26,150 (159 enumerated slices, phases 0–9) + ~14,000–24,500 (the 6.N families, slice count fixed by the 6.N0 measurement) = ~39,900–50,400**. **EVIDENCE ~33,000** (pre-approved, D1) |
| 400-line budget risk    | **High** — no single slice exceeds 400 CODE; the change as a whole is ~100× the budget, so slicing is structural, not optional                                                                |
| Chained PRs recommended | **Yes** — 159 enumerated slices + the 6.N families (40–70 slices, count fixed by 6.N0) = **198–228 PRs**                                                                                      |
| Suggested split         | 158 stacked PRs to `main` in design §7 order, grouped in 14 phase families; 6.N adds 40–70 more after its measurement                                                                         |
| Delivery strategy       | `auto-chain` (cached this session)                                                                                                                                                            |
| Chain strategy          | `stacked-to-main` (cached this session) — every slice targets `main`, merged in index order                                                                                                   |
| Max slice               | 400 CODE (D1 hard). Largest enumerated: batch 1 (`refound/0-tracker`, 400) and the nine `refound/2-blocks-*` slices (300–380 each)                                                            |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Batch 1 for `sdd-apply` is unambiguous:** slice `0.1` — `refound/0-tracker` (WU-T.1 + T.2 + T.3, CODE ~400). Batches 2..13 are the Phase 0 toolchain slices (`refound/0-toolchain-*`), in index order. Nothing else may start before 0.1 merges, because every later slice's definition of done includes a tracker row that only 0.1 creates.

**Budget convention (D1).** **CODE** ≤ 400 per slice, hard: production, scripts, tooling, workflows, config, test-utils, ESLint rules, canon/docs prose, test lines added or modified, and block deletions inside kept files. **EVIDENCE** is pre-approved per slice: generated ledger/probe/suppression JSON, whole-file deletions backed by an approved ledger row, `git mv` at ≥90 % similarity, and mechanical codemod output whose codemod counted as CODE.

### Human decision gates (never silently skipped)

| #   | Gate                                                                                                                                  | Blocks                                                                         | Task   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| H1  | **jsdom 30** crosses into production (`isomorphic-dompurify`) and raises the runtime floor to Node ^24.15.0 — Edward decides          | slice 0.12 only                                                                | 0.12.1 |
| H2  | **D17** — the two CLI seeds `apps/api/scripts/seed-demo-data.ts` and `apps/api/scripts/seed-large-dataset.ts`: product classification | their deletion; they are **excluded from every delete slice** until classified | 2.6.1  |
| H3  | **WU-2.5 DELETE-set approval** — Edward approves the unambiguous DELETE set in one pass; ADJUDICATE rows slice by slice               | every demolition slice (2.4 onward)                                            | 2.2.2  |
| H4  | **PR V5 admin step** — Edward removes "Test and Build" from the classic required checks **before** the PR merges                      | slice 3.2                                                                      | 3.2.1  |
| H5  | **PR V11 admin steps** — `gh api -X POST …/rulesets`, clear the classic required list, enable `allow_update_branch`                   | slice 3.6 and everything that needs a required context afterwards              | 3.6.5  |
| H6  | **k6 keep-or-delete** — after K3's calibration, the numeric criterion decides; Edward is informed either way, with numbers            | slices 6K.4 and 3.12 (PR V13)                                                  | 6K.3.4 |
| H7  | **X2 runner decision** — the decision rule is applied to X1's measured table; tasks after X2 say "per X2 outcome", never a runner     | the integration-tier runner choice and WU-8.1a's framework table               | X.2.1  |
| H8  | **WU-2.0 needs a `sensitive-edit` token** (CLAUDE.md tripwire) before the coverage-exception scenario is written                      | slice 2.3                                                                      | 2.3.1  |

### Task line grammar

`- [ ] <id> <WU> · <capability> › <requirement heading> · <design ref> · CODE ~n · slice <branch> — <action>`

- `<capability>` is the spec directory under `specs/`; `›` separates it from the **requirement heading** it satisfies (specs use named headings, not numeric ids).
- **RED / GREEN** prefixes mark the strict-TDD pair (project `strict_tdd: true`): the RED task writes the failing test and observes it fail; the GREEN task makes it pass. Gate tasks are red-first by construction.
- **Red proof** tasks are the gate contract of design §4: plant the violation → run the **complete step** (`run:` extracted with `yq`, or the same script command) → exit ≠ 0 → byte-exact restore (`sha256sum` + empty `git status --porcelain`) → re-green. Never the body of a heredoc alone: the `exit 1` lives in the step's shell.
- **Tracker** tasks satisfy `testing-canon-and-tracker › The pull request that moves a metric updates the tracker in the same pull request` (design §2l, P6). They are separate checkboxes because a slice is not done without them.
- **Measured** tasks produce a number that a later **Commit** task fixes. Never predict the number.
- Paths a task only reads carry `(read-only)` after the backtick.

### Work-unit evidence defaults (per phase family)

| Family                | Focused test command                                                                 | Runtime harness                                                        | Rollback boundary                                             |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| 0 tracker / toolchain | `pnpm --filter <bumped pkg> test` + `pnpm exec tsc -b --force` + `pnpm format:check` | N/A (no process boundary) — except 0.7 (`playwright install`)          | one manifest/catalog entry per slice; `git revert`            |
| P, 1 reach            | `pnpm --filter @packages/test-contracts test`                                        | `bash apps/api/scripts/run-tests.sh --list`                            | the engine is not required until 1.16 (PR R10)                |
| 2 demolition          | vitest of the touched packages, or `bash apps/api/scripts/run-tests.sh <path>`       | N/A (deletions)                                                        | one ledger `--area` per slice; floors restored with D2 marker |
| 3 verdict             | `pnpm --filter @packages/test-contracts test` + the extracted complete step          | draft PR or `workflow_dispatch` on a scratch branch, run URL in the PR | one workflow/job per slice; ruleset mirror is the rollback    |
| 4b environment        | `bash scripts/testing/test-env.bats`                                                 | `bash scripts/test-env.sh run --with api,workers -- true`              | `scripts/ci-setup-test-env.sh` deleted only in 4b.1's PR      |
| S tooling             | `pnpm --filter @apps/api test` + the migrated package's vitest                       | N/A (in-process doubles)                                               | one migration per slice; suppressions pruned per slice        |
| 4 integration         | `bash scripts/test-env.sh integration`                                               | same (two phases under one trap)                                       | one suite family per slice                                    |
| 5 coverage            | `pnpm --filter <pkg> test:coverage`                                                  | `pnpm exec turbo run test:coverage --continue`                         | floors only rise; a mistaken floor is lowered with the marker |
| 6 re-found            | `pnpm exec playwright test -c <config>` / `pnpm --filter <pkg> test` / `k6 run`      | `bash scripts/test-env.sh env services && … db` then `playwright test` | each job is added in the same PR as its `collectors.json` row |
| 6.N new coverage      | `pnpm --filter <pkg> test:coverage`                                                  | `node scripts/testing/hard-probe.mjs` (orchestrator-run, D19)          | one package per slice, isolated worktree                      |
| 7 mutation            | `node scripts/testing/mutation.mjs --package <name>`                                 | the incremental PR job on a scratch branch                             | `stryker.config.mjs` + `mutation-floors.json` revert          |
| 8 docs                | `pnpm exec lychee --offline docs/` + fitness #24                                     | N/A (prose)                                                            | one document per slice                                        |

---

## Phase 0 — Baseline, tracker and toolchain (design §7.1)

### 0.1 · `refound/0-tracker` — the measurer exists before anything moves · **BATCH 1**

- [x] 0.1.1 WU-T.1 · testing-canon-and-tracker › Every tracker metric is re-derivable by the command it names · design §2l · CODE ~180 · slice `refound/0-tracker` — create `docs/development/TESTING_REFOUNDATION.md` with the design §2l structure verbatim (Metrics M1–M16 with Baseline/Now/Target/Re-derive with/Moved by · Work units · Gates · Decisions log · Declared gaps · Plan (fixed) · How to extend), Baseline measured at the base SHA, every "Moved by" = "—"; add its row to `docs/README.md`.
- [x] 0.1.2 RED WU-T.2 · testing-canon-and-tracker › Every tracker metric is re-derivable by the command it names · design §2b · CODE ~40 · slice `refound/0-tracker` — write the failing test that `metrics.mjs` at the base SHA reproduces the Baseline column byte-exact.
- [x] 0.1.3 GREEN WU-T.2 · testing-canon-and-tracker › Every tracker metric is re-derivable by the command it names · design §2b · CODE ~150 · slice `refound/0-tracker` — `scripts/testing/metrics.mjs --m<N>|--all` deriving M1/M5 from `git ls-files`, M3/M13 from `eslint-suppressions.json` per rule, M4/M6/M14 from `ledger.json`, M8/M16 from coverage summaries, M15 from `gh issue list` (read-only) — every other row from a pasted runner summary or a named run id.
- [x] 0.1.4 WU-T.3 · testing-canon-and-tracker › The workstream has one tracking entry, and the follow-ups it subsumes point at it · design §2l · CODE ~70 · slice `refound/0-tracker` — ficha `N-TEST-1` in `docs/product/MASTER_PLAN_ES.md` §1 N.C with sub-items N-TEST-1.0…1.9 and the nine-point DoD; `⏩ subsumido por N-TEST-1` on N-CI-2 and N-CI-3; `docs/architecture/NORMALIZATION_ROADMAP.md` §2.3 subsuming §2.2.b, §3.2.b, §4.1.b/c with `⏩ subsumido por §2.3` on each.
- [x] 0.1.5 Gate check WU-T.3 · testing-canon-and-tracker › One living testing document, re-measured and protected from deletion · CODE ~0 · slice `refound/0-tracker` — fitness #24 green and every new link resolves (`lychee`).
- [x] 0.1.6 Tracker: M7 (Gates 0/0) and the Work-units table seeded with all ~130 WUs at ⬜ · CODE ~4 · slice `refound/0-tracker`.

### 0.2 · `refound/0-toolchain-measure` — the lag table, measured · **BATCH 2**

- [x] 0.2.1 **Measured** WU-T.4(a) · testing-toolchain-alignment › The freshness comparator is "latest mature", never "latest" · plan T.4(a) · CODE ~30 · slice `refound/0-toolchain-measure` — run `pnpm outdated -r --format json` + `pnpm view <pkg> time --json`; write the tracker table dep · installed · **latest mature** (≥ 7 days, ADR-0018) · documented hold (yes/no, where) · CVE floor. EVIDENCE ~120.
- [x] 0.2.2 WU-T.4(a) · testing-toolchain-alignment › A bump that crosses into production or raises the runtime floor is its own decision · CODE ~10 · slice `refound/0-toolchain-measure` — mark in the same table which rows cross into production or raise `engines.node` (jsdom 30, TypeScript 6→7, `@vitejs/plugin-react` 5→6, `@eslint/js` 9→10) and route each to its own slice or hold.
- [x] 0.2.3 Tracker: the T.4 lag table lands as a tracker section; no metric moves yet · CODE ~4 · slice `refound/0-toolchain-measure`.

### 0.3 · `refound/0-toolchain-holds` — the holds gate and the corrected holds table · **BATCH 3**

- [x] 0.3.1 RED WU-T.4(f) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · plan T.4(f) · CODE ~30 · slice `refound/0-toolchain-holds` — write the failing test: a direct testing dependency below latest mature with no row in `docs/security/SECURITY_CANON.md` §"Build-tool version holds" → exit 1.
- [x] 0.3.2 GREEN WU-T.4(f) · dependency-version-management › The CI guard holds the single-version line on every PR · CODE ~80 · slice `refound/0-toolchain-holds` — the gate in the `Dependency Consistency` job comparing the holds table against `pnpm outdated`, fail-closed on zero rows extracted.
- [x] 0.3.3 **Red proof** WU-T.4(f) · testing-canon-and-tracker › Every new or modified gate is recorded with its demonstrated red · design §4 · CODE ~0 · slice `refound/0-toolchain-holds` — lower a pin without adding a hold row → complete step exits 1 → byte-exact restore → re-green.
- [x] 0.3.4 WU-T.4 · testing-toolchain-alignment › vitest holds at 4.1.11 with its measured reason, and mutation runs only on vitest 4 · research §Errata · CODE ~40 · slice `refound/0-toolchain-holds` — write the vitest hold with its measured reason (`@stryker-mutator/vitest-runner` 10.0.0 broken on vitest 5: stryker-js#6210 open, #6220 unmerged, every mutant silently "Survived"; 573-file behaviour migration; 5.0.2 immature) and its remove-when.
- [x] 0.3.5 WU-T.4 · dependency-version-management › Every audited ignore and floor names the chain that actually delivers the package · CODE ~20 · slice `refound/0-toolchain-holds` — correct `docs/security/SECURITY_CANON.md`: GHSA-q7cg-457f-vx79 arrives through `jq → jsdom@0.2.19`, not `wait-on` — today's remove-when can never fire; rewrite the eslint hold (it explains "<10", not staying at 9.36 while 9.39.5 is mature); refresh the stale "latest stable (taze)" catalog comments.
- [x] 0.3.6 Tracker: Gates table gains the holds gate with its red proof; M7 moves · CODE ~4 · slice `refound/0-toolchain-holds`.

### 0.4 · `refound/0-toolchain-eslint` — the eslint family: eslint 9.36.0 → 9.39.5, `@eslint/js` → 9.39.5, `@typescript-eslint/{parser,eslint-plugin}` → latest mature · **BATCH 4**

- [x] 0.4.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~60 · slice `refound/0-toolchain-eslint` — re-measure latest mature for eslint, `@eslint/js` and the `@typescript-eslint` pair on the day; bump their catalog entries together (the pair's peer range is what keeps TypeScript 7 out — record the post-bump peer range in the TypeScript hold row); verify `pnpm lint --max-warnings 0` exit 0 and `eslint-plugin-react` / `jsx-a11y` peers still resolve; `pnpm exec tsc -b --force` and `pnpm format:check` green.
- [x] 0.4.3 WU-T.4(f) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · CODE ~10 · slice `refound/0-toolchain-eslint` — delete the SCHEDULED hold rows of eslint, `@eslint/js` and the `@typescript-eslint` pair from `docs/security/SECURITY_CANON.md` (a bumped package needs no row); rewrite the remaining eslint-10 hold with today's date and its remove-when; `node scripts/testing/holds-gate.mjs` exit 0 with the rows gone.
- [x] 0.4.2 Tracker: T.4 table rows for the three packages move to their new installed versions; Decisions log records the 2026-09-27 re-plan (0.4 absorbs `@typescript-eslint`; slices 0.14 build and 0.15 quality-gates added at the tail of Phase 0) · CODE ~8 · slice `refound/0-toolchain-eslint`.

### 0.4b · `refound/0-holds-table-fix` — correction found by 0.4: the holds table and the gate that reads it · **BATCH 4b** (re-plan 2026-09-28, Edward: "corrígelo", before 0.5)

- [x] 0.4b.1 RED WU-T.4(f) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · CODE ~20 · slice `refound/0-holds-table-fix` — failing fixture: a five-cell holds row whose remove-when cell is EMPTY must make the gate exit 1 (today the parser reads the reason cell as the remove-when, so it passes); a second fixture: a holds table whose header has no `Remove-when` column → exit 1 (fail-closed).
- [x] 0.4b.2 GREEN WU-T.4(f) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · CODE ~40 · slice `refound/0-holds-table-fix` — `docs/security/SECURITY_CANON.md` §"Build-tool version holds & dated-debt overrides": header becomes five columns (Package · Hold / floor · Where · Reason · Remove-when); the three four-cell DATA rows (esbuild, minimatch/brace-expansion, shell-quote — the earlier count of five included the header and the separator) split their prose into Reason and Remove-when; every row has five cells and a non-empty remove-when. `scripts/testing/holds-gate.mjs` `parseHolds` locates the `Remove-when` column BY HEADER NAME (not by index), refuses a table without it, and refuses a row whose cell count differs from the header's; the live gate exits 0 on the corrected table.
- [x] 0.4b.3 WU-T.4(a) · testing-canon-and-tracker › Every tracker metric is re-derivable by the command it names · CODE ~40 · slice `refound/0-holds-table-fix` — the tracker's lag tables cite each hold by PACKAGE identity in the canon row (never by canon line number); the 36 stale `NO HOLD` cells become `hold: <row package>`; the section headline states the re-measure instant it reports.
- [x] 0.4b.4 RED+GREEN build fix · dependency-version-management › Source-mode invocations opt in via `--conditions development` · CODE ~3 · slice `refound/0-holds-table-fix` — red: with `packages/observability/background-scheduler/dist` absent, `pnpm exec tsc -b --force` exits non-zero with TS2307 in `packages/observability/opentelemetry`; green, as measured: the root `tsconfig.json` `references` gains the EMITTING config `packages/observability/background-scheduler/tsconfig.build.json` (a directory reference resolves to that package's noEmit `tsconfig.json`, emits beside the sources and leaves TS2307 in place), and the consumer `packages/observability/opentelemetry/tsconfig.json` declares the same edge its build config already declares, so root order is irrelevant; the same command from the same state exits 0.
- [x] 0.4b.5 Tracker: Gates row of the holds gate gains the remove-when red (modified gate, red re-proven on the complete step); M7 stays `1/1`; WU rows; Decisions log records the correction · CODE ~8 · slice `refound/0-holds-table-fix`.

### 0.5 · `refound/0-toolchain-types-node` — `@types/node` 24.13.6 and `engines.node` · **BATCH 5**

- [x] 0.5.1 RED WU-T.4(c) · dependency-version-management › Every workspace manifest declares `engines.node` at the runtime major · CODE ~30 · slice `refound/0-toolchain-types-node` — failing check: a manifest without `engines.node`, or with a major different from the runtime, → exit 1 (0 of 98 declare it today).
- [x] 0.5.2 GREEN WU-T.4(c) · testing-toolchain-alignment › `@types/node` tracks the runtime major, downward if necessary, and `engines.node` is declared · CODE ~300 · slice `refound/0-toolchain-types-node` — `@types/node` → the latest MATURE 24.x re-measured on the day (24.13.6 as of 2026-09-27; 24.19.0 matures 2026-10-02) in the catalog, DOWN from 25.9.3 (a major above the runtime and an odd, non-LTS line); `engines.node` `>=24.15.0 <25` (the lowest runtime actually run, the homelab; also the floor jsdom 30 will require) in all 98 workspace manifests; `pnpm exec tsc -b --force` exit 0. The runtime itself stays on the 24 LTS line here; the move to 26 is slice 0.16.
- [x] 0.5.3 **Red proof** · dependency-version-management › Every workspace manifest declares `engines.node` at the runtime major · CODE ~0 · slice `refound/0-toolchain-types-node` — delete one manifest's `engines.node` → complete step exit 1 → restore → re-green.
- [x] 0.5.4 Tracker: Gates row for the engines gate; M7 moves · CODE ~4 · slice `refound/0-toolchain-types-node`.

### 0.6 · `refound/0-toolchain-tsx` · **BATCH 6**

- [x] 0.6.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~25 · slice `refound/0-toolchain-tsx` — tsx → 4.23.13; verify Node 24 type stripping on one `--import tsx` entrypoint and `--conditions development` still resolves workspace sources (module-resolution › Source-mode invocations opt in via `--conditions development` on the command).
- [x] 0.6.2 Tracker: T.4 table row · CODE ~4 · slice `refound/0-toolchain-tsx`.

### 0.7 · `refound/0-toolchain-browser` — Playwright 1.63.0 + axe 4.13.0 · **BATCH 7**

- [x] 0.7.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~50 · slice `refound/0-toolchain-browser` — bump `@playwright/test` and `@axe-core/playwright`; run `playwright install --with-deps chromium` for the new version and `playwright test --list` on both configs unchanged.
- [x] 0.7.2 Tracker: T.4 table row · CODE ~4 · slice `refound/0-toolchain-browser`.

### 0.8 · `refound/0-toolchain-msw` · **BATCH 8**

- [x] 0.8.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~25 · slice `refound/0-toolchain-msw` — msw → 2.15.0; confirm `getResponse` is still the documented public export the sidecar (design §2g) depends on.
- [x] 0.8.2 Tracker: T.4 table row · CODE ~4 · slice `refound/0-toolchain-msw`.

### 0.9 · `refound/0-toolchain-rtl` · **BATCH 9**

- [x] 0.9.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~50 · slice `refound/0-toolchain-rtl` — `@testing-library/react` + `jest-dom` + `user-event` to latest mature; `pnpm --filter @apps/client test` and `--filter @apps/admin test` green.
- [x] 0.9.2 Tracker: T.4 table row · CODE ~4 · slice `refound/0-toolchain-rtl`.

### 0.10 · `refound/0-toolchain-vitest-plugin` · **BATCH 10**

- [ ] 0.10.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~25 · slice `refound/0-toolchain-vitest-plugin` — `@vitest/eslint-plugin` → 1.6.27, compatible with the vitest 4.1.11 hold; no rule enabled yet (that is WU-2.4).
- [ ] 0.10.2 Tracker: T.4 table row · CODE ~4 · slice `refound/0-toolchain-vitest-plugin`.

### 0.11 · `refound/0-toolchain-storybook` — the tool no workflow runs leaves, and Jest with it · **BATCH 11**

- [ ] 0.11.1 **Measured** WU-T.4(d) · testing-toolchain-alignment › A test tool no workflow runs is removed, and Jest leaves the tree with it · plan T.4(d) · CODE ~10 · slice `refound/0-toolchain-storybook` — prove no workflow and no script runs `@storybook/test-runner` (admin declares it; `apps/client/package.json` has a `storybook:test` script without the package).
- [ ] 0.11.2 GREEN WU-T.4(d) · testing-toolchain-alignment › A test tool no workflow runs is removed, and Jest leaves the tree with it · CODE ~40 · slice `refound/0-toolchain-storybook` — remove it; confirm jest 30.4.2, nyc 15.1.0, `@types/node@26.0.0`, jest-process-manager and wait-on leave the lockfile with it; remove the orphan `storybook:test` script.
- [ ] 0.11.3 WU-T.4(d) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · CODE ~20 · slice `refound/0-toolchain-storybook` — the Storybook family hold looks expired (10.6.0, 25 days, peers accept next ^16): either bump the family validated empirically or rewrite the hold with a measured reason.
- [ ] 0.11.4 WU-T.4(e) · dependency-version-management › Pinned DIRECT versions are the latest stable release, with no pre-releases · CODE ~10 · slice `refound/0-toolchain-storybook` — after the removal, check the `GHSA-q7cg` ignore is now dead and delete it if `pnpm audit` is clean without it.
- [ ] 0.11.5 Tracker: T.4 table rows; M13-adjacent tooling counts · CODE ~4 · slice `refound/0-toolchain-storybook`.

### 0.12 · `refound/0-toolchain-jsdom` — **[HUMAN GATE H1]** · **BATCH 12**

- [ ] 0.12.1 **[HUMAN GATE H1]** WU-T.4 · testing-toolchain-alignment › A bump that crosses into production or raises the runtime floor is its own decision · CODE ~0 · slice `refound/0-toolchain-jsdom` — present to Edward, with the measured facts: jsdom 30 requires Node `^24.15.0` (raises `engines.node`), depends on `undici ^8` (the `undici >=7 <7.29` CVE override stops applying to that chain → re-audit), and jsdom 29.1.1 is **also** a production transitive through `isomorphic-dompurify@3.19.0` (4.4.0 wants jsdom ^30 → a production major). STOP and wait for the decision.
- [ ] 0.12.2 WU-T.4 · dependency-version-management › Every audited ignore and floor names the chain that actually delivers the package · CODE ~60 · slice `refound/0-toolchain-jsdom` — **only if H1 approves**: bump jsdom + `isomorphic-dompurify`, raise `engines.node` to `>=24.15.0`, re-audit the `undici` override chain, record the decision. If H1 declines: write the hold with the measured reason instead (CODE ~20).
- [ ] 0.12.3 Tracker: Decisions log row for H1 either way · CODE ~4 · slice `refound/0-toolchain-jsdom`.

### 0.13 · `refound/0-toolchain-vite-shims` · **BATCH 13**

- [ ] 0.13.1 WU-T.4(e) · dependency-version-management › Pinned DIRECT versions are the latest stable release, with no pre-releases · CODE ~15 · slice `refound/0-toolchain-vite-shims` — clean reinstall; verify `node_modules/.bin/vite` resolves to the single vite 8 and the 86 dead shims are gone.
- [ ] 0.13.2 Tracker: T.4 table closes at 0 lags without a reason · CODE ~4 · slice `refound/0-toolchain-vite-shims`.

### 0.14 · `refound/0-toolchain-build` — the build and format six · **BATCH 14** (re-plan 2026-09-27: can wait; tail of Phase 0)

- [ ] 0.14.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~40 · slice `refound/0-toolchain-build` — re-measure latest mature on the day for `vite`, `turbo`, `webpack`, `cross-env`, `jiti`, `prettier`; bump each catalog entry; validate empirically: `pnpm exec tsc -b --force`, `pnpm -r build` for the packages that emit, `pnpm lint --max-warnings 0`, the api unit suite; if the prettier bump reformats files, run `pnpm format` and commit the reformat as its own EVIDENCE commit with `pnpm format:check` green after it.
- [ ] 0.14.2 WU-T.4(f) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · CODE ~6 · slice `refound/0-toolchain-build` — delete the grouped build-tooling hold row from `docs/security/SECURITY_CANON.md`; `node scripts/testing/holds-gate.mjs` exit 0.
- [ ] 0.14.3 Tracker: T.4 table rows move; WU row ✅ · CODE ~4 · slice `refound/0-toolchain-build`.

### 0.15 · `refound/0-toolchain-quality-gates` — the quality-gate eleven · **BATCH 15** (re-plan 2026-09-27: can wait; tail of Phase 0)

- [ ] 0.15.1 WU-T.4(b) · testing-toolchain-alignment › Each family moves as one PR, validated empirically, at the minimal mature version · CODE ~60 · slice `refound/0-toolchain-quality-gates` — re-measure latest mature on the day for `knip`, `jscpd`, `dependency-cruiser`, `secretlint` + its preset, `size-limit` + its preset, `@ast-grep/cli`, `lint-staged`, `@hey-api/openapi-ts`, `@faker-js/faker`; bump each; re-run every gate they back (`node scripts/knip-ratchet.mjs` — shrink the ledger ONLY for findings the bump resolves, never regenerate it to absorb new ones; jscpd, madge and dependency-cruiser from the Code Quality job; secretlint; size-limit; the api-types generation); a gate that changes its verdict after a bump is a finding to fix, not to baseline.
- [ ] 0.15.2 WU-T.4(f) · testing-toolchain-alignment › Every lag below latest mature carries a documented hold, and a gate proves it · CODE ~6 · slice `refound/0-toolchain-quality-gates` — delete the grouped quality-gate hold row from `docs/security/SECURITY_CANON.md`; `node scripts/testing/holds-gate.mjs` exit 0.
- [ ] 0.15.3 Tracker: T.4 table rows move; WU row ✅; Phase 0 closes · CODE ~4 · slice `refound/0-toolchain-quality-gates`.

### 0.16 · `refound/0-runtime-node-26` — runtime major → Node 26 LTS · **BATCH 16** (re-plan 2026-09-28, Edward: can wait; tail of Phase 0; not before 2026-10-28, the day Node 26 enters Active LTS per the Node.js release schedule — Node 24 enters Maintenance on 2026-10-20; the runtime follows LTS, never Current)

- [ ] 0.16.1 **Measured** · dependency-version-management › Every workspace manifest declares `engines.node` at the runtime major · CODE ~10 · slice `refound/0-runtime-node-26` — on the day: Node 26 is Active LTS (release schedule); the latest 26.x is mature (7 days); prebuilt binaries for the Node 26 ABI exist for `argon2` and `sharp` at their pinned versions, or the image build compiles them and proves it; `@prisma/client`, `fastify`, `next`, `bullmq` and `ioredis` engines admit 26 (today every one declares only a lower bound that covers 26 by range, not by proof); `@types/node` 26.x latest mature. Every finding to the tracker.
- [ ] 0.16.2 RED · dependency-version-management › Every workspace manifest declares `engines.node` at the runtime major · CODE ~0 · slice `refound/0-runtime-node-26` — with the runtime still on 24, plant `engines.node` at the 26 range in one manifest → the engines gate from 0.5 exits 1 naming it (the gate must refuse a manifest ahead of the runtime as loudly as one behind it).
- [ ] 0.16.3 GREEN · testing-toolchain-alignment › `@types/node` tracks the runtime major, downward if necessary, and `engines.node` is declared · CODE ~40 · slice `refound/0-runtime-node-26` — `.nvmrc` → 26; the three Dockerfiles move base and distroless images to the Node 26 line, the distroless one by digest; `engines.node` at the 26 range in every manifest; `@types/node` → latest mature 26.x in the catalog; homelab bumped; full quality gate 0/0, the integration tier green on 26, and the image builds green — the image half waits for the containerization pause to lift, so this slice depends on it.
- [ ] 0.16.4 Tracker: T.4 table row; Gates row; a Decisions entry (D24 or the next free id — D23 is the 2026-09-28 runtime-line decision recorded by 0.5) records the move (LTS only, never Current; 24 → 26 on the LTS date) · CODE ~4 · slice `refound/0-runtime-node-26`.

---

## Phase P — Parallel-ready slices (design §7.2 — no dependency on Phase 1)

### P.1 · `refound/3-fitness-inventory` (PR V1)

- [x] P.1.1 RED WU-3.1 · merge-verdict-composition › The fitness inventory is contiguous, and its count is derived (#44) · design §2h · CODE ~15 · slice `refound/3-fitness-inventory` — failing check: the ordered list of `^      - name: "#([0-9]+) ` across all jobs must equal `seq 1 N`, the `# N.` headings of `CLAUDE.md` §Automated Compliance Checks must be the same set, and `CLAUDE.md`'s "There are **N checks**" sentence must state the derived N.
- [x] P.1.2 GREEN WU-3.1 · merge-verdict-composition › The fitness inventory is contiguous, and its count is derived (#44) · CODE ~45 · slice `refound/3-fitness-inventory` — turn the "Fitness summary" step into gate #44; print the derived N; every `::error` paired with `exit 1` (#34's own rule).
- [x] P.1.3 **Red proof** ×3 · testing-canon-and-tracker › Every new or modified gate is recorded with its demonstrated red · CODE ~0 · slice `refound/3-fitness-inventory` — (a) rename #42 → #41 → exit 1; (b) delete the `# 5.` heading → exit 1; (c) change the count sentence → exit 1; each byte-exact restored.
- [x] P.1.4 Tracker: Gates row #44; M7 moves · CODE ~4 · slice `refound/3-fitness-inventory`.

### P.2 · `refound/3-reporters` (PR V2)

- [x] P.2.1 RED WU-3.2 · merge-verdict-composition › Every layer emits a named, readable report — a shard is never blind · design §2e · CODE ~10 · slice `refound/3-reporters` — failing test for `workspaceReporters(env)`: `["default"]`, `+github-actions` when `GITHUB_ACTIONS==="true"`, `+blob` when `VITEST_SHARDED==="true"`.
- [x] P.2.2 GREEN WU-3.2 · merge-verdict-composition › Every layer emits a named, readable report — a shard is never blind · CODE ~30 · slice `refound/3-reporters` — export `workspaceReporters()` from `packages/vitest-shared/src/index.ts`; the factory sets `test.reporters`; drop `--reporter=blob` from the shard command; `turbo.json` gains `passThroughEnv: ["GITHUB_ACTIONS","VITEST_SHARDED","CI"]` (Turbo strict env).
- [x] P.2.3 **Red proof** WU-3.2 · merge-verdict-composition › Every layer emits a named, readable report — a shard is never blind · CODE ~0 · slice `refound/3-reporters` — plant `expect(1).toBe(2)`, run the exact shard command with `VITEST_SHARDED=true` → exit 1, the log names file+test+diff, the blob still exists where the upload reads it → restore.
- [x] P.2.4 Tracker: M2 note (shard is no longer blind); Gates row · CODE ~4 · slice `refound/3-reporters`.

### P.3 · `refound/3-openapi-drift` (PR V3)

- [ ] P.3.1 WU-3.3 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · design §2h · CODE ~60 · slice `refound/3-openapi-drift` — move the drift steps out of the `test` job into a standalone `openapi-drift` job named "OpenAPI Drift", no `needs`, no `if`, keeping its `services` (the generator connects).
- [ ] P.3.2 **Red proof** WU-3.3 · CODE ~0 · slice `refound/3-openapi-drift` — on a scratch branch add a field to a response schema without regenerating → the complete step exits 1 printing `git diff --stat` → restore.
- [ ] P.3.3 Tracker: Gates row; the context is added to the mirror ruleset when 1.13 lands · CODE ~4 · slice `refound/3-openapi-drift`.

### P.4 · `refound/3-gitleaks` (PR V6)

- [x] P.4.1 WU-3.6 · merge-verdict-composition › The secret scan reads the pull request's commits, and fails closed on an empty scan · CODE ~20 · slice `refound/3-gitleaks` — `gitleaks git --config .gitleaks.toml --log-opts="${BASE}..${HEAD}" --no-banner --redact --verbose | tee log` with `set -o pipefail`; fail closed when "N commits scanned" < 1; verify every flag against the pinned v8.30.0.
- [x] P.4.2 **Red proof** WU-3.6 · CODE ~0 · slice `refound/3-gitleaks` — in a throwaway clone under the scratchpad, commit a planted token with `--no-verify` and run the exact step with those SHAs → exit 1; run the OLD `protect --staged` form over the same clone → exit 0 (evidence the old gate was blind).
- [x] P.4.3 Tracker: Gates row · CODE ~4 · slice `refound/3-gitleaks`.

### P.5 · `refound/3-osv-measure` (PR V7a) — measurement only

- [ ] P.5.1 **Measured** WU-3.7(a) · merge-verdict-composition › A required gate either can fail or is removed — measured, then decided · CODE ~30 · slice `refound/3-osv-measure` — run `osv-scanner` JSON and `pnpm audit --json` over one commit; classify the ~90 findings (severity, GHSA alias, present in the audited ignores, dev-only) into the tracker table. EVIDENCE ~200.
- [ ] P.5.2 Tracker: the OSV classification table; the keep-or-delete branch for 3.7 is now decidable · CODE ~4 · slice `refound/3-osv-measure`.

### P.6 · `refound/4b-env-write` (PR E1)

- [ ] P.6.1 RED WU-4b.1 · test-environment-contract › One script owns the environment, and it starts no datastore · design §2c · CODE ~60 · slice `refound/4b-env-write` — the bats suite `scripts/testing/test-env.bats`: a missing `services` input exits naming the key; `env hermetic` writes the `127.0.0.1:1` URLs; the generated key set equals the documented set; `ENABLE_RATE_LIMITING=false` is present in **both** profiles.
- [ ] P.6.2 GREEN WU-4b.1 · test-environment-contract › One script owns the environment, and it starts no datastore · design §2c · CODE ~220 · slice `refound/4b-env-write` — create `scripts/test-env.sh` with `env <hermetic|services>`, absorbing byte-exact from `scripts/ci-setup-test-env.sh` the `:?` refusals with their CWE-798/#15 rationale, the 32-byte /dev/zero key derivation (design §2c's exact wording), the printed-phrase digest ring and the three-way single-quoting comparison; identity constants of design §2c; write `.env.test` with the GENERATED header and every documented key; mirror the connection keys into `$GITHUB_ENV` when set; repoint every caller and delete `scripts/ci-setup-test-env.sh` in this same PR.
- [ ] P.6.3 WU-4b.1 · test-environment-contract › Test queues and test ports cannot collide with a running development stack · CODE ~20 · slice `refound/4b-env-write` — ports dev+10 (API 3010, admin 3110, client 3210, workers metrics 3310, sidecar 3410), Redis logical DB 15; `.env.test.example` documents ONLY the required inputs; `.gitignore` gains `.test-env/`; `turbo.json` `test` / `test:coverage` env gains `MIGRATE_DATABASE_URL` and loses `TEST_DATABASE_URL` (0 uses).
- [ ] P.6.4 **Red proof** ×3 WU-4b.1 · test-environment-contract › The hermetic profile makes an accidental service dependency fail fast · design §5 · CODE ~0 · slice `refound/4b-env-write` — (a) missing input → exit ≠ 0 naming the key; (b) under hermetic a planted package test that connects with `pg` fails in < 5 s with `ECONNREFUSED 127.0.0.1:1`; (c) remove a key from `.env.test.example` → the identity gate (1.14/4b.7) exits 1 — recorded here, enforced there.
- [ ] P.6.5 Tracker: M15 (Postgres identities in workflows) begins to move; Gates rows · CODE ~4 · slice `refound/4b-env-write`.

### P.7 · `refound/2-classifier` — one classifier, both frameworks

- [ ] P.7.1 RED WU-2.1 · decorative-test-demolition › The classifier is a tested workspace package, calibrated on both frameworks · design §2b/DD-3 · CODE ~100 · slice `refound/2-classifier` — fixtures with a positive AND a negative case per class per framework (including `apps/api/tests/unit/auditMiddleware.test.ts:274` and `webhookHandler.stats.test.ts:355`), plus the `fileContextHash` tests: it changes when a hook changes and does NOT change when a block body changes (DD-5).
- [ ] P.7.2 GREEN WU-2.1 · decorative-test-demolition › "Decorative" is one of four stated criteria, proven per file · design §2b · CODE ~230 · slice `refound/2-classifier` — `packages/eslint-plugin-testing` (ESM, the `@ts-check` directive, jiti- and node-loadable, no build script) exporting `classifyFile(text, fileName)` over `ts.createSourceFile`; AssertionClass TAUTOLOGY/EXISTENCE/SNAPSHOT/BEHAVIOURAL/OPAQUE; BlockClass EMPTY/TAUTOLOGY-ONLY/EXISTENCE-ONLY/CONDITIONAL-ONLY/SELF-SKIP/PRINTS-SUCCESS/TITLE-CONTRADICTION/BEHAVIOURAL; the criterion map (a)/(c)/(d). EVIDENCE ~250.
- [ ] P.7.3 Tracker: M3 denominator (≤ 272 decorative blocks) is now derivable · CODE ~4 · slice `refound/2-classifier`.

### P.8 · `refound/2-ledger-a` — scan, reach and JSON

- [ ] P.8.1 RED WU-2.2a · decorative-test-demolition › The ledger is deterministic, re-derivable, and predicts the drop · design §2b · CODE ~60 · slice `refound/2-ledger-a` — golden `ledger.json` over a fixture tree; an edited golden makes `--check` exit 1; the output is sorted and carries no timestamps.
- [ ] P.8.2 GREEN WU-2.2a · decorative-test-demolition › The ledger is deterministic, re-derivable, and predicts the drop · design §2b/DD-4 · CODE ~200 · slice `refound/2-ledger-a` — `scripts/testing/ledger.mjs` + `scripts/testing/lib/*.mjs` run under `node --conditions development --import tsx`, importing `collectorOf` from the reach engine (one router, DD-4); discovery by `git ls-files` over workspaces + `security/` + `performance/`, the `.disabled` / `.old` / `.bak` suffixes, `tests/run*.ts` runners and helper candidates; per-row blocks by class; writes `docs/development/testing-refoundation/ledger.json`.
- [ ] P.8.3 Tracker: M4/M6 rows become derivable · CODE ~4 · slice `refound/2-ledger-a`.

### P.9 · `refound/2-ledger-b` — duplicates, dead helpers, overlay, `--area`

- [ ] P.9.1 RED WU-2.2b · decorative-test-demolition › The ledger is deterministic, re-derivable, and predicts the drop · CODE ~50 · slice `refound/2-ledger-b` — test that `--area <glob>` prints the exact `file:line:title` list and the expected count drop, and that `probe.stale` counts keys whose `fileContextHash` no longer matches.
- [ ] P.9.2 GREEN WU-2.2b · decorative-test-demolition › "Decorative" is one of four stated criteria, proven per file · design §2b · CODE ~180 · slice `refound/2-ledger-b` — SUBJECT-NOT-IMPORTED (b); duplicates by multiset of normalised titles (EXACT-DUPLICATE, DUPLICATE-UNION at ≥ 5 contained titles) confirmed by AST body hash; dead helpers (0 importers resolving `.js`→`.ts`, index, subpaths); STALE; machine verdict DELETE/REWRITE/KEEP/ADJUDICATE; the `adjudications.json` human overlay merged at generation; `LEDGER.md` rendered.
- [ ] P.9.3 Acceptance WU-2.2b · decorative-test-demolition › The ledger is deterministic, re-derivable, and predicts the drop · CODE ~0 · slice `refound/2-ledger-b` — reproduce the plan's Appendix C (105 files / 272 blocks as an upper bound, or an explained difference) in < 60 s.
- [ ] P.9.4 Tracker: M4/M6 Baseline filled from the first real run · CODE ~4 · slice `refound/2-ledger-b`.

### P.10 · `refound/2-probe` — the hard probe in an isolated worktree

- [ ] P.10.1 RED WU-2.3 · decorative-test-demolition › The hard probe runs in an isolated worktree and never mutates the working tree · design §2b/DD-22 · CODE ~80 · slice `refound/2-probe` — fixture repository under a temporary probe root with one vacuous and one behavioural test over one subject: gutting turns the behavioural test RED and leaves the vacuous one GREEN; LOAD-ERROR on a subject that fails to import; the invoking tree's porcelain is unchanged across a run.
- [ ] P.10.2 RED **threat matrix — git repository selection** · decorative-test-demolition › The hard probe runs in an isolated worktree and never mutates the working tree · design §5 · CODE ~30 · slice `refound/2-probe` — `hard-probe` invoked from a cwd outside any git repository (the system temporary directory) exits 2; `HARD_PROBE_ROOT` pointing inside the repository exits 2 naming it; an override that is not absolute, existing and writable exits 2.
- [ ] P.10.3 RED **threat matrix — worktree lifecycle** · decorative-test-demolition › The hard probe runs in an isolated worktree and never mutates the working tree · design §5 · CODE ~40 · slice `refound/2-probe` — SIGTERM mid-run leaves no registered worktree and no directory; a stale registered entry with a missing directory is pruned and the probe proceeds; a stale entry with a present dirty directory exits 1 naming it; two concurrent probes under one root → the second exits 1 naming the lock.
- [ ] P.10.4 RED **threat matrix — commit state** · decorative-test-demolition › The hard probe runs in an isolated worktree and never mutates the working tree · design §5 · CODE ~20 · slice `refound/2-probe` — a probe that leaves a dirty worktree (simulated) exits 1 naming the file.
- [ ] P.10.5 GREEN WU-2.3 · decorative-test-demolition › The hard probe runs in an isolated worktree and never mutates the working tree · design §2b/DD-22 · CODE ~200 · slice `refound/2-probe` — `scripts/testing/hard-probe.mjs`: probe root per environment (CI `$RUNNER_TEMP/hard-probe/<run-id>`, homelab `<repo-parent>/<repo-name>-worktrees/hard-probe-<pid>`, `HARD_PROBE_ROOT` validated); `git worktree add --detach <dir> HEAD`; `pnpm install --offline --frozen-lockfile`; subject = the test's first-party imports into `src/`; gutting with `ts.transform`; run only that block; GREEN/RED/LOAD-ERROR; restore and assert empty porcelain; `trap` remove+prune; lock file per root.
- [ ] P.10.6 WU-2.3 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · design §DD-5 · CODE ~30 · slice `refound/2-probe` — `probes.json` keyed `<fileContextHash>:<bodyHash>:<subjectHash>` with `path::title` as display, so evidence survives `git mv` and dies on any block, subject or file-context edit; sampling = every EXISTENCE-ONLY/CONDITIONAL-ONLY/TITLE-CONTRADICTION block in ADJUDICATE files + a seeded 5 % of BEHAVIOURAL.
- [ ] P.10.7 Tracker: Gates rows for the four threat-matrix REDs; M7 moves · CODE ~4 · slice `refound/2-probe`.

---

## Phase 1 — Reach contract (design §7.3)

### 1.1 · `refound/1-suffix` (PR R1) — free the `.integration` suffix, name the k6 files

- [ ] 1.1.1 WU-1.1 · test-reach-contract › The filename suffix is the collector router · design §2a · CODE ~10 · slice `refound/1-suffix` — `git mv` the 24 `apps/client/tests/integration/*.integration.test.tsx`, the 2 under `apps/api/tests/unit`, and the 4 provider stubs → `*.test.ts(x)`; `performance/k6/scenarios/*.js` → `*.k6.js`; repoint `performance.yml`, the root `perf:api` script and `run-performance-tests.sh`. EVIDENCE ~2,400 (renames at 100 % similarity).
- [ ] 1.1.2 Acceptance WU-1.1 · test-reach-contract › The filename suffix is the collector router · CODE ~0 · slice `refound/1-suffix` — `git ls-files '*.integration.test.*'` lists only node:test files under `apps/api/tests`; `vitest list --filesOnly` per package identical before and after (832).
- [ ] 1.1.3 Tracker: M5 (files with 2 collectors) and M1 rows · CODE ~4 · slice `refound/1-suffix`.

### 1.2 · `refound/1-factory-converge` (PR R2) — reserved suffixes and the four factory migrations (DD-20)

- [ ] 1.2.1 RED WU-1.2 · test-reach-contract › The filename suffix is the collector router · design §2e · CODE ~30 · slice `refound/1-factory-converge` — failing tests for `defineWorkspaceVitestConfig`: `RESERVED_TIER_EXCLUDES` appended to `configDefaults.exclude`; a planted `apps/api/tests/unit/x.integration.test.ts` is NOT listed by `vitest list`.
- [ ] 1.2.2 RED WU-1.2 · shared-test-tooling › The tooling is three packages, not one, and production never imports them · design §DD-20 · CODE ~40 · slice `refound/1-factory-converge` — failing tests for the refusals: overriding a **factory-owned key** (`test.reporters`, `coverage.provider`, `coverage.reporter`, `coverage.reportsDirectory`, `coverage.include`, `resolve.alias`) THROWS naming the option to use instead; `coverageInclude` omitted with no `<packageDir>/src` THROWS "pass coverageInclude"; `setupFiles` and `exclude` concatenate deduplicated with factory entries first; `localAliases` precede the derived map.
- [ ] 1.2.3 GREEN WU-1.2 · test-reach-contract › The filename suffix is the collector router · design §2e · CODE ~70 · slice `refound/1-factory-converge` — export `RESERVED_TIER_EXCLUDES`, `SHARED_COVERAGE_EXCLUDE`, `ratchetFloor` (moved from `apps/api/vitest.config.ts`) and the `WorkspaceVitestOptions` (`localAliases`, `coverageInclude`) from `packages/vitest-shared/src/index.ts`; implement the refusals; keep `:1-11`, `:51-60`, `:77-123`, `:146-151` byte-exact.
- [ ] 1.2.4 GREEN WU-1.2 · test-reach-contract › The filename suffix is the collector router · design §2e table · CODE ~110 · slice `refound/1-factory-converge` — migrate the **four** configs that sit outside the factory today to the factory: `apps/api/vitest.config.ts`, `apps/workers/vitest.config.ts` (its hand alias map and its own `findMonorepoRoot` are deleted), `apps/admin/vitest.config.ts` and `apps/client/vitest.config.ts` (each keeping `plugins: [react()]`, `environment: "jsdom"`, its own `setupFiles` entry, its excludes and its `localAliases`); both Playwright configs get `testMatch: "**/*.spec.ts"`; the convention table lands in `docs/development/CODING_STANDARDS.md` §Test Framework Rules.
- [ ] 1.2.5 **Red proof** WU-1.2 · test-reach-contract › The filename suffix is the collector router · CODE ~0 · slice `refound/1-factory-converge` — plant `apps/api/tests/unit/x.integration.test.ts` with a vitest test → `vitest list` does not list it; a config that passes `test.reporters` fails at load naming the rule; `apps/admin` with `coverageInclude` omitted fails at load naming the option → restore all three.
- [ ] 1.2.6 Tracker: Gates rows (factory refusals); M5 · CODE ~4 · slice `refound/1-factory-converge`.

### 1.3 · `refound/1-resolution` (PR R2b) — source resolution in node and jsdom (DD-11)

- [ ] 1.3.1 **Measured** WU-1.2b · module-resolution › The unit runner resolves alias-less workspace packages from `src` · design §2e/DD-11 · CODE ~20 · slice `refound/1-resolution` — measure which vitest-collected tests import the 18 alias-less workspace packages bare (they resolve through `exports` to `dist` today).
- [ ] 1.3.2 RED WU-1.2b · module-resolution › The unit runner resolves alias-less workspace packages from `src` · design §DD-11 · CODE ~40 · slice `refound/1-resolution` — the assertion "every workspace package a collected test imports resolves under `src/`", run in **one node config and in `apps/admin`** (jsdom); red-proof: delete an alias or the condition → the import resolves to a nonexistent `dist` and the test fails naming the package, in both environments.
- [ ] 1.3.3 GREEN WU-1.2b · module-resolution › The unit runner resolves alias-less workspace packages from `src` · CODE ~80 · slice `refound/1-resolution` — the factory writes `development` into **both** `resolve.conditions` and `ssr.resolve.conditions` (spelling verified on 4.1.11) and keeps the derived alias map.
- [ ] 1.3.4 Tracker: Gates row (resolution assertion); Decisions log for the `ssr.*` vs `resolve.*` finding · CODE ~4 · slice `refound/1-resolution`.

### 1.4 · `refound/1-double-collection` (PR R3) — remove double collection and subset entrypoints

- [ ] 1.4.1 WU-1.3 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · design §6 · CODE ~250 · slice `refound/1-double-collection` — delete `.github/workflows/eval.yml`; delete the `custom-security-tests` job from `.github/workflows/security-testing.yml` (its cases already run as app role with rate limiting, stricter than that job's owner connection); delete the 26 node:test subset scripts plus `test:eval` and `test:ratelimit` from `apps/api/package.json`. EVIDENCE ~300.
- [ ] 1.4.2 Acceptance WU-1.3 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · CODE ~0 · slice `refound/1-double-collection` — no `test:(auth|rbac|security|mfa|ratelimit|eval|plan|category)` reference remains in `.github` or `apps/api/package.json`; the "files with >1 collector" metric goes 10 → 0.
- [ ] 1.4.3 Tracker: M5 second column reaches 0 · CODE ~4 · slice `refound/1-double-collection`.

### 1.5 · `refound/1-timing-in-tests` (PR R4) — timing and ordering move into the tests

- [ ] 1.5.1 WU-1.4 · test-reach-contract › Timing and ordering needs live in the test, not in the runner · design §DD-14 · CODE ~25 · slice `refound/1-timing-in-tests` — `describe(name, { timeout })` at the top of the nine files that need it (hard-delete race and the saga suites 120 s, the customer saga 180 s, publish/analytics/media/schedule.flow 60 s), taking the values from the runner's current per-batch `TIMEOUT`.
- [ ] 1.5.2 WU-1.4 · integration-tier-preconditions › A test that contaminates shared state restores it · CODE ~10 · slice `refound/1-timing-in-tests` — in `apps/api/tests/security.test.ts` add an `after()` to "Advanced Rate Limiting" that waits for `${TEST_API_URL}/health` → 200, bounded by `Retry-After` / `X-RateLimit-Reset` + 5 s (90 s cap), and throws if the window does not reopen.
- [ ] 1.5.3 **Red proof** ×2 WU-1.4 · integration-tier-preconditions › A test that contaminates shared state restores it · CODE ~0 · slice `refound/1-timing-in-tests` — without the `after()` the `production` sequence fails with 429 (proving the ordering coupling was real); with `{ timeout: 120_000 }` a planted `sleep(45_000)` passes under `--test-timeout=30000` and fails without the option → restore.
- [ ] 1.5.4 Tracker: M9 note (the two ordering hacks are retired) · CODE ~4 · slice `refound/1-timing-in-tests`.

### 1.6 · `refound/1-tier-measure` (PR R5a) — measure the tier of the 100 node:test files

- [ ] 1.6.1 **Measured** WU-1.5 · integration-tier-preconditions › Dark suites are admitted by MEASURED tier, never by a guess · plan WU-1.5 · CODE ~0 · slice `refound/1-tier-measure` — run each of the 100 files alone with Postgres/Redis up and API/workers **down**: passes with 0 skips → `.integration`; otherwise → `.live`; also record which pass with the services down (hermetic candidates feeding the ledger and X1). EVIDENCE ~250 (the measured table).
- [ ] 1.6.2 Tracker: the measured tier table; M9 Baseline · CODE ~4 · slice `refound/1-tier-measure`.

### 1.7 · `refound/1-tier-rename` (PR R5b) — commit the measured tiers

- [ ] 1.7.1 WU-1.5 · integration-tier-preconditions › Dark suites are admitted by MEASURED tier, never by a guess · CODE ~110 · slice `refound/1-tier-rename` — `git mv` the 100 files to the tier **1.6.1 measured**; repoint the runner's paths, the constants in `sagaContextInvariants.static.test.ts` and `sagaLiveSuitePrecondition.static.test.ts`, the RLS table in `CLAUDE.md`, and ~28 docs (lychee); re-key `apps/api/tests-typecheck-baseline.json` with `typecheck-tests-ratchet.mjs --write`. EVIDENCE ~9,000 (renames).
- [ ] 1.7.2 Acceptance WU-1.5 · CODE ~0 · slice `refound/1-tier-rename` — Integration Tests green with the same per-batch counts; the typecheck ledger diff is a pure rename (same `TScode` multiset per path); the old #30 baseline still reads 20.
- [ ] 1.7.3 Tracker: M1/M9 rows · CODE ~4 · slice `refound/1-tier-rename`.

### 1.8 · `refound/1-runner-envfix` (PR R6) — **A1 only**: the runner stops guessing a database

- [ ] 1.8.1 RED WU-1.6 · test-reach-contract › The integration collector is a collector only, and refuses to guess a database · design §2d/A1 · CODE ~20 · slice `refound/1-runner-envfix` — **threat matrix — destructive database target**: `TIER=pr-integration` with an empty `DATABASE_URL` must exit 2 naming `scripts/test-env.sh integration` **before any file runs**.
- [ ] 1.8.2 GREEN WU-1.6 · test-reach-contract › The integration collector is a collector only, and refuses to guess a database · CODE ~110 · slice `refound/1-runner-envfix` — delete the `.env` sourcing from `apps/api/scripts/run-tests.sh` (it could send integration at the dev database) and replace it with that refusal; delete the vitest phase and `run_vitest_phase`, and the vitest cases of `runTestsGate.static.test.ts`; `apps/api/package.json` `test:all` = `pnpm test && pnpm test:integration`. **`full-integration` is still accepted here** — its refusal lands with the recipe in 1.11 (design §7.3, so Integration Tests is never red in between).
- [ ] 1.8.3 **Red proof** WU-1.6 · CODE ~0 · slice `refound/1-runner-envfix` — run the complete step with an empty `DATABASE_URL` and `TIER=pr-integration` → exit 2, nothing ran → restore byte-exact.
- [ ] 1.8.4 Tracker: Gates row (A1 data-loss refusal); M7 · CODE ~4 · slice `refound/1-runner-envfix`.

### 1.9 · `refound/1-services-collector` (PR R7) — collect the services tier by convention

- [ ] 1.9.1 RED WU-1.7 · test-reach-contract › One execution unit per file, and the services tier runs serially · design §2d · CODE ~60 · slice `refound/1-services-collector` — rewrite `runTestsGate.behavior.test.ts` so the stub `node` receives ONE file per call ("batches printed failed" → "units"), plus the four guard REDs: (a) an empty `*.integration.test.ts` → exit 1 on zero collected; (b) a throwing `before` → exit 1 on cancel; (c) `t.skip()` under `TIER` → exit 1; (d) an orphan `tests/integration/orphan.test.ts` without a suffix → over the interim #30 baseline → exit 1.
- [ ] 1.9.2 GREEN WU-1.7 · test-reach-contract › One execution unit per file, and the services tier runs serially · CODE ~200 · slice `refound/1-services-collector` — `collect <integration|live>` (`find … -name "*.<suffix>.test.ts" -not -path 'tests/unit/*' | LC_ALL=C sort`, reversible with `TEST_ORDER=reverse`); `run_batch` → `run_file` keeping `:63-157` byte-exact (one path argument, `CONCURRENCY` literal 1, the runner-exit capture, the four per-unit guards, the `not ok` printer) and the gate block `:476-508` byte-exact; `--list` printing `integration\t<path>` / `live\t<path>` / `quarantined\t<path>`; delete the DB batch inventory.
- [ ] 1.9.3 WU-1.7 · test-reach-contract › Quarantine is temporary and only shrinks · design §DD-1 · CODE ~30 · slice `refound/1-services-collector` — `packages/test-contracts/quarantine.json` as a bare sorted array `[{path, reason, owner, since}]` read with `jq`; each entry printed `QUARANTINED (not run): <path> — <reason>` and excluded; seed it with every dark DB suite that fails in CI as app role, each with a reason and an owning WU.
- [ ] 1.9.4 WU-1.7 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · CODE ~30 · slice `refound/1-services-collector` — **interim #30**: the fitness step and `CLAUDE.md` move from `grep -qF "$path" run-tests.sh` to membership in `run-tests.sh --list | cut -f2`; the baseline falls from 20 to the **measured** dark-live + quarantine count (never a predicted number).
- [ ] 1.9.5 Acceptance WU-1.7 · CODE ~0 · slice `refound/1-services-collector` — CI green; tests ≥ baseline + the dark DB suites; 0 skips; the job stays ≤ 15 min; per-file overhead ≤ 60 s over the base run.
- [ ] 1.9.6 **Red proof** ×4 WU-1.7 · CODE ~0 · slice `refound/1-services-collector` — run each of 1.9.1's four cases through the **complete step**, restoring byte-exact after each.
- [ ] 1.9.7 Tracker: M5, M9, and the new interim #30 baseline; Gates rows · CODE ~4 · slice `refound/1-services-collector`.

### 1.10 · `refound/4b-db` (PR E2) — one database identity, and a destructive target refused

- [ ] 1.10.1 RED **threat matrix — destructive database target** WU-4b.2 · test-environment-contract › One Postgres identity, and any database name but the test database is refused · design §2c/DD-23 · CODE ~50 · slice `refound/4b-db` — bats REDs: exporting `MIGRATE_DATABASE_URL=postgresql://…/omnipostdb` in the caller's shell → `db` exits 3 naming the key and `omnipostdb`, nothing migrated; `postgres:16-alpine` → exit 3 naming `vector`; `ALTER ROLE omnipost_app NOLOGIN` after migrate → exit 3 naming the role.
- [ ] 1.10.2 RED WU-4b.2 · test-environment-contract › Migration state is verified, and a contaminated database is named rather than used · CODE ~20 · slice `refound/4b-db` — a row in `_prisma_migrations` with no directory under `infra/prisma/migrations` → exit 8 "reset required", no migration applied.
- [ ] 1.10.3 GREEN WU-4b.2 · test-environment-contract › One Postgres identity, and any database name but the test database is refused · design §2c · CODE ~200 · slice `refound/4b-db` — `test-env.sh db [--reset]`: preflight (owner and app role reach and authenticate; `server_version_num` major 16; `vector` in `pg_available_extensions`; `current_database()` on both connections — stated as structurally unfalsifiable; the DD-23 caller-environment conflict → exit 3), contamination check → exit 8, `--reset` explicit and never implied, then `prisma migrate deploy` as owner, `scripts/db/enable-app-role-login.sh`, seed, `seed:e2e`; every workflow's `services.postgres` collapses onto the single identity.
- [ ] 1.10.4 Acceptance WU-4b.2 · CODE ~0 · slice `refound/4b-db` — every job that touches Postgres goes through one command; "Postgres identities in workflows" 4 → 1.
- [ ] 1.10.5 Tracker: M15 second column reaches 1; Gates rows for the four refusals · CODE ~4 · slice `refound/4b-db`.

### 1.11 · `refound/4b-processes` (PR E3a) — `up | serve | down | liveness | logs | run`

- [ ] 1.11.1 RED **threat matrix — subprocess lifecycle** WU-4b.3 · test-environment-contract › Readiness is probed, and liveness is a verdict · design §2c/§5 · CODE ~70 · slice `refound/4b-processes` — the seven bats REDs: `run` with a command exiting 3 → exit 3 and no listener on 3010 afterwards; SIGINT during `run` → processes gone and the PID dir empty; port 3010 pre-bound → exit 4 naming the port, nothing started; `down` twice → exit 0 both times; a PID file rewritten to a foreign PID → `down` refuses, names "stale", exits 0, the foreign process survives; a broken API env → exit 6 in < 90 s; workers killed mid-run → `liveness` exit 7.
- [ ] 1.11.2 GREEN WU-4b.3 · test-environment-contract › Readiness is probed, and liveness is a verdict · design §2c · CODE ~200 · slice `refound/4b-processes` — `up <api|workers|sidecar>` (background, PID **and** pgid + launch cmdline in `$TEST_ENV_RUN_DIR`, readiness loops copied from the workflow verbatim: API 90 s on the health route, workers 120 s on the readiness route, sidecar 10 s on its calls route); `serve <proc>` (`exec` in foreground, same env; `client|admin` = `next start -p 3210|3110` refused without `.next/BUILD_ID`); `down` (kill the group, ≤ 10 s, then SIGKILL; idempotent; never a stale PID); `liveness`; `logs`; `run [--with a,b] [--before-up "<cmd>"] -- <cmd>` under ONE trap; exit-code vocabulary 2–8 (DD-10).
- [ ] 1.11.3 GREEN WU-4b.3 · test-environment-contract › Test queues and test ports cannot collide with a running development stack · CODE ~20 · slice `refound/4b-processes` — `ENABLE_RATE_LIMITING=true` is exported only into the API child that `up|serve api` starts, never written to `.env.test` (whose both profiles carry `false`); `apps/api/tests/testUtils.ts` reads `TEST_API_URL` and **throws** when it is missing (the `localhost:3000` default is deleted).
- [ ] 1.11.4 **Red proof** ×7 WU-4b.3 · CODE ~0 · slice `refound/4b-processes` — run 1.11.1's seven cases through the complete step; restore byte-exact.
- [ ] 1.11.5 Tracker: Gates rows (7 subprocess REDs); M7 · CODE ~4 · slice `refound/4b-processes`.

### 1.12 · `refound/4b-integration-recipe` (PR E3b) — the phased recipe, in one slice (DD-19)

- [ ] 1.12.1 RED WU-4b.3 + E3 · integration-tier-preconditions › A shared-subject race is closed by topology, not by a sentinel · design §DD-19 · CODE ~40 · slice `refound/4b-integration-recipe` — bats REDs: `run --before-up "exit 3"` → exit 3, nothing started, `down` still ran; port 3010 bound before the DB-only phase → exit 4; the recipe's phase order (before-up carries `TIER=pr-integration`, after-up `TIER=live-integration`).
- [ ] 1.12.2 GREEN WU-4b.3 + E3 · test-environment-contract › One script owns the environment, and it starts no datastore · design §2c/DD-19 · CODE ~100 · slice `refound/4b-integration-recipe` — `run` gains `--before-up "<cmd>"` (after `db`, before `up`, with the API port asserted unbound); the named recipe `test-env.sh integration` = `run --with api,workers --before-up "TIER=pr-integration pnpm --filter @apps/api test:integration" -- TIER=live-integration pnpm --filter @apps/api test:integration`, exporting `TEST_ORDER` into both phases.
- [ ] 1.12.3 GREEN WU-4b.3 + E3 · test-reach-contract › The integration collector is a collector only, and refuses to guess a database · design §2d · CODE ~60 · slice `refound/4b-integration-recipe` — **in this same slice** (design §7.3): `run-tests.sh` gains the `live-integration` TIER case, refuses `full-integration` with exit 2 naming the recipe, and the Integration Tests job in `ci.yml` switches to `bash scripts/test-env.sh integration`; `runTestsGate.behavior.test.ts` gains the `full-integration` → exit 2 case.
- [ ] 1.12.4 **Red proof** ×4 WU-4b.3 · CODE ~0 · slice `refound/4b-integration-recipe` — 1.12.1's three cases plus `TIER=full-integration` → exit 2 naming the recipe; complete step; byte-exact restore.
- [ ] 1.12.5 Tracker: Gates rows; M9 · CODE ~4 · slice `refound/4b-integration-recipe`.

### 1.13 · `refound/1-live-collector` (PR R8) — the live tier onto the convention

- [ ] 1.13.1 RED WU-1.8 · test-reach-contract › One execution unit per file, and the services tier runs serially · design §2d · CODE ~40 · slice `refound/1-live-collector` — REDs: removing 1.5.2's `after()` makes `probe_live` fail before the next live file naming `security.live.test.ts` → exit 1; killing the workers mid-run → exit 1 naming the file.
- [ ] 1.13.2 GREEN WU-1.8 · test-reach-contract › One execution unit per file, and the services tier runs serially · CODE ~200 · slice `refound/1-live-collector` — loop over `collect live`; `probe_live` before EACH live file (`curl -fsS "$TEST_API_URL/health"` and `"$TEST_WORKERS_READY_URL"`), printing `env-unready-before: <file> (last ran: <previous>)` and stopping the tier; delete the live batch inventory including `assert_publish_consumers` and `wait_for_api`; `bash run-tests.sh <path>…` path filters replacing the deleted subset scripts; rewrite `sagaLiveSuitePrecondition.static.test.ts` and `sagaContextInvariants.static.test.ts` to state the new invariants; quarantine the dark live suites that fail, with owners.
- [ ] 1.13.3 Acceptance WU-1.8 · CODE ~0 · slice `refound/1-live-collector` — CI green including the dark live suites that pass; 0 skips; ≤ 15 min; one green `TEST_ORDER=reverse` run recorded in the PR.
- [ ] 1.13.4 **Red proof** ×2 WU-1.8 · CODE ~0 · slice `refound/1-live-collector` — the two cases above through the complete step; restore.
- [ ] 1.13.5 Tracker: M5, M9; Gates rows · CODE ~4 · slice `refound/1-live-collector`.

### 1.14 · `refound/1-reach-engine` (PR R9a) — the engine

- [ ] 1.14.1 GREEN WU-1.9 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · design §2a/DD-21 · CODE ~230 · slice `refound/1-reach-engine` — `packages/test-contracts` (private, source-only, no build script): `src/cli.ts` (`reach|scopes|skips|floors|identity|verdict|denominator`, exit 0/1, `--json`), `src/lib/collectorOf.ts` (the one router), `src/lib/disk.ts` (`git ls-files` + test-shaped filter, fail-closed < 800), `src/lib/vitest-collector.ts` (`createVitest` + `globTestSpecifications()`, fallback `vitest list --filesOnly --json`, fail-closed < 80 configs), `src/lib/node-collector.ts` (`run-tests.sh --list`), `src/lib/playwright-collector.ts`, `src/lib/k6-collector.ts`, `src/lib/registry.ts` (`collectors.json`, `executedBy: []` legal — the collector has no job yet, DD-21), `src/reach.ts` (R1–R3 + parts B and C + the serial-tier invariant + the phase-order check); `pnpm-workspace.yaml` gains `packages/test-utils/*`.
- [ ] 1.14.2 WU-1.9 · test-reach-contract › The reach gate fails closed · design §2a · CODE ~30 · slice `refound/1-reach-engine` — every fail-closed condition: disk < 800, configs < 80, a collector returning 0, a config that does not resolve, a non-empty `executedBy` naming a missing job/workflow, a missing ruleset or one with 0 contexts, an unreadable base quarantine, a phased entry whose recipe cannot be found.
- [ ] 1.14.3 **Measured** WU-1.9 · test-reach-contract › The tier collector reads structured runner EVENTS, not formatted text · design §9 risk 2 · CODE ~20 · slice `refound/1-reach-engine` — verify the Playwright `--list --reporter=json` combined schema against the installed 1.63; if it is not as documented, keep the text `--list` parser with a fail-closed count (record which).
- [ ] 1.14.4 Tracker: Decisions log (Playwright list schema); Gates rows staged · CODE ~4 · slice `refound/1-reach-engine`.

### 1.15 · `refound/1-reach-selftests` (PR R9b) — one planted violation per rule

- [ ] 1.15.1 RED WU-1.9 · test-reach-contract › The reach gate fails closed · design §8 · CODE ~150 · slice `refound/1-reach-selftests` — vitest self-tests over fixture trees under `packages/test-contracts/tests/fixtures/<case>/` with an injected `listFiles()` and injected collector outputs; one test per rule plants its violation and asserts exit ≠ 0 **naming it**: R1 unreached / collected twice; R2 missing job / phase order swapped; R3 quarantine growth / dead entry / collected by an executed collector; part B / part C (including a package config that sets `reporters` in the outer `defineConfig` argument); DD-21 `executedBy: []` with an unquarantined file → exit 1.
- [ ] 1.15.2 RED **threat matrix — documentation-like / executable classification** WU-1.9 · test-reach-contract › The filename suffix is the collector router · design §5 · CODE ~30 · slice `refound/1-reach-selftests` — a fixture tree with all six names: `.test.ts.disabled`, `.old`, `.k6.js` are test-shaped; `.env.test.example`, `*.spec.md`, `README.sh` are not; `*.fixture.ts` / `*.test-helpers.ts` route to `none`; a planted `x.spec.md` is ignored and a planted `y.test.ts.old` is "unreached".
- [ ] 1.15.3 RED **threat matrix — git repository selection** WU-1.9 · test-reach-contract › The reach gate fails closed · design §5 · CODE ~15 · slice `refound/1-reach-selftests` — `reach` from a nested cwd returns the same disk set (every git call runs from the toplevel, never `git -C <user path>`).
- [ ] 1.15.4 Acceptance WU-1.9 · CODE ~0 · slice `refound/1-reach-selftests` — self-tests green in Package Tests; one hand run over the real tree prints the unreached set = the quarantine seed (evidence in the PR).
- [ ] 1.15.5 Tracker: M5; Gates rows for every self-test red · CODE ~4 · slice `refound/1-reach-selftests`.

### 1.16 · `refound/1-test-contracts-job` (PR R10) — wire the new #30, retire the grep ratchet

- [ ] 1.16.1 WU-1.10 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · design §2a · CODE ~60 · slice `refound/1-test-contracts-job` — the `test-contracts` job "Test Contracts" in `.github/workflows/fitness.yml` (checkout `fetch-depth: 0`, node+pnpm cache, hermetic `DATABASE_URL` for Prisma's postinstall) with the `if: always()` step running the reach CLI; delete the old grep step; rewrite `CLAUDE.md` #30 as a script-backed check (description, invocation, limits) and stop stating a baseline there.
- [ ] 1.16.2 WU-1.10 · merge-verdict-composition › The required-context list is versioned in the repository, with an up-to-date-branch policy · design §DD-12 · CODE ~30 · slice `refound/1-test-contracts-job` — commit `.github/rulesets/main.json` as a **mirror** of today's classic required checks with `strict: false`, so R2 has a source before the switch; **[hand checklist]** the PR body states the mirror-vs-classic comparison, because no machine can verify it before PR V11.
- [ ] 1.16.3 **Measured** WU-1.10 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · design §2h · CODE ~10 · slice `refound/1-test-contracts-job` — read `GET /repos/{o}/{r}/commits/{sha}/check-runs` and record `app.id` per context; write the measured id per context into the ruleset (15368 only where measured; a context emitted by another app gets that app's id).
- [ ] 1.16.4 WU-1.10 · test-reach-contract › Quarantine is temporary and only shrinks · design §2a/DD-21 · CODE ~20 · slice `refound/1-test-contracts-job` — seed the full quarantine with an owner per entry: the 9 Playwright specs (owner WU-6.E8), the 7 `security/tests` (6.S2), `postgres-stress.test.ts` (6.P2), the 2 admin fetch scripts, the `_template` sandbox, `.disabled`, `.old`, the 6 `*.k6.js` (6.K4) and the 2 dark failures; set `playwright:client`, `playwright:admin` and `k6` to `executedBy: []`.
- [ ] 1.16.5 **Red proof** ×5 WU-1.10 · CODE ~0 · slice `refound/1-test-contracts-job` — through the complete step: (1) an orphan file → "unreached"; (2) a second config including a file → "collected twice"; (3) a collected file added to quarantine → exit 1; (4) a quarantined file deleted without removing its entry → exit 1; (5) `collectors.json` pointing at a nonexistent job → exit 1; plus swapping the two `TIER=` lines in the recipe → "phase order" exit 1. Restore each with `sha256sum`.
- [ ] 1.16.6 Acceptance WU-1.10 · CODE ~0 · slice `refound/1-test-contracts-job` — Test Contracts green in ≤ 6 min; "test-shaped files unreached outside quarantine" = 0; `CLAUDE.md` §Extending the suite step 2 now admits script-backed checks (workflow and doc call the same command).
- [ ] 1.16.7 Tracker: M5 reaches 0 · 0; Gates rows (#30 new form); M7 · CODE ~4 · slice `refound/1-test-contracts-job`.

### 1.17 · `refound/1-script-contract` (PR R11) — part C and #31 A widened

- [ ] 1.17.1 RED WU-1.11 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~15 · slice `refound/1-script-contract` — part C REDs: reverting `apps/client/package.json`'s `test` to bare `"vitest"` → exit 1; a planted `--passWithNoTests` in a `ci.yml` step → #31 exit 1.
- [ ] 1.17.2 GREEN WU-1.11 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~40 · slice `refound/1-script-contract` — part C in the engine (every package with a vitest config has `scripts.test === "vitest run"`, and no package config sets a factory-owned key in **either** `mergeConfig` argument); fix `apps/client`'s watch-mode `test` script and the CI call that relied on it; delete the watch justification comment; widen #31 A's scope to `git ls-files '*.json' '*.ts' '*.mts' '*.yml'` repo-wide.
- [ ] 1.17.3 **Red proof** ×3 WU-1.11 · CODE ~0 · slice `refound/1-script-contract` — 1.17.1's two cases plus `script -qc "pnpm --filter @apps/client test"` with a 60 s timeout: it does not terminate before, it does after → restore.
- [ ] 1.17.4 Tracker: Gates rows (#31 A widened, part C) · CODE ~4 · slice `refound/1-script-contract`.

### 1.18 · `refound/1-scopes` (PR R12) — #36 over resolved configs, in all 86

- [ ] 1.18.1 RED WU-1.12 · test-reach-contract › Every positive include glob matches at least one file, in every scope · CODE ~30 · slice `refound/1-scopes` — REDs: pointing one package's `test.include` at `"testz/**/*.test.ts"` → exit 1; breaking one config's syntax → exit 1 (fail closed, never a silent zero).
- [ ] 1.18.2 GREEN WU-1.12 · test-reach-contract › Every positive include glob matches at least one file, in every scope · design §2a · CODE ~120 · slice `refound/1-scopes` — `packages/test-contracts/src/scopes.ts` resolving every config and asserting each positive `test.include` glob matches ≥ 1 file (`coverage.include` joins at C1/5.1; Playwright projects ≥ 1 test once E2E is rebuilt); move the #36 step into Test Contracts; rewrite the `CLAUDE.md` block keeping its fail-closed wording.
- [ ] 1.18.3 **Red proof** ×2 WU-1.12 · CODE ~0 · slice `refound/1-scopes` — the two cases through the complete step; restore.
- [ ] 1.18.4 Tracker: Gates row (#36 new home) · CODE ~4 · slice `refound/1-scopes`.

### 1.19 · `refound/1-node-reporter` (PR R16) — structured runner events (DD-7)

- [ ] 1.19.1 RED WU-1.16 · test-reach-contract › The tier collector reads structured runner EVENTS, not formatted text · design §DD-7 · CODE ~50 · slice `refound/1-node-reporter` — unit test feeding synthetic `TestsStream` events including a `test:summary`: pass/fail/cancelled/skipped/todo each counted; a `test:fail` with `failureType === "cancelledByParent"` → `cancelled=1` in the machine line; a `test:summary` whose `counts` disagree with the per-event tallies → the mismatch is printed and the larger failure count wins; failure detail is printed.
- [ ] 1.19.2 GREEN WU-1.16 · test-reach-contract › The tier collector reads structured runner EVENTS, not formatted text · design §DD-7 · CODE ~120 · slice `refound/1-node-reporter` — `scripts/testing/node-summary-reporter.mjs` over the documented `TestsStream` events, printing every failure with its detail and one anchored `@@SUMMARY tests=N pass=N fail=N cancelled=N skipped=N todo=N`; `run-tests.sh` switches to `--test-reporter=<repo>/scripts/testing/node-summary-reporter.mjs --test-reporter-destination=stdout`, parses only that line, keeps `--conditions development` on the command (module-resolution › Source-mode invocations opt in via `--conditions development` on the command) and keeps the four guards; update the #31 B pins in the same PR. **Node 24.15.0 ships no `json` test reporter** — research §Errata; a built-in reporter is not an option.
- [ ] 1.19.3 **Red proof** ×4 WU-1.16 · testing-canon-and-tracker › Every new or modified gate is recorded with its demonstrated red · CODE ~0 · slice `refound/1-node-reporter` — re-demonstrate each of the four guards (fail / cancel / skip / zero-collect) against the new reporter through the complete step; restore.
- [ ] 1.19.4 Tracker: M2, M9; Gates rows (four guards re-proven) · CODE ~4 · slice `refound/1-node-reporter`.

---

## Phase 2 — Demolition (design §7.4). **No deletion task may precede gate H3 (task 2.2.2).**

### 2.1 · `refound/2-lint-rules` — the durable form (WU-2.4 + WU-8.1a land together)

- [ ] 2.1.1 RED WU-2.4 · decorative-test-demolition › The durable form is a lint rule pinned at `error`, with suppressions as a shrinking baseline · design §2b · CODE ~40 · slice `refound/2-lint-rules` — `RuleTester` valid/invalid per rule per framework for `testing/no-empty-test`, `testing/no-tautological-assertion`, `testing/no-existence-only-test`; plus the suppression test: a stale suppression makes a plain `eslint` run exit 2 and `eslint --prune-suppressions` removes it.
- [ ] 2.1.2 **Measured** WU-2.4 · decorative-test-demolition › The classifier is a tested workspace package, calibrated on both frameworks · design §2b · CODE ~10 · slice `refound/2-lint-rules` — only classes calibrated ≥ 90 % GREEN by the probe become rules; TITLE-CONTRADICTION stays ledger-only. Record the per-class calibration rate.
- [ ] 2.1.3 **Measured** WU-2.4 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · design §9 risk 5 · CODE ~5 · slice `refound/2-lint-rules` — verify the `assertFunctionNames` member wildcard (`assert.*`) matches on ONE file before enabling it repo-wide; fall back to explicit `assert.<name>` forms if it does not.
- [ ] 2.1.4 GREEN WU-2.4 · decorative-test-demolition › The durable form is a lint rule pinned at `error`, with suppressions as a shrinking baseline · CODE ~120 · slice `refound/2-lint-rules` — the new blocks in `eslint.config.ts`: the three `testing/*` rules on both frameworks; the `vitest/*` set (`expect-expect` with `assertFunctionNames: ["expect","expect*","assert","assert.*","expectTypeOf"]`, `no-conditional-expect`, `valid-expect`, `no-standalone-expect`, `no-identical-title`, `no-commented-out-tests`, `no-disabled-tests`, `no-focused-tests`) applied **only** to files `collectorOf` routes to `vitest:*`, never to node:test files; `no-console: error` on every test glob; generate `eslint-suppressions.json` with `eslint --suppress-rule`.
- [ ] 2.1.5 GREEN WU-2.4 · merge-verdict-composition › A script entrypoint cannot swallow its own failure (#46) · design §2b · CODE ~20 · slice `refound/2-lint-rules` — the fitness pin (#48, in #31 B's form) that a `testing/*` or `vitest/*` rule sitting at `warn` instead of `error` exits 1.
- [ ] 2.1.6 WU-8.1a · testing-canon-and-tracker › The coding standard states the framework per BOUNDARY, the both-directions rule, and the criterion · design §7.4 · CODE ~120 · slice `refound/2-lint-rules` — `docs/development/CODING_STANDARDS.md` §Testing part 1: replace "Three frameworks" and its 4-row table with the **framework-per-boundary** table (pure logic → vitest unit · in-process HTTP route → vitest + `inject` · persistence/SQL/RLS/transactions → the services tier · process topology → the live tier · component/hook → vitest + RTL + MSW · outbound HTTP → vitest + MSW handlers · cross-process journey → Playwright · latency under load → k6 · test quality → mutation); add the both-directions rule and criteria (a)–(d) with the hard probe; state Jest is not a framework of this repo; replace the literal `makePost` example with `aPost()` from `@test-utils/domain`. **The runner column for the services tier stays "node:test (or vitest per X2)" until gate H7 resolves.**
- [ ] 2.1.7 **Red proof** ×3 WU-2.4 · CODE ~0 · slice `refound/2-lint-rules` — plant an existence-only block in a vitest file and in a node:test file → lint exit 1; delete a suppressed block without pruning → a plain run exits 2; set one rule to `warn` → #48 exit 1; `cmp`-restore each.
- [ ] 2.1.8 Tracker: M3 Baseline (suppressions per rule), M13; Gates rows · CODE ~4 · slice `refound/2-lint-rules`.

### 2.2 · `refound/2-ledger-listing` — list before deleting · **[HUMAN GATE H3]**

- [ ] 2.2.1 WU-2.5 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · design §2b · CODE 0 · slice `refound/2-ledger-listing` — commit `docs/development/testing-refoundation/{ledger.json,LEDGER.md,probes.json,adjudications.json}`, the overlay seeded with every ADJUDICATE row. EVIDENCE ~4,000.
- [ ] 2.2.2 **[HUMAN GATE H3]** WU-2.5 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · CODE 0 · slice `refound/2-ledger-listing` — Edward approves the unambiguous DELETE set **in one pass**; ADJUDICATE rows are approved slice by slice. STOP and wait. No task in 2.3–2.14 may start before this is recorded in `adjudications.json` with `status: "confirmed"`, reviewer and date.
- [ ] 2.2.3 Tracker: M6 (machine / confirmed / total) · CODE ~4 · slice `refound/2-ledger-listing`.

### 2.3 · `refound/2-coverage-exception` (WU-2.0) — **[HUMAN GATE H8: needs a `sensitive-edit` token]**

- [ ] 2.3.1 **[HUMAN GATE H8]** WU-2.0 · decorative-test-demolition › The coverage descent demolition causes is admitted only through a named canon exception · CODE ~0 · slice `refound/2-coverage-exception` — `CLAUDE.md` §Pragmatic Exceptions is a tripwire path: obtain the `sensitive-edit` token (audited in `.claude/heuristic-overrides.log`) before editing. STOP if it is not granted.
- [ ] 2.3.2 GREEN WU-2.0 · decorative-test-demolition › The coverage descent demolition causes is admitted only through a named canon exception · design §2i/DD-15 · CODE ~40 · slice `refound/2-coverage-exception` — add the `decorative-demolition` scenario to `CLAUDE.md` §Pragmatic Exceptions (marker `canon-exception: decorative-demolition:<ledger-slice>` in a line comment), add it to #37's scenario set, and write `docs/technical/ADR-0025-decorative-demolition-coverage-exception.md`.
- [ ] 2.3.3 **Red proof** WU-2.0 · CODE ~0 · slice `refound/2-coverage-exception` — lower a floor without the marker → #37 exit ≠ 0; with the marker → exit 0 with the acceptance logged; restore.
- [ ] 2.3.4 Tracker: M14 row (floor descents with marker); Decisions log (ADR-0025) · CODE ~4 · slice `refound/2-coverage-exception`.

### 2.4 · `refound/2-whole-files` (WU-2.6a) — whole decorative files, criteria (a)(b)(d)

- [ ] 2.4.1 WU-2.6a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~6 · slice `refound/2-whole-files` — delete the six files the approved ledger rows name (`apps/client/tests/components/ListeningCharts.test.tsx`, `apps/api/tests/unit/trendAnalysisService.test.ts` — keeping its `.test-helpers.ts`, 4 importers —, `apps/api/tests/universal-client-dashboard.integration.test.ts`, `packages/providers/_template/tests/integration/sandbox.template.test.ts`, `apps/admin/tests/apiClient.smoke.test.ts`, `apps/admin/tests/posts.flow.test.ts`) and remove the two now-dead excludes in `apps/admin/vitest.config.ts`. EVIDENCE ~1,223.
- [ ] 2.4.2 Acceptance WU-2.6a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~0 · slice `refound/2-whole-files` — vitest −47 tests exactly as `--area` predicted; orphans −3; `ledger --check` green; `eslint --prune-suppressions` run; lint 0/0, `tsc`, `format:check`.
- [ ] 2.4.3 Tracker: M1, M2, M4, M5 · CODE ~4 · slice `refound/2-whole-files`.

### 2.5 · `refound/2-todo-stubs` (WU-2.6b) — the four `describe.todo` stubs (D3)

- [ ] 2.5.1 WU-2.6b · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~2 · slice `refound/2-todo-stubs` — delete the 4 `describe.todo` stub files; the gap they stood for is already a declared gap and is counted as one. EVIDENCE ~116.
- [ ] 2.5.2 Acceptance WU-2.6b · testing-canon-and-tracker › Declared gaps are counted, never faked · CODE ~0 · slice `refound/2-todo-stubs` — todo 43 → 0 and skipped files 4 → 0, so every later run can assert absolute zeros (the precondition of the skip gate, slice 3.3).
- [ ] 2.5.3 Tracker: M2 (todo → 0), M9; Declared gaps row · CODE ~4 · slice `refound/2-todo-stubs`.

### 2.6 · `refound/2-dead-helpers` (WU-2.7) — dead helpers, runners and files · **[HUMAN GATE H2]**

- [ ] 2.6.1 **[HUMAN GATE H2 / D17]** WU-2.7 · decorative-test-demolition › Nothing is deleted without a listed ledger row and human approval · design §3 D17 · CODE ~0 · slice `refound/2-dead-helpers` — `apps/api/scripts/seed-demo-data.ts` and `apps/api/scripts/seed-large-dataset.ts` are CLI entrypoints: zero importers is normal for them. They are **excluded from this and every other delete slice** until Edward classifies them. State the exclusion in the PR body.
- [ ] 2.6.2 WU-2.7 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~5 · slice `refound/2-dead-helpers` — re-verify 0 importers, then delete `apps/api/tests/setup/*` (they import only each other), `coverage-utils.ts`, `tests/run.ts`, `run-with-coverage.ts`, `analytics-ml-integration.test.ts.disabled`, `threading.flow.test.ts.old`, `unit/helpers/InMemoryBruteForceAdapter.ts` and the four dead `*.test-helpers.ts`. EVIDENCE ~3,000.
- [ ] 2.6.3 Acceptance WU-2.7 · CODE ~0 · slice `refound/2-dead-helpers` — `ledger --check` green; the quarantine loses the `.disabled` and `.old` entries; lint 0/0, `tsc`, `format:check`.
- [ ] 2.6.4 Tracker: M1, M4, M5 · CODE ~4 · slice `refound/2-dead-helpers`.

### 2.7–2.13 · `refound/2-blocks-{1a,1b,2a,2b,3,4,5}` — block deletion by `--area` (WU-2.8.1a…2.8.5)

> Serial inside `apps/api` because each slice can move the api coverage floor; parallel across other packages. Every slice: `ledger --check` green · `eslint --prune-suppressions` · the real drop equals the `--area` prediction · the `decorative-demolition` marker if an api floor descends · lint 0/0, `tsc`, `format:check` · the full vitest run of the touched packages or `run-tests.sh <path>` for node:test.

- [ ] 2.7.1 WU-2.8.1a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~320 · slice `refound/2-blocks-1a` — delete the approved blocks in `apps/api/tests/unit/rateLimitingDashboard.test.ts` (18) and `logger.test.ts` (11); empty `describe`s go with them; a file left empty is deleted whole.
- [ ] 2.7.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-1a` — real drop = prediction; suppressions of the touched files at 0.
- [ ] 2.8.1 WU-2.8.1b · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-1b` — `auditMiddleware` (10, incl. the calibration case), `webhookHandler.stats` (9, incl. the two `>= 0` tautologies), `healthMetrics` (8 blocks + 9 tautologies).
- [ ] 2.8.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-1b`.
- [ ] 2.9.1 WU-2.8.2a · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-2a` — the flat root of `apps/api/tests/unit`, alphabetical chunk 1 of 2 (196 files total), including `providerConstraintValidator`'s two tautologies.
- [ ] 2.9.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-2a`.
- [ ] 2.10.1 WU-2.8.2b · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-2b` — alphabetical chunk 2 of 2.
- [ ] 2.10.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-2b`.
- [ ] 2.11.1 WU-2.8.3 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-3` — `apps/api/tests/unit/{application,infrastructure,domain}`.
- [ ] 2.11.2 Acceptance + Tracker (M2, M3, M14) · CODE ~4 · slice `refound/2-blocks-3`.
- [ ] 2.12.1 WU-2.8.4 + WU-2.9 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~350 · slice `refound/2-blocks-4` — `apps/api/tests/unit/{security,ai,webhooks,saga,auth,admin,…}` including `enhancedValidator.mutations-request`'s 4 tautologies; **and WU-2.9**: `git mv apps/api/tests/unit/settingsRoutes.test.ts settingsSchemas.test.ts` + header, with "settings route contract untested" entered as a declared gap owned by Phase 9.
- [ ] 2.12.2 Acceptance + Tracker (M2, M3, M14, Declared gaps) · CODE ~4 · slice `refound/2-blocks-4`.
- [ ] 2.13.1 WU-2.8.5 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~300 · slice `refound/2-blocks-5` — the node:test tier (`syncEngine.monitoring` 5, `threading.canonical` 1, `security-endpoints` 1, the existence-only lines of `planPublication`); **no file may reach zero tests** — the zero-collect guard would fire, which is the correct behaviour and must not be triggered by a deletion.
- [ ] 2.13.2 Acceptance + Tracker (M2, M3) · CODE ~4 · slice `refound/2-blocks-5` — `bash scripts/test-env.sh integration` green with the same unit count minus the prediction.

### 2.14 · `refound/2-blocks-6` (WU-2.8.6) and 2.15 · `refound/2-blocks-7` (WU-2.8.7)

- [ ] 2.14.1 WU-2.8.6 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~300 · slice `refound/2-blocks-6` — packages (`@adapters/storage-cloudinary` 8 blocks, logger 1, fallback-strategies 1 tautology, the rest per ledger).
- [ ] 2.14.2 Acceptance + Tracker (M2, M3) · CODE ~4 · slice `refound/2-blocks-6`.
- [ ] 2.15.1 WU-2.8.7 · decorative-test-demolition › Every demolition slice closes at zero, with its accounting visible · CODE ~300 · slice `refound/2-blocks-7` — `apps/client`, `apps/admin`, `apps/workers`.
- [ ] 2.15.2 Acceptance + Tracker (M2, M3) · CODE ~4 · slice `refound/2-blocks-7`.

### 2.16 · `refound/2-rewrites` (WU-2.10) — weak but behavioural: rewritten, never deleted

- [ ] 2.16.1 RED WU-2.10 · decorative-test-demolition › Weak-but-behavioural tests are rewritten, never deleted, and the rewrite is probe-proven · CODE ~60 · slice `refound/2-rewrites` — rewrite `@core/webhooks` (activate `rotateFails` and assert the failure), `@core/compliance` (assert values on both happy paths) and `@core/settings` (assert the exact masked shape); each rewrite's acceptance is **probe RED** with the subject gutted.
- [ ] 2.16.2 Acceptance WU-2.10 · CODE ~0 · slice `refound/2-rewrites` — the orchestrator runs `hard-probe` over the three rewritten blocks (D19: writers never invoke it) and records RED for each in `probes.json`.
- [ ] 2.16.3 Tracker: M6 (REWRITE rows confirmed) · CODE ~4 · slice `refound/2-rewrites`.

---

## Phase 3 — Verdict (design §7.5)

### 3.1 · `refound/3-coverage-certifies` (PR V4)

- [ ] 3.1.1 RED WU-3.4 · merge-verdict-composition › The coverage step runs when the suite is red, and refuses to certify it · design §2h · CODE ~10 · slice `refound/3-coverage-certifies` — a local dry run of the refusal step with `needs.test.result=failure` must exit 1.
- [ ] 3.1.2 GREEN WU-3.4 · merge-verdict-composition › The coverage step runs when the suite is red, and refuses to certify it · CODE ~30 · slice `refound/3-coverage-certifies` — Coverage Merge gains `if: ${{ !cancelled() }}` at job level, a "Count shard blobs" step (exactly 2 `blob-*`, else `::error` + `exit 1`), the merge that renders every failure from the blobs, and a "Refuse to certify a red suite" step (`if: !cancelled()`) that exits 1 unless `needs.test.result == success`; the risen-floor and upload steps stay `always()`.
- [ ] 3.1.3 **Red proof** WU-3.4 · CODE ~0 · slice `refound/3-coverage-certifies` — a draft PR with a planted unit failure: Coverage Merge **runs**, prints the test name, and exits 1 (run URL in the PR) → restore.
- [ ] 3.1.4 Tracker: Gates row; M7 · CODE ~4 · slice `refound/3-coverage-certifies`.

### 3.2 · `refound/3-remove-duplicate-gates` (PR V5) — **[HUMAN GATE H4]**

- [ ] 3.2.1 **[HUMAN GATE H4]** WU-3.5 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · design §2h · CODE ~0 · slice `refound/3-remove-duplicate-gates` — **before this PR merges**, Edward removes "Test and Build" from the classic required checks; otherwise the PR waits forever on a context no job produces. The command goes in the PR body. STOP and wait for confirmation.
- [ ] 3.2.2 GREEN WU-3.5 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · CODE ~140 (net −140) · slice `refound/3-remove-duplicate-gates` — in `.github/workflows/production-ci.yml` delete the duplicate `security-audit` job and the `test-and-build` job (it duplicates Build Check on PRs and `ci.yml` on push) and its `needs:`; rename the workflow to "Container Images".
- [ ] 3.2.3 WU-3.5 · merge-verdict-composition › The required-context list is versioned in the repository, with an up-to-date-branch policy · design §DD-12 · CODE ~5 · slice `refound/3-remove-duplicate-gates` — remove "Test and Build" from the committed **mirror** ruleset in this same PR, and carry the hand mirror-vs-classic comparison in the PR checklist (nothing verifies it by machine before PR V11).
- [ ] 3.2.4 Acceptance WU-3.5 · CODE ~0 · slice `refound/3-remove-duplicate-gates` — the required list no longer names "Test and Build"; "Security Audit" has exactly one emitter.
- [ ] 3.2.5 Tracker: Gates rows; Decisions log (D4) · CODE ~4 · slice `refound/3-remove-duplicate-gates`.

### 3.3 · `refound/3-skip-gate` (PR V8) — a skipped vitest test fails CI

- [ ] 3.3.1 RED WU-3.8 · merge-verdict-composition › A skipped test fails CI · design §2e · CODE ~20 · slice `refound/3-skip-gate` — `it("x", (ctx) => ctx.skip())` in `packages/core/posts` → `CI=true pnpm --filter @core/posts test` exits ≠ 0 naming the test; with `CI` unset the run is green (the gate is CI-only).
- [ ] 3.3.2 GREEN WU-3.8 · merge-verdict-composition › A skipped test fails CI · CODE ~60 · slice `refound/3-skip-gate` — `packages/vitest-shared/src/skipGateReporter.ts` importing only from `vitest/node`: on `CI === "true"` collect every `skipped` / `pending` / `todo` in `onTestRunEnd`, print `file > full name`, fail the run (throw from `onTestRunEnd` if vitest resets `process.exitCode`); append it in `workspaceReporters()`; update the residual #32 wording (runtime skips are gated in every runner; Playwright inherits the same rule at the E2E rebuild).
- [ ] 3.3.3 **Red proof** WU-3.8 · CODE ~0 · slice `refound/3-skip-gate` — 3.3.1 through the complete step; restore.
- [ ] 3.3.4 Tracker: M9, M2 (todo 0 is now enforced, not just achieved); Gates row · CODE ~4 · slice `refound/3-skip-gate`.

### 3.4 · `refound/1-skips-ast` (PR R13) — #32 over the syntax tree (unblocked by Phase 2)

- [ ] 3.4.1 RED WU-1.13 · test-reach-contract › Skips, focus and disabled tests are detected over the syntax tree of every test-shaped file · design §2a · CODE ~40 · slice `refound/1-skips-ast` — plant (a) `test.fixme(` in a spec, (b) `const d = describe.skip;`, (c) `it("x", { skip: true }, …)` → each exit 1; and (d) `{ skip: 2 }` inside a Prisma call → **green** (proves it does not flag Prisma's `skip`).
- [ ] 3.4.2 GREEN WU-1.13 · test-reach-contract › Skips, focus and disabled tests are detected over the syntax tree of every test-shaped file · CODE ~160 · slice `refound/1-skips-ast` — `packages/test-contracts/src/skips.ts` parsing the whole disk set with `ts.createSourceFile` (no type-check): member access `.(skip|only|fixme|todo|skipIf|runIf)` on `it|test|describe|suite|test.describe` called or merely referenced; `skip|only|todo` keys in a second-argument options object; Playwright `test.skip(` / `test.fixme(` anywhere; `.todo` is a skip (D3). Move the #32 step into Test Contracts.
- [ ] 3.4.3 WU-8.9 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~10 · slice `refound/1-skips-ast` — in the same PR, delete the false `CLAUDE.md` claim that `forbidOnly` is set in "5 of 83" configs and the `.todo` exemption.
- [ ] 3.4.4 **Red proof** ×4 WU-1.13 · CODE ~0 · slice `refound/1-skips-ast` — 3.4.1's four cases through the complete step; restore.
- [ ] 3.4.5 Tracker: Gates row (#32 new form); M9 · CODE ~4 · slice `refound/1-skips-ast`.

### 3.5 · `refound/3-verdict-static` (PR V9) — #45 verdict rules V1, V2, V3, V7 and V8

- [ ] 3.5.1 RED WU-3.9 · merge-verdict-composition › No required job can report a skip, swallow an exit, or be filtered away (V2–V5, V7) · design §2h · CODE ~90 · slice `refound/3-verdict-static` — self-tests planting: a second workflow with `name: Security Audit` → verdict rule V1; deleting the Integration Tests job → V1 (0 producers); `if: github.event_name == 'push'` on a required job → V2; removing `!cancelled()` from Coverage Merge → V3; `paths:` on `ci.yml`'s `pull_request` → V7; `include/exclude` in a matrix → fail closed "unsupported matrix".
- [ ] 3.5.2 RED **threat matrix — CI automation that writes to GitHub** WU-3.9 · merge-verdict-composition › Only allowlisted jobs may write to the repository from CI (V8) · design §5 · CODE ~20 · slice `refound/3-verdict-static` — plant `issues: write` on an unlisted job → verdict rule V8 exits 1 naming the job; an allowlisted job triggered on `pull_request` → exit 1.
- [ ] 3.5.3 GREEN WU-3.9 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · CODE ~330 · slice `refound/3-verdict-static` — `packages/test-contracts/src/verdict.ts` parsing every workflow with `yaml` and the committed ruleset: **verdict rule V1** (exactly one producer per required context, matrix expanded), **V2** (no job-level `if:` outside the always-true-on-PR allowlist), **V3** (`needs:` ⇒ `!cancelled()` / `always()` **and** a step referencing `needs.<id>.result` per needed id), **V7** (no `paths` / `paths-ignore` on a workflow producing a required context), **V8** (`writers` allowlist in `collectors.json` — initially `nightly.yml:alarm`; `security-events: write` and `actions: write` are out of scope by name); the #45 block in `CLAUDE.md`.
- [ ] 3.5.4 **Red proof** ×7 WU-3.9 · CODE ~0 · slice `refound/3-verdict-static` — 3.5.1's five plus 3.5.2's two through the complete step; restore each.
- [ ] 3.5.5 Tracker: Gates rows (#45 static, V1/V2/V3/V7/V8); M7 · CODE ~4 · slice `refound/3-verdict-static`.

### 3.6 · `refound/3-ruleset` (PR V11) — the merge gate, versioned · **[HUMAN GATE H5]**

- [ ] 3.6.1 WU-3.11 · merge-verdict-composition › The required-context list is versioned in the repository, with an up-to-date-branch policy · design §2h · CODE ~80 · slice `refound/3-ruleset` — rewrite `.github/rulesets/main.json` with `enforcement: "active"`, `bypass_actors: []`, `deletion`, `non_fast_forward`, `strict_required_status_checks_policy: true` (D5) and the post-rebuild composition **by rendered context name**, each with the `integration_id` measured in task 1.16.3.
- [ ] 3.6.2 WU-3.11 · merge-verdict-composition › Exactly one job emits each required context, and duplicated or piggy-backed gates are separated · CODE ~10 · slice `refound/3-ruleset` — the composition includes the new contexts that exist by now (OpenAPI Drift, Test Contracts) and the promoted ones (Semgrep CE, size-limit, Dependency Consistency, CodeQL as one `javascript-typescript` context, Security Audit with one emitter); E2E and k6 join in their own slices (6E.8, 6K.4); Container Security joins when green.
- [ ] 3.6.3 Acceptance WU-3.11 · CODE ~0 · slice `refound/3-ruleset` — verdict rule V1–V8 green over the committed file; a draft PR with one required check red shows "merging is blocked" (evidence in the PR).
- [ ] 3.6.4 **[HUMAN GATE H5]** WU-3.11 · CODE ~0 · slice `refound/3-ruleset` — Edward runs `gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json`, clears the classic required-checks list and enables `allow_update_branch`. Rollback: `gh api -X DELETE …/rulesets/{id}` plus the mirror. The commands go in the PR body. STOP and wait.
- [ ] 3.6.5 Tracker: Gates row; Decisions log (D5, D6, D7); M15 · CODE ~4 · slice `refound/3-ruleset`.

### 3.7 · `refound/3-verdict-drift` (PR V10) — #45 operational rules V4, V5 and drift V6

- [ ] 3.7.1 RED WU-3.10 · merge-verdict-composition › Drift between the committed ruleset and the live gate is detected, and fails closed (V6) · design §2h · CODE ~40 · slice `refound/3-verdict-drift` — REDs: `continue-on-error: true` on a required job's step whose name does not end in "(never gates)" → verdict rule V4 exit 1; a `|| true` on a line invoking a gate tool → V5 exit 1; a fake context in the ruleset → V6 exit 1; an empty rules array → exit 1 ("no active rules — an evaluate-mode ruleset is invisible"); a network failure → 3 retries then "could not measure" exit 1, never a silent green.
- [ ] 3.7.2 GREEN WU-3.10 · merge-verdict-composition › Drift between the committed ruleset and the live gate is detected, and fails closed (V6) · CODE ~150 · slice `refound/3-verdict-drift` — verdict rules V4 and V5, and V6 reading `GET /repos/{o}/{r}/rules/branches/main` (paginated, `GITHUB_TOKEN`) and comparing contexts, `integration_id`, strict, `deletion` and `non_fast_forward` against the committed ruleset; V6 runs on push to main, nightly and dispatch — **never on `pull_request`** (a PR editing the ruleset would be red until an admin applies it).
- [ ] 3.7.3 **Red proof** ×5 WU-3.10 · CODE ~0 · slice `refound/3-verdict-drift` — 3.7.1's five cases through the complete step; restore.
- [ ] 3.7.4 Tracker: Gates rows (V4, V5, V6); M7 · CODE ~4 · slice `refound/3-verdict-drift`.

### 3.8 · `refound/3-osv-decide` (PR V7b) — measured, then decided

- [ ] 3.8.1 WU-3.7(b) · merge-verdict-composition › A required gate either can fail or is removed — measured, then decided · CODE ~40 or −30 · slice `refound/3-osv-decide` — **per P.5.1's measurement** (D8): if ≥ 1 moderate+ finding exists that `pnpm audit` does not see and nobody audited → pin the binary by sha256, add `osv-scanner.toml` `[[IgnoredVulns]]` (id, reason, ignoreUntil) per audited finding, and remove `set +e` and the exit-1 tolerance; otherwise → delete the job and remove it from the required list.
- [ ] 3.8.2 **Red proof** WU-3.7(b) · CODE ~0 · slice `refound/3-osv-decide` — on the keep branch: remove one ignore → exit 1 → restore. On the delete branch: verdict rule V1 proves no required context is left without a producer.
- [ ] 3.8.3 Tracker: Decisions log (D8 with the numbers); Gates row or its removal · CODE ~4 · slice `refound/3-osv-decide`.

---

## Phase 4b — Environment, remaining slices (design §7.6)

### 4b.1 · `refound/4b-adopt-workflows` (PR E4)

- [ ] 4b.1.1 WU-4b.4 · test-environment-contract › One script owns the environment, and it starts no datastore · design §6 · CODE ~150 (net deletions) · slice `refound/4b-adopt-workflows` — repoint `performance.yml`, `security-testing.yml` (ZAP) and `nightly.yml` onto `scripts/test-env.sh`; no workflow boots an application process any other way.
- [ ] 4b.1.2 Acceptance + **Red proof** WU-4b.4 · test-environment-contract › Environment identity is gated, not conventional (#47) · CODE ~0 · slice `refound/4b-adopt-workflows` — `rg "dev:test" .github` = 0; plant an inline `pnpm --filter @apps/api dev:test &` → #47 exit 1 (enforced in 4b.4) → restore.
- [ ] 4b.1.3 Tracker: M15 · CODE ~4 · slice `refound/4b-adopt-workflows`.

### 4b.2 · `refound/4b-loader` (PR E5)

- [ ] 4b.2.1 RED WU-4b.5 · test-environment-contract › The test-environment loader fails closed with an actionable message · design §2e · CODE ~15 · slice `refound/4b-loader` — move `.env.test` away → `pnpm --filter @apps/workers test` exits ≠ 0 with "run `bash scripts/test-env.sh env hermetic`", **not** a Zod error.
- [ ] 4b.2.2 GREEN WU-4b.5 · test-environment-contract › The test-environment loader fails closed with an actionable message · CODE ~50 · slice `refound/4b-loader` — `packages/vitest-shared/src/setup/loadTestEnv.ts` (root via `findMonorepoRoot`, loads `.env.test`, throws with the command when absent, sets `process.env.NODE_ENV ??= "test"`); registered by the factory as the first `setupFiles` entry; delete `apps/api/tests/setup-env.ts` and `apps/workers/tests/setup-env.ts` (whose the hardcoded three-level parent traversal offset is the counting the spec forbids); `apps/workers/package.json` gains the `@packages/vitest-shared` devDependency.
- [ ] 4b.2.3 **Red proof** WU-4b.5 · CODE ~0 · slice `refound/4b-loader` — 4b.2.1 through the complete command; restore.
- [ ] 4b.2.4 Tracker: Gates row · CODE ~4 · slice `refound/4b-loader`.

### 4b.3 · `refound/4b-playwright-servers` (PR E6) — one owner per process (DD-18)

- [ ] 4b.3.1 GREEN WU-4b.6 · test-environment-contract › The browser runner's servers come from the same script · design §DD-18 · CODE ~60 · slice `refound/4b-playwright-servers` — both Playwright configs call `loadTestEnv()` first, read `TEST_CLIENT_URL` / `TEST_ADMIN_URL` for `baseURL` (throwing when unset) and replace their `webServer` with the array `[serve sidecar, serve api, serve workers, serve client|admin]`, every entry `reuseExistingServer: false`, `cwd` = repository root, `timeout` = each process's readiness budget; the `!isCI` branch and the commented-out admin block are deleted.
- [ ] 4b.3.2 **Measured** WU-4b.6 · test-environment-contract › The browser runner's servers come from the same script · design §9 risk 14 · CODE ~10 · slice `refound/4b-playwright-servers` — record Playwright 1.63's observed `webServer` array start semantics (parallel vs sequential) and the total start budget; the four processes are independent either way.
- [ ] 4b.3.3 **Red proof** WU-4b.6 · CODE ~0 · slice `refound/4b-playwright-servers` — `playwright test --list` unchanged; with the API env broken, `playwright test` fails inside `webServer` (`serve api` exits 6 in its readiness window) before any test runs → restore.
- [ ] 4b.3.4 Tracker: Decisions log (webServer semantics); Gates row · CODE ~4 · slice `refound/4b-playwright-servers`.

### 4b.4 · `refound/4b-identity` (PR E7) — #47, one environment identity

- [ ] 4b.4.1 RED **threat matrix — destructive database target** WU-4b.7 · test-environment-contract › Environment identity is gated, not conventional (#47) · design §5 · CODE ~40 · slice `refound/4b-identity` — the three plants, each exit 1: `postgres:16-alpine` in a `services.postgres`; a retyped `postgresql://test_user@…` literal in a workflow; a key deleted from `.env.test.example`.
- [ ] 4b.4.2 GREEN WU-4b.7 · test-environment-contract › Environment identity is gated, not conventional (#47) · CODE ~140 · slice `refound/4b-identity` — `packages/test-contracts/src/identity.ts`: every `services.postgres` uses `pgvector/pgvector:pg16` + `POSTGRES_DB=omnipost_test` + `POSTGRES_USER=postgres`; every `services.redis` is `redis:7-alpine`; every `postgresql://` literal in `.github/workflows` is the canonical hermetic URL read from `scripts/test-env.sh`, never retyped; no inline `dev:test`; `.env.test.example`'s key set equals the script's required inputs.
- [ ] 4b.4.3 **Red proof** ×3 WU-4b.7 · CODE ~0 · slice `refound/4b-identity` — 4b.4.1 through the complete step; restore.
- [ ] 4b.4.4 Tracker: M15 reaches 1; Gates row (#47) · CODE ~4 · slice `refound/4b-identity`.

### 4b.5 · `refound/4b-hermetic-shards` (PR E8) — measured first

- [ ] 4b.5.1 **Measured** WU-4b.8 · test-environment-contract › The hermetic profile makes an accidental service dependency fail fast · CODE ~0 · slice `refound/4b-hermetic-shards` — run the api vitest suite under the hermetic profile locally and in a draft PR; list every failure. EVIDENCE ~80.
- [ ] 4b.5.2 GREEN WU-4b.8 · test-environment-contract › The hermetic profile makes an accidental service dependency fail fast · CODE ~70 (net −70) · slice `refound/4b-hermetic-shards` — **if 4b.5.1 measured 0**: the `test` job loses its `services` and database steps. **If N > 0**: those files are integration tests in the wrong tier → open a ledger row each and this slice waits (record the decision; never soften the profile).
- [ ] 4b.5.3 **Red proof** WU-4b.8 · CODE ~0 · slice `refound/4b-hermetic-shards` — a planted api unit test that opens Prisma fails with `ECONNREFUSED 127.0.0.1:1` → restore.
- [ ] 4b.5.4 Tracker: M8 (shards measured hermetic); Decisions log · CODE ~4 · slice `refound/4b-hermetic-shards`.

---

## Phase S — Shared test tooling (design §7.7). Each migration lands **after** its package's demolition slice.

### S.1 · `refound/s-skeleton` (WU-S.1)

- [ ] S.1.1 RED WU-S.1 · shared-test-tooling › The tooling is three packages, not one, and production never imports them · design §2f · CODE ~30 · slice `refound/s-skeleton` — the depcruise rule red: plant `import { aPost } from "@test-utils/domain"` in `packages/core/posts/src/` → exit ≠ 0; and `@test-utils/*` appearing outside `devDependencies` → exit ≠ 0.
- [ ] S.1.2 GREEN WU-S.1 · shared-test-tooling › The tooling is three packages, not one, and production never imports them · CODE ~150 · slice `refound/s-skeleton` — create `packages/test-utils/{domain,wire,persistence}` (`@layer infrastructure`, source exports, no build script) with the dependency directions of design §1; `pnpm-workspace.yaml` (glob added in 1.14.1), `tsconfig.base.json` paths (the vitest alias derives itself), `.dependency-cruiser.*`; assert `@core/domain`, `@shared/types` and `@infra/prisma` never depend on test-utils (turbo cycle).
- [ ] S.1.3 **Red proof** ×2 WU-S.1 · CODE ~0 · slice `refound/s-skeleton` — S.1.1's two plants through the complete step; restore.
- [ ] S.1.4 Tracker: Gates rows (depcruise); M13 Baseline · CODE ~4 · slice `refound/s-skeleton`.

### S.2 · `refound/s-builders` (WU-S.2)

- [ ] S.2.1 RED WU-S.2 · shared-test-tooling › Canonical builders construct aggregates through the domain's own factory · design §2f · CODE ~60 · slice `refound/s-builders` — one test per builder asserting `create()` returns ok and one invariant actually holds; a non-ok `create()` throws `fixture: <Aggregate>.create failed: …`.
- [ ] S.2.2 GREEN WU-S.2 · shared-test-tooling › Canonical builders construct aggregates through the domain's own factory · CODE ~180 · slice `refound/s-builders` — `aPost`, `aScheduledPost`, `aProject`, `aChannel`, `anAccount` via `create()` only (`reconstitute()` only for states unreachable by create: published, failed, soft-deleted); ids by counter (`post-000001`), clock fixed `2026-01-01T00:00:00Z`, no faker; `aProjectRepo(found?)` for the 15+ local `makeProjectRepo`; `aCanonicalPost()` and `a<Thing>Dto()` in wire.
- [ ] S.2.3 Tracker: M13 (local canonical builders) starts falling · CODE ~4 · slice `refound/s-builders`.

### S.3 · `refound/s-raw-reach` (WU-S.3a) — measure who reaches raw SQL (DD-17 step 1)

- [ ] S.3.1 RED WU-S.3a · shared-test-tooling › One Prisma double, and its raw SQL throws · design §DD-17 · CODE ~40 · slice `refound/s-raw-reach` — the recorder's classifier over synthetic stacks: a `set_config('app.account_id'` statement through `PrismaUnitOfWork` or the `tenantGuc` extension → `guc-binding`; anything else → `raw-subject`; `raw-reach.json` deterministic (sorted, no timestamps); a planted `SELECT 1` in a unit test yields one `raw-subject` row naming the file and the test.
- [ ] S.3.2 **Measured** WU-S.3a · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~80 · slice `refound/s-raw-reach` — instrument the double's four raw methods with a recorder (caller stack + first SQL token) and run the unit tier per file (LXC-safe); write `docs/development/testing-refoundation/raw-reach.json`. EVIDENCE ~400.
- [ ] S.3.3 RED WU-S.3a · shared-test-tooling › One route-app builder, in the API app's own test support, using the production error plugin · design §9 risk 13 · CODE ~30 · slice `refound/s-raw-reach` — one test that resolves a mutating use case **after** a later `TOKENS.UnitOfWork` registration and asserts the double is reached — proving the lazy-singleton override wins and that nothing resolves it eagerly inside `setupContainer`.
- [ ] S.3.4 Tracker: the `raw-reach.json` classification table; Decisions log (which rows are `raw-subject`) · CODE ~4 · slice `refound/s-raw-reach`.

### S.4 · `refound/s-uow-canon` (WU-S.3b) — the composition-root canon fix (DD-17 step 3)

- [ ] S.4.1 RED WU-S.3b · shared-test-tooling › One Prisma double, and its raw SQL throws · design §DD-17 · CODE ~30 · slice `refound/s-uow-canon` — a test that `TOKENS.UnitOfWork` resolves **transient** (two resolves are two instances) and that no use-case factory constructs `new PrismaUnitOfWork(...)` directly.
- [ ] S.4.2 GREEN WU-S.3b · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~90 · slice `refound/s-uow-canon` — restore ARCHITECTURE_CANON §Dependency Injection in the one class with three sites: register `TOKENS.UnitOfWork` transient in `apps/api/src/infrastructure/container/setupRepositories.ts`, and make `setupProjectUseCases.ts` and `setupAccountUseCases.ts` resolve the token instead of constructing the concrete. **If Edward declines this correction**, the affected tests are tiered as `raw-subject` rows instead and the double is NOT softened (design §9 risk 12).
- [ ] S.4.3 Acceptance WU-S.3b · CODE ~0 · slice `refound/s-uow-canon` — `pnpm --filter @apps/api test` and `bash scripts/test-env.sh integration` green; fitness #21 and the DI canon unchanged.
- [ ] S.4.4 Tracker: Decisions log (canon fix, ADR reference) · CODE ~4 · slice `refound/s-uow-canon`.

### S.5 · `refound/s-prisma-double` (WU-S.3) — the throwing double and the UoW double

- [ ] S.5.1 RED WU-S.3 · shared-test-tooling › One Prisma double, and its raw SQL throws · design §2f · CODE ~50 · slice `refound/s-prisma-double` — `$queryRaw` / `$queryRawUnsafe` / `$executeRaw` / `$executeRawUnsafe` throw with the exact message "raw SQL is not simulated: test this path in the integration tier"; `createUnitOfWorkDouble()` returns `err` unchanged from `executeResultInTransaction` and never calls a raw method; `$extends` stays an identity wrapper and its doc states that tenant-guard semantics are proven only in the integration tier.
- [ ] S.5.2 GREEN WU-S.3 · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~220 · slice `refound/s-prisma-double` — `git mv apps/api/tests/unit/helpers/mockPrisma.ts packages/test-utils/persistence/src/prismaDouble.ts` keeping the store model, the `$transaction` fn+array forms and the auto-seeded roles byte-exact; typed generic registry; `presets.adminAuth`; `asPrismaClient(double)` as the only cast site; `prismaModuleFactory(double)` with `vi.hoisted` for `vi.mock("@infra/prisma")`; `createUnitOfWorkDouble()` registered by `buildRouteTestApp` right after `setupContainer`.
- [ ] S.5.3 GREEN WU-S.3 · shared-test-tooling › One Prisma double, and its raw SQL throws · CODE ~40 · slice `refound/s-prisma-double` — the codemod over the 31 importers (mechanical; its output is EVIDENCE ~900).
- [ ] S.5.4 Acceptance WU-S.3 · CODE ~0 · slice `refound/s-prisma-double` — api vitest green; **every test that turns red on the throwing raw path becomes a ledger row** (DELETE or re-tier), per S.3.2's measurement — never a softened double.
- [ ] S.5.5 Tracker: M13 (PrismaClient casts) falls; M6 gains the tiering rows · CODE ~4 · slice `refound/s-prisma-double`.

### S.6 · `refound/s-redis-double` (WU-S.4)

- [ ] S.6.1 RED WU-S.4 · shared-test-tooling › One Redis double, and an unsupported command throws · design §2f · CODE ~50 · slice `refound/s-redis-double` — TTL behaviour under the virtual clock; an unsupported command throws naming it.
- [ ] S.6.2 GREEN WU-S.4 · shared-test-tooling › One Redis double, and an unsupported command throws · CODE ~150 · slice `refound/s-redis-double` — `createRedisDouble()` as a typed `Pick<Redis, …>` over the union of the 7 existing copies' commands plus `{ clock: { advance(ms) } }`; no `ioredis-mock` (TTL, Lua and BullMQ stay in the integration tier).
- [ ] S.6.3 GREEN WU-S.4 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~120 · slice `refound/s-redis-double` — migrate the 7 consumers (saga manager/integration helpers, the two content helpers, the performance-monitor helper, the rate-limit dashboard and the health routes) and prune their suppressions.
- [ ] S.6.4 Tracker: M13 · CODE ~4 · slice `refound/s-redis-double`.

### S.7–S.10 · `refound/s-route-app` and `refound/s-route-app-{1,2,3}` (WU-S.5)

- [ ] S.7.1 RED WU-S.5 · shared-test-tooling › One route-app builder, in the API app's own test support, using the production error plugin · design §2f · CODE ~40 · slice `refound/s-route-app` — a test that a domain error is mapped through the **production** `errorPlugin` (status, `correlationId`, `timestamp`), and that the UoW registration made before the first resolve wins over the lazy singleton.
- [ ] S.7.2 GREEN WU-S.5 · shared-test-tooling › One route-app builder, in the API app's own test support, using the production error plugin · CODE ~100 · slice `refound/s-route-app` — `apps/api/tests/support/buildRouteTestApp.ts` registering the Zod compilers, the production `errorPlugin`, `setupContainer({ prisma })` and the auth mocks; retire `createTestContainer` from the production composition root.
- [ ] S.8.1 WU-S.5 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-route-app-1` — migrate batch 1 of the 28 `createTestApp` copies and the 9 users of `*Routes.test-helpers.ts`; prune suppressions.
- [ ] S.9.1 WU-S.5 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-route-app-2` — batch 2, including the 6 `admin/*Routes.test.ts` that call captured handlers today and move to `inject`.
- [ ] S.10.1 WU-S.5 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-route-app-3` — batch 3; `createTestApp` count reaches 0.
- [ ] S.10.2 Tracker: M13; Declared gaps if any route test cannot migrate · CODE ~4 · slices `refound/s-route-app-{1,2,3}` (one row per slice).

### S.11–S.13 · `refound/s-seed` and `refound/s-seed-migrate-{1,2}` (WU-S.6)

- [ ] S.11.1 RED WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · design §DD-16 · CODE ~40 · slice `refound/s-seed` — a test that `cleanupTenant` deletes only the seeded tenant's aggregates (the outbox deletes are scoped to its aggregate ids) and leaves a second tenant's rows intact; plus the serial-tier invariant assertion (one file per process, concurrency 1).
- [ ] S.11.2 GREEN WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · CODE ~120 · slice `refound/s-seed` — move `createSeedPrismaClient` (whole file, not rewritten), `seedTenant` and `cleanupTenant` to `packages/test-utils/persistence/src/seed`, keeping `bulkScheduleHarness`'s `makeStubQueue`, `makeRelay` and `seedTenant` byte-exact; the codemod over the 77 importers (EVIDENCE ~700).
- [ ] S.12.1 WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · CODE ~300 · slice `refound/s-seed-migrate-1` — migrate batch 1 of the 12 inline tenant-isolation copies onto the canonical base ids plus named extras (`seedTrackedLinks`, `seedSink`).
- [ ] S.13.1 WU-S.6 · shared-test-tooling › Seeds are canonical, and cleanup is scoped to the tenant it seeded · CODE ~300 · slice `refound/s-seed-migrate-2` — batch 2; inline copies reach 0.
- [ ] S.13.2 Tracker: M13 · CODE ~4 · slices `refound/s-seed-migrate-{1,2}` (one row per slice).

### S.14 · `refound/s-builder-gate` (WU-S.7 + WU-S.8)

- [ ] S.14.1 RED WU-S.7 + S.8 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · design §2f · CODE ~20 · slice `refound/s-builder-gate` — plant `const makeProject = () => …` in a package's test → lint exit 1; plant a double-`as` `PrismaClient` cast outside `@test-utils/persistence` → lint exit 1.
- [ ] S.14.2 GREEN WU-S.7 + S.8 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~50 · slice `refound/s-builder-gate` — the two `no-restricted-syntax` rules (builder-name regex outside `packages/test-utils/**`; the `TSAsExpression` cast selector outside `@test-utils/persistence`) with suppressions as the baseline (35 casts, ≥ 60 builders) and a fitness pin that both stay at `error`.
- [ ] S.14.3 **Red proof** ×2 · CODE ~0 · slice `refound/s-builder-gate` — S.14.1's two plants through the complete step; restore.
- [ ] S.14.4 Tracker: M13 Baseline pinned; Gates rows · CODE ~4 · slice `refound/s-builder-gate`.

### S.15–S.20 · `refound/s-migrate-<pkg>` (WU-S.7 migrations, one per family)

- [ ] S.15.1 WU-S.7 · shared-test-tooling › The name and cast gates end at zero, and every migration prunes its own suppressions · CODE ~300 · slice `refound/s-migrate-core` — migrate `packages/core/*` tests onto `@test-utils/*`; prune the family's suppressions.
- [ ] S.16.1 WU-S.7 · same requirement · CODE ~300 · slice `refound/s-migrate-adapters` — `packages/adapters/*`.
- [ ] S.17.1 WU-S.7 · same requirement · CODE ~300 · slice `refound/s-migrate-providers` — `packages/providers/*`.
- [ ] S.18.1 WU-S.7 · same requirement · CODE ~250 · slice `refound/s-migrate-workers` — `apps/workers`.
- [ ] S.19.1 WU-S.7 · same requirement · CODE ~350 · slice `refound/s-migrate-api` — `apps/api`.
- [ ] S.20.1 WU-S.7 · same requirement · CODE ~300 · slice `refound/s-migrate-client` — `apps/client` and `apps/admin`.
- [ ] S.20.2 Tracker: M13 reaches 0 · 0 · 0; the two gates go hard-zero (suppressions empty) · CODE ~4 · slice `refound/s-migrate-client`.

---

## Phase 4 — The integration tier as the model (design §7.8)

### 4.1 · `refound/4-preconditions-a` (WU-4.1a)

- [ ] 4.1.1 RED WU-4.1a · integration-tier-preconditions › Availability is a throwing precondition, never a skip · design §2d · CODE ~40 · slice `refound/4-preconditions-a` — with the API down, `assertApiAvailable()` in `before` THROWS naming the start command; the suite reports failed, never skipped.
- [ ] 4.1.2 GREEN WU-4.1a · integration-tier-preconditions › Availability is a throwing precondition, never a skip · CODE ~200 · slice `refound/4-preconditions-a` — replace `skipIfApiUnavailable` / `skipIfWorkerUnavailable` with `assertApiAvailable()` / `assertWorkersAvailable()` in the three live suites with the most sites (provider registry 37, production 27, multiproject flow 21), following the existing throwing pattern.
- [ ] 4.1.3 Tracker: M9 (runtime `t.skip` sites) falls · CODE ~4 · slice `refound/4-preconditions-a`.

### 4.2 · `refound/4-preconditions-b` (WU-4.1b)

- [ ] 4.2.1 GREEN WU-4.1b · integration-tier-preconditions › Availability is a throwing precondition, never a skip · CODE ~200 · slice `refound/4-preconditions-b` — the remaining suites (link routes 12, crisis routes 10, security endpoints 11, adapters 8, the five `syncEngine.*`), then delete the helper from `apps/api/tests/testUtils.ts`.
- [ ] 4.2.2 Acceptance WU-4.1b · integration-tier-preconditions › Availability is a throwing precondition, never a skip · CODE ~0 · slice `refound/4-preconditions-b` — `rg "t\.skip\(|skipIf(Api|Worker)?Unavailable" apps/api/tests` = 0, so #32 can make runtime `t.skip(` hard-zero.
- [ ] 4.2.3 Tracker: M9 reaches 0 runtime skip sites · CODE ~4 · slice `refound/4-preconditions-b`.

### 4.3 · `refound/4-production-rewrite` (WU-4.3)

- [ ] 4.3.1 RED WU-4.3 · integration-tier-preconditions › A suite that prints its own success, or accepts either outcome, is rewritten to assert exactly · CODE ~50 · slice `refound/4-production-rewrite` — the delete-post case asserts exactly `403` **and** the domain code (not `200 || 403`); the quota case uses an account with a known subscription and an exact `maxProjects`.
- [ ] 4.3.2 GREEN WU-4.3 · integration-tier-preconditions › A suite that prints its own success, or accepts either outcome, is rewritten to assert exactly · CODE ~120 · slice `refound/4-production-rewrite` — delete the unconditional "Test Summary" PASSED block, the duplicated "Client Interface Verification" health check and the "should simulate media upload" case whose title and assertion contradict each other; remove the ~40 `console.log`s; apply 4.1's preconditions.
- [ ] 4.3.3 Acceptance WU-4.3 · CODE ~0 · slice `refound/4-production-rewrite` — the suite is green and the orchestrator records a **probe RED** over the account-creation path.
- [ ] 4.3.4 Tracker: M2, M6 · CODE ~4 · slice `refound/4-production-rewrite`.

### 4.4 · `refound/4-outbox-topology` (WU-4.4) — F-6 closed by topology (DD-19)

- [ ] 4.4.1 RED WU-4.4 · integration-tier-preconditions › A shared-subject race is closed by topology, not by a sentinel · design §DD-19 · CODE ~20 · slice `refound/4-outbox-topology` — run the outbox suite with the API up → exit ≠ 0 in < 2 s naming `apps/api/src/index.ts:866` (`outboxRelay.start()`) and the claim statement in `OutboxClaimService.ts:90-100`; with the API down → green.
- [ ] 4.4.2 GREEN WU-4.4 · integration-tier-preconditions › A shared-subject race is closed by topology, not by a sentinel · CODE ~60 · slice `refound/4-outbox-topology` — `bulkScheduleHarness.makeRelay` calls `assertNoForeignRelay()` (probes `getBaseUrl()/health`); `OutboxRelay.integration.test.ts` keeps its sentinel for local runs; the DB-only phase already runs with the application down (task 1.12.2).
- [ ] 4.4.3 Acceptance WU-4.4 · CODE ~0 · slice `refound/4-outbox-topology` — 10 consecutive CI runs with zero outbox failures, run ids in the tracker.
- [ ] 4.4.4 Tracker: Gates row; the three bulk-schedule suites may now leave quarantine · CODE ~4 · slice `refound/4-outbox-topology`.

### 4.5 · `refound/4-unquarantine-db` (WU-4.5) and 4.6 · `refound/4-unquarantine-live` (WU-4.6 + WU-4.2)

- [ ] 4.5.1 WU-4.5 · test-reach-contract › Quarantine is temporary and only shrinks · CODE ~10 · slice `refound/4-unquarantine-db` — remove the 10 dark DB-only suites' quarantine entries (they were renamed by measured tier in 1.7.1 and the collector takes them by convention); the three bulk-schedule suites leave only now, after 4.4.
- [ ] 4.5.2 Acceptance + Tracker (M5, M9) · CODE ~4 · slice `refound/4-unquarantine-db` — quarantine loses 10 entries; `TIER` reports skip 0 / cancel 0.
- [ ] 4.6.1 WU-4.2 · integration-tier-preconditions › Dark suites are admitted by MEASURED tier, never by a guess · CODE ~6 · slice `refound/4-unquarantine-live` — fix `trendRadarRoutes.test.ts`: add `dayKey: <fetchedAt>.toISOString().slice(0,10)` to the three `trendRadarResult.create` calls, matching the use case's semantics and the `@@unique([accountId, dayKey, topic])` constraint; 5/5 alone and in the tier.
- [ ] 4.6.2 WU-4.6 · test-reach-contract › Quarantine is temporary and only shrinks · CODE ~10 · slice `refound/4-unquarantine-live` — remove the 9 live suites' quarantine entries; order comes from `LC_ALL=C sort` and per-file readiness (1.13.2) replaces the old ordering dependency.
- [ ] 4.6.3 Acceptance + Tracker (M5, M9, per-file durations) · CODE ~4 · slice `refound/4-unquarantine-live` — quarantine holds no api suites.

### 4.7 · `refound/4-chaos` (WU-4.7)

- [ ] 4.7.1 WU-4.7 · integration-tier-preconditions › The scheduled duplicate of the tier is removed; its scenarios run in every pull request · CODE ~10 · slice `refound/4-chaos` — rename the two chaos files per the convention if needed and **delete `.github/workflows/chaos.yml`** (it re-ran the whole DB-only tier nightly as owner without `MIGRATE_DATABASE_URL` and opened an issue per failure); close SMELL-79 stating the scenarios run in every PR.
- [ ] 4.7.2 Acceptance + Tracker (M5, M15) · CODE ~4 · slice `refound/4-chaos` — `chaos.yml`'s `issues: write` leaves with the file (verdict rule V8's allowlist shrinks).

### 4.8 · `refound/3-nightly` (PR V12) — one alarm per workflow

- [ ] 4.8.1 RED **threat matrix — CI automation that writes to GitHub** WU-3.12 · merge-verdict-composition › The scheduled run has one alarm, and duplicate schedules are removed · design §5 · CODE ~30 · slice `refound/3-nightly` — dispatch on a scratch branch with a planted failing integration test → **exactly one** issue created; dispatch again → one comment, no second issue; dispatch without the plant → the issue closed with the run link.
- [ ] 4.8.2 GREEN WU-3.12 · merge-verdict-composition › The scheduled run has one alarm, and duplicate schedules are removed · CODE ~90 (net −60) · slice `refound/3-nightly` — delete the `build --force` / `test --force` steps (covered elsewhere and `test` is already `cache: false`); add the `integration-reversed` job (`TEST_ORDER=reverse bash scripts/test-env.sh integration` — the same two phases, reversed inside each, never the DB-only tier with the application up); add ONE `alarm` job (`needs`, `if: always()`, `permissions: issues: write`, `github-script` search-before-create on the `nightly-failure` label, close on green) and put it in the `writers` allowlist.
- [ ] 4.8.3 **[admin, once]** WU-3.12 · CODE ~0 · slice `refound/3-nightly` — Edward closes the 31 open `nightly-failure` issues citing the first green nightly.
- [ ] 4.8.4 Tracker: M15 (open nightly alarms → ≤ 1); Gates rows · CODE ~4 · slice `refound/3-nightly`.

### 4.9 · `refound/1-registered-entrypoints` (PR R14) — reach part B

- [ ] 4.9.1 RED WU-1.14 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~20 · slice `refound/1-registered-entrypoints` — plant `run: pnpm --filter @apps/api exec vitest run tests/unit/foo` → exit 1.
- [ ] 4.9.2 GREEN WU-1.14 · test-reach-contract › Workflows invoke only registered entrypoints, and every measured package exposes the canonical scripts · CODE ~110 · slice `refound/1-registered-entrypoints` — part B over `.github/workflows/*.yml` with `yaml`: (B1) no `vitest` / `node --test` / `playwright test` / `k6 run` with a positional path outside the forms registered in `collectors.json`; (B2) every `pnpm … test*` / `turbo run test*` is one of `test`, `test:coverage`, `test:integration`, `test:e2e`; repoint the last offender in `dependency-updates.yml`.
- [ ] 4.9.3 **Red proof** WU-1.14 · CODE ~0 · slice `refound/1-registered-entrypoints` — 4.9.1 through the complete step; restore.
- [ ] 4.9.4 Tracker: Gates row (part B) · CODE ~4 · slice `refound/1-registered-entrypoints`.

### 4.10 · `refound/4-tier-acceptance` (WU-4.9)

- [ ] 4.10.1 Acceptance WU-4.9 · integration-tier-preconditions › The tier closes at zero skipped, zero cancelled, zero failed on two consecutive runs · CODE ~20 · slice `refound/4-tier-acceptance` — two consecutive CI runs of the DB-only and live phases with 0 skipped / 0 cancelled / 0 failed; every suite named exactly once; the reach gate reports 0 unreached; write the run ids into the tracker.
- [ ] 4.10.2 Tracker: M9 closes at 0/0; M5 at 0 · 0 · CODE ~4 · slice `refound/4-tier-acceptance`.

---

## Phase X — The runner experiment (design §7.9)

### X.1 · `refound/x-runner-experiment` (PR X1) — unmerged branch; only the evidence merges

- [ ] X.1.1 WU-4.X1 · integration-tier-preconditions › The runner fork is decided by a measured table against stated hypotheses · design §2j · CODE ~250 (on the unmerged branch, 0 merged) · slice `refound/x-runner-experiment` — build runner B (`apps/api/vitest.integration.config.ts` with the alias map minus the `@infra/prisma → vitest-entry.ts` override, both condition lists, `pool: "forks"`, `isolate: true`, `fileParallelism: false`, `maxWorkers: 1`, the two timeouts, projects `integration` and `live`, the four reporters, `loadTestEnv`) and the import-line-only codemod; both runners run under the same `test-env.sh integration` recipe.
- [ ] X.1.2 **Measured** WU-4.X1 · integration-tier-preconditions › The runner fork is decided by a measured table against stated hypotheses · CODE ~0 · slice `refound/x-runner-evidence` — the same commit, CI and homelab, 3 runs each: M1 verdict parity, M2 runtime, M3 failure naming over the 7 planted red cases (28 points), M4 force-exit equivalent, M5 skip/cancel/zero guards without a text parser, M6 migration cost (assertions changed = 0), M7 coverage mergeability with the unit blobs, M8 flakiness over 10 nightly repeats, M9 peak RSS. EVIDENCE ~400 (the table, URLs and codemod diff stats).
- [ ] X.1.3 Tracker: the full X1 table with run URLs · CODE ~40 · slice `refound/x-runner-evidence`.

### X.2 · decision — **[HUMAN GATE H7]**

- [ ] X.2.1 **[HUMAN GATE H7]** WU-4.X2 · integration-tier-preconditions › The runner fork is decided by a measured table against stated hypotheses · design §2j · CODE ~20 · slice `refound/x-runner-evidence` — apply the decision rule to X1's table: hard criteria H1 parity 100 %, H2 every red case exits ≠ 0 under B, H3 the guards expressible in config + reporter ≤ 60 lines, H4 no assertion change **and no mock/alias/stub added to make Prisma or the saga engine run under vite**, H5 CI runtime ≤ 1.25× and within 15 min. All pass → consolidate on vitest; one hard fails → keep node:test and record the failed criterion as the class only it sees; only H5 fails with everything else better → Edward with the numbers. **Do not hard-code a runner before this task; later tasks say "per X2 outcome".** Write the outcome into the Decisions log.
- [ ] X.2.2 WU-4.X2 · testing-canon-and-tracker › The coding standard states the framework per BOUNDARY, the both-directions rule, and the criterion · CODE ~10 · slice `refound/x-runner-evidence` — resolve the "node:test (or vitest per X2)" cell of the CODING_STANDARDS table (task 2.1.6) to the decided runner; the suffix router is unchanged either way.

---

## Phase 5 — Coverage measured in all 86, with ratchet (design §7.10)

### 5.1 · `refound/5-coverage-defaults` (PR C1)

- [ ] 5.1.1 RED WU-5.1 · coverage-floor-ratchet › Coverage defaults live in the shared factory, and are inert without the flag · design §2e · CODE ~30 · slice `refound/5-coverage-defaults` — `pnpm --filter @core/posts exec vitest run --coverage` writes `coverage/coverage-summary.json`; a focused `vitest run <file>` **without** `--coverage` never trips a floor; pointing one `coverage.include` at `srcz/**` makes #36 exit 1.
- [ ] 5.1.2 GREEN WU-5.1 · coverage-floor-ratchet › Coverage defaults live in the shared factory, and are inert without the flag · CODE ~70 · slice `refound/5-coverage-defaults` — the factory's `test.coverage` defaults (`provider: "v8"`, `include: options.coverageInclude ?? ["src/**/*.{ts,tsx}"]`, `exclude: SHARED_COVERAGE_EXCLUDE`, `reporter: ["text-summary","json-summary"]`, `reportsDirectory: "./coverage"`, `reportOnFailure: true`), enabled only by `--coverage`; `coverage.include` joins #36's scope check; `turbo.json` `test:coverage` keeps `outputs: ["coverage/**"]` and gains the task-level `inputs` listing the by-path tooling files (`$TURBO_ROOT$/packages/vitest-shared/src/**`, the wire `server.ts` and `vitest-setup.ts`) — **never `globalDependencies`** (DD-6).
- [ ] 5.1.3 **Red proof** ×2 WU-5.1 · CODE ~0 · slice `refound/5-coverage-defaults` — the dead `coverage.include` glob → #36 exit 1; `turbo run test:coverage` twice → the second is not reported "cached" when a listed tooling input changed; restore.
- [ ] 5.1.4 Tracker: M8; Gates rows (turbo inputs, #36 extension) · CODE ~4 · slice `refound/5-coverage-defaults`.

### 5.2 · `refound/5-coverage-measure` (PR C2) — measure before fixing any floor

- [ ] 5.2.1 RED WU-5.2 · coverage-floor-ratchet › Every scope is measured BEFORE any floor is fixed · CODE ~15 · slice `refound/5-coverage-measure` — the "Every package produced a summary" step: a planted `coverage: { enabled: false }` in one config → `::error` + exit 1.
- [ ] 5.2.2 GREEN WU-5.2 · coverage-floor-ratchet › Every scope is measured BEFORE any floor is fixed · CODE ~40 · slice `refound/5-coverage-measure` — Package Tests and Frontend Tests run `turbo run test:coverage --continue` (the registered entrypoint); the summary-count step compares `**/coverage/coverage-summary.json` against the number of vitest packages; the table lands in the job summary and is uploaded.
- [ ] 5.2.3 **Measured** WU-5.2 · coverage-floor-ratchet › Every scope is measured BEFORE any floor is fixed · CODE ~0 · slice `refound/5-coverage-measure` — 86 rows × 4 metrics, CI and homelab, plus a drift column; the maximum local↔CI drift **decides** whether the ratchet is strict (≤ 0.1 pp, D14). EVIDENCE ~400.
- [ ] 5.2.4 Tracker: M8 (86 rows), the drift number and the strict-ratchet decision · CODE ~4 · slice `refound/5-coverage-measure`.

### 5.3–5.6 · `refound/5-floors-{core-a,core-b,packages,apps}` (PR C3–C6) — commit the measured floors

- [ ] 5.3.1 WU-5.3 · coverage-floor-ratchet › Floors are literal values per config, in a form the runner can rewrite · design §2e · CODE ~330 · slice `refound/5-floors-core-a` — the 26 `packages/core/*` configs take the `mergeConfig(defineWorkspaceVitestConfig(dir, overrides), defineConfig({ test: { coverage: { thresholds } } }))` shape with floors = `ratchetFloor(min(CI, local))` **from 5.2.3** and `autoUpdate: ratchetFloor`; each `package.json` gains `"test:coverage": "vitest run --coverage"` and loses `test:unit:coverage` and `test:unit`.
- [ ] 5.3.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-core-a` — in one package of the group, a test that raises coverage ≥ 0.2 pp makes vitest **rewrite** the literals (proving `autoUpdate` accepts the shape); deleting a test file makes `test:coverage` exit 1 on thresholds.
- [ ] 5.4.1 WU-5.4 · same requirement · CODE ~330 · slice `refound/5-floors-core-b` — the other 26 core packages plus the engine.
- [ ] 5.4.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-core-b`.
- [ ] 5.5.1 WU-5.5 · same requirement · CODE ~330 · slice `refound/5-floors-packages` — adapters, providers, observability, monitoring, api-*, i18n, query-client (~30 configs).
- [ ] 5.5.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-packages`.
- [ ] 5.6.1 WU-5.6 · same requirement · CODE ~330 · slice `refound/5-floors-apps` — `apps/admin`, `apps/client`, `apps/workers` (api already has its literals).
- [ ] 5.6.2 Acceptance + Tracker (M8) · CODE ~4 · slice `refound/5-floors-apps`.

### 5.7 · `refound/5-floor-ratchet` (PR C7) — #37 over every config, keyed by package name

- [ ] 5.7.1 RED WU-5.7 · coverage-floor-ratchet › The floor ratchet covers every config, keyed by package name, and fails closed · design §2i/DD-9 · CODE ~50 · slice `refound/5-floor-ratchet` — five REDs against `origin/main`: (1) lower one package's `lines` by 0.1 → exit 1; (2) delete a config's thresholds block → exit 1; (3) duplicate a metric at depth 1 → exit 1; (4) `git mv packages/core/posts posts2` **and** lower a floor → exit 1 (the floor follows the package name, not the path); (5) a valid `canon-exception: migration` line comment on the lowered line → exit 0 with the acceptance logged.
- [ ] 5.7.2 RED **threat matrix — git repository selection** WU-5.7 · coverage-floor-ratchet › The floor ratchet covers every config, keyed by package name, and fails closed · design §5 · CODE ~10 · slice `refound/5-floor-ratchet` — an unresolvable `FITNESS_BASE_REF` exits 1 after 3 bounded fetch attempts, naming the transient possibility.
- [ ] 5.7.3 GREEN WU-5.7 · coverage-floor-ratchet › The floor ratchet covers every config, keyed by package name, and fails closed · CODE ~180 · slice `refound/5-floor-ratchet` — `packages/test-contracts/src/floors.ts` (the `floorsOf` scanner moved out of `CLAUDE.md`), head map `packageName → config path` from the `package.json` files, base side via `git ls-tree` / `git show`; exactly one literal per metric at depth 1 of the global `thresholds:` block or fail closed; a package absent on base passes by metric; duplicate package names fail closed; the `canon-exception` scenario set includes `decorative-demolition`; the step moves to Test Contracts with `if: always() && github.event_name == 'pull_request'`.
- [ ] 5.7.4 **Red proof** ×6 WU-5.7 · CODE ~0 · slice `refound/5-floor-ratchet` — 5.7.1's five plus 5.7.2 through the complete step; restore.
- [ ] 5.7.5 Tracker: Gates row (#37 new form); M7, M14 · CODE ~4 · slice `refound/5-floor-ratchet`.

### 5.8 · `refound/5-floors-enforced` (PR C8)

- [ ] 5.8.1 GREEN WU-5.8 · coverage-floor-ratchet › A floor that could rise is committed in the same pull request · design §2i · CODE ~50 · slice `refound/5-floors-enforced` — generalise the risen-floor logic to `git diff --name-only -- '**/vitest.config.ts'` after every coverage job; **per 5.2.3's drift** it is red with "commit the new floors" and the exact diff (strict) or a warning; the api sharded flow is unchanged (`VITEST_SHARDED` neutralises per shard, Coverage Merge certifies).
- [ ] 5.8.2 **Red proof** ×2 WU-5.8 · CODE ~0 · slice `refound/5-floors-enforced` — a draft PR deleting a test → red in Package Tests; under strict, a draft PR that raises a floor by ≥ 0.2 pp without committing it → red with the diff; restore.
- [ ] 5.8.3 Tracker: M8; Gates row · CODE ~4 · slice `refound/5-floors-enforced`.

### 5.9 · `refound/5-denominator` (PR C9)

- [ ] 5.9.1 RED WU-5.9 · coverage-floor-ratchet › Every package is measured or listed with a reason, and the list only shrinks · design §2i · CODE ~40 · slice `refound/5-denominator` — three REDs: a package with `src/**/*.ts` and neither a config nor an entry → exit 1; adding an entry versus base → exit 1; marking `packages/ui` `types-only` → exit 1 (it has runtime).
- [ ] 5.9.2 GREEN WU-5.9 · coverage-floor-ratchet › Every package is measured or listed with a reason, and the list only shrinks · CODE ~130 · slice `refound/5-denominator` — `packages/test-contracts/src/denominator.ts` + `untested-packages.json` (`[{name, reason: "types-only"|"scaffold"|"pending-retirement:<ref>"|"pending-tests:<WU>", since}]`), `types-only` verified by `ts.transpileModule` emitting no runtime statement, the list only shrinking against base, seeded with the 11 measured packages.
- [ ] 5.9.3 **Red proof** ×3 WU-5.9 · CODE ~0 · slice `refound/5-denominator` — 5.9.1's three through the complete step; restore.
- [ ] 5.9.4 Tracker: M8 denominator; Declared gaps rows · CODE ~4 · slice `refound/5-denominator`.

### 5.10 · `refound/5-canon-floors` (PR C10 + WU-8.1b)

- [ ] 5.10.1 WU-5.10 + WU-8.1b · coverage-floor-ratchet › The canon states measured floors as the gate and layer targets as direction · design §DD-15 · CODE ~150 · slice `refound/5-canon-floors` — rewrite `docs/development/CODING_STANDARDS.md` §Coverage Targets: the per-package floors are measured values ratcheted by #37 (the gate), and the layer numbers are direction tracked in the tracker as distance to target, not a gate; "Running Tests" points at `scripts/test-env.sh`; write `docs/technical/ADR-0026-measured-coverage-floors-and-framework-boundaries.md`.
- [ ] 5.10.2 Tracker: Decisions log (ADR-0026); M8, M16 target columns · CODE ~4 · slice `refound/5-canon-floors`.

---

## Phase 6 — Re-found what was decorative (design §7.11)

### 6M.1 · `refound/6-msw-core` (WU-6.M1 + WU-6.M2)

- [ ] 6M.1.1 RED WU-6.M2 · msw-single-http-double › Network isolation is the default, and an unhandled request is an error · design §2f/DD-6 · CODE ~30 · slice `refound/6-msw-core` — plant `await fetch("https://example.com")` in any vitest test → it fails naming the request (`onUnhandledRequest: "error"`); and a node:test file using `useMswServer()` gets the same isolation.
- [ ] 6M.1.2 GREEN WU-6.M1 · msw-single-http-double › The lifecycle lives in setup, not in each file, and both frameworks are served · design §2f · CODE ~120 · slice `refound/6-msw-core` — `packages/test-utils/wire/src/server.ts` (the ONE `setupServer()` instance, importing only `msw/node`), `vitest-setup.ts` (importing only `msw/node` and `./server`: `beforeAll(listen({onUnhandledRequest:"error"}))`, `afterEach(resetHandlers)`, `afterAll(close)`), `useMswServer(handlers)` for node:test with its own test, `createTestServer(handlers?)` for node:test and the sidecar only, and re-exports of `http`, `HttpResponse`, `delay`; move `packages/providers/shared/src/test-utils/msw-helpers.ts` here and delete its subpath and the optional `msw` peer.
- [ ] 6M.1.3 GREEN WU-6.M2 · msw-single-http-double › Network isolation is the default, and an unhandled request is an error · design §DD-6 · CODE ~90 · slice `refound/6-msw-core` — the factory registers the wire setup file **by path** (`<root>/packages/test-utils/wire/src/vitest-setup.ts`) and asserts it exists — no manifest edge from the config factory into `@shared/types`'s graph; the 6 per-file `setupServer` calls become `server.use(...)`; the one `bypass` becomes `error` plus a handler.
- [ ] 6M.1.4 **Red proof** WU-6.M2 · CODE ~0 · slice `refound/6-msw-core` — 6M.1.1 through the complete command; restore.
- [ ] 6M.1.5 **Measured** WU-6.M2 · msw-single-http-double › Network isolation is the default, and an unhandled request is an error · design §9 risk 6 · CODE ~0 · slice `refound/6-msw-core` — measure the per-fork cost of importing `msw/node` everywhere, and confirm the task-level turbo `inputs` (task 5.1.2) make a wire-setup edit invalidate `test:coverage`.
- [ ] 6M.1.6 Tracker: M13 (fetch stubs) Baseline; Gates row (network isolation) · CODE ~4 · slice `refound/6-msw-core`.

### 6M.2 · `refound/6-msw-gate` (WU-6.M3 + WU-6.M4)

- [ ] 6M.2.1 GREEN WU-6.M3 · msw-single-http-double › The application handlers are typed by the published contract · CODE ~150 · slice `refound/6-msw-gate` — move the client's five handler modules to `packages/test-utils/wire/src/handlers/api/*`, typed with `@shared/types` so contract drift breaks `tsc`.
- [ ] 6M.2.2 RED WU-6.M4 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~15 · slice `refound/6-msw-gate` — plant `vi.stubGlobal("fetch", vi.fn())` → lint exit 1; also `globalThis.fetch = …` and `vi.spyOn(globalThis, "fetch")`.
- [ ] 6M.2.3 GREEN WU-6.M4 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~40 · slice `refound/6-msw-gate` — the three `no-restricted-syntax` selectors on test globs with suppressions as the measured baseline (30 AST + 11 + 3) and a fitness pin that the rule stays at `error`.
- [ ] 6M.2.4 **Red proof** WU-6.M4 · CODE ~0 · slice `refound/6-msw-gate` — 6M.2.2 through the complete step; restore.
- [ ] 6M.2.5 Tracker: M13 Baseline pinned; Gates row · CODE ~4 · slice `refound/6-msw-gate`.

### 6M.3–6M.9 · the MSW migrations (WU-6.M5–M8), each pruning its own suppressions

- [ ] 6M.3.1 WU-6.M5 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~300 · slice `refound/6-msw-client-1` — `apps/client` batch 1 of 2 (13 files total); prune.
- [ ] 6M.4.1 WU-6.M5 · same requirement · CODE ~300 · slice `refound/6-msw-client-2` — `apps/client` batch 2; prune.
- [ ] 6M.5.1 WU-6.M6 · same requirement · CODE ~300 · slice `refound/6-msw-admin` — `apps/admin` (8 files); prune.
- [ ] 6M.6.1 WU-6.M7 · same requirement · CODE ~350 · slice `refound/6-msw-api` — `apps/api`: the five named suites; consolidate the duplicated `FetchHttpClient` pair using `delay("infinite")` and `HttpResponse.error()`; move the AI wire server to `handlers/ai/*`; delete the `USE_REAL_ADAPTERS` branch of the provider-registry test; prune.
- [ ] 6M.7.1 WU-6.M8 · msw-single-http-double › Every provider has handlers for its public write endpoints, and its write methods are tested through them · CODE ~350 · slice `refound/6-msw-providers-1` — family 1 of 4: handlers under `packages/test-utils/wire/src/handlers/providers/<p>.ts` plus an MSW test per write method; DoD per provider: a handler per public write endpoint, a test per write method, 0 stubs. Adapter tests that use a fake apiClient stay — that is their boundary.
- [ ] 6M.7.2 WU-6.M8 · same requirement · CODE ~350 · slice `refound/6-msw-providers-2` — family 2 of 4.
- [ ] 6M.7.3 WU-6.M8 · same requirement · CODE ~350 · slice `refound/6-msw-providers-3` — family 3 of 4.
- [ ] 6M.7.4 WU-6.M8 · same requirement · CODE ~350 · slice `refound/6-msw-providers-4` — family 4 of 4, including `crm-hubspot` and `crm-salesforce`; telegram is repointed at the shared handlers (they are the sidecar's source too).
- [ ] 6M.8.1 WU-6.M9 · msw-single-http-double › A hand-written HTTP stub is a lint error, and the baseline reaches zero · CODE ~20 · slice `refound/6-msw-close` — the rule's suppressions are empty and it goes hard-zero at `error`.
- [ ] 6M.8.2 Tracker: M13 first column reaches 0 (one tracker row per migration slice above) · CODE ~4 · slices `refound/6-msw-*`.

### 6E.1 · `refound/6-e2e-demolish` (WU-6.E1)

- [ ] 6E.1.1 WU-6.E1 · e2e-acceptance-path › The fiction is demolished before anything is rebuilt · CODE ~60 · slice `refound/6-e2e-demolish` — delete `apps/client/tests/e2e/pages/*` (5 page objects over 207 non-existent `data-testid`s), `utils/{assertions,helpers}.ts` (**keep `utils/a11y.ts`**, imported by `a11y.spec.ts`), `fixtures/test-data.ts`, the two fake-JWT auth fixtures, `config/test-setup.ts`, the four fiction specs and the 6 visual snapshots, and the test-seed HTTP-route code in `global-setup.ts`; drop the `accessibility`, `visual-regression`, `performance`, `firefox`, `webkit`, `mobile-safari` and `tablet` projects and the three dead scripts. EVIDENCE ~2,000.
- [ ] 6E.1.2 Acceptance WU-6.E1 · e2e-acceptance-path › The fiction is demolished before anything is rebuilt · CODE ~0 · slice `refound/6-e2e-demolish` — the client E2E suite is exactly `a11y.spec.ts` on chromium, 1 green test; the quarantine shrinks accordingly.
- [ ] 6E.1.3 Tracker: M1, M4, M10 · CODE ~4 · slice `refound/6-e2e-demolish`.

### 6E.2 · `refound/6-seed-e2e` (WU-6.E2)

- [ ] 6E.2.1 RED WU-6.E2 · e2e-acceptance-path › Seeding is idempotent, through the owner connection, and never a route in the production binary · design §2g · CODE ~40 · slice `refound/6-seed-e2e` — running `seed:e2e` without `MIGRATE_DATABASE_URL` exits ≠ 0 naming the key; running it twice leaves the same row set (idempotent upserts).
- [ ] 6E.2.2 GREEN WU-6.E2 · e2e-acceptance-path › Seeding is idempotent, through the owner connection, and never a route in the production binary · CODE ~150 · slice `refound/6-seed-e2e` — `infra/prisma/seed-e2e.ts` over the owner connection: `e2e-customer@omnipost.test` (+ account + project), one Telegram channel whose credentials are encrypted by `ChannelCredentialsCrypto` under the test `PLATFORM_ENCRYPTION_KEY`, `e2e-admin@omnipost.test` with its role, `e2e-admin-lockout@omnipost.test`, N perf users; passwords from the `E2E_*_PASSWORD` / `PERF_USER_PASSWORD` keys the env script derives; the `seed:e2e` script runs from `test-env.sh db` after seed.
- [ ] 6E.2.3 Tracker: M10; Gates row (owner-connection refusal) · CODE ~4 · slice `refound/6-seed-e2e`.

### 6E.3 · `refound/6-provider-seam` (WU-6.E3a + WU-6.E3b)

- [ ] 6E.3.1 RED WU-6.E3a · e2e-acceptance-path › The provider base-URL seam is injected and REFUSED under a production environment · design §2g · CODE ~50 · slice `refound/6-provider-seam` — in **both** apps: `buildEnv({ ...validTestEnv, NODE_ENV: "production", TELEGRAM_API_BASE_URL: "http://127.0.0.1:3410" })` throws with the issue path `["TELEGRAM_API_BASE_URL"]` and a "refused in production" message; the same input without the override constructs; deleting the `superRefine` makes both tests fail.
- [ ] 6E.3.2 GREEN WU-6.E3a · e2e-acceptance-path › The provider base-URL seam is injected and REFUSED under a production environment · CODE ~60 · slice `refound/6-provider-seam` — `packages/providers/telegram/src/apiClient.ts`'s module constant becomes `constructor(credentials, options: { baseUrl?: string } = {})` defaulting to `https://api.telegram.org`; `createTelegramAdapter` threads `apiBaseUrl`; the three composition roots pass it from their env; both env modules gain `TELEGRAM_API_BASE_URL: z.string().url().optional()` and an exported `buildEnv(runtimeEnv)` factory; **`apps/workers/src/config/env.ts` gains a `createFinalSchema` it does not have today**; fitness #19 still holds (no `process.env` in an `*Adapter.ts`).
- [ ] 6E.3.3 RED WU-6.E3b · e2e-acceptance-path › The fake-provider sidecar replays the recorded contract, and the call is asserted · design §2g · CODE ~40 · slice `refound/6-provider-seam` — the contract test: for every shared Telegram handler, `getResponse` in-process and an HTTP round trip through the sidecar yield identical status and body; the sidecar's calls route records method/path/body; its reset route empties it; an unmatched request returns 501 naming method+path.
- [ ] 6E.3.4 GREEN WU-6.E3b · e2e-acceptance-path › The fake-provider sidecar replays the recorded contract, and the call is asserted · CODE ~90 · slice `refound/6-provider-seam` — `packages/test-utils/wire/src/fakeProviderServer.ts` (`startFakeProviderServer({ port, handlers })` over `node:http`, answering with msw's public `getResponse` from the **same** shared handlers) and the CLI entry `scripts/testing/fake-provider.mjs` that `test-env.sh up|serve sidecar` starts.
- [ ] 6E.3.5 Tracker: Gates rows (production refusal, sidecar contract); Decisions log (D13, the one production change) · CODE ~4 · slice `refound/6-provider-seam`.

### 6E.4 · `refound/6-e2e-config` (WU-6.E4) — the client Playwright configuration (DD-18)

- [ ] 6E.4.1 GREEN WU-6.E4 · e2e-acceptance-path › The browser configuration cannot pass by retrying, and cannot skip · design §2g · CODE ~120 · slice `refound/6-e2e-config` — projects `setup` (UI login → `test-results/.auth/<role>.json`, already gitignored) and `chromium` (`dependencies: ["setup"]`, `storageState`); `testMatch: "**/*.spec.ts"`; `retries: isCI ? 1 : 0` **with** `failOnFlakyTests: true`; `forbidOnly: isCI`; trace `retain-on-failure`; reporters html, junit, list, github; `locale: "en-US"` plus a `t(key)` helper over `apps/client/messages/en.json` for accessible names; the `webServer` array from task 4b.3.1.
- [ ] 6E.4.2 **Red proof** WU-6.E4 · e2e-acceptance-path › The browser configuration cannot pass by retrying, and cannot skip · CODE ~0 · slice `refound/6-e2e-config` — a spec that passes only on the retry is reported as a failure (`failOnFlakyTests`); a committed `test.skip(` is caught by #32 (task 3.4.2) → restore.
- [ ] 6E.4.3 Tracker: M10; Gates row · CODE ~4 · slice `refound/6-e2e-config`.

### 6E.5 · `refound/6-e2e-specs-a` (WU-6.E5a) and 6E.6 · `refound/6-e2e-specs-b` (WU-6.E5b)

- [ ] 6E.5.1 RED WU-6.E5a · e2e-acceptance-path › Selectors are role- and label-based, never a mass-instrumented attribute · CODE ~150 · slice `refound/6-e2e-specs-a` — `auth.spec.ts` (valid login → dashboard heading; wrong password → a localized `role=alert`; logout clears the session) and `posts.spec.ts` (draft through the editor via `textbox` and the channel selector, "Save draft" → the list shows Draft) — written red-first against the real UI, selectors by role and label only.
- [ ] 6E.5.2 Tracker: M10 · CODE ~4 · slice `refound/6-e2e-specs-a`.
- [ ] 6E.6.1 RED WU-6.E5b · e2e-acceptance-path › The first green specs prove both directions over the real journeys · CODE ~110 · slice `refound/6-e2e-specs-b` — `publish-now.spec.ts`: a seeded draft → "Publish now" → the UI shows Published **and** the sidecar's recorded-calls route holds exactly one `sendMessage` with the body; `a11y.spec.ts` gains the dashboard (serious + critical = 0).
- [ ] 6E.6.2 **Red proof** WU-6.E5b · e2e-acceptance-path › The fake-provider sidecar replays the recorded contract, and the call is asserted · CODE ~0 · slice `refound/6-e2e-specs-b` — make the sidecar answer 500 → the spec goes red → restore. A red `a11y` assertion is a component finding, not a spec fix.
- [ ] 6E.6.3 Tracker: M10 · CODE ~4 · slice `refound/6-e2e-specs-b`.

### 6E.7 · `refound/6-admin-e2e` (WU-6.E6 + WU-6.E7)

- [ ] 6E.7.1 GREEN WU-6.E6 · e2e-acceptance-path › The administrative suite is re-measured, and every remaining failure is classified · CODE ~150 · slice `refound/6-admin-e2e` — the admin `test:e2e` script; the config with `setup` + `chromium` and the script-owned `webServer`; delete `resetTestAdmin`; `loginAs` throws instead of returning false; `[data-testid="login-error"]` → `getByRole("alert")`; credentials from the seeded env.
- [ ] 6E.7.2 **Measured** WU-6.E6 · e2e-acceptance-path › The administrative suite is re-measured, and every remaining failure is classified · CODE ~0 · slice `refound/6-admin-e2e` — re-measure the 37 specs: the 21 seed failures must disappear; classify every remaining failure (product defect → an owned finding; test defect → fix; decorative → a ledger row). EVIDENCE ~150.
- [ ] 6E.7.3 GREEN WU-6.E7 · e2e-acceptance-path › The administrative suite is re-measured, and every remaining failure is classified · CODE ~5 · slice `refound/6-admin-e2e` — fix the measured WCAG contrast defect in `apps/admin/app/globals.css` (`--accent: #3b82f6` under white text is 3.67:1) with an accessible filled-button background; the admin a11y spec is red before and green after.
- [ ] 6E.7.4 Tracker: M10; Declared gaps / findings rows for every classified failure · CODE ~4 · slice `refound/6-admin-e2e`.

### 6E.8 · `refound/6-e2e-ci` (WU-6.E8 + WU-6.E9) — the job, and the quarantine empties

- [ ] 6E.8.1 GREEN WU-6.E8 · e2e-acceptance-path › The end-to-end job is required, and the rebuilt tree is typechecked · design §2g · CODE ~90 · slice `refound/6-e2e-ci` — the `e2e` job "E2E (chromium)" in `ci.yml`: services by identity, `bash scripts/test-env.sh env services && bash scripts/test-env.sh db` (**no `up`, no `run`** — Playwright owns the processes, DD-18), `playwright install --with-deps chromium` cached by version, `@shared/types` dist then `next build` of both apps, then the client config run followed by the admin config run (sequential; a survivor is caught by the bound-port refusal); upload `playwright-report` and `test-results` always; junit to the step summary; `timeout-minutes: 20`.
- [ ] 6E.8.2 GREEN WU-6.E8 · build-pipeline › `@shared/types` dist is built before every `next build` (the Turbopack boundary) · CODE ~10 · slice `refound/6-e2e-ci` — the job builds `@shared/types` before the Next builds, and `serve client|admin` refuses without `.next/BUILD_ID`.
- [ ] 6E.8.3 GREEN WU-6.E8 · build-pipeline › The rebuilt end-to-end tree is typechecked, and only by the tests-typecheck programme · CODE ~30 · slice `refound/6-e2e-ci` — enrol the rebuilt `apps/client/tests/e2e/**` and `apps/admin/tests/e2e/**` in the tests-typecheck programme and its ratchet ledger, never in the app build graph; the app-build `tests/**/*` exclude stays.
- [ ] 6E.8.4 WU-6.E8 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · design §DD-21 · CODE ~15 · slice `refound/6-e2e-ci` — fill `playwright:client` and `playwright:admin` `executedBy` in `collectors.json` with this job and its two entrypoints, empty their quarantine entries, and add the "E2E (chromium)" context to the ruleset — **all in this same PR** (a job without its registry row, or a registry row without its job, fails the reach gate closed).
- [ ] 6E.8.5 **Red proof** ×2 WU-6.E8 · CODE ~0 · slice `refound/6-e2e-ci` — plant `await expect(page).toHaveTitle("__never__")` → the job exits 1; break the API env → `serve api` exits 6 inside its readiness window and Playwright fails before any test → restore both.
- [ ] 6E.8.6 WU-6.E9 · testing-canon-and-tracker › Every tracker metric is re-derivable by the command it names · CODE ~15 · slice `refound/6-e2e-ci` — admin `test:e2e` into turbo; remove the unused env; script cleanup.
- [ ] 6E.8.7 Tracker: M10 (specs in CI, required = yes); M5 (quarantine −9); Gates rows · CODE ~4 · slice `refound/6-e2e-ci`.

### 6E.9 · `refound/6-e2e-gap` (WU-6.E10) — a declared gap, never a skipped spec

- [ ] 6E.9.1 WU-6.E10 · e2e-acceptance-path › The scheduled-publication journey is a declared gap, never a skipped spec · CODE ~10 · slice `refound/6-e2e-gap` — record "schedule → worker publishes" in Declared gaps with owner N-COR-8/9, stating it will be written red-first inside that change; **no skipped spec is committed here**.
- [ ] 6E.9.2 Tracker: Declared gaps row · CODE ~4 · slice `refound/6-e2e-gap`.

### 6K.1 · `refound/6-k6-a` (WU-6.K1 + WU-6.K2)

- [ ] 6K.1.1 RED WU-6.K2 · k6-load-gate › The base URL is required, the image is digest-pinned, and results land where the upload reads · CODE ~20 · slice `refound/6-k6-a` — `k6 run` without `API_BASE_URL` exits ≠ 0 (`if (!__ENV.API_BASE_URL) throw`), never a localhost fallback; a threshold of `p(95)<1` makes k6 exit 99.
- [ ] 6K.1.2 GREEN WU-6.K1 · k6-load-gate › One real scenario, and its thresholds are assertions · CODE ~120 · slice `refound/6-k6-a` — delete the 5 fiction scenarios, `performance/k6/config/*` and `utils/auth-helpers.js`; write `performance/k6/api-smoke-load.k6.js` (login through the real customer route with the seeded perf users, list posts, create a draft; `constant-arrival-rate` 10 rps × 2 min; **thresholds are assertions**: `http_req_failed rate<0.01` and a p95 per endpoint tag).
- [ ] 6K.1.3 GREEN WU-6.K2 · k6-load-gate › The base URL is required, the image is digest-pinned, and results land where the upload reads · CODE ~40 · slice `refound/6-k6-a` — pin `grafana/k6:<version>@sha256:<digest>`; `handleSummary` writes JSON and text into the exact directory the upload reads; the `perf:report` script family leaves.
- [ ] 6K.1.4 Tracker: M11; Gates row · CODE ~4 · slice `refound/6-k6-a`.

### 6K.2 · `refound/6-k6-calibrate` (WU-6.K3) — **[HUMAN GATE H6]**

- [ ] 6K.2.1 **Measured** WU-6.K3 · k6-load-gate › Thresholds are calibrated over ten runs, and may only tighten · CODE ~5 · slice `refound/6-k6-calibrate` — 10 runs on `main`; thresholds = the worst observed p95 × 2; record every run in the tracker. EVIDENCE ~120.
- [ ] 6K.2.2 **[HUMAN GATE H6]** WU-6.K3 · k6-load-gate › The keep-or-delete decision follows a numeric criterion, either way with numbers · design §DD-24 · CODE ~0 · slice `refound/6-k6-calibrate` — apply the criterion: a CV above 50 % on any gated p95, **or** a non-zero failed-request rate on ≥ 3 of the 10 runs with no application defect → k6 is **deleted** (D11). Present the numbers to Edward either way and record the decision. STOP until it is recorded.
- [ ] 6K.2.3 Tracker: M11; Decisions log (D11 with the numbers) · CODE ~4 · slice `refound/6-k6-calibrate`.

### 6K.3 · `refound/6-k6-b` (WU-6.K4) — the job (DD-24), or its deletion

- [ ] 6K.3.1 GREEN WU-6.K4 · k6-load-gate › One real scenario, and its thresholds are assertions · design §DD-24 · CODE ~60 · slice `refound/6-k6-b` — **per H6 = keep**: in `performance.yml`, job id `k6` with the static name "k6 Load Test", `on: pull_request` with no `paths` (verdict rules V1/V7) plus `push: main`, **no `needs`** (the `db-stress` job leaves with `perf:db`), services by identity, the digest-pinned image, `bash scripts/test-env.sh run --with api,workers -- docker run … -e API_BASE_URL=$TEST_API_URL … k6 run /perf/api-smoke-load.k6.js`, `handleSummary` output uploaded, the scenario-chooser input removed (a dynamic name cannot be a required context). **Per H6 = delete**: remove the workflow, the scenarios and the `k6` collector, and leave the k6 quarantine entries deleted with their files.
- [ ] 6K.3.2 WU-6.K4 · test-reach-contract › Every test-shaped file has exactly one collector, and every executing job of that collector is required · CODE ~15 · slice `refound/6-k6-b` — on the keep branch, fill the `k6` collector's `executedBy` and add "k6 Load Test" to the ruleset **in this same PR**, and empty the 6 k6 quarantine entries.
- [ ] 6K.3.3 **Red proof** WU-6.K4 · CODE ~0 · slice `refound/6-k6-b` — set a threshold to `p(95)<1` → k6 exits 99 and the job is red → restore.
- [ ] 6K.3.4 Tracker: M11 (runs in CI, required); M5 (quarantine −6); Gates row · CODE ~4 · slice `refound/6-k6-b`.

### 6P.1 · `refound/6-perf-retire` (WU-6.P1 + WU-6.P2)

- [ ] 6P.1.1 WU-6.P1 · k6-load-gate › The retired performance scripts leave with their files · design §3 D10 · CODE ~10 · slice `refound/6-perf-retire` — delete `performance/monitoring/memory-leak-detector.ts` (a synthetic function that leaks memory, never the application) and the duplicated root + api scripts.
- [ ] 6P.1.2 WU-6.P2 · k6-load-gate › The retired performance scripts leave with their files · CODE ~10 · slice `refound/6-perf-retire` — delete `performance/database/postgres-stress.test.ts` (624 lines, 0 assertions, always exit 0 — its class is now covered by k6 through the API) and `perf:baseline`, `perf:regression`, `perf:test` with their files, each backed by its ledger row. EVIDENCE ~2,100.
- [ ] 6P.1.3 Acceptance + Tracker (M1, M4, M5) · CODE ~4 · slice `refound/6-perf-retire` — the quarantine loses `postgres-stress.test.ts`; the #46 grep population drops by four of its five current hits.

### 6S.1 · `refound/6-security-fold` (WU-6.S1)

- [ ] 6S.1.1 **Measured** WU-6.S1 · http-security-posture-tier › The salvageable cases become one live-tier suite, measured before it is written · CODE ~0 · slice `refound/6-security-fold` — run the 12 salvageable cases against the live tier first and record the verdict of each **before** writing the suite. EVIDENCE ~150.
- [ ] 6S.1.2 RED WU-6.S1 · http-security-posture-tier › The salvageable cases become one live-tier suite, measured before it is written · CODE ~300 · slice `refound/6-security-fold` — write `apps/api/tests/integration/httpSecurityPosture.integration.test.ts` with the 12 cases: altered JWT signature → 401; `alg:none`, malformed or expired → 401; prototype pollution on a write route → 400 or stripped with no leak; **SSRF** on external notification sink URLs → rejected; `nosniff`, frame protection, no `X-Powered-By`; no stack or internals in 404/500; the login response carries no hash, secret or MFA material and does not echo the password; CORS (unknown origin not reflected with credentials, preflight rejected); a NoSQL operator in the login body → 400 not 500; an oversized body → 413; a dangerous file type on the real upload route → rejected; XXE on the SAML callback → rejected without expansion.
- [ ] 6S.1.3 WU-6.S1 · http-security-posture-tier › A case that comes back red opens an owned finding, and is never committed skipped · CODE ~10 · slice `refound/6-security-fold` — the SSRF case is **expected red**: open an owned SMELL/N-SEC row for it with a named owner; the case stays in the suite asserting the correct behaviour, never skipped, so the suite is red until the defect is fixed (or the row is the merge blocker Edward adjudicates).
- [ ] 6S.1.4 Tracker: Declared gaps / findings row for every red case; M2 · CODE ~4 · slice `refound/6-security-fold`.

### 6S.2 · `refound/6-security-delete` (WU-6.S2)

- [ ] 6S.2.1 WU-6.S2 · http-security-posture-tier › The old suite is deleted, and each case's destination is named · CODE ~5 · slice `refound/6-security-delete` — delete `security/tests/*` (7 suites, helpers, and the README that lives outside `docs/`) and any root script; SMELL-83 closes naming where each case went (folded, or discarded for having no surface or being already covered). EVIDENCE ~2,800.
- [ ] 6S.2.2 Acceptance + Tracker (M1, M4, M5) · CODE ~4 · slice `refound/6-security-delete` — the quarantine loses its 7 `security/tests` entries.

### 6V.1 · `refound/3-script-exits` (PR V13) — #46, after the k6/perf decision

- [ ] 6V.1.1 RED WU-3.13 · merge-verdict-composition › A script entrypoint cannot swallow its own failure (#46) · CODE ~15 · slice `refound/3-script-exits` — plant `.catch(console.error)` on a script entrypoint → exit 1.
- [ ] 6V.1.2 GREEN WU-3.13 · merge-verdict-composition › A script entrypoint cannot swallow its own failure (#46) · CODE ~60 · slice `refound/3-script-exits` — #46 as a hard-zero grep in a dependency-free job over `git ls-files '*.ts' '*.mts' '*.js'` for `\.catch\(\s*console\.(error|log|warn)\s*\)`; the current five hits are gone (four left with 6P.1, the fifth is fixed here); on the k6-keep branch also assert the report generator exits 1 on an empty results directory.
- [ ] 6V.1.3 **Red proof** WU-3.13 · CODE ~0 · slice `refound/3-script-exits` — 6V.1.1 through the complete step; restore.
- [ ] 6V.1.4 Tracker: Gates row (#46); M7 · CODE ~4 · slice `refound/3-script-exits`.

---

## Phase 6.N — New coverage: what has no tests today (design §7.12)

> **The slice count is fixed by 6.N0's measurement, never predicted here.** Coarse estimate from the plan: 150–250 new test files → 40–70 slices. Each slice: one package, ≤ 400 CODE, in an **isolated worktree** (D19 — the orchestrator owns every git operation and runs the hard probe, DD-22), raising that package's literal floor in the same PR, and landing only **after** that package's demolition slice and its `@test-utils/*` migration.

### 6N.0 · `refound/6n-order` (WU-6.N0) — the measured writing order

- [ ] 6N.0.1 **Measured** WU-6.N0 · behavioural-coverage-backfill › The writing order is measured, not assumed · design §7.12 · CODE ~0 · slice `refound/6n-order` — cross 5.2.3's per-package coverage with test density (core 488 sources / 72 tests; `core/domain` 183/4; the 11 packages with no test) and with risk (the tenant guard and GUC extensions, `core/customer-auth`, `core/auth`, `core/apiKeys`, the auth/mfa/admin routes; the publishing core; `core/billing`); output the ordered tracker table with, per package, current floor → target and the gap in files and unexecuted functions (from `coverage-final.json`). EVIDENCE ~300.
- [ ] 6N.0.2 WU-6.N0 · behavioural-coverage-backfill › The writing order is measured, not assumed · CODE ~10 · slice `refound/6n-order` — adjudicate the three storage adapters and `_template` (does anything import them?) **before** writing a test for them; a package of uncertain purpose goes to `untested-packages.json` with a reason instead.
- [ ] 6N.0.3 WU-6.N0 · behavioural-coverage-backfill › Parallel writers work in isolated worktrees, and the repository operations stay with one actor · CODE ~10 · slice `refound/6n-order` — write the slice list derived from 6N.0.1 into the tracker's Work-units table (one row per slice, with its package, its worktree and its owner), and append those rows to this file under the headings below.
- [ ] 6N.0.4 Tracker: M16 Baseline (packages at target / total; total unexecuted functions) · CODE ~4 · slice `refound/6n-order`.

### 6N.1 · `refound/6n-security-<n>` (WU-6.N1) — security first · slice count per 6N.0.1

- [ ] 6N.1.1 RED WU-6.N1 · behavioural-coverage-backfill › Security first, publishing core second · design §7.12 · CODE ≤ 400 per slice · slices `refound/6n-security-<n>` — the tenant guard proof a structural double cannot give, in the **integration tier**: `accountId` injected for every enrolled model and NOT injected for the denylisted ones; the GUC bound inside the transaction; `withSystemContext` behaviour. (Under the Prisma double `$extends` is an identity, so neither layer exists there — design §2f.)
- [ ] 6N.1.2 RED WU-6.N1 · behavioural-coverage-backfill › Security first, publishing core second · CODE ≤ 400 per slice · slices `refound/6n-security-<n>` — `core/customer-auth`, `core/auth`, `core/apiKeys`, and the untested auth/mfa/admin api routes through `buildRouteTestApp` + `inject`, **both directions**: 401/403 and the happy path with the body asserted.
- [ ] 6N.1.3 Acceptance WU-6.N1 · behavioural-coverage-backfill › Every new test proves in both directions, with the gutted subject as its acceptance · CODE ~0 · per slice — the orchestrator commits the writer's work in its worktree and runs `hard-probe` at that `HEAD` (DD-22): every new test comes back **RED** with the subject gutted; a self-reported probe is not evidence.
- [ ] 6N.1.4 WU-6.N1 · behavioural-coverage-backfill › Each package closes at its target floor or is listed as a declared gap with a reason · CODE ~10 per slice — each slice raises the package's literal floor via `autoUpdate` in the same PR; a package that cannot reach its target gets a Declared gaps row with a reason.
- [ ] 6N.1.5 Tracker: M8, M16 per slice · CODE ~4 per slice.

### 6N.2 · `refound/6n-publishing-<n>` (WU-6.N2) — the publishing core · slice count per 6N.0.1

- [ ] 6N.2.1 RED WU-6.N2 · behavioural-coverage-backfill › Security first, publishing core second · CODE ≤ 400 per slice · slices `refound/6n-publishing-<n>` — `packages/core/domain`: **every invariant gets a test that fails when it is violated and passes when it is met**; value objects; domain events carrying `aggregateId` and `occurredAt`; `reconstitute` of terminal states. `core/domain` is the largest package — several slices.
- [ ] 6N.2.2 RED WU-6.N2 · behavioural-coverage-backfill › Security first, publishing core second · CODE ≤ 400 per slice · slices `refound/6n-publishing-<n>` — `core/posts`, `core/channels`; the outbox claim statement in the **integration tier** (`publishedAt IS NULL AND retryCount < maxRetries AND nextRetryAt <= now` plus the lease); the saga (compensation in reverse order **only** pre-pivot; terminal sagas never re-execute).
- [ ] 6N.2.3 Acceptance + Tracker (probe RED per test; floors raised; M8, M16) · CODE ~4 per slice.

### 6N.3–6N.6 · the remaining families, in parallel per package (slice count per 6N.0.1)

- [ ] 6N.3.1 RED WU-6.N3 · behavioural-coverage-backfill › Each use case is covered on every Result branch, with values asserted · CODE ≤ 400 per slice · slices `refound/6n-core-<pkg>` — `core/billing` and the 39 contexts with a single test: per use case, **every** `Result` branch (validation, not-found, conflict, persistence failure — the branch webhooks lack today) and the happy path with **values** asserted, not `ok`. One package per PR (or two small ones).
- [ ] 6N.4.1 RED WU-6.N4 · behavioural-coverage-backfill › New tests consume the shared tooling and the single HTTP double · CODE ≤ 400 per slice · slices `refound/6n-routes-<area>` — the 36 untested api route files through `buildRouteTestApp` + `inject`: the full contract per route — auth required, Zod validation (400 with the detail), the success body asserted, and the domain-error → HTTP mapping through the **production** `errorPlugin`.
- [ ] 6N.5.1 RED WU-6.N5 · behavioural-coverage-backfill › New tests consume the shared tooling and the single HTTP double · CODE ≤ 400 per slice · slices `refound/6n-<pkg>` — the packages with no config: `packages/shared` (errors, `Result`, `channelCredentialsCrypto`: encrypt→decrypt→equal, wrong key→fails), `health-checks`, `opentelemetry`, `ports` (only what has runtime; pure interfaces go to `untested-packages.json` as verified `types-only`), `packages/ui` (49 components with RTL — render by props, interaction, state, and axe on the ones that open dialogs or menus; its vitest + jsdom config comes from the factory). `vitest-shared` is already born with tests in 4b.2 and 5.1.
- [ ] 6N.6.1 RED WU-6.N6 · behavioural-coverage-backfill › New tests consume the shared tooling and the single HTTP double · CODE ≤ 400 per slice · slices `refound/6n-<app>-<n>` — the untested `apps/client` and `apps/admin` hooks and components (MSW through `@test-utils/wire`), and `apps/workers` (17 of 125 files today: the publish worker, the mention ingest worker, the recorder).
- [ ] 6N.6.2 Acceptance WU-6.N · behavioural-coverage-backfill › Each package closes at its target floor or is listed as a declared gap with a reason · CODE ~0 · slices as above — every package in 6N.0.1's order is at floor ≥ target or in Declared gaps with a reason; **zero decorative-class blocks in anything new** (the 2.1 rules guarantee it, with no new suppression); M16 in the tracker.
- [ ] 6N.6.3 Tracker: M8, M16 per slice; Declared gaps rows · CODE ~4 per slice.

---

## Phase 7 — Mutation testing returns, with a purpose (design §7.13). **vitest 4 only.**

### 7.1 · `refound/7-entry-check` (WU-7.1 entry conditions)

- [ ] 7.1.1 **Measured** WU-7.1 · mutation-score-floors › Mutation is installed only after its entry conditions are measurably met · design §2k · CODE ~0 · slice `refound/7-entry-check` — prove from the tracker that Phase 5 is closed **and** 6.N1–6.N2's packages are at target. Nothing in Phase 7 may start otherwise: mutation over a thin base measures nothing.
- [ ] 7.1.2 Tracker: M12 entry row; Decisions log · CODE ~4 · slice `refound/7-entry-check`.

### 7.2 · `refound/7-tool-choice` (WU-7.1)

- [ ] 7.2.1 **Measured** WU-7.1 · mutation-score-floors › The tool is chosen against stated criteria, and the choice is recorded with numbers · CODE ~40 · slice `refound/7-tool-choice` — score the candidate against the stated criteria (vitest 4 support in the in-scope packages, reliable or verifiable per-test coverage, incremental mode, exit ≠ 0 on `break`, `disableBail`, per-mutant and per-test reporting, runtime inside the PR budget); pilot on `@core/accounts`, `@core/projects`, `@core/customer-auth`, `@core/application`; record the decision row with runtime and confirmed survivors.
- [ ] 7.2.2 Tracker: Decisions log with numbers; M12 · CODE ~4 · slice `refound/7-tool-choice`.

### 7.3 · `refound/7-mutation-runner` (WU-7.2 + WU-7.3)

- [ ] 7.3.1 GREEN WU-7.2 · mutation-score-floors › One root configuration, invoked per package — never one configuration per package · design §2k · CODE ~150 · slice `refound/7-mutation-runner` — one root `stryker.config.mjs` (`testRunner: "vitest"`, `coverageAnalysis: "perTest"`, `disableBail: true`, `reporters: ["json","clear-text"]`, `incremental: true` with a per-package `incrementalFile`, `ignoreStatic: true`, `timeoutMS` measured in the pilot) and `scripts/testing/mutation.mjs --package <name> [--incremental] [--mutate <range>]` deriving `mutate` from the convention and writing `reports/mutation/<pkg>/mutation.json`.
- [ ] 7.3.2 RED WU-7.3 · mutation-score-floors › Every survivor is CONFIRMED by an isolated re-run before it counts · CODE ~100 · slice `refound/7-mutation-runner` — each survivor is re-run alone with `coverageAnalysis: "off"` and `--mutate <range>`; only confirmed survivors count (the upstream false-"Survived" class); a run that gets dramatically faster is a **red condition**, not a win.
- [ ] 7.3.3 Tracker: M12 (score min/median per package) · CODE ~4 · slice `refound/7-mutation-runner`.

### 7.4 · `refound/7-mutation-floors` (WU-7.4)

- [ ] 7.4.1 RED WU-7.4 · mutation-score-floors › Mutation floors never descend (#49) · CODE ~20 · slice `refound/7-mutation-floors` — lower one floor in `mutation-floors.json` → exit ≠ 0.
- [ ] 7.4.2 GREEN WU-7.4 · mutation-score-floors › Mutation floors never descend (#49) · CODE ~80 · slice `refound/7-mutation-floors` — `mutation-floors.json` (`{"<pkg>": {"score", "measuredAt", "runId"}}`) with floors = the measured score rounded down, and gate #49 in #37's form (per package, by name, fail closed).
- [ ] 7.4.3 **Red proof** WU-7.4 · CODE ~0 · slice `refound/7-mutation-floors` — 7.4.1 through the complete step; restore.
- [ ] 7.4.4 Tracker: Gates row (#49); M12 · CODE ~4 · slice `refound/7-mutation-floors`.

### 7.5 · `refound/7-mutation-pr-lane` (WU-7.5)

- [ ] 7.5.1 RED WU-7.5 · mutation-score-floors › The pull-request lane is incremental and blocks on the configured failure condition · CODE ~20 · slice `refound/7-mutation-pr-lane` — delete the assertion that kills a pilot mutant → the incremental job exits ≠ 0.
- [ ] 7.5.2 GREEN WU-7.5 · mutation-score-floors › The pull-request lane is incremental and blocks on the configured failure condition · design §2k · CODE ~90 · slice `refound/7-mutation-pr-lane` — the PR job computing the changed `src` files in in-scope packages, restoring main's incremental file from an artifact, running `--incremental --mutate <changed>` and blocking on `break`; plus the weekly full run that refreshes the base and updates ONE tracking issue.
- [ ] 7.5.3 GREEN WU-7.5 · merge-verdict-composition › Only allowlisted jobs may write to the repository from CI (V8) · design §2h · CODE ~10 · slice `refound/7-mutation-pr-lane` — the weekly tracking-issue job needs `issues: write`, so it joins the `writers` allowlist in `collectors.json` **in this same slice**; it is never triggered on `pull_request`.
- [ ] 7.5.4 **Red proof** ×2 WU-7.5 · CODE ~0 · slice `refound/7-mutation-pr-lane` — 7.5.1, plus planting the weekly job's `issues: write` without the allowlist entry → verdict rule V8 exit 1; restore.
- [ ] 7.5.5 Tracker: M12; Gates rows · CODE ~4 · slice `refound/7-mutation-pr-lane`.

### 7.6 · `refound/7-mutation-ledger` (WU-7.6 + WU-7.7)

- [ ] 7.6.1 WU-7.6 · mutation-score-floors › Mutation results feed the ledger, and the both-directions rule is verified at scale · CODE ~80 · slice `refound/7-mutation-ledger` — feed the ledger: Stryker's green dry run = "passes when the code holds"; a killed mutant = "fails when it does not"; confirmed survivors = unrestricted behaviour; a test that kills 0 mutants (reliable thanks to `disableBail`) **reopens its ledger row** under criterion (a) or (d).
- [ ] 7.6.2 WU-7.7 · mutation-score-floors › The out-of-scope surfaces are DECLARED gaps with reasons, not silent omissions · CODE ~20 · slice `refound/7-mutation-ledger` — declare the gaps with their reasons: `apps/api` (the vitest runner is threads-only and Prisma's native binding crashes — measured) until upstream fork-pool support, a `pnpm patch` or a command runner over native-free slices; the node:test tier is not mutable (a stated limit, per X2's outcome).
- [ ] 7.6.3 Tracker: M12, M6 (reopened rows); Declared gaps rows · CODE ~4 · slice `refound/7-mutation-ledger`.

---

## Phase 8 — Docs and canon, then close (design §7.14)

> Rule: the true fact stays, the stale number goes, and a blocker that disappeared is **said** to have disappeared.

- [ ] 8.1.1 WU-8.2 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~80 · slice `refound/8-docs-testing` — fold any still-true pattern out of `docs/architecture/TESTING.md` (789 lines; stale runner versions, a "95 %+" coverage claim against measured floors, a citation of a non-existent ADR), then archive it with a FROZEN header pointing at `docs/development/TESTING_INFRASTRUCTURE.md` (state) and CODING_STANDARDS §Testing (rules); fix `docs/README.md`.
- [ ] 8.1.2 Tracker: the stale-doc adjudication row · CODE ~4 · slice `refound/8-docs-testing`.
- [ ] 8.2.1 WU-8.3 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~70 · slice `refound/8-docs-chaos` — fold `docs/architecture/chaos-testing.md` (the L1/L2/L3 taxonomy into the living document, the scenario backlog into the Phase 9 queue, "chaos runs in every PR; the nightly duplicate was removed") and archive it; re-link from the roadmap.
- [ ] 8.3.1 WU-8.4 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~70 · slice `refound/8-docs-providers` — after 6M.7.4, fold `docs/development/provider-testing.md` ("Add a provider's MSW handlers" into How to extend; the sandbox workflow, its test and the telegram alias are **said** to be gone) and archive it.
- [ ] 8.4.1 WU-8.5 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~40 · slice `refound/8-docs-saga` — keep and correct `saga-test-suites.md` (three suites: add the compensation-recovery and wait-amplification ones), linked from the living document.
- [ ] 8.5.1 WU-8.6 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~50 · slice `refound/8-docs-security` — keep and correct `SECURITY_TESTING_FRAMEWORK.md` (the real cron; `security/tests` and the Custom Security Test Suite job are said to be removed, with where each case went).
- [ ] 8.6.1 WU-8.7 · testing-canon-and-tracker › Each stale document is adjudicated — corrected, or archived as frozen with a pointer · CODE ~90 · slice `refound/8-docs-e2e` — after 6E.8, archive the four E2E READMEs with FROZEN headers and write the "End-to-end" section of the living document (seed, selectors, sidecar, how to run).
- [ ] 8.7.1 WU-8.8 · testing-canon-and-tracker › One living testing document, re-measured and protected from deletion · CODE ~120 · slice `refound/8-living-doc` — re-measure `docs/development/TESTING_INFRASTRUCTURE.md`: every closed F-n becomes "Decided" with its PR; add it to fitness #24's anti-deletion list **without** an `@`-import (D16).
- [ ] 8.7.2 **Red proof** WU-8.8 · testing-canon-and-tracker › One living testing document, re-measured and protected from deletion · CODE ~0 · slice `refound/8-living-doc` — delete the file (or strip its required section) → fitness #24 exit 1 → restore.
- [ ] 8.7.3 Tracker: Gates row (#24 extended); M7 · CODE ~4 · slice `refound/8-living-doc`.

### 8.8 · `refound/1-quarantine-retired` (PR R15) — the close

- [ ] 8.8.1 WU-1.15 · test-reach-contract › Quarantine is temporary and only shrinks · CODE ~60 (net −60) · slice `refound/1-quarantine-retired` — when phases 2, 4 and 6 have emptied it: delete `quarantine.json` and its handling in the runner and the engine; #30 becomes hard-zero.
- [ ] 8.8.2 **Red proof** WU-1.15 · CODE ~0 · slice `refound/1-quarantine-retired` — plant an unreached file → exit 1 **with no quarantine path available** → restore.
- [ ] 8.8.3 Acceptance WU-1.15 · testing-canon-and-tracker › Declared gaps are counted, never faked · CODE ~0 · slice `refound/1-quarantine-retired` — the change's DoD is verifiable from the tracker: every file has a ledger verdict and zero decorative suppressions; disk − ⋃collectors = 0; every new or modified gate has a demonstrated red; the tier reports 0 skipped / 0 cancelled; coverage is measured in all 86 with floors that never descend; E2E and k6 (or k6's recorded deletion) are required contexts; mutation blocks on `break` in the declared scope; one living document plus the amended canon; every package at its target floor or in Declared gaps.
- [ ] 8.8.4 Tracker: M5 hard-zero; M7 final; the As-of date and the closing row · CODE ~4 · slice `refound/1-quarantine-retired`.

---

## Phase 9 — The queue (out of this change's scope, declared here so it is not lost)

- [ ] 9.1 WU-9 · testing-canon-and-tracker › Declared gaps are counted, never faked · CODE ~10 · slice `refound/8-living-doc` — record in Declared gaps, each with an owner: N-COR-8 PR 1d/1e measured under the new battery, the feature backlog, the "schedule → published" E2E (N-COR-8/9), the chaos scenarios from the roadmap, and the settings route-contract gap from task 2.12.1.

---

## Slice index

Every slice targets `main` (`stacked-to-main`) and is merged in the order below. "Depends on" names the slice that must be **merged** first; slices with the same dependency are parallel-safe. "Gates (red proof)" lists the gates the slice creates or modifies — each has its own red-proof checkbox in the phase above. "Tracker" names the metric rows the slice moves in its own PR.

| Slice  | Branch                               | Batch | Depends on                                | Tasks        | CODE       | Gates (red proof)                                   | Tracker             |
| ------ | ------------------------------------ | ----- | ----------------------------------------- | ------------ | ---------- | --------------------------------------------------- | ------------------- |
| 0.1    | `refound/0-tracker`                  | **1** | base merges (Edward)                      | 0.1.1–0.1.6  | ~400       | — (fitness #24 row)                                 | M7 + seed all       |
| 0.2    | `refound/0-toolchain-measure`        | 2     | 0.1                                       | 0.2.1–0.2.3  | ~40        | —                                                   | T.4 table           |
| 0.3    | `refound/0-toolchain-holds`          | 3     | 0.2                                       | 0.3.1–0.3.6  | ~150       | holds-vs-`outdated` gate ✅                         | M7                  |
| 0.4    | `refound/0-toolchain-eslint`         | 4     | 0.3                                       | 0.4.1–0.4.3  | ~78        | —                                                   | T.4 table           |
| 0.4b   | `refound/0-holds-table-fix`          | 4b    | 0.4                                       | 0.4b.1–5     | ~111       | holds gate: remove-when red re-proven ✅            | M7, Gates, T.4      |
| 0.5    | `refound/0-toolchain-types-node`     | 5     | 0.3                                       | 0.5.1–0.5.4  | ~334       | `engines.node` gate ✅                              | M7                  |
| 0.6    | `refound/0-toolchain-tsx`            | 6     | 0.3                                       | 0.6.1–0.6.2  | ~29        | —                                                   | T.4 table           |
| 0.7    | `refound/0-toolchain-browser`        | 7     | 0.3                                       | 0.7.1–0.7.2  | ~54        | —                                                   | T.4 table           |
| 0.8    | `refound/0-toolchain-msw`            | 8     | 0.3                                       | 0.8.1–0.8.2  | ~29        | —                                                   | T.4 table           |
| 0.9    | `refound/0-toolchain-rtl`            | 9     | 0.3                                       | 0.9.1–0.9.2  | ~54        | —                                                   | T.4 table           |
| 0.10   | `refound/0-toolchain-vitest-plugin`  | 10    | 0.3                                       | 0.10.1–2     | ~29        | —                                                   | T.4 table           |
| 0.11   | `refound/0-toolchain-storybook`      | 11    | 0.3                                       | 0.11.1–5     | ~74        | —                                                   | T.4, M13            |
| 0.12   | `refound/0-toolchain-jsdom`          | 12    | 0.3 + **H1**                              | 0.12.1–3     | ~64        | —                                                   | Decisions           |
| 0.13   | `refound/0-toolchain-vite-shims`     | 13    | 0.3                                       | 0.13.1–2     | ~19        | —                                                   | T.4 table           |
| 0.14   | `refound/0-toolchain-build`          | 14    | 0.13                                      | 0.14.1–3     | ~50        | —                                                   | T.4 table           |
| 0.15   | `refound/0-toolchain-quality-gates`  | 15    | 0.14                                      | 0.15.1–3     | ~70        | —                                                   | T.4 table, Phase 0  |
| 0.16   | `refound/0-runtime-node-26`          | 16    | 0.15, containerization resume, 2026-10-28 | 0.16.1–4     | ~54        | engines gate red on a manifest ahead of the runtime | T.4 table, D23      |
| P.1    | `refound/3-fitness-inventory`        | —     | 0.1                                       | P.1.1–P.1.4  | ~64        | #44 ✅                                              | M7                  |
| P.2    | `refound/3-reporters`                | —     | 0.1                                       | P.2.1–P.2.4  | ~44        | shard reporters ✅                                  | M2, M7              |
| P.3    | `refound/3-openapi-drift`            | —     | 0.1                                       | P.3.1–P.3.3  | ~64        | OpenAPI Drift job ✅                                | M7                  |
| P.4    | `refound/3-gitleaks`                 | —     | 0.1                                       | P.4.1–P.4.3  | ~24        | gitleaks fail-closed ✅                             | M7                  |
| P.5    | `refound/3-osv-measure`              | —     | 0.1                                       | P.5.1–P.5.2  | ~34        | — (measurement)                                     | OSV table           |
| P.6    | `refound/4b-env-write`               | —     | 0.1                                       | P.6.1–P.6.5  | ~300       | env refusals ✅, hermetic ✅                        | M15, M7             |
| P.7    | `refound/2-classifier`               | —     | 0.1                                       | P.7.1–P.7.3  | ~334       | — (rules land in 2.1)                               | M3 denominator      |
| P.8    | `refound/2-ledger-a`                 | —     | P.7, 1.14                                 | P.8.1–P.8.3  | ~264       | `ledger --check` ✅                                 | M4, M6              |
| P.9    | `refound/2-ledger-b`                 | —     | P.8                                       | P.9.1–P.9.4  | ~234       | `--area` prediction ✅                              | M4, M6              |
| P.10   | `refound/2-probe`                    | —     | P.8                                       | P.10.1–7     | ~374       | probe root ✅, worktree lifecycle ✅×4              | M7                  |
| 1.1    | `refound/1-suffix`                   | —     | 0.13                                      | 1.1.1–1.1.3  | ~14        | —                                                   | M1, M5              |
| 1.2    | `refound/1-factory-converge`         | —     | 1.1                                       | 1.2.1–1.2.6  | ~254       | factory refusals ✅                                 | M5, M7              |
| 1.3    | `refound/1-resolution`               | —     | 1.2                                       | 1.3.1–1.3.4  | ~144       | source-resolution assertion ✅                      | M7, Decisions       |
| 1.4    | `refound/1-double-collection`        | —     | 1.3                                       | 1.4.1–1.4.3  | ~254       | —                                                   | M5                  |
| 1.5    | `refound/1-timing-in-tests`          | —     | 1.4                                       | 1.5.1–1.5.4  | ~39        | contamination restore ✅×2                          | M9                  |
| 1.6    | `refound/1-tier-measure`             | —     | 1.5                                       | 1.6.1–1.6.2  | ~4         | — (measurement)                                     | M9 Baseline         |
| 1.7    | `refound/1-tier-rename`              | —     | 1.6                                       | 1.7.1–1.7.3  | ~114       | —                                                   | M1, M9              |
| 1.8    | `refound/1-runner-envfix`            | —     | 1.1 (or before)                           | 1.8.1–1.8.4  | ~134       | A1 data-loss refusal ✅                             | M7                  |
| 1.9    | `refound/1-services-collector`       | —     | 1.7, 1.8                                  | 1.9.1–1.9.7  | ~264       | 4 runner guards ✅, interim #30 ✅                  | M5, M9, M7          |
| 1.10   | `refound/4b-db` (PR E2)              | —     | P.6, 1.9                                  | 1.10.1–5     | ~274       | 4 identity/contamination refusals ✅                | M15, M7             |
| 1.11   | `refound/4b-processes` (PR E3a)      | —     | 1.10                                      | 1.11.1–5     | ~294       | 7 subprocess-lifecycle REDs ✅                      | M7                  |
| 1.12   | `refound/4b-integration-recipe`      | —     | 1.11                                      | 1.12.1–5     | ~204       | recipe phase order ✅, `full-integration` ✅        | M9, M7              |
| 1.13   | `refound/1-live-collector` (PR R8)   | —     | 1.12                                      | 1.13.1–5     | ~244       | `probe_live` ✅×2                                   | M5, M9, M7          |
| 1.14   | `refound/1-reach-engine` (PR R9a)    | —     | 1.13                                      | 1.14.1–4     | ~254       | fail-closed conditions                              | Decisions           |
| 1.15   | `refound/1-reach-selftests` (R9b)    | —     | 1.14                                      | 1.15.1–5     | ~184       | one RED per reach rule ✅                           | M5, M7              |
| 1.16   | `refound/1-test-contracts-job` (R10) | —     | 1.15, P.1                                 | 1.16.1–7     | ~124       | #30 new form ✅×6, mirror ruleset                   | M5, M7              |
| 1.17   | `refound/1-script-contract` (R11)    | —     | 1.16                                      | 1.17.1–4     | ~59        | part C ✅, #31 A widened ✅                         | M7                  |
| 1.18   | `refound/1-scopes` (PR R12)          | —     | 1.16                                      | 1.18.1–4     | ~154       | #36 new home ✅×2                                   | M7                  |
| 1.19   | `refound/1-node-reporter` (R16)      | —     | 1.9, 1.13                                 | 1.19.1–4     | ~174       | 4 guards re-proven ✅                               | M2, M9, M7          |
| 2.1    | `refound/2-lint-rules`               | —     | P.7, P.10                                 | 2.1.1–2.1.8  | ~314       | 3 `testing/*` rules ✅, #48 ✅                      | M3, M13, M7         |
| 2.2    | `refound/2-ledger-listing`           | —     | 2.1, P.9 · **H3**                         | 2.2.1–2.2.3  | ~4         | —                                                   | M6                  |
| 2.3    | `refound/2-coverage-exception`       | —     | 2.2 · **H8**                              | 2.3.1–2.3.4  | ~44        | #37 scenario ✅                                     | M14, Decisions      |
| 2.4    | `refound/2-whole-files`              | —     | 2.3                                       | 2.4.1–2.4.3  | ~10        | —                                                   | M1, M2, M4, M5      |
| 2.5    | `refound/2-todo-stubs`               | —     | 2.2                                       | 2.5.1–2.5.3  | ~6         | —                                                   | M2, M9, gaps        |
| 2.6    | `refound/2-dead-helpers`             | —     | 2.2 · **H2**                              | 2.6.1–2.6.4  | ~9         | —                                                   | M1, M4, M5          |
| 2.7    | `refound/2-blocks-1a`                | —     | 2.3                                       | 2.7.1–2.7.2  | ~324       | —                                                   | M2, M3, M14         |
| 2.8    | `refound/2-blocks-1b`                | —     | 2.7                                       | 2.8.1–2.8.2  | ~354       | —                                                   | M2, M3, M14         |
| 2.9    | `refound/2-blocks-2a`                | —     | 2.8                                       | 2.9.1–2.9.2  | ~354       | —                                                   | M2, M3, M14         |
| 2.10   | `refound/2-blocks-2b`                | —     | 2.9                                       | 2.10.1–2     | ~354       | —                                                   | M2, M3, M14         |
| 2.11   | `refound/2-blocks-3`                 | —     | 2.10                                      | 2.11.1–2     | ~354       | —                                                   | M2, M3, M14         |
| 2.12   | `refound/2-blocks-4`                 | —     | 2.11                                      | 2.12.1–2     | ~354       | —                                                   | M2, M3, M14, gaps   |
| 2.13   | `refound/2-blocks-5`                 | —     | 2.12, 1.19                                | 2.13.1–2     | ~304       | —                                                   | M2, M3              |
| 2.14   | `refound/2-blocks-6`                 | —     | 2.3 (parallel)                            | 2.14.1–2     | ~304       | —                                                   | M2, M3              |
| 2.15   | `refound/2-blocks-7`                 | —     | 2.3 (parallel)                            | 2.15.1–2     | ~304       | —                                                   | M2, M3              |
| 2.16   | `refound/2-rewrites`                 | —     | 2.13, P.10                                | 2.16.1–3     | ~64        | probe RED per rewrite ✅                            | M6                  |
| 3.1    | `refound/3-coverage-certifies` (V4)  | —     | P.2                                       | 3.1.1–3.1.4  | ~44        | certify-refusal ✅                                  | M7                  |
| 3.2    | `refound/3-remove-duplicate-gates`   | —     | 3.1 · **H4**                              | 3.2.1–3.2.5  | ~149       | (verdict rule V1 covers it)                         | M7, Decisions       |
| 3.3    | `refound/3-skip-gate` (PR V8)        | —     | 2.5, P.2                                  | 3.3.1–3.3.4  | ~84        | skip gate ✅                                        | M2, M9, M7          |
| 3.4    | `refound/1-skips-ast` (PR R13)       | —     | 1.16, 2.13, 4.2                           | 3.4.1–3.4.5  | ~214       | #32 new form ✅×4                                   | M9, M7              |
| 3.5    | `refound/3-verdict-static` (PR V9)   | —     | 1.16, 3.1, 3.2                            | 3.5.1–3.5.5  | ~444       | #45 V1/V2/V3/V7/V8 ✅×7                             | M7                  |
| 3.6    | `refound/3-ruleset` (PR V11)         | —     | 3.5 · **H5**                              | 3.6.1–3.6.5  | ~94        | required-context composition ✅                     | M15, Decisions      |
| 3.7    | `refound/3-verdict-drift` (PR V10)   | —     | 3.6                                       | 3.7.1–3.7.4  | ~194       | #45 V4/V5/V6 ✅×5                                   | M7                  |
| 3.8    | `refound/3-osv-decide` (PR V7b)      | —     | P.5, 3.6                                  | 3.8.1–3.8.3  | ~44        | OSV ignores ✅ or removal                           | Decisions           |
| 4b.1   | `refound/4b-adopt-workflows` (E4)    | —     | 1.12                                      | 4b.1.1–3     | ~154       | (#47 covers it) ✅                                  | M15                 |
| 4b.2   | `refound/4b-loader` (PR E5)          | —     | P.6                                       | 4b.2.1–4     | ~69        | loader refusal ✅                                   | M7                  |
| 4b.3   | `refound/4b-playwright-servers`      | —     | 1.11                                      | 4b.3.1–4     | ~74        | `webServer` from the script ✅                      | M7, Decisions       |
| 4b.4   | `refound/4b-identity` (PR E7)        | —     | 4b.1, 1.16                                | 4b.4.1–4     | ~184       | #47 ✅×3                                            | M15, M7             |
| 4b.5   | `refound/4b-hermetic-shards` (E8)    | —     | P.6, P.3                                  | 4b.5.1–4     | ~74        | hermetic shards ✅                                  | M8, Decisions       |
| S.1    | `refound/s-skeleton`                 | —     | 2.2                                       | S.1.1–S.1.4  | ~184       | depcruise `src ↛ test-utils` ✅×2                   | M13, M7             |
| S.2    | `refound/s-builders`                 | —     | S.1                                       | S.2.1–S.2.3  | ~244       | —                                                   | M13                 |
| S.3    | `refound/s-raw-reach`                | —     | S.2                                       | S.3.1–S.3.4  | ~154       | recorder classifier ✅                              | raw-reach table     |
| S.4    | `refound/s-uow-canon`                | —     | S.3                                       | S.4.1–S.4.4  | ~124       | transient UoW ✅                                    | Decisions           |
| S.5    | `refound/s-prisma-double`            | —     | S.4                                       | S.5.1–S.5.5  | ~314       | raw-SQL throw ✅                                    | M13, M6             |
| S.6    | `refound/s-redis-double`             | —     | S.5                                       | S.6.1–S.6.4  | ~324       | unsupported command ✅                              | M13                 |
| S.7    | `refound/s-route-app`                | —     | S.5                                       | S.7.1–S.7.2  | ~144       | production `errorPlugin` ✅                         | M13                 |
| S.8    | `refound/s-route-app-1`              | —     | S.7                                       | S.8.1        | ~300       | —                                                   | M13                 |
| S.9    | `refound/s-route-app-2`              | —     | S.8                                       | S.9.1        | ~300       | —                                                   | M13                 |
| S.10   | `refound/s-route-app-3`              | —     | S.9                                       | S.10.1–2     | ~304       | —                                                   | M13                 |
| S.11   | `refound/s-seed`                     | —     | S.5                                       | S.11.1–2     | ~164       | tenant-scoped cleanup ✅                            | M13                 |
| S.12   | `refound/s-seed-migrate-1`           | —     | S.11                                      | S.12.1       | ~300       | —                                                   | M13                 |
| S.13   | `refound/s-seed-migrate-2`           | —     | S.12                                      | S.13.1–2     | ~304       | —                                                   | M13                 |
| S.14   | `refound/s-builder-gate`             | —     | S.2, S.5                                  | S.14.1–4     | ~74        | builder-name ✅, cast ✅                            | M13, M7             |
| S.15   | `refound/s-migrate-core`             | —     | S.14, 2.14                                | S.15.1       | ~300       | —                                                   | M13                 |
| S.16   | `refound/s-migrate-adapters`         | —     | S.14, 2.14                                | S.16.1       | ~300       | —                                                   | M13                 |
| S.17   | `refound/s-migrate-providers`        | —     | S.14, 2.14                                | S.17.1       | ~300       | —                                                   | M13                 |
| S.18   | `refound/s-migrate-workers`          | —     | S.14, 2.15                                | S.18.1       | ~250       | —                                                   | M13                 |
| S.19   | `refound/s-migrate-api`              | —     | S.14, 2.13                                | S.19.1       | ~350       | —                                                   | M13                 |
| S.20   | `refound/s-migrate-client`           | —     | S.14, 2.15                                | S.20.1–2     | ~304       | both gates hard-zero ✅                             | M13                 |
| 4.1    | `refound/4-preconditions-a`          | —     | 1.13                                      | 4.1.1–4.1.3  | ~244       | throwing precondition ✅                            | M9                  |
| 4.2    | `refound/4-preconditions-b`          | —     | 4.1                                       | 4.2.1–4.2.3  | ~204       | —                                                   | M9                  |
| 4.3    | `refound/4-production-rewrite`       | —     | 4.2                                       | 4.3.1–4.3.4  | ~174       | probe RED ✅                                        | M2, M6              |
| 4.4    | `refound/4-outbox-topology`          | —     | 1.12, 4.3                                 | 4.4.1–4.4.4  | ~84        | `assertNoForeignRelay` ✅                           | M7                  |
| 4.5    | `refound/4-unquarantine-db`          | —     | 4.4                                       | 4.5.1–4.5.2  | ~14        | —                                                   | M5, M9              |
| 4.6    | `refound/4-unquarantine-live`        | —     | 4.5                                       | 4.6.1–4.6.3  | ~20        | —                                                   | M5, M9              |
| 4.7    | `refound/4-chaos`                    | —     | 4.6                                       | 4.7.1–4.7.2  | ~14        | —                                                   | M5, M15             |
| 4.8    | `refound/3-nightly` (PR V12)         | —     | 1.12, 1.13                                | 4.8.1–4.8.4  | ~124       | one-alarm ✅ (3 GitHub-write REDs)                  | M15, M7             |
| 4.9    | `refound/1-registered-entrypoints`   | —     | 4.8, 3.2                                  | 4.9.1–4.9.4  | ~134       | reach part B ✅                                     | M7                  |
| 4.10   | `refound/4-tier-acceptance`          | —     | 4.7, 4.9                                  | 4.10.1–2     | ~24        | —                                                   | M5, M9              |
| X.1    | `refound/x-runner-experiment`        | —     | 1.13, 1.12, 3.3                           | X.1.1        | 0 merged   | — (unmerged branch)                                 | —                   |
| X.2    | `refound/x-runner-evidence`          | —     | X.1 · **H7**                              | X.1.2–X.2.2  | ~70        | —                                                   | X1 table, Decisions |
| 5.1    | `refound/5-coverage-defaults` (C1)   | —     | 1.18                                      | 5.1.1–5.1.4  | ~104       | #36 coverage globs ✅, turbo `inputs` ✅            | M8, M7              |
| 5.2    | `refound/5-coverage-measure` (C2)    | —     | 5.1                                       | 5.2.1–5.2.4  | ~59        | summary-count ✅                                    | M8, Decisions       |
| 5.3    | `refound/5-floors-core-a` (C3)       | —     | 5.2                                       | 5.3.1–5.3.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.4    | `refound/5-floors-core-b` (C4)       | —     | 5.3                                       | 5.4.1–5.4.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.5    | `refound/5-floors-packages` (C5)     | —     | 5.4                                       | 5.5.1–5.5.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.6    | `refound/5-floors-apps` (C6)         | —     | 5.5                                       | 5.6.1–5.6.2  | ~334       | thresholds ✅                                       | M8                  |
| 5.7    | `refound/5-floor-ratchet` (C7)       | —     | 5.6, 2.3                                  | 5.7.1–5.7.5  | ~244       | #37 new form ✅×6                                   | M7, M14             |
| 5.8    | `refound/5-floors-enforced` (C8)     | —     | 5.7                                       | 5.8.1–5.8.3  | ~54        | risen-floor ✅×2                                    | M8, M7              |
| 5.9    | `refound/5-denominator` (C9)         | —     | 5.7                                       | 5.9.1–5.9.4  | ~174       | denominator ✅×3                                    | M8, gaps            |
| 5.10   | `refound/5-canon-floors` (C10)       | —     | 5.8                                       | 5.10.1–2     | ~154       | —                                                   | M8, M16, Decisions  |
| 6M.1   | `refound/6-msw-core`                 | —     | S.1, 1.2                                  | 6M.1.1–6     | ~244       | network isolation ✅                                | M13, M7             |
| 6M.2   | `refound/6-msw-gate`                 | —     | 6M.1                                      | 6M.2.1–5     | ~209       | fetch-stub gate ✅                                  | M13, M7             |
| 6M.3   | `refound/6-msw-client-1`             | —     | 6M.2, 2.15                                | 6M.3.1       | ~300       | —                                                   | M13                 |
| 6M.4   | `refound/6-msw-client-2`             | —     | 6M.3                                      | 6M.4.1       | ~300       | —                                                   | M13                 |
| 6M.5   | `refound/6-msw-admin`                | —     | 6M.2, 2.15                                | 6M.5.1       | ~300       | —                                                   | M13                 |
| 6M.6   | `refound/6-msw-api`                  | —     | 6M.2, 2.13                                | 6M.6.1       | ~350       | —                                                   | M13                 |
| 6M.7a  | `refound/6-msw-providers-1`          | —     | 6M.2, S.17                                | 6M.7.1       | ~350       | —                                                   | M13                 |
| 6M.7b  | `refound/6-msw-providers-2`          | —     | 6M.7a                                     | 6M.7.2       | ~350       | —                                                   | M13                 |
| 6M.7c  | `refound/6-msw-providers-3`          | —     | 6M.7b                                     | 6M.7.3       | ~350       | —                                                   | M13                 |
| 6M.7d  | `refound/6-msw-providers-4`          | —     | 6M.7c                                     | 6M.7.4       | ~350       | —                                                   | M13                 |
| 6M.8   | `refound/6-msw-close`                | —     | 6M.7d, 6M.6, 6M.4                         | 6M.8.1–2     | ~24        | fetch-stub hard-zero ✅                             | M13 → 0             |
| 6E.1   | `refound/6-e2e-demolish`             | —     | 2.2                                       | 6E.1.1–3     | ~64        | —                                                   | M1, M4, M10         |
| 6E.2   | `refound/6-seed-e2e`                 | —     | 1.10, 6E.1                                | 6E.2.1–3     | ~194       | owner-connection refusal ✅                         | M10, M7             |
| 6E.3   | `refound/6-provider-seam`            | —     | 6M.1, 6M.7d                               | 6E.3.1–5     | ~244       | production refusal ✅, sidecar contract ✅          | M7, Decisions       |
| 6E.4   | `refound/6-e2e-config`               | —     | 4b.3, 6E.2, 6E.3                          | 6E.4.1–3     | ~124       | `failOnFlakyTests` ✅                               | M10, M7             |
| 6E.5   | `refound/6-e2e-specs-a`              | —     | 6E.4                                      | 6E.5.1–2     | ~154       | —                                                   | M10                 |
| 6E.6   | `refound/6-e2e-specs-b`              | —     | 6E.5                                      | 6E.6.1–3     | ~114       | sidecar 500 → red ✅                                | M10                 |
| 6E.7   | `refound/6-admin-e2e`                | —     | 6E.4                                      | 6E.7.1–4     | ~159       | a11y contrast ✅                                    | M10, gaps           |
| 6E.8   | `refound/6-e2e-ci`                   | —     | 6E.6, 6E.7, 3.6                           | 6E.8.1–7     | ~164       | E2E job ✅×2, reach row + ruleset                   | M10, M5, M7         |
| 6E.9   | `refound/6-e2e-gap`                  | —     | 6E.8                                      | 6E.9.1–2     | ~14        | —                                                   | gaps                |
| 6K.1   | `refound/6-k6-a`                     | —     | 6E.2, 1.12                                | 6K.1.1–4     | ~184       | `API_BASE_URL` throw ✅, threshold ✅               | M11, M7             |
| 6K.2   | `refound/6-k6-calibrate`             | —     | 6K.1 · **H6**                             | 6K.2.1–3     | ~9         | —                                                   | M11, Decisions      |
| 6K.3   | `refound/6-k6-b`                     | —     | 6K.2, 3.6                                 | 6K.3.1–4     | ~79        | k6 job ✅, reach row + ruleset                      | M11, M5, M7         |
| 6P.1   | `refound/6-perf-retire`              | —     | 2.2, 6K.2                                 | 6P.1.1–3     | ~24        | —                                                   | M1, M4, M5          |
| 6S.1   | `refound/6-security-fold`            | —     | 4.1, 1.13                                 | 6S.1.1–4     | ~314       | —                                                   | M2, gaps            |
| 6S.2   | `refound/6-security-delete`          | —     | 6S.1                                      | 6S.2.1–2     | ~9         | —                                                   | M1, M4, M5          |
| 6V.1   | `refound/3-script-exits` (PR V13)    | —     | 6K.3, 6P.1                                | 6V.1.1–4     | ~79        | #46 ✅                                              | M7                  |
| 6N.0   | `refound/6n-order`                   | —     | 5.2                                       | 6N.0.1–4     | ~14        | —                                                   | M16 Baseline        |
| 6N.1.* | `refound/6n-security-<n>`            | —     | 6N.0, S.19, 2.13                          | 6N.1.1–5     | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.2.* | `refound/6n-publishing-<n>`          | —     | 6N.1, S.15                                | 6N.2.1–3     | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.3.* | `refound/6n-core-<pkg>`              | —     | 6N.2, S.15                                | 6N.3.1       | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.4.* | `refound/6n-routes-<area>`           | —     | 6N.1, S.10                                | 6N.4.1       | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.5.* | `refound/6n-<pkg>`                   | —     | 6N.0, 5.9                                 | 6N.5.1       | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 6N.6.* | `refound/6n-<app>-<n>`               | —     | 6N.0, S.18, S.20                          | 6N.6.1–3     | ≤400/slice | probe RED per test ✅                               | M8, M16             |
| 7.1    | `refound/7-entry-check`              | —     | 5.10, 6N.2                                | 7.1.1–7.1.2  | ~4         | —                                                   | M12                 |
| 7.2    | `refound/7-tool-choice`              | —     | 7.1                                       | 7.2.1–7.2.2  | ~44        | —                                                   | M12, Decisions      |
| 7.3    | `refound/7-mutation-runner`          | —     | 7.2                                       | 7.3.1–7.3.3  | ~254       | survivor confirmation ✅                            | M12                 |
| 7.4    | `refound/7-mutation-floors`          | —     | 7.3                                       | 7.4.1–7.4.4  | ~104       | #49 ✅                                              | M12, M7             |
| 7.5    | `refound/7-mutation-pr-lane`         | —     | 7.4, 3.5                                  | 7.5.1–7.5.5  | ~124       | incremental `break` ✅, V8 allowlist ✅             | M12, M7             |
| 7.6    | `refound/7-mutation-ledger`          | —     | 7.5                                       | 7.6.1–7.6.3  | ~104       | —                                                   | M12, M6, gaps       |
| 8.1    | `refound/8-docs-testing`             | —     | 2.1, 5.10                                 | 8.1.1–8.1.2  | ~84        | —                                                   | docs row            |
| 8.2    | `refound/8-docs-chaos`               | —     | 4.7                                       | 8.2.1        | ~70        | —                                                   | docs row            |
| 8.3    | `refound/8-docs-providers`           | —     | 6M.7d                                     | 8.3.1        | ~70        | —                                                   | docs row            |
| 8.4    | `refound/8-docs-saga`                | —     | 1.13                                      | 8.4.1        | ~40        | —                                                   | docs row            |
| 8.5    | `refound/8-docs-security`            | —     | 6S.2                                      | 8.5.1        | ~50        | —                                                   | docs row            |
| 8.6    | `refound/8-docs-e2e`                 | —     | 6E.8                                      | 8.6.1        | ~90        | —                                                   | docs row            |
| 8.7    | `refound/8-living-doc`               | —     | 8.1–8.6                                   | 8.7.1–3, 9.1 | ~134       | #24 extended ✅                                     | M7, gaps            |
| 8.8    | `refound/1-quarantine-retired`       | —     | 4.10, 6E.8, 6K.3, 6N.6                    | 8.8.1–4      | ~74        | #30 hard-zero ✅                                    | M5 → 0, M7          |

**Dependency bottlenecks worth naming.** 1.16 (`Test Contracts`) is the highest-fan-out slice: 15 later slices read its engine or its ruleset, and a defect in it blocks every PR (design §9 risk 9 — rollback is reverting that one PR, which brings the old grep steps back). 2.2 (**H3**) gates all 13 demolition slices and Track S's start. 3.6 (**H5**, admin) gates every later required context, so 6E.8 and 6K.3 cannot make E2E or k6 required before it. S.4's canon fix gates S.5, and S.5 gates the whole route-app and seed chain. 6N is the long tail: its 40–70 slices are parallel **per package**, but each waits on that package's demolition slice and its `@test-utils/*` migration, so S.15–S.20 are its real critical path.
