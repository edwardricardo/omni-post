# Apply progress: tenant-rls-cost-repair

> **Batch 1** — PR-1a (Phase 1, tasks 1.1–1.10: the six harness advisories) — below.
> **Batch 2** — PR-1b (Phase 2, tasks 2.1–2.9: the three-arm decision run) — further down.
> **Batch 3** — PR-1c (Phase 3, tasks 3.1–3.8: the four-arm index decision run) — at the
> end of this file. Phase 4+ deliberately not started. Every number in every batch was
> observed on this machine; nothing here is inferred from the design.

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

---

# Batch 2 — PR-1b: the three-arm decision run (Phase 2, tasks 2.1–2.9)

> The verdict this batch produces is what PR-2's migration is authored FROM. No migration,
> no schema, no production query was touched: the database was read out of band at the end
> and still holds the BARE trio form.

## Task ledger

| Task | State | Evidence                                                                                                              |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `[x]` | three arms `{A′, W, S}`; `B′`/`B′+sys` retired, their measurements KEPT as history                                    |
| 2.2  | `[x]` | `AB_PROBES` = 3 shapes + 13 cases; 48 measurements per sweep; arm swaps all three trio tables                         |
| 2.3  | `[x]` | whole-row digests across every arm AND every sweep; caught a real `count(*)`-emptiness error of mine on the first run |
| 2.4  | `[x]` | InitPlan count **2** for both `W` and `S`, **0** for `A′`; labels kept per run, RED/GREEN below                       |
| 2.5  | `[x]` | RED wrote a report at exit 0 for a form with no `__system__` escape → GREEN exit 1, nothing written                   |
| 2.6  | `[x]` | 16/16 row-equivalence × 3 arms × 5 sweeps; adjudications recorded, including the one regression                       |
| 2.7  | `[x]` | **`W` wins by the pre-declared tiebreak**; verdict computed by `decideForm`, not typed in                             |
| 2.8  | `[x]` | NOT APPLICABLE — `W` won, so `design.md`'s `W` rendering of the variant stands                                        |
| 2.9  | `[x]` | gate table below                                                                                                      |

## THE VERDICT (task 2.7)

**`W` wins — `(SELECT current_setting('app.account_id', true)) = '__system__' OR "accountId" =
(SELECT current_setting('app.account_id', true))` — by the PRE-DECLARED TIEBREAK.**

> **The per-probe NUMBERS in this Batch 2 section are the FIRST authoritative run's.** The
> F1 corrective below re-ran the same comparison to regenerate the report, which produced a
> second set of medians. **The verdict, the winner and the winning body are unchanged**; the
> per-probe figures moved, and §PR-1b corrective names every one that did. This section is
> kept as the record of the run it describes rather than back-edited — the same treatment
> §The retired four-arm results gets in the report.

The tiebreak governs because the measurement could not separate the two forms, and that is a
finding rather than a formality:

- **All 16 probes are INSIDE the band** on the pooled 15-sample scan-node medians (3 EXPLAIN
  runs × 5 independent sweeps). Largest `S − W` move: 12 µs / 0.70 % (`Q4`).
- **Not one probe's `S − W` sign is stable across the five sweeps.** Every row of the
  per-sweep table flips. The difference between the forms is below this harness's noise floor
  on this corpus.
- The verdict is **computed** (`decideForm`) from the medians and rendered into the generated
  block, so the section cannot claim one thing while its own table says another.

**Task 2.8 is therefore NOT APPLICABLE**: no S-rendering of the `AIPromptTemplate` 3-arm
variant is authored, `design.md`'s `W` rendering stands unchanged, and task 8.2's conditional
("use the 2.8 S-rendering if `S` won") is inert. The sweep uses the design's variant text as
written.

## Finding 1 — a single sweep decides this question at random (the reason 2.6 changed shape)

This is the batch's most important result and it is not in the tasks.

The first complete decision run declared **"`S` wins"**. Before recording it I re-ran the same
comparison five more times. The six sweeps, in order:

| Sweep | Verdict   | Out-of-band probes and who they favoured                |
| ----- | --------- | ------------------------------------------------------- |
| 0     | `S` wins  | `S2` (−8 µs → S), `Q4` (−111 µs → S)                    |
| 1     | `W` wins  | `Q4` (+29 µs → W), `Q9` (+10 µs → W)                    |
| 2     | UNDECIDED | `S3` (−47 µs → S), `Q4` (+18 µs → W)                    |
| 3     | UNDECIDED | `S2` (+7 µs → W), `S3` (+22 µs → W), `Q4` (−101 µs → S) |
| 4     | `S` wins  | `S3` (−48 µs → S)                                       |
| 5     | UNDECIDED | `S3` (−26 µs → S), `Q4` (+112 µs → W), `Q6` (−8 µs → S) |

`Q4` alone ranges from **111 µs in `S`'s favour to 112 µs in `W`'s**. A decision rule reading
one sweep would have chosen the policy form for **61 tables** out of the resolution of its own
instrument — and would have written a confident verdict either way, because nothing in the
harness could tell it apart from a real effect.

The repair is in the decision rule, not in the prose:

1. **`--repetitions N`** (default 3): the WHOLE arm sweep repeats, re-installing the policies
   each time. Distinct from `--runs`, which takes several EXPLAIN passes inside ONE arm
   transaction and therefore cannot see variation that belongs to the sweep.
2. **Medians pool across repetitions** — `runs × repetitions` samples, so the authoritative
   run's statistic is over 15 samples rather than 3.
3. **Attributability**: a difference counts as the FORM's only when it is out of band **AND**
   every sweep agreed on its sign. Out-of-band alone is not enough.
4. The refusal gates (row digests, emptiness, miss probes) run across **every** repetition,
   not the pooled result, so an arm that returned different rows in an earlier sweep cannot
   hide behind the last one.

RED/GREEN for the rule itself is under §TDD evidence.

## Finding 2 — `S` reads the GUC once and still plans to TWO InitPlans (task 2.4, measured)

Batch 1 measured that `W`'s two wrapped reads do NOT share one InitPlan. This batch adds the
half that was open: **`S` does not collapse to one either.**

| Arm  | InitPlan count | `S3` labels                                          |
| ---- | -------------- | ---------------------------------------------------- |
| `A′` | 0              | (none)                                               |
| `W`  | **2**          | `InitPlan 1 (returns $0)`, `InitPlan 2 (returns $1)` |
| `S`  | **2**          | `InitPlan 1 (returns $0)`, `InitPlan 2 (returns $1)` |

`S` was proposed precisely because it reads `current_setting` once _syntactically_. The plan
says PostgreSQL still materialises two InitPlans for it, which is the mechanical reason the
two forms measure identically — and it is the answer to the design's open question, taken
from the plan rather than argued. The whole premise of the `S` arm turns out not to hold at
the plan level, which is exactly what an A/B is for.

## Finding 3 — the wrapped form MOVES two plans, one of them a real regression

A moved plan is a finding even when the rows are identical. Two occurred, both recorded in the
report with their adjudications.

**`S2` — the one regression.** Under `A′`: `Limit → Index Scan` on
`Post_projectId_createdAt_idx`, whose output is already ordered so no `Sort` is needed. Under
`W` **and** `S`: `Limit → Sort → Bitmap Heap Scan` on `Post_projectId_archivedAt_idx`.
Scan-node median 0.015 → 0.055 ms (**3.67× slower**), and the 15 samples do not overlap
(`A′` 0.013–0.017, `W` 0.049–0.065) — a real effect, not the noise that governs the W-vs-S
question.

**Accepted, bounded, and named.** `S2` is a SYNTHETIC shape that deliberately carries no
tenant predicate so the policy stands alone; it is not a query this application issues. Its
real counterparts `Q1` and `Q5` — the same `projectId`-filtered listing the repository
actually emits, carrying their own `accountId` and `projectId` — keep
`Post_accountId_projectId_idx` under all three arms and get **faster** (0.047 → 0.036 and
0.048 → 0.035). The regression is confined to the shape that removed the predicate the
application always supplies.

**This is the live instance of the risk task 8.9 names** ("one measured case in this repo
already showed the wrapper CHANGING the chosen index"). It is now measured on 15 samples with
the mechanism visible, and it is why the 58-table sweep's per-policy EXPLAIN pass must treat a
moved plan as a recorded finding rather than an omission.

**`Q6` — the same mechanism, the other direction.** `Hash Join → Index Scan → Hash → Seq Scan`
becomes `Nested Loop → Index Scan → Index Only Scan` under both wrapped forms, newly using
`Project_id_accountId_key`, and gets marginally faster (0.085 → 0.084, in band). Recorded so
"the plan moved" is not read as a regression signal by itself.

## Finding 4 — the `A′` → `W` improvement, and PR-2's expected band

| Probe | `A′`  | `W`   | Scan-node ratio  |
| ----- | ----- | ----- | ---------------- |
| `S3`  | 4.180 | 1.814 | **2.30× faster** |
| `Q3`  | 4.228 | 1.903 | **2.22× faster** |
| `Q4`  | 3.840 | 1.711 | **2.24× faster** |

All three land inside **task 4.6's expected 2.1–2.4× scan-node band**, so PR-2's committed
re-run has a measured expectation to be read against rather than an inherited one. Batch 1's
finding 1 stands and is load-bearing here: on `S3` the same comparison is **1.82× on statement
time** (5.446 → 2.992), which is OUTSIDE that band — the band is a SCAN-NODE band, and reading
it against the statement figure would adjudicate a defect that is in the statistic.

The child reads (`Q9`–`Q13`, on `PostContent`/`PostMedia`) move ≤ 3 µs either way. They are
real arm measurements for the first time in this batch, because the arm now swaps all three
trio tables; previously they could not have responded to the arm at all.

## TDD evidence — every gate born red

Same discipline note as Batch 1: `scripts/` sits outside every tsconfig project and every test
collector (**SMELL-91**), and the file executes `main()` at import, so a `vitest` suite that
imported it would connect to the database rather than test a function. `design.md` §File
Changes names this file as the only script-side file, so no helper module was extracted. The
RED for each gate is therefore the plant → observe → restore evidence, run against the live
database, exactly as Batch 1 established.

Pristine harness before any plant: `sha256 03a7d6ff0ff4d4ed811d71698196422c4b28c11d5e171d59b51ec7de42ed02a2`.
Every plant below was removed and the file re-verified (`tsc` + `eslint` + `prettier --check`
all clean) before the next one.

### The decision rule (Finding 1) — the highest-value red in this batch

A probe calling the SHIPPED `decideForm` with three synthetic sweeps in which `Q4` flips sign
(`S` faster, `W` faster, `S` faster) while everything else is flat. GREEN, verbatim:

```
PROBE decideForm: Q4 pooled W=1.7 S=1.5 inBand=false signStable=false perSweep=[-0.19999999999999996, 0.10000000000000009, -0.19999999999999996]
PROBE decideForm: winner=W
PROBE decideForm: basis=no probe's difference is attributable to the form — 1 probe(s) moved outside the band but their sign FLIPPED between repetitions (Q4), which measures the run rather than the form, so the two forms are indistinguishable on this corpus and the PRE-DECLARED tiebreak decides
```

RED — the sign-stability requirement removed, which is the rule a one-sweep design has:

```
PROBE decideForm: winner=S
PROBE decideForm: basis=1 probe(s) are outside the band AND sign-stable across every repetition, and all of them favour `S`, so the measurement decides and the tiebreak does not apply
```

It picks `S` **and its own basis text asserts "sign-stable across every repetition"** about
data it had just read as unstable. A confident false statement, which is the failure mode
worth having a red for.

### 2.5 — the `__system__` member, which no case can see

Plant: the `S` arm body reduced to `(SELECT current_setting('app.account_id', true)) IN
("accountId")` — a form under which every `withSystemContext()` flow sees NOTHING.

RED, with the equivalence step disabled: the run completed, all 48 digests agreed, and it
**WROTE A REPORT** at **exit 0**. Every case runs with `app.account_id` bound to one tenant,
and under a bound tenant the mutilated form returns exactly the same rows.

GREEN, same plant, gate present — **exit 1, nothing written**, and note that the bound-tenant
state passes FIRST, which is the blindness being closed:

```
equivalence — bound tenant `tif-ab-a`: W and S both admit [r1-local], 0 three-valued divergence(s)
the two candidate forms are NOT equivalent under `__system__` sentinel: W admits [r1-local,r2-foreign,r3-null-account] and S admits [(none)], with 3 row(s) differing as three-valued expressions. A form that admits different rows is a different policy, whatever it measures. NOTHING was written.
  W = (SELECT current_setting('app.account_id', true)) = '__system__' OR "accountId" = (SELECT current_setting('app.account_id', true))
  S = (SELECT current_setting('app.account_id', true)) IN ("accountId")
```

The proof's three states, on the shipped bodies, all green in the authoritative run:

| GUC state           | Admitted by `W`                       | Admitted by `S`                       |
| ------------------- | ------------------------------------- | ------------------------------------- |
| bound tenant        | `r1-local`                            | `r1-local`                            |
| `__system__`        | `r1-local,r2-foreign,r3-null-account` | `r1-local,r2-foreign,r3-null-account` |
| UNSET (fail-closed) | `(none)`                              | `(none)`                              |

The sample is a literal 3-row set rather than `Post`, deliberately: it is not subject to row
security, so the comparison cannot be filtered by the policy under test, and it can carry the
NULL-account row that no `Post` has but the `AIPromptTemplate` variant depends on.

### 2.4 — per-run InitPlan labels

Plant: run 2 of every probe collects no labels, as a plan that lost its InitPlan would; plus
the renderer temporarily reverted to the shipped last-run-only shape.

RED — the report renders the arm's InitPlan set with no trace that a run disagreed:

```
| `W` | Limit → … → Seq Scan | (none) | InitPlan 1 (returns $0), InitPlan 2 (returns $1) | …
```

GREEN — same divergence, per-run rendering:

```
| `W` | 2 | InitPlan 1 (returns $0), InitPlan 2 (returns $1) — ANNOTATION, the runs DISAGREED: run 1 [InitPlan 1 (returns $0), InitPlan 2 (returns $1)], run 2 [(none)], run 3 [InitPlan 1 (returns $0), InitPlan 2 (returns $1)] |
```

### `scanTimeMs` on an absent relation — the PR-1a RDD advisory, closed

The writer's brief authorised this fix only if a Phase 2 task opened the path. Task 2.2 does:
16 heterogeneous plans per arm, each summed over its OWN measured relation, and a silent 0
would post the lowest median and **win the verdict by being unmeasured**.

RED, on the shipped helper:

```
RED-scan probe: scanTimeMs(plan whose only relation is "Project", asked for "Post") = 0.000 ms
```

GREEN:

```
GREEN-scan probe: THREW — no plan node reads "Post", so its scan-node time is not zero — it is unmeasured. The plan's relations are [Project]. Point the case at the relation its plan actually reads; a 0 here would reach the report as `0.000 ms` and win any comparison it entered.
```

It also fired on a LIVE run during the 2.4 plant (`arm A′ S1: no plan node reads "Post"`),
which is the guard doing its job on real data rather than on a constructed input. All 13 cases
and all 3 shapes have a node for their measured relation in the authoritative run, so it
false-positives on nothing.

### A gate that caught my own error, recorded rather than quietly fixed

The first full run REFUSED to write:

```
Q8 declared `missProbe` but matched rows under A′=1, W=1, S=1: the corpus has moved out from under the probe, so its plan is no longer the empty-bucket plan it claims to measure. NOTHING was written.
```

`Q8` counts zero on this corpus and that empty bucket IS its subject — but a scalar `count(*)`
returns ONE ROW while matching nothing, so my first emptiness test (`rows.length`) called it
live. Emptiness is now the probe's own `matched()`, which reads the `n` column for the
aggregate cases and is derived from `digest === byCount` rather than restated as a second list
that could drift. Recorded because the refusal logic catching its author is the evidence that
it can catch anything.

## Residuals — named, not fixed

- **`subplanNames` last-run-only (`:1400`)** — CLOSED here (task 2.4 depended on the field).
- **`scanTimeMs` silent 0 (`:1015`)** — CLOSED here, per the brief's condition.
- **Hardcoded `AB_MEASURED_TABLE` (`:1250`)** — still hardcoded, now correctly scoped: it is
  the relation the three SYNTHETIC shapes read, and all three do read `Post` alone. The 13
  cases carry their own `measuredTable`. Left as the shapes' constant rather than widened.
- **SMELL-91** — untouched and untouchable from here: `scripts/` is outside every tsconfig
  project and every collector, so this file's only typecheck is the standalone invocation in
  §Commands, run by hand at each gate.
- **The `__system__` blindness generalises to task 8.9.** Its per-policy digest pass binds ONE
  tenant, so it cannot see a rewritten policy that lost its `__system__` disjunct — the
  identical hole 2.5 closed here for the trio. `proveFormEquivalence` already reads its two
  bodies from a list and evaluates them over a non-RLS `VALUES` sample, so it generalises to
  (bare, winner) per rewritten policy. 8.9's evidence pass MUST carry the three-GUC-state
  check — bound tenant, `__system__`, UNSET — per policy, or a sweep that drops the sentinel
  from any of the 57 ships green. Routed into `tasks.md` 8.9 and into the report's §Reading
  section so it survives this file.

## Files written

| File                                                        | Change                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scripts/rls-ab-measurement.ts`                             | **+872 / −105 authored** — see the budget risk below                                                                  |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                 | generated §policy-ab block + hand-written §Reading the form decision run; prettier-clean; excluded from review budget |
| `openspec/changes/tenant-rls-cost-repair/tasks.md`          | 2.1–2.9 checked with evidence                                                                                         |
| `openspec/changes/tenant-rls-cost-repair/apply-progress.md` | this Batch 2 section, appended to Batch 1                                                                             |

Nothing under `infra/`, `.github/`, `.claude/`, `apps/`, `packages/` was touched. **No
migration, no schema change, no production query.** No git command was run.

## 0-defect gate (task 2.9)

| Gate                                                    | Result                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace `pnpm typecheck`                              | **169/169, exit 0** — 168 cached + `@apps/api` re-run at `--max-old-space-size=6144` (same LXC cap as PR-1a)                                                        |
| Standalone script typecheck (SMELL-91)                  | **exit 0**                                                                                                                                                          |
| `eslint --max-warnings 0 scripts/rls-ab-measurement.ts` | **exit 0**                                                                                                                                                          |
| Fitness #8 / #9 / #10 / #16 / #23                       | **0 / 0 / 0 / 0 / 0**                                                                                                                                               |
| `prettier --check` (script + report)                    | **exit 0**                                                                                                                                                          |
| INT `rls-tenant-isolation.test.ts`                      | **21 pass / 0 fail / 0 cancelled / 0 skipped** — NULL-GUC fail-closed and `__system__` bypass both green                                                            |
| `--phase after` capture path                            | 13/13 green — the new `scanTimeMs` guard false-positives on no case                                                                                                 |
| Planted reds restored                                   | every plant removed; `tsc`/`eslint`/`prettier` clean after each                                                                                                     |
| Database left as found                                  | read **out of band**: 61 `tenant_isolation` policies, trio `qual` still the BARE form, halves match, PERMISSIVE/ALL/{public}, `Account` 354, 0 namespaced leftovers |

## Deviations

1. **AUTHORED SIZE 977 LINES vs the ~220–300 forecast — over the 400-line review budget.**
   Flagged, not absorbed; the orchestrator owns the decision. The overrun is not padding: the
   three largest blocks are the verdict machinery (+343), `proveFormEquivalence` +
   `poolRepetitions` (+160), and the probe/arm rework (+104), and the repetition machinery
   exists because the measurement demanded it (Finding 1). **Recommended split, at a real
   seam**: PR-1b-i = tasks 2.1–2.5 (the apparatus: arms, 16 probes, refusal logic, per-run
   labels, equivalence proof — ~400 lines, ends with a green run that produces per-arm tables
   and NO verdict), PR-1b-ii = tasks 2.6–2.8 (the decision: repetitions, band, sign-stability,
   `decideForm`, `renderFormVerdict`, and the report's verdict + adjudications — ~470 lines).
   Each half is separately verifiable and separately revertible; the seam is exactly the line
   between "can measure" and "decides".
2. **The arm swaps all three trio tables, not `Post` alone.** The old comment justified
   `Post`-only by "the three shapes touch no other table" — true then, false once 13 cases
   run, five of which read `PostContent`/`PostMedia`. It also matches what migration 4.1
   commits, so this run predicts what task 4.6 will measure.
3. **`--repetitions` is a new flag the tasks do not name.** Justified by Finding 1: without
   it, task 2.6's artifact is a coin flip with a confident verdict attached. Default 3;
   authoritative run used 5.
4. **The 13 cases get a summary table, not 39 full plan trees.** Node types, index sets and
   InitPlan labels per arm are in the table — enough to see a MOVED plan, which is what the
   arm comparison needs — while the shipped form's full trees already live in §after. Full
   JSON is still emitted for the 3 shapes × 3 arms.
5. **Whole-row digests replace the shapes' id-list digest.** Strictly stronger (it can see a
   changed column value, and it can compare the aggregate cases at all, which an id list
   cannot).
6. **Hand-written report numbers were written LAST, from the final committed block.** The
   report was regenerated after the script's final `prettier --write` so the artifact is
   reproducible from committed code; the §Reading section's figures were then updated to that
   run. A structural diff (numbers blanked) of a pre- and post-format generation confirmed
   the formatted script emits an identical block.

## Not done in this batch (by instruction)

Phase 3 onward: `--index-ab` and the index shortlist, every migration, the `listGlobal`
reshape, the 58-policy sweep, and the form-uniformity gate.

## Next

`sdd-apply` for **PR-1c** (Phase 3, tasks 3.1–3.8: `--index-ab`), OR — if the orchestrator
takes deviation 1's split — a re-slice of this batch first. PR-1c inherits from here: the
winner form is **`W`** (task 4.1's migration text is `design.md`'s §Target policy SQL exactly
as written), task 2.8 is closed as not-applicable, and the `A′`→`W` scan-node band for task
4.6 is **2.21–2.31×** measured on this corpus — widened from the 2.22–2.30× this batch first
recorded, by the F1 corrective's regeneration. Both readings sit inside the 2.1–2.4× band
task 4.6 expects; the wider pair is carried forward because a handoff band should be the
union of what was measured, not the narrowest single run.

---

# PR-1b corrective (fresh gate F1/F2)

Two findings from the fresh-context gate on PR-1b, applied and nothing else. The verified
work stands: no code was re-derived, no analysis restructured, no task re-opened.

## F1 — the tiebreak rule lives IN the report, computed not typed

The rule list that `renderFormVerdict` prints before the verdict named the band, the
statistic, the direction and attributability — but not the TIEBREAK, which is the rule that
actually decided this run. A reader reaching "**`W` wins** … the PRE-DECLARED tiebreak
decides" had to leave the artifact to learn what that tiebreak said. Two edits, both inside
the generated block so they cannot drift from the table beside them:

1. **A fifth bullet**, stating the tiebreak as task 2.7 pre-declared it BEFORE the run —
   textually minimal delta, a pure "wrap each `current_setting` call" transform identical for
   the standard and the `AIPromptTemplate` variant, and one adjacency rule for the
   form-uniformity gate matcher.
2. **The verdict line now names the winning body inline**, read from `POLICY_ARMS` rather
   than retyped beside it, so the verdict states the exact predicate the trio migration
   installs. A refusal guards it: a winner whose arm carries no `USING` body throws rather
   than rendering `USING (null)`. That guard is beyond the literal finding and is recorded as
   deviation 1 below.

## The regeneration, and what it changed

The finding required regenerating the artifact, and regeneration re-runs the measurement —
the risk the brief named. Run: DBUP, then the report's own documented invocation — all three
of its commands — with the committed run's parameters: `--policy-ab --projects 100 --posts
10000 --runs 3 --repetitions 5` (runs odd), then `--cleanup`, then `prettier --write`.

**The verdict is unchanged: `W` wins, by the same pre-declared tiebreak, with the same body.**
`decideForm` was applied as computed — nothing was hand-steered — so no STOP condition fired.
What DID move is the evidence beneath it, and this run is a strictly better illustration of
the rule than the one it replaces:

|                     | First run (Batch 2)   | Regenerated run                              | Why it matters                                                                                                               |
| ------------------- | --------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Probes in band      | 16 / 16               | 15 / 16 — `S3` out at 20 µs / 1.11 %         | `S3`'s sign FLIPPED across sweeps (−32, +12, +8, +33, +2 µs), so it is unattributable and adjudicated as noise               |
| Sign-stable probes  | 0 / 16                | 1 / 16 — `S2`, all five sweeps favouring `S` | but the whole move is 4 µs, INSIDE the band on the absolute limit, so it is unattributable too                               |
| Verdict path        | every move in band    | one probe fails EACH condition separately    | the two halves of the attributability rule are now demonstrated independently, which the first run could not show            |
| `Q4` pooled `S − W` | +12 µs / 0.70 %       | +2 µs / 0.12 %                               | the probe whose single sweeps ranged ±112 µs settles even closer to zero                                                     |
| `A′`→`W` scan band  | 2.22–2.30×            | 2.21–2.31×                                   | both inside task 4.6's expected 2.1–2.4×                                                                                     |
| `S2` regression     | 0.015 → 0.055 (3.67×) | 0.016 → 0.056 (3.50×)                        | same moved plan, same direction; 15 samples still do NOT overlap (`A′` 0.014–0.025, `W` 0.048–0.072)                         |
| `S1` `A′`→`W`       | 2 µs slower           | no measurable Δ (0.006 → 0.006)              | the InitPlan fixed cost is not separable from zero at this resolution — restated honestly rather than kept as a precise 2 µs |

`S2` is the run's incidental gift: at −7.14 % a relative-only band would have called it
out-of-band and handed `S` an attributable win on 4 µs of a 56 µs probe. The band's OR of an
absolute and a relative limit — declared before the run — is what stops a sign-stable
microsecond from choosing the policy form of 61 tables. That is now stated in the report.

**Row equivalence stayed the hard gate and stayed green**: 48 measurements written, all three
GUC states agreeing between `W` and `S` (bound tenant, `__system__`, UNSET), 0 three-valued
divergences, and the three shipped policies re-read and unchanged.

**The hand-written §Reading section was reconciled to the regenerated table.** Not a
re-derivation — the same sentences with the run's own figures — because a prose paragraph
contradicting the table above it is exactly the defect F1 exists to prevent. Reconciled: the
verdict paragraph, the `A′`→`W` adjudication table (9 rows), both moved-plan paragraphs, the
retired-four-arm cross-reference, and the SMELL-93 adjudication row at `:3935`. The Batch 2
section above was NOT back-edited — it carries a forward pointer instead, the same treatment
§The retired four-arm results gets.

## F2 — the `__system__` blindness is routed to Phase 8, three places

Task 2.5 proved that a bound-tenant digest CANNOT see a policy that lost its `__system__`
disjunct: the mutilated form returned identical rows and the run wrote a report at exit 0.
Task 8.9 rewrites 57 policies plus the variant through a `DO $$` loop and its evidence pass is
a per-policy digest — the identical blindness, at 19× the blast radius. Routed to all three
places a Phase 8 author could be reading:

| Place                                                     | What was added                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apply-progress.md` §Residuals                            | the residual, naming `proveFormEquivalence` as the reusable mechanism                      |
| `tasks.md` 8.9                                            | the obligation in the task text: three-GUC-state check PER POLICY, not only the row digest |
| Report §Reading, beside §The wrapped form moves two plans | one paragraph, so the durable artifact carries it too                                      |

## Also reconciled: the `tasks.md` DONE notes for 2.6 and 2.7

Not a third finding — a consequence of the regeneration, caught by sweeping for figures that
survived it. Both DONE notes cited run 1 and both POINT AT the report ("Adjudications … are a
named table in the report"), so a reader following that pointer landed on different numbers.
2.6 now names `S2`'s regression on both runs (3.67× / 3.50×) and says which one is in the
report; 2.7 now records that `W` won by the same tiebreak on BOTH runs and states each run's
band/sign counts. The verdict, the winner and the winning body never moved — only the
evidence beneath them — so neither task re-opened.

## Gate

| Gate                                                          | Result                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `prettier --check` (script + report + tasks + apply-progress) | **exit 0**                                                                                    |
| `eslint --max-warnings 0 scripts/rls-ab-measurement.ts`       | **exit 0**                                                                                    |
| Standalone script typecheck (SMELL-91)                        | **exit 0**                                                                                    |
| Regenerated verdict                                           | **`W` wins**, tiebreak path, winning body named inline — confirmed in the artifact at `:4078` |
| Row-equivalence hard gate                                     | 48/48 written; 3 GUC states, 0 divergences                                                    |
| Batch 1 intact                                                | untouched — verified below                                                                    |
| Orchestrator's PR-1a-gate addendum intact                     | untouched — verified below                                                                    |
| Database left as found                                        | re-verified out of band AFTER the run — see below                                             |

**Database left as found** — and the check EARNED its place, so it is recorded rather than
asserted. Read out of band BEFORE the run: 61 `tenant_isolation` policies, `Account` 354,
0 `tif-ab-%` leftovers, trio `qual` BARE with matching halves. Read again immediately after
the `--policy-ab` step: policies and trio form identical, but **`Account` was 356 with 2
`tif-ab-%` leftovers**. The arm swap is transaction-scoped, so the POLICIES were never at
risk; the FIXTURES are not, and the report's documented invocation is TWO commands for
exactly that reason — `--policy-ab` then `--cleanup`. Running the second restored it:
`Account` back to 354, 0 leftovers, 61 policies, trio still BARE with matching halves,
`PERMISSIVE ALL {public}`.

The lesson is the one this change keeps re-learning: an as-found claim asserted from the
happy path is not a check. Had the post-run read been skipped, this corrective would have
shipped 2 orphan fixture accounts under a line saying the database was left as found.

**Batch 1 and the orchestrator's addendum verified intact**: `## PR-1a fresh gate
(2026-09-10)` and everything above it is byte-unchanged; the only edits to this file below
that line are the §Residuals bullet, the Batch 2 forward pointer, the task-4.6 band handoff,
and this section.

## Deviations

1. **A refusal guard beyond the literal finding.** Naming the winning body required reading
   `POLICY_ARMS`, whose `using` is nullable (`A′` carries `null` by design). Interpolating it
   unguarded would print `USING (null)` on a broken arm list. Six lines, matching this file's
   established refusal-first style. Flagged rather than absorbed.
2. **The hand-written §Reading figures were updated.** The brief said not to re-derive or
   restructure, and nothing was: the analysis, the adjudications and their reasoning are
   unchanged. Only the numbers moved, to the ones the regenerated table now prints. Leaving
   them stale would have shipped a report whose prose contradicts its own generated block.
3. **The `S1` adjudication changed in KIND, not just in figure.** The first run measured 2 µs
   slower and explained it by InitPlan amortisation; this run measures no difference. The row
   now says both readings are inside the band and that the point read is where the form stops
   mattering — rather than asserting a mechanism at a resolution this harness does not have.

## Not done (by instruction)

Nothing outside F1 and F2. No git command was run. No migration, no schema change, no
production query. Phase 3 onward is untouched.

---

# Batch 3 — PR-1c: the four-arm index decision run (Phase 3, tasks 3.1–3.8)

> A SHORTLIST filter. The winner it names is what task 6.1's migration is authored from, and
> task 6.7 re-measures it against the COMMITTED index. No migration, no schema edit, no
> production query was touched: the database was read out of band afterwards and still holds
> the BARE trio form and the as-shipped index, byte-for-byte.

## Task ledger

| Task | State | Evidence                                                                                                              |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| 3.1  | `[x]` | `--index-ab` mode; arm tx in the design's exact order; plain `DROP INDEX`, never `CONCURRENTLY`                       |
| 3.2  | `[x]` | four arms `{IX0 control, IX1 +createdAt, IX2 (accountId, createdAt), IX3 DROP}`; DROP measured and LOST on evidence   |
| 3.3  | `[x]` | RED: planted `INSERT` → `heapFetches: 1` → arm ABORTED, exit 1, nothing written                                       |
| 3.4  | `[x]` | assertion live on non-zero AND absent counters; conversion is PARTIAL and the report says so                          |
| 3.5  | `[x]` | `(indexname, indexdef)` tuple proof; RED: name-only proof passes a same-name/different-key swap the tuple proof fails |
| 3.6  | `[x]` | **`IX1` wins ON MEASUREMENT**, 5 sweeps; 16/16 row-equivalence × 4 arms; all 9 out-of-band case rows adjudicated      |
| 3.7  | `[x]` | mechanics in the generated block + a SECOND measured bound the task could not have known (two-tenant selectivity)     |
| 3.8  | `[x]` | gate table below                                                                                                      |

## THE VERDICT (task 3.6)

**`IX1` — `("accountId", "projectId", "createdAt")`, partial `WHERE "deletedAt" IS NULL`.
It wins ON MEASUREMENT; the pre-declared tiebreak never applied.**

`IX1` is the only arm that improves an application case attributably and regresses none:

| Arm   | Admissible | Case improvements | Case regressions |
| ----- | ---------- | ----------------- | ---------------- |
| `IX1` | yes        | `Q1`, `Q5`        | —                |
| `IX2` | **no**     | `Q5`              | `Q2`             |
| `IX3` | **no**     | `Q5`              | `Q2`             |

The mechanism is in the plan column, not in the timing. Under the shipped index `Q1`/`Q5` run
`Limit → Sort → Index Scan` — the `(accountId, projectId)` key carries no ordering, so a
`LIMIT 20` over `ORDER BY "createdAt" DESC` must sort first. Under `IX1` both become
`Limit → Index Scan` with **no Sort node**: `Q1` 0.047 → 0.019 ms (−59.6 %), `Q5` 0.048 →
0.019 ms (−60.4 %), sign-stable across all five sweeps. **That is the displacement repair the
§after section flagged as `Q1 ×2.39` / `Q5 ×3.52`, now measured with its fix.**

**DROP was a real arm and it lost on evidence, not on preference.** The shipped index IS
selected under the control by `Q1`, `Q2` and `Q5` (read from the plans, not assumed), and
dropping it regresses `Q2` by 17 µs sign-stably. `IX2` fails on the same `Q2` mechanism: with
no `(accountId, projectId)` prefix the count falls to `Bitmap Heap Scan` on
`Post_projectId_archivedAt_idx`.

## Finding 1 — this corpus CANNOT decide the account-wide feed, in either direction

The most important bound in this batch, and it is not in the tasks.

`S3`, `Q3` and `Q4` — the unselective account-wide shapes — run `Seq Scan` under **every**
arm, `IX2` included. `(accountId, createdAt)` is in the arm list precisely to serve that feed,
and the planner never took it.

That is **not** evidence that it cannot: the corpus has **two tenants**, so `accountId`
selects half the table, and no index beats a sequential scan at 50 % selectivity. A production
corpus with hundreds of tenants makes `accountId` selective and the same shape could win the
feed it lost here.

So the feed question is undecided by this run, and the report says so explicitly, because the
alternative is that a later link reads `IX2`'s loss as a finding about a realistic tenant
distribution. It compounds with task 3.7's mechanics rather than replacing them: even with a
selective `accountId`, `IX1` cannot order the account-wide feed, because with only `accountId`
bound its range is ordered by `("projectId", "createdAt")`. **The winner repairs the
project-scoped listings and leaves the feed exactly where it was.**

## Finding 2 — the `Heap Fetches` assertion converts the inference only PARTLY

Task 3.4's stated purpose is to convert "an index built inside an open transaction still
yields index-only scans within it" from an uncited inference into evidence. Measured: it does
not get all the way there, and reporting otherwise would have been the exact defect the
assertion was added to prevent.

The authoritative run inspected **60** index-only-scan nodes across the four arms and every
one reported `Heap Fetches: 0`. But **all 60 are on `Project_id_accountId_key`** — an index
that already existed when the arm opened. **Not one plan took an index-only scan on an index
an arm built.** So what is converted is that the visibility map is settled and index-only
scans are clean inside the arm transaction (the precondition `VACUUM` + no-DML exist to
establish, worth having). What is NOT converted is the narrower claim about arm-built indexes:
the planner never chose one for an index-only scan on this corpus, so the assertion had no
subject for it.

That bounds the mode rather than invalidating it — the arms' figures are ordinary index and
sequential scans, which the visibility-map question does not touch — and task 6.7 re-measures
the winner against a committed index, where the question does not arise at all. The audit
table renders the split PER ARM (`inspected` vs `on the index THIS ARM BUILT`) rather than a
total that would have read as converted. That column is a repair to my own first renderer,
which printed "**Not vacuous**: 12 nodes, all clean" over a set containing zero arm-built
indexes — a true sentence that would have been read as the stronger claim.

## Finding 3 — a single sweep declares vacuous sign-stability, in BOTH deciders

Found in my own new `decideIndex` and traced straight into PR-1b's `decideForm`, which carries
the identical shape. The first one-sweep dry run of this mode announced:

```
**`IX1` — +createdAt extension.**
`IX1` improves 3 application case(s) (Q1, Q4, Q5) by an amount attributable to the SHAPE —
outside the band AND sign-stable across every sweep — with no attributable case regression,
so the measurement decides and the pre-declared preference order does not apply.
```

**"sign-stable across every sweep" over ONE sweep is vacuously true.** With one sweep there is
exactly one sign, so the test that exists to separate a property of the subject from a
property of the run stops separating anything while still printing its own name beside a
verdict. It is PR-1b's Finding 1 wearing the decision rule's clothes.

Repaired in a SHARED helper (`signStability`) used by both deciders rather than in mine alone,
because a second copy of a rule is a copy that drifts, and the weakness is the rule's, not the
index run's. Probe output, verbatim — the middle line is the one that matters, because it is
the proof that **PR-1b's committed verdict is untouched** (it ran at five repetitions):

```
PROBE signStability — ONE sweep, +20 µs: before=true after=false
PROBE signStability — five sweeps, all favouring the candidate: before=true after=true
PROBE signStability — five sweeps, sign flipping: before=false after=false
```

And the downstream GREEN, the same one-sweep data under the guard:

```
**`IX3` — DROP.**
no arm improves an application case by an amount attributable to the shape — every
candidate's moves are inside the band or sign-unstable — so the shapes are indistinguishable
on read cost and the PRE-DECLARED preference order decides among the admissible arms
```

Two different winners from one dataset, decided entirely by whether the rule was allowed to
lie about stability. The authoritative run uses **five** sweeps for that reason.

## Finding 4 — what the `Heap Fetches` counter can and cannot see

The planted `INSERT` fired the assertion under one arm and left it silent under two others, in
the SAME run. That is not a flaw in the plant; it is the counter's reach, and it is worth
stating because it bounds what the no-DML rule protects against:

```
RED-3.3 probe: arm IX0 Q7 run 1 index-only scans = [{"relation":"Project","index":"Project_id_accountId_key","heapFetches":0}]
RED-3.3 probe: arm IX1 Q7 run 1 index-only scans = [{"relation":"Project","index":"Project_id_accountId_key","heapFetches":0}]
RED-3.3 probe: arm IX2 Q7 run 1 index-only scans = [{"relation":"Project","index":"Project_id_accountId_key","heapFetches":1}]
```

A write clears visibility-map bits **for the pages it touches**, so the counter moves only
when the plan reads one of those pages. An index-only scan that is a point lookup on an
untouched page reports zero however much DML the arm did elsewhere. The assertion is therefore
a real gate (it fired, aborted the arm, and refused to write) but it is not a general DML
detector — the no-DML rule is what covers the rest, and it is structural: the arm issues DDL,
`ANALYZE`, `SET LOCAL ROLE`, `set_config`, the probe statements and their `EXPLAIN`s, nothing
else.

## TDD evidence — every gate born red

Same discipline note as Batches 1 and 2: `scripts/` sits outside every tsconfig project and
every test collector (**SMELL-91**), and the file executes `main()` at import, so a `vitest`
suite importing it would connect to the database rather than test a function. The RED for each
gate is therefore plant → observe → restore, run against the live database.

Pristine harness before any plant:
`sha256 1c6d49ef36d7bb9c5c7660953268d4c4af9699df2bafb4941a79e240f40ae4c1`. Every plant below
was removed and the file re-verified with `cmp` + `sha256sum -c` before the next one.

### 3.3 / 3.4 — the planted write, and a real abort

Plant: one `INSERT INTO "Project"` inside the arm transaction, after the posture assert,
exactly as the task specifies. Observed above in Finding 4; the assertion's own output,
verbatim, and the run's exit code:

```
arm IX2 Q7 run 1: an Index Only Scan on `Project_id_accountId_key` (Project) reported
`Heap Fetches: 1`. The arm is ABORTED as unrepresentative rather than reported as an
index-only result: the visibility map does not cover the pages this scan read, which is what
a write inside the arm transaction does, so the figure would be an in-transaction artifact
quoted as an index-only measurement. NOTHING was written.
EXIT=1
```

**Nothing was written** — the scratch report the run was pointed at does not exist
(`ls: cannot access …/redA.md: No such file or directory`). A real non-zero exit, not an
annotation.

### 3.5 — the restore proof, red-proven although the task asked only for GREEN

Plant: inside a rolled-back probe transaction, drop the shipped index and re-create it under
the **same name** with a **different key**. This is 1.4's `with_check` red in index form:

```
RED-3.5 probe: same-name different-key swap — name-only proof says: IDENTICAL (passes)
GREEN-3.5 probe: (indexname, indexdef) tuple proof says: DIVERGED (fails)
GREEN-3.5 probe: BEFORE Post_accountId_projectId_idx :: CREATE INDEX "Post_accountId_projectId_idx" ON public."Post" USING btree ("accountId", "projectId") WHERE ("deletedAt" IS NULL)
GREEN-3.5 probe: AFTER  Post_accountId_projectId_idx :: CREATE INDEX "Post_accountId_projectId_idx" ON public."Post" USING btree ("accountId", "createdAt") WHERE ("deletedAt" IS NULL)
```

### The shared refusal gate caught the new mode on its FIRST run

Not a planted red — the gate firing on real data, before any verdict existed. The very first
`--index-ab` smoke run used a small corpus and was refused:

```
Q8 declared `missProbe` but matched rows under IX0=10, IX1=10, IX2=10, IX3=10: the corpus has
moved out from under the probe, so its plan is no longer the empty-bucket plan it claims to
measure. NOTHING was written.
```

`Q8`'s empty bucket is its subject and it only stays empty at the documented corpus size. The
gate is the extracted `assertProbeEquivalence`, shared with the policy arms — which is exactly
why the index mode inherited a working refusal instead of a fresh copy of one.

## Files written

| File                                                        | Change                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `scripts/rls-ab-measurement.ts`                             | **+1028 / −55 authored** — see the budget deviation below                                                      |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                 | generated §index-ab block (+ its `index-ab` markers) and the hand-written §Reading the index shortlist run     |
| `openspec/changes/tenant-rls-cost-repair/tasks.md`          | 3.1–3.8 checked with evidence                                                                                  |
| `openspec/changes/tenant-rls-cost-repair/apply-progress.md` | this Batch 3 section, appended; Batches 1 and 2 and both gate addenda are byte-unchanged apart from the header |

Nothing under `infra/`, `.github/`, `.claude/`, `apps/`, `packages/` was touched. **No
migration, no schema change, no production query.** No git command was run — the orchestrator
owns git.

## 0-defect gate (task 3.8)

| Gate                                                    | Result                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace `pnpm typecheck`                              | **169/169, exit 0** — 168 cached + `@apps/api` re-run at `--max-old-space-size=6144` (the same LXC heap cap as PR-1a and PR-1b; `scripts/` is not in that program at all)                                                                                   |
| Standalone script typecheck (SMELL-91)                  | **exit 0**                                                                                                                                                                                                                                                  |
| `eslint --max-warnings 0 scripts/rls-ab-measurement.ts` | **exit 0**                                                                                                                                                                                                                                                  |
| Fitness #8 / #9 / #10 / #16 / #23                       | **0 / 0 / 0 / 0 / 0**                                                                                                                                                                                                                                       |
| `prettier --check` (script + report + openspec)         | **exit 0** — "All matched files use Prettier code style!"                                                                                                                                                                                                   |
| `pg_indexes` restore proof                              | **green** — before == after as `(indexname, indexdef)` tuples, in the report                                                                                                                                                                                |
| Row-equivalence hard gate                               | **16/16 probes × 4 arms × 5 sweeps**, whole-row digests, no divergence                                                                                                                                                                                      |
| Planted reds restored                                   | every plant removed; `cmp` + `sha256sum -c` clean after each                                                                                                                                                                                                |
| Database left as found                                  | read **out of band** AFTER the run and the cleanup: 61 `tenant_isolation` policies, trio `qual` still BARE with matching halves, `Post` at 10 indexes with the shipped one byte-identical, **zero arm-created leftovers**, `Account` 354, 0 `tif-ab-%` rows |

## Deviations

1. **AUTHORED SIZE 1083 LINES (script +1028 / −55) vs the ~250–330 forecast — over the
   400-line review budget.** Flagged, not absorbed; the orchestrator owns the decision.
   Measured distribution: the arm apparatus (`SHIPPED_POST_INDEX` → `runIndexAb`) is ~400
   lines, `renderIndexAbBlock` ~280, the decision machinery (`INDEX_PREFERENCE_ORDER` →
   `decideIndex`) ~170, the extracted `assertProbeEquivalence` ~95 (net ~+55 after the
   deletion from `runPolicyAb`), `signStability` ~22, and the CLI / `ScanNode` / `writePhase`
   / `main` / scaffold / header wiring ~50. **Recommended seam, if the orchestrator wants
   one**: PR-1c-i = tasks 3.1–3.5 (the apparatus; ends with a green run that produces per-arm
   tables and NO verdict) and PR-1c-ii = tasks 3.6–3.7 (the decision: preference order,
   `decideIndex`, the rendered rule, verdict and delta table, and the report's reading
   section). **Stated honestly, the split does not buy compliance**: the halves measure ~545
   and ~472, so both still exceed 400 and the chain pays an extra link for nothing. My
   recommendation is therefore ONE `size:exception` for PR-1c with the seam recorded above,
   rather than a split that leaves the same problem in two pieces. **Per the `chained-pr`
   skill the split is the DEFAULT and the exception needs explicit maintainer acceptance**, so
   this is a recommendation with its rationale, not a decision taken here.

   **Chain context** (`chained-pr` output contract). Strategy: `auto-chain`, `stacked-to-main`
   — unchanged from the tasks' forecast. Review budget: **1083** (`additions + deletions`),
   authored, script only; the regenerated report is excluded per the tasks' own rule, and the
   hand-written §Reading the index shortlist run adds ~110 authored Markdown lines on top.
   Boundary: starts at PR-1b's tip (the form verdict `W` committed), ends with the index
   shortlist verdict recorded; rollback is `git revert` of this link's script hunks plus the
   report's `index-ab` block — no schema, no migration, no production query, so the arms roll
   back by construction. Verification plan: the gate table above. Out of scope: committing any
   index (task 6.1), the trio policy migration (task 4.1), the reshape, the sweep, the gate.

   ```text
   PR-1a ✅ → PR-1b ✅ → PR-1c 📍 → PR-2 → PR-3 → PR-4
   (advisories) (form W)  (index IX1) (migrations+reshape) (sweep) (gate)
   ```

2. **The tasks pre-declared NO tiebreak for the index, unlike task 2.7 for the form.** One was
   authored BEFORE the run and rendered into the report above the verdict, and it is a
   write-path preference order (`IX3 > IX0 > IX2 > IX1`) with its reasoning stated: when the
   reads cannot be told apart, fewer indexes is strictly cheaper on every write, and keeping
   the shipped shape needs no migration. **It never applied** — `IX1` won on measurement — so
   it decided nothing in this run, which is the safest possible outcome for a rule the tasks
   did not pre-declare.
3. **The arms measure all 16 `AB_PROBES`, not the 13 cases alone.** Additive: `AB_PROBES` is
   already the list the refusal gates read, and the three synthetic shapes include `S3`, the
   account-wide feed shape this comparison exists to test. Excluding them would have cost the
   run its only unselective probe.
4. **`assertProbeEquivalence` was extracted from `runPolicyAb`, which is PR-1b's verified
   code.** The alternative was a second copy of the row-equivalence gate — the acceptance
   criterion of this whole change — in the new mode. The policy path's message bytes are
   preserved except the one vacuity sentence, which is now parameterised because "a policy
   that hides everything is trivially fast" is false of an index arm: an index cannot change
   which rows exist.
5. **`signStability` also changes `decideForm`.** PR-1b code, changed deliberately (Finding 3).
   Proven not to move PR-1b's verdict: at five repetitions the old and new logic agree, shown
   in the probe above, and the committed §policy-ab block was NOT regenerated.
6. **`ScanNode` gained `indexName`.** One field in `walkPlan`, so the `Heap Fetches` failure
   can name the offending index instead of only its relation.
7. **`ANALYZE "Post"` runs in the control arm too**, though the control performs no DDL. Not
   in the design's arm sketch, which lists it after the DDL: without it the control would be
   the only arm planning against differently-refreshed statistics, and the comparison would
   carry that difference silently.

## Residuals — named, not fixed

- **The arm-built-index inference stays unconverted** (Finding 2). Closing it would need a
  probe the planner answers with an index-only scan on the arm's own index; none of the 16
  does on this corpus. Task 6.7's committed re-measure makes the question moot for the
  decision, so it is recorded rather than chased.
- **The account-wide feed is undecided on this corpus** (Finding 1). Deciding it needs a
  corpus with a realistic tenant count, which is a different measurement exercise than this
  change scopes.
- **`Post_projectId_createdAt_idx`'s redundancy is untouched.** `Q5` reaching it under
  `IX2`/`IX3` shows it is live and useful — an input to task 10.2's SMELL-94 row, not an
  answer to it.
- **SMELL-91** — untouched: `scripts/` is outside every tsconfig project and every collector,
  so this file's only typecheck is the standalone invocation Batch 1 recorded under §Commands.

## Not done in this batch (by instruction)

Phase 4 onward: every migration, the `listGlobal` reshape, the schema edit, the 58-policy
sweep, and the form-uniformity gate. `infra/` and `.github/` were not opened.

## Next

`sdd-apply` for **PR-2** (Phase 4, tasks 4.1–4.8 as commit c1), which is the first
token-gated link. It inherits two decided inputs: the policy form is **`W`** (Batch 2) and the
index shape is **`IX1` `("accountId", "projectId", "createdAt")` partial
`WHERE "deletedAt" IS NULL`** (this batch), with `Post_accountId_projectId_createdAt_idx` as
the name the arm installed and therefore the name task 6.1's migration should create. Task
6.2's schema docblock must state the MEASURED outcome — the `Sort` elimination on `Q1`/`Q5`,
the two-tenant bound on the feed, and the single-corpus caveat — and must not restate the
reasoning the measurement did not test.

## PR-1c fresh gate (2026-09-10) — PASS; one latent defect killed inline

The fresh-context gate PASSED this batch on all eight checks (numstat exact, verdict chain in
the artifact, corpus caveat routed, Heap-Fetches over-claim refused, the `decideForm` touch
proven byte-inert for PR-1b's committed verdict, deviations flagged, gates re-run at exit 0)
with two non-blocking findings, both closed:

1. **Latent `rank()` tie-break on the measurement path — removed by the orchestrator.**
   `decideIndex`'s contenders sort carried `rank(armId)` as a hidden third key while the basis
   it emits asserts "the pre-declared preference order does not apply". It never engaged in
   this run (contenders = `IX1` alone), so the committed verdict and report are untouched and
   no regeneration is needed — the change is behavior-identical for this data. A residual tie
   on both declared measurement keys now REFUSES with a recorded message instead of deciding,
   which is what the declared rule always said. Same defect class as the vacuous
   sign-stability this batch itself repaired; killed before it could ever fire.
2. **Relay figure only:** Batch 3's numstat in the phase-agent's summary read +313/−2; the
   actual is +331/−2. Nothing in the tree carried the wrong figure.

`size:exception` for this link was accepted by Edward (2026-09-10) with the measured
rationale: the apparatus/decision seam yields ~545/~472 — both over budget — so a split buys
no compliance and costs a chain link.
