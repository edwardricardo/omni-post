# Testing Re-foundation — Progress Tracker

**Owner:** Platform engineering
**As of:** 2026-09-30, slice `0.17` `refound/0-audit-floors` — the repair slice, and the first to move a row
for a red NO slice authored: **six** CVE-floor bands the advisory database overtook after they were correct
(`fast-uri` 3.1.6 → **3.1.8** and 4.1.3 → **4.1.5** — raised TWICE in this one change, the second time
finding the tree on the targets the first had set 90 minutes earlier; `undici` 7.29.0 → **7.29.1**;
`brace-expansion` 1.1.18 / 2.1.4 / 5.0.9 → **1.1.21 / 2.1.7 / 5.0.12**, all three also sitting on their own
previous targets — band AND target together every time), one NEW floor (`webpack-dev-middleware` **7.4.6**,
a major forced over `^6.1.2` because nothing
in the tree can reach the patch — and 7.4.6 rather than the 7.4.5 the advisory's own range string implies,
because its `first_patched_version` and OSV both say 7.4.6, so `pnpm audit` alone would have gone green over
a still-vulnerable version), one transitive resolved NATURALLY with no pin at all (`joi` 17.13.4 →
17.13.8), and the `@typescript-eslint` pair 8.70.0 → **8.70.1** because 8.70.1 matured at
`2026-09-28T17:09Z`, after slice `0.4` correctly measured it immature. `pnpm audit --audit-level moderate`
goes 1 → **0** and `holds-gate.mjs` goes 1 → **0**, with no ignore added and no threshold moved. Previous:
`0.5` `refound/0-toolchain-types-node` (`@types/node` 25.9.3 → **24.13.6**, a DOWNWARD move across a major,
because 25.9.3 sat above the runtime on an odd, non-LTS line; `engines.node` `>=24.15.0 <25` in **all 98**
manifests, where 0 declared it before; and `scripts/testing/engines-node-gate.mjs`, which refuses a manifest
or a types pin whose major differs from `.nvmrc`. M7 `1/1` → `2/2`, M1 `946 + 8` → `947 + 8`). This line
moves with the last pull request that moved a row)
**Baseline:** `main` @ `6701be00`, measured 2026-09-27

The measured state of the testing re-foundation, and the fixed plan it executes. Rules live in
[`docs/development/CODING_STANDARDS.md`](CODING_STANDARDS.md) §Testing; the measured description of
the test system lives in `docs/development/TESTING_INFRASTRUCTURE.md`; progress lives here and
nowhere else.

**Two facts about this document, stated up front rather than discovered later.**

1. **It is updated by the pull request that moves a metric**, never by a separate tracker pull
   request. The single exception is a re-plan, which is recorded in
   [§Decisions log](#decisions-log) with its date and its reason.
2. **Every baseline below is measured, never predicted.** Where a number could not be derived from
   the tree at the baseline commit, the row says so in `Re-derive with` and names the artefact or the
   run that produced it. `scripts/testing/metrics.mjs --all` prints the whole table and marks each
   row `derived`, `unavailable` or `pasted`, so a number that stops being derivable becomes visible
   instead of silently stale.

**Finding numbering, and why that path is not a link.**
`docs/development/TESTING_INFRASTRUCTURE.md` (findings F-1…F-17) is not on `main` at the baseline
commit — it sits on an unmerged pull request. Rows below cite its F-numbers anyway, because they are
the numbering the plan was written against. The path is written as code rather than as a hyperlink on
purpose: a link that resolves nowhere is a defect a link checker reports, and "it will exist later"
is exactly the excuse that leaves dangling references in a tree. The pull request that merges that
document turns this into a link and reconciles the F-numbers against the protected branch — that is
its work unit's job, not a note left here.

---

## Estado

### Metrics

Sixteen metrics. `Baseline` is the measured value at `main` @ `6701be00`; `Now` starts equal to it
and moves only with a pull request that moved it; `Moved by` names that pull request by the short
alias its slice used for review — `PR B` is the `metrics.mjs` half of `refound/0-tracker`, and
`PR gate` is `refound/0-toolchain-holds-gate`, the holds-gate half of `refound/0-toolchain-holds`.

| #   | Metric                                                            | Baseline              | Now                   | Target        | Re-derive with                                                                          | Moved by |
| --- | ----------------------------------------------------------------- | --------------------- | --------------------- | ------------- | --------------------------------------------------------------------------------------- | -------- |
| M1  | Test files (workspaces + outside)                                 | 942 + 8               | 947 + 8               | ledger-driven | `metrics.mjs --m1` (derived: `git ls-files`)                                            | PR gate  |
| M2  | Tests: vitest passed / todo · node:test (TIER) · Playwright in CI | 12,580 / 43 · 934 · 0 | 12,580 / 43 · 934 · 0 | todo 0        | `metrics.mjs --m2` (pasted: local vitest run + TIER summary, report F-report §State)    | —        |
| M3  | Decorative blocks deleted / remaining (suppressions)              | 0 / ≤272              | 0 / ≤272              | — / 0         | `metrics.mjs --m3` (`eslint-suppressions.json` per rule; absent at baseline)            | —        |
| M4  | Decorative whole files deleted                                    | 0                     | 0                     | per ledger    | `metrics.mjs --m4` (`ledger.json`; absent at baseline)                                  | —        |
| M5  | Orphan test files · files with 2 collectors                       | 23 · ≥10              | 23 · ≥10              | 0 · 0         | `metrics.mjs --m5` (`test-contracts reach --json`, WU-1.9; absent at baseline)          | —        |
| M6  | Ledger rows: machine / confirmed / total                          | —                     | —                     | 0 / N / N     | `metrics.mjs --m6` (`ledger.json`; absent at baseline)                                  | —        |
| M7  | Gates new/modified, red proven                                    | 0/0                   | 2/2                   | n/n           | `metrics.mjs --m7` (derived: this document's [§Gates](#gates) table)                    | PR gate  |
| M8  | Packages with coverage measured · floors min/median/api           | 1/86 · —/—/56.8       | 1/86 · —/—/56.8       | 86/86         | `metrics.mjs --m8` (derived: tracked `vitest.config.*` thresholds)                      | —        |
| M9  | TIER runs: skipped / cancelled · runtime `t.skip` sites           | 0/0 · 114             | 0/0 · 114             | 0/0 · 0       | `metrics.mjs --m9` (pasted: TIER run summary; sites by WU-1.13 AST scan)                | —        |
| M10 | E2E specs in CI, required? · last verdict                         | 0 · no                | 0 · no                | ≥6 · yes      | `metrics.mjs --m10` (run id, once WU-6.E8 lands the job)                                | —        |
| M11 | k6 runs in CI · last verdict                                      | 0                     | 0                     | every PR      | `metrics.mjs --m11` (run id, once WU-6.K4 lands the job)                                | —        |
| M12 | Mutation: packages in scope · score min/median · floors           | none                  | none                  | per Phase 7   | `metrics.mjs --m12` (`mutation-floors.json` + `reports/mutation/*`; absent at baseline) | —        |
| M13 | fetch stubs · local canonical builders · `PrismaClient` casts     | 44 · ≥60 · 35         | 44 · ≥60 · 35         | 0 · 0 · 0     | `metrics.mjs --m13` (`eslint-suppressions.json` per rule; absent at baseline)           | —        |
| M14 | Coverage that was decorative (floor descents with marker)         | 0                     | 0                     | recorded      | `metrics.mjs --m14` (`ledger.json` marker slices; absent at baseline)                   | —        |
| M15 | Open nightly alarms · Postgres identities in workflows            | 31 · 4                | 31 · 4                | ≤1 · 1        | `metrics.mjs --m15` (network: `gh issue list`; identities by WU-4b.7)                   | —        |
| M16 | Packages at target floor / total · uncovered functions (sum)      | per 6.N0              | per 6.N0              | all / all · ↓ | `metrics.mjs --m16` (`coverage-final.json`; absent at baseline)                         | —        |

**How the baselines were obtained.** M1, M7 and M8 are derived from the tree and reproduced
byte-for-byte by `scripts/testing/metrics.mjs`, pinned by
`apps/api/tests/unit/scripts/testingMetrics.test.ts`. M15's first half was measured with
`gh issue list --label nightly-failure --state open` (31); its second half was measured by counting
the distinct `(image, POSTGRES_DB)` pairs across `services.postgres` in `.github/workflows/` (4) and
becomes derivable when WU-4b.7 lands `test-contracts identity --json`. M2, M9, M10, M11 and M12 come
from a runner summary or a named run, which is why their cells say so: the script prints their
source rather than inventing a number. M3, M4, M6, M13, M14 and M16 depend on artefacts that do not
exist at the baseline commit (`eslint-suppressions.json`, `ledger.json`, coverage summaries), so the
script prints `—` with that reason; their baselines are the counted upper bounds from the plan's
Appendix C and the measuring report.

### Work units

One row per work unit of [§Plan (fixed)](#plan-fixed). Status: ⬜ not started · 🔄 in progress ·
✅ done · ⛔ blocked. `Evidence` is a run id, a checksum, or the pull request's own evidence block.

| Phase | WU     | Title                                                                       | Status | PR                            | Evidence                                | Date       |
| ----- | ------ | --------------------------------------------------------------------------- | ------ | ----------------------------- | --------------------------------------- | ---------- |
| 0     | T.1    | The tracker exists, with the baseline measured                              | ✅     | `#316`                        | main `29cd6682` (PR #316)               | 2026-09-27 |
| 0     | T.2    | `scripts/testing/metrics.mjs` reproduces the baseline column                | ✅     | `#317`                        | main `9d579214` (PR #317)               | 2026-09-27 |
| 0     | T.3    | Ficha `N-TEST-1`, subsumed follow-ups point at it                           | ✅     | `#316`                        | main `29cd6682` (PR #316)               | 2026-09-27 |
| 0     | T.4(a) | The lag table, measured (`pnpm outdated` + registry dates)                  | ✅     | `refound/0-toolchain-measure` | [§Toolchain lag](#toolchain-lag-wu-t4a) | 2026-09-27 |
| 0     | T.4(f) | The holds gate, and the corrected holds table                               | ✅     | `refound/0-toolchain-holds`   | [§Gates](#gates) · red proven           | 2026-09-27 |
| 0     | T.4(b) | eslint + `@eslint/js` 9.39.5; `@typescript-eslint` pair 8.70.0              | ✅     | `refound/0-toolchain-eslint`  | lint 0 · tsc 0 · format 0 · gate 0      | 2026-09-27 |
| 0     | T.4(f) | The holds table's shape, and the gate reading it by column name             | ✅     | `refound/0-holds-table-fix`   | [§Gates](#gates) · remove-when + tsc    | 2026-09-28 |
| 0     | T.4(c) | `@types/node` 24.13.6 and `engines.node`                                    | ✅     | `0.5` — branch in §Gates      | tsc 0 · gate 0 · 3 reds · 98/98         | 2026-09-28 |
| 0     | T.4(b) | tsx 4.23.13                                                                 | ⬜     | —                             | —                                       | —          |
| 0     | T.4(b) | Playwright 1.63.0 + `@axe-core/playwright` 4.13.0                           | ⬜     | —                             | —                                       | —          |
| 0     | T.4(b) | msw 2.15.0                                                                  | ⬜     | —                             | —                                       | —          |
| 0     | T.4(b) | `@testing-library/react` family                                             | ⬜     | —                             | —                                       | —          |
| 0     | T.4(b) | `@vitest/eslint-plugin` 1.6.27                                              | ⬜     | —                             | —                                       | —          |
| 0     | T.4(d) | Storybook family; Jest leaves with `@storybook/test-runner`                 | ⬜     | —                             | —                                       | —          |
| 0     | T.4(b) | jsdom 30 — **[H1]** crosses into production, raises the node floor          | ⬜     | —                             | —                                       | —          |
| 0     | T.4(e) | The 86 dead `vite` shims                                                    | ⬜     | —                             | —                                       | —          |
| 1     | 1.1    | Free the `.integration` suffix; name the k6 scenarios                       | ⬜     | —                             | —                                       | —          |
| 1     | 1.2    | Reserve the tier suffixes inside every collector                            | ⬜     | —                             | —                                       | —          |
| 1     | 1.2b   | vitest resolves every workspace import to `src/`                            | ⬜     | —                             | —                                       | —          |
| 1     | 1.3    | Remove double collection and the subset entrypoints                         | ⬜     | —                             | —                                       | —          |
| 1     | 1.4    | Move the timing needs into the tests                                        | ⬜     | —                             | —                                       | —          |
| 1     | 1.5    | Rename the node:test population by MEASURED tier                            | ⬜     | —                             | —                                       | —          |
| 1     | 1.6    | `run-tests.sh` becomes the integration collector only                       | ⬜     | —                             | —                                       | —          |
| 1     | 1.7    | Collect the services tier by convention                                     | ⬜     | —                             | —                                       | —          |
| 1     | 1.8    | Collect the live tier by convention                                         | ⬜     | —                             | —                                       | —          |
| 1     | 1.9    | `packages/test-contracts` — the reach engine with self-tests                | ⬜     | —                             | —                                       | —          |
| 1     | 1.10   | Wire the new #30, retire the grep ratchet                                   | ⬜     | —                             | —                                       | —          |
| 1     | 1.11   | Script contract (reach part C) and #31 A widened                            | ⬜     | —                             | —                                       | —          |
| 1     | 1.12   | #36 over resolved configs, in all 86                                        | ⬜     | —                             | —                                       | —          |
| 1     | 1.13   | #32 over the syntax tree, in every test-shaped file                         | ⬜     | —                             | —                                       | —          |
| 1     | 1.14   | Workflows only call registered entrypoints (reach part B)                   | ⬜     | —                             | —                                       | —          |
| 1     | 1.15   | Retire the quarantine                                                       | ⬜     | —                             | —                                       | —          |
| 1     | 1.16   | The node collector reads a JSON reporter, not TAP                           | ⬜     | —                             | —                                       | —          |
| 2     | 2.0    | Canon scenario `decorative-demolition` + ADR                                | ⬜     | —                             | —                                       | —          |
| 2     | 2.1    | The assertion classifier as a workspace package with tests                  | ⬜     | —                             | —                                       | —          |
| 2     | 2.2a   | Ledger: scan, reach, JSON                                                   | ⬜     | —                             | —                                       | —          |
| 2     | 2.2b   | Ledger: duplicates, dead helpers, human overlay, `--area`                   | ⬜     | —                             | —                                       | —          |
| 2     | 2.3    | The hard probe                                                              | ⬜     | —                             | —                                       | —          |
| 2     | 2.4    | Durable form: ESLint rules + bulk suppressions                              | ⬜     | —                             | —                                       | —          |
| 2     | 2.5    | List before deleting; Edward approves the DELETE set                        | ⬜     | —                             | —                                       | —          |
| 2     | 2.6a   | Whole files (a)(b)(d)                                                       | ⬜     | —                             | —                                       | —          |
| 2     | 2.6b   | The four `describe.todo` stubs                                              | ⬜     | —                             | —                                       | —          |
| 2     | 2.7    | Dead helpers, runners and files                                             | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.1a | Block deletion — `rateLimitingDashboard`, `logger`                          | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.1b | Block deletion — `auditMiddleware`, `webhookHandler.stats`, `healthMetrics` | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.2a | Block deletion — flat root of `apps/api/tests/unit`, first chunk            | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.2b | Block deletion — flat root of `apps/api/tests/unit`, second chunk           | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.3  | Block deletion — `{application,infrastructure,domain}`                      | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.4  | Block deletion — `{security,ai,webhooks,saga,auth,admin,…}`                 | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.5  | Block deletion — node:test                                                  | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.6  | Block deletion — packages                                                   | ⬜     | —                             | —                                       | —          |
| 2     | 2.8.7  | Block deletion — client, admin, workers                                     | ⬜     | —                             | —                                       | —          |
| 2     | 2.9    | `settingsRoutes.test.ts` → `settingsSchemas.test.ts`                        | ⬜     | —                             | —                                       | —          |
| 2     | 2.10   | Weak but not decorative: REWRITE                                            | ⬜     | —                             | —                                       | —          |
| S     | S.1    | Three `@test-utils/*` packages with their boundary gates                    | ⬜     | —                             | —                                       | —          |
| S     | S.2    | Canonical builders                                                          | ⬜     | —                             | —                                       | —          |
| S     | S.3a   | The one Prisma double                                                       | ⬜     | —                             | —                                       | —          |
| S     | S.3b   | The 31 importers migrated by codemod                                        | ⬜     | —                             | —                                       | —          |
| S     | S.4    | The one Redis double                                                        | ⬜     | —                             | —                                       | —          |
| S     | S.5    | The one Fastify route-test app builder                                      | ⬜     | —                             | —                                       | —          |
| S     | S.6    | Seeds move to `@test-utils/persistence`                                     | ⬜     | —                             | —                                       | —          |
| S     | S.7    | Builder-name gate                                                           | ⬜     | —                             | —                                       | —          |
| S     | S.8    | `PrismaClient` cast gate                                                    | ⬜     | —                             | —                                       | —          |
| 3     | 3.1    | Contiguous fitness inventory (#47) and derived count                        | ⬜     | —                             | —                                       | —          |
| 3     | 3.2    | Reporters in the config; the shard stops being blind                        | ⬜     | —                             | —                                       | —          |
| 3     | 3.3    | OpenAPI drift gets its own job                                              | ⬜     | —                             | —                                       | —          |
| 3     | 3.4    | Coverage Merge renders failures and refuses to certify a red suite          | ⬜     | —                             | —                                       | —          |
| 3     | 3.5    | Remove "Test and Build" and the second "Security Audit"                     | ⬜     | —                             | —                                       | —          |
| 3     | 3.6    | gitleaks scans the pull request's commits                                   | ⬜     | —                             | —                                       | —          |
| 3     | 3.7(a) | OSV-Scanner: measure the finding classes                                    | ⬜     | —                             | —                                       | —          |
| 3     | 3.7(b) | OSV-Scanner: real gate, or removed                                          | ⬜     | —                             | —                                       | —          |
| 3     | 3.8    | A skipped vitest test fails CI                                              | ⬜     | —                             | —                                       | —          |
| 3     | 3.9    | #44 verdict composition, static rules                                       | ⬜     | —                             | —                                       | —          |
| 3     | 3.10   | #44 operational rules and drift read from GitHub                            | ⬜     | —                             | —                                       | —          |
| 3     | 3.11   | The merge-gate composition, versioned                                       | ⬜     | —                             | —                                       | —          |
| 3     | 3.12   | Nightly rebuilt; one alarm per workflow; chaos folded in                    | ⬜     | —                             | —                                       | —          |
| 3     | 3.13   | Script entrypoints cannot swallow errors (#45)                              | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.1   | `test-env.sh env <hermetic\|services>`                                      | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.2   | `test-env.sh db [--reset]`                                                  | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.3   | `up \| serve \| down \| liveness \| logs \| run`                            | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.4   | Adoption in performance, ZAP and nightly                                    | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.5   | A test-env loader that fails closed                                         | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.6   | Playwright `webServer` from the script, both apps                           | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.7   | One environment identity (#46)                                              | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.8   | The api shards run hermetic                                                 | ⬜     | —                             | —                                       | —          |
| 4     | 4.1a   | Availability is a precondition, never a skip — live suites                  | ⬜     | —                             | —                                       | —          |
| 4     | 4.1b   | Availability is a precondition, never a skip — the rest                     | ⬜     | —                             | —                                       | —          |
| 4     | 4.2    | `trendRadarRoutes.test.ts` — the missing `dayKey`                           | ⬜     | —                             | —                                       | —          |
| 4     | 4.3    | Rewrite `production.integration.test.ts`                                    | ⬜     | —                             | —                                       | —          |
| 4     | 4.4    | F-6 as a class: topology plus precondition                                  | ⬜     | —                             | —                                       | —          |
| 4     | 4.5    | The 10 dark DB-only suites enter by convention                              | ⬜     | —                             | —                                       | —          |
| 4     | 4.6    | The 9 live suites enter the same way                                        | ⬜     | —                             | —                                       | —          |
| 4     | 4.7    | `tests/chaos` stays, `chaos.yml` goes                                       | ⬜     | —                             | —                                       | —          |
| 4     | 4.9    | Tier acceptance: two consecutive clean CI runs                              | ⬜     | —                             | —                                       | —          |
| X     | 4.X1   | The runner experiment, measured                                             | ⬜     | —                             | —                                       | —          |
| X     | 4.X2   | The decision rule applied to X1's table — **[H7]**                          | ⬜     | —                             | —                                       | —          |
| 5     | 5.1    | Coverage defaults in the factory                                            | ⬜     | —                             | —                                       | —          |
| 5     | 5.2    | Measure before fixing floors                                                | ⬜     | —                             | —                                       | —          |
| 5     | 5.3    | Fix floors — `packages/core/*`, first 26 configs                            | ⬜     | —                             | —                                       | —          |
| 5     | 5.4    | Fix floors — the other 26 core packages and the engine                      | ⬜     | —                             | —                                       | —          |
| 5     | 5.5    | Fix floors — adapters, providers, observability, monitoring, api-\*         | ⬜     | —                             | —                                       | —          |
| 5     | 5.6    | Fix floors — `apps/{admin,client,workers}`                                  | ⬜     | —                             | —                                       | —          |
| 5     | 5.7    | #37 over every config                                                       | ⬜     | —                             | —                                       | —          |
| 5     | 5.8    | CI enforces floors; risen floors surface for every package                  | ⬜     | —                             | —                                       | —          |
| 5     | 5.9    | Every package is measured or listed with a reason                           | ⬜     | —                             | —                                       | —          |
| 5     | 5.10   | The canon moves to measured floors plus ratchet                             | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E1   | Demolish the E2E fiction                                                    | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E2   | `infra/prisma/seed-e2e.ts`                                                  | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E3a  | Provider base-URL seam (production)                                         | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E3b  | Fake-provider sidecar                                                       | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E4   | Client Playwright config                                                    | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E5a  | First green specs: `auth`, `posts`                                          | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E5b  | `publish-now.spec.ts` and the dashboard a11y pass                           | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E6   | Admin E2E                                                                   | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E7   | WCAG contrast fix on the admin accent                                       | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E8   | CI job "E2E (chromium)"                                                     | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E9   | Turbo and script cleanup                                                    | ⬜     | —                             | —                                       | —          |
| 6.E   | 6.E10  | Declared gap: schedule → worker publishes                                   | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M1   | `@test-utils/wire` core                                                     | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M2   | `setupFiles` per app and network isolation by default                       | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M3   | Shared API handlers typed by OpenAPI                                        | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M4   | The fetch-stub gate                                                         | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M5   | Migration — client                                                          | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M6   | Migration — admin                                                           | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M7   | Migration — api                                                             | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M8   | Migration — providers                                                       | ⬜     | —                             | —                                       | —          |
| 6.M   | 6.M9   | Close: suppressions empty, rule hard-zero                                   | ⬜     | —                             | —                                       | —          |
| 6.K   | 6.K1   | One real scenario; the rest deleted                                         | ⬜     | —                             | —                                       | —          |
| 6.K   | 6.K2   | Variable and image                                                          | ⬜     | —                             | —                                       | —          |
| 6.K   | 6.K3   | Calibration — 10 runs on main                                               | ⬜     | —                             | —                                       | —          |
| 6.K   | 6.K4   | The job, as a merge gate — **[H6]**                                         | ⬜     | —                             | —                                       | —          |
| 6.P   | 6.P1   | Retire `perf:memory`                                                        | ⬜     | —                             | —                                       | —          |
| 6.P   | 6.P2   | Retire `perf:db` and its siblings                                           | ⬜     | —                             | —                                       | —          |
| 6.S   | 6.S1   | Fold the twelve cases that matter into the live tier                        | ⬜     | —                             | —                                       | —          |
| 6.S   | 6.S2   | Delete `security/tests`                                                     | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N0   | Measured prioritisation                                                     | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N1   | Security first                                                              | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N2   | The publishing core                                                         | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N3   | `core/billing` and the 39 single-test contexts                              | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N4   | The 36 untested api routes                                                  | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N5   | Packages with no config                                                     | ⬜     | —                             | —                                       | —          |
| 6.N   | 6.N6   | Portals and workers                                                         | ⬜     | —                             | —                                       | —          |
| 7     | 7.1    | Tool choice against criteria                                                | ⬜     | —                             | —                                       | —          |
| 7     | 7.2    | One root config plus `mutation.mjs`                                         | ⬜     | —                             | —                                       | —          |
| 7     | 7.3    | Confirm every survivor                                                      | ⬜     | —                             | —                                       | —          |
| 7     | 7.4    | `mutation-floors.json` per package                                          | ⬜     | —                             | —                                       | —          |
| 7     | 7.5    | Incremental in pull requests                                                | ⬜     | —                             | —                                       | —          |
| 7     | 7.6    | Feed the ledger; verify the both-directions rule                            | ⬜     | —                             | —                                       | —          |
| 7     | 7.7    | `apps/api`: declared gap until fork-pool support                            | ⬜     | —                             | —                                       | —          |
| 8     | 8.1a   | `CODING_STANDARDS.md` §Testing, part 1                                      | ⬜     | —                             | —                                       | —          |
| 8     | 8.1b   | `CODING_STANDARDS.md` §Testing, part 2 (coverage)                           | ⬜     | —                             | —                                       | —          |
| 8     | 8.2    | `docs/architecture/TESTING.md` → archived frozen                            | ⬜     | —                             | —                                       | —          |
| 8     | 8.3    | `chaos-testing.md` → folded and archived                                    | ⬜     | —                             | —                                       | —          |
| 8     | 8.4    | `provider-testing.md` → folded and archived                                 | ⬜     | —                             | —                                       | —          |
| 8     | 8.5    | `saga-test-suites.md` → corrected                                           | ⬜     | —                             | —                                       | —          |
| 8     | 8.6    | `SECURITY_TESTING_FRAMEWORK.md` → corrected                                 | ⬜     | —                             | —                                       | —          |
| 8     | 8.7    | The four E2E READMEs → archived frozen                                      | ⬜     | —                             | —                                       | —          |
| 8     | 8.8    | `TESTING_INFRASTRUCTURE.md` re-measured and protected                       | ⬜     | —                             | —                                       | —          |
| 8     | 8.9    | Correct the false #32 comment                                               | ⬜     | —                             | —                                       | —          |
| 9     | 9      | The queue, measured under the new battery                                   | ⬜     | —                             | —                                       | —          |

### Gates

Every new or modified gate lands with its red demonstrated on the COMPLETE step — never on the body
of a heredoc, where the `exit 1` lives in the step's shell and a node or python body exits 0 on its
own. A row is added by the pull request that adds or modifies the gate, and `Red proof` carries the
exact command, the observed non-zero exit, and the byte-exact restore evidence.

| Gate                                                                                                                               | Kind (ESLint / fitness / job)                                                                                                                                        | Red proof (command, exit, restore)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | PR                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Testing toolchain holds (WU-T.4f): every lag below latest mature has a documented hold                                             | CI step in the `Dependency Consistency` job of `fitness.yml`, running `scripts/testing/holds-gate.mjs` with `::error` paired to `exit 1` (fitness #34 PAIRED)        | run block extracted from the workflow; with the vitest hold row removed from `SECURITY_CANON.md` → exit 1 naming `vitest`, `@vitest/coverage-v8`, `@vitest/ui` (installed 4.1.11, target 5.0.1); file restored, `sha256sum -c` OK; re-run → exit 0 (52 measured, 43 lags, 0 violations). **Modified 2026-09-28 by `refound/0-holds-table-fix`** — the parser now locates `Remove-when` by HEADER NAME, so the red had to be re-proven on the same complete run block: with the `tsx` row's remove-when cell BLANKED → exit 1 naming `tsx` and "carries no remove-when"; restored from a byte copy, `sha256sum -c` OK and `cmp` identical; re-run → exit 0 (52 measured, 41 lags, 0 violations)                                                                                                                                                                                                                                                                                            | `refound/0-toolchain-holds-gate` + `refound/0-holds-table-fix` |
| Node engines (WU-T.4c): every workspace manifest declares `engines.node` at the runtime major, and the `@types/node` pin tracks it | CI step in the `Dependency Consistency` job of `fitness.yml`, running `scripts/testing/engines-node-gate.mjs` with `::error` paired to `exit 1` (fitness #34 PAIRED) | **Three reds, each on the COMPLETE run block** (2026-09-28): (1) `packages/api-common/package.json` stripped of its `engines` block → exit 1 naming that manifest and the canonical value; restored from a byte copy, `sha256sum -c` OK (`0c81409e…a95be`) and `cmp` identical; re-run → exit 0. (2) the root value changed to `^24` → exit 1 naming the shape rule `>=24.<minor>.<patch> <25`; restored, `sha256sum -c` OK (`a5c6842a…31523`), `cmp` identical; re-run → exit 0. (3) the catalog pin put back to `25.9.3` — the defect this slice closes → exit 1 naming the pin's major against the runtime's; restored, `sha256sum -c` OK (`d1d0af58…4572e`), `cmp` identical; re-run → exit 0. Each clean run prints `98 manifests, engines.node >=24.15.0 <25, runtime 24, @types/node 24.13.6`. The workflow file itself was never edited: the step was prepared, validated standalone (`yaml: VALID`, run block byte-identical to the proof script) and pasted by the orchestrator | `refound/0-toolchain-types-node`                               |

`metrics.mjs --m7` counts the data rows of this table: total rows, and rows whose `Red proof` cell is
filled. **A script in the tree is not a gate until a workflow runs it** — the same rule fitness #30
holds over test files: a check no collector names never executes, however complete it looks in the
tree. The holds gate earned its row only with the pull request that landed its step in the
`Dependency Consistency` job, red demonstrated on the COMPLETE step, and M7 moved with it, not before.

### Decisions log

Signed as a block by Edward on 2026-09-27. **D17 is open** — it is a product classification, not a
technical fork, and the two CLI seeds it covers are excluded from every delete slice until it is
answered.

| ID  | Fork                                                                                                                                                   | Options                                                                                                                                                   | Chosen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | By     | Date       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| D1  | How the 400-line budget is counted when the product is tests                                                                                           | one undivided count · CODE/EVIDENCE split                                                                                                                 | CODE ≤ 400 hard; EVIDENCE pre-approved per slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Edward | 2026-09-27 |
| D2  | #37 must accept the floor descent that demolition causes                                                                                               | per-PR admin override · canon scenario + ADR                                                                                                              | canon scenario `decorative-demolition` + ADR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Edward | 2026-09-27 |
| D3  | The four `describe.todo` stubs, and whether `.todo` counts as a skip                                                                                   | keep as declared gap in tree · delete and count the gap in the tracker                                                                                    | delete; `.todo` counts as a skip and goes red                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Edward | 2026-09-27 |
| D4  | Double collectors, duplicate jobs and unread alarms                                                                                                    | keep · delete                                                                                                                                             | delete `eval.yml`, the custom security job, the 28 subset scripts, `chaos.yml`, "Test and Build", the second "Security Audit"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Edward | 2026-09-27 |
| D5  | Branch freshness before merge on `main`                                                                                                                | merge queue (unavailable on personal repos) · `strict: true`                                                                                              | `strict: true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Edward | 2026-09-27 |
| D6  | Where the required-check list lives                                                                                                                    | classic protection (unreadable from CI) · committed ruleset                                                                                               | `.github/rulesets/main.json`, applied by an admin step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Edward | 2026-09-27 |
| D7  | Which advisory gates become required                                                                                                                   | all now · staged                                                                                                                                          | Dependency Consistency, size-limit, Semgrep after measuring overlap; Container Security once green; lychee stays advisory; CodeQL in one context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Edward | 2026-09-27 |
| D8  | OSV-Scanner                                                                                                                                            | keep as-is (cannot fail) · keep only if it sees a class `pnpm audit` misses · delete                                                                      | keep only if the measurement shows a distinct class; otherwise delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Edward | 2026-09-27 |
| D9  | Test database and Redis topology                                                                                                                       | separate cluster · same LXC cluster as dev with a distinct identity                                                                                       | same cluster, database `omnipost_test`, Redis logical DB 15, ports = dev + 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Edward | 2026-09-27 |
| D10 | `perf:db` and `perf:memory`                                                                                                                            | fix · retire                                                                                                                                              | retire both, plus `perf:baseline/regression/test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Edward | 2026-09-27 |
| D11 | k6                                                                                                                                                     | keep six fiction scenarios · one real scenario as a merge gate · delete                                                                                   | one real scenario with calibrated thresholds, as a merge gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Edward | 2026-09-27 |
| D12 | `security/tests`                                                                                                                                       | repair in place · fold the useful cases and delete the rest                                                                                               | fold twelve cases into the live tier, delete the suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Edward | 2026-09-27 |
| D13 | E2E reconstruction                                                                                                                                     | instrument 207 `data-testid` + a test route in the production binary · role/label selectors + owner-connection seed + provider seam and sidecar           | role/label selectors, no `/api/test/seed`, Telegram `baseUrl` seam rejected under production, MSW sidecar, chromium only, visual snapshots deleted, `retries: 1` + `failOnFlakyTests`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Edward | 2026-09-27 |
| D14 | Coverage targets                                                                                                                                       | keep the canon's aspirational per-layer targets · measured floors with ratchet                                                                            | measured floors with ratchet; strict ratchet when local↔CI drift ≤ 0.1 pp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Edward | 2026-09-27 |
| D15 | Mutation testing in pull requests                                                                                                                      | full run · incremental, blocking on `break`                                                                                                               | incremental and blocking for changed packages; weekly full run; `apps/api` a declared gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Edward | 2026-09-27 |
| D16 | Protecting `TESTING_INFRASTRUCTURE.md`                                                                                                                 | `@`-import it into every session · anti-deletion list only                                                                                                | the anti-deletion list of fitness #24, WITHOUT an `@`-import                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Edward | 2026-09-27 |
| D17 | `seed-demo-data.ts` and `seed-large-dataset.ts` (CLI, 0 importers, unused since 04-22)                                                                 | PLANNED · DEAD                                                                                                                                            | **open** — product classification; both files excluded from every delete slice meanwhile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —      | —          |
| D18 | How the workstream is executed                                                                                                                         | ad-hoc · SDD (proposal → spec → design → tasks → apply by slices)                                                                                         | SDD, with this plan as input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Edward | 2026-09-27 |
| D19 | Filling the surfaces that have no tests, and how                                                                                                       | one writer · parallel writers per package in isolated worktrees                                                                                           | parallel writers per package in isolated worktrees; git stays exclusive to the orchestrator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Edward | 2026-09-27 |
| D20 | Testing dependency freshness                                                                                                                           | stay put · align to `latest` · align to latest MATURE                                                                                                     | latest mature (7-day buffer, ADR-0018) before the reach contract, with a documented hold per exception and `@types/node` = runtime major                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Edward | 2026-09-27 |
| D21 | The 17 measured lags that no enumerated slice owned                                                                                                    | one catch-all slice · two grouped slices at the tail of Phase 0 · leave them to the ordinary cadence                                                      | `0.4` absorbs the `@typescript-eslint` pair; `0.14` (build six) and `0.15` (quality-gate eleven) close the tail of Phase 0, now 15 slices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Edward | 2026-09-27 |
| D22 | The holds table's remove-when, invisible in markdown and unchecked by the gate                                                                         | keep the four-column header and read index 3 · declare the fifth column and locate it BY NAME                                                             | `0.4b`: fifth column declared, three rows split, `parseHolds` locates both by name, ragged rows refused; rows cited by package; the consumer declares the build edge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Edward | 2026-09-28 |
| D23 | The runtime line, and the types major that ran ahead of it                                                                                             | raise the runtime to Node 26 now · keep the 24 LTS line and pin the types DOWN to it                                                                      | keep 24 (Krypton LTS) and take `@types/node` DOWN to 24.13.6, its latest mature; `engines.node` `>=24.15.0 <25` in all 98 manifests with a gate that refuses either side drifting; Node 26 deferred to slice `0.16` on its LTS date 2026-10-28 (24 enters Maintenance 2026-10-20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Edward | 2026-09-28 |
| D26 | A gate whose comparator is the live registry or the live advisory database goes RED with NO diff — measured twice in 28 h on a byte-identical lockfile | patch each slice where its own gate reddens · baseline the reds and move on · put ONE repair slice at the BOTTOM of the stack and rebase the rest onto it | the repair goes FIRST, always: slice `0.17` `refound/0-audit-floors` sits under the ten overnight slices so every PR in the chain is born green, and each of the ten is re-verified and re-reviewed on the rebase. Two classes were repaired, neither authored by any slice — CVE floors whose bands the advisory database overtook (`fast-uri`, `undici`, plus a new `webpack-dev-middleware` floor and `joi` resolved naturally) and a toolchain lag the registry clock re-opened (`@typescript-eslint` 8.70.1 matured 2026-09-28T17:09Z, after `0.4` correctly measured it immature at 6.2 d). A THIRD class surfaced in verification and is recorded as method: `pnpm audit` cannot decide a floor, because GHSA-g84c-rxfj-3j2c's `vulnerable_version_range` string ("< 7.4.5") disagrees with its own `first_patched_version` (7.4.6) — a 7.4.5 pin passed the audit over a still-vulnerable version. Every floor is now cross-derived from OSV plus the upstream changelog, never from the audit range alone. The clock class then proved itself INSIDE this slice: the audit went red a THIRD time 90 minutes after the first raise was verified, over five further advisories on `brace-expansion` (three) and `fast-uri` (two), every one landing on a band already pinned to its own target — so floors are re-measured immediately before the final gate, never once at the start, and a green audit measurement does not survive to merge on its own. Corollary recorded as a rule: a slice that falsifies a sentence anywhere in the tree corrects it in the same slice — which is why the four false version cells of `TESTING_INFRASTRUCTURE.md` are amended into the commits that falsified them rather than swept here. Also recorded here because it has no other home: the `omnipost_test` database was created 2026-09-30 per D9, ahead of WU-4b.1; until `scripts/test-env.sh` exists the local tier runs with the test env exported into the process, and the runner falls back to the dev env file only when `DATABASE_URL` is unset — the fallback WU-1.6 removes | Edward | 2026-09-30 |

### Declared gaps

Counted, never faked. A gap MUST NOT be represented in the tree as a skipped test, a `todo`-marked
test, or a test that cannot fail — it lives here, with the reason and the owner.

| Gap                                                                                                                                                                                                                                        | Why not now                                                                                                                                                                                                                                                                                                           | Owner WU                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Settings ROUTE contract untested                                                                                                                                                                                                           | the existing suite exercises the real schemas, not the route; renaming it is honest, writing the route contract is work                                                                                                                                                                                               | 9 (queue)                          |
| E2E "schedule → worker publishes"                                                                                                                                                                                                          | nothing promotes a scheduled post today except the webhook clobber; it is the acceptance test of that change, not of this one                                                                                                                                                                                         | 6.E10 (in N-COR-8/9)               |
| Real provider sandbox contracts (11 providers)                                                                                                                                                                                             | the sidecar replays OUR recorded contract with Telegram, not Telegram; real sandboxes are their own change                                                                                                                                                                                                            | roadmap §3.2.c                     |
| Mutation coverage for `apps/api`                                                                                                                                                                                                           | the Stryker vitest runner is threads-only and `apps/api` loads native Prisma; measured crashes                                                                                                                                                                                                                        | 7.7                                |
| Mutation coverage for the node:test tier                                                                                                                                                                                                   | the tier is not mutable by any runner in scope                                                                                                                                                                                                                                                                        | 7.7                                |
| Chaos L1: outbox relay crash between claim and publish; BullMQ worker stall                                                                                                                                                                | both need helpers that do not exist yet; the two written scenarios run in every pull request                                                                                                                                                                                                                          | roadmap §4.1.b → 9                 |
| A second resolved `@types/node` major (26.0.0) reaches the tree through open-range transitives — 19 of its 37 declarers are outside the Jest chain and 7 are DIRECT importer devDependencies; the engines gate bounds the catalog pin only | closing it needs a maintainer decision between a de-dup `overrides` entry — against the dependency model, which DROPS de-dup-only overrides (ADR-0018 §Transitive policy) — and a lockfile-resolution assertion; neither is this slice's to take, and an override added quietly would be the model's own anti-pattern | slice `0.16` / maintainer decision |
| Chaos L2: real-crash infrastructure (`spawn` + `SIGKILL` + restart)                                                                                                                                                                        | invasive, and it needs the single environment contract to exist first                                                                                                                                                                                                                                                 | roadmap §4.1.c → 9                 |
| Packages with no coverage target yet                                                                                                                                                                                                       | the target per package is set by the measured prioritisation, not guessed                                                                                                                                                                                                                                             | 6.N0 (metric M16)                  |
| Two near-identical `a11y.ts` helpers (client and admin)                                                                                                                                                                                    | consolidating them is a refactor with no defect behind it                                                                                                                                                                                                                                                             | 9 (queue)                          |
| `no-floating-promises: off` in test globs contradicts "always await"                                                                                                                                                                       | turning it on needs type-aware linting whose cost on this tree is unmeasured                                                                                                                                                                                                                                          | 9 (queue)                          |

---

## Toolchain lag (WU-T.4a)

**BASELINE — the state this workstream started from, not the state of the tree; the current counts are in the re-measure two paragraphs below. Measured 2026-09-27T17:55:14Z: fifty-one npm packages, plus one containerised tool with no version to
measure. Forty-five packages sit below their latest-mature target; five of those lags carry a documented hold
row, one is ambiguously covered, and THIRTY-NINE carry NO HOLD — that last set is exactly what the
holds gate of WU-T.4(f) goes red on until each one gets a row or a bump. Five crossings may not ride
inside a family pull request, and one of them is larger than the plan recorded: the DOM
implementation's major is blocked by a _blanket_ `tough-cookie` override that nobody had connected to
it.**

The 52 rows below account for themselves: 45 lags (39 unheld + 5 held + 1 ambiguous), 5 packages
already at their latest mature, 1 candidate that is not installed at all, and k6, whose floating
container tag makes the maturity rule inapplicable rather than satisfied.

**CURRENT, re-measured 2026-09-28T02:42:36Z by `node scripts/testing/holds-gate.mjs`, exit 0 with EMPTY stderr:
of the 52 packages in `scripts/testing/toolchain-population.json` (48 direct, 3 named transitives, 1
declared-absent candidate), 41 sit below latest mature and NOT ONE of them is unheld.** That is the same 41 the
23:57:09Z and 23:10:56Z runs reported, and slice `0.5` did NOT change it: `@types/node` was already a HELD lag
at 25.9.3 (below the generic comparator 26.6.2) and is still one at 24.13.6, so the set's membership is
unchanged and only its row's reason moved — from a target not yet taken to a runtime major now gated. A slice
that moves a package to its own line's ceiling shrinks the lag set only when that ceiling IS the generic
comparator, which for a downward pin it never is. The counts here read as one history: the 17:55:14Z paragraph
above is the baseline, the 23:10:56Z and 23:57:09Z runs are the holds gate landing and the table correction,
and this instant is the tree as it stands.

**The `documented hold` column cites each row by PACKAGE IDENTITY — the first name in the canon row's own
`Package` cell — and never by canon line number.** A line number is wrong the next time anything above the
row is edited, and this slice's own predecessor proved it: deleting one row shifted every citation below it by
one, silently. `rg vitest docs/security/SECURITY_CANON.md` finds the row; a line number finds whatever moved
into that position.

The correction itself: `refound/0-toolchain-holds` wrote the fifteen missing
rows, and `refound/0-toolchain-eslint` took the first bump — `eslint` and `@eslint/js` to 9.39.5, the
`@typescript-eslint` pair to 8.70.0, which drops the pair out of the lag set and deletes its row. The count
falls by a bump; a row makes a lag legal, never absent.

No metric moves in this slice. The lag table is measured state, not a metric: it is re-derived by
re-running the commands below, never by editing a number in place.

### How this was measured

**Measurement instant: `2026-09-27T17:55:14Z`.** Re-derive from the repository root with:

```bash
pnpm outdated -r --format json      # installed vs the registry's `latest` dist-tag, all 98 manifests
pnpm ls -r --depth 0 --json         # the installed version of every DIRECT dependency
pnpm view <pkg> time --json         # every published version of <pkg> with its publish instant
pnpm view <pkg>@<v> engines dependencies peerDependencies --json   # the crossing checks below
```

`Installed` comes from `pnpm ls -r --depth 0` — every direct dependency in this population resolves
to exactly one version, so no manifest disagrees with the catalog. Two rows are transitive and say
so; their installed version is read from the store layout under `node_modules/.pnpm/`.

**The comparator is "latest mature", never `latest`** (`testing-toolchain-alignment` › _The freshness
comparator is "latest mature", never "latest"_; ADR-0018's 7-day buffer). A version is MATURE when
both hold:

1. it is **stable** — no `-alpha`, `-beta`, `-rc`, `-next`, `-canary` or `-dev` identifier; and
2. it was published **at least 7 × 24 h** before the measurement instant, i.e. on or before
   `2026-09-20T17:55:14Z`.

`Latest mature` is the highest version satisfying both. Where a cell also names a **ceiling of a
constrained line** (the runtime major for `@types/node`, the v9 line for `eslint` and `@eslint/js`,
the v4 line for the runner, the v5 line for the React plugin), that is the highest mature version
inside the line the plan actually targets — and it is frequently not the same number. No committed
script owns this selection yet; WU-T.4(f) is what turns the rule into a gate.

**Why the instant is written to the second.** Maturity is a moving boundary, and it moved inside this
one day: `tsx@4.23.15` was published `2026-09-20T07:22:17Z`, so at 04:49 Z this morning it was 6.9 d
old and the target was 4.23.13; it matured at 07:22 Z, and by 17:55 Z it is 7.4 d old, so **the target
is 4.23.15**. The design's rollout order names tsx 4.23.13 for that reason and is superseded by this
row, not contradicted by it. `dependency-cruiser@18.4.0` (`2026-09-20T09:42:11Z`) crossed the same
boundary the same morning. Others moved the other way: `size-limit@14.1.0` was published today at
13:10 Z and is 0.2 d old, so the target there is 14.0.0.

### The test battery — runner, browser driver, doubles, DOM

| dep                                           | installed               | latest mature (published)                                                                                | documented hold (yes/no — where)                                                                                                                                     | CVE floor                                                                           |
| --------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `vitest`                                      | 4.1.11                  | 5.0.1 (2026-09-15) — `latest` 5.0.2 (2026-09-25) is 2.4 d, immature. **v4 ceiling = 4.1.11 = installed** | **held** — canon row `vitest` (the `@vitest/*` peers move with it). Staying on 4 is signed (D20) and reasoned in research; the row is what a gate can read           | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met; a floor, not a ceiling         |
| `@vitest/coverage-v8`                         | 4.1.11                  | 5.0.1 (2026-09-15) — exact peer of the runner, moves in lockstep                                         | **held** — canon row `vitest`, which names it                                                                                                                        | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/ui`                                  | 4.1.11                  | 5.0.1 (2026-09-15) — same family lock                                                                    | **held** — canon row `vitest`, which names it                                                                                                                        | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/eslint-plugin`                       | — (declared in 0 of 98) | 1.6.27 (2026-08-10, 48.6 d)                                                                              | n/a — an addition, not a lag                                                                                                                                         | —                                                                                   |
| `@playwright/test`                            | 1.61.1                  | 1.63.0 (2026-09-04, 22.8 d)                                                                              | **held** — canon row `@playwright/test`                                                                                                                              | —                                                                                   |
| `playwright` / `playwright-core` (transitive) | 1.61.1                  | 1.63.0 (2026-09-04)                                                                                      | **held** — canon row `@playwright/test`; a transitive with no version of its own to declare, so it moves with the runner                                             | —                                                                                   |
| `@axe-core/playwright`                        | 4.10.2                  | 4.13.0 (2026-08-11, 47.0 d)                                                                              | **held** — canon row `@playwright/test`, which names it                                                                                                              | —                                                                                   |
| `msw`                                         | 2.14.6                  | 2.15.0 (2026-07-08, 81.7 d)                                                                              | **held** — canon row `msw`                                                                                                                                           | —                                                                                   |
| `jsdom`                                       | 29.1.1                  | 30.1.0 (2026-09-17) — `latest` 30.1.1 (2026-09-22) is 5.7 d, immature                                    | **held** — canon row `jsdom`, which carries all three crossings                                                                                                      | three override bands sit in its chain — see crossing 1 below                        |
| `isomorphic-dompurify` (PRODUCTION)           | 3.19.0                  | 4.3.0 (2026-09-19) — `latest` 4.4.0 (2026-09-25) is 2.0 d. **v3 ceiling 3.23.0 (2026-08-25)**            | **held** — canon row `jsdom`, which names it                                                                                                                         | `dompurify` 3.4.13 (CVE-floor row `dompurify`) — met by 4.3.0's `dompurify ^3.4.12` |
| `@testing-library/react`                      | 16.3.2                  | 16.3.3 (2026-08-27, 31.0 d)                                                                              | **held** — canon row `@testing-library/dom`, which names all four                                                                                                    | —                                                                                   |
| `@testing-library/dom`                        | 10.4.1                  | 10.4.2 (2026-09-13, 14.0 d)                                                                              | **held** — canon row `@testing-library/dom`                                                                                                                          | —                                                                                   |
| `@testing-library/jest-dom`                   | 7.0.0                   | 7.0.1 (2026-08-09, 48.8 d)                                                                               | **held** — canon row `@testing-library/dom`, which names all four                                                                                                    | —                                                                                   |
| `@testing-library/user-event`                 | 14.6.1                  | 14.6.7 (2026-09-02, 25.7 d)                                                                              | **held** — canon row `@testing-library/dom`, which names all four                                                                                                    | —                                                                                   |
| `@faker-js/faker`                             | 10.5.0                  | 10.6.0 (2026-08-14, 44.0 d)                                                                              | **held** — canon row `knip` (the eleven quality gates, one shared reason). Its CVE-floor row's "not raised to the latest 10.6.0" is a minimal-patch rule, not a hold | 10.5.0 (CVE-floor row `@faker-js/faker`) — met                                      |

### Types, runtime and transpiler

| dep           | installed | latest mature (published)                                                                                                                                                                                                            | documented hold (yes/no — where)                                                                                                                                                                                                                                                                                           | CVE floor |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `typescript`  | 6.0.3     | 7.0.2 (2026-07-08, 81.1 d). **v6 ceiling = 6.0.3 = installed**                                                                                                                                                                       | **held** — canon row `typescript`; the catalog comment that called 6.0.3 "latest stable" was corrected 2026-09-27 and now points at that row                                                                                                                                                                               | —         |
| `@types/node` | 24.13.6   | 26.6.2 (2026-09-19) against the generic comparator; **runtime-major (24.x) ceiling 24.13.6 (2026-09-19) — installed = ceiling** since slice `0.5`, re-measured `2026-09-28T02:42:36Z` (`24.19.0`, 2026-09-25, is 2.2 d and immature) | **held** — canon row `@types/node`, REWRITTEN 2026-09-28 to state the runtime major instead of a target. The remaining lag is against the GENERIC comparator only, and it is now a GATED decision rather than a drift: `scripts/testing/engines-node-gate.mjs` refuses a pin whose major differs from the declared runtime | —         |
| `tsx`         | 4.22.4    | **4.23.15 (2026-09-20, 7.4 d — matured at 07:22 Z today)**                                                                                                                                                                           | **held** — canon row `tsx`                                                                                                                                                                                                                                                                                                 | —         |

### Lint and formatting

| dep                                | installed | latest mature (published)                                                                | documented hold (yes/no — where)                                                                                                                                                    | CVE floor |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `eslint`                           | 9.39.5    | 10.11.0 (2026-09-18, 9.1 d). **v9 ceiling 9.39.5 = installed**, the line's final release | **held** — canon row `eslint`, rewritten 2026-09-27; the 9.36.0 → 9.39.5 gap that row did not cover is closed by the bump                                                           | —         |
| `@eslint/js`                       | 9.39.5    | 10.0.1 (2026-02-06, 233.0 d). **v9 ceiling 9.39.5 = installed**                          | **held** — canon row `@eslint/js`, written 2026-09-27; a root `package.json` literal, not a catalog entry                                                                           | —         |
| `@typescript-eslint/parser`        | 8.70.1    | 8.70.1 (2026-09-21, 8.4 d) — **no lag**; `latest` 8.71.0 (2026-09-28) is 1.4 d, immature | n/a — 8.70.0 by `refound/0-toolchain-eslint`, then 8.70.1 by `refound/0-audit-floors` on 2026-09-30 after 8.70.1 matured at 2026-09-28T17:09Z and re-opened the lag with no row     | —         |
| `@typescript-eslint/eslint-plugin` | 8.70.1    | 8.70.1 (2026-09-21, 8.4 d) — **no lag**; same band                                       | n/a — same two bumps. Its `typescript` peer `>=4.8.4 <6.1.0` is what keeps TypeScript 7 out, and is byte-identical at 8.70.0, 8.70.1 and the immature 8.71.0                        | —         |
| `eslint-plugin-react`              | 7.37.5    | 7.37.5 (2025-04-03) — no lag, and no newer release exists                                | n/a. Its peer `eslint: … \|\| ^9.7` is half the reason eslint stays on 9                                                                                                            | —         |
| `eslint-plugin-jsx-a11y`           | 6.10.2    | 6.10.2 (2024-10-26) — no lag, and no newer release exists                                | n/a. Its peer `eslint: … \|\| ^9` is the other half                                                                                                                                 | —         |
| `eslint-plugin-boundaries`         | 7.1.0     | 7.2.0 (2026-08-09, 49.0 d)                                                               | **held** — canon row `eslint-plugin-boundaries`, written 2026-09-27; no enumerated slice owns it. The stale SMELL-66 sentence it was recorded against is gone from the `eslint` row | —         |
| `prettier`                         | 3.9.5     | 3.9.8 (2026-09-17) — `latest` 3.9.9 (2026-09-23) is 4.5 d, immature                      | **held** — canon row `vite` (the six build tools, one shared reason)                                                                                                                | —         |

### Build and orchestration

| dep                    | installed | latest mature (published)                                                                    | documented hold (yes/no — where)                                                                                                                                                                   | CVE floor                                                                                   |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `vite`                 | 8.0.16    | 8.3.0 (2026-09-10) — `latest` 8.3.1 (2026-09-24) is 3.2 d, immature                          | **held** — canon row `vite`. Its own vite-7 hold is recorded RESOLVED in this section's preamble; the `esbuild` 0.28.1 override (canon row `esbuild`) sits in its chain but pins esbuild, not vite | —                                                                                           |
| `@vitejs/plugin-react` | 5.1.4     | 6.1.1 (2026-08-28, 30.6 d). **v5 ceiling 5.2.0 (2026-03-12)**, published 11 min before 6.0.0 | **held** — canon row `@vitejs/plugin-react`; the catalog comment beside that entry only explains why the package exists                                                                            | —                                                                                           |
| `turbo`                | 2.9.16    | 2.11.2 (2026-09-18) — `latest` 2.11.4 (2026-09-24) is 2.8 d, immature                        | **held** — canon row `vite` (the six build tools, one shared reason)                                                                                                                               | —                                                                                           |
| `webpack`              | 5.106.2   | 5.111.1 (2026-09-18, 9.3 d)                                                                  | **held** — canon row `vite` (the six build tools, one shared reason)                                                                                                                               | `browserslist` 4.28.7 (CVE-floor row `browserslist`) — range-scoped, in webpack's own chain |
| `cross-env`            | 10.0.0    | 10.1.0 (2025-09-29, 363.0 d)                                                                 | **held** — canon row `vite` (the six build tools, one shared reason)                                                                                                                               | —                                                                                           |
| `jiti`                 | 2.6.1     | 2.7.0 (2026-05-05, 144.9 d)                                                                  | **held** — canon row `vite` (the six build tools, one shared reason)                                                                                                                               | —                                                                                           |

### Storybook, and the Jest chain it carries

| dep                      | installed | latest mature (published)   | documented hold (yes/no — where)                                                                                                                                                                                                                                                                   | CVE floor |
| ------------------------ | --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `storybook`              | 10.4.6    | 10.6.0 (2026-09-02, 25.2 d) | **held** — canon row `storybook` (+ `@storybook/*` family). Its remove-when appears MET: the family publishes an atomic 10.6.0 set                                                                                                                                                                 | —         |
| `@storybook/addon-a11y`  | 10.4.6    | 10.6.0 (2026-09-02)         | **held** — canon row `storybook` (+ `@storybook/*` family)                                                                                                                                                                                                                                         | —         |
| `@storybook/addon-docs`  | 10.4.6    | 10.6.0 (2026-09-02)         | **held** — canon row `storybook` (+ `@storybook/*` family)                                                                                                                                                                                                                                         | —         |
| `@storybook/nextjs`      | 10.4.6    | 10.6.0 (2026-09-02)         | **held** — canon row `storybook` (+ `@storybook/*` family)                                                                                                                                                                                                                                         | —         |
| `@storybook/test-runner` | 0.24.4    | 0.24.5 (2026-09-02)         | **held** — canon row `@storybook/test-runner`, its OWN row since 2026-09-27 rather than the family glob: it records that the package is slated for REMOVAL rather than a bump. The family row's glob did match it, which is precisely why the decision had to be written down instead of inherited | —         |
| `jest` (transitive)      | 30.4.2    | 30.5.2 (2026-09-18, 9.2 d)  | **held** — canon row `@storybook/test-runner`, whose remove-when takes the whole Jest chain with it. 0.24.5 still declares `jest ^30.0.4` plus `nyc ^15.1.0`, so the patch bump does not shorten the chain                                                                                         | —         |

### Repository-quality gates that run in the same workflows

| dep                                            | installed | latest mature (published)                                             | documented hold (yes/no — where)                                          | CVE floor                                                                       |
| ---------------------------------------------- | --------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `knip`                                         | 6.12.2    | 6.37.0 (2026-09-18) — `latest` 6.38.0 (2026-09-23) is 4.3 d, immature | **held** — canon row `knip` (the eleven quality gates, one shared reason) | `smol-toml` 1.7.1 (CVE-floor row `smol-toml`) — knip's own chain                |
| `jscpd`                                        | 4.0.8     | 5.3.0 (2026-09-18) — `latest` 5.3.2 (2026-09-23) is 4.3 d, immature   | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `dependency-cruiser`                           | 17.4.0    | 18.4.0 (2026-09-20, 7.3 d — matured today)                            | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `secretlint`                                   | 12.3.1    | 13.0.5 (2026-08-27) — `latest` 13.0.6 (2026-09-25) is 2.2 d, immature | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `@secretlint/secretlint-rule-preset-recommend` | 12.3.1    | 13.0.5 (2026-08-27) — same band                                       | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `size-limit`                                   | 12.1.0    | 14.0.0 (2026-09-15) — `latest` 14.1.0 was published **today**, 0.2 d  | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `@size-limit/preset-small-lib`                 | 12.1.0    | 14.0.0 (2026-09-15) — same band                                       | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `@ast-grep/cli`                                | 0.42.0    | 0.45.3 (2026-08-31, 27.6 d)                                           | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `lint-staged`                                  | 16.4.0    | 17.5.1 (2026-09-10) — `latest` 17.6.0 (2026-09-26) is 1.5 d, immature | **held** — canon row `knip` (the eleven quality gates, one shared reason) | —                                                                               |
| `@hey-api/openapi-ts`                          | 0.97.3    | 0.99.0 (2026-06-22, 97.5 d)                                           | **held** — canon row `knip` (the eleven quality gates, one shared reason) | `js-yaml` 4.3.2 (CVE-floor row `js-yaml`) — that row names this package's chain |
| `@hey-api/client-fetch`                        | 0.13.1    | 0.13.1 (2025-06-12) — no lag; `pnpm outdated` marks it **deprecated** | n/a                                                                       | —                                                                               |

### Load generators, and the one tool with no version to measure

| dep                     | installed                                                                                        | latest mature (published)                                                                              | documented hold (yes/no — where) | CVE floor |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------- | --------- |
| `autocannon`            | 8.0.0                                                                                            | 8.0.0 (2024-10-14) — no lag                                                                            | n/a                              | —         |
| `loadtest`              | 8.2.1                                                                                            | 8.2.1 (2026-01-13) — no lag                                                                            | n/a                              | —         |
| k6 (container, not npm) | `grafana/k6:latest` — floating: the `k6-load` job pulls `:latest`, and its run step names no tag | **unmeasurable**: a floating tag has no version to compare, so the 7-day rule cannot be applied at all | n/a                              | —         |

### The five crossings — each its own decision, never inside a family pull request

`testing-toolchain-alignment` › _A bump that crosses into production or raises the runtime floor is
its own decision_ forbids these from riding along with a test-tool family. Every claim below is read
from a published manifest or from this tree, not inferred.

1. **`jsdom` 29.1.1 → 30.1.0 — [H1], slice `refound/0-toolchain-jsdom`, and LARGER than recorded.**
   Three crossings, not the two the plan names:
   - **Runtime floor.** `jsdom@30.1.0` declares `engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0`;
     `jsdom@29.1.1` declares `^20.19.0 || ^22.13.0 || >=24.0.0`. Local Node is exactly `v24.15.0` and
     every workflow uses a floating `"24"`, so the `engines.node` declaration added by slice
     `refound/0-toolchain-types-node` must be at least `^24.15.0` to be a real gate — `">=24"` would
     pass while the floor is violated.
   - **Production transitive.** `isomorphic-dompurify@3.19.0`, an `apps/api` PRODUCTION dependency,
     declares `jsdom ^29.1.1`. Moving the catalog alone leaves two jsdom copies. The production
     package that admits jsdom 30 is `isomorphic-dompurify@4.x` — latest mature 4.3.0, declaring
     `jsdom ^30.0.0` **and the same `^22.22.2 || ^24.15.0 || >=26.0.0` Node floor** — so the runtime
     floor crosses into production whichever order the two move in.
   - **Two CVE-override bands, and one is a hard blocker.** `jsdom@30.1.0` depends on
     `undici ^8.10.2`, outside the range-scoped `"undici@>=7.0.0 <7.29.0": 7.29.0` override
     (`pnpm-workspace.yaml:240`, floor row `:285`): that band stops applying to this chain, and the
     advisory needs re-auditing against undici 8. It also depends on `tough-cookie ^6.0.2` — and
     `tough-cookie: 4.1.3` (`pnpm-workspace.yaml:300`, floor row `:278`) is a **BLANKET** override.
     The store holds exactly one copy, `tough-cookie@4.1.3`, so as written the override would force
     jsdom 30 onto a version its own manifest forbids. The canon's own gotcha applies — a blanket
     override silently wins over a later range-scoped one (floor row `:270`) — so the pin must be
     re-scoped, with the advisory re-audited against the published 6.x line (6.0.2 exists), inside
     that slice. **Nothing in the plan, the design or the earlier measurement recorded this.**
2. **`typescript` 6.0.3 → 7.0.2 — HOLD; there is no Phase 0 slice for it, and that is correct.**
   `@typescript-eslint/parser@8.70.1` and `@typescript-eslint/eslint-plugin@8.70.1` — the newest
   mature versions as of 2026-09-30 — still peer `typescript: ">=4.8.4 <6.1.0"`, byte-identical to
   8.70.0's and to the immature 8.71.0's. TypeScript 7 is therefore not takeable
   today at any `@typescript-eslint` version, so the hold row is the deliverable, not a bump. Its
   remove-when is observable: `@typescript-eslint` publishes a peer range admitting 7.
3. **`@vitejs/plugin-react` 5.1.4 → 6.1.1 — its own decision, and NOT slice
   `refound/0-toolchain-vite-shims`.** That slice is WU-T.4(e), the 86 dead `vite` shims; it is not a
   plugin bump. The plugin compiles the JSX of both Next portals under vitest (ADR-0019), so a major
   crosses into the frontend build and not only into the test run. Either its own slice with both
   portals' suites green, or a hold. Note the in-major move nobody has taken either: the v5 ceiling
   is 5.2.0 and the tree is on 5.1.4.
4. **`@eslint/js` 9.36.0 → 10.0.1 — needed its OWN hold row, and now has one.** It is a root literal, not
   a catalog entry, and until 2026-09-27 no hold row named it: it tracked `eslint` in practice, and practice
   is not readable by a gate, so the holds gate flagged it while `eslint` beside it passed.
   `refound/0-toolchain-holds` wrote the row (canon row `@eslint/js`) and `refound/0-toolchain-eslint` took
   the in-major move to 9.39.5 in the SAME pull request as `eslint`, which is the only thing that keeps the
   two on one version. 10.x stays out until the `eslint` row's own remove-when fires.
5. **`@types/node` 25.9.3 → 24.13.6 — a deliberate DOWNWARD move, slice
   `refound/0-toolchain-types-node`.** Against the generic comparator the latest mature is 26.6.2; the
   target is the runtime major, which is the named exception in `testing-toolchain-alignment` ›
   _`@types/node` tracks the runtime major, downward if necessary, and `engines.node` is declared_.
   The catalog change alone does not make "types major = runtime major" true in the store: a second
   copy, `@types/node@26.0.0`, arrives through the Jest tree and leaves only when
   `@storybook/test-runner` does (slice `refound/0-toolchain-storybook`) or an override is added.

### Where each measured lag goes

| Destination                                                              | Packages                                                                                                                                                                                                                                                                                                           | What that slice must prove                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `refound/0-toolchain-holds` (WU-T.4(f))                                  | the vitest trio's hold; the corrected `eslint` and `@storybook/test-runner` rows; one row per no-slice lag below                                                                                                                                                                                                   | the gate reads the holds table, fails closed on zero parsed rows, and every surviving remove-when is observable          |
| `refound/0-toolchain-eslint` (WU-T.4(b))                                 | `eslint` **and** `@eslint/js` 9.36.0 → 9.39.5, **and the `@typescript-eslint` pair 8.65.0 → 8.70.0** (re-plan 2026-09-27: the pair had no slice, and bumping it is the only path to the `typescript` row), all in one pull request                                                                                 | `pnpm lint --max-warnings 0` exit 0; both React plugins' peers still resolve; the holds rows rewritten with today's date |
| `refound/0-toolchain-types-node` (WU-T.4(c))                             | **LANDED 2026-09-28.** `@types/node` 25.9.3 → 24.13.6; `engines.node` `>=24.15.0 <25` in all 98 manifests — the floor the plan asked for, with the explicit single-major CEILING the plan's `^24.15.0` left implicit, because the gate compares an exact string and a caret range names no ceiling it could refuse | `pnpm exec tsc -b --force` exit 0; the engines gate red-proven                                                           |
| `refound/0-toolchain-tsx` (WU-T.4(b))                                    | `tsx` 4.22.4 → **4.23.15** (not 4.23.13 — it matured today)                                                                                                                                                                                                                                                        | every `--import tsx` entrypoint still runs; re-measure maturity before pinning                                           |
| `refound/0-toolchain-browser` (WU-T.4(b))                                | `@playwright/test` 1.61.1 → 1.63.0 (with `playwright` / `playwright-core`), `@axe-core/playwright` 4.10.2 → 4.13.0                                                                                                                                                                                                 | `playwright install` succeeds on the runner image; 1.63 dropped Ubuntu 20.04                                             |
| `refound/0-toolchain-msw` (WU-T.4(b))                                    | `msw` 2.14.6 → 2.15.0                                                                                                                                                                                                                                                                                              | the suites that already use MSW stay green                                                                               |
| `refound/0-toolchain-rtl` (WU-T.4(b))                                    | `@testing-library/{dom,jest-dom,react,user-event}` — the family moves atomically                                                                                                                                                                                                                                   | both portals' component suites green; the family gate sees no split                                                      |
| `refound/0-toolchain-vitest-plugin` (WU-T.4(b))                          | add `@vitest/eslint-plugin` 1.6.27 (declared in 0 of 98 today)                                                                                                                                                                                                                                                     | `assertFunctionNames` covers the `node:assert` files; `eslint` exit 0                                                    |
| `refound/0-toolchain-storybook` (WU-T.4(d))                              | `@storybook/test-runner` removed unless a consumer is proven — taking `jest`, `nyc`, `jest-process-manager`, `wait-on` and the stray `@types/node@26.0.0` with it; the `storybook` family 10.4.6 → 10.6.0 only if the lock survives its own remove-when review                                                     | no workflow or script invokes it; Jest absent from the lockfile afterwards                                               |
| `refound/0-toolchain-jsdom` (WU-T.4(b), **[H1]**)                        | `jsdom` 29.1.1 → 30.1.0, `isomorphic-dompurify` 3.19.0 → 4.3.0, the `undici` re-audit and the `tough-cookie` re-scope                                                                                                                                                                                              | all THREE crossings resolved in one pull request, or a hold naming all three                                             |
| `refound/0-toolchain-build` (WU-T.4(b)) — **re-plan 2026-09-27**         | the build and format six: `vite`, `turbo`, `webpack`, `cross-env`, `jiti`, `prettier`                                                                                                                                                                                                                              | `tsc -b --force`, `pnpm build` and `format:check` exit 0; a prettier reformat is its own EVIDENCE commit                 |
| `refound/0-toolchain-quality-gates` (WU-T.4(b)) — **re-plan 2026-09-27** | the quality-gate eleven: `knip`, `jscpd`, `dependency-cruiser`, `secretlint` + preset, `size-limit` + preset, `@ast-grep/cli`, `lint-staged`, `@hey-api/openapi-ts`, `@faker-js/faker`                                                                                                                             | every gate those tools back keeps its verdict; a changed verdict is a finding to fix, never to baseline                  |
| **No enumerated slice — a hold row is the deliverable**                  | `typescript` (peer-blocked at every published `@typescript-eslint`), `@vitejs/plugin-react` (crossing), `eslint-plugin-boundaries`, `jest` (leaves with `@storybook/test-runner`, never bumped), and k6's floating tag                                                                                             | each row carries a measured reason, today's date, and a remove-when that can actually fire                               |

**Two limits of this table, stated rather than discovered later.** (1) It measures DIRECT dependencies
plus two transitives the plan owns by name (`playwright`, `jest`); a lag reachable only through some
other parent is invisible to it, which is why WU-T.4(f)'s gate reads the same `pnpm outdated -r`
output rather than this prose. (2) "Latest mature" is computed at one instant, and the boundary moves
daily in both directions — `tsx` and `dependency-cruiser` crossed into maturity during the day this
was written, and `size-limit@14.1.0` was published while it was being written. Every slice
re-measures before it pins, per `testing-toolchain-alignment` › _The freshness comparator is "latest
mature", never "latest"_.

---

## Plan (fixed)

Phases 0–9 and their work units, rendered from the approved plan (held outside the repository,
read-only). This section is FIXED: it is not edited to match what happened. A change to it is a
re-plan, and a re-plan is recorded in [§Decisions log](#decisions-log) with its date and its reason.

### What was signed, and is not re-discussed

1. **Confidence** = the code passes a STRICT and exhaustive battery, not an accommodating one. Every
   layer with its honest gate, and the merge blocked by ALL of them.
2. **A test proves in BOTH directions**: it fails when the behaviour is not met, and it passes when
   the code meets it. It is the same principle as "a gate is born with its demonstrated red",
   applied to each test — the criterion for demolishing AND for building.
3. **Decorative-test criterion** (any of the four, proven per file and LISTED before deleting):
   (a) it does not restrict behaviour — it only asserts existence; (b) it points at something that
   does not exist; (c) it skips itself under the conditions CI provides; (d) it cannot fail by
   construction. The hard probe settles doubt: delete the implementation — if it stays green, it is
   decorative.
4. **The decorative is deleted FIRST** and the count may fall. **The frameworks are NOT deleted**:
   they are re-founded afterwards.
5. **Sequence**: the re-foundation goes BEFORE everything else, against what is already done
   (`main`). What is open, green and reviewed merges first; what is red merges when it closes its own
   red; what is UNWRITTEN is measured at the end of the queue.
6. **Which framework for what**: decided by the BOUNDARY the code crosses, one test per boundary at
   the lowest layer that can see the defect. A framework stays only if it is the only tool that sees
   a class of defect; two for the same class → one is redundant.
7. **Mutation testing is NOT installed before starting**: it enters once the tests are worth
   measuring (after coverage in all 86), as the tool that verifies rule 2 at scale.
8. **ALL the tests are reviewed** (942 + 8): the machine first, the hand after; every file ends with
   a verdict in a ledger — keep / rewrite / delete — with evidence. Nothing survives by default.
9. Executed as **SDD**, with receipt-driven review per pull request and the two-tier review budget
   (CODE 400 hard / EVIDENCE pre-approved).
10. **How the frameworks compose into one unit**: not by calling each other, but through three shared
    contracts — reach, environment, verdict — and shared tooling. **The unit is the composition of
    the merge gate, not a runner.**
11. **Which frameworks are really needed** is decided by the boundaries the system has, not by what
    is installed. Verdicts to confirm with evidence: vitest, React Testing Library and coverage stay;
    Playwright stays; MSW stays as the ONLY HTTP double; k6 stays only if load blocks merges,
    otherwise it goes; **node:test is the uncomfortable case** (two runners for one class — measured
    against whether vitest can own the tier with real services; if there is no difference, one is
    redundant, 108 files); Jest is out (it arrives by rebound through the Storybook test runner,
    which also has to justify itself); mutation testing returns because it is the only thing that
    verifies rule 2 at scale.
12. **Signed diagnosis, framework by framework**: vitest is the only thing that works as a unit, but
    50 packages holding one four-test file is scaffolding; node:test is the most honest layer (it
    names what fails, it has tiers, it punishes the skip) but with 20 unwired suites and hand-written
    lists; Playwright is decorative (0 CI runs, specs without their page objects, admin without a
    script); MSW is installed and unwired; k6 and perf never ran and cannot fail; `security/tests` is
    fiction; real coverage is around 50 % against a document that says 95 %; Jest is in the tree
    against the canon. As a unit: **it is not a unit** — layers that do not talk to each other, two
    collectors with disjoint lists, unreddenable gates, a nightly with 31 unread alarms, four
    contradictory documents. The only thing that protects a merge today: the api vitest suite plus
    the integration tier.
13. **Where to start**: at the floor — reach → demolition → gates that can fail → the integration
    tier → coverage in all 86 → re-found the decorative → mutation → the queue. Starting at E2E
    would be building the bedroom on the roof again.
14. **Objections**: when I think otherwise, I argue why and nothing more.

### The three contracts that make five frameworks one unit

| Contract        | What it fixes                                                                                                                                                                                                                                | How it is verified                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reach**       | Every test file has exactly ONE collector, decided by name/path convention (`*.test.ts` vitest · `*.integration.test.ts` node:test tier · `*.live.test.ts` live tier · `*.spec.ts` Playwright · `*.k6.js` k6). The convention IS the router. | Gate: `disk − union(collectors) = 0`, with no hand-written lists. Closes SMELL-74/75/79; #30 stops being a ratchet.                                            |
| **Environment** | ONE script brings up the same services (Postgres, Redis, API, workers) for local and CI, with both URLs (app role / owner) and the `development` condition. Integration, E2E and perf all consume it.                                        | The same command in `ci.yml`, `performance.yml`, Playwright's `webServer` and locally; readiness PROVEN, not assumed.                                          |
| **Verdict**     | Every layer emits an exit code plus a report readable by machine and human; the merge gate COMPOSES them: all required, no `needs:` that dodges, no swallowed exit, each with a demonstrated red.                                            | Fitness #34 (`::error` paired with an exit) plus a new gate over implicit `needs` / `if: success()`, plus the required-check list versioned in the repository. |

Plus a shared tooling package — factories, fixtures and MSW handlers in one place, so the five layers
talk about the same `Post`.

### The convention (the router)

| Name                                 | Collector                                  | Environment profile                                                              | Where it may live               |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------- |
| `*.test.ts(x)` (and not a row below) | the package's vitest config                | `hermetic`: no network; Postgres/Redis URLs point at `127.0.0.1:1` (unreachable) | anywhere a vitest config covers |
| `*.integration.test.ts`              | the integration collector (`run-tests.sh`) | `services`: Postgres + Redis, owner URL and app-role URL                         | `apps/api/tests/**` only        |
| `*.live.test.ts`                     | the integration collector, live phase      | `services` plus API and workers booted and ready                                 | `apps/api/tests/**` only        |
| `*.spec.ts`                          | Playwright (per-app config, `testMatch`)   | full stack via `test-env.sh serve`                                               | `apps/{client,admin}/**/e2e/**` |
| `*.k6.js`                            | k6 (performance workflow)                  | full stack                                                                       | `performance/k6/scenarios/`     |
| `*.fixture.ts`, `*.test-helpers.ts`  | none, by design                            | n/a                                                                              | anywhere                        |

"Test-shaped" = a basename matching `/\.(test|spec)\.[cm]?[jt]sx?(\..+)?$/` or `/\.k6\.js$/` (it
catches `.test.ts.disabled` and `.old`, and excludes `.env.test.example`). The disk set is
`git ls-files` over the WHOLE repository, so `security/`, `performance/`, `quality/` and any new
directory are in scope with nothing to configure. **The suffix names the TIER, not the runner**, so
the router survives node:test being consolidated into vitest.

### Budget convention (D1)

**CODE** (hard limit 400 per pull request): production, scripts and tooling, workflows and config,
the test-utils packages, ESLint rules, canon and docs prose, test lines added or modified, and block
deletions inside files that are kept. **EVIDENCE** (pre-approved per slice): generated artefacts
(ledger JSON and Markdown, `probes.json`, `eslint-suppressions.json`), whole-file deletions backed by
an approved ledger row, `git mv` at ≥ 90 % similarity, and the mechanical output of a codemod whose
own code counted as CODE. Every new file carries `@file/@description/@layer`; no comment mentions a
development timeline.

### What reading the code changed (design findings, 2026-09-27)

1. **F-6 is a class, not a test**: `bulkScheduleRelayRetry.integration.test.ts:95` and
   `bulkScheduleMediaPath.integration.test.ts:97` also build their own `OutboxRelay` through
   `bulkScheduleHarness.makeRelay` — wired into `integration:outbox` under `full-integration` they
   would run against the real relay (`src/index.ts:866`) exactly as the smoke does. **F-6 is fixed
   BEFORE they are wired.**
2. **The sentinel does not help the smoke**: `OutboxRelay.integration.test.ts` seeds its own rows and
   pre-claims them; in the smoke the use case writes the outbox row inside its own transaction, so
   the race window stays open.
3. **k6 cannot run even with the variable corrected**: `performance/k6/utils/auth-helpers.js`
   registers users through `POST /api/auth/register` (which does not exist) and imports from
   `https://jslib.k6.io`.
4. **"Schedule → the worker publishes" would be red today because of N-COR-9**, not because of the
   tests: nothing promotes a scheduled post except the webhook clobber. The first green E2E uses
   publish-now; schedule → published is the acceptance test of N-COR-8/9.
5. **Demolition lowers `apps/api`'s coverage floors** (coverage counts execution, not assertion).
   Fitness #37 accepts a descent only with a `canon-exception:<scenario>` marker and the scenario
   table has none → new scenario plus an ADR (WU-2.0).
6. **The regex undercounts; the AST is the tool**: `rg -U` finds 30 files with a multi-line
   `stubGlobal("fetch")` against 26 on one line → every new gate is an ESLint rule.
7. **ESLint 9.36 has bulk suppressions** (`eslint-suppressions.json`): a ratchet per file and per
   rule, and an obsolete suppression is **exit 2** → demolition pull requests are obliged to prune.
8. **`@vitest/eslint-plugin` recommended includes `no-import-node-test: error`** → it must be scoped
   to the files vitest collects, or it flags the 108 node:test files.
9. **`settingsRoutes.test.ts` is behavioural** (it exercises the real schemas' `safeParse`); its
   defect is the promise in its header → it is renamed, not deleted.
10. **`universal-client-dashboard.integration.test.ts` adds nothing**: every endpoint it touches is
    already covered by `providerRegistry.test.ts:64-358`, which authenticates and asserts 11
    providers.
11. **The client E2E login fixtures are false**: `fixtures/test-user-auth.json` stores a fake JWT in
    `localStorage`; the client authenticates with httpOnly cookies
    (`lib/auth/sessionCookie.ts`).
12. **The Prisma double can never fail on raw SQL**: `createMockPrismaModule` answers `$queryRaw*`
    with `[]`, so every raw path passes by construction.
13. **A single test-utils package would couple and slow the whole core**: no core or provider package
    depends on `@infra/prisma` today; one package with Prisma inside it puts `prisma generate` into
    everyone's `^build` graph → three packages.
14. **The SSRF case in `security/tests` is probably a genuine red**: the external notification sinks
    validate HTTPS only (`ConfigureExternalNotificationUseCase.ts:74-76`) and
    `secureSchemas.ts:129` blocks `localhost` by substring.
15. **`createTestApp` cannot live in a shared package**: only `apps/api` uses Fastify and the builder
    needs `errorPlugin`, `setupContainer` and the Zod compilers → `apps/api/tests/support/`.

### Phase 0 — Baseline and tracking (Track T)

- **WU-T.1** Create `docs/development/TESTING_REFOUNDATION.md` (structure in §Medidor) with the
  baseline measured at the base SHA; row in `docs/README.md`. Acceptance: every metric with a
  baseline, a re-derivation command and "Moved by: —". CODE ~180. PR `refound/0-tracker`.
- **WU-T.2** `scripts/testing/metrics.mjs`: prints the metric table from `git ls-files`, the reach
  module, `ledger.json`, `eslint-suppressions.json` per rule, and a pasted vitest/TAP summary.
  Acceptance: at the base SHA it reproduces the Baseline column byte for byte. CODE ~150.
- **WU-T.3** Ficha `N-TEST-1` in `MASTER_PLAN_ES.md §1 N.C` (plus notes on N-CI-2/N-CI-3 and the
  dashboard) and `NORMALIZATION_ROADMAP.md §2.3` subsuming §2.2.b, §3.2.b, §4.1.b/c (texts in
  §Medidor). Acceptance: fitness #24 green, links resolve. CODE ~70.
- **WU-T.4** Testing-toolchain alignment BEFORE the reach contract (signed 2026-09-27, D20):
  (a) measure with `pnpm outdated -r --format json` plus `pnpm view <pkg> time --json` the date of
  each version → table in the tracker: dep · installed · **latest mature** (≥ 7 days, ADR-0018) ·
  documented hold (yes/no, where) · CVE floor; (b) per family, raise to the **latest mature** unless
  a documented hold says otherwise, each bump validated empirically (green tests of the affected
  packages, `tsc -b --force`, `format:check`) and one pull request per family ≤ 400 CODE: `vitest` +
  `@vitest/coverage-v8` + `@vitest/ui`, `@playwright/test` (plus `playwright install` of the
  version), `msw`, `@testing-library/react` + `jest-dom` + `user-event`, `jsdom`, `tsx`;
  (c) **`@types/node` aligns DOWN to the runtime major (24)**, and `engines.node` is added (0 of 98
  manifests declare it) so drift becomes a gate; (d) the Storybook family keeps its hold (10.4.6,
  documented) and `@storybook/test-runner` is adjudicated: if no workflow or script runs it, it is
  removed and Jest 30 leaves the tree with it; if it is used, it is documented as the only carrier of
  Jest; (e) the 86 dead `vite` shims: clean reinstall and verification that `node_modules/.bin/vite`
  points at the single `vite` 8; (f) every direct testing dependency left below latest mature has its
  reason in the holds table of `docs/security/SECURITY_CANON.md` §"Build-tool version holds" — a gate
  in `Dependency Consistency` compares the holds table against `pnpm outdated` and fails on a lag
  with no row. Acceptance: 0 lags without a reason; `@types/node` major = runtime; 12,623 tests green
  after each bump. Gate red: lower a pin without adding a hold row → exit 1. CODE ~60 per family plus
  ~80 for the gate. PRs `refound/0-toolchain-<family>`.
  **Measured 2026-09-27**: (1) the gate's comparator is **"latest MATURE"**, not `latest` — today
  `latest` is not mature for vitest (5.0.2, 1.8 days → target 5.0.1), `@types/node` (mature 24.x =
  24.13.6), jsdom (30.1.0), vite (8.3.0), turbo (2.11.2), `@typescript-eslint` (8.70.0), tsx
  (4.23.13/15), k6 (v2.2.0); (2) undocumented majors the gate would flag: TypeScript 6→7 (7.0.2,
  mature 81 days; the real blocker is the peer `@typescript-eslint <6.1.0` → a new hold with that
  reason, or a bump of the family), `@vitejs/plugin-react` 5→6, jsdom 29→30, `@eslint/js` 9→10,
  vitest 4→5; (3) **jsdom 30 is not a test-only bump**: it requires Node `^24.15.0`, depends on
  `undici ^8` (the CVE override `undici >=7 <7.29` stops applying to that chain → re-audit) and jsdom
  29.1.1 is ALSO a production transitive through `isomorphic-dompurify@3.19.0` (4.4.0 wants jsdom
  ^30 → a production major) → its own decision inside T.4, with `engines.node >=24.15.0`; (4) the
  Storybook hold looks expired (10.6.0, 25 days, peers accept next ^16) → a validated family bump or
  a hold rewritten with a measured reason; (5) `@storybook/test-runner` is declared only by admin, no
  workflow runs it, and it is the ONLY source of jest 30.4.2, nyc 15.1.0, `@types/node@26.0.0`,
  `jest-process-manager` and `wait-on` → removing it removes them all (and `apps/client:30` has a
  `storybook:test` script without declaring the package); (6) the eslint hold only explains "<10",
  not staying at 9.36 while 9.39.5 is mature; (7) **`SECURITY_CANON.md:254` has the GHSA-q7cg chain
  wrong**: `request` arrives through `jq → jsdom@0.2.19`, not through `wait-on` → its remove-when can
  never fire (corrected in the same slice); (8) the catalog's "latest stable (taze)" comments are
  stale for typescript, `@types/node`, jsdom and msw.
  **Research verdicts that change T.4**: (a) **vitest stays at 4.1.11** as a documented HOLD with a
  measured reason: `@stryker-mutator/vitest-runner` 10.0.0 (the only stable one) is broken on vitest
  5 — stryker-js#6210 open, fix #6220 unmerged, every mutant silently "Survived" (47.36 → 2.96,
  7 min → 37 s), a peer `vitest >=2.0.0` that does not warn; the 4→5 migration is a 573-file project
  with behaviour changes (unawaited async assertions fail, `clearMocks` true, `-t` with `' > '`,
  removed entry points, outputs moved to `.vitest/`); and 5.0.2 is not mature. Remove-when: a stable
  stryker runner with #6220 plus re-measured maturity → its own migration change. (`@storybook/addon-vitest`
  is NOT installed: that reason does not apply.) (b) eslint 9.36.0 → 9.39.5 (in-major, end of the 9
  line, EOL) and the hold is rewritten with a date and a new remove-when (the react and jsx-a11y
  plugins still peer on ^9). (c) `@types/node` → the 24 line (24.13.6 mature today); pnpm enforces
  `engines.node` only for the project (no `engine-strict`). (d) tsx → 4.23.13. (e) Playwright 1.63.0,
  msw 2.15.0, `@axe-core/playwright` 4.13.0, `@vitest/eslint-plugin` 1.6.27: mature, they enter.
  (f) Confirmed: the `mergeConfig` shape for coverage is valid on 4 and 5; reporters come from
  `vitest/node` (never `vitest/reporters`); `vitest list --filesOnly` is a reach surface;
  `getResponse` from msw is a documented public export; the rules endpoint reads without a token but
  rulesets in evaluate mode are NOT returned → the gate fails closed on an empty array and paginates;
  merge queue exists only on organisation repositories → `strict` only (D5).

### Phase 1 — Reach contract

Design decisions: tier by suffix, **one execution unit per file** (one `node --test` per file: the
verdict names the file and the zero-test guard applies per file), concurrency 1 across the tier (as
it already is), **timeout declared in the test** (`describe(name, { timeout })`), and the two
ordering hacks become: the test that contaminates shared state restores it, and the runner verifies
API and worker readiness before EACH live file (naming the file that left the environment broken).
Rejected: directory-per-batch (it moves 98 files and ties the layout to the scheduler) and a manifest
with existence checks (still a hand-written list). Cost: about one extra node boot per file (~15–30 s
per run), measured as an acceptance criterion. The gate: **#30 becomes dynamic** — it asks each
runner what it collects and verifies that a required job runs each collector
(`disk − ⋃ collected-by-required-job = ∅`, exactly one collector per file); it needs dependencies
installed → a new `Test Contracts` job in `fitness.yml`.

- **WU-1.1** Free the `.integration` suffix and name the k6 scenarios: `git mv` of the 24
  `apps/client/tests/integration/*.integration.test.tsx`, the 2 under `apps/api/tests/unit`, the 4
  provider stubs → `*.test.ts(x)`; `performance/k6/scenarios/*.js` → `*.k6.js`;
  `performance.yml:224` → `${SCENARIO}.k6.js`; root `perf:api`; `run-performance-tests.sh`.
  Acceptance: `git ls-files '*.integration.test.*'` lists only node:test files under
  `apps/api/tests`; `vitest list --filesOnly` per package identical before and after (832). CODE ~10.
  PR R1.
- **WU-1.2** Reserve the suffixes inside each collector: `packages/vitest-shared/src/index.ts:132-156`
  exports `RESERVED_TIER_EXCLUDES` and the factory sets `test.exclude: [...configDefaults.exclude,
...RESERVED_TIER_EXCLUDES]` (`mergeConfig` concatenates arrays); `apps/api/vitest.config.ts:44`,
  `apps/workers:59`, `apps/admin:51-57`, `apps/client:55` spread it; admin and client gain an explicit
  `include: ["**/*.test.{ts,tsx}"]` (today they use the default, which also matches `*.spec.*`); both
  Playwright configs get `testMatch: "**/*.spec.ts"`; convention table into
  `CODING_STANDARDS.md §Test Framework Rules`. Red: plant
  `apps/api/tests/unit/x.integration.test.ts` with a vitest test → `vitest list` does NOT list it →
  restore. CODE ~40. PR R2.
- **WU-1.3** Remove double collection and subset entrypoints: delete `eval.yml` (`tests/eval/**` is
  already in api's include and runs in the shards); delete the `custom-security-tests` job
  (`security-testing.yml:78-282`, header :3-21) — `tests/{auth,security}.test.ts` run in
  `integration:flows` and `{mfa,rbac}` in `remaining` as the app role with rate limiting, STRICTER
  than that job's owner; the 2 of `test:ratelimit` are under `tests/unit`; delete the 26 node:test
  subset scripts (`apps/api/package.json:21-25,27-47`), `test:eval` (:18) and `test:ratelimit` (:26).
  Acceptance: the subset-script grep returns 0; the "files with >1 collector" metric goes 10 → 0.
  CODE ~250 (deletions). PR R3. _(Absorbs WU-4.8.)_
- **WU-1.4** Move the timing needs into the tests: `{ timeout }` on the top `describe` of
  `hardDeleteSerializableRace` (120_000), `sagaCrashRecovery`/`sagaCompensationRecovery`/
  `sagaPublishNowPromotion` (120_000), `sagaCustomerFlow` (180_000),
  `publish`/`analytics`/`media`/`schedule.flow` (60_000) — the values at `run-tests.sh` :245, :336,
  :398, :401; in `tests/security.test.ts:63` an `after()` in "Advanced Rate Limiting" that waits for
  `${BASE_URL}/health` → 200 bounded by `Retry-After`/`X-RateLimit-Reset` plus 5 s (cap 90 s) and
  throws if the window does not reopen. Acceptance: batches green with the same counts; `production`
  immediately after `integration:flows` passes without `wait_for_api`. Red: without the `after()`
  that sequence fails with 429 (proving the coupling was real); with `{ timeout: 120_000 }` a planted
  `sleep(45_000)` passes under `--test-timeout=30000`, and fails without the option. CODE ~35. PR R4.
- **WU-1.5** Rename the node:test population by MEASURED tier: run each of the 100 files (98 under
  `apps/api/tests` outside unit/eval plus 2 under `tests/chaos`) alone, with Postgres and Redis up and
  API and workers down — passes with 0 skips → `.integration.test.ts`; otherwise → `.live.test.ts`;
  also record which pass with services down (hermetic; they feed the ledger and the experiment).
  Starting point: `run-tests.sh` puts 52 on the database and 26 in live; a grep heuristic puts 10 of
  the 20 dark ones in live — the measurement decides. `git mv` of the 100; paths in `run-tests.sh`
  (:221-445), constants in `sagaContextInvariants.static.test.ts:1638-1641`,
  `sagaLiveSuitePrecondition.static.test.ts:21`, the RLS table in `CLAUDE.md:1737`, about 28 documents
  (link check); re-key `apps/api/tests-typecheck-baseline.json` with `typecheck-tests-ratchet.mjs
--write` (the "new key" rule of #289 would flag every rename). Acceptance: Integration Tests green
  with the same per-batch counts; the typecheck ledger diff is a pure rename (same `TScode` multiset
  per path); the old #30 stays at 20. CODE ~110. PR R5.
- **WU-1.6** `run-tests.sh` becomes the integration collector only: delete :18-23 (the `.env`
  sourcing, which could send integration at the dev database — with `TIER` set and an empty
  `DATABASE_URL`, exit 2 naming `scripts/test-env.sh run`); delete :159-207 (the vitest phase);
  `run_vitest_phase` :48-51; the vitest cases of `runTestsGate.static.test.ts:289-333`;
  `apps/api/package.json:19` `test:all` = `pnpm test && pnpm test:integration`. Red: empty
  `DATABASE_URL` plus `TIER=full-integration` → exit 2 without running anything. CODE ~110. PR R6.
- **WU-1.7** Collect the services tier by convention: `collect <suffix>` (a `find` over `tests`
  excluding `tests/unit`, `LC_ALL=C sort`, reversible with `TEST_ORDER=reverse`); quarantine
  `packages/test-contracts/quarantine.json` (`[{path, reason, owner, since}]`, read with `jq`; each
  entry printed `QUARANTINED (not run): <path> — <reason>`); `run_file` = `run_batch` (:63-157) per
  file, keeping EXACTLY `[ "$tests" -eq 0 ]` and `[ "$TOTAL_TESTS" -eq 0 ]` (#31 B intact) and every
  guard; `--list` prints `integration\t<path>` / `live\t<path>` / `quarantined\t<path>`; delete the
  DB batch section (:214-341); `runTestsGate.behavior.test.ts` (the `node` stub receives one file per
  call; "batches printed failed" → "units"); **interim #30**: `fitness.yml:754-757` and
  `CLAUDE.md:713-716` move from `grep -qF "$path" run-tests.sh` to membership in
  `run-tests.sh --list | cut -f2` (the baseline falls from 20 to the dark-live count plus quarantine);
  seed `quarantine.json` with every dark DB suite that fails in CI as the app role, with its reason.
  Acceptance: CI green; tests ≥ baseline plus the dark DB suites; 0 skips; job ≤ 15 min
  (`ci.yml:315`); per-file overhead ≤ 60 s over the base run. Red (complete step, byte-exact
  restore): (a) an empty `tests/integration/empty.integration.test.ts` → exit 1 for zero tests;
  (b) a `before` that throws → exit 1 for a cancel; (c) `t.skip()` → exit 1 under TIER; (d) interim
  #30: `tests/integration/orphan.test.ts` with no suffix → above baseline → exit 1. CODE ~290. PR R7.
- **WU-1.8** Collect the live tier by convention: loop over `collect live`; `probe_live` before each
  file (`curl -fsS "$TEST_API_URL/health"` and `"$TEST_WORKERS_READY_URL"` — workers ready only with
  the publish consumer registered, `ci.yml:498-504`); on failure it records
  `env-unready-before: <file> (last ran: <previous>)` and stops the tier; delete :343-455
  (`assert_publish_consumers`, `wait_for_api`); path filters `bash run-tests.sh <path>...` (replacing
  the deleted scripts); rewrite `sagaLiveSuitePrecondition.static.test.ts` ("the runner verifies
  readiness before each live file") and `sagaContextInvariants.static.test.ts:1617-1651` (it asserts
  that the saga suites carry a tier suffix; reach belongs to #30); quarantine the dark live suites
  that fail: `trendRadarRoutes` (F-9, `dayKey`) and `universal-client-dashboard` (to be deleted).
  Acceptance: CI green including the dark live suites that pass; 0 skips; ≤ 15 min;
  `TEST_ORDER=reverse` green once, evidence in the pull request. Red: (a) remove WU-1.4's `after()` →
  the probe fails before the next live file naming `security.live.test.ts` → exit 1; (b) kill the
  workers mid-run → exit 1 naming the file. Dep: WU-1.7, WU-4b.3. CODE ~200. PR R8.
- **WU-1.9** `packages/test-contracts`: the reach engine with self-tests (not yet wired).
  `package.json` (private; `vitest`, `yaml`, `typescript` from the catalog), `vitest.config.ts` from
  the factory, `src/reach.ts`, `src/lib/{disk,vitest-collector,node-collector,playwright-collector,
registry}.ts`, `collectors.json`, `quarantine.json`, `tests/*.test.ts` with fixture trees. Engine:
  (1) disk = `git ls-files` filtered to test-shaped (fail-closed under 800); (2) vitest = for each
  tracked `vitest.config.*` (fail-closed under 80) `createVitest("test", { root, config, watch:
false })` plus `globTestSpecifications()`, falling back to `vitest list --filesOnly --json`, at
  least 1 per config; (3) node = `run-tests.sh --list`, at least 1; (4) playwright =
  `playwright test --list --reporter=json -c <cfg>`; (5) k6 = glob `*.k6.js`; (6) registry
  `collectors.json` maps collector → `executedBy: [{workflow, jobId, entrypoint, packages|exclude}]`;
  (7) rules: R1 each collected file exactly once or quarantined; R2 the `executedBy` job exists,
  contains the entrypoint in a `run`, and its rendered name is a required context in
  `.github/rulesets/main.json`; R3 quarantine: every entry exists, none is collected, head ⊆ base.
  Acceptance: self-tests green in Package Tests; against the real tree it prints the unreached set as
  the quarantine seed. Red: each rule is a self-test that plants its violation in a fixture and
  asserts a non-zero exit naming it (continuous red), plus one manual run over the real tree.
  CODE ~380 (engine ~230, tests ~150). PR R9.
- **WU-1.10** Wire the new #30 and retire the grep ratchet: job `test-contracts` "Test Contracts" in
  `fitness.yml` (checkout `fetch-depth: 0`, the shared node/pnpm cache action, `DATABASE_URL` = the
  canonical hermetic URL for Prisma's postinstall), step
  `"#30 Every test file has exactly one collector run by a required check"` with `if: always()` →
  `pnpm --filter @packages/test-contracts reach`; delete the old step (:733-768);
  `CLAUDE.md:699-716` rewritten as a script-backed check (description, invocation, limits); `:304`
  and `fitness.yml:9-11` stop saying baseline; a new `.github/rulesets/main.json` (mirroring the 19
  contexts, `strict: false`) as the source for R2 before WU-3.11 changes it; seed the full
  quarantine: 9 Playwright specs (no job yet), 7 `security/tests`, `postgres-stress.test.ts`, 2 admin
  fetch scripts, `_template/.../sandbox.template.test.ts`, `.disabled`, `.old`, 6 `*.k6.js`, the 2
  dark failures — each with a reason and an owning work unit; `CLAUDE.md §Extending the suite` step 2
  allows script-backed checks (the workflow and `CLAUDE.md` call the same command; the script is the
  single source with self-tests). Acceptance: Test Contracts green in ≤ 6 min; "test-shaped
  unreached outside quarantine" = 0. Red (complete step): (1) `orphan.test.ts` → "unreached";
  (2) `../client/lib/**/*.test.ts` in admin's include → "collected twice"; (3) a collected file added
  to quarantine → exit 1; (4) delete a quarantined file without removing its entry → exit 1;
  (5) `collectors.json` pointing at a non-existent job → exit 1; restore (`sha256sum`). Dep: WU-1.9,
  WU-3.1. CODE ~90 plus docs. PR R10.
- **WU-1.11** Script contract (reach part C) plus #31 A widened: `reach.ts` part C — every package
  with a vitest config has `scripts.test === "vitest run"` (Phase 5 extends it to `test:coverage`);
  `apps/client/package.json:11` `"vitest"` → `"vitest run"` (F-16); `ci.yml:773` →
  `pnpm --filter @apps/client test`; delete the watch justification at `ci.yml:705-710`; #31 A's
  scope becomes `git ls-files '*.json' '*.ts' '*.mts' '*.yml'` repository-wide (today only
  apps/packages/infra) in `CLAUDE.md:728-730` and in fitness. Red: (a) revert the script → part C
  exits 1; (b) `script -qc "pnpm --filter @apps/client test"` with a 60 s timeout: before it never
  ends, after it does; (c) a planted `--passWithNoTests` in a `ci.yml` step → #31 exits 1. CODE ~40.
  PR R11.
- **WU-1.12** #36 over resolved configs, in all 86: `packages/test-contracts/src/scopes.ts` resolves
  each config and verifies that every positive glob of `test.include` matches at least one file
  (`coverage.include` enters in WU-5.1; Playwright projects need at least one test when the E2E
  reconstruction lands); the #36 step (fitness :972-1069) moves to Test Contracts;
  `CLAUDE.md:868-971` rewritten, keeping fail-closed (0 resolved configs, or one that does not
  resolve → exit 1). Red: (a) `@core/posts`'s include → `"testz/**/*.test.ts"` → exit 1; (b) break a
  config's syntax → exit 1. CODE ~120. PR R12.
- **WU-1.13** #32 over the syntax tree, in every test-shaped file:
  `packages/test-contracts/src/skips.ts` parses the disk set with the TypeScript compiler
  (`createSourceFile`, no typecheck) and flags: member access
  `.(skip|only|fixme|todo|skipIf|runIf)` (called or merely referenced) on
  `it|test|describe|suite|test.describe`; a `skip|only|todo` property in the options object (2nd
  argument); Playwright `test.skip(` / `test.fixme(` in any position. #32 (fitness :807-838) moves to
  Test Contracts; `CLAUDE.md:740-758` rewritten, removing the false claim "5 of 83 forbidOnly" and
  the `.todo` exemption. Precondition: demolition removes the 6 `test.skip(` in specs, the
  `describeIf` at `authContext.integration.test.tsx:54`, `{ skip: USE_REAL_ADAPTERS }`
  (`providerRegistry.test.ts:386`) and the 43 `it.todo`. Red: plant (a) `test.fixme(` in a spec,
  (b) `const d = describe.skip;`, (c) `it("x", { skip: true }, …)`, (d) `{ skip: 2 }` inside a Prisma
  call — (a)–(c) exit 1, (d) green (proving it does not flag Prisma's `skip`). Dep: WU-1.10, Phase 2.
  CODE ~160. PR R13. _(Complements WU-2.4's ESLint rules: ESLint gives IDE feedback and a per-file
  ratchet on the vitest files; #32 is the gate over EVERY test-shaped file.)_
- **WU-1.14** Workflows only call registered entrypoints (reach part B): `reach.ts` part B reads the
  workflow files with `yaml`: (B1) no `vitest`, `node --test`, `playwright test` or `k6 run`
  invocation with a positional path except the forms registered in `collectors.json`
  (`vitest run --shard=`, `--mergeReports`); (B2) every `pnpm … <script>` / `turbo run <task>` that
  starts with `test` is one of `test`, `test:coverage`, `test:integration`, `test:e2e`. These must go
  first: `nightly.yml:95` (WU-3.12), `production-ci.yml:147` (WU-3.5),
  `dependency-updates.yml:193,270` (root `pnpm run test` → `turbo run test:coverage`, or removed),
  `eval.yml:48` and the security jobs (WU-1.3). Red: plant
  `run: pnpm --filter @apps/api exec vitest run tests/unit/foo` → exit 1. Dep: WU-1.10, 3.5, 3.12.
  CODE ~110. PR R14.
- **WU-1.15** Retire the quarantine: delete `quarantine.json` and its handling in `run-tests.sh` and
  `reach.ts`; #30 says hard-zero. Acceptance: quarantine empty on base. Red: plant an unreached file
  → exit 1 with no quarantine path. Dep: Phases 2, 4, 6 empty it. CODE ~−60. PR R15.
- **WU-1.2b** vitest ignores `--conditions development` (it honours only `import`/`default`); the
  factory resolves through aliases derived from `tsconfig.base.json`, but **18 workspace packages have
  no alias** (`@packages/{i18n,api-common,query-client,ui,vitest-shared}`,
  `@adapters/{storage-cloudinary,storage-azure,storage-gcs,storage-do-spaces,crm-hubspot,
crm-salesforce}`, `@observability/{background-scheduler,browser-logger}`, `@providers/_template`,
  the 4 apps) → a bare import under vitest resolves through `exports` to `dist` (the class of #27, in
  the runner #27 does not cover). Measure which vitest-collected tests import those bare names; set
  `ssr.resolve.conditions: ["development", …]` in the factory (verifying the spelling on vitest
  4.1.11) and add an assertion in `packages/test-contracts`: every workspace package imported by a
  test resolves to `src/`. Red: delete an alias or the condition → the test resolves to a
  non-existent `dist` and fails naming the package. CODE ~80. PR R2b.
- **WU-1.16** Node declares its reporter output unstable; the collector migrates from parsing TAP to
  `--test-reporter=json` (or to the programmatic `run()` API), keeping EXACTLY the four guards
  (fail/cancel/skip/zero) and updating #31 B's pins in the same pull request; the red re-demonstrated
  for each guard. After R7/R8. CODE ~120. PR R16.

### Phase 2 — Demolition

**2.A Instruments**

- **WU-2.0** Scenario `decorative-demolition` in `CLAUDE.md §Pragmatic Exceptions` (marker
  `// canon-exception: decorative-demolition:<ledger-slice>`) plus an ADR (first free number: 0025;
  0024 is reserved by N-COR-8) and #37's scenario matcher if it hardcodes them. Red: lower a floor
  without the marker → #37 exits non-zero → restore; with the marker → green. Dep: the coverage
  decision, and a `sensitive-edit` token. CODE ~40. PR `refound/2-coverage-exception`.
- **WU-2.1** The assertion classifier as a **workspace package with tests**
  `packages/eslint-plugin-testing/` (`src/assertions.js`, `src/blocks.js`, ESM `// @ts-check`,
  loadable by jiti and by node; tests with `RuleTester` plus fixtures). It parses with
  `ts.createSourceFile` (syntactic). Blocks: `describe/it/test/suite`
  (plus `.each/.concurrent/.skip/.only/.todo/.skipIf/.runIf`), `t.test`, `{ skip: expr }`.
  Assertions: `expect(...)` chains (including `.not/.resolves/.rejects`), `assert.*`, `t.assert.*`,
  same-file helpers inlined one level, imported helpers matching `^(expect|assert|verify|check)`
  marked **opaque** → human review. Classes: TAUTOLOGY (literal against literal; `>= 0` over
  length/size/count) · EXISTENCE (`toBeDefined`, `not.toBeUndefined/Null`, `toBeTruthy`/`assert.ok`
  over an identifier, member or call, `toBeInstanceOf`, one-argument `toHaveProperty`,
  `typeof`/`Array.isArray`/`toBeTypeOf`, `toBeInTheDocument()` over `querySelector` or a tag) ·
  SNAPSHOT · BEHAVIOURAL. Flags: CONDITIONAL, GUARDED-RETURN. Block classes: EMPTY · TAUTOLOGY-ONLY ·
  EXISTENCE-ONLY · CONDITIONAL-ONLY · SELF-SKIP · PRINTS-SUCCESS (a `console.*` matching
  /pass|success|✅|🎉|operational|fully functional|all tests/i with no assertion after it) ·
  TITLE-CONTRADICTION (a title "returns undefined|null" with a positive existence matcher;
  "throws|rejects" without `toThrow`/`rejects`; an HTTP status in the title that no assertion names;
  "does not|never|should not" with only positive existence) · BEHAVIOURAL. Criterion map:
  (a) = EMPTY/EXISTENCE/TYPE · (c) = SELF-SKIP/todo ·
  (d) = TAUTOLOGY/CONDITIONAL-ONLY/PRINTS-SUCCESS. Acceptance: fixtures with a positive and a
  negative case per class in both frameworks (including `auditMiddleware.test.ts:274`,
  `webhookHandler.stats.test.ts:355`). CODE ~230, EVIDENCE ~250. PR `refound/2-classifier`.
- **WU-2.2** Ledger `scripts/testing/ledger.mjs` (plus `lib/*.mjs`): discovery by `git ls-files`
  (workspaces plus `security/` and `performance/`; suffixes `.disabled/.old/.bak`; runners
  `tests/run*.ts`; candidate helpers); reach through `collectorOf(path)` (`null` = orphan); classified
  blocks; SUBJECT-NOT-IMPORTED (b) (the stem resolves to a module the test never imports); duplicates
  by a multiset of normalised titles (EXACT-DUPLICATE; DUPLICATE-UNION when ≥ 5 titles are contained
  in the union of same-package siblings — the `trendAnalysisService` case), confirmed by an AST hash
  of the body; dead helper (0 importers resolving `.js`→`.ts`, index, subpaths); stale. Machine
  verdict: DELETE (all decorative, stale, dead helper, exact duplicate) · REWRITE (some decorative
  blocks, or self-skip / print-success alongside behavioural ones) · KEEP · ADJUDICATE (opaque or
  mixed signals). Human overlay
  `docs/development/testing-refoundation/adjudications.json` (path → verdict, criteria, blocks,
  evidence, status confirmed, reviewer, date); the status column shows machine versus confirmed.
  Outputs: `ledger.json` (deterministic, no timestamps) plus `LEDGER.md`. Modes: write · `--check`
  (exit 1 on drift) · `--area <glob>` (exact `file:line:title` list plus the expected drop).
  Acceptance: it reproduces Appendix C (105 files / 272 blocks as an upper bound, or an explained
  difference) and the whole-file list; under 60 s. CODE ~380 across 2.2a (scan + reach + JSON ~200)
  and 2.2b (duplicates, dead code, overlay, Markdown, `--area` ~180). PRs `refound/2-ledger-{a,b}`.
- **WU-2.3** Hard probe `scripts/testing/hard-probe.mjs`: one detached worktree (`git worktree add
--detach` plus `pnpm install --offline --frozen-lockfile`); subject = the test's first-party imports
  into `src/`; gutting with `ts.transform` (the body of every exported function or method →
  `throw new Error("__HARD_PROBE__")`, top level intact); runs only the block
  (`vitest run <file> -t "<title>" --reporter=json` / `--test-name-pattern`); GREEN = decorative (d) ·
  RED = restricts (weak signal) · LOAD-ERROR = inconclusive; restores (`git checkout -- .` plus an
  empty porcelain; the main tree is never touched). Output `probes.json` (`path::title` → hashes of
  the test and the subject, command, outcome, SHA). Sampling: every
  EXISTENCE-ONLY/CONDITIONAL-ONLY/TITLE-CONTRADICTION block in ADJUDICATE files plus a seeded random
  5 % of BEHAVIOURAL (false-negative rate). A class becomes a lint rule when ≥ 90 % of its probes are
  GREEN. CODE ~200. PR `refound/2-probe`.
- **WU-2.4** Durable form: ESLint rules plus bulk suppressions. `eslint.config.ts` (new blocks after
  the tests override ~:410-425), catalog `@vitest/eslint-plugin`, generated
  `eslint-suppressions.json`. Only files collected by vitest: `vitest/expect-expect` with
  `assertFunctionNames: ["expect","expect*","assert","assert.*","expectTypeOf"]`,
  `no-conditional-expect`, `valid-expect`, `no-standalone-expect`, `no-identical-title`,
  `no-commented-out-tests`, `no-disabled-tests: error`, `no-focused-tests: error`. Both frameworks
  (`@packages/eslint-plugin-testing`): `testing/no-empty-test`,
  `testing/no-tautological-assertion`, `testing/no-existence-only-test` (calibrated classes only);
  TITLE-CONTRADICTION stays in the ledger alone. Test globs: `no-console: error` (today `off`; the
  canon already says zero `console.log`). Current violations captured with `eslint --suppress-rule`.
  Bidirectional red: (1) plant an existence block in vitest and in node:test → lint exits 1 → restore
  (`cmp`); (2) delete a suppressed block without pruning → exit 2. A fitness pin verifies each rule
  stays at `error` (the #31 B shape). CODE ~120. PR `refound/2-lint-rules`.
- **WU-2.5** List before deleting: commit `ledger.json`, `LEDGER.md`, `probes.json` and
  `adjudications.json` seeded with every ADJUDICATE row. Edward approves the unambiguous DELETE set in
  one pass, and the ADJUDICATE rows slice by slice. M6 shows machine/confirmed/total. CODE 0.
  PR `refound/2-ledger-listing`.

**2.B Demolition slices** — each one: ledger `--check` green · `eslint --prune-suppressions` ·
tracker updated (files, tests, decorative blocks deleted, expected versus real drop) · the
`decorative-demolition` marker if an api floor drops · lint 0/0, `tsc`, `format:check` · the full
vitest run of the touched packages, or `run-tests.sh` for node:test.

- **WU-2.6a** Whole files (a)(b)(d): `apps/client/tests/components/ListeningCharts.test.tsx`
  (35 lines, −2 tests) · `apps/api/tests/unit/trendAnalysisService.test.ts` (731, −45; its
  `.test-helpers.ts` is kept, 4 importers) ·
  `apps/api/tests/universal-client-dashboard.integration.test.ts` (336; #30 goes 20 → 19 in the same
  pull request) · `packages/providers/_template/tests/integration/sandbox.template.test.ts` (62; the
  fate of the `_template` package stays in SMELL-132) ·
  `apps/admin/tests/{apiClient.smoke,posts.flow}.test.ts` (59) plus removing their excludes in
  `apps/admin/vitest.config.ts:54-56`. Acceptance: vitest −47 tests, orphans −3. CODE ~6,
  EVIDENCE ~1,223. PR `refound/2-whole-files`.
- **WU-2.6b** The four `describe.todo` stubs (D3 — delete; the gap is already declared as roadmap
  §3.2.c and is counted in [§Declared gaps](#declared-gaps); afterwards every run can assert an
  absolute 0 todo and 0 skipped). Acceptance: todo 43 → 0, skipped files 4 → 0. EVIDENCE 116.
  PR `refound/2-todo-stubs`.
- **WU-2.7** Helpers, runners and dead files (0 importers re-verified): `apps/api/tests/setup/*`
  (755, imported only by each other), `coverage-utils.ts` (299), `tests/run.ts` (175),
  `run-with-coverage.ts` (440), `analytics-ml-integration.test.ts.disabled` (768),
  `threading.flow.test.ts.old` (316), `unit/helpers/InMemoryBruteForceAdapter.ts` (125),
  `PlatformContentAdapter.test-helpers.ts`, `auditService.test-helpers.ts`,
  `cqrsIntegration.test-helpers.ts`, `providers/instagram/tests/mediaProcessor.test-helpers.ts`.
  NOT here: `apps/api/scripts/seed-demo-data.ts`, `seed-large-dataset.ts` (CLI; 0 importers is normal
  → D17's product classification). CODE ~5, EVIDENCE ~3,000. PR `refound/2-dead-helpers`.
- **WU-2.8.x** Block deletion by `--area` (an emptied `describe` is removed; an emptied file is
  deleted whole; unused imports are caught by lint). 2.8.1a `rateLimitingDashboard.test.ts` (18) plus
  `logger.test.ts` (11) ~320 · 2.8.1b `auditMiddleware` (10, including :274) plus
  `webhookHandler.stats` (9, including the `>= 0` at :355/:379) plus `healthMetrics` (8 plus 9
  tautologies) ~350 · 2.8.2a/b the flat root of `apps/api/tests/unit` (196 files, alphabetical chunks
  ≤ 350; including `providerConstraintValidator`, 2 tautologies) · 2.8.3
  `{application,infrastructure,domain}` · 2.8.4 `{security,ai,webhooks,saga,auth,admin,…}` (including
  `enhancedValidator.mutations-request`, 4 tautologies) · 2.8.5 node:test
  (`syncEngine.monitoring` 5, `threading.canonical` 1, `security-endpoints` 1, the existence lines of
  `planPublication`; no batch may reach zero) · 2.8.6 packages (cloudinary 8 blocks, logger 1,
  fallback-strategies 1 tautology, the rest per ledger) · 2.8.7 client, admin, workers. Acceptance per
  slice: the real drop equals the `--area` prediction; the suppressions of the touched files are 0;
  every DELETE has a GREEN probe or Edward's confirmation. CODE 300–380 each, about 9 pull requests.
- **WU-2.9** `git mv settingsRoutes.test.ts settingsSchemas.test.ts` plus its header; "settings route
  contract untested" into [§Declared gaps](#declared-gaps) (owner: the Phase 9 queue). CODE ~6, inside
  2.8.4.
- **WU-2.10** Weak but not decorative (REWRITE): `@core/webhooks` (activate `rotateFails` and assert
  the failure), `@core/compliance` (assert values in the 2 happy paths), `@core/settings` (assert the
  exact masked shape). Acceptance: a RED probe on each. CODE ~60. PR `refound/2-rewrites`.

### Track S — Shared tooling `packages/test-utils/*`

Starts after WU-2.5; each migration waits for its package's demolition slice.

- **WU-S.1** Three packages (D6) at `@layer infrastructure`, source exports, no build:
  `@test-utils/domain` (→ `@core/domain`, `@shared/types`; in-process shapes) ·
  `@test-utils/wire` (→ `msw`, `@shared/types`; OpenAPI-typed DTOs, `CanonicalPost`, the MSW server,
  handlers, sidecar) · `@test-utils/persistence` (→ `@infra/prisma`, `vitest`, `ioredis` types; the
  Prisma double, the Redis double, seeds). `pnpm-workspace.yaml`, `tsconfig.base.json` paths
  `@test-utils/*` (the vitest alias derives itself), `.dependency-cruiser.*`. Gates: nothing under
  `**/src/**` imports `@test-utils/*`; they appear only in `devDependencies`; `@core/domain`,
  `@shared/types` and `@infra/prisma` never depend on test-utils (a turbo cycle). Red: plant
  `import { aPost } from "@test-utils/domain"` in `packages/core/posts/src/x.ts` → dependency-cruiser
  exits non-zero. CODE ~150. PR `refound/s-skeleton`.
- **WU-S.2** Canonical builders `aPost`, `aScheduledPost`, `aProject`, `aChannel`, `anAccount`:
  through `create()` only (a non-ok `Result` throws `fixture: <Aggregate>.create failed`),
  `reconstitute()` only for states unreachable by create (published, failed, soft-deleted);
  deterministic ids from a counter, a fixed clock at `2026-01-01T00:00:00Z`, no faker;
  `aProjectRepo(found?)` for the 15-plus `makeProjectRepo` copies; in wire, `aCanonicalPost` and
  `a<Thing>Dto`. Acceptance: tests proving each builder produces an aggregate with valid invariants.
  CODE ~180. PR `refound/s-builders`.
- **WU-S.3** The one Prisma double (D7): `git mv mockPrisma.ts →
@test-utils/persistence/src/prismaDouble.ts`; a generic typed registry; the admin and role resolvers
  → `presets.adminAuth`; `$transaction` in both function and array form;
  **`$queryRaw*`/`$executeRaw*` THROW** ("raw SQL is not simulated: test this path in the integration
  tier"); `asPrismaClient(double)` as the single cast point; `prismaModuleFactory(double)` plus
  `vi.hoisted` for `vi.mock("@infra/prisma")`; a codemod over the 31 importers. Acceptance: api vitest
  green; every test that turns red because of the throwing raw path was empty over raw SQL → a ledger
  row (DELETE, or move to the tier). CODE ~220 plus ~40 for the codemod. PRs
  `refound/s-prisma-double` (S.3a engine, S.3b migration).
- **WU-S.4** The one Redis double `createRedisDouble()`: a typed `Pick<Redis,…>` Map with the union of
  commands from the 7 copies (`get`, `set`, `setex`, `del`, `incr`, `expire`, `ttl` with a virtual
  clock, `hgetall`, `hset`, `keys`, `scan`); unsupported → throw; no `ioredis-mock` (TTL, Lua and
  BullMQ stay in the integration tier). Migrates: `sagaManager.test-helpers`,
  `sagaIntegration.helpers`, `ContentVersionManager.test-helpers`, `ContentSynchronizer.test-helpers`,
  `performanceMonitor.test-helpers`, `rateLimitingDashboard`, `healthRoutes`. CODE ~150 plus ~120.
  PR `refound/s-redis-double`.
- **WU-S.5** The one Fastify app builder for routes: `apps/api/tests/support/buildRouteTestApp.ts`
  (`{ routes, prisma?, auth?: {kind:"customer"|"admin"|"none", principal}, decorate? }`) which
  registers the Zod compilers, the **production `errorPlugin`**, `setupContainer({ prisma })`, and the
  auth mocks of `helpers/mockAuthMiddleware.ts`. Migrates the 28 `createTestApp` copies plus 9 users of
  `*Routes.test-helpers.ts` (3 pull requests); the 6 `admin/*Routes.test.ts` that call captured
  handlers move to `inject`. Retires `createTestContainer` (production, `setup.ts:118`). CODE ~100
  plus 3 × 300. PRs `refound/s-route-app-{1,2,3}`.
- **WU-S.6** Seeds: move `createSeedPrismaClient` (77 importers, codemod), `seedTenant` and
  `cleanupTenant` to `@test-utils/persistence/seed`; the 12 inline tenant-isolation copies use the
  canonical base ids plus named extras (`seedTrackedLinks`, `seedSink`). CODE ~120 plus 2 × 300.
  PR `refound/s-seed`.
- **WU-S.7** Name gate: `no-restricted-syntax` in test globs outside `packages/test-utils/**` over
  `^(make|build|create)(Test|Mock|Fake)?(Canonical)?(Post|Project|Channel|Account)(Aggregate|Dto|Row|Repo)?$|^seedTenant$`
  ("use @test-utils/{domain,wire,persistence}"); suppressions are the baseline; migrations per package
  (core, adapters, providers, workers, api, client), about 6 pull requests of 250–350. Red: plant
  `const makeProject = () => …` in `packages/core/campaigns/tests/unit/` → lint exits 1. CODE ~30.
  PRs `refound/s-builder-gate`, `refound/s-migrate-<pkg>`.
- **WU-S.8** Cast gate: selector
  `TSAsExpression[typeAnnotation.typeName.name="PrismaClient"][expression.type="TSAsExpression"]`
  outside `@test-utils/persistence`; baseline 35 → 0 through `asPrismaClient` or the double; the one
  production hit (`setup.ts:76`) leaves with `createTestContainer`. Red: plant a cast → lint exits 1.
  CODE ~20. Lands with S.7.

### Phase 3 — Gates that can fail (the verdict contract)

Common red method: plant the violation; run the COMPLETE step (the `run:` extracted with
`yq '.jobs.<id>.steps[] | select(.name=="…") | .run'`, or the same script command); exit non-zero;
restore byte-exact (checksum plus an empty `git status --porcelain`); re-run → exit 0. What is only
visible in CI: a draft pull request or a `workflow_dispatch` on a scratch branch, with the run URL in
the pull request and in the tracker.

- **WU-3.1** Contiguous fitness inventory (#47) and a derived count: the "Fitness summary" step
  (:1730-1741) becomes a gate — it reads the `^      - name: "#([0-9]+) ` lines of every job, and the
  sorted list must equal `seq 1 N` (no duplicates, no holes); the `# N.` headings of
  `CLAUDE.md §Automated Compliance Checks` are the same set; `CLAUDE.md:304` says
  `There are **N checks, numbered #1-#N**`; the summary prints the derived N; every `::error` is
  paired with an `exit 1`. Red: (a) rename #42 → #41 → exit 1; (b) delete the `# 5.` heading → exit 1;
  (c) change the count sentence → exit 1. CODE ~45. PR V1.
- **WU-3.2** Reporters in the config; the shard stops being blind (F-3): `packages/vitest-shared`
  exports `workspaceReporters()` = `["default", …(GITHUB_ACTIONS==="true" ? ["github-actions"] : []),
…(VITEST_SHARDED==="true" ? ["blob"] : [])]` (WU-3.8 appends the skip gate); the factory sets
  `test.reporters`; `apps/api/vitest.config.ts` uses `reporters: workspaceReporters()`; `ci.yml:189`
  drops `--reporter=blob`; `turbo.json:32-42` gains
  `passThroughEnv: ["GITHUB_ACTIONS","VITEST_SHARDED"]`. Acceptance: the shard log names the file, the
  test and the diff; the blob still lands in `.vitest-reports/` and the upload (:191-201,
  `if-no-files-found: error`) finds it. Red: a planted `expect(1).toBe(2)` and the shard's exact
  command with `VITEST_SHARDED=true` → exit 1, the log names the test, the blob exists. CODE ~30.
  PR V2.
- **WU-3.3** OpenAPI drift gets its own job (F-4): move `ci.yml:203-230` out of the `test` job into
  `openapi-drift` "OpenAPI Drift" with no `needs` and no `if` (it keeps the services:
  `generate-api-types.ts:16-18` says `createApp()` connects; the env comes from
  `test-env.sh env services` once 4b.1 lands); the context joins the ruleset. Red: on a scratch branch
  add a field to a response schema without regenerating → exit 1 with `git diff --stat`. CODE ~60.
  PR V3.
- **WU-3.4** Coverage Merge renders failures and refuses to certify a red suite (F-2): `ci.yml:232-307`
  — `if: ${{ !cancelled() }}` on the job; a step "Count shard blobs" (exactly 2 `blob-*`, otherwise
  `::error` plus exit 1); the merge unchanged (it renders every failure from the blobs); a step
  "Refuse to certify a red suite" with `if: !cancelled()`:
  `[ "${{ needs.test.result }}" = success ] || { ::error; exit 1; }`; the risen-floor step and the
  upload stay on `always()`. Acceptance: on a pull request with a red unit test, Coverage Merge RUNS,
  prints the test's name and exits 1. Red: a draft pull request with a planted failure; plus a local
  dry run of the refusal step with `needs.test.result=failure` → exit 1. Dep: WU-3.2. CODE ~30. PR V4.
- **WU-3.5** Remove "Test and Build" and the second "Security Audit" (F-1, F-5): in
  `production-ci.yml` delete :21-66 (`security-audit`) and :68-159 (`test-and-build`: on a pull
  request it duplicates Build Check; on a push it duplicates `ci.yml`, which also runs on push to
  main); delete :168 (the `needs`); rename the workflow to "Container Images". **Edward's admin step
  before merging**: remove "Test and Build" from the required list (otherwise the pull request waits
  forever for a check that does not exist). Acceptance: `required_status_checks` without "Test and
  Build"; "Security Audit" only from `ci.yml:627`. Red: rule V1 of #44 with a duplicated
  `name: Security Audit` → exit 1. CODE ~−140. PR V5.
- **WU-3.6** gitleaks scans the pull request's commits: `audit.yml:144-152` →
  `gitleaks git --config .gitleaks.toml --log-opts="${BASE}..${HEAD}" --no-banner --redact --verbose |
tee log` with `set -o pipefail`; fail-closed if "N commits scanned" is under 1 (`::error` plus
  exit 1); flags verified against the pinned v8.30.0. Red: in a throwaway clone under the scratchpad,
  commit a planted token with `--no-verify` and run the exact step with those SHAs → exit 1; run the
  OLD `protect --staged` over the same clone → exit 0 (evidence that the old gate was blind).
  CODE ~20. PR V6.
- **WU-3.7** OSV-Scanner: measure, then a real gate or removal: (a) evidence — `osv-scanner` JSON and
  `pnpm audit --json` over one commit, classifying the ~90 findings (severity, GHSA alias, present in
  the audited ignores, dev-only) → a table in the tracker; (b1) if there is at least one moderate-plus
  that `pnpm audit` does not see and nobody audited: pin the binary by sha256 (the Squawk discipline),
  an `osv-scanner.toml` with `[[IgnoredVulns]]` (id, reason, ignoreUntil) per audited finding, remove
  `set +e` and the tolerance of exit 1 (:112-119); (b2) if not: delete the job (:95-124) and remove it
  from required. Red (b1): remove an ignore → exit 1. CODE ~40 / ~−30. PRs V7a (evidence), V7b.
- **WU-3.8** A skipped vitest test fails CI: `packages/vitest-shared/src/skipGateReporter.ts`
  (`onTestRunEnd(testModules)`: with `CI === "true"` it gathers every `skipped`/`pending`/`todo` test,
  prints `file > full name` and fails the run; if vitest resets `process.exitCode`, it throws in
  `onTestRunEnd` → an unhandled error, exit 1); appended in `workspaceReporters()`; the residual #32
  text updated (runtime skips are gated in every runner; Playwright inherits the same rule in the E2E
  reconstruction). Precondition: demolition removes the 43 todos. Red:
  `it("x", (ctx) => ctx.skip())` in `packages/core/posts` → `CI=true pnpm --filter @core/posts test`
  exits non-zero naming the test. Dep: WU-3.2, Phase 2. CODE ~60. PR V8.
- **WU-3.9** #44 verdict composition, static rules (Test Contracts):
  `packages/test-contracts/src/verdict.ts` plus self-tests plus a #44 block in `CLAUDE.md`; it parses
  every workflow with `yaml` and reads `.github/rulesets/main.json`. V1: each required context is
  produced by exactly one job of a workflow that runs on `pull_request` to main (expanding
  `${{ matrix.* }}`; 0 = the pull request waits forever; more than 1 = two jobs answer for one
  context). V2: a required job has no job-level `if:`, or it is in an allowlist of expressions always
  true on a pull request (initially `github.event_name != 'schedule'`) — a required job cannot report
  "skipped" (which counts as success). V3: a required job with `needs:` has an `if:` with
  `!cancelled()`/`always()` AND a step whose `run` references `needs.<id>.result` for each needed job
  — the "no `needs:` without `if`" gate. V7: a workflow that produces a required context has no
  `paths`/`paths-ignore` on `pull_request`. Red: `name: Security Audit` in a second workflow → V1;
  delete the Integration Tests job → V1; `if: github.event_name == 'push'` on `test-packages` → V2;
  remove `!cancelled()` from Coverage Merge → V3; `paths:` on `ci.yml`'s `pull_request` → V7.
  Dep: WU-1.10, 3.4, 3.5. CODE ~330. PR V9.
- **WU-3.10** #44 operational rules and drift read from GitHub: V4 no step of a required job has
  `continue-on-error: true` unless its name ends in "(never gates)"; V5 no `|| true` on a line that
  invokes a gate tool
  (`vitest|node --test|playwright|k6|osv-scanner|gitleaks|pnpm audit|semgrep|squawk|turbo run|run-tests.sh`);
  V6 drift: `GET /repos/{repo}/rules/branches/main` (with `GITHUB_TOKEN`) must equal the committed
  ruleset (contexts plus strict), running on push to main, nightly and dispatch (not on a pull
  request: a pull request that edits the ruleset would be red until an admin applies it); a network
  failure means 3 retries and "could not measure", never a silent green. Red: (a) V4; (b) V5; (c) a
  false context in the ruleset plus V6 locally → exit 1. Dep: WU-3.9, 3.11. CODE ~150. PR V10.
- **WU-3.11** The merge-gate composition, versioned: `.github/rulesets/main.json` (target
  `refs/heads/main`; `required_status_checks` with `integration_id: 15368` per context and
  `strict_required_status_checks_policy`; `non_fast_forward`; `deletion` — mirroring the classic
  protection: no force push, no deletion, admins included, no bypass); applied with
  `gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json` and the classic
  required list cleared (Edward's admin actions, commands in the pull request); enable
  `allow_update_branch`. Composition after the reconstruction: Lint and Format Check · Test Suite
  (shard 1|2) (named reporters) · Coverage Merge (`!cancelled()`, certifying) · **OpenAPI Drift
  (new)** · Package Tests and Frontend Tests (with coverage from Phase 5) · Integration Tests · Build
  Check · Code Quality · Security Audit (one emitter) · Fitness Functions · **Test Contracts (new:
  #30, #32, #36, #37, #44, #46)** · CodeQL (one `javascript-typescript` context) · gitleaks (fixed) ·
  secretlint · dependency-cruiser · Squawk · OSV-Scanner (per WU-3.7) · **Test and Build: removed** ·
  Semgrep CE, size-limit, Dependency Consistency, Container Security ×4, lychee · E2E and k6
  (Phase 6): required once they exist and block. Acceptance: V6 green on main; the count and strict
  into the tracker. Red: V1–V7 above; blocking evidence: a draft pull request with a red required
  check shows "merging is blocked". Dep: WU-3.5, 3.3, 1.10; Edward. CODE ~80 (JSON). PR V11.
- **WU-3.12** Nightly rebuilt; one alarm per workflow; chaos folded in: in `nightly.yml` delete
  :91-95 (`build --force` is covered by `cache-divergence.yml`; `test --force` duplicates the pull
  request checks and `test` is already `cache: false`); a job `integration-reversed` (the full tier
  with `TEST_ORDER=reverse` through `test-env.sh run`); a job `alarm` (`needs`, `if: always()`,
  github-script: it looks for an open `nightly-failure` issue; on failure it comments if one exists or
  creates one; on success it closes it with the link); delete `chaos.yml` (the chaos files are in
  every pull request's tier; the reversed nightly adds the ordering dimension). One-off admin step:
  close the 31 `nightly-failure` issues citing the first green nightly after the baseline (the "Upload
  mutation reports" step no longer exists). Acceptance: the first nightly green, or red only because
  of a real test; 0 or 1 open issue. Red: dispatch on a scratch branch with a planted broken
  integration test → an issue is created; dispatch again → one comment, not a second issue; without
  the plant → the issue is closed. Dep: WU-4b.3, 1.8. CODE ~90 (net ~−60). PR V12.
- **WU-3.13** Script entrypoints cannot swallow errors (#45) plus performance verdicts (conditional on
  the k6/perf decision of Phase 6): #45 is a hard-zero grep in the dependency-free job —
  `git ls-files '*.ts' '*.mts' '*.js' | xargs rg -n '\.catch\(\s*console\.(error|log|warn)\s*\)'`
  (today 5: `postgres-stress.test.ts:621`, `generate-reports.ts:712`, `baseline-capture.ts:453`,
  `memory-leak-detector.ts:641`, `regression-detector.ts:451`); k6 (if kept):
  `performance.yml:221` `-e BASE_URL=$TEST_API_URL`; each scenario throws without `__ENV.BASE_URL`;
  mount `performance/` and `--out json=/perf/reports/k6/${SCENARIO}-results.json`; upload
  `performance/reports/`; `generate-reports.ts` exits 1 with no results; pin by digest (:207-208);
  remove `needs: db-stress` (:117). Red: a planted `.catch(console.error)` → #45 exits 1; `k6 run`
  without `BASE_URL` → exits non-zero; a report over an empty directory → exit 1. Dep: Phase 6,
  WU-4b.3. CODE ~60. PR V13.

### Phase 4b — Environment contract

Decision: **one script `scripts/test-env.sh`** that owns everything from "the services are reachable"
onward; it does NOT start Postgres or Redis anywhere — in CI the GitHub `services:` own them (with
healthchecks); locally the infrastructure LXC over Tailscale (`scripts/db-up.sh:6-14` already records
that the repository stopped running compose). The contract is about WHAT runs: image major,
extensions, identities, database name, schema, roles, processes and readiness — the preflight verifies
all of it; who started the containers does not matter. A local docker backend would introduce a second
identity Edward never uses. Three security properties: integration tests **never touch the dev
database** (the script rejects any name other than `omnipost_test`); local tests **do not share Redis
queues** with running dev workers (logical DB `/15`, fixed); tests **never talk to a dev server** that
is up (test ports = dev + 10; the script rejects an already-bound port).

- **WU-4b.1** `test-env.sh env <hermetic|services>`: a new `scripts/test-env.sh` that absorbs and
  deletes `scripts/ci-setup-test-env.sh`. Identity constants: `pgvector/pgvector:pg16`, database
  `omnipost_test`, owner `postgres`, app role `omnipost_app`, `redis:7-alpine` logical DB 15. Ports:
  API 3010, workers 3310, admin 3110, client 3210 (today `PORT=3001` is Grafana). Hermetic profile:
  the database URLs point at an unreachable `127.0.0.1:1` host, and so does the Redis URL. Services
  inputs: `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_OWNER_PASSWORD`, `OMNIPOST_APP_DB_PASSWORD`,
  `TEST_REDIS_HOST` (locally from a gitignored override file; in CI from the job's constants). It
  writes the test env file with a `# GENERATED by scripts/test-env.sh — do not edit` header, every
  key of today plus `MIGRATE_DATABASE_URL`, `TEST_API_URL`, `TEST_WORKERS_READY_URL`, `PORT=3010`,
  `METRICS_PORT=3310`; with `$GITHUB_ENV` it also exports the connection keys (the workflows stop
  repeating strings). The example file documents ONLY the required inputs. `turbo.json:34,40`:
  `TEST_DATABASE_URL` out (0 uses), `MIGRATE_DATABASE_URL` in. Replace every call to
  `ci-setup-test-env.sh` (`ci.yml:146,379,744`, nightly, chaos, performance ×2, ZAP). Acceptance: jobs
  green; the grep for the old script returns 0. Red: (a) a missing input → exit non-zero naming the
  key; (b) under hermetic, a planted package test that connects with `pg` fails in under 5 s with
  `ECONNREFUSED 127.0.0.1:1`; (c) remove a key from the example → #46 exits 1. CODE ~220. PR E1.
- **WU-4b.2** `test-env.sh db [--reset]`: preflight (reaches and authenticates owner and app role —
  `db-up.sh`'s method; `server_version_num` major 16; `vector` in `pg_available_extensions`; the name
  is `omnipost_test` or it rejects); a contamination check (rows in `_prisma_migrations` with no
  directory under `infra/prisma/migrations` → "reset required" — the 85-versus-83 case); `--reset` =
  `DROP DATABASE … WITH (FORCE)` plus `CREATE`; then `prisma migrate deploy` as owner,
  `scripts/db/enable-app-role-login.sh`, and the seed as owner (the key derived as at `ci.yml:419`).
  Every workflow's `services.postgres` → the single identity (`POSTGRES_DB: omnipost_test`); the
  `postgres:16-alpine` block of production-ci disappears with WU-3.5. It replaces the 4 hand-rolled
  sequences: `ci.yml:148-172` and :381-420, nightly :72-89, chaos :90-115, performance :82-94 and
  :162-170, ZAP :339-343. Acceptance: every job against Postgres goes through one command; "Postgres
  identities in workflows" 4 → 1. Red: (a) a dev database name → rejected; (b) a fake row in
  `_prisma_migrations` → contamination; (c) against `postgres:16-alpine` → it names `vector`;
  (d) `ALTER ROLE omnipost_app NOLOGIN` after migrate → the preflight names the role. Dep: 4b.1.
  CODE ~200. PR E2.
- **WU-4b.3** `up | serve | down | liveness | logs | run`: `up api|workers` (a background `dev:test`
  with `ENABLE_RATE_LIMITING=true` for the API and `METRICS_PORT=3310` for workers; it rejects a bound
  port; readiness with the liveness term copied from `ci.yml:461-518` — API 90 s on `/health`, workers
  120 s on `/health/ready`; PIDs and logs under `$TEST_ENV_RUN_DIR`, which is `$RUNNER_TEMP` in CI and
  a gitignored directory locally); `serve <proc>` (`exec` in the foreground, for Playwright);
  `liveness` (the semantics of `ci.yml:544-570`); `run --with api,workers -- <cmd>` (env → db → up →
  cmd → liveness → down, under a trap): THE local entrypoint, and CI uses the same one. `ci.yml`
  Integration Tests: steps :436-570 collapse to
  `bash scripts/test-env.sh run --with api,workers -- pnpm --filter @apps/api test:integration`.
  `apps/api/tests/testUtils.ts:14` reads `TEST_API_URL` and throws if it is missing (no
  `localhost:3000` default); `run-tests.sh`'s readiness reads the same variables. Acceptance:
  Integration Tests green; the grep for hardcoded dev ports under `apps/api/tests`, `performance` and
  `scripts` is empty outside `test-env.sh`; the local run on the homelab through the same command
  (evidence into the tracker). Red: (a) break the API's env → "exited during boot" in under 90 s,
  exit 1; (b) occupy 3010 → rejected; (c) kill the workers mid-run → `liveness` exits 1; (d) an empty
  `TEST_API_URL` → the live tier fails naming it. Dep: 4b.2. CODE ~360 (E3a script ~200 / E3b adoption
  ~160). PR E3.
- **WU-4b.4** Adoption in performance (`performance.yml:64-111`, :146-252), ZAP
  (`security-testing.yml:327-396`) and nightly (WU-3.12). Acceptance: no workflow boots an app process
  except through the script; the grep for inline `dev:test` in the workflow directory returns 0.
  Red: #46 with a planted inline `pnpm --filter @apps/api dev:test &` → exit 1. Dep: 4b.3. CODE ~150
  (deletions). PR E4.
- **WU-4b.5** A test-env loader that fails closed: `packages/vitest-shared/src/loadTestEnv.ts` (root
  through `findMonorepoRoot`, loads the test env file, THROWS if it is missing with "run
  `bash scripts/test-env.sh env hermetic`"); `apps/api/tests/setup-env.ts:40-51` and
  `apps/workers/tests/setup-env.ts:20-29` become one call (workers loses its `../../../` at :20);
  `apps/workers/package.json` gains the `@packages/vitest-shared` devDependency. Red: move the test
  env file away → `pnpm --filter @apps/workers test` exits non-zero with that message, not with a Zod
  error. Dep: 4b.1. CODE ~50. PR E5.
- **WU-4b.6** Playwright's `webServer` from the script (both apps):
  `apps/client/tests/e2e/config/playwright.config.ts:158-166` and
  `apps/admin/playwright.config.ts:88-95` → arrays
  `[{command: "bash scripts/test-env.sh serve api", url: TEST_API_URL+"/health"}, {… serve workers …},
{the portal dev server on 3210/3110 pointing at TEST_API_URL}]` with `reuseExistingServer: false`
  always (the `!isCI` branch goes); `baseURL` reads `TEST_CLIENT_URL`/`TEST_ADMIN_URL`, not the
  overloaded `BASE_URL`. Acceptance: `playwright test --list` unchanged. Red: with the API's env
  broken, `playwright test` fails in `webServer` before any test. Dep: 4b.3. CODE ~60. PR E6.
- **WU-4b.7** One environment identity (#46, Test Contracts):
  `packages/test-contracts/src/identity.ts` — every `services.postgres` uses
  `pgvector/pgvector:pg16`, `POSTGRES_DB=omnipost_test`, `POSTGRES_USER=postgres`; every
  `services.redis` is `redis:7-alpine`; every `postgresql://` literal in the workflow directory is the
  canonical hermetic URL read from `test-env.sh`, never retyped; no inline `dev:test` and no inline
  `--filter @apps/workers dev`; the example file's keys equal the script's required-input set. Red:
  plant `postgres:16-alpine`, then a `postgresql://test_user@…` literal, then delete a key from the
  example — each one exits 1. Dep: 4b.4, 1.10. CODE ~140. PR E7.
- **WU-4b.8** The api shards run hermetic: measure first (api vitest under hermetic, locally and on a
  draft pull request, failures listed); if 0 → `ci.yml:91-116` and :148-172 lose the services and the
  database steps in the `test` job; if N > 0 → those files are integration tests in the wrong tier →
  ledger, and this work unit waits. Red: a planted api unit test that opens Prisma fails with
  `ECONNREFUSED`. Dep: 4b.1, 3.3. CODE ~−70. PR E8.

### The node:test versus vitest experiment

- **WU-4.X1** On an unmerged branch; only the evidence merges (docs). Same commit, same environment
  (`test-env.sh run`), CI runner and homelab, 3 runs each. Runner A (the incumbent): `run-tests.sh`
  per file, TAP. Runner B: `apps/api/vitest.integration.config.ts` —
  `resolve.alias = buildWorkspaceAliases(root)` MINUS the `@infra/prisma` test-entry override (the
  real client from `tsconfig.base.json:156`); `resolve.conditions` and
  `ssr.resolve.conditions = ["development", "node"]`; `pool: "forks"`, `isolate: true`,
  `fileParallelism: false`, `maxWorkers: 1`; `testTimeout/hookTimeout: 30_000`,
  `teardownTimeout: 10_000`; projects `integration` and `live`;
  `reporters: ["default","junit","hanging-process", skipGate]`; `setupFiles: loadTestEnv`. Codemod:
  the import line only → `import { describe, it, beforeAll as before, afterAll as after, beforeEach,
afterEach } from "vitest"` (108 files with `describe`/`it`, 97 with `before`, 91 with `after`, 17
  with `beforeEach`, 9 with `afterEach`); remove `{ concurrency: 1 }`; the single `mock.` → `vi`;
  `t.skip(msg)` stays (`ctx.skip(note)`); `node:assert` unchanged. Metrics: M1 verdict parity
  (`(file, name, outcome)` identical 3 of 3); M2 runtime (median per tier and total; overhead per
  file); M3 failure naming — a set of 7 red cases (a deep `deepStrictEqual` mismatch; a throw in
  `before`; an unhandled rejection after the test; a timeout; `process.exit(1)` inside a test; an open
  handle — a Redis client never closed; `t.skip()` under CI) scored on exit non-zero / file and test
  named / diff or stack / the failure visible in the last 200 lines after 5,000 lines of green output
  (28 points); M4 the force-exit equivalent (files that hang without `--test-force-exit` versus
  `hanging-process` plus fork termination); M5 the skip/cancel/zero guards without a text parser, and
  the lines needed; M6 migration cost (files by codemod, by hand, assertions changed = 0); M7 coverage
  (v8 over the tier, mergeable with the unit blobs, versus
  `--experimental-test-coverage`); M8 flakiness (10 nightly repetitions per runner); M9 peak RSS
  (`/usr/bin/time -v`). Acceptance: the complete table in this document with URLs and the codemod's
  diff stats. CODE 0 merged (~250 on the branch). PR X1.
- **WU-4.X2** Decision rule (applied to the table; it is not the decision): hard criteria for vitest
  (all of them): H1 parity 100 % 3 of 3; H2 every M3 red case exits non-zero under B; H3 M5
  expressible through config plus a reporter in ≤ 60 lines; H4 M6 with no assertion changes and no
  workaround (no mock, alias or stub added so that Prisma or the saga engine can run under vite —
  that fails H4 by the no-patches rule); H5 CI runtime ≤ 1.25× node:test and inside 15 minutes. Soft:
  the M3 score, M7, M8 no worse, M9 inside the runner's memory. If H1–H5 hold → consolidate on vitest
  (node:test sees no class vitest does not); if a hard criterion fails → keep node:test and write the
  failed criterion as the class only it sees; if only H5 fails while everything else is better → to
  Edward with the numbers. The migration, if chosen, is work of the integration tier with X1's codemod.
  Dep: WU-1.8, 4b.3, 3.8.

### Phase 4 — The integration tier as the model

- **WU-4.1a/b** Availability is a precondition, never a skip: replace `skipIfApiUnavailable`
  (`tests/testUtils.ts:40`), the local `skipIfUnavailable` helpers and `skipIfWorkerUnavailable` with
  `assertApiAvailable()`/`assertWorkersAvailable()` in `before`, which THROW with the start command
  (the pattern of `inboxRoutes.test.ts:66`). a (live): `providerRegistry` 37,
  `production.integration` 27, `multiproject.flow` 21. b: `linkRoutes` 12, `crisisRoutes` 10,
  `security-endpoints` 11, `adapters` 8, `syncEngine.{monitoring 11, init 10, sync 9, conflicts 6,
helpers 1}`; then delete the helper from `testUtils.ts`. Acceptance: the grep for `t.skip(` and the
  `skipIf*Unavailable` helpers under `apps/api/tests` returns 0 → #32 can make runtime `t.skip(`
  hard-zero. CODE ~200 each. PRs `refound/4-preconditions-{a,b}`.
- **WU-4.2** `trendRadarRoutes.test.ts`: `dayKey: <fetchedAt>.toISOString().slice(0,10)` in the 3
  `trendRadarResult.create` calls (:100, :117, :134), matching the semantics of
  `DispatchDetectTrendsUseCase.ts:61` and `@@unique([accountId, dayKey, topic])`. Acceptance: 5 of 5
  alone and in the batch. CODE ~6. Lands with 4.6.
- **WU-4.3** Rewrite `production.integration.test.ts`: delete "Test Summary" (:686-696, an
  unconditional PASSED), "Client Interface Verification" (:528-539, a duplicated health check) and
  "should simulate media upload" (:445-456, where the title and the assertion contradict each other);
  delete-post asserts exactly `403` plus the domain code (not `200 || 403`); quota: an account with a
  known subscription and an exact `maxProjects`; out with the ~40 `console.log` calls; the
  preconditions of 4.1. Acceptance: the batch green; a RED probe over the account-creation route.
  CODE ~120. PR `refound/4-production-rewrite`.
- **WU-4.4** F-6 as a class (D-topology plus precondition): (a) CI runs `TIER=pr-integration`
  (DB-only) BEFORE booting API and workers, then boots them and runs `TIER=live-integration` (live
  batches only); `run-tests.sh` gains the `live-integration` case and
  `runTestsGate.behavior.test.ts` its cases; (b) `bulkScheduleHarness.makeRelay` calls
  `assertNoForeignRelay()` (it probes `getBaseUrl()/health`; if the API answers it fails in under 2 s
  naming `src/index.ts:866` and `OutboxClaimService.ts:90-98`); (c)
  `OutboxRelay.integration.test.ts` keeps its sentinel for local runs. Rejected: the sentinel (it does
  not reach rows written by the use case), shutting the relay off (a test switch in the production
  boot; the live flows need it), asserting through the real relay (it moves a DB-only subject into a
  tier where the workers also consume: a second race). Acceptance: 10 consecutive CI runs with 0
  outbox failures, run ids in the tracker. Red: `integration:outbox` with the API up → exits non-zero
  in under 2 s naming the cause → API down → green. Dep: the environment contract. CODE ~60.
  PR `refound/4-outbox-topology`.
- **WU-4.5** The 10 dark DB-only suites enter by convention (the batches disappear in WU-1.7, so there
  is no "which batch"): WU-1.5 renames them by measured tier (`auditActorPolymorphism`,
  `mentionIngest`, `shareOfVoice`, `data-retention`, `bulkScheduleRelayRetry`,
  `bulkScheduleMediaPath`, `bulkScheduleReconciliation`, `customerLoginMfa`, `mfaTotpSingleUse`,
  `redisTokenBucketRateLimiter` → `.integration.test.ts`) and the collector takes them on its own; the
  three bulkSchedule suites leave quarantine ONLY after WU-4.4; any timeouts they need go in the file
  (WU-1.4). Acceptance: the quarantine loses 10 entries; TIER with skip 0 / cancel 0. CODE ~10.
  PR `refound/4-unquarantine-db`.
- **WU-4.6** The 9 live suites enter the same way (`inboxRoutes`, `trendRadarRoutes` after 4.2,
  `aiLocalizedRoutes`, `repurposeRoutes`, `analyticsStreamRoutes`, `analyticsPremiumRoutes`,
  `sendReplyGuardrail`, `mfaCustomer`, `customerLoginMfaE2e` → `.live.test.ts`); the order comes from
  `LC_ALL=C sort` and the per-file readiness probe (WU-1.8) replaces the ordering dependency on
  `integration:flows` — if the rate-limit window is contaminated, the file that contaminates it
  restores it (the WU-1.4 pattern), not the ordering. Acceptance: no api suite left in quarantine;
  per-file durations from the first run into the tracker. CODE ~10.
  PR `refound/4-unquarantine-live`.
- **WU-4.7** `tests/chaos` plus `chaos.yml` (SMELL-79): both scenarios are already in the DB-only
  tier's `chaos` batch; rename per the convention if applicable and **delete `chaos.yml`** (it re-runs
  all of `pr-integration` nightly as owner without `MIGRATE_DATABASE_URL` and opens an issue per
  failure — the F-14 class). SMELL-79 closes as "collected in every pull request by `chaos`; the
  vitest path no longer exists". CODE ~10. PR `refound/4-chaos`.
- **WU-4.8** One collector for auth/rbac/mfa/security/ratelimit → **absorbed by WU-1.3** (R3).
- **WU-4.9** Tier acceptance: two consecutive CI runs of `pr-integration` and `live-integration` with
  0 skipped / 0 cancelled / 0 failed; each suite named exactly once; #30 at 0; a tracker row with the
  run ids.

### Phase 5 — Coverage measured in all 86, with a ratchet

Decision: **literal floors in every config**, in the form
`mergeConfig(defineWorkspaceVitestConfig(dir, overrides), defineConfig({ test: { coverage: {
thresholds } } }))`, and vitest's `autoUpdate` moves them (one central ratchet JSON would lose
`autoUpdate`, would need its own rewriter and a new home for the `canon-exception` marker; #37's
scanner already reads that block; and the floors live next to the tests that measure them). The
formula `ratchetFloor = (n) => (Math.floor(n*10) - 1) / 10` moves from
`apps/api/vitest.config.ts:124` into vitest-shared as the single source.

- **WU-5.1** Coverage defaults in the factory:
  `test.coverage = { provider: "v8", include: ["src/**/*.{ts,tsx}"], exclude:
["**/*.d.ts","**/*.test.*","**/__tests__/**","**/generated/**"], reporter:
["text-summary","json-summary"], reportsDirectory: "./coverage", reportOnFailure: true }` —
  disabled unless `--coverage` (a focused `vitest run <file>` never trips a floor); it exports
  `ratchetFloor` and `SHARED_COVERAGE`; admin and client (which have no `src/`) get their own includes
  (`app/**`, `components/**`, `lib/**`); `turbo.json:38-42` gives `test:coverage` `cache: false`
  (F-15); #36's `scopes.ts` gains `coverage.include`. Acceptance:
  `pnpm --filter @core/posts exec vitest run --coverage` writes `coverage/coverage-summary.json`; #36
  green over the 86 scopes. Red: (a) `@core/posts`'s coverage include → `srcz/**` → #36 exits 1;
  (b) `turbo run test:coverage` twice → the second is not "cached". Dep: WU-1.12. CODE ~70. PR C1.
- **WU-5.2** Measure before fixing floors: `ci.yml:746-754` Package Tests →
  `pnpm exec turbo run test --continue --filter=… -- --coverage` (pass-through); :769-773 Frontend
  Tests likewise; a step "Every package produced a summary" (the count of
  `**/coverage/coverage-summary.json` equals the count of vitest packages, otherwise `::error` plus
  exit 1); a table in the job summary, plus the upload. Tracker: 86 rows × 4 metrics, CI and homelab,
  plus a drift column. Acceptance: 86 of 86; the maximum local↔CI drift recorded (it decides the
  ratchet strictness). Red: a planted `coverage: { enabled: false }` in one config → exit 1. Dep: 5.1.
  CODE ~40. PR C2.
- **WU-5.3–5.6** Fix floors and repair scripts, by group: (5.3) `packages/core/*`, 26 configs;
  (5.4) the other 26 core packages plus the engine; (5.5) adapters, providers, observability,
  monitoring, api-\*, i18n, query-client (~30); (5.6) `apps/{admin,client,workers}` (api already has
  them). Per package: the `mergeConfig` shape with floors = `ratchetFloor(min(CI, local))` from C2;
  in `package.json`: add `"test:coverage": "vitest run --coverage"`, remove `test:unit:coverage` (53),
  `test:unit` (76), keep `test:unit:watch`; reach part C (WU-1.11) requires the canonical
  `test:coverage`. Acceptance: `pnpm --filter <each> test:coverage` green; in one package per group, a
  test that raises coverage by ≥ 0.2 pp makes vitest REWRITE the literals (proving `autoUpdate`
  accepts the shape). Red: delete a test file from a package in the group → `test:coverage` exits 1 on
  thresholds. Dep: 5.2. CODE ~330 each. PRs C3–C6.
- **WU-5.7** #37 over every config: `packages/test-contracts/src/floors.ts` (the `floorsOf` of
  `CLAUDE.md:1037-1114` moves there and is reused); for each config tracked in head: exactly one
  global thresholds block with 4 literals, or fail closed; the base config is found **by package
  name** through the base tree's `package.json` files (moving a directory does not reset a floor); the
  `canon-exception` marker is honoured as today; the #37 step moves to Test Contracts
  (`if: always() && github.event_name == 'pull_request'`, `FITNESS_BASE_REF` = the base sha);
  `CLAUDE.md:973-1158` rewritten. Red (the complete step against `origin/main`): (1) lower
  `@core/posts`'s `lines` by 0.1 → exit 1; (2) delete a config's thresholds block → exit 1;
  (3) duplicate a metric → exit 1; (4) `git mv packages/core/posts posts2` plus lowering a floor →
  exit 1; (5) a valid `// canon-exception: migration` on a lowered line → exit 0 with the acceptance
  logged. Dep: 5.6. CODE ~180. PR C7.
- **WU-5.8** CI enforces floors, and risen floors surface for every package: Package Tests and
  Frontend Tests call `turbo run test:coverage` (an entrypoint registered in `collectors.json`); the
  "Surface a risen coverage floor" logic (`ci.yml:264-298`) generalises to
  `git diff --name-only -- '**/vitest.config.ts'` after each coverage job; under the strict ratchet it
  goes red with "commit the new floors" and the exact diff (the pull request that moves a metric
  updates it in the same pull request), otherwise it stays a warning; api's sharded flow is unchanged
  (`VITEST_SHARDED` still neutralises the per-shard floors and Coverage Merge certifies them).
  Acceptance: a pull request that drops a package below its floor is red. Red: a draft pull request
  deleting a test → red in Package Tests; under strict, a draft pull request that raises a floor by
  ≥ 0.2 pp → red with the diff. Dep: 5.7. CODE ~50. PR C8.
- **WU-5.9** Every package is measured or listed with a reason (the denominator):
  `packages/test-contracts/src/denominator.ts` plus `untested-packages.json`
  `[{name, reason: "types-only"|"scaffold"|"pending-retirement:<ref>"|"pending-tests:<WU>", since}]`;
  `types-only` is verified (every `src` transpiles to an empty module); the list only shrinks against
  base; seeded with the 11 of F-12. Red: (a) `packages/foo/src/x.ts` with no config → exit 1; (b) add
  an entry → exit 1; (c) mark `packages/ui` as `types-only` → exit 1 (it has runtime). Dep: 5.7.
  CODE ~130. PR C9.
- **WU-5.10** The canon moves to measured floors plus ratchet (docs): `CODING_STANDARDS.md:153-161`
  and #37's wording — the 90/85/70/70/75 table becomes "the per-package floors are measured values
  with a ratchet enforced by #37; the per-layer targets are tracked in `TESTING_REFOUNDATION.md` as
  distance to target, not as a gate" (today the measured floors sit 20–40 points below the targets,
  and a target no gate can meet teaches people to ignore gates). Dep: 5.8. PR C10.

### Phase 6 — Re-found what was decorative

**6.E — E2E** (order: decisions → demolish the fiction → seed and sidecar → config → specs → CI)

- **WU-6.E1** Demolish the fiction: delete `apps/client/tests/e2e/pages/*` (5 page objects against 207
  non-existent `data-testid` attributes), `utils/{assertions,helpers}.ts` (**keep `utils/a11y.ts`**,
  imported by `a11y.spec.ts:12`), `fixtures/test-data.ts`, `fixtures/test-{user,admin}-auth.json` (a
  fake JWT in `localStorage`), `config/test-setup.ts`,
  `tests/{analytics,publishing,visual,auth}.spec.ts` and the 6 `visual.spec.ts-snapshots/*.png`, plus
  the `/api/test/seed` code in `global-setup.ts`; in the config: remove the `accessibility`,
  `visual-regression`, `performance`, `firefox`, `webkit`, `mobile-safari` and `tablet` projects (D13)
  and the `test:e2e:{accessibility,visual,mobile}` scripts. Result: the client E2E suite is
  `a11y.spec.ts` on chromium, 1 green test. CODE ~60. PR `refound/6-e2e-demolish`.
- **WU-6.E2** `infra/prisma/seed-e2e.ts` (D11): over the owner connection (`MIGRATE_DATABASE_URL`,
  exit non-zero if missing), idempotent upserts; it creates `e2e-customer@omnipost.test` (plus account
  and project), a Telegram channel with credentials encrypted by `ChannelCredentialsCrypto` and the
  test `PLATFORM_ENCRYPTION_KEY`, `e2e-admin@omnipost.test` with a role,
  `e2e-admin-lockout@omnipost.test`, and N perf users for k6; passwords from `E2E_*_PASSWORD`
  (synthesised by the environment script); a `seed:e2e` script that the environment contract runs after
  migrate and seed. Finding to carry forward: `seed.ts` reads only `DATABASE_URL` even though
  `prisma.config.ts` says owner. CODE ~150. PR `refound/6-seed-e2e`.
- **WU-6.E3a** Provider base-URL seam (production, D12): the Telegram `apiClient` accepts a `baseUrl`
  (default `https://api.telegram.org`, a constant at `apiClient.ts:122` today); the api and workers
  composition roots pass `env.TELEGRAM_API_BASE_URL`; the env schema **rejects** it under
  `NODE_ENV=production` (a zod refine); #19 still holds (no env read inside the adapter). Red: a boot
  unit test that fails with production plus the override. CODE ~60.
- **WU-6.E3b** Fake-provider sidecar `@test-utils/wire/src/fakeProviderServer.ts`: a node HTTP server
  that converts requests into a `Request` and answers with `getResponse(handlers, request)` using the
  SAME shared Telegram handlers; `GET /__calls`, `POST /__reset`; the environment contract starts it
  before the workers. CODE ~90. PR `refound/6-provider-seam` (E3a + E3b).
- **WU-6.E4** Client Playwright config: projects `setup` (login through the UI →
  `test-results/.auth/customer.json`, gitignored) and `chromium` (`dependencies: ["setup"]`);
  `webServer` delegates to the environment script (the same command locally and in CI);
  `retries: isCI ? 1 : 0` plus `failOnFlakyTests: true` (D14); `forbidOnly: isCI`; trace
  `retain-on-failure`; reporters html, junit, list, github; `locale: en-US` plus a `t(key)` helper over
  `apps/client/messages/en.json` for accessible names. CODE ~120. PR `refound/6-e2e-config`.
- **WU-6.E5a** First green specs: `auth.spec.ts` (valid login → the dashboard heading; a wrong password
  → a localised `role=alert`; logout clears the session) · `posts.spec.ts` (a draft through the editor
  with `textbox`, the channel selector, "Save draft" → the list shows Draft). CODE ~150.
- **WU-6.E5b** `publish-now.spec.ts`: a seeded draft → "Publish now"
  (`app/[locale]/dashboard/posts/[id]/page.tsx:418`) → the UI shows Published and the sidecar's
  `/__calls` holds exactly one `sendMessage` with the body; `a11y.spec.ts` gains the dashboard
  (serious plus critical = 0; if it is red, that is a component finding). Bidirectional red: the
  sidecar answers 500 → the spec goes red → restore. CODE ~110. PRs `refound/6-e2e-specs-{a,b}`.
- **WU-6.E6** Admin: a `test:e2e` script; a config with `setup` plus `chromium` and `webServer` through
  the environment script; delete `resetTestAdmin` (`helpers.ts:30-52`); `loginAs` throws instead of
  returning false; `LoginPage.ts:33` `[data-testid="login-error"]` → `getByRole("alert")`; credentials
  from the seeded env. Acceptance: re-measure the 37; the 21 seed failures must disappear; every
  remaining failure classified (product defect → finding; test defect → fix; decorative → ledger).
  CODE ~150. PR `refound/6-admin-e2e`.
- **WU-6.E7** WCAG contrast: `apps/admin/app/globals.css:100` `--accent: #3b82f6` under white text
  (3.67:1) → an accessible background for filled buttons (for example `#2563eb`, 5.17:1). Red: the
  admin a11y spec red before, green after. CODE ~5. Lands with E6.
- **WU-6.E8** CI job "E2E (chromium)": cache `~/.cache/ms-playwright` by version plus
  `playwright install --with-deps chromium`; `next build` of client and admin; the environment script's
  `up` (API, workers, client and admin under `next start`, plus the sidecar); run client and admin;
  upload `playwright-report` and `test-results` always; junit into the step summary;
  `timeout-minutes: 20`. Red: plant `await expect(page).toHaveTitle("__never__")` → the job exits 1 →
  restore. It becomes required through the gate composition. CODE ~90. PR `refound/6-e2e-ci`.
- **WU-6.E9** Turbo and scripts: admin `test:e2e` into turbo; remove unused env; script cleanup. ~15.
- **WU-6.E10** Declared gap: "Schedule → the worker publishes" is the E2E acceptance test of
  N-COR-8/9, written red-first inside that change, never skipped here.

**6.M — MSW as the only HTTP double**

- **WU-6.M1** `@test-utils/wire` core: `createTestServer`; `vitest-setup.ts`
  (`beforeAll(listen({onUnhandledRequest:"error"}))`, `afterEach(resetHandlers)`, `afterAll(close)`);
  `nodeTest.ts` with `useMswServer()` for node:test (`failedWrite.smoke.test.ts:42` has no
  `resetHandlers`); it re-exports `http`, `HttpResponse`, `delay`; move
  `providers/shared/src/test-utils/msw-helpers.ts` here and delete its subpath and the optional `msw`
  peer of `@providers/shared`. CODE ~120.
- **WU-6.M2** `setupFiles` per app plus network isolation by default (D8):
  `apps/client/lib/api/__tests__/setup.ts`, `apps/admin/tests/unit/setup.ts`,
  `apps/api/tests/setup-env.ts`, `apps/workers/tests/setup-env.ts` (`../../../` at :19 →
  `findMonorepoRoot`); `defineWorkspaceVitestConfig` gains a default `setupFiles` with MSW isolation;
  the 6 per-file `setupServer` calls become `server.use(...)`; the `bypass`
  (`useBulkScheduleParse.integration.test.tsx:56`) becomes `error` plus a handler. Red: plant
  `await fetch("https://example.com")` in any test → it fails naming the request → restore. CODE ~120.
  PR `refound/6-msw-core` (M1 + M2).
- **WU-6.M3** Shared API handlers typed by OpenAPI: move
  `apps/client/tests/mocks/handlers/{index,scheduling,notifications,trendRadar,listening}.ts` to
  `@test-utils/wire/src/handlers/api/*`, typed with `@shared/types` (contract drift then breaks in
  `tsc`). CODE ~150.
- **WU-6.M4** Fetch-stub gate: `no-restricted-syntax` in test globs over
  `CallExpression[callee.property.name="stubGlobal"][arguments.0.value="fetch"]`,
  `AssignmentExpression[left.property.name="fetch"]`,
  `CallExpression[callee.property.name="spyOn"][arguments.1.value="fetch"]`; suppressions are the
  baseline (30 AST plus 11 plus 3); a fitness pin. Red: plant `vi.stubGlobal("fetch", vi.fn())` → lint
  exits 1. CODE ~40. PR `refound/6-msw-gate` (M3 + M4).
- **WU-6.M5–M8** Migrations (each one prunes its own suppressions): M5 client (13 files, 2 pull
  requests) · M6 admin (8) · M7 api (`SettingsService`, `testUtils.publishConsumers`,
  `providerOAuth.tokenexchange`, `uploadPipeline.features`, `perplexity.init`; consolidate the
  duplicated pair `unit/infrastructure/FetchHttpClient.test.ts` and
  `unit/infrastructure/adapters/FetchHttpClient.test.ts` with `delay("infinite")` and
  `HttpResponse.error()`; `ai/msw/aiWireServer.ts` → `handlers/ai/*`; remove the `USE_REAL_ADAPTERS`
  branch of `unit/providerRegistry.test.ts:20,346`) · M8 providers (roadmap §3.2.b absorbed): handlers
  in `@test-utils/wire/src/handlers/providers/<p>.ts` for x, instagram, facebook, youtube, tiktok,
  snapchat, pinterest, linkedin, bluesky and threads (telegram re-pointed), plus crm-hubspot and
  crm-salesforce; the apiClient tests (`writeFailFast` ×7, `cacheIsolation` ×4, `mediaUpload`,
  `ThreadsAdapter`, 2 spies) move to MSW; the adapter tests with a fake apiClient stay (that is their
  boundary). Definition of done per provider: a handler per public write endpoint, an MSW test per
  write method, 0 stubs. 4 pull requests per family. 250–380 each.
- **WU-6.M9** Close: the rule's suppressions are empty; the rule goes `error` hard-zero; M13 fetch = 0.

**6.K — k6 (D11)**

- **WU-6.K1** One real scenario, the rest deleted: delete the 5 fiction scenarios, `k6/config/*.js` and
  `utils/auth-helpers.js`; write `performance/k6/api-smoke-load.k6.js` (login through the real customer
  route with the seeded perf users; list posts; create a draft; `constant-arrival-rate` 10 rps for 2
  minutes; **thresholds ARE assertions**: `http_req_failed rate<0.01`, p95 per endpoint tag).
  CODE ~120.
- **WU-6.K2** Variable and image: read `__ENV.API_BASE_URL` and **throw** if it is missing (no
  fallback); pin `grafana/k6:<version>@sha256:<digest>`; `handleSummary` writes JSON and text into
  `performance/k6/results/` (the path the upload collects); the `perf:report` family goes. CODE ~40.
- **WU-6.K3** Calibration: 10 runs against main; thresholds = the worst observed p95 × 2, into the
  tracker; they may only be tightened. CODE ~5.
- **WU-6.K4** The job: delete `db-stress` and its `needs:`; k6 runs on pull requests through the
  environment contract as a merge gate. Red: a `p(95)<1` threshold → k6 exits 99 → restore. CODE ~60.
  PRs `refound/6-k6-{a,b}`.

**6.P — `perf:db` / `perf:memory` (D10 — retire both)**

- **WU-6.P1** Retire `perf:memory` (a synthetic function that leaks memory, never the app): delete
  `performance/monitoring/memory-leak-detector.ts` and the duplicated root scripts plus
  `apps/api/package.json:50-53`.
- **WU-6.P2** Retire `perf:db` (`postgres-stress.test.ts`, 624 lines, 0 assertions, always exit 0; its
  class — database latency under concurrency through the app pool — is seen by k6 through the API; two
  tools for one class means one is redundant); also `perf:baseline`, `perf:regression`, `perf:test` and
  their files after ledger adjudication. Alternative if Edward keeps it: exit code → adapter args →
  the development condition. CODE ~20. PR `refound/6-perf-retire`.

**6.S — `security/tests` (SMELL-83, D12)**

- **WU-6.S1** Fold the cases that matter into the live tier: a new
  `apps/api/tests/integration/httpSecurityPosture.integration.test.ts` in `integration:routes`; the
  cases (measured first; a red one opens a finding with an owner, and is never committed skipped):
  (1) a JWT with an altered signature → 401; (2) `alg:none`, malformed, expired → 401; (3) prototype
  pollution (`__proto__`, `constructor.prototype`) on a write route → 400 or stripped, with no leak;
  (4) **SSRF** in the external-notification sink URLs (127.0.0.1, 169.254.169.254, 10/8, `[::1]`) →
  rejection (**red expected**); (5) `nosniff`, frame protection, no `X-Powered-By` (only what
  `tests/security.test.ts` does not already assert); (6) no stack and no internals on 404/500; (7) the
  login returns no hash, no secrets and no MFA material, and does not echo the password; (8) CORS: an
  unknown origin is not reflected with credentials, and the preflight is rejected; (9) a NoSQL operator
  in the login body → 400, not 500; (10) an oversized body → 413 (plus rewriting the permissive case in
  `security-endpoints`); (11) a dangerous file type on the real upload route → rejection; (12) XXE (a
  DOCTYPE entity) on `/auth/saml/:accountId/callback` (`samlRoutes.ts:320`) → rejected without
  expanding. Rejected (no surface, or already covered): SQL injection ×6, reflected XSS ×5, LDAP ×3,
  template ×2, command ×3, path traversal ×2, response splitting ×2, "rapid requests" ×2, weak or
  hashed password ×3, invalid reset token, api-version header, JSON validation ×2, malformed JSON.
  CODE ~300.
- **WU-6.S2** Delete the suite: `security/tests/*` (7 suites, helpers, a README outside `docs/`) and
  any root script; SMELL-83 closes naming where each case went. CODE ~5, EVIDENCE ~2,800.
  PRs `refound/6-security-{fold,delete}`.

**6.N — New coverage: what has no tests today** (signed 2026-09-27: the workstream does not end at
honest infrastructure plus declared gaps; the gaps get filled). Principle: every new test proves in
both directions (the hard probe is its acceptance: RED with the subject gutted), uses `@test-utils/*`
and MSW, and raises the package's literal floor in the same pull request (`autoUpdate`). No new test
before the infrastructure can measure it (Phases 1–5).

- **WU-6.N0** Measured prioritisation (evidence → tracker): cross C2 (coverage per package × 4) with
  density (core: 488 sources / 72 tests; `core/domain` 183/4, `inbox` 20/1, `ai` 13/1, `auth` 11/1,
  `custom-reports` 11/1, `approvals` 10/1, `assets` 10/1; the 11 packages with no test: `ui` 49
  components, `ports` 24, `shared` 17, `health-checks` 10, `infra/prisma` 7, `opentelemetry` 4, 3
  storage adapters, `vitest-shared`; the untested api routes — the master plan's N-CI-2 counts 36 route
  files) and with risk (the security canon: `infra/prisma/src/extensions/{tenantGuard,tenantGuc}`,
  `core/customer-auth`, `core/auth`, `core/apiKeys`, the api auth/mfa/admin routes; the publishing
  core: the `Post`/`Channel`/`Account`/`Project` aggregates, `core/posts`, `core/channels`, outbox,
  saga; `core/billing`). Output: an ordered table in the tracker with, per package, the current floor →
  target (the canon's direction: domain 90 / application 85 / infrastructure 70, adjusted to what the
  package can measure) and the gap in unexecuted files and functions (from `coverage-final.json`). The
  3 storage adapters and `_template` need an adjudication (does anything import them?) before a test is
  written for them. CODE ~0 (evidence). PR `refound/6n-order`.
- **WU-6.N1** Security first: `infra/prisma/src/extensions/*` (tenant guard: `accountId` injection for
  an enrolled model and NO injection for a denylisted one; GUC binding inside the transaction;
  `withSystemContext`), `core/customer-auth`, `core/auth`, `core/apiKeys`, and the untested api
  auth/mfa/admin routes (through `buildRouteTestApp` plus `inject`, both directions: 401/403 and the
  happy path with the body asserted). Slices ≤ 400 CODE; each slice raises the package's floor.
  Definition of done: the floor is at or above target, or the gap is declared with a reason. PRs
  `refound/6n-security-<n>`.
- **WU-6.N2** The publishing core: `packages/core/domain` (aggregates: every invariant is a test that
  fails when it is violated and passes when it is met; value objects; domain events with `aggregateId`
  and `occurredAt`; `reconstitute` of terminal states), `core/posts`, `core/channels`, outbox
  (`OutboxClaimService`: the claim SQL in the integration tier — `publishedAt IS NULL AND retryCount <
maxRetries AND nextRetryAt <= now AND lease`), saga (compensation in reverse order, pre-pivot only;
  terminal sagas do not re-execute). Several slices; `core/domain` is the largest. PRs
  `refound/6n-publishing-<n>`.
- **WU-6.N3** `core/billing` and the 39 single-test contexts: per use case, every branch of the
  `Result` (validation, not-found, conflict, persistence failure — the branch missing in webhooks
  today) and the happy path with VALUES asserted, not just `ok`. One package per pull request (or two
  small ones). PRs `refound/6n-core-<pkg>`.
- **WU-6.N4** The untested api routes (the 36): `buildRouteTestApp` plus `inject`; the full contract
  per route: auth required, Zod validation (400 with the detail), the success body asserted, and the
  domain-error-to-HTTP mapping (the production `errorPlugin`). PRs `refound/6n-routes-<area>`.
- **WU-6.N5** Packages with no config: `packages/shared` (errors, `Result`,
  `channelCredentialsCrypto`: encrypt → decrypt → equal, wrong key → fails), `health-checks`,
  `opentelemetry`, `ports` (only what has runtime: helpers; the pure interfaces go into
  `untested-packages.json` as verified `types-only`), `vitest-shared` (the factory and `loadTestEnv`
  are already born with tests in 4b.5 and 5.1), `packages/ui` (49 components: React Testing Library —
  render by props, interaction, state, and axe accessibility on the ones that open dialogs or menus;
  vitest config plus jsdom from the factory). PRs `refound/6n-<pkg>`.
- **WU-6.N6** Portals and workers: untested hooks and components of `apps/client` and `apps/admin`
  (MSW through `@test-utils/wire`), and `apps/workers` (today's 17 of 125 against its surface: the
  publish worker, mention ingest, the recorder). PRs `refound/6n-<app>-<n>`.
- **Acceptance of 6.N**: every package of N0's order is at or above its target floor, or in
  [§Declared gaps](#declared-gaps) with a reason; 0 blocks of a decorative class in what is new (the
  2.4 rules guarantee it); metric M16 into the tracker (packages at target / total; the total gap in
  unexecuted functions). Size: a coarse estimate of 150–250 new test files → 40–70 pull requests; the
  real figure is fixed by N0. Parallelism: one writer per package in isolated worktrees (D19); git
  stays exclusive to the orchestrator.

### Phase 7 — Mutation testing returns, with a purpose

Nothing is installed before the tracker shows Phase 5 closed AND 6.N with its security and publishing
packages at target — mutation over a thin base measures nothing.

- **WU-7.1** Tool choice against criteria: vitest 4 in the packages in scope; reliable or verifiable
  per-test coverage; an incremental mode; exit non-zero on `break`; `disableBail`; a report per mutant
  and per test; runtime inside the pull request budget. Candidate: StrykerJS with the vitest runner
  (the only mature option; documented limit `threads: true` → packages without native modules work,
  `apps/api` with native Prisma does not — measured crashes). Pilot in `@core/accounts`,
  `@core/projects`, `@core/customer-auth`, `@core/application`. Output: a decision row with runtime and
  confirmed survivors. CODE ~40.
- **WU-7.2** One root `stryker.config.mjs` plus `scripts/testing/mutation.mjs --package <name>` (not 65
  configs): `mutate` derived from the convention (`src/**/*.ts` minus index and type-only files);
  `disableBail: true`; `coverageAnalysis: "perTest"`; JSON and clear-text reporters. CODE ~150.
- **WU-7.3** Confirm every survivor: re-run it alone with `coverageAnalysis: "off"`
  (`--mutate path:line:col-line:col`); only confirmed survivors count (against the upstream false
  "Survived" bugs). CODE ~100.
- **WU-7.4** Floors `mutation-floors.json` per package = the measured score rounded down; a fitness pin
  in the #37 shape (they never descend). Red: lower one → exit non-zero. CODE ~80.
- **WU-7.5** Incremental in pull requests (D15): a job that computes the changed `src` files in
  packages in scope, restores main's `incrementalFile` from an artifact, runs
  `--incremental --mutate <changed>`; it blocks the merge on `break`; a weekly full run refreshes the
  base and updates ONE tracking issue. Red: delete the assertion that kills a mutant in the pilot →
  the job exits non-zero. CODE ~90.
- **WU-7.6** Feed the ledger and verify the both-directions rule: Stryker's green dry run = "it passes
  when the code complies"; a killed mutant = "it fails when the code does not"; confirmed survivors =
  behaviour left unrestricted; tests that kill 0 mutants (reliable thanks to `disableBail`) reopen
  their ledger row under (a)/(d). Tracker: score min/median/floor per package. CODE ~80.
- **WU-7.7** `apps/api`: a declared gap until upstream fork-pool support arrives (contribute it), a
  `pnpm patch`, or the command runner over slices with no native modules. The node:test tier is not
  mutable — a declared limit.

### Phase 8 — Docs and canon

Rule: the true fact stays, the stale number goes, and a blocker that disappeared is stated as gone.

- **WU-8.1a** `CODING_STANDARDS.md §Testing` part 1 (lands with WU-2.4 — a documented guarantee needs
  executable backing): replace "Three frameworks" and its four-row table with the
  **framework-per-BOUNDARY** table (pure logic → vitest `tests/unit` per package · in-process HTTP
  route → vitest plus `inject` · persistence, SQL, RLS and transactions → the node:test tier (or
  vitest, per the experiment) · process topology → the live tier · component and hook → vitest plus
  React Testing Library plus MSW · outbound HTTP → vitest plus MSW handlers · cross-process journey →
  Playwright · latency under load → k6 (a merge gate) · test quality → Stryker); add the
  both-directions rule and the (a)–(d) criterion with the hard probe; Jest: "not a framework of this
  repository; present only as a transitive of `@storybook/test-runner`; no file imports it"; replace
  the literal `makePost` example (which bypasses the aggregate) with `aPost()` from
  `@test-utils/domain`. CODE ~120.
- **WU-8.1b** With Phase 5: coverage targets → "a measured floor per package, with a ratchet, never
  descending; the per-layer numbers are direction, not a floor"; "Running Tests" points at the
  environment script. ~30.
- **WU-8.2** `docs/architecture/TESTING.md` → archive with a FROZEN header naming
  `TESTING_INFRASTRUCTURE.md` (state) plus `CODING_STANDARDS §Testing` (rules); fold forward any
  pattern that is still true first; `docs/README.md:43`.
- **WU-8.3** `chaos-testing.md` → fold it (the L1/L2/L3 taxonomy into `TESTING_INFRASTRUCTURE`, the
  scenario backlog into the Phase 9 queue, "chaos runs in every pull request in the `chaos` batch; the
  nightly was removed") and archive it; re-link from the roadmap.
- **WU-8.4** `provider-testing.md` → fold it after M8 ("Add a provider's MSW handlers" into How to
  extend; `provider-sandbox.yml`, `sandbox.test.ts` and the telegram alias are stated as gone) and
  archive it.
- **WU-8.5** `saga-test-suites.md` → keep and correct (3 suites: plus `sagaCompensationRecovery`, plus
  `sagaWaitAmplification`), linked from `TESTING_INFRASTRUCTURE`.
- **WU-8.6** `SECURITY_TESTING_FRAMEWORK.md` → keep and correct (cron 03:00; `security/tests` and the
  Custom Security Test Suite job are stated as removed, with where each case went).
- **WU-8.7** The E2E READMEs (`docs/admin/e2e/{README,FIRST_RUN_CHECKLIST,QUICKSTART}.md`,
  `docs/client/e2e/README.md`) → archive with FROZEN headers; a new "End-to-end" section in
  `TESTING_INFRASTRUCTURE` (seed, selectors, sidecar, how to run).
- **WU-8.8** `TESTING_INFRASTRUCTURE.md`: re-measure; closed F-numbers become "Decided" with their
  pull request; add it to the anti-deletion list of **fitness #24 WITHOUT an `@`-import** (D16).
- **WU-8.9** Correct the false #32 comment (`CLAUDE.md:744`, "forbidOnly in 5 of 83") in #32's own pull
  request.
- CODE ~60–150 per docs pull request; the moves are EVIDENCE. PRs `refound/8-canon`,
  `refound/8-docs-{a,b}`.

### Phase 9 — The queue: what is unwritten, measured under the new battery

N-COR-8 PR 1d/1e, the feature backlog, the "schedule → published" E2E (N-COR-8/9), the chaos scenarios
of roadmap §4.1.b/c, and the settings route-contract gap.

### Dependency order

1. Base: T.1–T.3 after the baseline merges, alongside Phase 0/1.
2. Instruments: 2.1 → 2.2a → 2.2b → 2.3 → 2.4 → 2.5 (Edward's approval) → 2.0 before the first api
   block slice.
3. Demolition: 2.6a, 2.6b, 2.7 in parallel → 2.8.1 … 2.8.7 serially inside api (the coverage floor), in
   parallel across packages → 2.9, 2.10.
4. Phase 3 in parallel with 2.8.
5. Tooling: S.1 after 2.5 → S.2–S.6 → S.7, S.8; each migration after its package's demolition slice.
6. Phase 4: 4.1a/b → 4.2, 4.3; 4.4 (needs the environment contract's phase ordering) → 4.5 → 4.6; 4.7,
   4.8 (with the gate composition); 4.9.
7. Phase 5.
8. Phase 6: M1 → M2 → M3 → M4 → M5–M8 → M9 · E1 → E2 → E3a/b (needs M1 and M8-telegram) → E4 → E5a →
   E5b → E6, E7 → E8 → E9 · K1 → K2 → K3 → K4 (needs E2's perf users and the environment contract) ·
   P1, P2 after the ledger · S1 after 4.1 and the live tier → S2.
9. Phase 7 only after Phase 5's row is ✅: 7.1 → … → 7.6; 7.7 a declared gap.
10. Phase 8: 8.1a with 2.4; 8.1b with Phase 5; the rest as each subject lands (8.4 after M8, 8.7 after
    E8).

### Global order (the two designs reconciled)

1. **Base**: merge what is open and green (Edward) → T.1–T.3 → **T.4 (toolchain to latest mature;
   re-verify the version findings before R1/C1)**.
2. **In parallel, whenever**: V1 (#47), V2 (reporters), V3 (OpenAPI Drift), V6 (gitleaks), V7a (OSV
   measurement), E1 (env), 2.1 (classifier), 2.2a/b (ledger), 2.3 (probe).
3. **Reach**: R1 → R2 → R3 → R4 → R5 → R6 → R7 (services collector; interim #30) → E2 → E3 → R8 (live)
   → R9 → R10 (Test Contracts; needs V1) → R11 → R12.
4. **Demolition**: 2.4 (lint) → 2.5 (listing and Edward's approval) → 2.0 (coverage scenario) →
   2.6a/2.6b/2.7 in parallel → 2.8.1 … 2.8.7 (serially inside api because of the coverage floor) →
   2.9, 2.10. Unblocks R13 (#32 AST) and V8 (skip gate). 8.1a lands with 2.4.
5. **Verdict**: V4 → V5 (Edward removes "Test and Build" from required) → V9 (#44) → V11 (ruleset;
   Edward) → V10 (drift) → V7b.
6. **Environment**: E4, E5, E6 → E7 (#46) → E8 (hermetic shards; needs V3).
7. **Tooling**: S.1 after 2.5 → S.2–S.6 → S.7, S.8; each migration after its package's demolition
   slice.
8. **Integration**: 4.1a/b → 4.2, 4.3 → 4.4 (F-6; needs E3) → 4.5 → 4.6 → 4.7 → 4.9; V12 (nightly)
   after E3 and R8; R14 after V12 and V5.
9. **Experiment**: X1 after R8, E3, V8 → X2.
10. **Coverage**: C1 → C2 → C3–C6 → C7 → C8 → C9 → C10 (8.1b with C10).
11. **Re-found**: M1 → M2 → M3 → M4 → M5–M8 → M9 · E1 → E2 → E3a/b (after M1 and M8-telegram) → E4 →
    E5a → E5b → E6/E7 → E8 → E9 · K1 → K2 → K3 → K4 (after E2 and the environment contract) · P1, P2
    after the ledger · S1 after 4.1 and the live tier → S2 · V13 after the k6/perf decision.
12. **New coverage**: 6.N0 after C2 → 6.N1 (security) → 6.N2 (publishing) → 6.N3–6.N6 in parallel per
    package (isolated worktrees), each slice after its package's demolition and test-utils migration.
13. **Mutation**: only with Phase 5 ✅ and 6.N1–6.N2 at target: 7.1 → … → 7.6; 7.7 a declared gap.
14. **Docs**: 8.2, 8.3, 8.5, 8.6 as each subject lands; 8.4 after M8; 8.7 after E8; 8.8 at close; 8.9
    with R13.
15. **Close**: R15 (quarantine retired) once Phases 2, 4 and 6 have emptied it.

### Residual limits

A heuristic classifier (the ledger is an upper bound; the 5 % calibration measures precision; mutation
is the answer at scale) · suppressions count per file (swapping one decorative block for another in the
same file stays green) · a RED probe is weak evidence (the setup may call the subject) · renamed and
edited duplicates escape · OpenAPI-typed MSW handlers catch type drift, not behaviour drift (that is
what integration and E2E see) · the sidecar replays OUR recorded contract with Telegram, not Telegram
(real sandboxes remain a gap) · k6 on shared runners only sees order-of-magnitude regressions · the
Stryker vitest runner is threads-only, so `apps/api` and the node:test tier stay outside mutation for
now · "schedule → published" waits for N-COR-8/9 · two nearly identical `a11y.ts` helpers (client and
admin) remain · `no-floating-promises: off` in tests contradicts "always await" (the cost of type-aware
linting is unmeasured).

---

## How to extend

### Add a work unit

1. Add its row to [§Work units](#work-units) at ⬜, in its phase, with the same id the plan uses.
2. Add it to [§Plan (fixed)](#plan-fixed) ONLY as a re-plan — that is, together with a row in
   [§Decisions log](#decisions-log) naming the fork, the options, the chosen option and the date. The
   fixed plan is not edited to match what happened.
3. If the work unit adds or modifies a gate, its pull request also adds the [§Gates](#gates) row with
   the demonstrated red, and moves M7.

### Move a metric

1. Move it in the pull request that moved it — never in a separate tracker pull request.
2. Update `Now`, fill `Moved by` with that pull request, and refresh the `As of` line in the header.
3. If the value comes from a derivation, re-run `scripts/testing/metrics.mjs --m<N>` and use its output
   verbatim. If it comes from a run, name the run id in `Re-derive with`.
4. A new metric MUST name a command that produces it. A metric with an empty `Re-derive with` is
   rejected.

### Add a metric

1. Add the derivation to `scripts/testing/metrics.mjs` with its source class (`derived`, `network`,
   `pasted`, or `unavailable` with a reason) and extend
   `apps/api/tests/unit/scripts/testingMetrics.test.ts`: the expected derived set is asserted there, so
   a derivation that silently degrades fails the test instead of going quiet.
2. Add the row here with its baseline measured at the commit that adds it.

### Declare a gap

1. Add the row to [§Declared gaps](#declared-gaps) with why not now and the owning work unit.
2. Do NOT represent it in the tree as a skipped test, a `todo`-marked test, or a test that cannot
   fail — the skip gates make that red, and that is the point.

### Re-plan

1. Write the row in [§Decisions log](#decisions-log) first: the fork, the options, the chosen option,
   who decided, the date.
2. Then edit [§Plan (fixed)](#plan-fixed) in the same pull request, so the two cannot drift.
