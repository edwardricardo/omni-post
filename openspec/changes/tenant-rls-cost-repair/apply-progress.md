# Apply progress: tenant-rls-cost-repair

> Batch 1 — **PR-1a only** (Phase 1, tasks 1.1–1.10: the six harness advisories).
> Phase 2+ deliberately not started. Every number below was observed on this machine;
> nothing here is inferred from the design.

## Task ledger

| Task | State | Evidence                                                                                                 |
| ---- | ----- | -------------------------------------------------------------------------------------------------------- |
| 1.1  | `[x]` | `walkPlan` collects `Relation Name`, `Actual Total Time`, `Actual Loops`, `Heap Fetches`, `Subplan Name` |
| 1.2  | `[x]` | scan-node median live; measured gap statement-vs-scan on 13/13 cases + 4/4 arms                          |
| 1.3  | `[x]` | RED `median([]) = -1.000 ms` → GREEN `median([]) THREW`                                                  |
| 1.4  | `[x]` | RED qual-only proof `IDENTICAL (passes)` over a `with_check → null` swap → GREEN `DIVERGED (fails)`      |
| 1.5  | `[x]` | `class DeliberateRollback extends Error`; no `error.message` compare remains                             |
| 1.6  | `[x]` | reproducibility claim deleted, `VACUUM` narrowed to the visibility map                                   |
| 1.7  | `[x]` | RED last-run-only in BOTH `capture()` and `runPolicyArm` → GREEN 11 + 8 annotation lines, exit zero      |
| 1.8  | `[x]` | all 17 line refs across 13 `sourceSite` entries verified live — **zero drift**                           |
| 1.9  | `[x]` | `--policy-ab --runs 3` green on the 100×10 000 corpus, report regenerated                                |
| 1.10 | `[x]` | gate below                                                                                               |

## TDD evidence — each advisory red-proven

Discipline note: `scripts/` sits outside every tsconfig project and every test tier
(**SMELL-91**), so the RED for each advisory is the plant → observe → restore evidence the
tasks define, run against the live database. No helper was extracted into a new module:
`design.md` §File Changes names `scripts/rls-ab-measurement.ts` as the only script-side file,
and a helper under `scripts/` would have had no collector to test it — inventing one would
have widened the slice without adding a real gate.

Pristine harness before any plant: `sha256 c646b917456433a84fc1a703b72ecc208a07610517a19baed47306bfb9e18d9e`.
Every plant below was restored and verified byte-exact with `cmp` + `sha256sum -c` before the
next one was made.

### 1.3 — `median()` on an empty series

RED (probe calling the shipped helper), verbatim:

```
RED-1.3 probe: median([]) = -1.000 ms
```

The sentinel reaches the report through `toFixed(3)` as a plausible measurement. GREEN,
verbatim:

```
GREEN-1.3 probe: median([]) THREW — median() received an empty series, so there is no
measurement to quote. Returning a sentinel here would reach the report as `-1.000 ms` and
read as a real number.
```

### 1.4 — restore proof on the 5-tuple

The arms re-create with `CREATE POLICY ... USING (...)` and **no** `WITH CHECK`. Measured on
this database, that leaves `qual` byte-identical and drops `with_check` to `null` — a
different write-path predicate. RED (probe applying exactly that swap inside a rolled-back
transaction, then asking the _shipped_ proof), verbatim:

```
RED-1.4 probe: with_check BEFORE = ((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))
RED-1.4 probe: with_check AFTER  = null
RED-1.4 probe: shipped qual-only restore proof says: IDENTICAL (passes)
```

GREEN — same mutation, new proof, verbatim:

```
GREEN-1.4 probe: 5-tuple restore proof says: DIVERGED (fails)
GREEN-1.4 probe: BEFORE with_check = ((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))
GREEN-1.4 probe: AFTER  with_check = (null)
```

### 1.7 — per-run index sets, in BOTH places

RED, forced by flipping `enable_indexscan` / `enable_indexonlyscan` / `enable_bitmapscan` on
odd runs. `capture()`:

```
RED-1.7 capture Q3 run 0: indexes = [Project_id_accountId_key]
RED-1.7 capture Q3 run 1: indexes = [(none)]
RED-1.7 capture Q3 run 2: indexes = [Project_id_accountId_key]
RED-1.7 capture Q3: REPORTED = [Project_id_accountId_key] <- last run only
```

`runPolicyArm()` — the second site, which a `capture()`-only fix would have left silently
broken:

```
RED-1.7 arm A′ S1 run 0: indexes = [Post_id_accountId_key]
RED-1.7 arm A′ S1 run 1: indexes = [(none)]
RED-1.7 arm A′ S1 run 2: indexes = [Post_id_accountId_key]
RED-1.7 arm A′ S1: REPORTED = [Post_id_accountId_key] <- last run only
```

GREEN — 11 annotations on the capture path, 8 on the arm path, **run still exits zero and
still writes** (the spec's "annotates and never fails"):

```
- ANNOTATION — the runs of this capture did NOT agree on the index: run 1
  [Post_accountId_projectId_idx], run 2 [(none)], run 3 [Post_accountId_projectId_idx].
  Recorded rather than failed; the plan is a planner tie, not a defect in the query.
```

### 1.2 — the scan-node median, measured rather than argued

Not a planted defect: the RED is the **gap itself**, and it is present on every case. From the
`--phase after` verification capture (13/13 cases, scratch output — the committed `after`
section belongs to PR-2's authoritative capture and was deliberately left untouched):

| Case | scan-node median | statement median | statement ÷ scan |
| ---- | ---------------- | ---------------- | ---------------- |
| `Q3` | 4.236 ms         | 6.686 ms         | **1.58×**        |
| `Q4` | 4.121 ms         | 5.422 ms         | 1.32×            |
| `Q7` | 0.007 ms         | 0.021 ms         | **3.00×**        |
| `Q8` | 0.005 ms         | 0.012 ms         | 2.40×            |
| `Q1` | 0.051 ms         | 0.080 ms         | 1.57×            |

`Q3`/`Q4` are the join-bearing shapes, and 2.45 ms of sort/join/aggregate work was being
attributed to the scan. That is the retracted-4.198 mechanism reproduced on live data.

## Findings — things the measurement said that the design could not

1. **The choice of statistic changes the headline verdict, and the tasks' own expected band
   only holds for the right one.** On the committed `--policy-ab` run, shape `S3`:

   | Arm       | InitPlan/SubPlan                                     | scan-node median | statement median |
   | --------- | ---------------------------------------------------- | ---------------- | ---------------- |
   | `A′`      | (none)                                               | **4.136 ms**     | 5.408 ms         |
   | `A′+init` | `InitPlan 1 (returns $0)`, `InitPlan 2 (returns $1)` | **1.828 ms**     | 2.994 ms         |
   | `B′`      | `SubPlan 1`                                          | 2.495 ms         | 3.739 ms         |
   | `B′+sys`  | `SubPlan 1`                                          | 4.191 ms         | 5.518 ms         |

   `A′ → A′+init` is **2.26×** on the scan-node median and **1.81×** on the statement median.
   Task 4.6 expects "the ~2.1–2.4× scan-node band" for the committed form: the scan figure
   lands inside it, the statement figure does not. Without this advisory, PR-2's committed
   re-run would have read as out-of-band and been adjudicated for a defect that was in the
   statistic, not in the policy.

2. **`W`'s two `current_setting` wrappers do NOT share one InitPlan.** The plan reports
   `InitPlan 1 (returns $0)` **and** `InitPlan 2 (returns $1)` on `A′+init` — the arm whose
   body is the `W` form. `design.md` explicitly refused to assume sharing either way and asked
   the plan to answer; it has, and the answer is _not shared_. Both are still statement-scoped
   rather than per-row, which is the whole point of the form, so this changes no verdict — but
   PR-1b's task 2.4 now has its answer measured instead of pending.

3. **SMELL-91, made concrete rather than restated.** `apps/api/tsconfig.json` includes `src`,
   `packages/*/src`, `packages/core/*/src`, `infra/*/src` — `scripts/` matches none of them, so
   the workspace typecheck provably never opens the file this whole change's evidence comes
   from. Worse for the standalone check the legend prescribes: `@types/node` is **not hoisted**
   to the repo root (it lives at `infra/prisma/node_modules/@types` and per-package elsewhere),
   so a naive `tsc --noEmit` over the script dies with `TS2688: Cannot find type definition file
for 'node'` before it typechecks a single line — and naming the file on the command line at
   all first trips `TS5112`, because a root `tsconfig.json` exists. Two separate refusals stand
   between an author and this check, which is exactly how a standalone check gets quietly
   abandoned and the "typechecked by nothing" state persists. The working invocation, with both
   flags and why each is needed, is recorded under §Commands below; its red is proven in the
   gate table.

4. **BLOCKING for whoever commits this candidate — five of this change's OWN openspec
   artifacts are prettier-dirty, and they will fail CI.** `pnpm format:check` is
   `prettier -c .` over the WHOLE repo and `.prettierignore` does not list `openspec/`, so
   these are gate failures the moment they are committed:

   ```
   [warn] openspec/changes/tenant-rls-cost-repair/design.md
   [warn] openspec/changes/tenant-rls-cost-repair/explore.md
   [warn] openspec/changes/tenant-rls-cost-repair/proposal.md
   [warn] openspec/changes/tenant-rls-cost-repair/research.md
   [warn] openspec/changes/tenant-rls-cost-repair/specs/rls-policy-form/spec.md
   ```

   They were written by the explore / propose / research / design / spec phases and never
   formatted; every one is in this attempt's `--intended-untracked` manifest, so they travel
   with the candidate. **This apply did NOT fix them**, and the reason is scope rather than
   judgement: the writer's brief names `scripts/rls-ab-measurement.ts`, `tasks.md` and this
   file as the entire touch-scope, and silently reformatting another phase's artifact would
   also move bytes inside the frozen untracked inventory. Flagged instead of deferred, per the
   0-defect rule. One-line fix, no semantic change:
   `pnpm exec prettier --write openspec/changes/tenant-rls-cost-repair/`.

## Files written

| File                                                        | Change                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/rls-ab-measurement.ts`                             | **+291 / −26 authored.** Six advisories + `measuredTable` on all 13 cases + file-header docblock                                              |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                 | **+234 / −185, GENERATED** by the harness; prettier-clean. Excluded from the review budget per the tasks' own rule, but part of the candidate |
| `openspec/changes/tenant-rls-cost-repair/apply-progress.md` | this file (new)                                                                                                                               |
| `openspec/changes/tenant-rls-cost-repair/tasks.md`          | 1.1–1.10 checked with evidence annotations                                                                                                    |

Nothing under `infra/`, `.github/`, `.claude/`, `apps/`, `packages/` was touched. No git
command was run — the orchestrator owns git.

## 0-defect gate (task 1.10)

| Gate                                                    | Result                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace `pnpm typecheck`                              | **169/169 tasks, exit 0** — see note                                                                                                                                                    |
| Standalone script typecheck (SMELL-91)                  | **exit 0**, and its red proven (planted type error → exit 2 → restore → exit 0)                                                                                                         |
| `eslint --max-warnings 0 scripts/rls-ab-measurement.ts` | **exit 0**                                                                                                                                                                              |
| Fitness #8 / #9 / #10 / #16 / #23                       | **0 / 0 / 0 / 0 / 0**                                                                                                                                                                   |
| `prettier --check` (script + regenerated report)        | **exit 0** — "All matched files use Prettier code style!"                                                                                                                               |
| Harness smoke `--policy-ab --runs 3`                    | green, 12 arm measurements written, restore proof passed on the 5-tuple                                                                                                                 |
| Planted reds restored byte-exact                        | `cmp` + `sha256sum -c` after every plant                                                                                                                                                |
| Database left as found                                  | corpus cleaned to 0 rows; `Account` control 354 → 354; 61 `tenant_isolation` policies; trio `qual` == `with_check`, PERMISSIVE/ALL/{public} — read **out of band**, not via the harness |

**Typecheck note, stated rather than buried.** The first `pnpm typecheck` ended
`FATAL ERROR: Ineffective mark-compacts near heap limit` in `@apps/api#typecheck` — 168 of 169
tasks green, one OOM at node's default ~2 GB heap. That is the LXC memory cap, not a type
error: re-running that single task with a larger heap gives exit 0, and the change cannot have
caused it because `scripts/` is not in the api program at all (finding 3). Recorded because an
OOM silently retried at a bigger heap is indistinguishable in a log from a gate that never had
a problem.

## Commands (reproduce this batch)

```bash
pnpm db:up
# harness (the report's own documented form; `pnpm exec tsx` does not load .env)
node --import tsx --conditions development --env-file=.env \
  scripts/rls-ab-measurement.ts --policy-ab --runs 3
pnpm exec prettier --write docs/reports/TENANT_RLS_AB_MEASUREMENT.md
node --import tsx --conditions development --env-file=.env \
  scripts/rls-ab-measurement.ts --cleanup

# standalone script typecheck (SMELL-91). BOTH flags below are load-bearing:
#   --ignoreConfig  : without it tsc refuses with TS5112, because a root tsconfig.json
#                     exists and a file was named on the command line
#   --typeRoots     : without it tsc dies with TS2688 "Cannot find type definition file
#                     for 'node'" — @types/node is NOT hoisted to the repo root
pnpm exec tsc --noEmit --ignoreConfig --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --target ES2022 --module ESNext \
  --moduleResolution bundler --skipLibCheck --esModuleInterop \
  --typeRoots infra/prisma/node_modules/@types \
  scripts/rls-ab-measurement.ts

# the one workspace task that needs a raised heap in this LXC
cd apps/api && NODE_OPTIONS=--max-old-space-size=6144 pnpm run typecheck
```

## Deviations

1. **Authored size 317 lines vs the ~180–240 forecast** for PR-1a. Inside the 400-line budget,
   so **no `size:exception` is needed** and the chain is unaffected. The overrun is
   documentation the repo canon requires: `scanTimeMs`, `median`, `indexAnnotation`,
   `DeliberateRollback`, `ScanNode`, `WalkedPlan` and the rewritten `readTrioPolicies` each
   carry a JSDoc block, and the file header gained the two sections that state what the
   harness now refuses to do.
2. **No helper module extracted.** Reasoning under §TDD evidence. `design.md` §File Changes is
   followed exactly.
3. **The committed `§after` capture section was NOT regenerated.** `capture()` changed, so it
   was verified — on the full 100×10 000 corpus, 13/13 green — but written to a scratch file.
   Task 1.9 scopes this link's report write to `--policy-ab`, and the authoritative `after`
   capture belongs to task 6.7, against the committed index. Regenerating it here would have
   put a number in the report that no committed migration stands behind.
4. **`measuredTable` was added to `Case` as a required field** rather than derived from
   `group`. `group` has two values and the child reads span three tables, so deriving it would
   have silently summed the wrong relation's scan time. This is an addition the tasks imply
   ("nodes whose `Relation Name` is the measured table") without naming the mechanism.

## Not done in this batch (by instruction)

Phase 2 onward: the `{A′, W, S}` arm set, the 13-case policy A/B, `--index-ab`, every
migration, the `listGlobal` reshape, the sweep, and the form-uniformity gate. `POLICY_ARMS`
still holds the shipped four arms (`A′`, `A′+init`, `B′`, `B′+sys`) — retiring `B′`/`B′+sys`
is task 2.1, in PR-1b.

## Next

`sdd-apply` again for **PR-1b** (Phase 2, tasks 2.1–2.9). It inherits two measured inputs from
this batch that it would otherwise have had to derive: the InitPlan count for the `W` body
(finding 2, satisfying task 2.4 in advance) and the scan-node band that task 2.6's adjudication
should be read against (finding 1).

## PR-1a fresh gate (2026-09-10) — FAIL on the artifact layer, closed inline

The fresh-context gate validated every code claim clean — diff scope exact, +291/−26 to the
line, all six advisories present at their designed shapes, the spot-checked reds mechanically
true, the 17 `sourceSite` refs resolving — and FAILED on four findings, all edits to
`docs/reports/TENANT_RLS_AB_MEASUREMENT.md`, all with prescribed fixes, applied inline by the
orchestrator:

1. **The generator was fixed and the artifact was not.** `--policy-ab` never calls
   `renderBlock`, so both §Data-shape blocks (`:69` §Before — unregenerable forever — and
   `:1987` §After) still asserted "the plan is reproducible across reseeds". Both hand-edited
   to the generator's exact new wording, which is what any future regeneration produces
   (`:1987` additionally self-heals at task 6.7).
2. **The verdict-flipping statistic lived only in this file.** The 2.26×-scan vs
   1.81×-statement distinction is now IN the report at both places that draw the ~2.1-2.4×
   band (the SMELL-93 adjudication row and the A′+init paragraph), each naming the band as a
   SCAN-NODE band.
3. **The hand table's preamble denied the capability this batch added** ("computes a median
   for the STATEMENT but not for an individual plan node"). Rewritten as the historical
   two-reading record it now is, pointing at the regenerated block's 3-run medians.
4. **The report's one script line-ref drifted** (+291 lines moved the `vacuumAnalyze`
   docblock): `:355-359` → `:377-384`.

**Record correction in the writer's favour:** §Findings 4 ("five openspec artifacts are
prettier-dirty; this apply did NOT fix them") was accurate when written. The ORCHESTRATOR ran
`prettier --write openspec/changes/tenant-rls-cost-repair/` after this batch returned
(pre-freeze normalization; mtimes ~00:47 vs the batch close ~00:45). The Files written table
is therefore complete for the batch itself; the five normalization-only touches are the
orchestrator's.
