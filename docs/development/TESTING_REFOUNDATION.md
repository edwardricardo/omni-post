# Testing Re-foundation — Progress Tracker

**Owner:** Platform engineering
**As of:** 2026-10-09, the timing unit (`workstream/phase1-u4-timing-in-tests`, PR R4, WU-1.4)
moved the per-batch timeouts of `run-tests.sh` into the nine suites that needed them: each declares
one `TIMING = { timeout }` and passes it to every test and hook (83 tests, 26 hooks), because on
Node 24.15.0 the runner's `--test-timeout` binds each test and hook, and a `describe` option neither
raises that nor leaves the suite's total uncapped. The four `TIMEOUT=` prefixes left the runner. The
"Advanced Rate Limiting" block of `tests/security.test.ts` gained an `after()` that waits for the
full bucket the limiter announces, then for `/health` to answer 200, within that instant plus 5 s
(cap 90 s), and throws otherwise; it adds about 60 s to the `integration:flows` batch. The
full-integration tier ran 939 tests before and after, every batch with the same count, 0 skipped and
0 cancelled. It added the rate-limit window gate row, moving M7 `23/23` → `24/24`, and left M1 at
`980 + 14`: it adds no test file. Previous: the double-collection unit
(`workstream/phase1-u3-double-collection`, PR R3,
WU-1.3) removed the second collectors: `eval.yml` left (its `vitest run tests/eval` re-ran the 4 eval
files the api shards already collect), and so did the `custom-security-tests` job of
`security-testing.yml` (its `auth` and `security` files run in the `integration:flows` batch of
`run-tests.sh`, `mfa` and `rbac` in `remaining`, its 2 rate-limit files in the vitest shards). 24
subset scripts of `apps/api/package.json` left with them: 22 node:test ones that no workflow named,
`test:eval` and `test:ratelimit`. `test:auth`, `test:rbac`, `test:security` and `test:mfa` stay:
`security/scripts/security-scan.sh` and `security/scripts/vulnerability-report.ts` call them. It moved
M5's second figure `≥10` → `0`, counted by hand over every test invocation in `.github/workflows`
until the reach engine (WU-1.9) exists, and left M1 at `980 + 14` and M7 at `23/23`: it adds no test
file and no gate. Before it, the U5a measurement (Phase 1, WU-1.5's precondition) recorded the
measured tier of the 98 node:test files under `apps/api/tests` outside unit/eval in the section "U5a —
measured tier of the node:test population": integration 80, live 18, hermetic 8, 38 disagreements with
the runner's batches. It is a data section with no file and no gate, so it moved no metric (M1
`980 + 14`, M7 `23/23`); the 1.5 status row flips when U5 lands. Before it, the reserved-suffixes unit (`workstream/phase1-u2-reserved-suffixes`, PR R2,
WU-1.2) reserved the tier suffixes inside the collectors: `RESERVED_TIER_EXCLUDES` in
`packages/vitest-shared` (`*.integration.test.*`, `*.live.test.*`, `*.spec.*`, `*.k6.js`) is set by
`defineWorkspaceVitestConfig` in its 87 configs and spread by the four app configs, `apps/admin` and
`apps/client` with an explicit `include: ["**/*.test.{ts,tsx}"]`, and both Playwright configs match
`**/*.spec.ts` only. `apps/workers` gained `@packages/vitest-shared` as a devDependency to import the
list (the lockfile adds only that workspace link), and a planted `x.integration.test.ts` there is
listed with its old config and not with the new one. It added the reserved-suffixes gate row, moving
M7 `22/22` → `23/23`, and left M1 at `980 + 14`: it adds no test file, and every vitest and Playwright
list is unchanged.
Before it, the suffix unit (`workstream/phase1-u1-suffixes`, PR R1, WU-1.1) renamed the 30
vitest files carrying `.integration.test.*` (24 client, 4 provider, 2 in `apps/api/tests/unit`) to
`*.test.*`, leaving the suffix to the 20 node:test files under `apps/api/tests`, and the 6 k6 scenarios
to `*.k6.js`; it moved M1 `980 + 8` → `980 + 14` (the scenarios are test-shaped now) and left M7 at `22/22`.
Before it, the support gate unit (`workstream/support-fitness-46`, Master Plan §5.15, SUP-1)
wired fitness #46 (`pnpm check:support` in the `dependency-consistency` job of `fitness.yml`) with its
canon block in `CLAUDE.md` and added the CI red to the support gate row; it moved no metric (M1
`980 + 8`, M7 `22/22`: a modified gate, the same row).
Pending fitness reservations renumbered on 2026-10-07 after #45 and #46 landed out of the reserved
order: WU-3.9/3.10 → #47, WU-3.13 → #48, WU-4b.7 → #49 (D24 unchanged).
Before it, the support non-features unit (`workstream/support-sup1-nonfeatures`, Master Plan §5.15,
SUP-1) added the non-features generator `scripts/support/non-features.mjs`, registered in
`scripts/support/run.mjs`, with its suite `apps/api/tests/unit/scripts/supportNonFeatures.test.ts`, and
the battery step `support` (`pnpm check:support`) with its gate row; it moved M1 `979 + 8` → `980 + 8`
and M7 `21/21` → `22/22`. Before it, the support index unit (`workstream/support-sup1-index`, Master
Plan §5.15, SUP-1) added the support index generator `scripts/support/index.mjs`, its runner
`scripts/support/run.mjs` (`pnpm support:index`, `pnpm check:support`) and the template
`docs/support/_TEMPLATE.md`, with the suite `apps/api/tests/unit/scripts/supportIndex.test.ts`; it moved
M1 `978 + 8` → `979 + 8` and left M7 at `21/21`. Before it, the support front-matter library unit
(`workstream/support-sup1-lib`, Master Plan §5.15, SUP-1) added the suite of the flat front-matter
parser and the generic checks shared by the support documentation generators,
`apps/api/tests/unit/scripts/supportFrontMatter.test.ts`, with three cases added to
`legalInventoryLib.test.ts` for the inventory library's new `commands`, `heading` and `optionalNote`
options; it moved M1 `977 + 8` → `978 + 8` and left M7 at `21/21`. Before it, the legal gate unit
(`workstream/legal-l2-gate`, Master Plan §5.10, LEGAL-3) added fitness #45 (`pnpm check:legal` in the
`dependency-consistency` job of `fitness.yml`) and the battery step `legal` with their gate row; it
moved M7 `20/20` → `21/21` and no M1 (no new suite). Before it, the first six code units of the legal
facts register (`workstream/legal-l1a-lib`, `workstream/legal-l1a-generators`,
`workstream/legal-l1b-scanner`, `workstream/legal-l1b-scanners`, `workstream/legal-l1c-oauth-scopes` and
`workstream/legal-l1d-subprocessors`, Master Plan §5.10, numbers assigned at publication) added the
suites of the shared inventory library, of the `personal-data` generator, of the shared source scanner
and of the `cookies-and-storage`, `oauth-scopes` and `subprocessors` generators,
`apps/api/tests/unit/scripts/legalInventoryLib.test.ts`, `personalDataInventory.test.ts`,
`legalSourceScan.test.ts`, `cookiesAndStorageInventory.test.ts`, `oauthScopesInventory.test.ts` and
`subprocessorsInventory.test.ts`; they moved M1 `971 + 8` → `977 + 8` (one file each) and left M7 at
`20/20`. Before them, the close of Phase 0 (#449, `workstream/0-22-h-phase0-close`) under
[D51](#decisions-log) ticked the story backfill (task 0.22.3) with PR E as its first slice, named the
follow-up slices and kept slice `0.16` a dated unit for 2026-10-28 ([D46](#decisions-log)); it moved no
metric. Before it, the Storybook family's 10.6.0 → 10.6.1 hold bump (#447,
`workstream/hold-storybook-10-6-1`) moved the holds rows and the CURRENT paragraph but not this line,
and the Tailwind `@source` fix beneath PR E (#444, `workstream/tailwind-ui-source-fix`, DEF-49) moved M1
`969 + 8` → `971 + 8` with its two tests. This line moves with the last pull request that moved a row.
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
alias its slice used for review — `PR B` is the `metrics.mjs` half of `refound/0-tracker`,
`PR gate` is `refound/0-toolchain-holds-gate`, the holds-gate half of `refound/0-toolchain-holds`,
`PR 0.21` is slice `0.21` on `workstream/eslint-boundaries-policies`, which moved M1 `949 + 8` → `950 + 8`
and M7 `2/2` → `3/3` (before it, `workstream/hooks-battery-state` of `mental-map-hooks` had moved M1
`947 + 8` → `948 + 8` → `949 + 8`), `PR 0.18` is slice `0.18` `refound/0-override-bands-gate` (pull
request #326), rebased onto `0.21`, which moved M1 `950 + 8` → `951 + 8` and M7 `3/3` → `4/4`,
`PR P.1` is slice `P.1` `refound/3-fitness-inventory` (pull request #329, the plan's `PR V1`), rebased
onto `0.8`, which moved M1 `951 + 8` → `952 + 8` and M7 `4/4` → `5/5`, `PR P.2` is slice `P.2`
`refound/3-reporters` (pull request #330, the plan's `PR V2`), rebased onto `P.1`, which added three
test files (`952 + 8` → `955 + 8`) and the last vitest config (M8 `1/86` → `1/87`) and moved M7 `5/5` →
`6/6`, `PR P.4` is slice `P.4` `refound/3-gitleaks` (pull request #331, the plan's `PR V6`), rebased
onto `P.2`, which added a gate row (M7 `6/6` → `7/7`), `PR 0.13` is slice `0.13` on
`workstream/refound-0-cleanup`, stacked on the post-drain docs branch and carrying tasks 0.18.6–0.18.8 of
slice `0.18`, which added a gate row (M7 `7/7` → `8/8`), `PR 0.12` is slice `0.12` on
`workstream/refound-0-jsdom`, branched from `main` after pull request #371, which added the sanitizer
characterization test (M1 `955 + 8` → `956 + 8`), `PR #373` is pull request #373 on
`workstream/refound-drop-jq`, which moved the single-version gate to `syncpack@15.3.3` and added its
gate row (M7 `8/8` → `9/9`, [D34](#decisions-log)), `PR i-a` is slice (i-a) of the replacement plan
on `workstream/refound-dead-devdeps` ([D35](#decisions-log)), which added the bundle-analyzer test (M1
`956 + 8` → `957 + 8`), `PR iii` is slice (iii) on `workstream/refound-secretlint-13`
([D38](#decisions-log)), which added the secret-scan gate row (M7 `9/9` → `10/10`), `PR iv` is slice
(iv) on `workstream/refound-jscpd-5` ([D39](#decisions-log)), which added the duplicate-code gate row (M7
`10/10` → `11/11`), `PR iv-b` is the stale-entry gate on `workstream/refound-jscpd-stale-gate`,
stacked on slice (iv), which added the gate's suite (M1 `957 + 8` → `958 + 8`), `PR watch` is the
maturity watchlist on `workstream/refound-maturity-watchlist` ([D45](#decisions-log)), which added its
suite and its gate row (M1 `958 + 8` → `959 + 8`, M7 `11/11` → `12/12`), `PR store` is the storage
adapters change on `workstream/storage-adapters-wiring`, which added the GCS and Azure adapter suites
and vitest configs (M1 `959 + 8` → `961 + 8`, M8 `1/87` → `1/89`), `PR space` is the DigitalOcean
Spaces change on `workstream/storage-do-spaces-selection`, which added that adapter's suite and config
and moved the factory's suite (M1 `961 + 8` → `962 + 8`, M8 `1/89` → `1/90`), `PR 0.20` is slice
`0.20` on `workstream/no-unowned-handle-unref`, which created `packages/eslint-plugin-testing` with its
rule suite and vitest config (M1 `962 + 8` → `963 + 8`, M8 `1/90` → `1/91`) and, in its third pull
request on `workstream/no-unowned-handle-unref-wiring`, wired the rule into `eslint.config.ts` and added
its gate row (M7 `12/12` → `13/13`), `PR await` is the Paddle webhook fix on
`workstream/paddle-webhook-await`, which added the adapter's suite (M1 `963 + 8` → `964 + 8`), `PR envfb` is
the OAuth credentials change on `workstream/env-secret-fallbacks`, which added the credentials suite (M1
`964 + 8` → `965 + 8`), `PR envbl` is the billing half on `workstream/env-secret-fallbacks-billing`,
which added the gateway-registry suite and the fitness #15 gate row (M1 `965 + 8` → `966 + 8`, M7
`13/13` → `14/14`), `PR v` (#408) is the first pull request of item (v) of the replacement plan
([D43](#decisions-log)) on `workstream/item-v-cruiser`, which added the architecture and dedupe gate
rows (M7 `14/14` → `16/16`), `PR v-b` (#411) is its layer-rules change on `workstream/item-v-rules`, which added the
architecture ratchet suite (M1 `966 + 8` → `967 + 8`), `PR v-d` is its `LoggerPort` change in two pull
requests, `PR v-d1` (#413) on `workstream/item-v-logger-a` and `PR v-d2` (#414) on `workstream/item-v-logger-port`,
which added the port's contract suite and the `AiRequestService` suite (M1 `967 + 8` → `968 + 8` →
`969 + 8`), `PR 0.22` is slice `0.22` ([D29](#decisions-log)), whose pull request B (#428) on
`workstream/0-22-b-shared-root` added the browser-safe shared kernel's gate row (M7 `16/16` → `17/17`)
and the cache-key equivalence suite (M1 `969 + 8` → `970 + 8`) and whose pull request C (#432) on
`workstream/0-22-c-runner` added the story runner's gate row (M7 `17/17` → `18/18`) and whose pull request F (#441) on
`workstream/0-22-f-story-gate` added the story-per-component gate (M1 `968 + 8` → `969 + 8`, M7 `19/19` → `20/20`) and whose pull request E's prerequisite (#444) on `workstream/tailwind-ui-source-fix` added one Tailwind `@source` test per portal (M1 `969 + 8` → `971 + 8`), and `PR aad-1` is the first pull
request of DEF-29, the `Channel.credentials` envelope the workers could not decrypt, on
`workstream/def-29-channel-credentials-aad`, which added the shared cipher's suite and the channel
repository's decrypt-input suite (M1 `970 + 8` → `972 + 8`), and `PR dc-4a` is group (a) of
dead-code unit DC-4 on `workstream/dc-4-dead-security-modules`, which deleted the unreached
`enhancedValidator` and `credentialManager` with their four test files (M1 `972 + 8` → `968 + 8`)
and added the fitness #11 gate row (M7 `18/18` → `19/19`, after PR C's story-runner row). A `PR` followed by a
letter and a number with no dot between them — `PR R4`, `PR V6`, `PR E2`, `PR C1`, `PR X1` — is the
[§Plan (fixed)](#plan-fixed)'s own label for the pull request that
closes the work-unit bullet it ends: `R` in Phase 1, `V` in Phase 3, `E` in Phase 4b, `C` in Phase 5
and `X` in the node:test versus vitest experiment, so `PR V6` is WU-3.6, the gitleaks change. A
`Moved by` cell that names such a label resolves through that bullet.

| #   | Metric                                                            | Baseline              | Now                   | Target        | Re-derive with                                                                          | Moved by |
| --- | ----------------------------------------------------------------- | --------------------- | --------------------- | ------------- | --------------------------------------------------------------------------------------- | -------- |
| M1  | Test files (workspaces + outside)                                 | 942 + 8               | 980 + 14              | ledger-driven | `metrics.mjs --m1` (derived: `git ls-files`)                                            | PR R1    |
| M2  | Tests: vitest passed / todo · node:test (TIER) · Playwright in CI | 12,580 / 43 · 934 · 0 | 12,580 / 43 · 934 · 0 | todo 0        | `metrics.mjs --m2` (pasted: local vitest run + TIER summary, report F-report §State)    | —        |
| M3  | Decorative blocks deleted / remaining (suppressions)              | 0 / ≤272              | 0 / ≤272              | — / 0         | `metrics.mjs --m3` (`eslint-suppressions.json` per rule; absent at baseline)            | —        |
| M4  | Decorative whole files deleted                                    | 0                     | 0                     | per ledger    | `metrics.mjs --m4` (`ledger.json`; absent at baseline)                                  | —        |
| M5  | Orphan test files · files with 2 collectors                       | 23 · ≥10              | 23 · 0                | 0 · 0         | `metrics.mjs --m5` (`test-contracts reach --json`, WU-1.9; absent at baseline)          | PR R3    |
| M6  | Ledger rows: machine / confirmed / total                          | —                     | —                     | 0 / N / N     | `metrics.mjs --m6` (`ledger.json`; absent at baseline)                                  | —        |
| M7  | Gates new/modified, red proven                                    | 0/0                   | 24/24                 | n/n           | `metrics.mjs --m7` (derived: this document's [§Gates](#gates) table)                    | PR R4    |
| M8  | Packages with coverage measured · floors min/median/api           | 1/86 · —/—/56.8       | 1/91 · —/—/56.8       | all / all     | `metrics.mjs --m8` (derived: tracked `vitest.config.*` thresholds)                      | PR 0.20  |
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

**M2, and the shard nobody could read.** M2's two vitest numbers come from a runner summary, and
until slice `P.2` the sharded CI run could not produce a readable one. Its `--reporter=blob` flag
REPLACED the default reporter rather than adding to it, so a failing shard wrote a machine-readable
blob and printed no file, no test and no diff — the only way to see what broke was to download an
artifact and merge it. Reporter selection now lives in `workspaceReporters()`
(`packages/vitest-shared`) and is derived from the environment: `default` always, `github-actions`
when `GITHUB_ACTIONS` is exactly `"true"`, `blob` when `VITEST_SHARDED` is exactly `"true"`. The
counts M2 carries are unchanged by that slice; what changed is that the run which produces them can
be read at all.

**M8, and why its target names no count.** M8's denominator is the number of tracked vitest configs
that `metrics.mjs --m8` finds, not a fixed number of packages. Slice `P.2` moved it from 86 to 87,
because `packages/vitest-shared` gained a config of its own; its numerator did not move, because that
config declares no coverage block. A target written as `86/86` was therefore stale the moment a
package gained a config, so the target reads `all / all`, whatever the count is when it is met.
Closing that distance is Phase 5's work: WU-5.1 puts coverage defaults in the shared factory, and
WU-5.9 makes every package measured or listed with a reason.

### Work units

One row per work unit of [§Plan (fixed)](#plan-fixed). Status: ⬜ not started · 🔄 in progress ·
✅ done · ⛔ blocked. `Evidence` is a run id, a checksum, or the pull request's own evidence block.

**Phase 0 closed on 2026-10-06** ([D51](#decisions-log)). Its toolchain rows were done on 2026-10-04,
and item (v) of the replacement plan ([D43](#decisions-log)) was complete on 2026-10-05, in nine pull requests and a closing docs change. `PR v` (#408,
`workstream/item-v-cruiser`) moved `dependency-cruiser` to 18.4.0, made it resolve every import and put its
`no-circular` rule in place of madge; `PR v-a` (`workstream/item-v-docs`) recorded ADR-0032, ADR-0033 and
`MASTER_PLAN_ES.md` §5.12; `PR v-b` (`workstream/item-v-rules`) made the layer rules hard behind a
known-violations baseline that may only shrink, at 138 entries; `PR v-c` (`workstream/item-v-boundaries`) retired
`eslint-plugin-boundaries`; `PR v-d1` (`workstream/item-v-logger-a`) and `PR v-d2`
(`workstream/item-v-logger-port`) took `@observability/logger` out of `packages/core`, whose application services
now log through the core's `LoggerPort`; and `PR v-e1` (`workstream/item-v-cheap-repairs`), `PR v-e2`
(`workstream/item-v-cheap-queue`) and `PR v-e3` (`workstream/item-v-cheap-health`) hand the cache-stats, queue
and health routes their dependencies from the composition root, which leaves the baseline at 124 entries. Each of
the nine went through the native review, which closed the document-only `PR v-a` on its passive path, and through
the full battery on its exact sha. The docs change (`workstream/item-v-book`) books the review suggestions
(SB-059 to SB-070) and queues the defects the pull requests found outside their scope as DEF-16 to DEF-26 in
`MASTER_PLAN_ES.md` §5.11. The nine pull requests and the closing docs change merged into `main` on 2026-10-05
as #408 and #410 to #418, in the order named above, and the last left `main` at `3d295d01`. Contract slice
`0.20` closed on 2026-10-04 and slice `0.22` on 2026-10-06, in the pull requests its rows below name:
A (#425 to #427) and B (#428) on 2026-10-05, then C (#432), D (#439), F (#441), G (#443), the Tailwind
fix E needed (#444), E (#445) and the family's move to 10.6.1 (#447). Task 0.22.3, the story backfill,
is ticked with PR E as its first slice, and its follow-up slices are named rather than run inside
Phase 0: the 34 components left in `packages/ui/src/components`, then the 160 of
`apps/client/components`, then the 54 of `apps/admin/components` once the admin Storybook is
re-created, under the ratchet `pnpm check:stories` and the canon row of #443. Slice `0.16`, date-gated
to Node 26's LTS on 2026-10-28, stays a dated maintenance unit outside the close
([D46](#decisions-log), [D51](#decisions-log)).

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
| 0     | T.4(b) | `eslint-plugin-boundaries` 7.2.0 and its v7 config (SMELL-66)               | ✅     | `0.21` — branch in §Gates     | lint 0 · 0 `[boundaries]` · 35 reds     | 2026-10-02 |
| 0     | T.4(b) | tsx 4.23.15 — first done 2026-09-28, rebased 2026-10-02                     | ✅     | `0.6`                         | `refound/0-toolchain-tsx` · 10/10       | 2026-10-02 |
| 0     | T.4(b) | Playwright 1.63.0 + axe 4.13.0 — first done 2026-09-28, rebased 2026-10-02  | ✅     | `0.7`                         | `refound/0-toolchain-browser` · 37+834  | 2026-10-02 |
| 0     | T.4(b) | msw 2.15.0 · getResponse public — first done 2026-09-28, rebased 2026-10-02 | ✅     | `0.8`                         | `refound/0-toolchain-msw` · 674 green   | 2026-10-02 |
| 0     | T.4(b) | `@testing-library/react` family — first done 2026-09-28, rebased 2026-10-02 | ✅     | `0.9`                         | `refound/0-toolchain-rtl` · 541+114     | 2026-10-02 |
| 0     | T.4(b) | `@vitest/eslint-plugin` 1.6.27 — first done 2026-09-28, rebased 2026-10-02  | ✅     | `0.10`                        | `refound/0-toolchain-vitest-plugin`     | 2026-10-02 |
| 0     | T.4(d) | Storybook 10.6.0, Jest gone — first done 2026-09-29, rebased 2026-10-02     | ✅     | `0.11`                        | `refound/0-toolchain-storybook` · −195  | 2026-10-02 |
| 0     | T.4(e) | Dead `GHSA-q7cg` ignore (`joi`) — first done 2026-09-29, rebased 2026-10-02 | ✅     | `0.11`                        | `refound/0-toolchain-storybook` · 4 = 4 | 2026-10-02 |
| 0     | T.4(b) | jsdom 30.1.1 + `isomorphic-dompurify` 4.4.0 — **[H1]**, into production     | ✅     | `0.12`                        | `workstream/refound-0-jsdom` · 55 = 55  | 2026-10-02 |
| 0     | T.4(e) | The 86 dead `vite` shims                                                    | ✅     | `0.13`                        | `workstream/refound-0-cleanup` · 0 dead | 2026-10-02 |
| 0     | T.4(b) | The build six at latest mature: vite 8.3.1, turbo 2.11.4, webpack 5.111.1   | ✅     | `0.14`                        | `workstream/toolchain-build` · 15       | 2026-10-04 |
| 0     | T.4(b) | Five quality gates at latest mature; `dependency-cruiser` 18.4.0 in `PR v`  | ✅     | `0.15`                        | `toolchain-quality-gates` · 9           | 2026-10-04 |
| 0     | 0.22 A | PR A: two unused `packages/ui` hooks deleted, and the client mocks for them | ✅     | `#425` · `#426` · `#427`      | `workstream/0-22-a{1,2,3}-*`            | 2026-10-05 |
| 0     | 0.22 B | PR B: a browser-safe `@shared/types` root barrel, held by a cruiser rule    | ✅     | `#428`                        | `workstream/0-22-b-shared-root`         | 2026-10-05 |
| 0     | 0.22 C | PR C: stories run in Chromium via `@storybook/nextjs-vite`; 58 of 58 pass   | ✅     | `#432`                        | `workstream/0-22-c-runner` · 58/58      | 2026-10-06 |
| 0     | 0.22 D | PR D: the admin Storybook that never built leaves, with its webpack chain   | ✅     | `#439`                        | 0 stories · build exit 1 · removed      | 2026-10-06 |
| 0     | 0.22 F | PR F: a story per component, ratcheted at 40 / 160 / 54                     | ✅     | `#441`                        | `0-22-f-story-gate` · [§Gates](#gates)  | 2026-10-06 |
| 0     | 0.22 G | PR G: stories are part of creating UI — ADR-0035 and the canon row          | ✅     | `#443`                        | `workstream/0-22-g-stories-canon`       | 2026-10-06 |
| 0     | DEF-49 | Tailwind `@source` reaches `packages/ui` in both portals, beneath PR E      | ✅     | `#444`                        | `tailwind-ui-source-fix` · 2 tests      | 2026-10-06 |
| 0     | 0.22 E | PR E: `packages/ui` stories colocated; badge, label and avatar added        | ✅     | `#445`                        | `0-22-e-ui-stories` · 40 → 34 · 68/68   | 2026-10-06 |
| 0     | T.4(b) | Storybook family 10.6.0 → 10.6.1, the pre-registered hold bump              | ✅     | `#447`                        | `hold-storybook-10-6-1` · 77 entries    | 2026-10-06 |
| 1     | 1.1    | Free the `.integration` suffix; name the k6 scenarios                       | ✅     | `R1`                          | `workstream/phase1-u1-suffixes` · 14    | 2026-10-08 |
| 1     | 1.2    | Reserve the tier suffixes inside every collector                            | ✅     | `R2`                          | `phase1-u2-reserved-suffixes` · 126     | 2026-10-08 |
| 1     | 1.2b   | vitest resolves every workspace import to `src/`                            | ⬜     | —                             | —                                       | —          |
| 1     | 1.3    | Remove double collection and the subset entrypoints                         | 🔄     | `R3`                          | `phase1-u3-double-collection` · 8       | 2026-10-09 |
| 1     | 1.4    | Move the timing needs into the tests                                        | ✅     | `R4`                          | `phase1-u4-timing-in-tests` · 314       | 2026-10-09 |
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
| 3     | 3.1    | Fitness inventory #44 — first done 2026-09-28, rebased 2026-10-02           | ✅     | `P.1`                         | `refound/3-fitness-inventory` · 7 reds  | 2026-10-02 |
| 3     | 3.2    | Reporters in the config — first done 2026-09-28, rebased 2026-10-02         | ✅     | `P.2`                         | `refound/3-reporters` · 6 reds          | 2026-10-02 |
| 3     | 3.3    | OpenAPI drift gets its own job                                              | ⬜     | —                             | —                                       | —          |
| 3     | 3.4    | Coverage Merge renders failures and refuses to certify a red suite          | ⬜     | —                             | —                                       | —          |
| 3     | 3.5    | Remove "Test and Build" and the second "Security Audit"                     | ⬜     | —                             | —                                       | —          |
| 3     | 3.6    | gitleaks scans the PR's commits — first done 2026-09-28, rebased 2026-10-02 | ✅     | `P.4`                         | `refound/3-gitleaks` · 8 reds           | 2026-10-02 |
| 3     | 3.7(a) | OSV-Scanner finding classes — first done 2026-09-28, rebased 2026-10-02     | ✅     | `P.5`                         | `refound/3-osv-measure` · 6 = 6 · 4 = 4 | 2026-10-02 |
| 3     | 3.7(b) | OSV-Scanner: real gate, or removed                                          | ⬜     | —                             | —                                       | —          |
| 3     | 3.8    | A skipped vitest test fails CI                                              | ⬜     | —                             | —                                       | —          |
| 3     | 3.9    | #47 verdict composition, static rules                                       | ⬜     | —                             | —                                       | —          |
| 3     | 3.10   | #47 operational rules and drift read from GitHub                            | ⬜     | —                             | —                                       | —          |
| 3     | 3.11   | The merge-gate composition, versioned                                       | ⬜     | —                             | —                                       | —          |
| 3     | 3.12   | Nightly rebuilt; one alarm per workflow; chaos folded in                    | ⬜     | —                             | —                                       | —          |
| 3     | 3.13   | Script entrypoints cannot swallow errors (#48)                              | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.1   | `test-env.sh env <hermetic\|services>`                                      | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.2   | `test-env.sh db [--reset]`                                                  | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.3   | `up \| serve \| down \| liveness \| logs \| run`                            | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.4   | Adoption in performance, ZAP and nightly                                    | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.5   | A test-env loader that fails closed                                         | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.6   | Playwright `webServer` from the script, both apps                           | ⬜     | —                             | —                                       | —          |
| 4b    | 4b.7   | One environment identity (#49)                                              | ⬜     | —                             | —                                       | —          |
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

| Gate                                                                                                                               | Kind (ESLint / fitness / job)                                                                                                                                          | Red proof (command, exit, restore)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PR                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Testing toolchain holds (WU-T.4f): every lag below latest mature has a documented hold                                             | CI step in the `Dependency Consistency` job of `fitness.yml`, running `scripts/testing/holds-gate.mjs` with `::error` paired to `exit 1` (fitness #34 PAIRED)          | run block extracted from the workflow; with the vitest hold row removed from `SECURITY_CANON.md` → exit 1 naming `vitest`, `@vitest/coverage-v8`, `@vitest/ui` (installed 4.1.11, target 5.0.1); file restored, `sha256sum -c` OK; re-run → exit 0 (52 measured, 43 lags, 0 violations). **Modified 2026-09-28 by `refound/0-holds-table-fix`** — the parser now locates `Remove-when` by HEADER NAME, so the red had to be re-proven on the same complete run block: with the `tsx` row's remove-when cell BLANKED → exit 1 naming `tsx` and "carries no remove-when"; restored from a byte copy, `sha256sum -c` OK and `cmp` identical; re-run → exit 0 (52 measured, 41 lags, 0 violations)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `refound/0-toolchain-holds-gate` + `refound/0-holds-table-fix` |
| Node engines (WU-T.4c): every workspace manifest declares `engines.node` at the runtime major, and the `@types/node` pin tracks it | CI step in the `Dependency Consistency` job of `fitness.yml`, running `scripts/testing/engines-node-gate.mjs` with `::error` paired to `exit 1` (fitness #34 PAIRED)   | **Three reds, each on the COMPLETE run block** (2026-09-28): (1) `packages/api-common/package.json` stripped of its `engines` block → exit 1 naming that manifest and the canonical value; restored from a byte copy, `sha256sum -c` OK (`0c81409e…a95be`) and `cmp` identical; re-run → exit 0. (2) the root value changed to `^24` → exit 1 naming the shape rule `>=24.<minor>.<patch> <25`; restored, `sha256sum -c` OK (`a5c6842a…31523`), `cmp` identical; re-run → exit 0. (3) the catalog pin put back to `25.9.3` — the defect this slice closes → exit 1 naming the pin's major against the runtime's; restored, `sha256sum -c` OK (`d1d0af58…4572e`), `cmp` identical; re-run → exit 0. Each clean run prints `98 manifests, engines.node >=24.15.0 <25, runtime 24, @types/node 24.13.6`. The workflow file itself was never edited: the step was prepared, validated standalone (`yaml: VALID`, run block byte-identical to the proof script) and pasted by the orchestrator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `refound/0-toolchain-types-node`                               |
| Hexagonal layer policy (WU-T.4b, slice 0.21, then item (v)): the cruiser's layer rules and the suite that pins them                | `pnpm check:architecture` (the cruiser's rules + the shrink-only baseline, reds in the Architecture row); the policy pin `architecturePolicies.test.ts`                | **The policy pin, `PR v-c`** (2026-10-05): `apps/api/tests/unit/lint/architecturePolicies.test.ts`, 23 tests, loads `.dependency-cruiser.cjs` and pins what the shrink-only baseline cannot: the exact rule set, each rule's severity and anchors (`from`, `to`, `pathNot`, `dependencyTypesNot`), and the `options.exclude` scope. A weakened rule leaves a stale entry only where it has entries, so the plant takes rules with none: `workers-no-api` removed, and `core-domain-no-framework`'s `pathNot` widened with `^packages/ports/`. On the COMPLETE command `pnpm check:architecture` still exits 0 (`✔ no dependency violations found (1711 modules, 7488 dependencies cruised)`, 138 known violations ignored), while the suite exits 1 with 3 failures naming both rules: `workers-no-api is missing from the config`, `core-domain-no-framework: to`, and the rule-set check. The config went back byte-exact, its `sha256sum` matching, and the suite passes 23/23. The layer rules' own red proofs are in the Architecture row. **History**: until 2026-10-05 this row was the `boundaries/dependencies` rule of `eslint-plugin-boundaries` 7.2.0 (slice 0.21: nine probe files, 86 imports, `pnpm lint` exit 1 with 35 errors), retired in `PR v-c` with SMELL-183, together with its pinning suite `boundariesPolicies.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `workstream/eslint-boundaries-policies` · `PR v-c`             |
| Override bands (WU-T.4f): every range-scoped `overrides:` band moves with its own target                                           | CI step in the `Dependency Consistency` job of `fitness.yml`, running `scripts/testing/override-bands-gate.mjs` with `::error` paired to `exit 1` (fitness #34 PAIRED) | **Three reds, each on the COMPLETE step extracted from the workflow** (2026-09-30), every one planted on the REAL `pnpm-workspace.yaml` (`sha256sum` `9b07c6cd…04629`): (1) the `fast-uri` 3.x target raised to `3.1.9` with its band `>=3.0.0 <3.1.8` left behind — the exact shape this gate exists for → exit 1 naming the key, the bound `3.1.8`, the target `3.1.9` and the remedy `fast-uri@<3.1.9`. (2) `"gaxios@7": 7.1.5` deleted, orphaning its allowlist entry → exit 1 naming the entry and quoting the reason that now excuses nothing — the orphan-row class the holds gate still cannot see, closed here from birth. (3) this slice's own normalization regressed to `"valibot@<=1.4.1"` → exit 1 naming the inclusive bound and the canonical rewrite. After each: restored from a byte copy, `sha256sum -c` OK and `cmp` identical, `git status --porcelain` clean of it, re-run → exit 0. The clean run printed `20 range-scoped overrides measured, 0 violating`. **Re-proven on the rebase onto `0.21`** (2026-10-02), on the same complete step and the rebased manifest (`sha256sum` `28865ded…22d78`): red (1) re-planted → exit 1, `21 range-scoped overrides measured, 1 violating`, naming `fast-uri@>=3.0.0 <3.1.8 → 3.1.9`; restored from a byte copy, `sha256sum -c` OK and `cmp` identical; re-run → exit 0, `21 range-scoped overrides measured, 0 violating` — one more than before because the base split `brace-expansion@>=3.0.0 <5.0.12` into `>=3.0.0 <3.0.9` and `>=4.0.0 <5.0.12`. **Modified the same day by the review dispositions, and re-proven on the same complete step**: the manifest is now found beside the script rather than through git (run from `/tmp`, the gate measures the tree's 21 overrides and exits 0 where it used to exit 1 on `git rev-parse`), single-quoted keys are read, a prerelease target is named as such, the remedy keeps the band's lower bound, and the summary counts verdicts rather than re-reading report lines. Red (1) re-planted on the real manifest → exit 1, `21 range-scoped overrides measured, 1 violating`, remedy `fast-uri@>=3.0.0 <3.1.9` (it printed `fast-uri@<3.1.9`, which would have widened a 3.x floor to every older line); restored, `sha256sum -c` OK and `cmp` identical; re-run → exit 0. Six planted mutants of the gate (the allowlist reason dropped, each derived X-range bound shifted, the violation count frozen, the remedy's lower bounds dropped, single-quoted keys unread) each turn `apps/api/tests/unit/scripts/overrideBandsGate.test.ts` red, and the first of them stayed green under the suite as it stood before. **The gate found a live red on the untouched tree before any edit** — `"valibot@<=1.4.1": 1.4.2`, the only non-canonical band in the block — which is why this slice normalizes that key; the lockfile delta of that normalization is EXACTLY one line, the overrides mirror, with every `valibot` resolution byte-identical at `1.4.2` | `refound/0-override-bands-gate`                                |
| Fitness inventory (WU-3.1): the numbers are contiguous 1..N, workflow and canon carry the same set, and the count is derived       | CI step `#44` in the `fitness` job of `fitness.yml`, running `scripts/testing/fitness-inventory-gate.mjs` with `::error` paired to `exit 1` (fitness #34 PAIRED)       | **Seven reds on the COMPLETE step** (2026-10-02): its `run:` body extracted from the workflow with PyYAML and run with `bash -e` from the repository root, `GITHUB_STEP_SUMMARY` pointing at a scratch file, each violation planted in the REAL file (`sha256sum` `fa5f56e2…cde60` workflow, `7254952b…d65d9` canon): (1) the `#42` step renamed `#41` → exit 1 naming the duplicate `41 (lines 1466, 1656)`, the hole `#42`, and `#42` documented but unwired; (2) the `#43` step renamed `#45` → exit 1 naming the hole `#43` against a derived maximum of `#45`; (3) the `# 5.` heading deleted from `CLAUDE.md` → exit 1 naming `#5` wired but undocumented; (4) a `# 45.` block added before the closing fence → exit 1 naming `#45` documented but unwired; (5) the count sentence left at `43` → exit 1 naming the stated `43` against the derived `44`; (6) a `# 3.` shell comment inserted under a comment line of #40's block → exit 1 naming `CLAUDE.md:1369` as a comment shaped like a check heading; (7) the same comment after a blank line → exit 1 naming heading `3` declared twice (lines 328, 1370). Every red printed the `::error` annotation and wrote no job summary; after each, the file was restored from a byte copy and its `sha256sum` matched. The clean run printed `derived N=44 from 44 numbered workflow steps and 44 canon headings`, exit 0, and its summary listed the 44 checks — derived, never typed. **RED FIRST**: the replaced "Fitness summary" step, re-run against the stale-count plant, returned exit 0. Seven planted mutants of the script (duplicate steps ignored, holes counted from 2, every look-alike read as a heading, the sentence's range unchecked, `run:` bodies read as steps, the summary written over violations, duplicate headings ignored) each turn `apps/api/tests/unit/scripts/fitnessInventoryGate.test.ts` red; a first off-by-one mutant survived because it was equivalent (N is always declared), and the hole-at-`#1` case was added to kill its non-equivalent form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `refound/3-fitness-inventory`                                  |
| Named reporters (WU-3.2): reporter selection lives in the config, so a sharded run names the file, the test and the diff           | Config, not a flag: `workspaceReporters()` in `packages/vitest-shared` sets `test.reporters`; `shardReporters.test.ts` pins the api config and the shard step          | **Six reds on the rebased tree** (2026-10-02), environment from `.env.test.example` with `REDIS_URL` set to the CI service URL; every planted file restored from a byte copy, `sha256sum -c` OK. (1) The slice's own red: `expect(1).toBe(2)` planted in `apps/api/tests/unit/providerName.guard.test.ts` → `VITEST_SHARDED=true GITHUB_ACTIONS=true pnpm exec vitest run --shard=4/8 --coverage.enabled` from `apps/api` (4/8 is the shard holding that file; CI runs `--shard=<n>/2`) → **exit 1** over 74 files / 1025 tests, the console naming the FILE `tests/unit/providerName.guard.test.ts`, the TEST `isProviderName > accepts every canonical ProviderName` and the DIFF `- 2` / `+ 1`, one `::error` annotation at `line=14,column=15`, and `apps/api/.vitest-reports/blob-4-8.json` (9.4 MB) still written; restored → the same shard with `VITEST_SHARDED=true` exit 0, 1025 tests, blob written. (2) `apps/api/vitest.config.ts` naming `["default"]` itself → `apps/api/tests/unit/scripts/shardReporters.test.ts` exit 1, four of its eight cases red. (3)-(5) the same suite pointed at three planted copies of `ci.yml` — `--reporter=blob` back on the shard command, `VITEST_SHARDED` dropped from the step, the upload's `if-no-files-found: error` relaxed to `warn` → exit 1 each, naming the broken half; the real workflow was never planted. (6) a misspelled reporter name (`github-action`) in `packages/vitest-shared/src/index.ts` → `tsc --noEmit` exit 2 (TS2820), where the reviewed revision compiled the same typo with exit 0. Three mutants of `workspaceReporters` (one shared array, a later call copying an earlier result, a default argument that ignores the ambient `GITHUB_ACTIONS`) each turn `workspaceReporters.test.ts` red; the reviewed suite stayed green under the last two. Without `VITEST_SHARDED` the same shard writes no `.vitest-reports` directory and exits 1 on the coverage floors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `refound/3-reporters`                                          |
| Secret scan (WU-3.6): the scan reads the pull request's commits; git decides the range, the report and error stream the verdict    | CI step in the `gitleaks` job of `audit.yml`, running the pinned, digest-checked v8.30.0, with every `::error` paired to `exit 1` (fitness #34 PAIRED)                 | **Eight reds on the COMPLETE steps** (2026-10-02), against the PINNED v8.30.0 downloaded into the scratch directory and checked with `sha256sum -c` against the release's own checksums file (the host carries 8.30.1). The scan step's `run:` body was extracted from `audit.yml` with PyYAML and run with `bash -e` inside disposable repositories, the two commit ids supplied through the step's `env:` and `RUNNER_TEMP` set: (1) a commit adding a fake AWS access key id → exit 1, the verbose output naming the file, `Line: 1` and the commit with `Secret: REDACTED`, and the JSON report holding one finding whose `Secret` and `Match` are `REDACTED`; (2) an empty range → exit 1 `gitleaks has nothing to scan`; (3) an empty base id and (4) a base id of 39 hex digits and a `Z` → exit 1 `has no valid PR range`; (5) a well-formed base id absent from the repository → exit 1 `cannot resolve the PR range`; (6) a 4-commit range whose OLDEST commit carries the key, with the blob of a newer commit removed from the object store → exit 1 `did not complete the scan` in 3 runs of 3, where the reviewed step exited 0 all three times printing `1 commit(s) scanned … no findings`: gitleaks 8.30.0 logs the failed `git log` at ERR level, stops reading, and exits 0 with an empty report. Greens: a 5-commit range of a clean, an empty, a lock-file-only, a side and a merge commit → exit 0 (gitleaks itself counts 3, only the commits that add lines); a deletion-only range → exit 0, where the reviewed step exited 1 on `0 commits scanned.`; 75 commits of this repository's history (`dba49d7c..9b1e1b47`) under the real `.gitleaks.toml` → exit 0, report `[]`, 0 bytes on the error stream. The install step, its two paths moved into the scratch directory: the pinned digest → exit 0 and `8.30.0`; one digit of the digest changed → (7) exit 1 with nothing installed; a version with no release → (8) `curl` exit 22. Every plant lived in a disposable repository, deleted afterwards; `audit.yml` itself was never planted, and the bodies that ran are byte-identical to the landed steps (`cmp`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `refound/3-gitleaks`                                           |
| Workspace block reader (0.18.6): the engines and override-bands gates read `pnpm-workspace.yaml` mappings through one reader       | Module `scripts/testing/workspace-block-reader.mjs`, imported by the two `Dependency Consistency` steps of `fitness.yml` (engines, override bands)                     | **RED FIRST** (2026-10-02): measured before any edit, the override gate has skipped column-0 comments since it landed (`f99f2fc3`), so only the engines gate kept the `/^\S/` terminator. Three cases added to `enginesNodeGate.test.ts` — the pin after a column-0 comment inside `catalog:`, the same pin at major 25, and a decoy pin in a `catalogs:` block below — and two of them failed on `e701f8f0` (exit 1, `declares no @types/node pin`); with both gates on `readTopLevelBlock`, the two suites pass 58/58. **On the COMPLETE steps**: their `run:` bodies extracted from `fitness.yml` with PyYAML and run with `bash -e` from a scratch tree holding the two gates, the reader, `.nvmrc` and the 98 tracked manifests (the engines step reads the worktree's index through `GIT_DIR` and `GIT_WORK_TREE`, read-only), each step fed a planted copy of `pnpm-workspace.yaml`: (1) a column-0 comment above the `@types/node` pin → exit 0, `98 manifests, engines.node >=24.15.0 <25, runtime 24, @types/node 24.13.6`; (2) the same comment with the pin at `25.9.3` → exit 1 naming `25.9.3 (major 25)`, and the `::error` annotation; (3) a column-0 comment and `"planted-widget@>=3.0.0 <3.1.8": 3.1.9` appended to `overrides:` → exit 1, `22 range-scoped overrides measured, 1 violating`, naming the key, and the `::error` annotation. With the scratch copy of the reader mutated back to the `/^\S/` terminator, (1) and (2) exit 1 for the wrong reason (`declares no @types/node pin`) and (3) exits **0**, `21 range-scoped overrides measured, 0 violating` — the planted violation dropped in silence, the fail-open this row closes. The real `pnpm-workspace.yaml` was never planted (`sha256sum` `7f7443f9…b0bdcd` before and after); on it both steps exit 0, their output byte-identical to the gates on `e701f8f0`. Two mutants of the reader in the tree, each restored from a byte copy with `sha256sum -c` OK: the `/^\S/` terminator turns 3 tests red across the two suites; a reader that never leaves its block turns 12 red, the new decoy case among them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `workstream/refound-0-cleanup`                                 |
| Single-version (D34): one version per manifest-declared dependency and exact literal ranges, on `syncpack@15.3.3`                  | CI step in the `Dependency Consistency` job of `fitness.yml`, running `pnpm dlx syncpack@15.3.3 lint`; the battery runs the same line                                  | **Four reds, each exit 1 and restored byte-exact by `sha256sum`** (2026-10-03), on `syncpack@15.3.3` with the migrated `.syncpackrc.json`: (1) in `apps/api/package.json`, `"vitest": "catalog:"` → `"4.1.10"`, reported `4.1.10 → catalog:` (`DiffersToCatalog`); (2) there, `"@faker-js/faker": "10.5.0"` → `"^10.5.0"`, reported `SemverRangeMismatch`; (3) in `apps/workers/package.json`, `"cross-env": "10.0.0"` → `"9.0.0"` against `apps/api`'s `10.0.0`, reported `DiffersToHighestOrLowestSemver`; (4) red (1) again through the step's `run:` line, extracted from the workflow with python `yaml` and run under `bash -e`. Each restore matched its checksum (`ab6addb6…` for `apps/api/package.json`, `47819cf5…` for `apps/workers/package.json`). Clean tree: v12 `list-mismatches` exit 0 (524 ignored, 613 valid) and v15 `lint` exit 0 (524 `IsIgnored`, 519 `IsCatalog`, 94 `IsHighestOrLowestSemver`). A fresh `pnpm --config.cache-dir=<empty dir> dlx syncpack@15.3.3` prints no `[WARN]` line; the same run of `syncpack@12` prints the `@effect/schema@0.69.0` deprecation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `workstream/refound-drop-jq`                                   |
| Secret scan, rule-based (D38): secretlint 13.0.6 reads the file selection 12.3.1 read, in CI, lint-staged and the hook             | CI job `secretlint` in `audit.yml`, step `Run secretlint` → `pnpm secret:scan`; the same flags in lint-staged's `*` task and `.claude/hooks-py/post_edit.py`           | **On the COMPLETE step** (2026-10-03): its `run:` body extracted from `audit.yml` and run with `bash -e` exits 0 on the tree; with an AWS secret access key planted in `apps/api/src/zz-secret-scan-probe.ts` it exits 1 naming `[AWSSecretAccessKey]`; the probe deleted, a hash of `git diff` plus `git status` is identical before and after, and the step exits 0 again. The arguments it replaced exit 1 on 13.0.6 (six example connection strings in `.env.example` and `.env.test.example`). lint-staged's command: nine real files exit 0, plus a planted `[id]` file exit 1. `test_post_edit.py`: 1, 5 and 7 failures with `--no-glob` dropped, `--no-gitignore` dropped and the path escaped again, each restore matching its `sha256sum`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `workstream/refound-secretlint-13`                             |
| Duplicate code (D39): jscpd 5.4.0 fails a new clone, an empty scan and a missing baseline; the gate fails a stale entry            | CI step `Duplicate code check (jscpd)`, `code-quality` job of `ci.yml` → `pnpm check:duplicates` → `scripts/testing/jscpd-baseline-gate.mjs`; keys in `.jscpd.json`    | **Four reds and a green on the COMPLETE step** (2026-10-03): its `run:` body extracted from `ci.yml` and run with `bash -e` exits 0 on the tree, 1,012 clones, none new. (1) A file of two identical 14-line bodies planted as `apps/api/src/plantedCloneRed.ts` exits 1, the clone marked `[NEW]` and named, `ERROR: jscpd found 1 new clones not in the baseline (allowed: 0)`. (2) The same file as `apps/client/components/PlantedCloneRed.tsx` exits 1 the same way: the `.tsx` scope is live. (3) `.jscpd-baseline.json` moved away exits 1: `baseline file … not found`. (4) The same command over an empty directory exits 1, `jscpd analyzed no files (--fail-on-empty)`. After each, a hash of `git diff` plus `git status` matches the one taken before, and the baseline matches its `sha256sum`. Controls: without `failOnNewClones` red (1) exits 0, without `failOnEmpty` red (4) exits 0 with a warning, so each key does the work. The old config exits 1 on 5.3.2 (`'typescriptreact' is not a supported format`). **The stale-entry gate, on the same step** (2026-10-03, `workstream/refound-jscpd-stale-gate`): (5) a fake fingerprint added to `.jscpd-baseline.json` exits 1, `stale entry ffffffffffffffff: committed 1, current 0` and the remedy `pnpm check:duplicates:update-baseline`; (6) `apps/admin/lib/http/forwardedFor.ts`, which holds one baselined clone, moved out of the tree exits 1, `stale entry ac8f6964c6b0041a: committed 1, current 0`; red (1) still exits 1 with the clone `[NEW]`, and red (3) exits 1 naming the missing baseline before jscpd runs. The tree exits 0, and `pnpm check:duplicates:update-baseline` leaves the baseline byte-identical. Before and after each, the hash of `git diff --binary` plus `git status` and the baseline's `sha256sum` match. Six mutants of the script each turn `jscpdBaselineGate.test.ts` red; one survived first, and its test now asserts the fail-closed message. **In the battery** (2026-10-03, `workstream/refound-battery-duplicates`): the `duplicates` step of `scripts/testing/battery.sh`, run alone through the script's own `step` function and then `battery-state.mjs` with `--expected-steps 1`, exits 0 with a GREEN verdict and no warning line in its log; a copy of `computeFullJitterDelayMs` and its two constants appended to `apps/api/src/lib/retry/backoff.ts` makes it exit 1, the 24-line clone `[NEW]`, and the verdict RED, `step duplicates exit 1`. Before and after, the file's `sha256sum` and the hash of `git diff --binary` plus `git status` match                                                                                                                                                                                                                                                                                                                                                                                                 | `workstream/refound-{jscpd-{5,stale-gate},battery-duplicates}` |
| Maturity watchlist (D45): every entry well formed, milestones derived from the publish date, no review unrecorded over 3 days late | CI step in the `Dependency Consistency` job of `fitness.yml`, running `scripts/testing/maturity-watchlist.mjs --check` with `::error` paired to `exit 1`               | **Early and future-dated reviews** (2026-10-05): a review is never dated after the day the list is read, and may precede its milestone only with `early: { reason }` and by at most 2 days (Edward, 2026-10-05); the COMPLETE step's `run:` body exits 1 under the `::error` annotation with pnpm's `maturity` review planted as 2026-10-06 (`dated 2026-10-06, after today 2026-10-05`), with memfs's early review planted as 2026-10-03 (`is 3 days before 2026-10-06; an early review may be at most 2 days early`) and with its reason emptied (`has an early field without a non-empty reason`), each restored from a byte copy (`sha256sum -c` OK, `cmp` identical) and re-run at exit 0, `--check --today 2026-10-04` exits 1 on the four reviews dated 2026-10-05, and `maturityWatchlist.test.ts`, red on 14 of its 68 tests before the change, turns red under each of four mutants of the script (an early review not counted as recorded, the 2-day bound made inclusive, `--check` or `--remind` reading the UTC date instead of `--today`), each restore matching its `sha256sum`. **Overdue reviews** (2026-10-05): an unrecorded review stays due after its milestone, the reminder commenting on or reopening the same issue every day, and `--check` fails once it is more than 3 days overdue. The COMPLETE step's `run:` body, run with `bash` on the tree, exits 0 (`10 entries, all valid`); with pnpm's `maturity` review removed from `scripts/testing/maturity-watchlist.json` it exits 1 naming `pnpm@12.6.0: review maturity was due 2026-09-29, 6 days ago, and is not recorded` under the `::error` annotation, and `--check --today 2026-10-05` exits 1 with the same line; the file restored from a byte copy, `sha256sum -c` OK and `cmp` identical; both re-runs exit 0. Before the change the suite failed 19 of its 52 tests; four mutants of the script (the 3-day bound made inclusive, the issues listed since today, a reopen without its `PATCH`, an issue closed on an earlier day skipped) each turn it red, each restore matching its `sha256sum`. **On the COMPLETE step** (2026-10-03): its `run:` body, byte-identical to the step's, run with `bash` exits 0 on the tree (`6 entries, all valid`); with `ignore`'s `final` milestone planted as 2026-10-15 in `scripts/testing/maturity-watchlist.json` it exits 1 naming `ignore@7.0.12: final is 2026-10-15, derived 2026-10-16` under the `::error` annotation; the file restored from a byte copy, `sha256sum -c` OK and `cmp` identical; re-run exits 0. Before the script existed the suite failed on its import; six mutants of the script (a recorded review ignored, a derived milestone unchecked, an early review accepted, a duplicate id accepted, an impossible date accepted, `--check` passing an invalid list) each turn `maturityWatchlist.test.ts` red, each restore matching its `sha256sum`. actionlint 1.7.12 exits 0 on a workflow holding the step               | `workstream/refound-maturity-watchlist`                        |
| Unowned handle unref (0.20): no test code enumerates the process's handles or unrefs a handle it did not create                    | ESLint rule `testing/no-unowned-handle-unref` (`packages/eslint-plugin-testing`) at `error` in `eslint.config.ts`, run by `Run ESLint` (`pnpm lint`) in `ci.yml`       | **On the COMPLETE step, on the whole tree** (2026-10-04): the hunk `f987bfe1` deleted from `apps/api/tests/unit/aiOrchestrator.helpers.ts` (`unrefActiveHandles`; the planted text is the deleted lines, checked with `diff`) appended back → `pnpm lint --max-warnings 0` (the step's `eslint . --ext .ts,.tsx --max-warnings 0`, with the flag repeated) exit 1, `2 problems (2 errors, 0 warnings)`: `291:19` `_getActiveHandles` (enumeration) and `293:40` `h.unref()` (a receiver the file did not create), both `testing/no-unowned-handle-unref`. The file was restored from a byte copy, `sha256sum -c` OK (`d2b14afe…`), `git diff` empty for it, and the whole-tree lint is back to exit 0. Wired on the existing tree it reports nothing: the 14 `unref()` calls in tests each unref a handle the file created with `setTimeout`. `eslint --print-config` gives severity 2 on `apps/api/tests/setup.ts`, the helpers file, `packages/providers/shared/src/test-utils/msw-helpers.ts`, `packages/vitest-shared/src/index.ts` and `apps/client/lib/api/__tests__/setup.ts`, and none on `apps/api/src/index.ts`. The rule's own suite (67 RuleTester cases) turns red on each of 53 mutants of the rule, every one restored by `sha256sum`: 20 of the first check, 22 of the ownership check, 11 of its review fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `workstream/no-unowned-handle-unref{,-ownership,-wiring}`      |
| Secret fallbacks, typed form (fitness #15): `env.X_SECRET ?? ""` is matched as well as `process.env`; the `!env.X` guard is not    | CI step `#15` in the `fitness` job of `fitness.yml`, a `grep -rnE` with `::error` paired to `exit 1` (fitness #34 PAIRED); same regex as CLAUDE.md #15                 | **On the COMPLETE step** (2026-10-04T08:12:29Z): its `run:` body extracted from `fitness.yml` with PyYAML and run with `bash` from the worktree root exits 0 on the tree. Before and after, on the OAuth half's tree (`76963f3c`, billing not yet changed): the old regex reads 0 and the new one reads 4, the `?? ""` key and webhook-secret reads of `GatewayAdapterRegistry.ts`. With `export const probeSecret = env.PROBE_SECRET ?? "";` planted as the new file `apps/api/src/fitness15RedProbe.ts` the step exits 1, its `::error` counting 1 fallback and naming that line, while the old regex reads 0 on the same tree; probe deleted, `git status --porcelain=v1 -uall` sha256 identical to before (`5daf5e67…caecc`), re-run → exit 0. The `!env.STRIPE_SECRET_KEY` boolean guards stay unmatched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `workstream/env-secret-fallbacks-billing`                      |
| Architecture (D43, item (v)): dependency-cruiser 18.5.0 over every resolved import; `no-circular` replaces madge                   | CI step `Architecture gate (layer rules + no-circular)`, `dependency-cruiser` job of `audit.yml` → `pnpm check:architecture`; battery step `architecture`              | **Reds and a green on the COMPLETE command**: on 2026-10-07, on 18.5.0, `pnpm check:architecture` exits 0, `✔ no dependency violations found (1721 modules, 7497 dependencies cruised)`, 124 known violations ignored, 0 unresolved imports or edges into a workspace `dist/`. The plants that fire today: a two-file cycle in `apps/api/src` exits 1 on `no-circular`; `@packages/api-common` and `@adapters/cache-redis` in `packages/core/application/src/hardDeletePolicy.ts` exit 2; the D43(e) plant, `@core/accounts` in `packages/core/domain/src/repositories/AccountRepository.ts`, exits 7; a relative import of `packages/adapters/cache-redis/src/index.js` there exits 1 on `core-domain-no-framework`; a baseline short one entry exits 1 naming its rule and a stale entry exits 1, `1 stale known violations`; after each, `sha256sum` and `git status --short` match their snapshots. history: [ADR-0032 §Gate red proofs, dated](../technical/ADR-0032-architecture-gate-dependency-cruiser.md#gate-red-proofs-dated)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `workstream/item-v-cruiser` · `PR v-b` · `PR v-c`              |
| Dedupe (CI's Dependency Consistency job): `pnpm dedupe --check` fails on a flattenable duplicate in `pnpm-lock.yaml`               | CI step `Dedupe gate: pnpm dedupe --check (no flattenable duplicates)`, `Dependency Consistency` job of `fitness.yml`; battery step `dedupe`                           | **Red in CI, red and green in the battery** (2026-10-05): pull request #408 (`PR v`) went red on the COMPLETE CI step (run 37269555658): dependency-cruiser 18.4.0 brought `acorn` 8.18.0 beside 8.17.0, and the check named eight consumers to flatten (`acorn-loose`, `acorn-walk`, `espree`, `import-in-the-middle` 2.0.6 and 3.1.0, `terser` 5.48.0 and 5.51.2, `unplugin`) plus the `acorn-jsx` and `acorn-import-attributes` peer variants. `pnpm dedupe` changed `pnpm-lock.yaml` alone, and the check exits 0. **In the battery**: the `dedupe` step of `scripts/testing/battery.sh`, run alone through the script's own `step` function and then `battery-state.mjs` with `--expected-steps 1`, exits 0 with a GREEN verdict and an empty log; with the pre-dedupe lockfile written back from `HEAD` it exits 1 and the verdict is RED, `step dedupe exit 1`, the duplicates printed in its log; the deduped lockfile went back after, its `sha256sum` matching. **Why `--loglevel=error`**: the plain command exits 0 on the deduped tree but prints 7 warning lines, pnpm's deprecation notices (`eslint@9.39.5`, 28 deprecated subdependencies and others) and its peer-issues notice, which the battery reads as RED; the frozen install never resolves, so those notices never reached the battery before. At error level a failing check still prints its whole diff and exits 1, the exit code CI reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `workstream/item-v-cruiser`                                    |
| Browser-safe shared kernel (D29): `packages/shared/src` imports no Node built-in and reads no `Buffer`, its crypto module aside    | Cruiser rule `shared-root-no-node-core` in `pnpm check:architecture` (`audit.yml`, battery `architecture`); ESLint `no-restricted-globals` (`Buffer`) in `pnpm lint`   | **Two reds on the COMPLETE commands** (2026-10-05): (1) `import { randomUUID } from "node:crypto";` planted as the first line of `packages/shared/src/types.ts` → `pnpm check:architecture` exit 1, `error shared-root-no-node-core: packages/shared/src/types.ts → crypto` (1713 modules, 7481 dependencies cruised); a bare `import { createHash } from "crypto";` planted in `csv.ts` exits 1 on the same rule. (2) `const planted = Buffer.from("x");` appended to `packages/shared/src/csv.ts` → `pnpm lint --max-warnings 0` exit 1, `229:17 error Unexpected use of 'Buffer'` under `no-restricted-globals`, beside the plant's own `no-unused-vars` warning; planted as `export const`, the same line exits 1 with `1 problem (1 error, 0 warnings)`, the rule alone. After each plant, `git checkout --` restored the file, `git status --porcelain` was empty for it, `cmp` against `git show HEAD:` found it identical and `sha256sum -c` matched, and the re-run exits 0. The green tree cruises 1713 modules and 7480 dependencies with 124 known violations ignored: the baseline did not grow, and `channelCredentialsCrypto.ts`, the one source module both gates exempt, raises nothing on either. Test files are exempt in the repository's own test shape, `metrics.mjs`'s `CANONICAL_TEST_SHAPED` (a `.test` or `.spec` name with a `[cm]?[jt]sx?` extension), and in ESLint as `*.{test,spec}.{ts,tsx}`, the TypeScript extensions `pnpm lint` reads (an `.mts` or `.cts` probe is reported `File ignored because no matching configuration was supplied`); proof (1), re-run on that widened rule, exits 1 and then 0 after the restore. The policy pin `architecturePolicies.test.ts` carries the rule's row. **Residual**: the cruiser sees imports, not globals, and the ESLint block names `Buffer` alone, so another Node global (`process`, `__dirname`) is neither gate's; `process.env.NODE_ENV` in `errors.ts:89` stays, the idiom bundlers replace at build time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `workstream/0-22-b-shared-root`                                |
| Story runner (D29): each client story runs in headless Chromium; a thrown play, an axe violation or a console error fails it       | CI job `Storybook Stories` (`stories`) in `ci.yml` → `pnpm --filter @apps/client test:stories`; battery step `stories`                                                 | **Three reds on the COMPLETE step** (2026-10-06): `pnpm --filter @apps/client test:stories` with one planted story file each — (1) a `play` that throws → exit 1, `1 failed, 58 passed (59)`, the failure `planted play failure`; (2) `<button />` with no accessible name → exit 1,`1 failed, 58 passed (59)`, `button-name`through`a11y.test: "error"`(the addon's default,`todo`, reports a violation without failing it); (3) a render calling `console.error("planted")`→ exit 1,`1 failed, 58 passed (59)`, through the console contract of `.storybook/vitest.setup.ts`. After each, the plant was deleted and the tree fingerprint (porcelain, tracked-diff hash, untracked hashes) matched the one taken before (`d118feae690f4f20`); the clean run exits 0, `58 passed (58)`, in 6 s, with 0 lines the battery reads as a warning. A missing browser fails the step as well (`Executable doesn't exist … chromium_headless_shell-1243`, exit 1), and the battery never downloads one. **Measured on the first run**: 17 of the 58 stories failed real defects — icon-only buttons and inputs with no accessible name, a controlled input with no `onChange`, text under 4.5:1 — fixed in the stories; Light-theme tokens --destructive and --muted-foreground corrected to meet WCAG AA contrast (Edward, 2026-10-06); the three token stories were the only red of the 58. **Residual**: the contract sees a console call only between a story's `beforeEach` and `afterEach`, not one made while a module loads; axe reads the DOM of the rendered story at the default viewport only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `workstream/0-22-c-runner`                                     |
| Raw `setInterval` (fitness #11): no exclusion outlives the deleted `enhancedValidator.ts` and its `DANGEROUS_STRINGS` denylist     | CI step `#11` in the `fitness` job of `fitness.yml`, a `grep -rnE` with `::error` paired to `exit 1` (fitness #34 PAIRED); same regex as CLAUDE.md #11                 | **On the COMPLETE step** (2026-10-06): its `run:` body extracted from `fitness.yml` with PyYAML and run with `bash` from the worktree root exits 0 on the tree, and CLAUDE.md's #11 command prints 0. The two removed terms, `enhancedValidator\.ts` and `DANGEROUS_STRINGS`, existed only for that file's denylist literal `"setInterval("` (`DANGEROUS_STRINGS` since 2026-04-22, never matching the literal's line; the path since 2026-05-01), and with the file gone either term could hide a real call: (1) `setInterval(tick, 1000);` planted at the deleted path `apps/api/src/security/enhancedValidator.ts` → exit 1, the `::error` counting 1 call and naming `apps/api/src/security/enhancedValidator.ts:2`, while the old filter reads 0 on the same tree; (2) `export const DANGEROUS_STRINGS = [setInterval(() => undefined, 1000)];` planted as the new file `apps/api/src/fitness11RedProbe.ts` → exit 1 naming that line, the old filter again 0. After each, the plant deleted, `git status --porcelain` identical to before (sha256 `fb39d16a…` and `372f26c4…`), re-run → exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `workstream/dc-4-dead-security-modules`                        |
| Story per component (D29, 0.22.5): every component file has a sibling story, ratcheted per root against a committed count          | CI step `Story per component check`, `code-quality` job of `ci.yml` → `pnpm check:stories` → `scripts/testing/story-per-component-gate.mjs`; battery `stories-gate`    | **Two reds and a green on the COMPLETE command** (2026-10-06): `pnpm check:stories` exits 0 on the tree, `254 components; those without a sibling story equal scripts/testing/story-coverage-baseline.json: packages/ui/src/components 40, apps/client/components 160, apps/admin/components 54`. (1) `apps/client/components/Planted.tsx`, a component carrying the canon header and no story, exits 1: `apps/client/components: 161 components without a sibling story, baseline 160`, then the 161 files, `apps/client/components/Planted.tsx` among them. (2) `packages/ui/src/components/badge.stories.tsx` with the baseline left at 40 exits 1: `packages/ui/src/components: stale baseline: 39 components without a sibling story, baseline 40. Lower it to 39 in scripts/testing/story-coverage-baseline.json`. After each, the plant deleted, a fingerprint of the worktree (porcelain with every untracked file, tracked-diff hash, untracked-file hashes) matched the one taken before, and the re-run exits 0. **In the battery**: the `stories-gate` step of `scripts/testing/battery.sh`, run alone through the script's own `step` function and then `battery-state.mjs` with `--expected-steps 1`, exits 0 with a GREEN verdict and no warning line in its log; plant (1) makes it exit 1 and the verdict RED, `step stories-gate exit 1`. The `ci.yml` step was written on a copy (actionlint 1.7.12 exit 0, prettier clean, its `run:` body exactly `pnpm check:stories`) and pasted by the orchestrator. Seventeen mutants of the script (a comparison branch disabled, a `.spec.tsx` counted, a dot-directory or `node_modules` entered, a story matched case-insensitively, subdirectories skipped, a baseline check dropped, a missing or empty root accepted, an absent baseline read anyway or let a regression pass, arguments ignored) each turn `storyPerComponentGate.test.ts` (20 tests) red, each restore matching its `sha256sum`. **Residual**: a count, not a ledger, so one change that adds a story and an uncovered component in the same root passes (fitness #38's tradeoff), the printed list and review being the defence; and a file is a component by its name, so a `use*.tsx` hook under a root would need a story too (none exists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `workstream/0-22-f-story-gate`                                 |
| Legal inventories (LEGAL-3, §5.10): each generated page under `docs/legal/inventories/` is current, every row classified           | CI step `#45`, `dependency-consistency` job of `fitness.yml` → `pnpm check:legal` (`scripts/legal/run.mjs --check`; `::error` paired to `exit 1`); battery `legal`     | **Two reds on the COMPLETE step and a green** (2026-10-07): the `run:` body of step `#45`, extracted from `fitness.yml` with PyYAML and run with `bash` from the worktree root, exits 0 on the tree with one `is current` line per page (4). (1) `reply.setCookie("planted", "1")` appended to `apps/api/src/auth/oidcRoutes.ts` → the same body exits 1: `legal-inventory cookies-and-storage: api:cookie:planted is a candidate with no entry: classify it`, the page `differs from the regenerated page`, then the `::error title=Fitness #45 violation` line; the plant deleted, `sha256sum -c` OK, `git status` clean, the re-run exits 0. (2) `"planted-sdk": "1.0.0"` added to the dependencies of `apps/api/package.json` → `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm check:legal` exits 1: `legal-inventory subprocessors: planted-sdk is a candidate with no entry: classify it` and the page stale; restored, `sha256sum -c` OK (a plain `pnpm check:legal` also exits 1 there, but from pnpm's pre-run dependency check, `ERR_PNPM_FETCH_404`, before the gate runs). **In the battery**: `step legal pnpm check:legal` after `stories-gate`, `PLANNED_STEPS` 23 → 24. Gate #44 counts the `#45` name from the `dependency-consistency` job (`derived N=45`), where the step lives because the generators render through prettier's API and the Fitness Functions job installs nothing. **Residual**: enumerated vocabularies, so a personal field with no matching token, a cookie set through an unknown helper and a `fetch`-reached service with no package stay invisible until a token, a matcher or a `manual` entry names them; the gate proves a classification is present and well formed, never that it is right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `workstream/legal-l2-gate`                                     |
| Support docs (SUP-1, §5.15): both generated pages current, each support doc on the template, every candidate classified            | CI step `#46`, `dependency-consistency` job of `fitness.yml` → `pnpm check:support` (`scripts/support/run.mjs --check`; `::error` with `exit 1`); battery `support`    | **Four reds and a green on the COMPLETE command** (2026-10-07): `pnpm check:support` exits 0 on the tree, printing `support-docs index: support docs read: 0`, `support-docs index: docs/support/README.md is current`, `support-docs non-features: 82 route, 51 package, 3 worker, 19 queue, 16 admin, 19 client` and `support-docs non-features: docs/support/NON_FEATURES.md is current`. (1) A planted `docs/support/planted.md`, complete but for `## Data and privacy` → exit 1: `support-docs index: docs/support/planted.md: heading 6 must be "## Data and privacy", not "## Related documents"`, then both pages `differs from the regenerated page`. (2) `Hand edit.` appended to `docs/support/README.md` → exit 1: `support-docs index: docs/support/README.md differs from the regenerated page: run pnpm support:index`. (3) An empty `apps/api/src/planted/plantedRoutes.ts` → exit 1: `support-docs non-features: route:planted/plantedRoutes.ts has no entry: classify it` (the scan reads 83 routes) and `NON_FEATURES.md` stale. (4) `pendingBaseline` raised to 185 in `docs/support/classification/non-features.json` → exit 1: `support-docs non-features: stale pendingBaseline 185: lower it to 184`. After each, the plant deleted or the file restored, `sha256sum -c` OK over the README, `NON_FEATURES.md`, `_TEMPLATE.md` and the classification, and the re-run exits 0. **On the COMPLETE CI step** (2026-10-07): the `run:` body of step `#46`, extracted from `fitness.yml` with PyYAML and run with `bash` from the worktree root, exits 0 with the two `is current` lines; with plant (1) it exits 1, printing the `heading 6 must be` line, both pages stale and the `::error title=Fitness #46 violation` line; the plant deleted, `sha256sum -c` OK and `git status --short` clean, the re-run exits 0. Gate #44 counts the step (`derived N=46`). **In the battery**: `step support pnpm check:support` after `legal`, `PLANNED_STEPS` 24 → 25; run alone through the script's own `step` function (extracted from `battery.sh`) and `battery-state.mjs` with `--expected-steps 1` into a scratch state directory, it gives `support exit=0` and `BATTERY GREEN`, and with plant (1) `support exit=1`, `RED because step support exit 1` and `BATTERY RED`. Mutants: 14 of `scripts/support/lib/front-matter.mjs`, 6 of `index.mjs` and 6 of `non-features.mjs`, each killed by its suite (`supportFrontMatter.test.ts`, `supportIndex.test.ts`, `supportNonFeatures.test.ts`) and restored byte for byte. **Residual**: structure only, so no stamp date is compared with today and no commit is counted since a stamp (the freshness part of the support docs gate); a capability the derivation does not see (a middleware, an adapter or provider package, a page at an app root) has no row; and a path literal registered on any receiver can raise a false candidate, refused until it is classified                                     | `workstream/support-sup1-nonfeatures`                          |
| Reserved suffixes (WU-1.2): vitest never collects another tier's suffix, and Playwright collects only `*.spec.ts`                  | Config: `RESERVED_TIER_EXCLUDES` in `packages/vitest-shared`, set by the factory, spread by the four app configs; `testMatch` in both portals                          | **Reds on the real collectors, before and after the change** (2026-10-08): each plant a one-test file, listed with the collector's own command, deleted after the run, `git status --short` clean. (1) `apps/api/tests/unit/x.integration.test.ts` → `pnpm exec vitest list --filesOnly` from `apps/api`: before, `tests/unit/x.integration.test.ts` listed (606 files); after, absent (605). (2) `apps/client/tests/x.spec.ts`, the same from `apps/client`: before, `tests/x.spec.ts` listed (45); after, absent (44). `apps/client/tests/x.integration.test.ts`, which the client's explicit `include` still matches, is absent after as well, so the reserved `exclude` removes it, not the `include`. (3) `apps/admin/tests/x.spec.ts`: before listed (17), after absent (16). (4) `packages/providers/linkedin/tests/x.integration.test.ts`, through the factory: before listed (7), after absent (6). (5) `apps/workers/tests/x.integration.test.ts`: with the old config, `tests/x.integration.test.ts` listed (18); with the new one, absent (17). (6) Playwright: an `x.test.ts` under `apps/admin/tests/e2e` and `apps/client/tests/e2e/tests` → `pnpm exec playwright test --list` (client with `--config tests/e2e/config/playwright.config.ts`): with the configs of `HEAD`, `Total: 38 tests in 5 files` and `Total: 840 tests in 6 files` (the plant in each of the 6 projects with no matcher of their own); with `testMatch: "**/*.spec.ts"`, `Total: 37 tests in 4 files` and `Total: 834 tests in 5 files`; the configs restored, `sha256sum -c` OK. (7) The factory suite first: with `RESERVED_TIER_EXCLUDES` not exported, `pnpm --filter @packages/vitest-shared test` exits 1, 3 failed and 13 passed; implemented, 16 of 16 pass. **No count moved**: `vitest list --filesOnly` over all 91 tracked vitest configs gives 870 files before and after, each sorted list byte-identical, and `playwright test --list` prints byte-identical output in both portals (admin: 37 in `chromium`; client: 139 in each of six browser projects, 0 in `accessibility`, `visual-regression` and `performance`, whose own matchers match no file). **Workers**: `@packages/vitest-shared` joins the devDependencies of `@apps/workers`, and `pnpm-lock.yaml` gains only that importer's workspace link, no package and no snapshot, so its config spreads the list like the other three (red 5). **Residual**: a config that composes its own and omits the spread is caught by no gate until the reach gate (engine WU-1.9, wired by WU-1.10) counts every file's collectors                                                                                                                                                                                                                                                                                                                                                                                             | `R2` (`workstream/phase1-u2-reserved-suffixes`)                |
| Rate-limit window restore (WU-1.4): the burst block hands `/health` back answering 200, or fails naming its last answer            | `after()` hook of "Advanced Rate Limiting" in `apps/api/tests/security.test.ts`, in the `integration:flows` batch (CI `Integration Tests`)                             | **Three reds and a green on the runner's exact node command** (2026-10-09; live API with `ENABLE_RATE_LIMITING=true`, each scenario started on a full bucket, `security.test.ts` restored byte-exact, `sha256sum -c` OK): (1) a planted `describe` right after the block asserting the next `/health` caller gets 200: without the `after()`, `node --conditions development --import tsx --test --test-reporter=tap --test-force-exit --test-concurrency=1 --test-timeout=30000 tests/security.test.ts` exits 1 with `the next /health caller got 429`; with it, exit 0, 19 of 19, the file 61.5 s instead of 1.6 s. (2) The poll pointed at `/health-never-200`: exit 1, `failureType: 'hookFailed'` on the block, `The /health rate-limit window did not reopen within 65 s: the last poll got HTTP 404.`; the TAP summary still reads `# fail 0`, so the batch goes red on `run-tests.sh`'s captured runner exit. (3) The first design, a poll until 200 with no wait for the full bucket: with it in place the same probe still got 429, because the hook's own 200 spends the permit it finds. **Green**: `TIER=full-integration`, 939 tests before and after, every batch the same count, 0 skipped, 0 cancelled. **Residual**: the `production` batch never needed the wait; right after the `integration:flows` files it passes 81 of 81 with no 429, with or without the `after()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `R4` (`workstream/phase1-u4-timing-in-tests`)                  |

`metrics.mjs --m7` counts the data rows of this table: total rows, and rows whose `Red proof` cell is
filled. **A script in the tree is not a gate until a workflow runs it** — the same rule fitness #30
holds over test files: a check no collector names never executes, however complete it looks in the
tree. The holds gate earned its row only with the pull request that landed its step in the
`Dependency Consistency` job, red demonstrated on the COMPLETE step, and M7 moved with it, not before.

### Decisions log

Signed as a block by Edward on 2026-09-27. **D17 is open** — it is a product classification, not a
technical fork, and the two CLI seeds it covers are excluded from every delete slice until it is
answered. **D24 and D25 precede D26 although they landed after it**: slices `P.1`
(`refound/3-fitness-inventory`, D24) and `0.11` (`refound/0-toolchain-storybook`, D25) numbered their
decisions before `0.17` wrote D26. D24 landed with `P.1` and D25 with `0.11`, so the ids run without a gap.
**D44 is not on `main`**: it lived on a withdrawn branch, and the circular-gate decision it held is
recorded in D43 (e), so the ids run D43 → D45.

| ID  | Fork                                                                                                                                                       | Options                                                                                                                                                                                                 | Chosen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | By     | Date       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- |
| D1  | How the 400-line budget is counted when the product is tests                                                                                               | one undivided count · CODE/EVIDENCE split                                                                                                                                                               | CODE ≤ 400 hard; EVIDENCE pre-approved per slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Edward | 2026-09-27 |
| D2  | #37 must accept the floor descent that demolition causes                                                                                                   | per-PR admin override · canon scenario + ADR                                                                                                                                                            | canon scenario `decorative-demolition` + ADR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Edward | 2026-09-27 |
| D3  | The four `describe.todo` stubs, and whether `.todo` counts as a skip                                                                                       | keep as declared gap in tree · delete and count the gap in the tracker                                                                                                                                  | delete; `.todo` counts as a skip and goes red                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Edward | 2026-09-27 |
| D4  | Double collectors, duplicate jobs and unread alarms                                                                                                        | keep · delete                                                                                                                                                                                           | delete `eval.yml`, the custom security job, the 28 subset scripts, `chaos.yml`, "Test and Build", the second "Security Audit"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Edward | 2026-09-27 |
| D5  | Branch freshness before merge on `main`                                                                                                                    | merge queue (unavailable on personal repos) · `strict: true`                                                                                                                                            | `strict: true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Edward | 2026-09-27 |
| D6  | Where the required-check list lives                                                                                                                        | classic protection (unreadable from CI) · committed ruleset                                                                                                                                             | `.github/rulesets/main.json`, applied by an admin step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Edward | 2026-09-27 |
| D7  | Which advisory gates become required                                                                                                                       | all now · staged                                                                                                                                                                                        | Dependency Consistency, size-limit, Semgrep after measuring overlap; Container Security once green; lychee stays advisory; CodeQL in one context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Edward | 2026-09-27 |
| D8  | OSV-Scanner                                                                                                                                                | keep as-is (cannot fail) · keep only if it sees a class `pnpm audit` misses · delete                                                                                                                    | keep only if the measurement shows a distinct class; otherwise delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Edward | 2026-09-27 |
| D9  | Test database and Redis topology                                                                                                                           | separate cluster · same LXC cluster as dev with a distinct identity                                                                                                                                     | same cluster, database `omnipost_test`, Redis logical DB 15, ports = dev + 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Edward | 2026-09-27 |
| D10 | `perf:db` and `perf:memory`                                                                                                                                | fix · retire                                                                                                                                                                                            | retire both, plus `perf:baseline/regression/test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Edward | 2026-09-27 |
| D11 | k6                                                                                                                                                         | keep six fiction scenarios · one real scenario as a merge gate · delete                                                                                                                                 | one real scenario with calibrated thresholds, as a merge gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Edward | 2026-09-27 |
| D12 | `security/tests`                                                                                                                                           | repair in place · fold the useful cases and delete the rest                                                                                                                                             | fold twelve cases into the live tier, delete the suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Edward | 2026-09-27 |
| D13 | E2E reconstruction                                                                                                                                         | instrument 207 `data-testid` + a test route in the production binary · role/label selectors + owner-connection seed + provider seam and sidecar                                                         | role/label selectors, no `/api/test/seed`, Telegram `baseUrl` seam rejected under production, MSW sidecar, chromium only, visual snapshots deleted, `retries: 1` + `failOnFlakyTests`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Edward | 2026-09-27 |
| D14 | Coverage targets                                                                                                                                           | keep the canon's aspirational per-layer targets · measured floors with ratchet                                                                                                                          | measured floors with ratchet; strict ratchet when local↔CI drift ≤ 0.1 pp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Edward | 2026-09-27 |
| D15 | Mutation testing in pull requests                                                                                                                          | full run · incremental, blocking on `break`                                                                                                                                                             | incremental and blocking for changed packages; weekly full run; `apps/api` a declared gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Edward | 2026-09-27 |
| D16 | Protecting `TESTING_INFRASTRUCTURE.md`                                                                                                                     | `@`-import it into every session · anti-deletion list only                                                                                                                                              | the anti-deletion list of fitness #24, WITHOUT an `@`-import                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Edward | 2026-09-27 |
| D17 | `seed-demo-data.ts` and `seed-large-dataset.ts` (CLI, 0 importers, unused since 04-22)                                                                     | PLANNED · DEAD                                                                                                                                                                                          | **open** — product classification; both files excluded from every delete slice meanwhile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —      | —          |
| D18 | How the workstream is executed                                                                                                                             | ad-hoc · SDD (proposal → spec → design → tasks → apply by slices)                                                                                                                                       | SDD, with this plan as input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Edward | 2026-09-27 |
| D19 | Filling the surfaces that have no tests, and how                                                                                                           | one writer · parallel writers per package in isolated worktrees                                                                                                                                         | parallel writers per package in isolated worktrees; git stays exclusive to the orchestrator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Edward | 2026-09-27 |
| D20 | Testing dependency freshness                                                                                                                               | stay put · align to `latest` · align to latest MATURE                                                                                                                                                   | latest mature (7-day buffer, ADR-0018) before the reach contract, with a documented hold per exception and `@types/node` = runtime major                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Edward | 2026-09-27 |
| D21 | The 17 measured lags that no enumerated slice owned                                                                                                        | one catch-all slice · two grouped slices at the tail of Phase 0 · leave them to the ordinary cadence                                                                                                    | `0.4` absorbs the `@typescript-eslint` pair; `0.14` (build six) and `0.15` (quality-gate eleven) close the tail of Phase 0, now 15 slices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Edward | 2026-09-27 |
| D22 | The holds table's remove-when, invisible in markdown and unchecked by the gate                                                                             | keep the four-column header and read index 3 · declare the fifth column and locate it BY NAME                                                                                                           | `0.4b`: fifth column declared, three rows split, `parseHolds` locates both by name, ragged rows refused; rows cited by package; the consumer declares the build edge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Edward | 2026-09-28 |
| D23 | The runtime line, and the types major that ran ahead of it                                                                                                 | raise the runtime to Node 26 now · keep the 24 LTS line and pin the types DOWN to it                                                                                                                    | keep 24 (Krypton LTS) and take `@types/node` DOWN to 24.13.6, its latest mature; `engines.node` `>=24.15.0 <25` in all 98 manifests with a gate that refuses either side drifting; Node 26 deferred to slice `0.16` on its LTS date 2026-10-28 (24 enters Maintenance 2026-10-20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Edward | 2026-09-28 |
| D24 | Which number this gate takes, with #44-#46 reserved by slices that have not landed                                                                         | hold #47 and leave #44-#46 a hole until those slices land · take the next free number and shift the reservations                                                                                        | **Mechanical, not a product fork.** #44 — a contiguity gate cannot land in front of a hole. The remaining reservations shift down by one, renumbered in [§Work units](#work-units) and [§Plan (fixed)](#plan-fixed) (3.9/3.10 → #45, 3.13 → #46, 4b.7 → #47); a reserved slice that lands out of that order takes the next free number instead, and the rows of [§Gates](#gates) record the numbers taken                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —      | 2026-09-28 |
| D25 | The Storybook family hold, whose remove-when named a clause that could not fire                                                                            | bump the family and delete the hold · revert and rewrite the hold with a measured reason · leave the hold as written                                                                                    | **Resolved by measurement.** Its remove-when said "both portals' Storybook builds green"; `apps/client` is green at 10.6.0 and `apps/admin` fails at 10.6.0 AND at 10.4.6 identically, so a rewritten hold would blame the bump for a defect it does not cause. Re-measured on the rebased tree on 2026-10-02: the client build and `storybook dev --smoke-test --ci` exit 0, the admin build exits 1 with the same `SB_BUILDER-WEBPACK5_0002` signature. The newer 10.6.1 is still inside the 7-day buffer, so it gets a pre-registered scheduled hold row rather than a bump. **Closed 2026-10-06 by slice `0.22` ([D29](#decisions-log)):** the admin Storybook was removed after a last run that day failed with the same signature at 10.6.0, and its declared gap closed with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —      | 2026-09-29 |
| D26 | A gate whose comparator is the live registry or the live advisory database goes RED with NO diff — measured twice in 28 h on a byte-identical lockfile     | patch each slice where its own gate reddens · baseline the reds and move on · put ONE repair slice at the BOTTOM of the stack and rebase the rest onto it                                               | the repair goes FIRST: one slice at the bottom of the stack (`0.17`, PR #325) raises every floor the advisory database overtook to its MINIMAL patched version (ADR-0018; for the direct `next`, `axios` and `fastify` that is also the latest stable), cross-derived per the SECURITY_CANON CVE-floor Method note; per-advisory detail lives in those rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Edward | 2026-09-30 |
| D27 | Slice `0.21` (the `eslint-plugin-boundaries` bump and its v7 config migration, SMELL-66): its order, its branch, and the route classification it inherited | wait for `0.20` and run on `refound/0-toolchain-boundaries` as contracted · run first, on the branch the battery chain already stacks · keep `routes` an element descriptor · make it a file descriptor | **(a) Order — a deviation from the contract.** `0.21` ran BEFORE `0.20`, although the contract stacks it on `0.20`: the local battery turns RED on any warning line, and no commit could be certified until the three `[boundaries]` warnings were gone. **(b) Branch — a deviation from the contract.** It ran on `workstream/eslint-boundaries-policies` instead of `refound/0-toolchain-boundaries`. **(c) Route classification — a tightening.** Route files moved from an element descriptor that classified no file (a file pattern, which the plugin reads as a folder) to a `boundaries/files` descriptor: the 77 route files come under the rule and 7 of the 86 probe imports that passed before are refused, while the real tree reports 0 problems before and after. **(d) Version — a correction.** The first commit, `050eb8d5`, kept 7.1.0 because its plan was written without reading the contract; the second commit takes 7.2.0, deletes the canon hold row and re-proves every probe on it. **What Edward approved, and what he did not.** On 2026-10-02 he approved the plan that ran the migration at once, on that branch, with routes as a file descriptor. That plan did not show him the contract's slice, so (a) and (b) were approved as a plan, never as deviations from the contract; the orchestrator found the slice afterwards and reported both to him the same day. The plan described itself as a change of syntax only, and the tightening in (c) was reported to him as a departure from that description. **Left open as SMELL-183, closed 2026-10-05 by `PR v-c`.** The plugin had no import resolver and pointed `domain` and `application` at deleted folders; dependency-cruiser replaced it                                                                                              | Edward | 2026-10-02 |
| D28 | How the eleven stacked pull requests #326–#336 drain into one rebased line, and what the drain leaves out                                                  | rebase and review each slice on its `refound/*` branch · commit on local `workstream/*` branches published to the `refound/*` names; take or leave 0.18.6–0.18.8                                        | **(a) Branches.** Commits were made on local `workstream/refound-<slice>` branches and published to the pull requests' `refound/*` names, because the commit gate accepts commits only on `workstream/*` (it has read the right repository since `4fcdc116`); Edward authorized the forced publication of those eleven branches and their merge on 2026-10-02 (drain mode: nothing new is stacked until the stack is in main). **(b) Size.** Where the native review refused a candidate by size (`lens_context_budget_exceeded`), the candidate was reviewed as smaller ones: slice `0.11` is three commits with the tree of the single one. **(c) Pre-registered holds.** A release inside the seven-day buffer that cannot simply be taken, or is simply scheduled, gets its hold row before the lag exists, marked as pre-registered and proven with `node scripts/testing/holds-gate.mjs --instant <iso>`, which evaluates the gate as of that instant: msw 3.x (`2026-10-05T15:45Z`), `@typescript-eslint` 8.71.0 (`2026-10-05T17:09Z`), Storybook 10.6.1 (`2026-10-06T17:14Z`). **(d) Not taken.** Contract tasks 0.18.6–0.18.8 ("slice to be named at the rebase") are separate scopes, and drain mode stacks nothing new. **Who decided:** Edward authorized the forced publication and the merge, in drain mode; the orchestrator chose the local branch naming in (a) and decided (b)–(d), all reported to him in the morning summary                                                                                                                                                                                                                                                                                                                                                                                     | —      | 2026-10-02 |
| D29 | Slice `0.22`: demolish the admin Storybook, or measure, keep what runs, remove what does not, backfill runnable stories, stories part of creating UI       | demolish the admin Storybook (the 2026-10-01 plan) · measure first, keep what runs, remove what does not, backfill a runnable story per component, and require one for every new component              | Edward, 2026-10-02: "el plan no es removerlo, es medir lo actual y ver si funciona". **(a) Runner.** Step zero is a story runner the canon allows; Jest is forbidden. The candidate to measure is `@storybook/nextjs-vite` + `@storybook/addon-vitest` on vitest browser mode with Playwright, which Storybook documents as the test-runner's successor for Vite-powered frameworks. **(b) Measure first.** The first measured step builds the client Storybook and runs its 58 stories in headless Chromium — render, page errors, console errors, axe WCAG 2.1 A/AA — and tries the admin Storybook, which has 0 stories. **(c) Keep or remove.** What works stays; what does not is removed. **(d) Backfill.** Component by component: a component without a story gets one, a component with a story has it run, and a passing story moves the work to the next component — `packages/ui` first, then the client, then admin, in reviewable slices. **(e) Passes / fails.** A story passes when, over the component's meaningful states, it shows no page error, no console error and zero axe violations in a real browser. A failing story is a defect: it is fixed or tracked, never skipped or suppressed. **(f) Part of creating UI.** The coding standard requires a story for every component, with an ADR; a gate enforces it, as a ratchet during the backfill and hard-zero after it; the agent writes, runs and inspects the story before handing over. **(g) What does not change.** The removal of `@storybook/test-runner` by #336 stands: it had no configuration, no `play` functions, was never invoked and carried Jest. This supersedes the 2026-10-01 demolition. **Landed:** A #425–#427, B #428, C #432, D #439, F #441, G #443, E #445 (on #444); 10.6.1 #447; backfill per [D51](#decisions-log)         | Edward | 2026-10-02 |
| D30 | Task 0.18.7: give the nightly `turbo run test --force` step the 6 GB `NODE_OPTIONS` of `ci.yml`'s shard step, or close it without editing `nightly.yml`    | add `NODE_OPTIONS: "--max-old-space-size=6144"` to the nightly step, as the task says · close the task without the edit, its reporter half staying with task 3.3.4                                      | **Close 0.18.7 without editing `nightly.yml`** (Edward, 2026-10-02: "Si piensas que es la mejor opcion adelante"). **(a) The premise was overturned.** The task assumed the forks-worker death measured on 2026-09-30 came from the runner's default heap. Slice `0.19` traced it to `unrefActiveHandles()`, which unrefs the vitest fork's IPC channel (0.19.1), deleted that helper (0.19.2), and then ran the full api unit suite ×5 at the default heap and in the CI shard shape with 0 `pending` and 0 unhandled errors (0.19.4). **(b) The edit would add risk.** turbo 2.9.16 hands `NODE_OPTIONS` to every task — it is on turbo's built-in pass-through list, present in the installed binary — so in the nightly step a 6 GB ceiling would apply to every package's vitest running in parallel, raising the runner's memory risk instead of lowering it. **(c) What stays open.** The task's second half, the reporter failing on `pending` so a lost test never reads as green, stays with task 3.3.4. **(d) What still lands.** Task 0.18.8's comment beside `ci.yml`'s `Coverage Merge` is applied once a `sensitive-edit` token exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Edward | 2026-10-02 |
| D31 | jsdom 30 reaches production through `isomorphic-dompurify` (human gate H1): take it, and on which conditions                                               | hold below jsdom 30 · take jsdom 30.1.1 and `isomorphic-dompurify` 4.4.0 under stated conditions                                                                                                        | **Take both, under three conditions** (Edward, 2026-10-02). **(a) What moved.** jsdom 29.1.1 → 30.1.1 in the catalog and `isomorphic-dompurify` 3.19.0 → 4.4.0, the `apps/api` literal, which declares `jsdom ^30.0.0`, so one jsdom serves the sanitizer and the four jsdom test environments. Both were latest mature at 2026-10-02T20:22Z; every manifest already declared `engines.node` `>=24.15.0 <25`, inside jsdom 30's floor. **(b) Condition 1, the sanitizer is unchanged.** `sanitizerOutputs.test.ts` drives `EnhancedValidator.sanitizeString(input, "html")` and `ServerTemplateEngine.sanitize` over 27 fixed inputs and asserts each exact output; the expected strings were observed on 29.1.1, where it passed, and it passes on 30.1.1 unedited. Its red: an attribute planted in the validator's allowlist and a tag in the engine's call. **(c) Condition 2, the audit.** `pnpm audit`, re-measured with the change applied, reports only the 4 ignored advisories; OSV lists nothing for jsdom 30.1.1, undici 8.11.2, tough-cookie 6.0.2, isomorphic-dompurify 4.4.0 or any version the change adds, each of which is at least 7 days old. **(d) Condition 3, `tough-cookie`.** The blanket override became `"tough-cookie@<4.1.3": 4.1.3`: jsdom 30 and msw resolve 6.0.2, and only `request@2.88.2` (via the root `jq`) keeps the floor. **(e) The `undici` override deleted.** No 7.x copy is left in the lockfile, so its band would pin nothing. Reaching that took a re-resolution: vitest's optional jsdom peer had kept 29.1.1, and undici 7.29.1 with it, in 87 importers by lockfile preference, which a plain install does not revisit                                                                                                                                                             | Edward | 2026-10-02 |
| D32 | The root devDependency `jq@1.7.2`, which nothing used, and the audit ignore and overrides that existed only for the chain it carried                       | keep it and its debt · drop it, then delete each ignore or override only once it is proven orphaned                                                                                                     | **Drop it, and delete each debt only once it is proven orphaned** (Edward, 2026-10-02). **(a) What it is.** npm `jq@1.7.2` is "Server-side jQuery wrapper for node." (2012-04-29; depends on `jsdom 0.2.x`, `xmlhttprequest 1.3.x`), not the JSON CLI. A root devDependency since the Genesis commit `5603d6be` (2026-03-08), nothing imported it, no script called it, and its bin shadowed `/usr/bin/jq` under `pnpm exec`. **(b) Why it was never caught.** From `5e4e4836` (2026-09-27) to `e3c26b2e` (2026-10-02) the canon called it "a JSON helper", and every review measured its chain's links, never its root. **(c) What leaves the tree.** 45 lockfile snapshots — `jq`, `jsdom@0.2.19`, `request@2.88.2`, `tough-cookie@4.1.3`, `xmlhttprequest@1.8.0` and 40 packages only they reached — none added, no surviving snapshot changed. **(d) Debts deleted, each proven orphaned.** Ignore `GHSA-p8p7-x288-28g6`: `pnpm audit` reports the same set with and without it, and with the whole list emptied surfaces exactly the 3 that remain. Override `tough-cookie@<4.1.3`: both remaining consumers declare `^6`. Override `qs@<6.16.0`: `request`'s `~6.5.2` was the one range that could not reach 6.16.0; a fresh pnpm 12.6.0 resolution of the two left selects 6.16.0. Override `xmlhttprequest: 1.8.0`, the GHSA-h4j5-c7cj-74xg floor under `jq`'s `1.3.x`, pinned a package no longer in the lockfile. No override's deletion changed a snapshot. **(e) No contract task**: phase-0 catch-up item 3b. **(f)** `dependency-audit-policy.md` now points to the canon, not a copy. **Who decided:** Edward approved the slice naming the ignore and the `tough-cookie` override; the `qs` and `xmlhttprequest` overrides were found while measuring and reported to him                                            | Edward | 2026-10-02 |
| D33 | `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm, high) has no fixed release, reaches only devDependencies, and turned `pnpm audit` red under pull request #373         | hold the slice until upstream publishes a fix · bump the chain roots · ignore the advisory with a documented reachability argument                                                                      | **Ignore it, with its reachability argument** (Edward, 2026-10-03). **(a) The advisory.** GHSA-vfj7-8cjw-p6xm (high, CVE-2026-93687, CWE-674): the recursive AST walkers of `braces <=3.0.3` have no nesting-depth guard, so a deeply nested pattern exhausts the stack and the uncaught `RangeError` ends the process (about 3,500 levels upstream, Node 26.5.0). Published 2026-09-18, GitHub-reviewed 2026-10-02T22:36:33Z, after `eead918a` recorded a clean audit: red on 2026-10-03 with no tree change. **(b) No fixed release.** npm ends at 3.0.3, OSV records `last_affected 3.0.3`, GitHub `first_patched_version` is null; the fix, micromatch/braces#72, is unmerged. So the ignore list, per `dependency-audit-policy.md`, not §Blocked floors (a fix not taken). **(c) Reachability.** One copy, `braces@3.0.3`, only under `micromatch@4.0.8`: 7 lockfile paths from 6 devDependencies (root `depcheck`, `eslint-plugin-boundaries`, `jscpd`, `secretlint`; `@storybook/nextjs` in both portals), 0 production. No glob library is imported or declared in `apps/`, `packages/`, `infra/` or `scripts/`, and `next` 16.3.8 vendors no copy. `micromatch` hands `braces` patterns only: eslint settings, CLI globs, the docgen default `**/**.tsx`, or a committer's staged paths via lint-staged. **(d) Why bumps cannot close it.** `secretlint` 13.0.5 and `jscpd` 5.3.0 drop their chains (slice `0.15`); `eslint-plugin-boundaries` 7.2.0 and `@boundaries/elements` 3.1.1 pin `micromatch` 4.0.8 exactly, `@storybook/preset-react-webpack` 10.6.1 still pins the canary docgen plugin, and `depcheck` and `micromatch` are at latest. **(e) Remove-when:** `braces` publishes a release above 3.0.3 and the parsed lockfile resolves it, never judged from the canon row. **Retired 2026-10-06 with #439.**    | Edward | 2026-10-03 |
| D34 | The single-version gate ran `pnpm dlx syncpack@12`, whose own tree carries the npm-deprecated `@effect/schema@0.69.0` and turned the battery red           | keep `syncpack@12` and its warning · drop the gate and lean on `catalogMode: strict` · move to `syncpack@15.3.3` and migrate its config                                                                 | **Move to `syncpack@15.3.3`** (Edward, 2026-10-03: "Ok, adelante"). **(a) Why syncpack 12 had to go.** Its tree carries `@effect/schema@0.69.0`, which npm deprecated ("merged into the main effect package"): a fresh `pnpm dlx syncpack@12` prints `[WARN] 1 deprecated subdependencies found: @effect/schema@0.69.0`, and `scripts/testing/battery.sh` fails on any warning line. **(b) Why nothing replaces it.** pnpm 12's `catalogMode: strict` gates only `pnpm add`: a hand-written caret range or an off-catalog version still installs with exit 0, and none of the holds, override-bands, engines or `pnpm dedupe --check` gates checks version drift or range shape. **(c) What v15 checks.** 15.3.3 (2026-08-09, `latest`, nothing in OSV) is a native binary with no JavaScript dependency tree and reads the `catalog:` protocol, so `lint` is the gate again, not `list-mismatches`: one version per manifest-declared dependency (a literal that differs from its catalog entry is `DiffersToCatalog`) and exact ranges on literal specs. v15 rejects the `dependencyTypes` config key, so `prod,dev,peer,overrides` moved to `--dependency-types`; `overrides` is still the npm field, and the `pnpm-workspace.yaml` overrides stay out of scope. On the same tree v12 `list-mismatches` and v15 `lint` both exit 0 over the same 1,137 instances: 524 ignored, 613 valid (519 `catalog:` references, 94 literals). **(d) The reds**, each exit 1 and restored byte-exact by checksum: a `catalog:` reference replaced by a literal, a caret on a literal, two literal versions of `cross-env`, and the first again through the workflow step's own `run:` line ([§Gates](#gates))                                                                                                                                 | Edward | 2026-10-03 |
| D35 | Root devDependencies that nothing invokes or that a tool already in the tree covers, their callers, and `cross-env` declared as a literal in two manifests | keep them and their chains · bump them · remove each one proven dead or covered, repoint or delete its callers, and move `cross-env` into the catalog                                                   | **Remove each one proven dead or covered** (Edward, 2026-10-03, the replacement plan). **(a) Removed, each measured.** `loadtest` 8.2.1 and `@hey-api/client-fetch` 0.13.1 had no caller; client-fetch is npm-deprecated (bundled in openapi-ts since 0.73), and openapi-ts 0.97.3 emits byte-identical types from one spec with and without it. `@ast-grep/cli` 0.42.0: never invoked; its `allowBuilds` entry left too, and task 0.15.1 no longer bumps it. `depcheck` 1.4.7 (repository archived): both callers defer to knip, the CI gate. **(b) `license-checker` 25.0.1 (2019) → `pnpm licenses list`** (whole workspace) in four callers. `security-scan.sh` now evaluates SPDX AND/OR instead of substrings, and a license finding no longer downgrades a failed audit: on a planted failed audit the original gave WARNING, rc 0, and the new one FAILED, rc 1. **(c) `cross-env`** enters the catalog at 10.0.0, still held by canon row `vite`. **(d) All three root copies resolved.** `fastify-type-provider-zod` and `@axe-core/playwright` removed: their importers declare them. `@types/opossum` moved to `db-prisma` and `external-apis`, which import `opossum` (no bundled types) and had resolved the root copy: with it gone, `tsc -b` builds both, 0 TS7016. **(e) Lockfile.** 93 packages and snapshots removed, none added, deprecated 39 → 32; `braces` 7 → 6 paths; holds population 50 → 47, lags 25 → 24. **(f) Repairs found while measuring:** `run-quality-checks.sh` had not parsed since Genesis (an unclosed quote); 3 strict-mode errors in `bundle-analyzer.ts`; the dependency ignores and entry patterns knip flags as redundant. **(g)** Five documents naming them as present corrected. **(h)** `bundleAnalyzer.test.ts`, via a `CommandRunner` seam                                       | Edward | 2026-10-03 |
| D36 | Overrides and `allowBuilds` entries that name packages the lockfile no longer resolves, and the `uuid` override, which had no canon row                    | keep them as harmless · delete each one proven to pin nothing · for `uuid`, keep it as a CVE floor with a canon row, or drop it as a de-dup pin                                                         | **Delete each one proven to pin nothing; keep `uuid` as a CVE floor** (Edward, 2026-10-03, the replacement plan). **(a) Overrides removed.** `shell-quote`, `xmlhttprequest-ssl`, `@hono/node-server`, `@smithy/config-resolver`, `hono`, `markdown-it` and `serialize-javascript`: the parsed lockfile holds no snapshot of any of them, so each pinned nothing, and ADR-0018 drops such an override. Each left with a carrier, dated by the lockfile history: `shell-quote` with `concurrently`, `markdown-it` and `serialize-javascript` the same day (2026-06-19), `@smithy/config-resolver` with the S3 SDK bump (2026-07-21), `hono` and `@hono/node-server` with Prisma 7.9.1 (2026-08-17); `xmlhttprequest-ssl` never appears in it. **(b) `uuid` is a CVE floor.** Without its override, `@google-cloud/storage` and `hyperid` (`^8`) and `gaxios` and `teeny-request` (`^9`) resolve 8.3.2 and 9.0.1, inside GHSA-w5hq-g745-h8pq (moderate, fixed 11.1.1, no 8.x or 9.x fix), and `pnpm audit` exits 1; restored, the lockfile is byte-identical. It keeps the override and gains the canon row it lacked. **(c) `allowBuilds` entries removed:** `bcrypt`, `contextify` and `unrs-resolver`, absent from the lockfile; Edward authorized it explicitly on 2026-10-03 ("si borralas") after the permission classifier refused it in slice (i-a). `pnpm ignored-builds` lists 11 denials, down from 14. **(d) Measured.** The lockfile changes only in its `overrides:` mirror (seven keys), no package or snapshot; `pnpm audit` reports the same 4 ignored advisories before and after; `pnpm peers check` prints the same output. The canon rows `hono` and `@hono/node-server` become removal traces and the `shell-quote` hold row moves into the holds table's note                                                   | Edward | 2026-10-03 |
| D37 | `image-size` 2.0.2: its two high advisories were ignored on the claim that no fix existed, while 2.0.3 and 2.0.4 had been published on 2026-09-14          | keep the ignores, the gate making the parsers unreachable · move to the minimal patched 2.0.3 · move to the latest mature 2.0.x and delete both ignores                                                 | **Move to the latest mature 2.0.x and delete both ignores** (Edward, 2026-10-03, the replacement plan). **(a) The ignores were false.** GHSA-w3rx-r6r6-pgpr (ICNS) and GHSA-5p2g-fcmc-qvqq (JXL and HEIF), both high infinite-loop DoS, are vulnerable `<=2.0.2` and fixed in 2.0.3 per OSV and GitHub, and `dependency-audit-policy.md` admits only advisories with no upstream fix. **(b) The version is 2.0.4, measured rather than picked:** published 2026-09-14T16:38Z, `latest`, OSV-clean, and ADR-0018 keeps a direct dependency at its latest stable release once past the 7-day buffer. Over 2.0.3 it adds one bound check on the ICO/CUR image count; 2.0.3 itself moved the build from tsup to tsc and relocated `dist/` behind an unchanged export map. **(c) Proof.** Without the ignores, `pnpm audit --audit-level moderate` exits 0 with 2 ignored (`elliptic`, `braces`); with the catalog put back to 2.0.2 it exits 1 naming both, and the restored files match their checksums. A crafted ICNS buffer hangs 2.0.2 until a 5 s timeout kills it and makes 2.0.4 throw. **(d) The magic-byte gate stays** in `BlueskyClient` as defense in depth; `@providers/bluesky` passes 81/81. **(e) Measured.** The lockfile changes only in `image-size`; the canon's two ignore rows leave and a CVE-floor row records 2.0.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Edward | 2026-10-03 |
| D38 | `secretlint` and its preset 12.3.1 carried `globby` → `fast-glob` → `micromatch` → `braces@3.0.3`, the advisory D33 ignores; 13.x drops that chain         | keep 12.3.1 · move to the latest mature 13.x with its default file selection · move to it and keep 12.3.1's file selection with `--no-gitignore`                                                        | **Move to the latest mature 13.x** (Edward, 2026-10-03, the replacement plan) **and keep 12.3.1's file selection** (measured in the slice). **(a) Version 13.0.6**, published 2026-09-25, 7.8 d old; `latest` 13.0.7 (2026-10-03T01:06Z) is immature. OSV lists nothing for any of the 15 packages it adds; engines `node >=22.0.0` (runtime 24.15.0). **(b) Lockfile.** 15 packages out, 15 in: `globby`, `slash` and `@sindresorhus/merge-streams` leave, `@secretlint/walker`, `ignore` 7.0.12 and `picomatch` 4.0.7 arrive, `p-map` 7.0.4 → 7.0.8; `pnpm dedupe` moves 10 more consumers to `picomatch` 4.0.7 and one to `ignore` 7.0.12, 0.9 d old: natural resolution, as ADR-0018 allows no transitive override without a CVE. `fast-glob` remains only under `jscpd`; `braces` 6 → 5 paths; deprecated stays 32. **(c) Selection.** 13.x reads `.gitignore` into the same ignore level as `.secretlintignore`, last, so its `!.env.example` negations re-include the env templates: unflagged, the old `secret:scan` arguments exit 1 on their example connection strings, lint-staged and the hook block any edit of them, and 316 git-ignored files leave the scan. With `--no-gitignore` in all three callers, 13.0.6 selects exactly 12.3.1's 2,719 files. **(d) `'.env*'` removed:** it selects 0 files on 12.3.1 and on 13.0.6 with the flag. **(e) Hook.** The escaped path became "Not found target files" on 13.x for every `[id]`, `[...path]` and `(group)` route, an exit 2 on clean files; it now passes it verbatim with `--no-glob`, as lint-staged does, pinned by `test_post_edit.py`; 13.x reads existing paths literally without it (measured). **(f) The `@secretlint/node` patch** moves to 13.0.6 byte-identical (its target file is unchanged, same patch hash).                                      | Edward | 2026-10-03 |
| D39 | `jscpd` 4.0.8 gated a 4.84% duplication threshold that never scanned a `.tsx` file; 5.x is a Rust binary with a clone-fingerprint baseline                 | keep 4.x with the format name fixed · move to the latest mature 5.x on a threshold · move to it with a baseline that fails every new clone                                                              | **Move to the latest mature 5.x with a fingerprint baseline** (Edward, 2026-10-03, option A of the replacement plan). **(a) Version 5.3.2**, published 2026-09-23T11:28Z; 5.3.3 (2026-09-28) and `latest` 5.4.0 (2026-09-30) are immature. A Rust binary: the wrapper has no dependency and no install script, only eight platform packages; OSV lists nothing for it. **(b) Lockfile.** 61 snapshots out (`@jscpd/*`, `pug` ×12, `fast-glob`, `blamer`, `reprism`, …), 9 in; `fast-glob` leaves the tree; `braces` 5 → 4 paths; deprecated stays 32. **(c) Scope.** `typescriptreact` is a format in neither version: 4.x skipped every `.tsx` in silence, 5.x exits 1 on it. With `tsx` the scan reads 369 `.tsx` files; 5.x drops 4.x's 1,000-line cap, so eight long `.ts` files enter, and the three generated files that cap hid are ignored by name. 105 files of under 50 tokens leave the count, never a clone. The root `jscpd.json`, which neither version reads, is deleted. **(d) Ratchet.** `.jscpd-baseline.json` holds 1,012 clones under 1,004 fingerprints (5.36% of lines); `failOnNewClones: 0` fails a new clone, `failOnEmpty` an empty scan, a missing baseline fails too, and `threshold` is gone. A fingerprint hashes both fragments' text: a line shift keeps it, a whitespace edit inside makes the clone new. **(e) Stale entries fail.** jscpd neither reports nor fails a stale entry, and one lets an identical clone back in; Edward chose to fail them in CI: `scripts/testing/jscpd-baseline-gate.mjs` measures the tree into a scratch baseline and fails every committed count above the current one, remedy `pnpm check:duplicates:update-baseline`. `.jscpd.json` pins `reporters: ["console"]`, so no run writes a file                                                                      | Edward | 2026-10-03 |
| D40 | Two `allowBuilds` entries whose packages declare no build script, and the `@secretlint/node` patch, which unpatched 13.0.6 does not need                   | keep all three · remove the two entries and keep the patch until the 13.0.7 bump re-measures it · remove all three now                                                                                  | **Remove all three** (Edward, 2026-10-03; of the patch: "no me gustan los parches"). **(a) `allowBuilds`.** `"@prisma/client": true` and `sharp: false` leave: the lockfile resolves `@prisma/client` 7.9.1 and `sharp` 0.35.4, and neither declares `preinstall`, `install`, `postinstall` or `prepare` (installed or in the registry), so neither entry decided anything. `pnpm install --force` exits 0 with no ignored build; without `protobufjs`, which has a script, it exits 1 with `ERR_PNPM_IGNORED_BUILDS`. `prisma generate` still runs from the `infra/prisma` postinstall. The map keeps 3 builders and 10 denials, each with a lifecycle script. **(b) The patch.** Its `patchedDependencies` key and file are deleted; the installed `module/index.js` is byte-identical to the registry tarball. Unpatched, the loader resolves the preset by Node's walk from the in-repository virtual store to the root `node_modules`, which `enableGlobalVirtualStore: false` keeps reachable, so the working directory no longer matters (SMELL-20). **(c) Measured.** `pnpm secret:scan` exits 0, and 1 naming `AWSSecretAccessKey` on a planted key; run from `apps/api`, secretlint exits 1 on a planted key and 0 on a clean file, where the patched build exited 2 on both ("rule module not found"); the lint-staged `*` command passes 400 tracked files and 112 route paths and fails the planted key; the 128 hook tests pass. **(d) Lockfile.** The `allowBuilds` removal leaves it byte-identical; the patch removal changes its `patchedDependencies` mirror, the `@secretlint/node` snapshot key and the `secretlint` snapshot naming it. No package version moves. **(e)** `patches/` is gone, so the four Dockerfiles drop `COPY patches/`                                                                     | Edward | 2026-10-03 |
| D41 | The dependency reference documents, which carried 52 stale version cells in each language and named a package the tree no longer has                       | leave them as history · refresh them once and add a gate that fails a stale row · refresh them once and update a row in the change that touches its dependency                                          | **Refresh once, then update a row in the change that touches its dependency** (Edward, 2026-10-03). **(a) Measured.** Every version cell of `DEPENDENCIES.md` and `DEPENDENCIES_ES.md` was compared with `pnpm-lock.yaml` parsed with `yaml.safe_load_all`, importers only: 93 table rows each, 52 stale in each file, one installed version per package, so no row needed a range. **(b) Updated.** The 52 cells, plus the versions named in prose: Next.js and React in the admin paragraph, `axios`, `handlebars`, `class-variance-authority`, and the `pnpm` prerequisite. pnpm comes from `packageManager` (12.6.0, was 11.13.0), TypeScript and Turbo from the lockfile and root manifest (6.0.3, 2.9.16); the Docker table now names the images `docker-compose.yml` runs, `pgvector/pgvector:pg16` and `grafana/grafana:11.2.2`. **(c) A dead name.** The YouTube row named `googleapis` 160.0.0, which the lockfile no longer resolves; it names `@googleapis/youtube` 39.0.1, `@googleapis/youtubeanalytics` 11.0.1 and `google-auth-library` 10.7.0. The `radix-ui` row, which read "(via @packages/ui)", now states 1.4.3. **(d) Rule.** No gate enforces it: each document states at its top that a row is updated in the change that works on its dependency or touches it, and that the lockfile and `pnpm-workspace.yaml` stay the source of truth. **(e)** No package version moves and no gate row changes, so M1 and M7 hold. **(f) Found while refreshing:** the compose table lacked MinIO and its init service, and the workflows list named 7 of 12; both are corrected                                                                                                                                                                                                                                       | Edward | 2026-10-03 |
| D42 | The local battery never ran the duplicate-code gate, so a new clone or a stale baseline entry was seen only by CI, after a push                            | leave the gate to CI · run `pnpm check:duplicates` as a battery step                                                                                                                                    | **Run it as a battery step** (Edward, 2026-10-03). **(a) The step.** `step duplicates pnpm check:duplicates` sits after `knip` and before the suites: the command of the `Duplicate code check (jscpd)` step in the `code-quality` job of `ci.yml`. `PLANNED_STEPS` moves 18 → 19, so a battery that records any other number of steps is RED. **(b) Its log.** On the tree the step exits 0 in under a second and prints the clone list, the summary table, `Found 1012 clones.` and the gate's line that the baseline matches the tree. No line matches the verdict's warning pattern, and no tracked `.ts` or `.tsx` path under `apps/` or `packages/` contains `warn`, so the rule stays as it is (superseded the same day by [D43](#decisions-log)). **(c) Red.** A copied block appended to `apps/api/src/lib/retry/backoff.ts` makes the step exit 1 with the clone `[NEW]`, and the verdict RED, `step duplicates exit 1` (the Duplicate code row of [§Gates](#gates)). **(d) The same input as CI.** All 89 workspace `typecheck` scripts run `tsc --noEmit`, and no gitignored `.ts` or `.tsx` file outside jscpd's `ignore` list exists under `apps/` or `packages/`, here or in the main checkout, so no earlier step hands jscpd a file CI never scans. **(e) Not decided here.** The job's third step, `pnpm check:circular` (madge), is still not in the battery                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Edward | 2026-10-03 |
| D43 | The battery verdict read a path or a flag carrying `warn` as a warning, and `check:circular` skips every import it cannot resolve                          | verdict: keep the word rule · guard the word against path and flag characters; circular gate: leave it on relative imports · resolve every import                                                       | **Guard the word, and resolve every import** (Edward, 2026-10-03). **(a) The rule.** `/\bwarn(ing)?s?\b/i` became `/(?<![\w./-])warn(?:ing)?s?(?![\w/-]\|\.\w)/i`: a letter, digit, `_`, `.`, `/` or `-` glued to the word makes it a path, a file name or a flag (`warning-banner.ts`, `src/warnings/`, `--trace-warnings`), while `warning:`, `[WARN]`, `(422 warnings)` and a sentence-ending `1 warning.` still count. **(b) Categories.** The case-sensitive `/(?<![\w./-])[A-Z][A-Za-z]*Warning(?![\w/-]\|\.\w)/` adds Node's and Python's `DeprecationWarning:` lines, which the old rule never matched: a real warning never passes. **(c) No exception left.** The `--max-warnings 0` exception is gone: the guard already reads that flag as no warning, and the exception could only hide a real warning on the same line. **(d) Measured.** RED first: 6 of 38 cases of `batteryVerdict.test.ts` failed on the old rule; both battery suites, 47 cases, pass on the new one. Over the 29 recorded log directories (468 logs, 111,865 lines) both rules give identical verdicts, reasons and warning lists. **(e) The circular gate, measured.** `pnpm check:circular` reads 2,839 of 6,237 import edges and skips 422 imports, 421 through workspace aliases: a planted `@core/domain` to `@core/accounts` cycle exits 0. madge 8.0.0, the latest, hands parsed options to filing-cabinet 5.5.1, which re-reads them as JSON and drops `module` and `moduleResolution`. A route that resolves every import exists, but its parser then warns, and madge's chain cannot outgrow that without an override. Edward moved the fix to item (v): dependency-cruiser's `no-circular` rule replaces madge once (v) fixes its resolution; until then the battery does not run it                                                  | Edward | 2026-10-03 |
| D45 | Versions that enter the tree inside the 7-day maturity buffer were named in a commit or a canon row and never looked at again                              | rely on the audit and the holds gate · list each one and review it 7 and 14 days after its publication, reminded through a GitHub issue                                                                 | **List each one and review it at 7 and 14 days** (Edward, 2026-10-03). **(a) The list.** `scripts/testing/maturity-watchlist.json` holds per package `version`, `published` (registry), `entered` (date, commit, pull request) and `milestones`, the UTC publish date plus 7 and 14 days, re-derived; `members` makes a release family one review; a `date` entry holds a dated milestone. A review is recorded as clean or flagged, and an entry leaves with its clean 14-day review. **(b) The seed**, measured 2026-10-03T20:45Z over the 2,302 lockfile versions (`yaml.safe_load_all`) and their registry times: `memfs` 4.80.0 and 8 siblings (`dba49d7c`, #325), `next` 16.3.8 and 9 (`dfc52e15`, #325, the approved deviation) and `ignore` 7.0.12 (`fec21f88`, #377), all under 7 days; the 29 lockfile commits since 2026-09-15 add `pnpm` 12.6.0 and 15 and `@googleapis/youtube` 39.0.1 and 1 (`feb371ae`, #305), entered immature, 14-day reviews ahead. Contract task 0.16 is a date entry due 2026-10-28; Phase 0 closes without it. **(c) The gate.** `--check` in the `Dependency Consistency` job refuses a malformed entry, an underived milestone, an early or outcome-less review and a duplicate id ([§Gates](#gates)). **(d) The reminder.** `maturity-reminder.yml` runs `--remind` at 13:00, 17:00 and 21:00 UTC and on `workflow_dispatch`: on a milestone day it opens one `maturity-review` issue per due review, comments while it stays open and skips it once closed, so closing it after recording the outcome cancels the rest of that day. It reads only the issues updated that day and fails closed on a full page, a missing token or an API error. Its first live proof is the first scheduled firing, or a `workflow_dispatch`, after the merge                                               | Edward | 2026-10-03 |
| D46 | Whether Phase 0 can close while task 0.16, date-gated to Node 26's Active LTS on 2026-10-28, is still open                                                 | hold Phase 0 open until 0.16 lands · close it without 0.16, documented, and review 0.16 on its date                                                                                                     | **Close Phase 0 without 0.16** (Edward, 2026-10-03). **(a)** 0.16 moves the runtime to Node 26 on the day it enters Active LTS, 2026-10-28 (Node 24 enters Maintenance on 2026-10-20), and no other task depends on it (the contract's dependency table names it only in its own row), so holding Phase 0 open would only delay Phase 1. **(b)** It stays open and date-gated, with a dated note at its heading in `tasks.md`. **(c)** The maturity watchlist carries it as the date entry `contract-0.16-node-26` ([D45](#decisions-log)): on 2026-10-28 the reminder opens its review issue, when the slice is re-measured and scheduled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Edward | 2026-10-03 |
| D47 | The 24 overrides with neither a SECURITY_CANON row nor a comment: 13 bulk floors, 3 google-auth pins, 7 `catalog:otel` alignments, `msw>path-to-regexp`    | keep them as harmless · measure each one: delete what pins nothing or only de-duplicates, record what holds a CVE floor or a behaviour                                                                  | **Measure each one; delete what pins nothing or only de-duplicates, record the rest** (Edward, 2026-10-03). **(a) List**: 24 of 52, re-measured; per-override table in SECURITY_CANON §"Override audit". **(b) Method.** Each removed alone, `pnpm install`, the lockfile parsed; when a snapshot moved, `pnpm audit` and OSV, and for the google-auth and OTel pins the consumers' typecheck, build and tests; every probe restored byte-exact (sha256). **(c) Deleted, 21.** 15 pinned nothing (five only in the importer's specifier), `msw>path-to-regexp` pinned nothing once the global `path-to-regexp` was gone, and `bn.js`, `@tootallnate/once`, `jws`, `@opentelemetry/instrumentation` and `gaxios@7` forced versions outside their consumers' ranges with no advisory and no measured behaviour; `gaxios@7` left with its override-bands gate allowlist entry. **(d) Kept.** `@opentelemetry/core` is a CVE floor: without it `@sentry/node`'s `instrumentation-http` resolves the 2.6.1 it declares, inside GHSA-8988-4f7v-96qf, and `pnpm audit` exits 1. `googleapis-common` and `google-auth-library@10` are compatibility pins (seven TS2769 in `@providers/youtube` without either; both leave when the catalog `google-auth-library` reaches 11.x, green with 11.1.0); the gate's reason says so. **(e) Also.** `@protobufjs/utf8` pinned nothing and left; 32 catalog comments that claimed "latest" (28 false on the day) now state the pin and what is newer. **(f) Delta.** 52 → 30 overrides; the lockfile adds 28 packages and drops 2. `pnpm update -r gaxios` lifts the range consumers to 7.3.1, but `googleapis-common` 8.x and `gcp-metadata` 8.1.3+ pin 7.1.3, keeping its `rimraf@5` chain: deprecated 27 → 28 (`glob@10.5.0`); audit unchanged; M1 and M7 hold                                     | Edward | 2026-10-03 |
| D48 | Where `packages/eslint-plugin-testing` is born: with WU-2.1's classifier, or with slice `0.20`'s handle rule, which P.7 then extends                       | create it in WU-2.1 and keep the handle guard a line-based script · create it in `0.20` with `testing/no-unowned-handle-unref`, and P.7 extends it                                                      | **Create it in `0.20`; P.7 extends it** (Edward, 2026-10-01: the re-plan approved "siempre y cuando no se pisen la cola el uno al otro", after the regex guard was demolished, "si hay que tumbar y rehacer se rehace"). **(a) Why.** The line-based guard of task 0.19.3 was blind to `?.`, casts, split lines, multiple declarators and test tooling outside `tests/`, and every review added one more regex branch, so it never shipped in #325. Ownership is a scope question: the guard is rebuilt as an ESLint rule that resolves a receiver through the scope manager, and an ESLint rule needs a plugin package, the one design §2b already plans for the classifier. **(b) Shape.** ESM with `// @ts-check`, no build script, loadable by jiti and by node; its RuleTester suite runs under its own vitest config, so M1 and M8 each move by one. **(c) One declaration moved.** The suite parses TypeScript, so `@typescript-eslint/parser` is declared by two manifests and moves from a root literal to the catalog at the same 8.70.1; `@typescript-eslint/eslint-plugin` stays a root literal. **(d) What P.7 changes.** P.7.2 adds `classifyFile` and the classifier rules to this package instead of creating it. **(e) Delivered in three pull requests**, each green on its own, because the slice does not fit the 400-line CODE budget (the package with both checks measured 564 raw lines on 2026-10-04) and the owner's standing rule is to split by default: the package with the first check (process-wide enumeration and `unref()` on the process's own handles), then ownership through the scope manager, then the wiring in `eslint.config.ts` with its red proof and its §Gates row; the ownership check landed second, on 2026-10-04                                                                 | Edward | 2026-10-01 |
| D49 | Item (v) after `PR v`: the layer rules, the route modules that resolve from the DI container, and the migration that repairs them                          | hard rules only after every route is repaired · keep route-level resolution as canon (A) · routes receive their dependencies from the root (B), rules now over a shrink-only baseline                   | **B: the rules now, the migration queued** (Edward, 2026-10-05). **(a) The canon, verified.** On the graph `PR v` (#408) resolves, the old boundaries policy rejects 509 edges; checked against Cockburn, Martin, Seemann and the `@fastify/awilix` README, 460 are allowed, 43 are real and 6 needed a decision. Route-level `fastify.container.resolve(TOKENS.X)` is Seemann's Service Locator, and its cost here is fitness #43. **(b) The cut of item (v).** `PR v` (#408: resolution fixed, `no-circular`, `not-to-unresolvable`) → PR2: the layer rules at `error`, a shrink-only baseline with stale entries at `error`, `eslint-plugin-boundaries` retired (SMELL-183) and ARCHITECTURE_CANON §Dependency Injection rewritten, replacing `PR v-b` and `PR v-c` of [§Work units](#work-units) → PR3a: the core's `LoggerPort` (D-R10) → PR3b: R4, R5 and R6. **(c) Queued after N-TEST-1, outside this workstream:** route modules to use cases with composition-root injection, `MASTER_PLAN_ES.md` §5.12 ARCH-1 to ARCH-22: 25 route files ≈ 15,200 CODE lines in 49 slices, the other 51 modules ≈ 1,670, the guards unsized; R3 rides with the outbox slice because it moves fitness #40's floor. **(d) Found by the sizing and its verification, and queued:** DEF-7 to DEF-15, SMELL-194 to SMELL-202. **(e) Recorded in** [ADR-0032](../technical/ADR-0032-architecture-gate-dependency-cruiser.md) and [ADR-0033](../technical/ADR-0033-layer-boundaries-and-composition-root-injection.md). **(f) Delivered 2026-10-05:** PR2 as `PR v-b` (#411) and `PR v-c` (#412); PR3a as `PR v-d1` (#413) and `PR v-d2` (#414); PR3b as `PR v-e1` (#415, R6), `PR v-e2` (#416, R5) and `PR v-e3` (#417, R4, the health routes taking checkers rather than the repository adapter); found outside their scope: DEF-16 to DEF-26. | Edward | 2026-10-05 |
| D50 | Whether a maturity review finished before its milestone may be recorded early, and how its `date` stays honest (pnpm and memfs, both due 2026-10-06)       | wait for 2026-10-06T00:00Z, the memo's plan (A) · date the records 2026-10-06, the milestone, a day after they were written (B) · record them early, a documented exception the list bounds (C)         | **C: early, bounded and documented in the list itself** (Edward, 2026-10-05). **(a) The rule.** A review due within two days may be recorded before its milestone: it carries `early: { reason }`, precedes the milestone by at most `EARLY_DAYS = 2`, and is dated the day it is written, never after the day the list is read. `validate()` refuses a review dated after that day, a review dated before its milestone with no `early` field, an early review more than 2 days early or without a reason, and an `early` field on a review that is not early; `--check`, `--remind` and the `fitness.yml` step apply the same rules. **(b) Not taken.** (A) leaves two finished reviews out of the list until the milestone; (B) is the `date` the memo refused as dishonest, a day after the record was written, which the list had no upper bound to catch. **(c) What stays due.** An early review counts as recorded, and the later milestone still happens: memfs 4.80.0's 14-day review on 2026-10-13; pnpm 12.6.0, `flagged`, stays on the list until the `packageManager` bump takes it out of the tree. **(d) Evidence.** `maturityWatchlist.test.ts` was red on 14 of its 68 tests before the change and is green after; four mutants of `scripts/testing/maturity-watchlist.mjs` (an early review not counted as recorded, the 2-day bound made inclusive, `--check` or `--remind` reading the UTC date instead of `--today`) each turn it red; the COMPLETE step's red is in [§Gates](#gates). **(e) Recorded:** pnpm's `final` and memfs's `maturity` reviews, dated 2026-10-05, the registry and OSV re-checked at 14:05Z as they were written.                                                                                                                                                                      | Edward | 2026-10-05 |
| D51 | Whether Phase 0 closes on 2026-10-06 while the story backfill (task 0.22.3) has 248 components left and slice 0.16 waits for 2026-10-28                    | hold Phase 0 open until the backfill and 0.16 land · close it: tick 0.22.3 with PR E as its first slice, name the follow-ups, and keep 0.16 a dated unit                                                | **Close Phase 0 on 2026-10-06** (Edward, 2026-10-06). **(a) The backfill.** Task 0.22.3 is ticked with PR E (#445) as its first slice: the Button, Card and Input stories moved beside their components, badge, label and avatar gained stories, and the `packages/ui` baseline went 40 → 34. Its follow-up slices are named, not run inside Phase 0: the 34 components left in `packages/ui/src/components`, then the 160 of `apps/client/components`, then the 54 of `apps/admin/components` once the admin Storybook is re-created. `pnpm check:stories` (baseline 34 / 160 / 54, #441) and the canon row of #443 govern them, and the alert story written for E and deferred, kept outside the tree, is the first item of the next slice. **(b) Node 26.** Slice `0.16` stays a dated maintenance unit for Node 26's LTS date, 2026-10-28, outside the close, as [D46](#decisions-log) decided; the watchlist entry `contract-0.16-node-26` opens its review issue that day. **(c) Why.** Both open boxes were calendar or scope questions, not readiness gaps: no later phase depends on Node 26 or on the 248 stories, and the ratchet fails a new component that lands without its story. **(d) Recorded.** Tasks 0.15.3, 0.22.3 and 0.22.6 are ticked in `tasks.md`; the slice's §Work units rows carry their pull request numbers; the N-TEST-1 ficha of `MASTER_PLAN_ES.md` states the close and names the follow-up slices; no metric moves (M1 `971 + 8`, M7 `20/20`)                                                                                                                                                                                                                                                                                                                                                    | Edward | 2026-10-06 |

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
| A second resolved `@types/node` major (26.0.0) reaches the tree through open-range transitives. **CONFIRMED on 2026-09-29 and 2026-10-02**: removing `@storybook/test-runner` left 19 of its 37 declarers, 7 via DIRECT importers' devDeps | closing it needs a maintainer decision between a de-dup `overrides` entry — against the dependency model, which DROPS de-dup-only overrides (ADR-0018 §Transitive policy) — and a lockfile-resolution assertion; neither is this slice's to take, and an override added quietly would be the model's own anti-pattern | slice `0.16` / maintainer decision |
| Chaos L2: real-crash infrastructure (`spawn` + `SIGKILL` + restart)                                                                                                                                                                        | invasive, and it needs the single environment contract to exist first                                                                                                                                                                                                                                                 | roadmap §4.1.c → 9                 |
| Packages with no coverage target yet                                                                                                                                                                                                       | the target per package is set by the measured prioritisation, not guessed                                                                                                                                                                                                                                             | 6.N0 (metric M16)                  |
| Two near-identical `a11y.ts` helpers (client and admin)                                                                                                                                                                                    | consolidating them is a refactor with no defect behind it                                                                                                                                                                                                                                                             | 9 (queue)                          |
| `no-floating-promises: off` in test globs contradicts "always await"                                                                                                                                                                       | turning it on needs type-aware linting whose cost on this tree is unmeasured                                                                                                                                                                                                                                          | 9 (queue)                          |
| Nothing typechecks the portals' E2E tree: both `tsconfig.json` exclude the Playwright config and specs (admin `:30`, client `:41`); a probe over the client E2E tree reports 644 pre-existing errors, 0 from 1.63.0 (1.61.1 control: 647)  | outside a version-bump slice, which validates the API it moves and not a tree nothing has ever typechecked; what covers the E2E tree is a config decision                                                                                                                                                             | 6.E (config slice 6.E4)            |
| The secret scan does not read the lines a merge commit introduces while resolving a conflict: `git log -p` shows no diff for merges                                                                                                        | found on 2026-10-02 while disposing the secret-scan findings; reading merge resolutions changes what the scan reads, and the drain (D28) takes nothing new                                                                                                                                                            | —                                  |
| The post-edit hook reports a possible leak on workflow files for connection strings that predate the edit; the commit-time scan passes                                                                                                     | the hook is outside this workstream                                                                                                                                                                                                                                                                                   | hooks backlog                      |

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

**CURRENT, re-measured 2026-10-08T14:58:21Z by `node scripts/testing/holds-gate.mjs`, exit 0 with EMPTY
stderr: of the 49 packages in `scripts/testing/toolchain-population.json` (48 direct, 1 named transitive,
no declared-absent candidate left), 12 sit below latest mature and NOT ONE of them is unheld.**

The count's history, one measurement per line, oldest first — the instant, the number below latest mature,
and what moved it. A slice that moves the count appends its own line.

1. `2026-09-27T17:55:14Z` — **45** (39 unheld, 5 held, 1 ambiguous): the baseline in the paragraph above,
   measured before any slice.
2. `2026-09-27T23:10:56Z` — **41**: after `refound/0-toolchain-holds` wrote the fifteen missing hold rows
   and `refound/0-toolchain-eslint` took the first bump — `eslint` and `@eslint/js` to 9.39.5, the
   `@typescript-eslint` pair to 8.70.0, which dropped the pair out of the set. The run recorded the fall as
   the bump's: a row makes a lag legal, never absent.
3. `2026-09-27T23:57:09Z` — **41**: re-derived after `refound/0-holds-table-fix` corrected the table the
   rows live in; no version moved.
4. `2026-09-28T02:42:36Z` — **41**: slice `0.5` pinned `@types/node` from 25.9.3 to 24.13.6, a HELD lag
   both before and after. A package moved to its own line's ceiling leaves the lag set only when that
   ceiling IS the generic comparator (26.6.2 here), which for a downward pin it never is.
5. 2026-09-30, instant not recorded — **43**, then **41**: the repair slice `0.17` found the
   `@typescript-eslint` pair back in the set, because it matured at `2026-09-28T17:09Z` (the clock class
   this workstream keeps meeting), and took it out again by bumping the pair to 8.70.1.
6. 2026-10-02, instant not recorded — **40**: slice `0.21` took `eslint-plugin-boundaries` to its latest
   mature 7.2.0; slice `0.18`, rebased on top of it, moved no version.
7. `2026-10-02T07:24:51Z` — **39**: slice `0.6` took `tsx` 4.22.4 → 4.23.15, which IS the generic
   comparator, so the package leaves the set outright and its canon row is deleted with it.
8. `2026-10-02T07:39:28Z` — **38**: slice `0.8` took `msw` 2.14.6 → 2.15.0, the latest mature release, so
   the package leaves the set and its canon row is deleted with it.
9. `2026-10-02T09:30:50Z` — **36**: slice `0.7` took `@playwright/test` 1.61.1 → 1.63.0 and
   `@axe-core/playwright` 4.10.2 → 4.13.0, both the latest mature release. One canon row covered both, but
   the set counts packages, so retiring that row removed two lags.
10. `2026-10-02T09:40:50Z` — **32**: slice `0.9` took the testing-library family to its latest mature
    releases — `dom` 10.4.2, `jest-dom` 7.0.1, `react` 16.3.3, `user-event` 14.6.7 — and retired the one
    canon row that covered all four, so four lags left together.
11. `2026-10-02T10:13:15Z` — **27**: slice `0.11` took the Storybook family 10.4.6 → 10.6.0, the latest
    mature release, so its four packages left the set, and removed `@storybook/test-runner`, a held lag, so
    the population shrank 52 → 50 (the runner and the `jest` absence entry) and five lags left together.
12. `2026-10-02T20:43:59Z` — **25**: slice `0.12` took `jsdom` 29.1.1 → 30.1.1 and `isomorphic-dompurify`
    3.19.0 → 4.4.0, both the latest mature release, under human gate H1; the canon row `jsdom`, which held
    both, was deleted with them. Slice `0.13` had re-measured **27** at `18:53Z` without moving a version.
13. `2026-10-03T06:26:08Z` — **24**: the dead-devDependency removal ([D35](#decisions-log)) took
    `@ast-grep/cli`, a held lag, out of the tree, together with `@hey-api/client-fetch` and `loadtest`, both
    at latest, so the population shrank 50 → 47 and one lag left; the canon row `knip` lost that one name.
14. `2026-10-03T09:06:43Z` — **22**: slice (iii) took `secretlint` and its preset 12.3.1 → 13.0.6, the
    latest mature release ([D38](#decisions-log)), so both left the set and the canon row `knip` lost
    their two names.
15. `2026-10-03T10:03:06Z` — **21**: slice (iv) took `jscpd` 4.0.8 → 5.3.2, the latest mature release
    ([D39](#decisions-log)), so it left the set and the canon row `knip` lost its name.
16. `2026-10-04T05:07:09Z` — **15**: slice `0.14` took the build and format six to their latest mature
    releases — `vite` 8.0.16 → 8.3.1, `turbo` 2.9.16 → 2.11.4, `webpack` 5.106.2 → 5.111.1, `cross-env`
    10.0.0 → 10.1.0, `jiti` 2.6.1 → 2.7.0, `prettier` 3.9.5 → 3.9.9 — and deleted the canon row that held all
    six, so six lags left together; `vite` and `turbo` carry PRE-REGISTERED rows for the releases still inside
    the buffer.
17. `2026-10-04T05:41:03Z` — **9**: slice `0.15` took five quality-gate tools, six packages (`size-limit`
    and its preset move as one), to their latest mature releases — `knip` 6.12.2 → 6.38.0, `size-limit` and
    its preset 12.1.0 → 14.0.1, `lint-staged` 16.4.0 → 17.6.0, `@hey-api/openapi-ts` 0.97.3 → 0.99.0,
    `@faker-js/faker` 10.5.0 → 10.6.0 — and replaced the canon row that held them with what still lags, so
    six lags left together. `dependency-cruiser` kept a row of its own until item (v) of the replacement
    plan moved it to 18.4.0 on 2026-10-05 (`PR v`); since then that row is the PRE-REGISTERED hold until
    18.5.0 matures on `2026-10-07T19:18Z`, taken as a hold-bump PR. `knip` and `size-limit` carry
    PRE-REGISTERED rows: a newer release of each is already published and becomes the latest mature one
    when it leaves the 7-day buffer.
18. `2026-10-04T19:00:54Z` — **9**: `size-limit@14.1.0` matured at `13:10Z`, which raised the count to
    **11** (measured `18:59:12Z`, both packages held by their PRE-REGISTERED row); the bump of `size-limit`
    and its preset 14.0.1 → 14.1.0 took them back out, and their canon row and watchlist date entry were
    deleted with it.
19. `2026-10-06T13:37:20Z` — **12**: the hold bump took `jscpd` 5.3.2 → 5.3.3, the latest mature release, so
    it left the set; the same run with 5.3.2 installed measures **13** over 50 packages. Since line 18,
    `turbo` 2.11.5, `jscpd` 5.3.3 and `msw` 3.0.0 matured, each held by its row; PR C of slice `0.22`
    enrolled `@vitest/browser` and `@vitest/browser-playwright` at 4.1.11, held by the `vitest` row, with
    `@storybook/addon-vitest` and `@storybook/nextjs-vite` at latest mature and `playwright` now direct; and
    item (v) took `dependency-cruiser` to 18.4.0. The canon row `jscpd` is now the PRE-REGISTERED hold until
    5.4.0 matures on `2026-10-07T18:11Z`.
20. `2026-10-06T20:39:02Z` — **12**: the hold bump took the Storybook family, six packages, 10.6.0 → 10.6.1,
    the latest mature release, so all six left the set and the canon row `storybook` was deleted with them
    ([D25](#decisions-log)); 10.6.1 is `latest` and only 11.0.0 prereleases are newer, so nothing is
    pre-registered. The same gate with 10.6.0 installed measures **18** at `20:35:39Z`: the six matured
    between `17:14Z` and `17:20Z`, each held by that row until the bump. Since line 19 the population fell
    50 → 49: the admin Storybook removal (slice `0.22`, PR D) took `@storybook/nextjs` and `webpack` out,
    neither a lag, and PR E enrolled `@storybook/react` at 10.6.0, a lag held by that row from the moment
    its 10.6.1 matured at `17:19Z`.
21. `2026-10-07T15:27:33Z` — **12**: the hold bump took `knip` 6.38.0 → 6.39.0, the latest mature release,
    so it left the set; the same gate with 6.38.0 injected through `--installed` measures **13** at
    `15:22:47Z`, because 6.39.0 matured at `12:46Z` and the canon row `knip` held it until the bump. Since
    line 20 the population and the twelve lagging packages are unchanged; only targets moved inside held
    lags: the `vitest` family's 5.0.3 matured at `11:30Z` and `msw` 3.0.1 at `12:39Z`, each still held by
    its row. The canon row `knip` is now the PRE-REGISTERED hold until 6.40.0 matures on
    `2026-10-13T16:07Z`.
22. `2026-10-07T18:16:09Z` — **12**: the hold bump took `jscpd` 5.3.3 → 5.4.0, the latest mature release
    and also `latest`, so it left the set; the same gate with 5.3.3 still installed measures **13** at
    `18:12:08Z`, because 5.4.0 matured at `18:11Z` and the canon row `jscpd` held it until the bump. Since
    line 21 the population and the twelve lagging packages are unchanged, and no held target moved.
    Nothing newer than 5.4.0 is published, so nothing is pre-registered: the canon row `jscpd` was deleted
    with the bump, as [D25](#decisions-log) decided for the Storybook family.
23. `2026-10-07T19:20:17Z` — **12**: the hold bump took `dependency-cruiser` 18.4.0 → 18.5.0, the latest
    mature release and also `latest`, so it left the set; the same gate with 18.4.0 still installed measures
    **13** at `19:19:07Z`, because 18.5.0 matured at `19:18Z` and the canon row `dependency-cruiser` held it
    until the bump. Since line 22 the population and the twelve lagging packages are unchanged, and no held
    target moved. Nothing newer than 18.5.0 is published, so nothing is pre-registered: the canon row
    `dependency-cruiser` was deleted with the bump, as [D25](#decisions-log) decided for the Storybook family.
24. `2026-10-08T14:58:21Z` — **12**: the CVE floor took `vite` 8.3.1 → 8.3.3, above the latest mature 8.3.2,
    so it left the set; the same gate with 8.3.1 still installed measures **13** at `14:47:26Z`, because 8.3.2
    matured at `10:17Z` and the canon row `vite` held it until the bump. 8.3.2, the release that row had
    scheduled, is inside the range `>=8.3.0 <=8.3.2` of three `vitejs/vite` repository advisories that OSV
    and `pnpm audit` do not carry yet, so the pin took 8.3.3, the minimal patched version, 2.4 days after
    publication: a CVE floor taken over the buffer (CVE-floor row `vite`); its early-adoption entry in
    `scripts/testing/maturity-watchlist.json` lands in the follow-up commit of its pull request, once the
    number exists (the entry records the commit and the pull request, as #421 and #431 did). Since line 23 the population and the twelve lagging packages
    are unchanged; one held target moved: `turbo` 2.11.6 matured at `03:58Z`, still held by its row. The canon
    row `vite` is now the PRE-REGISTERED hold until 8.3.4 matures on `2026-10-15T12:07Z`.

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

| dep                                 | installed               | latest mature (published)                                                                                                                         | documented hold (yes/no — where)                                                                                                                                                                                                                                                                                                                                                                                | CVE floor                                                                           |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `vitest`                            | 4.1.11                  | 5.0.2 (2026-09-25), mature since 2026-10-02 (re-measured 2026-10-06; it read 5.0.1 when measured 2026-09-27). **v4 ceiling = 4.1.11 = installed** | **held** — canon row `vitest` (the `@vitest/*` peers move with it). Staying on 4 is signed (D20) and reasoned in research; the row is what a gate can read                                                                                                                                                                                                                                                      | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met; a floor, not a ceiling         |
| `@vitest/coverage-v8`               | 4.1.11                  | 5.0.1 (2026-09-15) — exact peer of the runner, moves in lockstep                                                                                  | **held** — canon row `vitest`, which names it                                                                                                                                                                                                                                                                                                                                                                   | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/ui`                        | 4.1.11                  | 5.0.1 (2026-09-15) — same family lock                                                                                                             | **held** — canon row `vitest`, which names it                                                                                                                                                                                                                                                                                                                                                                   | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/browser`                   | 4.1.11                  | 5.0.2 (2026-09-25) — the family's v5 line, held with the runner (row `vitest`); measured 2026-10-06                                               | **held** — canon row `vitest`, which names it; runs the client stories in Chromium since 2026-10-05 (slice `0.22`)                                                                                                                                                                                                                                                                                              | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/browser-playwright`        | 4.1.11                  | 5.0.2 (2026-09-25) — the same family lock (row `vitest`); measured 2026-10-06                                                                     | **held** — canon row `vitest`, which names it; the Playwright provider of the stories run, `playwright` its required peer                                                                                                                                                                                                                                                                                       | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/eslint-plugin`             | 1.6.27 since 2026-10-02 | **1.6.27 (2026-08-10, 53.3 d) — latest mature**, added by slice `0.10`, at `2026-10-02T09:46Z`                                                    | **no** — no lag; an ADDITION, declared as a root devDependency LITERAL (one manifest, ADR-0018), never a catalog entry                                                                                                                                                                                                                                                                                          | —                                                                                   |
| `@playwright/test`                  | 1.63.0                  | **1.63.0 (2026-09-04, 27.4 d) — latest mature** since 2026-10-02 (slice `0.7`), at `2026-10-02T09:27Z`                                            | **no** — no lag; the canon row `@playwright/test` was DELETED by slice `0.7`, its own remove-when met                                                                                                                                                                                                                                                                                                           | —                                                                                   |
| `playwright` / `playwright-core`    | 1.63.0                  | **1.63.0 (2026-09-04)**                                                                                                                           | **no** — no lag; `@playwright/test` 1.63.0 pins `playwright` at its own exact version, so both moved with the runner. Since 2026-10-05 `apps/client` also declares `playwright` through the catalog, atomic with `@playwright/test` (one value, so the pair cannot drift), as the required peer of `@vitest/browser-playwright`, so the population lists it with no absence; `playwright-core` stays transitive | —                                                                                   |
| `@axe-core/playwright`              | 4.13.0                  | **4.13.0 (2026-08-11, 51.7 d) — latest mature** since 2026-10-02 (slice `0.7`), at `2026-10-02T09:27Z`                                            | **no** — no lag; deleted with the canon row `@playwright/test`, which named it too                                                                                                                                                                                                                                                                                                                              | —                                                                                   |
| `msw`                               | 2.15.0                  | 3.0.0 (2026-09-28) — mature since `2026-10-05T15:45Z`; `latest` 3.0.1 matures `2026-10-07T12:39Z`                                                 | **held** since `2026-10-05T15:45Z` — canon row `msw`: slice `0.22` chose vitest browser mode (`@storybook/addon-vitest` + `@vitest/browser 4.1.11`); `@vitest/mocker 4.1.11` peers `msw ^2.4.9` and browser-mode module interception loads `msw/browser`, so msw 3 waits for a `@vitest/mocker` whose peer admits 3.x — re-read on the day                                                                      | —                                                                                   |
| `jsdom`                             | 30.1.1                  | **30.1.1 (2026-09-22, 10.8 d) — latest mature** since 2026-10-02 (slice `0.12`), at `2026-10-02T20:22Z`                                           | **no** — no lag; the canon row `jsdom`, which carried all three crossings, was DELETED by slice `0.12`                                                                                                                                                                                                                                                                                                          | `undici` override deleted (no 7.x left); `tough-cookie` scoped to `<4.1.3`          |
| `isomorphic-dompurify` (PRODUCTION) | 4.4.0                   | **4.4.0 (2026-09-25, 7.1 d) — latest mature** since 2026-10-02 (slice `0.12`), at `2026-10-02T20:22Z`                                             | **no** — no lag; deleted with the canon row `jsdom`, which named it                                                                                                                                                                                                                                                                                                                                             | `dompurify` 3.4.16 (CVE-floor row `dompurify`) — met by 4.4.0's `dompurify ^3.4.12` |
| `@testing-library/react`            | 16.3.3                  | **16.3.3 (2026-08-27, 35.7 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                            | **no** — no lag; the canon row `@testing-library/dom`, which named all four, was DELETED by slice `0.9`                                                                                                                                                                                                                                                                                                         | —                                                                                   |
| `@testing-library/dom`              | 10.4.2                  | **10.4.2 (2026-09-13, 18.6 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                            | **no** — no lag; deleted with that same canon row, the one it was named first in                                                                                                                                                                                                                                                                                                                                | —                                                                                   |
| `@testing-library/jest-dom`         | 7.0.1                   | **7.0.1 (2026-08-09, 53.4 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                             | **no** — no lag; deleted with that same canon row; 7.0.1 adds an OPTIONAL `vitest` peer, met by 4.1.11                                                                                                                                                                                                                                                                                                          | —                                                                                   |
| `@testing-library/user-event`       | 14.6.7                  | **14.6.7 (2026-09-02, 30.3 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                            | **no** — no lag; deleted with that same canon row, which named it too                                                                                                                                                                                                                                                                                                                                           | —                                                                                   |
| `@faker-js/faker`                   | 10.6.0                  | **10.6.0 (2026-08-14, 50.5 d) — latest mature** since 2026-10-04 (slice `0.15`)                                                                   | **no** — no lag; deleted with the shared quality-gate canon row that named it. Its CVE-floor row now pins 10.6.0, the latest stable, over the minimal patched 10.5.0                                                                                                                                                                                                                                            | 10.5.0 (CVE-floor row `@faker-js/faker`) — met by 10.6.0                            |

### Types, runtime and transpiler

| dep           | installed | latest mature (published)                                                                                                                                                                                                            | documented hold (yes/no — where)                                                                                                                                                                                                                                                                                           | CVE floor |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `typescript`  | 6.0.3     | 7.0.2 (2026-07-08, 81.1 d). **v6 ceiling = 6.0.3 = installed**                                                                                                                                                                       | **held** — canon row `typescript`; the catalog comment that called 6.0.3 "latest stable" was corrected 2026-09-27 and now points at that row                                                                                                                                                                               | —         |
| `@types/node` | 24.13.6   | 26.6.2 (2026-09-19) against the generic comparator; **runtime-major (24.x) ceiling 24.13.6 (2026-09-19) — installed = ceiling** since slice `0.5`, re-measured `2026-09-28T02:42:36Z` (`24.19.0`, 2026-09-25, is 2.2 d and immature) | **held** — canon row `@types/node`, REWRITTEN 2026-09-28 to state the runtime major instead of a target. The remaining lag is against the GENERIC comparator only, and it is now a GATED decision rather than a drift: `scripts/testing/engines-node-gate.mjs` refuses a pin whose major differs from the declared runtime | —         |
| `tsx`         | 4.23.15   | **4.23.15 (2026-09-20, 12.0 d at `2026-10-02T07:22Z`) — installed = latest mature since slice `0.6`**                                                                                                                                | **no** — no lag; the canon row `tsx` was DELETED by that slice, its own remove-when met                                                                                                                                                                                                                                    | —         |

### Lint and formatting

| dep                                | installed | latest mature (published)                                                                | documented hold (yes/no — where)                                                                                                                                               | CVE floor |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `eslint`                           | 9.39.5    | 10.11.0 (2026-09-18, 9.1 d). **v9 ceiling 9.39.5 = installed**, the line's final release | **held** — canon row `eslint`, rewritten 2026-09-27; the 9.36.0 → 9.39.5 gap that row did not cover is closed by the bump                                                      | —         |
| `@eslint/js`                       | 9.39.5    | 10.0.1 (2026-02-06, 233.0 d). **v9 ceiling 9.39.5 = installed**                          | **held** — canon row `@eslint/js`, written 2026-09-27; a root `package.json` literal, not a catalog entry                                                                      | —         |
| `@typescript-eslint/parser`        | 8.71.0    | **8.71.0 (2026-09-28)** — latest stable; **latest mature** from `2026-10-05T17:09Z`      | **no** — no lag; taken 2026-10-05, a few hours before maturity, on Edward's instruction, tracked in `scripts/testing/maturity-watchlist.json`; its canon row was DELETED       | —         |
| `@typescript-eslint/eslint-plugin` | 8.71.0    | **8.71.0 (2026-09-28)** — latest stable; **latest mature** from `2026-10-05T17:13Z`      | **no** — no lag; moved with the parser (its peer `^8.71.0`): same watchlist entry, same deleted canon row; its `typescript` peer `>=4.8.4 <6.1.0` still keeps TypeScript 7 out | —         |
| `eslint-plugin-react`              | 7.37.5    | 7.37.5 (2025-04-03) — no lag, and no newer release exists                                | n/a. Its peer `eslint: … \|\| ^9.7` is half the reason eslint stays on 9                                                                                                       | —         |
| `eslint-plugin-jsx-a11y`           | 6.10.2    | 6.10.2 (2024-10-26) — no lag, and no newer release exists                                | n/a. Its peer `eslint: … \|\| ^9` is the other half                                                                                                                            | —         |
| `eslint-plugin-boundaries`         | removed   | 7.2.0 (2026-08-09) — no longer measured: removed from the tree                           | n/a — **removed** in `PR v-c` (2026-10-05), dependency-cruiser's rules in its place (SMELL-183 closed); 7.1.0 → 7.2.0 by slice `0.21` on 2026-10-02 (SMELL-66)                 | —         |
| `prettier`                         | 3.9.9     | **3.9.9 (2026-09-23, 10.9 d) — latest mature** since 2026-10-04 (slice `0.14`)           | **no** — no lag; deleted with the six-tool canon row, which named it; 3.9.9 reformats no file (`pnpm format:check` exit 0 before any edit)                                     | —         |

### Build and orchestration

| dep                    | installed | latest mature (published)                                                                    | documented hold (yes/no — where)                                                                                                                                                                   | CVE floor                                                                                   |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `vite`                 | 8.3.3     | 8.3.2 (2026-10-01, 7.2 d); **8.3.3 installed above it**, a CVE floor taken at 2.4 d          | **no** lag today; **held** from `2026-10-15T12:07Z`, when 8.3.4 matures — canon row `vite`, PRE-REGISTERED; the 8.3.2 it scheduled is inside the advisories' range                                 | 8.3.3 (CVE-floor row `vite`), over the buffer; `postcss` moves to 8.5.29 with 8.3.4         |
| `@vitejs/plugin-react` | 5.1.4     | 6.1.1 (2026-08-28, 30.6 d). **v5 ceiling 5.2.0 (2026-03-12)**, published 11 min before 6.0.0 | **held** — canon row `@vitejs/plugin-react`; the catalog comment beside that entry only explains why the package exists                                                                            | —                                                                                           |
| `turbo`                | 2.11.4    | **2.11.4 (2026-09-24, 9.3 d) — latest mature** since 2026-10-04 (slice `0.14`)               | **no** lag today; **held** from `2026-10-05T00:45Z`, when 2.11.5 matures — canon row `turbo`, PRE-REGISTERED by slice `0.14`; scheduled to the latest mature 2.11.x, a root `package.json` literal | —                                                                                           |
| `webpack`              | 5.111.1   | n/a — not a direct dependency since 2026-10-06 (slice `0.22`)                                | **no** — no population entry: the admin Storybook was its one declarer; it stays only as the peer of `@sentry/webpack-plugin@5.3.0` under `@sentry/nextjs`, and next builds with its own copy      | `browserslist` 4.28.7 (CVE-floor row `browserslist`) — range-scoped, in webpack's own chain |
| `cross-env`            | 10.1.0    | **10.1.0 (2025-09-29, 369.5 d) — latest mature** since 2026-10-04 (slice `0.14`)             | **no** — no lag; deleted with the six-tool canon row, which named it                                                                                                                               | —                                                                                           |
| `jiti`                 | 2.7.0     | **2.7.0 (2026-05-05, 151.3 d) — latest mature** since 2026-10-04 (slice `0.14`)              | **no** — no lag; deleted with the six-tool canon row, which named it; a root `package.json` literal, and eslint loads `eslint.config.ts` through it                                                | —                                                                                           |

### Storybook, and the Jest chain it carries

| dep                       | installed | latest mature (published)                                                                                          | documented hold (yes/no — where)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | CVE floor |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `storybook`               | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; the PRE-REGISTERED canon row `storybook` was DELETED with the bump, as [D25](#decisions-log) decided for this family: 10.6.1 is `latest` and only 11.0.0 prereleases are newer, so nothing is left to pre-register. 10.6.0 before it, since 2026-10-02 (slice `0.11`), whose own family row carried a remove-when that could NOT fire: `apps/admin` had zero `*.stories.*` files, its build failed identically at 10.4.6 and 10.6.0, and slice `0.22` removed it on 2026-10-06. The bump is proven by `apps/client`: build exit 0 with 77 index entries (68 stories, 9 docs), `storybook dev --smoke-test --ci` exit 0, and `test:stories` 68 of 68 over 9 files                                                                    | —         |
| `@storybook/addon-a11y`   | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —         |
| `@storybook/addon-docs`   | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —         |
| `@storybook/addon-vitest` | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump. It runs the client stories as vitest browser tests; 10.6.1 widens its optional `vitest`, `@vitest/browser`, `@vitest/browser-playwright` and `@vitest/runner` peers to admit `^5`, still met at 4.1.11                                                                                                                                                                                                                                                                                                                                                                                                                             | —         |
| `@storybook/nextjs`       | —         | n/a — REMOVED since 2026-10-06 (slice `0.22`)                                                                      | **no** — no lag, because the package is gone: `apps/client` moved to `@storybook/nextjs-vite` on 2026-10-05, and `apps/admin`, its last declarer, lost its Storybook on 2026-10-06 — no stories, and a build that exited 1 with `SB_BUILDER-WEBPACK5_0002` at 10.4.6 and at 10.6.0. Its removal took 305 lockfile snapshots out and added none: the webpack builder and its loaders, `node-polyfill-webpack-plugin` with the browserify crypto chain, and `memfs`. The `braces` and `elliptic` audit ignores and the `webpack-dev-middleware` override left with them, each proven orphaned (SECURITY_CANON rows); its canon row was the `storybook` family's, which dropped it and was itself deleted the same day, when the family moved to 10.6.1 | —         |
| `@storybook/nextjs-vite`  | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump. The client's framework: 10.6.1 keeps the peers of 10.6.0, `next ^14.1.0 \|\| ^15.0.0 \|\| ^16.0.0` (16.3.8), `vite` up to `^8` (8.3.1) and `react`/`react-dom` up to `^19`; it brings the deprecated `tsconfck@3.1.6` through `vite-tsconfig-paths`, which it calls only below Vite 8 (SECURITY_CANON §"Compatibility pins")                                                                                                                                                                                                                                                                                                       | —         |
| `@storybook/react`        | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; enrolled at 10.6.0 on 2026-10-06 (slice `0.22`, PR E) and moved with the family the same day, and the canon row `storybook`, which named it, was deleted with the bump. `packages/ui` declares it beside `storybook` for the stories colocated with its components, which the client Storybook runs; 10.6.1 peers `react`/`react-dom` up to `^19` (19.2.7), `storybook ^10.6.1` and `typescript >= 4.9.x` (6.0.3)                                                                                                                                                                                                                                                                                                                   | —         |
| `@storybook/test-runner`  | —         | n/a — REMOVED since 2026-10-02 (slice `0.11`)                                                                      | **no** — no lag, because the package is gone: no workflow and no script invoked it, and its canon row was DELETED with its own remove-when met. Its removal took `jest@30.4.2`, `nyc@15.1.0`, `jest-process-manager@0.4.0`, `wait-on@7.2.0` and `joi@17.13.8` out of the lockfile — 219 of the slice's 230 removed bare keys lie in its dependency closure, and the slice nets −195 once the 10.6.0 set adds 35. The stray `@types/node@26.0.0` keeps 19 of its 37 declarers: 17 `@types/*` packages, `jest-worker@27.5.1` and `protobufjs@7.6.5` (`@types/wait-on` left with the chain) — see [§Declared gaps](#declared-gaps)                                                                                                                      | —         |
| `jest` (transitive)       | —         | n/a — ABSENT from the lockfile since 2026-10-02 (slice `0.11`)                                                     | **no** — no lag, and no population entry either: the canon statement that Jest is not a framework of this repository is now TRUE IN THE TREE. Measured after removal: zero `jest@` keys, zero files importing Jest; the one jest-named package left is `jest-worker@27.5.1`, declared then by `terser-webpack-plugin` and, since 2026-10-06 (slice `0.22`), only by webpack 5.111's `minimizer-webpack-plugin@5.13.0`, under `@sentry/nextjs` > `@sentry/webpack-plugin`                                                                                                                                                                                                                                                                             | —         |

### Repository-quality gates that run in the same workflows

| dep                                            | installed | latest mature (published)                                      | documented hold (yes/no — where)                                       | CVE floor                                                                       |
| ---------------------------------------------- | --------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `knip`                                         | 6.39.0    | 6.39.0 — **no lag** until 6.40.0 matures, `2026-10-13T16:07Z`  | **held** after `2026-10-13T16:07Z` — canon row `knip`, scheduled       | `smol-toml` 1.9.0 by natural resolution; its override deleted with the bump     |
| `jscpd`                                        | 5.4.0     | **5.4.0 (2026-09-30, 7.0 d) — latest mature**, and `latest`    | **no** — no lag; its canon row deleted with the bump                   | —                                                                               |
| `dependency-cruiser`                           | 18.5.0    | **18.5.0 (2026-09-30, 7.0 d) — latest mature**, and `latest`   | **no** — no lag; its canon row deleted with the bump                   | —                                                                               |
| `secretlint`                                   | 13.0.6    | 13.0.6 — **no lag** until 13.0.7 matures, `2026-10-10T01:06Z`  | **held** after `2026-10-10T01:06Z` — canon row `secretlint`, scheduled | —                                                                               |
| `@secretlint/secretlint-rule-preset-recommend` | 13.0.6    | 13.0.6 — same band; 13.0.7 matures `2026-10-10T01:07Z`         | **held** after then — canon row `secretlint`, with `secretlint`        | —                                                                               |
| `size-limit`                                   | 14.1.0    | **14.1.0 (2026-09-27, 7.2 d) — latest mature**, and `latest`   | **no** — no lag; its canon row deleted with the bump                   | —                                                                               |
| `@size-limit/preset-small-lib`                 | 14.1.0    | 14.1.0 — same band, and `latest`                               | **no** — no lag; moves with `size-limit`, whose row was deleted        | —                                                                               |
| `@ast-grep/cli`                                | —         | n/a — REMOVED since 2026-10-03 ([D35](#decisions-log))         | **no** — no lag, because the package is gone: nothing invoked it       | —                                                                               |
| `lint-staged`                                  | 17.6.0    | **17.6.0 (2026-09-26, 8.0 d) — latest mature**, and `latest`   | **no** — no lag; its config validates on 17.6.0 (`--debug`)            | —                                                                               |
| `@hey-api/openapi-ts`                          | 0.99.0    | **0.99.0 (2026-06-22, 104.0 d) — latest mature**, and `latest` | **no** — no lag; regenerated types are byte-identical                  | `js-yaml` 4.3.2 (CVE-floor row `js-yaml`) — that row names this package's chain |
| `@hey-api/client-fetch`                        | —         | n/a — REMOVED since 2026-10-03 ([D35](#decisions-log))         | **no** — no lag: npm-deprecated, bundled in `@hey-api/openapi-ts`      | —                                                                               |

### Load generators, and the one tool with no version to measure

| dep                     | installed                                                                                        | latest mature (published)                                                                              | documented hold (yes/no — where) | CVE floor |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------- | --------- |
| `autocannon`            | 8.0.0                                                                                            | 8.0.0 (2024-10-14) — no lag                                                                            | n/a                              | —         |
| `loadtest`              | —                                                                                                | n/a — REMOVED since 2026-10-03 ([D35](#decisions-log))                                                 | **no** — removed, nothing ran it | —         |
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
   - **Taken 2026-10-02 by slice `0.12` ([D31](#decisions-log)), at 30.1.1 with `isomorphic-dompurify`
     4.4.0, so one jsdom copy serves production.** The runtime floor needed no edit: slice `0.5` had
     already declared `>=24.15.0 <25` in all 98 manifests. `undici` resolves 8.11.2 naturally and its
     7.x override was deleted as inert; `tough-cookie` is range-scoped to `<4.1.3`, so jsdom 30 and msw
     take 6.0.2 while `request`'s chain keeps the floor.
2. **`typescript` 6.0.3 → 7.0.2 — HOLD; there is no Phase 0 slice for it, and that is correct.**
   `@typescript-eslint/parser@8.71.0` and `@typescript-eslint/eslint-plugin@8.71.0` — installed since
   2026-10-05, taken a few hours before their `17:09Z` / `17:13Z` maturity on Edward's instruction and
   tracked in `scripts/testing/maturity-watchlist.json` — still peer `typescript: ">=4.8.4 <6.1.0"`,
   byte-identical to 8.70.0's and 8.70.1's, and so do the 8.71.1 alphas. TypeScript 7 is therefore not
   takeable today at any `@typescript-eslint` version, so the hold row is the deliverable, not a bump. Its
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
   copy, `@types/node@26.0.0`, arrives through open-range transitives. This section first said it would
   leave with `@storybook/test-runner`; slice `0.11` measured that FALSE on 2026-10-02 — 19 of its 37
   declarers survive the removal — so it stays a declared gap (see [§Declared gaps](#declared-gaps)).

### Where each measured lag goes

| Destination                                                              | Packages                                                                                                                                                                                                                                                                                                           | What that slice must prove                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `refound/0-toolchain-holds` (WU-T.4(f))                                  | the vitest trio's hold; the corrected `eslint` and `@storybook/test-runner` rows (slice `0.11` deleted the second); one row per no-slice lag below                                                                                                                                                                 | the gate reads the holds table, fails closed on zero parsed rows, and every surviving remove-when is observable          |
| `refound/0-toolchain-eslint` (WU-T.4(b))                                 | `eslint` **and** `@eslint/js` 9.36.0 → 9.39.5, **and the `@typescript-eslint` pair 8.65.0 → 8.70.0** (re-plan 2026-09-27: the pair had no slice, and bumping it is the only path to the `typescript` row), all in one pull request                                                                                 | `pnpm lint --max-warnings 0` exit 0; both React plugins' peers still resolve; the holds rows rewritten with today's date |
| `refound/0-toolchain-types-node` (WU-T.4(c))                             | **LANDED 2026-09-28.** `@types/node` 25.9.3 → 24.13.6; `engines.node` `>=24.15.0 <25` in all 98 manifests — the floor the plan asked for, with the explicit single-major CEILING the plan's `^24.15.0` left implicit, because the gate compares an exact string and a caret range names no ceiling it could refuse | `pnpm exec tsc -b --force` exit 0; the engines gate red-proven                                                           |
| `refound/0-toolchain-tsx` (WU-T.4(b))                                    | `tsx` 4.22.4 → **4.23.15** (not 4.23.13 — it matured today)                                                                                                                                                                                                                                                        | every `--import tsx` entrypoint still runs; re-measure maturity before pinning                                           |
| `refound/0-toolchain-browser` (WU-T.4(b))                                | `@playwright/test` 1.61.1 → 1.63.0 (with `playwright` / `playwright-core`), `@axe-core/playwright` 4.10.2 → 4.13.0                                                                                                                                                                                                 | LANDED: 1.63 drops Ubuntu 20.04; no CI job runs it (M2 `0`), runners `ubuntu-latest`; Debian 12 proven; image → WU-6.E8  |
| `refound/0-toolchain-msw` (WU-T.4(b))                                    | `msw` 2.14.6 → 2.15.0. msw 3 is a crossing held by the canon row `msw` from `2026-10-05T15:45Z`: ESM-only, and outside the `msw ^2.4.9` peer of `@vitest/mocker` 4.1.11                                                                                                                                            | the suites that already use MSW stay green                                                                               |
| `refound/0-toolchain-rtl` (WU-T.4(b))                                    | `@testing-library/{dom,jest-dom,react,user-event}` — the family moves atomically                                                                                                                                                                                                                                   | LANDED: client 541 + admin 114 green; syncpack 0 over 614, so no split; bare lock keys moved by exactly 4                |
| `refound/0-toolchain-vitest-plugin` (WU-T.4(b))                          | **LANDED 2026-09-28, rebased 2026-10-02.** add `@vitest/eslint-plugin` 1.6.27 as a root devDependency LITERAL — ADR-0018 gives a direct dependency declared in ONE manifest a literal, not a catalog entry — registered in `eslint.config.ts` with ZERO rules enabled                                              | LANDED: zero rules enabled; `vitest/no-focused-tests` resolves and fires only when forced; `eslint` exit 0               |
| `refound/0-toolchain-storybook` (WU-T.4(d) + T.4(e))                     | **LANDED 2026-09-29, rebased 2026-10-02.** `@storybook/test-runner` REMOVED — nothing invoked it — and `jest`, `nyc`, `jest-process-manager`, `wait-on` and `joi` left with it; the `storybook` family 10.4.6 → 10.6.0 atomically; the dead `GHSA-q7cg` ignore deleted                                             | LANDED: Jest absent, 0 files import it; `@types/node@26.0.0` SURVIVES (37 → 19) — plan clause FALSE                      |
| `refound/0-toolchain-jsdom` (WU-T.4(b), **[H1]**)                        | **LANDED 2026-10-02 (#372).** `jsdom` 29.1.1 → 30.1.1, `isomorphic-dompurify` 3.19.0 → 4.4.0; the `undici` override deleted, no 7.x copy left; `tough-cookie` range-scoped to `<4.1.3`                                                                                                                             | all THREE crossings resolved in one pull request, or a hold naming all three                                             |
| `refound/0-toolchain-build` (WU-T.4(b)) — **re-plan 2026-09-27**         | **LANDED 2026-10-04 (#391).** `vite` 8.3.1, `turbo` 2.11.4, `webpack` 5.111.1, `cross-env` 10.1.0, `jiti` 2.7.0, `prettier` 3.9.9; `postcss` 8.5.28 for vite's own range                                                                                                                                           | LANDED: tsc, the builds, lint and `format:check` exit 0; 3.9.9 reformats nothing; vite and turbo pre-registered          |
| `refound/0-toolchain-quality-gates` (WU-T.4(b)) — **re-plan 2026-09-27** | **LANDED 2026-10-04 (#392).** `knip` 6.38.0, `size-limit` + preset 14.0.1 (14.1.0 the same evening), `lint-staged` 17.6.0, `@hey-api/openapi-ts` 0.99.0, `@faker-js/faker` 10.6.0; `dependency-cruiser` stays at 17.4.0 with its own canon row and moves with item (v) of the replacement plan                     | LANDED: every gate keeps its verdict; `du` ignored, ledger 312 → 310; knip pre-registered, size-limit 14.1.0 taken       |
| `workstream/eslint-boundaries-policies` (WU-T.4(b), slice `0.21`)        | **LANDED 2026-10-02.** `eslint-plugin-boundaries` 7.1.0 → 7.2.0, with the `boundaries/dependencies` config migrated to the v7 syntax (SMELL-66) — the package left the no-slice row below when the contract gave it slice `0.21`                                                                                   | `pnpm lint --max-warnings 0` exit 0 with 0 `[boundaries]` lines; every per-layer probe still errors on the bumped plugin |
| **No enumerated slice — a hold row is the deliverable**                  | `typescript` (peer-blocked at every published `@typescript-eslint`), `@vitejs/plugin-react` (crossing), `jest` (left the tree with `@storybook/test-runner` in slice `0.11`, never bumped), and k6's floating tag                                                                                                  | each row carries a measured reason, today's date, and a remove-when that can actually fire                               |

**Two limits of this table, stated rather than discovered later.** (1) It measures DIRECT dependencies
plus the transitives the plan owns by name (`playwright`, and `jest` until slice `0.11` took it out of the tree); a lag reachable only through some
other parent is invisible to it, which is why WU-T.4(f)'s gate reads the same `pnpm outdated -r`
output rather than this prose. (2) "Latest mature" is computed at one instant, and the boundary moves
daily in both directions — `tsx` and `dependency-cruiser` crossed into maturity during the day this
was written, and `size-limit@14.1.0` was published while it was being written. Every slice
re-measures before it pins, per `testing-toolchain-alignment` › _The freshness comparator is "latest
mature", never "latest"_.

---

## OSV measurement (WU-3.7a)

Two measurements, taken with the same method and the same pinned binary. Each is kept as taken; the
decision material rests on the later one. Raw scanner output is not committed.

### The two measurements

| Quantity                                                  | 2026-09-28 (original)                              | 2026-10-02 (rebased)                                         |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Tree                                                      | commit `08b49f4e` (branch `refound/3-osv-measure`) | `91f26952` plus this slice, which changes only this document |
| Instant                                                   | 2026-09-28T11:52Z                                  | 2026-10-02T09:56Z                                            |
| `pnpm-lock.yaml` sha256                                   | `eba24db6…69e3f`                                   | `8456b570…c5d5bff`                                           |
| Packages the scanner read from the lockfile               | 2656                                               | 2684                                                         |
| Scanner                                                   | `osv-scanner` 2.6.0, sha256 `ca69b3d3…85b108`      | the same binary, fetched again by tag, sha256 re-verified    |
| `osv-scanner` advisories · packages                       | 6 · 4                                              | 4 · 3                                                        |
| by severity (GitHub rating)                               | 2 high · 1 moderate · 3 low                        | 2 high · 1 moderate · 1 low                                  |
| `pnpm audit` (`metadata` counts)                          | 6 — 2 listed, 4 ignored                            | 4 — 0 listed, 4 ignored                                      |
| seen by `osv-scanner`, not by `pnpm audit`                | 0                                                  | 0                                                            |
| seen by `pnpm audit`, not by `osv-scanner`                | 0                                                  | 0                                                            |
| covered by `auditConfig.ignoreGhsas` (5 entries)          | 4 of 6                                             | 4 of 4                                                       |
| not covered by any ignore                                 | 2 — both `joi` 17.13.4, low, dev-only              | 0 — `joi` resolves to 17.13.8 since slice `0.17`             |
| **moderate+ that `pnpm audit` misses AND nobody audited** | **0**                                              | **0**                                                        |
| ignore entries that match no finding                      | 1 — `GHSA-q7cg-457f-vx79`                          | 1 — the same                                                 |
| `--all-vulns` output against the default JSON             | byte-identical                                     | byte-identical                                               |
| CI gate form, `pnpm audit --audit-level moderate`         | exit 0                                             | exit 0                                                       |

The binary is the `v2.6.0` release asset `osv-scanner_linux_amd64`, downloaded by tag into a scratch
directory (never installed) and checked against sha256
`ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108`; the original lockfile digest is
`eba24db62503a8a8b9d26e31fc5a289c93344f644b7e9eaef7ea307d03d69e3f`, today's is
`8456b570462e906d6b4a2a8e7fa271030adf6e556ff6fabeebe466676c5d5bff`. `osv-scanner` exits 1 when it has
findings; that is not a failure.

| Command                                                                              | 2026-09-28                                             | 2026-10-02                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| `osv-scanner --lockfile=pnpm-lock.yaml --format=sarif --output-file=…` (the CI form) | exit 1 · 6 results / 6 rules                           | exit 1 · 4 results / 4 rules                   |
| `osv-scanner --lockfile=pnpm-lock.yaml --format=json --output-file=…`                | exit 1 · 6 advisories over 4 packages                  | exit 1 · 4 advisories over 3 packages          |
| `osv-scanner scan source --lockfile=… --all-vulns --format=json`                     | exit 1 · byte-identical to the default JSON            | exit 1 · byte-identical to the default JSON    |
| `osv-scanner scan source -r . --format=json`                                         | exit 1 · 1 Extract call (`pnpm-lock.yaml`), same 6 ids | not repeated                                   |
| `pnpm audit --json`                                                                  | exit 1 · 2 listed; 3 low · 1 moderate · 2 high         | exit 0 · 0 listed; 1 low · 1 moderate · 2 high |
| `pnpm audit --audit-level moderate` (`production-ci.yml:50`)                         | exit 0 · 2 low listed · 4 ignored                      | exit 0 · 4 ignored                             |

### Every finding, classified

| Package            | Advisory · alias                       | Severity       | Audited ignore | Seen by `pnpm audit`     | Reach              | 2026-09-28 | 2026-10-02 |
| ------------------ | -------------------------------------- | -------------- | -------------- | ------------------------ | ------------------ | ---------- | ---------- |
| `image-size@2.0.2` | `GHSA-5p2g-fcmc-qvqq` · CVE-2025-71329 | high (8.7)     | yes            | yes, as an ignored count | **prod-reachable** | yes        | yes        |
| `image-size@2.0.2` | `GHSA-w3rx-r6r6-pgpr` · CVE-2025-71330 | high (8.7)     | yes            | yes, as an ignored count | **prod-reachable** | yes        | yes        |
| `request@2.88.2`   | `GHSA-p8p7-x288-28g6` · CVE-2023-28155 | moderate (6.1) | yes            | yes, as an ignored count | dev-only           | yes        | yes        |
| `elliptic@6.6.1`   | `GHSA-848j-6mx2-7j84` · CVE-2025-14505 | low (5.6)      | yes            | yes, as an ignored count | dev-only           | yes        | yes        |
| `joi@17.13.4`      | `GHSA-6w3j-5fw6-r9vr` · CVE-2026-84368 | low (3.7)      | **no**         | yes, listed by name      | dev-only           | yes        | no         |
| `joi@17.13.4`      | `GHSA-gg4h-3hg2-grpc` · CVE-2026-84367 | low (3.7)      | **no**         | yes, listed by name      | dev-only           | yes        | no         |

An advisory on the ignore list never appears in the audit's `advisories` object but is still counted in
its `metadata`: that is how every finding is provably visible to `pnpm audit` while only the unignored
ones are printed. Reach comes from the lockfile, parsed with `yaml.safe_load_all` (pnpm 12 writes two
documents): one breadth-first walk from every importer's `dependencies`, one from its `devDependencies`,
both through each snapshot's `dependencies` and `optionalDependencies`. Today's closures are 1280 prod and
2012 dev over 2694 snapshot ids (1280 / 1988 / 2666 on 2026-09-28). `image-size` is prod-reachable through
`@providers/bluesky`, the one production caller `SECURITY_CANON.md` names; `request` arrives through root
`jq@1.7.2` › `jsdom@0.2.19`, `elliptic` through `@storybook/nextjs` › `node-polyfill-webpack-plugin`, and on
2026-09-28 `joi` arrived through `@storybook/test-runner` › `jest-process-manager` › `wait-on@7.2.0`.

**Since 2026-10-06 none of these ignores remains**, and the tables above stay as measured: the
`request` ignore left on 2026-10-02 with `jq` ([D32](#decisions-log)), the two `image-size` ignores on
2026-10-03 with 2.0.4 ([D37](#decisions-log)), and the `elliptic` ignore, with the `braces` ignore added
after these measurements ([D33](#decisions-log)), on 2026-10-06 with the admin Storybook (#439).
`auditConfig.ignoreGhsas` is `[]`; WU-3.7(b) re-measures before it decides.

### Findings named, not fixed here

Each was re-checked against the files on 2026-10-02; the first three were still true then, and slice `0.11`
closed the third the same day.

1. **The CI job downloads an unpinned binary.** `audit.yml:107` fetches
   `releases/latest/download/osv-scanner_linux_amd64`, so the version is whatever upstream published
   last. The 2.x line moved to a subcommand CLI (`osv-scanner scan source …`), and the flat `--lockfile`
   form the job uses still works at 2.6.0 (measured above) with nothing guaranteeing the next release.
2. **The job's comment misstates its baseline.** `audit.yml:110` says "baseline has 90 vulns"; the
   measured counts are 6 (2026-09-28) and 4 (2026-10-02), and `--all-vulns` changes neither.
3. **`GHSA-q7cg-457f-vx79` is an orphan ignore whose canon row names the wrong package.** It matches no
   finding on either date. The OSV record names `joi` (CVE-2026-48038, moderate; affected `<17.13.4` and
   `>=18.0.0 <18.2.1`), and the installed `joi` (17.13.4 then, 17.13.8 now) is outside both ranges;
   `SECURITY_CANON.md:254` attributes it to `request`. **CLOSED 2026-10-02 by slice `0.11`**: `pnpm audit`
   returns the same ignored set with and without the entry, both on the lockfile before the removal and on
   the one after it, which holds no `joi` at all, so the entry and its canon row were deleted.
4. **No longer true:** on 2026-09-28 two `low` `joi` advisories sat unignored on that same version; on
   2026-10-02 `joi` 17.13.8 carries none.
5. **The scanner has one thing to read here.** The recursive source scan on 2026-09-28 made exactly one
   Extract call, `pnpm-lock.yaml`: there is no second ecosystem for it to cover.
6. **Two id spaces.** SARIF rule ids are the CVE aliases (today `CVE-2025-71329`, `CVE-2025-14505`,
   `CVE-2023-28155`, `CVE-2025-71330`); the JSON report and `auditConfig.ignoreGhsas` use GHSA ids. An
   ignore file for a gate has to use the id space the scanner matches on.
7. **No `osv-scanner.toml` exists in the tree** (searched by name on both dates).

### Decision material for WU-3.7(b) — stated, not decided

- **The criterion.** Decision D8 keeps OSV-Scanner only if it sees a class `pnpm audit` does not; as a
  measurable test: at least one moderate-or-higher advisory that `pnpm audit` does not see AND that
  nobody has audited.
- **Today's measurement (2026-10-02T09:56Z).** That count is **0**. The advisory sets are identical in
  both directions (4 = 4), and every finding is covered by an audited ignore; no finding is unaudited at
  all. The rebase did not change the conclusion the 2026-09-28 measurement supported (6 = 6, count 0).
- **What follows from the evidence.** The job reads the same lockfile against the same advisory data as
  `pnpm audit`. Keeping it as a real gate means a pinned binary, an `osv-scanner.toml` with one reasoned,
  expiring ignore per audited finding, and removing the `set +e` that swallows its exit code; retiring it
  removes findings 1 and 2 with it. Finding 3 lived in `SECURITY_CANON.md` and `pnpm-workspace.yaml`
  whichever branch is taken, and slice `0.11` closed it in both.

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

**Closed 2026-10-06** ([D51](#decisions-log)). WU-T.1 to WU-T.3 landed on 2026-09-27 (#316, #317), and
WU-T.4 closed with every Phase 0 slice of `openspec/changes/testing-refoundation/tasks.md` but `0.16`,
the last of them `0.22` (#445, #447); [§Work units](#work-units) names each with its pull request.
Slice `0.16`, the move to Node 26, stays a dated unit for 2026-10-28 ([D46](#decisions-log)). The text
below is the plan as signed.

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
  subset scripts of `apps/api/package.json` (lines 21-25 and 27-47 when this was planned), `test:eval` and
  `test:ratelimit`.
  Acceptance: the subset-script grep returns 0; the "files with >1 collector" metric goes 10 → 0.
  CODE ~250 (deletions). PR R3. _(Absorbs WU-4.8.)_ Landed 2026-10-09: the workflow, the job, 22 of
  the 26 node:test scripts, `test:eval` and `test:ratelimit` left, and the metric went 10 → 0.
  `test:{auth,rbac,security,mfa}` stay, so the node:test subset grep returns 4: no workflow runs them,
  but `security/scripts/security-scan.sh` (`security:scan`) and `vulnerability-report.ts`
  (`security:report`) call them, and their removal waits on those callers. The removed job's per-suite
  guards (zero passed, any skipped or cancelled case) live on in `run-tests.sh` per batch under `TIER`;
  a single file collecting zero tests inside a batch that runs others is caught only by the per-file
  verdicts of WU-1.7, which owns that residual.
- **WU-1.4** Move the timing needs into the tests: the four `TIMEOUT=` prefixes of `run-tests.sh`
  (:245, :336, :398, :401) left, and each suite they served declares one `TIMING = { timeout }` and
  passes it to every test and hook: `hardDeleteSerializableRace`, `sagaCrashRecovery`,
  `sagaCompensationRecovery`, `sagaPublishNowPromotion` (120_000), `sagaCustomerFlow` (180_000),
  `publish`/`analytics`/`media`/`schedule.flow` (60_000), 83 tests and 26 hooks. Not on the top
  `describe`, as first planned: on Node 24.15.0 the runner's `--test-timeout` binds every test and
  every hook, and a `describe` option does not raise that limit; it caps the suite's total instead,
  a limit nothing has today. In `tests/security.test.ts` an `after()` in "Advanced Rate Limiting"
  sleeps until the full bucket the limiter announces in `X-RateLimit-Reset` (epoch milliseconds;
  `Retry-After`, whole seconds to a single permit, is the fallback), then polls `${BASE_URL}/health`
  until 200, deadline that instant plus 5 s (cap 90 s), and throws naming its last answer; it adds
  about 60 s to the batch. Measured, the limiter is a token bucket keyed by client IP and exact URL
  (120 per 60 s on `/health`), so a poll that gets 200 spends the permit it finds: polling while the
  bucket refills hands the next caller an empty one. Acceptance, met 2026-10-09: the full-integration
  tier ran 939 tests before and after, every batch with the same count, 0 skipped, 0 cancelled. Reds
  as run: (a) a planted `sleep(45_000)` passes with `TIMING` under `--test-timeout=30000`, and is
  cancelled with `testTimeoutFailure` without it and with the option on the `describe` only; (b) a
  planted probe asserting the next `/health` caller gets 200 fails with 429 without the `after()`
  and passes with it; (c) the poll pointed at a path that never answers 200 fails the hook with its
  message. The planned red, "`production` right after `integration:flows` fails with 429 without the
  `after()`", does not hold: measured, it passes 81 of 81 with no 429 either way, because the bucket
  refills about 2 permits a second while the next files start; WU-1.8's red (a) rests on the same
  premise. CODE ~35 planned, 314 measured (one argument per call, and the 19 long-named tests that
  prettier then breaks out). PR R4.
- **WU-1.5** Rename the node:test population by MEASURED tier: run each of the 98 files (under
  `apps/api/tests` outside unit/eval, the 2 under `tests/chaos` included; the earlier 100 double-counted
  chaos or counted the two tracked non-test files `.disabled` and `.old`) alone, with Postgres and Redis up and
  API and workers down — passes with 0 skips → `.integration.test.ts`; otherwise → `.live.test.ts`;
  also record which pass with services down (hermetic; they feed the ledger and the experiment).
  The measurement is the U5a section above (2026-10-08): 80 → `.integration.test.ts`, 18 →
  `.live.test.ts`, 8 of the 80 hermetic; U5 renames by that table.
  Starting point: `run-tests.sh` puts 52 on the database and 26 in live; a grep heuristic puts 10 of
  the 20 dark ones in live — the measurement decides. `git mv` of the 98; paths in `run-tests.sh`
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
  **Owner decision (d), 2026-10-09 — the interim #30 is accepted, with its exit written down.**
  _Where it lives:_ the `#30` step of `fitness.yml` and the `# 30.` block of CLAUDE.md §Automated
  Compliance Checks, both rewritten by this unit, plus this paragraph. Its count is the files that
  `run-tests.sh --list` collects and that do not run green yet — the dark-live files (18 measured by
  U5a on 2026-10-08) plus every `quarantine.json` entry, each with its reason and owner — and it is a
  ratchet: it may fall and must never rise. The `# 30.` block states that it is interim and names
  WU-1.10 as its retirement. _When it is retired:_ by WU-1.10 (PR R10), which lands after WU-1.9
  (the reach engine, PRs R9a/R9b) and WU-1.8 (the live collector, PR R8); no later. _How:_ WU-1.10
  adds the `test-contracts` job, whose `#30` step derives reach from the collectors themselves —
  every test file has exactly one collector and the unreached files outside the quarantine are 0, a
  hard zero — and deletes the interim step, its baseline and the interim wording of the `# 30.` block
  in the same PR; its five reds (`:1266-1270`) prove the new gate before the old one leaves.
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
  workers mid-run → exit 1 naming the file. Dep: WU-1.7, WU-4b.3. CODE ~200. PR R8. Measured in
  WU-1.4 (2026-10-09): red (a) holds only for a probe that runs right after the security file. A
  `/health` call right after the block gets 429 without the `after()`, while `production`, run after
  the rest of `integration:flows`, passes 81/81 without it, because the bucket refills at about two
  permits a second in between.
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
  `describeIf` at `authContext.test.tsx:54`, `{ skip: USE_REAL_ADAPTERS }`
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
  first: `nightly.yml:95` (WU-3.12), `production-ci.yml:149` (WU-3.5),
  `dependency-updates.yml:193,270` (root `pnpm run test` → `turbo run test:coverage`, or removed);
  `eval.yml` and the custom security job, once on this list, left with PR R3 (WU-1.3). Red: plant
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

### U5a — measured tier of the node:test population (2026-10-08)

Data section: the measurement WU-1.5 renames by. It adds no file and no gate, so it moves no metric.

**Method.** Measured on 2026-10-08T18:00Z on `main` `4c76d66a`. Population: the 98 `*.test.ts` files
under `apps/api/tests` outside `tests/unit` and `tests/eval` (the 2 `tests/chaos` files are among
them). Each file ran alone, the way `run-tests.sh` runs one (`node --conditions development --import
tsx --test --test-force-exit` with the batch's concurrency and timeout, `.env.test` sourced,
`NODE_ENV=test`, `TIER=full-integration`), with Postgres 15.19 and Redis 7 up on localhost and the
API (:3000) and workers (:3300) down. Two channels, with identical status for all 98 files: **owner**
(`DATABASE_URL` = the owner) and **app-role** (`DATABASE_URL` = `omnipost_app`, `MIGRATE_DATABASE_URL` =
the owner, the split `.env.test` and CI already use). A third, **hermetic** probe ran each file under
`unshare -n` (loopback only) with every database and Redis URL on a closed port. The owner pass ran
three times; the four `*.flow` files ran 8 more. Redis was the native localhost one, not the one
`.env.test` names (see DEF-63).

**Tier rule as applied.** `integration` when the owner pass has 0 fail, 0 cancelled, 0 skipped and exit
0; `live` otherwise. A file that also passes with services down is noted as hermetic (it feeds the
ledger and the experiment; it does not change the tier).

**Result.** integration 80, live 18, hermetic 8 (the 2 `chaos` files, `integration/publishing/failedWrite.smoke`,
`planPublication`, `schemaUtils` and the three `threading.*`). The 18 `live` files all stop on the API: 11
through a `before` hook that throws "API not reachable at http://localhost:3000" (every test
cancelled), 7 through `t.skip("API not available")`. None of the 80 `integration` files references
the live API, so none passes by silently skipping work. The "100" in WU-1.5 was wrong: the population is
98; the 100 double-counts `tests/chaos` or counts the two tracked non-test files
`tests/analytics-ml-integration.test.ts.disabled` and `tests/threading.flow.test.ts.old`.

**Runner batch vs measured tier (38 disagreements).** 18 files sit in `run-tests.sh` batches that the
runner treats as live-API and measured `integration` (the hermetic ones among them); 20 files are in no
batch at all.

- Runner batch `remaining` (10):
  - `tests/accountLifecycle.test.ts` → integration
  - `tests/adapters.test.ts` → integration
  - `tests/mfa.test.ts` → integration
  - `tests/planPublication.test.ts` → integration (hermetic)
  - `tests/rbac.test.ts` → integration
  - `tests/schemaUtils.test.ts` → integration (hermetic)
  - `tests/threading.canonical.test.ts` → integration (hermetic)
  - `tests/threading.planner.test.ts` → integration (hermetic)
  - `tests/threading.xprovider.test.ts` → integration (hermetic)
  - `tests/trialPeriod.test.ts` → integration
- Runner batch `flow` (4):
  - `tests/analytics.flow.test.ts` → integration
  - `tests/media.flow.test.ts` → integration
  - `tests/publish.flow.test.ts` → integration
  - `tests/schedule.flow.test.ts` → integration
- Runner batch `integration:flows` (4):
  - `tests/audit.test.ts` → integration
  - `tests/auth.test.ts` → integration
  - `tests/cache.test.ts` → integration
  - `tests/integration/publishing/failedWrite.smoke.test.ts` → integration (hermetic)
- Runner batch `(none)` (20):
  - `tests/integration/aiLocalizedRoutes.test.ts` → live
  - `tests/integration/analyticsPremiumRoutes.test.ts` → live
  - `tests/integration/analyticsStreamRoutes.test.ts` → live
  - `tests/integration/auditActorPolymorphism.integration.test.ts` → integration
  - `tests/integration/bulkScheduleMediaPath.integration.test.ts` → integration
  - `tests/integration/bulkScheduleReconciliation.integration.test.ts` → integration
  - `tests/integration/bulkScheduleRelayRetry.integration.test.ts` → integration
  - `tests/integration/customerLoginMfa.integration.test.ts` → integration
  - `tests/integration/customerLoginMfaE2e.integration.test.ts` → live
  - `tests/integration/data-retention.integration.test.ts` → integration
  - `tests/integration/inboxRoutes.test.ts` → live
  - `tests/integration/mentionIngest.test.ts` → integration
  - `tests/integration/mfaCustomer.integration.test.ts` → live
  - `tests/integration/mfaTotpSingleUse.integration.test.ts` → integration
  - `tests/integration/redisTokenBucketRateLimiter.test.ts` → integration
  - `tests/integration/repurposeRoutes.test.ts` → live
  - `tests/integration/sendReplyGuardrail.integration.test.ts` → live
  - `tests/integration/shareOfVoice.test.ts` → integration
  - `tests/integration/trendRadarRoutes.test.ts` → live
  - `tests/universal-client-dashboard.integration.test.ts` → live

**Flaky and nondeterministic.**

- `tests/publish.flow.test.ts` passed 7 of 10 clean owner runs and `tests/schedule.flow.test.ts` 9 of 10. A failing run ends in `uncaughtException: Unable to deserialize cloned data due to invalid or
unsupported version`, raised by the node:test runner itself on Node v24.15.0 after tests had
  passed. Independent of services; cause not established (DEF-64). By the rule both stay `integration`.
- `tests/providerRegistry.test.ts` collects 24 to 36 tests per run (5 or 10 suites), all skipped
  (DEF-65).
- `tests/cache.test.ts` timed out at 120 s only in the hermetic pass.
- The 4 `syncEngine.*` files (`integration`) skip themselves when the services are down instead of
  failing (6 to 11 skips each in the hermetic pass).

**Per-file table** (98 rows; `FAIL f<n> c<n>` = failed and cancelled test counts; hermetic is the
status under `unshare -n`; seconds = wall time of the owner pass, node start included).

| file                                                               | owner      | app-role   | hermetic    | measured tier       | seconds | note                                                              |
| ------------------------------------------------------------------ | ---------- | ---------- | ----------- | ------------------- | ------- | ----------------------------------------------------------------- |
| ---                                                                | ---        | ---        | ---         | ---                 | ---     |                                                                   |
| accountLifecycle.test.ts                                           | pass 15/15 | pass 15/15 | FAIL c15    | integration         | 1.4     |                                                                   |
| adapters.test.ts                                                   | pass 14/14 | pass 14/14 | FAIL f7     | integration         | 1.2     |                                                                   |
| analytics.flow.test.ts                                             | pass 12/12 | pass 12/12 | FAIL f7     | integration         | 1.2     |                                                                   |
| audit.test.ts                                                      | pass 7/7   | pass 7/7   | FAIL f7     | integration         | 1.3     |                                                                   |
| auth.test.ts                                                       | pass 15/15 | pass 15/15 | FAIL f7 c8  | integration         | 2.1     |                                                                   |
| cache.test.ts                                                      | pass 27/27 | pass 27/27 | TIMEOUT     | integration         | 8.1     | hermetic pass timed out at 120 s; FLUSHDB per test                |
| chaos/saga-step-retry-recovery.test.ts                             | pass 1/1   | pass 1/1   | pass 1/1    | integration         | 1.2     | passes with services down                                         |
| chaos/sagaWaitAmplification.test.ts                                | pass 2/2   | pass 2/2   | pass 2/2    | integration         | 1.3     | passes with services down                                         |
| integration/adminPasswordResetClaim.integration.test.ts            | pass 11/11 | pass 11/11 | FAIL c11    | integration         | 2.1     |                                                                   |
| integration/adminRefreshRotationClaim.integration.test.ts          | pass 5/5   | pass 5/5   | FAIL c5     | integration         | 1.6     |                                                                   |
| integration/aiLocalizedRoutes.test.ts                              | FAIL c6    | FAIL c6    | FAIL c6     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/analyticsPremiumRoutes.test.ts                         | FAIL c8    | FAIL c8    | FAIL c8     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/analyticsStreamRoutes.test.ts                          | FAIL c3    | FAIL c3    | FAIL c3     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/auditActorPolymorphism.integration.test.ts             | pass 6/6   | pass 6/6   | FAIL c6     | integration         | 1.1     |                                                                   |
| integration/backfillAdminMfaBackupCodes.integration.test.ts        | pass 7/7   | pass 7/7   | FAIL c7     | integration         | 0.4     |                                                                   |
| integration/bulkScheduleMediaPath.integration.test.ts              | pass 1/1   | pass 1/1   | FAIL c1     | integration         | 1.1     |                                                                   |
| integration/bulkScheduleOutboxSmoke.test.ts                        | pass 3/3   | pass 3/3   | FAIL c3     | integration         | 1.1     |                                                                   |
| integration/bulkScheduleReconciliation.integration.test.ts         | pass 2/2   | pass 2/2   | FAIL f2     | integration         | 1.1     |                                                                   |
| integration/bulkScheduleRelayRetry.integration.test.ts             | pass 1/1   | pass 1/1   | FAIL c1     | integration         | 1.1     |                                                                   |
| integration/bulkScheduling.test.ts                                 | pass 3/3   | pass 3/3   | FAIL c3     | integration         | 1.1     |                                                                   |
| integration/campaignTenantIsolation.test.ts                        | pass 13/13 | pass 13/13 | FAIL c13    | integration         | 1.2     |                                                                   |
| integration/channelTenantIsolation.test.ts                         | pass 19/19 | pass 19/19 | FAIL c19    | integration         | 1.4     |                                                                   |
| integration/compositionRootTenantBinding.test.ts                   | pass 2/2   | pass 2/2   | FAIL c2     | integration         | 1.0     |                                                                   |
| integration/consumers/workerConnection.integration.test.ts         | pass 3/3   | pass 3/3   | FAIL c2     | integration         | 0.9     |                                                                   |
| integration/crisisRoutes.test.ts                                   | skip 10/10 | skip 10/10 | skip 10/10  | live                | 0.9     | t.skip: API not available                                         |
| integration/customerLoginMfa.integration.test.ts                   | pass 3/3   | pass 3/3   | FAIL f3     | integration         | 2.1     |                                                                   |
| integration/customerLoginMfaE2e.integration.test.ts                | FAIL c3    | FAIL c3    | FAIL c3     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/customerPasswordReset.integration.test.ts              | pass 13/13 | pass 13/13 | FAIL c13    | integration         | 2.8     |                                                                   |
| integration/data-retention.integration.test.ts                     | pass 2/2   | pass 2/2   | FAIL c2     | integration         | 1.0     |                                                                   |
| integration/deletionRecordDegradation.test.ts                      | pass 5/5   | pass 5/5   | FAIL f5     | integration         | 0.4     |                                                                   |
| integration/deletionRecordRetentionFloor.test.ts                   | pass 5/5   | pass 5/5   | FAIL f5     | integration         | 0.4     |                                                                   |
| integration/externalNotificationTenantIsolation.test.ts            | pass 10/10 | pass 10/10 | FAIL c10    | integration         | 1.3     |                                                                   |
| integration/generatedImageTenantIsolation.test.ts                  | pass 8/8   | pass 8/8   | FAIL c8     | integration         | 1.3     |                                                                   |
| integration/hardDeleteSerializableRace.test.ts                     | pass 2/2   | pass 2/2   | FAIL f2     | integration         | 1.4     |                                                                   |
| integration/inboxRoutes.test.ts                                    | FAIL c5    | FAIL c5    | FAIL c5     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/linkRoutes.test.ts                                     | skip 12/12 | skip 12/12 | skip 12/12  | live                | 0.9     | t.skip: API not available                                         |
| integration/mentionIngest.test.ts                                  | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 0.4     |                                                                   |
| integration/mfaBackupCodeSingleUse.integration.test.ts             | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 2.0     |                                                                   |
| integration/mfaCustomer.integration.test.ts                        | FAIL c8    | FAIL c8    | FAIL c8     | live                | 1.0     | before hook: API not reachable at :3000                           |
| integration/mfaTotpSingleUse.integration.test.ts                   | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 1.1     |                                                                   |
| integration/outbox/OutboxRelay.integration.test.ts                 | pass 1/1   | pass 1/1   | FAIL c1     | integration         | 0.4     |                                                                   |
| integration/post-trio-tenant-isolation.test.ts                     | pass 32/32 | pass 32/32 | FAIL f1 c31 | integration         | 3.7     |                                                                   |
| integration/postDeleteOwnership.test.ts                            | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 3.6     |                                                                   |
| integration/postHardDeleteCascade.test.ts                          | pass 3/3   | pass 3/3   | FAIL f3     | integration         | 0.4     |                                                                   |
| integration/postReadOwnership.test.ts                              | pass 6/6   | pass 6/6   | FAIL c6     | integration         | 3.6     |                                                                   |
| integration/preAuthBillingTenantIsolation.test.ts                  | pass 1/1   | pass 1/1   | FAIL f1     | integration         | 0.5     |                                                                   |
| integration/preAuthInboundWebhookTenantIsolation.test.ts           | pass 1/1   | pass 1/1   | FAIL f1     | integration         | 1.1     |                                                                   |
| integration/preAuthIntegrationTenantIsolation.test.ts              | pass 3/3   | pass 3/3   | FAIL c3     | integration         | 1.2     |                                                                   |
| integration/preAuthSsoTenantIsolation.test.ts                      | pass 12/12 | pass 12/12 | FAIL c12    | integration         | 1.1     |                                                                   |
| integration/projectMemberTenantIsolation.test.ts                   | pass 7/7   | pass 7/7   | FAIL c7     | integration         | 1.1     |                                                                   |
| integration/publishWorkerTenantIsolation.test.ts                   | pass 9/9   | pass 9/9   | FAIL c9     | integration         | 1.2     |                                                                   |
| integration/publishing/failedWrite.smoke.test.ts                   | pass 2/2   | pass 2/2   | pass 2/2    | integration         | 5.0     | passes with services down                                         |
| integration/recurringPostTenantIsolation.test.ts                   | pass 14/14 | pass 14/14 | FAIL c14    | integration         | 1.3     |                                                                   |
| integration/redisTokenBucketRateLimiter.test.ts                    | pass 4/4   | pass 4/4   | FAIL f4     | integration         | 0.2     |                                                                   |
| integration/repositories/AccountQueryRepository.test.ts            | pass 24/24 | pass 24/24 | FAIL c23    | integration         | 1.1     |                                                                   |
| integration/repositories/AnalyticsRepository.basic.test.ts         | pass 17/17 | pass 17/17 | FAIL c16    | integration         | 0.5     |                                                                   |
| integration/repositories/AnalyticsRepository.channel.test.ts       | pass 10/10 | pass 10/10 | FAIL c10    | integration         | 0.5     |                                                                   |
| integration/repositories/AnalyticsRepository.timeseries.test.ts    | pass 14/14 | pass 14/14 | FAIL c14    | integration         | 0.5     |                                                                   |
| integration/repositories/ConversionRepository.test.ts              | pass 6/6   | pass 6/6   | FAIL c6     | integration         | 1.1     |                                                                   |
| integration/repositories/PrismaPostRepository.test.ts              | pass 22/22 | pass 22/22 | FAIL c17    | integration         | 1.2     |                                                                   |
| integration/repositories/ProjectRepository.test.ts                 | pass 21/21 | pass 21/21 | FAIL c20    | integration         | 0.6     |                                                                   |
| integration/repositories/UserRepository.test.ts                    | pass 39/39 | pass 39/39 | FAIL c38    | integration         | 1.2     |                                                                   |
| integration/repositories/sagaAccountIdBackfill.integration.test.ts | pass 10/10 | pass 10/10 | FAIL f9     | integration         | 0.4     |                                                                   |
| integration/repurposeRoutes.test.ts                                | FAIL c5    | FAIL c5    | FAIL c5     | live                | 0.9     | before hook: API not reachable at :3000                           |
| integration/rls-tenant-isolation.test.ts                           | pass 31/31 | pass 31/31 | FAIL c31    | integration         | 0.5     |                                                                   |
| integration/sagaCompensationRecovery.test.ts                       | pass 2/2   | pass 2/2   | FAIL c2     | integration         | 1.8     |                                                                   |
| integration/sagaCrashRecovery.test.ts                              | pass 17/17 | pass 17/17 | FAIL c17    | integration         | 4.9     |                                                                   |
| integration/sagaCustomerFlow.test.ts                               | FAIL c14   | FAIL c14   | FAIL c14    | live                | 1.4     | before hook: API not reachable at :3000                           |
| integration/sagaPublishNowPromotion.test.ts                        | pass 14/14 | pass 14/14 | FAIL c14    | integration         | 2.1     |                                                                   |
| integration/sagaTenantIsolation.test.ts                            | pass 20/20 | pass 20/20 | FAIL c20    | integration         | 1.6     |                                                                   |
| integration/scheduledReportTenantIsolation.test.ts                 | pass 11/11 | pass 11/11 | FAIL c11    | integration         | 1.3     |                                                                   |
| integration/security-endpoints.test.ts                             | skip 11/11 | skip 11/11 | skip 11/11  | live                | 0.9     | t.skip: API not available                                         |
| integration/sendReplyGuardrail.integration.test.ts                 | FAIL c2    | FAIL c2    | FAIL c2     | live                | 1.0     | before hook: API not reachable at :3000                           |
| integration/shareOfVoice.test.ts                                   | pass 4/4   | pass 4/4   | FAIL c4     | integration         | 0.4     |                                                                   |
| integration/syncEngine/syncEngine.conflicts.test.ts                | pass 6/6   | pass 6/6   | skip 6/6    | integration         | 1.4     | self-skips without services                                       |
| integration/syncEngine/syncEngine.init.test.ts                     | pass 10/10 | pass 10/10 | skip 10/10  | integration         | 1.4     | self-skips without services                                       |
| integration/syncEngine/syncEngine.monitoring.test.ts               | pass 11/11 | pass 11/11 | skip 11/11  | integration         | 1.4     | self-skips without services                                       |
| integration/syncEngine/syncEngine.sync.test.ts                     | pass 9/9   | pass 9/9   | skip 9/9    | integration         | 1.4     | self-skips without services                                       |
| integration/tenant-composite-fk.test.ts                            | pass 18/18 | pass 18/18 | FAIL c18    | integration         | 0.4     |                                                                   |
| integration/tenantGucTransactionBinding.test.ts                    | pass 7/7   | pass 7/7   | FAIL c6     | integration         | 1.3     |                                                                   |
| integration/trackedLinkTenantIsolation.test.ts                     | pass 13/13 | pass 13/13 | FAIL c13    | integration         | 1.4     |                                                                   |
| integration/trendRadarRoutes.test.ts                               | FAIL c5    | FAIL c5    | FAIL c5     | live                | 0.9     | before hook: API not reachable at :3000                           |
| media.flow.test.ts                                                 | pass 7/7   | pass 7/7   | FAIL f5     | integration         | 1.2     |                                                                   |
| mfa.test.ts                                                        | pass 21/21 | pass 21/21 | FAIL f18 c3 | integration         | 7.4     |                                                                   |
| multiproject.flow.test.ts                                          | skip 20/20 | skip 20/20 | skip 20/20  | live                | 1.0     | t.skip: API not available                                         |
| planPublication.test.ts                                            | pass 12/12 | pass 12/12 | pass 12/12  | integration         | 1.0     | passes with services down                                         |
| production.integration.test.ts                                     | skip 25/25 | skip 25/25 | skip 25/25  | live                | 1.0     | t.skip: API not available; Workers metrics not available          |
| providerRegistry.test.ts                                           | skip 36/36 | skip 33/33 | skip 24/24  | live                | 1.0     | 24-36 tests per run, all skipped                                  |
| publish.flow.test.ts                                               | pass 5/5   | pass 5/5   | FAIL f5     | integration (flaky) | 1.2     | flaky 7/10 owner runs clean; runner "Unable to deserialize" crash |
| rbac.test.ts                                                       | pass 23/23 | pass 23/23 | FAIL f8 c12 | integration         | 1.7     |                                                                   |
| schedule.flow.test.ts                                              | pass 10/10 | pass 10/10 | FAIL f7     | integration (flaky) | 1.2     | flaky 9/10 owner runs clean; runner "Unable to deserialize" crash |
| schemaUtils.test.ts                                                | pass 22/22 | pass 22/22 | pass 22/22  | integration         | 0.2     | passes with services down                                         |
| security.test.ts                                                   | FAIL c18   | FAIL c18   | FAIL c18    | live                | 1.0     | before hook: no API answering at :3000                            |
| threading.canonical.test.ts                                        | pass 10/10 | pass 10/10 | pass 10/10  | integration         | 1.1     | passes with services down                                         |
| threading.planner.test.ts                                          | pass 15/15 | pass 15/15 | pass 15/15  | integration         | 0.8     | passes with services down                                         |
| threading.xprovider.test.ts                                        | pass 26/26 | pass 26/26 | pass 26/26  | integration         | 1.0     | passes with services down                                         |
| trialPeriod.test.ts                                                | pass 9/9   | pass 9/9   | FAIL c9     | integration         | 1.3     |                                                                   |
| universal-client-dashboard.integration.test.ts                     | skip 9/9   | skip 9/9   | skip 9/9    | live                | 1.0     | t.skip: API not available; Client not available                   |

### Phase 2 — Demolition

**2.A Instruments**

- **WU-2.0** Scenario `decorative-demolition` in `CLAUDE.md §Pragmatic Exceptions` (marker
  `// canon-exception: decorative-demolition:<ledger-slice>`) plus an ADR (first free number: 0025;
  0024 is reserved by N-COR-8) and #37's scenario matcher if it hardcodes them. Red: lower a floor
  without the marker → #37 exits non-zero → restore; with the marker → green. Dep: the coverage
  decision, and a `sensitive-edit` token. CODE ~40. PR `refound/2-coverage-exception`.
- **WU-2.1** The assertion classifier as a **workspace package with tests**
  `packages/eslint-plugin-testing/` (`src/assertions.js`, `src/blocks.js`, ESM `// @ts-check`,
  loadable by jiti and by node; tests with `RuleTester` plus fixtures). The package already exists:
  contract slice `0.20` creates it with `testing/no-unowned-handle-unref` ([D48](#decisions-log)),
  and this work unit extends it. It parses with
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

- **WU-3.1** Contiguous fitness inventory (#44) and a derived count: the "Fitness summary" step
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
  `production-ci.yml` delete :23-68 (`security-audit`) and :70-161 (`test-and-build`: on a pull
  request it duplicates Build Check; on a push it duplicates `ci.yml`, which also runs on push to
  main); delete :170 (the `needs`); rename the workflow to "Container Images". **Edward's admin step
  before merging**: remove "Test and Build" from the required list (otherwise the pull request waits
  forever for a check that does not exist). Acceptance: `required_status_checks` without "Test and
  Build"; "Security Audit" only from `ci.yml:627`. Red: rule V1 of #47 with a duplicated
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
- **WU-3.9** #47 verdict composition, static rules (Test Contracts):
  `packages/test-contracts/src/verdict.ts` plus self-tests plus a #47 block in `CLAUDE.md`; it parses
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
- **WU-3.10** #47 operational rules and drift read from GitHub: V4 no step of a required job has
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
  #30, #32, #36, #37, #47, #49)** · CodeQL (one `javascript-typescript` context) · gitleaks (fixed) ·
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
- **WU-3.13** Script entrypoints cannot swallow errors (#48) plus performance verdicts (conditional on
  the k6/perf decision of Phase 6): #48 is a hard-zero grep in the dependency-free job —
  `git ls-files '*.ts' '*.mts' '*.js' | xargs rg -n '\.catch\(\s*console\.(error|log|warn)\s*\)'`
  (today 5: `postgres-stress.test.ts:621`, `generate-reports.ts:712`, `baseline-capture.ts:453`,
  `memory-leak-detector.ts:641`, `regression-detector.ts:451`); k6 (if kept):
  `performance.yml:221` `-e BASE_URL=$TEST_API_URL`; each scenario throws without `__ENV.BASE_URL`;
  mount `performance/` and `--out json=/perf/reports/k6/${SCENARIO}-results.json`; upload
  `performance/reports/`; `generate-reports.ts` exits 1 with no results; pin by digest (:207-208);
  remove `needs: db-stress` (:117). Red: a planted `.catch(console.error)` → #48 exits 1; `k6 run`
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
  `ECONNREFUSED 127.0.0.1:1`; (c) remove a key from the example → #49 exits 1. CODE ~220. PR E1.
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
  (`security-testing.yml:120-189`) and nightly (WU-3.12). Acceptance: no workflow boots an app process
  except through the script; the grep for inline `dev:test` in the workflow directory returns 0.
  Red: #49 with a planted inline `pnpm --filter @apps/api dev:test &` → exit 1. Dep: 4b.3. CODE ~150
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
- **WU-4b.7** One environment identity (#49, Test Contracts):
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
  (`useBulkScheduleParse.test.tsx:56`) becomes `error` plus a handler. Red: plant
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
2. **In parallel, whenever**: V1 (#44), V2 (reporters), V3 (OpenAPI Drift), V6 (gitleaks), V7a (OSV
   measurement), E1 (env), 2.1 (classifier), 2.2a/b (ledger), 2.3 (probe).
3. **Reach**: R1 → R2 → R3 → R4 → R5 → R6 → R7 (services collector; interim #30) → E2 → E3 → R8 (live)
   → R9 → R10 (Test Contracts; needs V1) → R11 → R12.
4. **Demolition**: 2.4 (lint) → 2.5 (listing and Edward's approval) → 2.0 (coverage scenario) →
   2.6a/2.6b/2.7 in parallel → 2.8.1 … 2.8.7 (serially inside api because of the coverage floor) →
   2.9, 2.10. Unblocks R13 (#32 AST) and V8 (skip gate). 8.1a lands with 2.4.
5. **Verdict**: V4 → V5 (Edward removes "Test and Build" from required) → V9 (#47) → V11 (ruleset;
   Edward) → V10 (drift) → V7b.
6. **Environment**: E4, E5, E6 → E7 (#49) → E8 (hermetic shards; needs V3).
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
