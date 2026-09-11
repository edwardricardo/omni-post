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

---

# Batch 4 — PR-2 commit c1 (the trio policy rewrite)

Tasks **4.1–4.8**, all eight closed. Phase 5 onward was NOT started, by instruction.

## What landed

| File                                                                          | Kind           | What                                                                                 |
| ----------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `infra/prisma/migrations/20260910000000_rls_initplan_post_trio/migration.sql` | new, SENSITIVE | Rewrites the three trio `tenant_isolation` policies to the `W` body, both clauses    |
| `infra/prisma/migrations/20260910000000_rls_initplan_post_trio/down.sql`      | new, SENSITIVE | Restores the bare bodies verbatim; RLS stays enabled and the policies stay installed |
| `apps/api/tests/integration/rls-tenant-isolation.test.ts`                     | edited         | +1 describe, +4 tests: the deployed-catalog form assertions (task 4.5)               |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                                   | regenerated    | The authoritative `--policy-ab` capture against the committed form (task 4.6)        |

The migration and its `down.sql` were authored under the active `sensitive-edit` token, first
and fast, before any measurement work. Nothing else in this batch was token-gated.

## The headline number, and what actually proves it

The `A′` arm of the re-run is the COMMITTED policy, re-read and reported unchanged — not a
copy, not the rollback arm. Its scan-node medians moved:

| Probe | `A′` before (bare) | `A′` after (committed) | Ratio |
| ----- | ------------------ | ---------------------- | ----- |
| `S3`  | 4.163 ms           | **1.834 ms**           | 2.27× |
| `Q3`  | 4.209 ms           | **1.876 ms**           | 2.24× |
| `Q4`  | 3.808 ms           | **1.707 ms**           | 2.23× |

All three sit inside task 4.6's expected 2.1–2.4× band and inside the 2.21–2.31× band Batch 2
handed forward. **The scan-vs-statement distinction Batch 2 flagged was load-bearing exactly as
predicted**: the statement medians move ~1.81×, which is OUTSIDE that band, and a reader
checking the wrong statistic would have opened a defect against a policy that is behaving.

The strongest evidence is not the timing at all — it is that **`A′`'s InitPlan count moved 0 → 2**.
That is the PLANNER agreeing that the GUC read is now statement-scoped, and it is independent of
both the catalog text and the clock.

## Row-equivalence and the adjudications

Row-equivalence is **13/13**. The harness's digest gate is a hard throw naming the probe, the
arms and the digests, so a green exit IS the proof rather than a line to read; the run exited 0.
Alongside it, the three-GUC-state semantic table reports **0 three-valued divergences** in every
state (bound tenant, `__system__`, UNSET) — the leg the bound-tenant case run structurally
cannot reach.

Two probes moved out of band, and each is adjudicated by the pre-declared rule rather than by
opinion:

| Probe | Delta            | Sign across 5 sweeps | Adjudication                           |
| ----- | ---------------- | -------------------- | -------------------------------------- |
| `S2`  | 7.0 µs (13.21 %) | FLIPPED              | Noise. Measures the run, not the form. |
| `Q4`  | 20.0 µs (1.18 %) | FLIPPED              | Noise. Measures the run, not the form. |

Neither is attributable, so the verdict re-computes to **`W` wins** by the pre-declared tiebreak
— the same verdict the migration was authored from, now re-derived with the migration in place.

## The catalog, and the red that proves the assertion can fail

Task 4.5's assertions read `pg_policies`, never the migration bytes. The deployed rendering for
all three tables, in both clauses:

```text
((( SELECT current_setting('app.account_id'::text, true) AS current_setting) = '__system__'::text)
 OR ("accountId" = ( SELECT current_setting('app.account_id'::text, true) AS current_setting)))
```

`permissive = PERMISSIVE`, `cmd = ALL`, `roles = {public}` on all three — the full 5-tuple, which
is the comparison that matters here because an arm re-created with `USING (...)` alone leaves
`qual` byte-identical while silently dropping `with_check` to null.

Task 4.8's scratch-database run (`omnipost_rls_downtest`, created and dropped by the run) walked
bare → forward → down → forward and read the 5-tuple at each step:

- **down restores the bare 5-tuple exactly: YES**
- **re-apply reproduces the forward 5-tuple: YES**
- **forward differs from bare (not a no-op): YES**

That run is also the **RED for 4.5**. The matcher evaluates FAIL on the bare form — both at the
start and after the rollback — and PASS on the wrapped form. The assertion is therefore proven
capable of failing, on precisely the form this change replaces, which is the only red a
catalog-pinning test over already-committed state can honestly produce.

## Gate results for this batch

| Check                       | Result                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| SQUAWK (pinned v2.49.0)     | `Found 0 issues in 1 file`, exit 0 — **no rule fired, nothing waived**  |
| `prisma validate`           | valid                                                                   |
| `prisma migrate status`     | up to date, 81 migrations                                               |
| INT `rls-tenant-isolation`  | 25 pass / 0 fail / **0 cancelled / 0 skipped**, run twice               |
| policy↔guard parity         | 61, unchanged                                                           |
| `eslint --max-warnings 0`   | exit 0 on the touched test file                                         |
| prettier                    | clean, including the regenerated report                                 |
| fitness #32 (`.only/.skip`) | 0 on the touched test file                                              |
| Database left as found      | migration APPLIED (this one persists); fixture corpus cleaned to 0 rows |

## Deviations, stated

1. **`--repetitions 5`, not the default 3.** Task 4.6 pins `--runs 3` and is silent on
   repetitions. PR-1b's authoritative capture used 5, and the sign-stability rule is vacuous
   below 2 sweeps, so matching 5 keeps this run's adjudications comparable with the verdict it
   is checking. Recorded rather than assumed.
2. **The AB legend command in `tasks.md` does not run.** `pnpm exec tsx scripts/rls-ab-measurement.ts`
   exits 1 with "no database channel configured"; the harness prints the canonical form itself,
   and the report's reproduction block carries it:
   `node --import tsx --conditions development --env-file=.env scripts/rls-ab-measurement.ts …`.
   The legend is missing `--env-file=.env`. Not fixed here — `tasks.md` is the change's own
   planning artifact and correcting the legend is a one-line edit the orchestrator should make
   deliberately, not a writer's drive-by. Flagged for the PR-2 gate.

## Not done in this batch (by instruction)

Phase 5 onward: the `listGlobal` reshape and its mirrors, the index winner and its migration,
the `audit.yml` adjudication (orchestrator-owned), `schema.prisma`, the PR-2 gate, and the
58-policy sweep.

## Next

`sdd-apply` for **PR-2 commit c2** (Phase 5, tasks 5.1–5.6, then Phase 6). c2 inherits from here:
the trio's committed form is `W`, verified in the catalog and by the planner, and the index work
in Phase 6 measures against THIS policy form rather than the bare one.

---

# Batch 4b — corrective pass on c1 (fresh-gate findings F1, F2, F3; F4 prepared)

No new tasks. This pass repairs three defects the fresh gate found in Batch 4's own output,
before c1 is committed. **The c1 commit is DEFERRED pending F4** — see §F4 below.

## F1 — the tautological test

`apps/api/tests/integration/rls-tenant-isolation.test.ts`, the assertion that was titled
_"a policy that declared no WITH CHECK still declares none"_. It filtered `pg_policies` to the
rows whose `with_check` is null and then asserted that those rows have a null `with_check` — it
re-stated its own selector, so it could not fail. It passed on an empty catalog, and it would
have passed on a catalog where every policy had silently lost its `WITH CHECK`.

Replaced with an equality against a declared literal beside the test:

```ts
const EXPECTED_NO_WITH_CHECK: string[] = [];
const withoutCheck = rows.filter((r) => r.with_check === null).map((r) => r.tablename);
assert.deepStrictEqual(withoutCheck, EXPECTED_NO_WITH_CHECK, ...);
```

Empty because every enrolled policy declares `WITH CHECK` explicitly today — verified against
the live catalog, not assumed. A literal rather than a derivation on purpose: a policy that
legitimately drops its `WITH CHECK` updates this list in a diff a reviewer reads, instead of
being absorbed by a rule that recomputes the answer from the catalog it is checking. Now fails
on a GAINED and on a LOST `WITH CHECK` alike. Renamed to _"exactly the policies expected to
declare no WITH CHECK declare none"_.

### RED 1 — planted literal, real non-zero exit

Planted `EXPECTED_NO_WITH_CHECK = ["PostMedia"]`, ran the INT file. Verbatim:

```text
✖ exactly the policies expected to declare no WITH CHECK declare none (4.365965ms)
  AssertionError [ERR_ASSERTION]: the set of tenant_isolation policies declaring no WITH CHECK
  moved. expected [PostMedia], catalog holds []. A policy that LOST its WITH CHECK leaves row
  mutation ungated; one that GAINED it tightens writes another layer was gating. Either way the
  change is deliberate or it is a defect — update this literal only for the former.
  + actual - expected
  + []
  - [ 'PostMedia' ]
ℹ tests 25   ℹ pass 24   ℹ fail 1   ℹ cancelled 0   ℹ skipped 0
=== EXIT: 1 ===
```

Restored and verified **byte-exact** (`sha256sum -c` →
`ca3c55ca51ca331f081cbc2a25f122ce3efc4713ba767fa073ccb6ef799c44b9  OK`).

### RED 2 — transaction-scoped CATALOG change, and the comparison that matters

A planted literal proves the assertion reads its literal. It does not prove it reads the
CATALOG. So a throwaway probe (planted under `apps/api/tests/integration/`, run, deleted —
tree confirmed clean afterwards) made a real policy lose its `WITH CHECK` inside a transaction
and rolled back, per this suite's own `SET LOCAL` / rollback pattern. It ran **both** forms
against the same planted state. Verbatim:

```text
BEFORE PostMedia with_check is null? false
BEFORE Project qual hoisted count: 0
(a) OLD tautological form: PASSED on a lost WITH CHECK  <- the defect
(a) RED: Expected values to be strictly deep-equal:
(a) catalog holds: ["PostMedia"]
(b) qual-only predicate flags it?  false   <- the blind spot
(b) widened predicate flags it?   true   <- the widening
RESTORE PostMedia 5-tuple identical? true
RESTORE Project 5-tuple identical? true
```

**Line 3 is the finding.** On a real `WITH CHECK` disappearing from a live trio policy — the
exact state that leaves row mutation ungated while every read-path assertion in the file stays
green — the form Batch 4 shipped PASSED and the corrective form FAILED. Measured, not argued.

## F1b — the non-blocking widening (blast radius)

_"no policy outside the trio was rewritten by this migration"_ read only `r.qual`, while the
migration's own header says **BOTH CLAUSES MOVE**. A sweep that reached an out-of-scope policy's
`WITH CHECK` only would have been invisible to it. Widened to
`countOf(qual, HOISTED) > 0 || countOf(with_check, HOISTED) > 0`.

Its red is line (b) of RED 2 above: with an out-of-trio policy (`Project`) rewritten in
`WITH CHECK` only, the qual-only predicate returns **false** and the widened predicate returns
**true**. Both 5-tuples identical after rollback.

## F2 — the self-contradicting report section

`docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §_Reading the form decision run_ claimed to read
"the generated block above" while reading **PR-1b's** superseded numbers. Both were true when
written and the c1 re-run regenerated the block underneath them, so the prose and the table it
cited disagreed: the prose said `S3` was out of band and `S2` in-band-and-sign-stable; the block
says `S3` 13.0 µs / 0.71 % **in** band, `S2` 7.0 µs / 13.21 % **out**, `Q4` 20.0 µs / 1.18 %
**out**, all three sign-unstable.

Repaired with the file's own established pattern (§_The retired four-arm results_) — date it,
scope it, keep it, do not retract it:

| Change                                                                    | Effect                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Section lead now maps **two runs**, each with its capture timestamp       | PR-1b `2026-09-10T01:58:27.936Z` (bare `A′`) vs c1 re-run `2026-09-10T03:03:11.307Z` (committed wrapped `A′`)                  |
| NEW §_The current reading — the c1 re-run_                                | Written FROM the generated table: verdict unchanged (`W` by tiebreak), the three probes with their real band/sign/adjudication |
| §_The verdict…_ → §_The PR-1b verdict, and the adjudications it owed_     | Opens by naming the capture it reads and that it is superseded; tense moved to past                                            |
| §_The wrapped form moves two plans_ → _…in the PR-1b capture_             | A bare-vs-wrapped plan move is only observable while one arm is bare, which the block above no longer has                      |
| Stale cross-reference "both ranges are printed in §S2 of the block above" | Now says they are from that capture's §S2 and that the current block runs all three arms wrapped                               |
| `Q4` "+2 µs / 0.12 %, inside the band"                                    | Kept as the PR-1b reading, with the c1 figure (20 µs / 1.18 %, outside) stated beside it                                       |
| `Q6` plan-move paragraph                                                  | Attributed to "PR-1b's bare `A′`", plus what the c1 run shows (all three arms on the `Nested Loop` plan)                       |

Also fixed the stale ratio line in §_The regressions, and the adjudication of each_: it called
the BARE body "the shipped form", which the trio's shipped form no longer is, and said the
rewrite "is a follow-up, not this unit" after it had shipped. Now marked **since SHIPPED for the
trio**, naming the migration, the committed ratios, and that the remaining 58 policies are still
bare. The section's historical framing is preserved rather than rewritten.

**A finding worth keeping, surfaced by writing the current reading:** the out-of-band probes
SWAPPED identity between the two captures — PR-1b's was `S3`, c1's are `S2` and `Q4`, and
PR-1b's one sign-STABLE probe is sign-unstable in c1. Two captures of the same two forms 65
minutes apart. A rule attributing the verdict to whichever probe fell out of band would have
named a different winner each time; the pre-declared out-of-band **AND** sign-stable conjunction
is what makes both runs agree.

## F3 — the headline evidence into the artifact

New §_The superseded pre-migration capture — what the committed rewrite actually moved_,
hand-written and OUTSIDE the generated block so a regeneration cannot erase it. It records what
was previously legible only by diffing two generated blocks across a commit:

| Capture                       | `A′` InitPlan count | `A′` `S3` plan nodes                        |
| ----------------------------- | ------------------- | ------------------------------------------- |
| PR-1b — bare body             | **0**               | `Limit → Sort → Seq Scan`                   |
| c1 re-run — committed wrapped | **2**               | `Limit → Result → Result → Sort → Seq Scan` |

| Probe | scan-node bare | scan-node committed | Ratio     | statement bare | statement committed | Ratio |
| ----- | -------------- | ------------------- | --------- | -------------- | ------------------- | ----- |
| `S3`  | 4.163 ms       | **1.834 ms**        | **2.27×** | 5.438 ms       | 3.017 ms            | 1.80× |
| `Q3`  | 4.209 ms       | **1.876 ms**        | **2.24×** | 6.656 ms       | 4.283 ms            | 1.55× |
| `Q4`  | 3.808 ms       | **1.707 ms**        | **2.23×** | 5.110 ms       | 2.974 ms            | 1.72× |

**Every figure verified from the artifact, not retyped from the brief**: the bare column and the
`InitPlan 0` from `git show HEAD:docs/reports/TENANT_RLS_AB_MEASUREMENT.md`, the committed column
from the working-tree generated block, both cross-checked against Batch 4's own headline table.

The statement ratios are carried deliberately: they spread 1.80× / 1.55× / 1.72× where the scan
nodes agree to within 0.04×, which is the "not interchangeable" warning made concrete instead of
asserted. Two caveats are stated in the section — the comparison is `A′`-to-`A′` across captures
(like with like, not control-vs-candidate), and PR-1b's `W` reads 1.804 ms against c1's `A′`
1.834 ms on `S3`, i.e. 30 µs of run-to-run drift on a body that did not change.

## F4 — PREPARED, NOT APPLIED

`infra/prisma/**` is token-gated and the token is expired, so **nothing under it was touched**.
The migration on disk is byte-identical to what c1 authored.

Prepared at
`/tmp/claude-0/-root-omni-post/0c4404f3-535e-4fdd-84ff-6c4c1dcf6a70/scratchpad/c1-f4-migration-header.md`:
the exact current bytes of `migration.sql:12-25`, the exact replacement (citation repointed to
§_The superseded pre-migration capture…_ by its real title; figures restated 4.163→1.834 etc. at
2.27× / 2.24× / 2.23×; the `InitPlan 0 → 2` corroboration added), plus **Hunk B** for lines 27-30
— which Hunk A forces, because it deletes the `2.26x` that line 27 back-references as "the 2.26x
above" — an optional Hunk C for `down.sql`, and the apply runbook.

**Why the runbook is not just an edit.** The migration is APPLIED (`prisma migrate status` → 81
migrations, up to date). Prisma checksums applied migrations and a comment-only change moves the
checksum, so the sequence is: token → edit → `psql $MIGRATE_DATABASE_URL -f down.sql` → delete
the `_prisma_migrations` row for `20260910000000_rls_initplan_post_trio` (expect `DELETE 1`) →
`pnpm db:up && pnpm db:migrate` re-applies with a fresh checksum → re-verify the catalog 5-tuple
→ re-run the INT file. The runbook also names the abort path: if the revert/delete cannot be run,
do NOT edit the migration — a modified applied migration fails CI on every subsequent run, and
the report already holds the correct regeneration-proof section, so only the pointer is lost.

**c1-commit-deferred-pending-F4.** The commit should carry the migration header and the report in
one change; committing now would ship a citation pointing at a section that no longer holds its
numbers.

## Gate results for this pass

| Check                                    | Result                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| INT `rls-tenant-isolation` (green)       | **25 pass / 0 fail / 0 cancelled / 0 skipped**, exit 0                      |
| INT with F1 planted (red)                | 24 pass / **1 fail**, **exit 1** — real failure, verbatim above             |
| Catalog-side red (F1) + widening red     | Both demonstrated in-transaction; 5-tuples identical after rollback         |
| `eslint --max-warnings 0` (touched file) | exit 0                                                                      |
| prettier                                 | clean on both touched files                                                 |
| fitness #32 (`.only` / `.skip`)          | 0 on the touched test file                                                  |
| fitness #8 (sprint/phase refs)           | 0 on the touched test file                                                  |
| Generated block integrity                | untouched — prettier proven a **no-op** on the committed report (see below) |
| `infra/prisma/**`                        | **not touched** — F4 prepared only                                          |
| git                                      | **not run** — orchestrator-owned                                            |

**The generated-block check is not a claim, it is a measurement.** `git diff` shows hunks inside
the `generated:policy-ab` markers, which would be alarming if they were mine — they are the c1
regeneration that was already uncommitted in the working tree. Proven two ways: two generated
lines re-read byte-identical to their pre-edit values, and a copy of the COMMITTED report run
through prettier at the same path came back `(unchanged)` with a clean `diff`. A first attempt at
that second proof was **false** — `pnpm exec` failed outside the workspace, prettier never ran,
and the `diff` passed trivially on an unmodified copy. It is recorded because a proof that passes
without executing is exactly the failure mode this gate exists to catch.

## Files changed in this pass

| File                                                        | Action   | What                                                                       |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `apps/api/tests/integration/rls-tenant-isolation.test.ts`   | Modified | F1 assertion rewritten; F1b blast-radius predicate widened to both clauses |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                 | Modified | F2 rescoping + F3 new superseded-capture section + stale ratio line fixed  |
| `openspec/changes/tenant-rls-cost-repair/apply-progress.md` | Modified | This section                                                               |

Rollback boundary: the two content files revert independently of each other and of Batch 4's
migration, which this pass did not touch.

---

# Batch 5 — PR-2 commit c2, first half: the `listGlobal` reshape and its mirrors (tasks 5.1–5.6)

**Assigned slice: Phase 5 only.** The index-winner migration, the schema edit and the
`audit.yml` adjudication are token-gated and orchestrator-scheduled, and none of them was
touched. Nothing under `infra/prisma/**`, `.github/**` or any `.env*` was opened.

Native attempt authority acquired before any read: `sdd-attempt acquire … --request-id
pr2c2a-acq-001` → `state: proceed`. The two migration paths in that invocation are ledger
arguments; the files were not opened.

## What landed

`listGlobal` filters the tenant on `Post`'s own column and keeps project liveness relational:

```text
old  WHERE deletedAt IS NULL AND project: { accountId, deletedAt: null }
new  WHERE accountId = <server-derived> AND deletedAt IS NULL AND project: { deletedAt: null }
```

Port signature unchanged, account value still server-derived, no caller-supplied scope
selector introduced. Everything below rides in the SAME commit, which is the phase's own
constraint: a mirror updated one commit later than the query it mirrors is a mirror that was
briefly lying, and nothing in the harness could have said so.

## TDD evidence — the red is a missing predicate, not a thrown evaluator

| Task | RED                                                                                           | GREEN                        | REFACTOR                                                         |
| ---- | --------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| 5.1  | `1 failed / 38 passed` — `AssertionError: expected undefined to be 'd0000000-…-000000000001'` | n/a (this task IS the red)   | second fidelity pin added for the tenant half                    |
| 5.2  | inherits 5.1's red                                                                            | `39 passed / 39`, exit 0     | docblock states the FK reason rather than the fact alone         |
| 5.3  | mirror plant → `Q3 FIDELITY MISMATCH`, exit 1 (see below)                                     | `13/13 ok`, exit 0           | catalog docblock reclassified into SCHEMA-MOVED / EMISSION-MOVED |
| 5.4  | n/a — docblock tidies carry no behaviour                                                      | `39 passed / 39`             | applied before 5.3's ref refresh so the refs commit true         |
| 5.5  | n/a — the confirming run                                                                      | `39 passed / 39 / 0 skipped` | —                                                                |
| 5.6  | old-mirror plant proves the blindness; `deletedAt` plant proves the check can fail            | all three legs green         | corpus discrimination planted so the equality can fail           |

**Why 5.1 needed to be its own task, confirmed in practice.** `applyWhere` throws on any key
it does not model. Without the `accountId` branch the suite would have ERRORED on the first
call after the reshape, and an error is not a red — it says the mock is behind, not that the
code is wrong. The observed failure is `expected undefined to be '<account id>'`: the
predicate is absent from the emitted `where`. That is the reshape's contract failing, which
is the only red worth having.

## Finding 1 — the mirror blindness this phase warns about is REAL, and now measured

`tasks.md` calls this "the highest mechanical risk in this change": fidelity validates the
QUERY, not the REFERENCE, so a stale mirror returns the same rows and passes. It was asserted
by the design and is now a measurement:

| Plant on `Q3`'s mirror                         | Verdict                      | Exit  | Report written |
| ---------------------------------------------- | ---------------------------- | ----- | -------------- |
| reverted to the OLD relation-tenant SQL        | `Q3 ok` — **caught nothing** | **0** | yes            |
| `p."deletedAt" IS NULL` removed (row-CHANGING) | `Q3 FIDELITY MISMATCH`       | **1** | **nothing**    |

The second row is what stops the first from being an indictment: the check is not vacuous, it
is specifically blind to row-preserving substitution — which is exactly what a reshape is.
File restored byte-exact after both plants (`sha256 7eb9f2cd…c6bbeec0`, identical to the
pre-plant checksum) and re-ran 13/13 green.

**What this buys the reshape**: leg (b) alone would have been worthless as row-equivalence
evidence, because it compares a case's SQL mirror against that case's own PRISMA mirror —
two hand-written objects — not against the repository. Leg (a) is what binds the repository
to the Prisma mirror (the two `where` objects are the same literal). Only the pair spans
repository → Prisma mirror → SQL mirror, and the report now says so instead of letting
"13/13" read as more than it is.

## Finding 2 — the corpus could not discriminate the liveness half, and the tenant half is invisible from where a tenant sits

The cross-shape probe returned old = new = 9500, digests equal, `EXCEPT` 0 both ways, under
bound tenant AND `__system__`. It also reported **`soft_deleted_projects = 0`** — the seeded
corpus has none, so that equality could not tell "liveness preserved" from "liveness dropped".
Planting one inside a rolled-back transaction, and asking each half whether the probe can
fail at all:

| Variant (one project soft-deleted) | Rows under `tif-ab-a` | Reads                                    |
| ---------------------------------- | --------------------- | ---------------------------------------- |
| old shape                          | 9400                  | baseline                                 |
| new shape                          | 9400                  | agrees over a corpus that could disagree |
| new shape, liveness half dropped   | **9500**              | +100 — the probe CAN see it              |
| new shape, tenant half dropped     | 9400                  | **invisible** — RLS already filters it   |

That last row is a limit, not a defect, and it is the same blindness class task 2.5 closed
for the trio: under a bound tenant the query's own tenant predicate is redundant with the
policy. Asked again under `__system__`, the tenant-dropped variant returns **19000 against
9500** — 9500 foreign rows a dropped predicate would leak. So the tenant half IS
discriminable, just not from inside a tenant. Both plants rolled back; project re-read live.

The UNSET-GUC state is recorded and explicitly NOT counted: `0 = 0` holds no matter what
either query says, which is the harness's own `nonEmpty` rule applied by hand.

## Finding 3 — the composite FK was asked directly, with a control

The reshape's whole justification is that a `Post` whose `accountId` disagrees with its
`Project`'s cannot exist. Rather than cite `schema.prisma:706`:

| Insert into `Post`                                                 | Outcome                           |
| ------------------------------------------------------------------ | --------------------------------- |
| `projectId = tif-ab-a-proj-0001`, `accountId = tif-ab-a` (control) | **ACCEPTED**                      |
| `projectId = tif-ab-a-proj-0001`, `accountId = tif-ab-b`           | **`23503 foreign_key_violation`** |

The control is the half that makes it evidence: without it a rejection could be a malformed
statement rather than the constraint refusing. Both rows rolled back; zero probe rows left.

## Finding 4 — the catalog docblock was stale in the same way the mirrors would have been

`scripts/rls-ab-measurement.ts`'s `CASES` header asserted "`Q3`, `Q4`, `Q6`, `Q7` and every
child read are textually identical across the two phases". This task falsifies it for `Q3`
and `Q4`, and nothing in the harness reads that sentence, so it would have sat there as a
false claim about the very cases the phase moves. It now names two classes, because the
attribution genuinely differs: **SCHEMA-MOVED** (`Q1`/`Q2`/`Q5`/`Q8` — emission moved because
`Post` gained the column, so their §Before→§After delta mixes schema and query) and
**EMISSION-MOVED** (`Q3`/`Q4` — the column already existed when §After was captured, so their
delta against §After is attributable to the QUERY alone, the cleanest in the catalog).

The report's own §"Two things changed, not one" table was **left alone**: it is a true reading
of the capture it sits under, and rewriting it would falsify a historical reading. A dated,
scoped paragraph beneath it records that the table stopped describing the current mirrors on
2026-09-10 and why a future re-capture inherits a different attribution.

## Files written

| File                                                                    | Action   | What                                                                                   |
| ----------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts` | Modified | the reshape + both docblock tidies (`getById`, `listGlobal`)                           |
| `apps/api/tests/unit/infrastructure/PrismaPostQueryRepository.test.ts`  | Modified | local `accountId` on fixtures, foreign one on a3, evaluator branch, 2 new tests        |
| `scripts/rls-ab-measurement.ts`                                         | Modified | `Q3`/`Q4` mirrors (both halves) + `why` lines, catalog docblock, 6 `sourceSite` refs   |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                             | Modified | new hand-written row-equivalence section + the scoped note under the attribution table |
| `openspec/changes/tenant-rls-cost-repair/tasks.md`                      | Modified | 5.1–5.6 marked `[x]` with evidence                                                     |
| `openspec/changes/tenant-rls-cost-repair/apply-progress.md`             | Modified | this section                                                                           |

**No file was created and none was deleted**, so the attempt ledger's untracked inventory is
unchanged.

Rollback boundary: the reshape is a single-file revert; the mirrors + `sourceSite` refresh is
a second single-file revert; the two report edits are hand-written sections that lift out
without touching any generated block. None of the three depends on the others to compile, but
reverting the reshape WITHOUT the mirrors would leave the harness measuring a query the
application no longer issues — so they revert together or not at all, which is why they are
one commit.

## Work Unit Evidence

| Evidence             | Value                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command | `VITEST tests/unit/infrastructure/PrismaPostQueryRepository.test.ts` → **39 passed / 39**, exit 0                                                   |
| Runtime harness      | `--phase after --runs 3 --out <scratch>` → **13/13 `ok`**, exit 0; plus the psql cross-shape probe in one bound transaction across three GUC states |
| Rollback boundary    | the three reverts above; database left as found (`--cleanup` → 0/0/0/0/0, control 354)                                                              |

## Gate results for this batch

| Check                                       | Result                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| VITEST (the assigned unit file)             | **39 pass / 0 fail / 0 skipped**, exit 0                                       |
| Harness fidelity                            | **13/13**, exit 0 — and its red demonstrated, then restored byte-exact         |
| Workspace `tsc` (`apps/api`)                | exit 0 (`tsc --noEmit` + `tsconfig.type-tests.json`)                           |
| Standalone script typecheck (SMELL-91)      | **exit 0**                                                                     |
| `eslint --max-warnings 0` (3 touched files) | exit 0 (needed `--max-old-space-size=6144`; the default heap OOMs in this LXC) |
| prettier                                    | clean — 3 source files `(unchanged)`, report reformatted then re-verified      |
| Generated-block integrity                   | all four blocks **byte-identical** after prettier, by per-block `sha256`       |
| fitness #3 / #5 / #8 / #9 / #10 / #23 / #32 | **0 / 0 / 0 / 0 / 0 / 0 / 0**                                                  |
| fitness #38                                 | swept tree **0**; db-prisma ratchet **11**, at baseline — did not rise         |
| Database                                    | corpus removed; namespace counts 0 across all five tables                      |
| `infra/prisma/**`, `.github/**`, `.env*`    | **not touched**                                                                |
| git                                         | **not run** — orchestrator-owned                                               |

## Deviations, stated

1. **5.4 applied before 5.3's `sourceSite` refresh, although numbered after it.** The
   docblocks shift the very line numbers 5.3 records; the file order would have committed
   refs that were stale on arrival. Same commit, so no ordering constraint in `tasks.md`
   §Ordering constraints is affected.
2. **Leg (b) run with `--out` at a scratch path.** A correctness check must not overwrite the
   committed `§policy-ab` capture that the trio's provenance rests on, and the authoritative
   `--phase after` re-capture belongs to the index-winner link, against the COMMITTED index.
   Running it into the report here would have destroyed one capture to prove something the
   scratch run proves identically.
3. **Two probes the tasks did not ask for.** The corpus-discrimination plant and the FK
   control/violation pair. Both exist because the evidence the task DID ask for turned out to
   be weaker than it reads — an equality over a corpus with no soft-deleted project, and a
   fidelity check that is blind to exactly this kind of edit.

## Residuals — named, not fixed

- **`sourceSite` line refs are unchecked by anything.** All 16 were re-verified by reading the
  target line, and 6 had to move because of two docblock edits in one file. No test, gate or
  fitness function reads them, so the next docblock edit retargets them silently. Same class
  as the stale mirror, one level weaker — the mirror at least has a check that fires on
  row-changing edits. An anchor on the enclosing method name would be resilient where a line
  number is not. Recorded in the report's own §Residual.
- **SMELL-91** — unchanged: `scripts/` is outside every tsconfig project and every collector,
  so the standalone invocation recorded in Batch 1 §Commands remains its only typecheck.
- **`eslint` OOMs at the default heap in this LXC** on any invocation that loads the boundaries
  plugin. Worked around per-invocation with `--max-old-space-size=6144`; not investigated,
  because it is an environment property rather than anything this change introduced.

## Review budget

Authored lines this batch (estimate — the exact count needs `git`, which writers do not run):
~23 in the repository, ~63 in the unit test, ~77 in the harness, ~150 of hand-written report
prose = **~310**. Added to c1's authored content, **PR-2 as a whole is likely to exceed the
400-line budget**, which is the condition `tasks.md` §Review Workload Forecast pre-authorised
a split for, at exactly the c1/c2 commit boundary. The orchestrator owns that call; this batch
is the natural PR-2b if it is taken.

## Not done in this batch (by instruction)

- Phase 6 in full — the index-winner migration, the `schema.prisma` edit, SQUAWK adjudication,
  the `audit.yml` ADJUDICATION 4 and stale-file loop repair, the authoritative `--phase after`
  capture, and the index `down.sql` scratch-database proof.
- Phase 7's PR-2 gate.
- Any git operation, any RDD lifecycle step.

## Next

Phase 6 (token-gated, orchestrator-scheduled). Its `--phase after` run is the authoritative
capture that supersedes the scratch fidelity run recorded here, and the report's new section
states plainly that it makes no timing claim, so nothing in it needs retracting when that
capture lands.

---

# Batch 6 — PR-2 commit c2, second half: the index winner (tasks 6.1–6.8)

**Split of duties, stated first because this batch had two hands on it.** Tasks 6.1–6.6 are
token-gated writes under `infra/prisma/**` and `.github/**` plus the database work that follows
them; the **orchestrator** executed those inside the `sensitive-edit` window and the post-window
sequence, from artifacts prepared the night before. This pass performed the CLOSING work the
runbook's steps 10–11 assign — the superseded-prose reconciliation in the report, the task
ledger, and this record — and **verified every claim it writes by reading the committed
artifact**, not by transcribing a summary: the migration's statement order, the recomputed
digest, the `audit.yml` wiring, the `schema.prisma` docblock, and the regenerated capture's own
plan trees. Runtime results (psql, squawk, `migrate deploy`, the harness) are recorded from that
run and attributed to it. Nothing under `infra/prisma/**`, `.github/**` or any `.env*` was
opened for writing in this pass.

## The window — 70 seconds of edits, and the budget it was measured against

The runbook's design goal was that the token window contain EDITS ONLY, with every database,
harness, test and gate step outside it. Measured from the file mtimes, the window's six writes
span **13:27:19 → 13:28:29 — 70 seconds** against a ~4 minute budget and a 15 minute TTL:

| Time     | Write                                                      | Runbook step |
| -------- | ---------------------------------------------------------- | ------------ |
| 13:27:19 | c1 `migration.sql` — header citation repoint, hunks A + B  | 0.1 / 0.2    |
| 13:27:22 | c1 `down.sql` — hunk C, the `2.26x` → `2.23-2.27x` restate | 0.3          |
| 13:27:44 | new `migration.sql` + `down.sql`                           | 1.1 / 1.2    |
| 13:28:03 | `schema.prisma` — `@@index` + the 31-line docblock         | 2.1          |
| 13:28:29 | `audit.yml` — ADJUDICATION 4, the two arms, the loop       | 4.1–4.4      |

Nothing was composed inside the window; every edit was copied from the prepared directory. The
ordering constraint that most easily rots is **visible in those timestamps rather than asserted**:
the digest pin was taken after the migration was final (`audit.yml` at 13:28:29, migration at
13:27:44) and the migration has not been touched since — its recomputed digest still equals the
pinned `e7789b99…c42`, so no edit slipped in behind the pin. That is the failure the pin exists
to catch, and it fails hours later in CI when it happens.

## What landed

The as-shipped account-led read index on `Post` is REPLACED, not supplemented:

```text
old  ("accountId", "projectId")                partial WHERE "deletedAt" IS NULL
new  ("accountId", "projectId", "createdAt")   partial WHERE "deletedAt" IS NULL
```

Migration `20260910000100_post_feed_index_winner`, its `down.sql`, the matching
`schema.prisma` `@@index` and its rewritten docblock, and the `audit.yml` ADJUDICATION 4 all
ride in ONE commit — the constraint `tasks.md` names twice, for two different reasons: schema
and migration apart drift `migrate diff --from-migrations`, and a migration committed without
its adjudication is a red required check whose only recovery is another commit.

The F4 citation repoint rode along in the same window, and the coupling is real rather than
convenience: `migrate deploy` verifies the checksum of every applied migration, so editing c1
without first deleting its ledger row makes the run fail on that checksum **before it ever
reaches the index migration**. A skipped precondition there does not just break F4, it blocks
task 6.6 outright. The edit itself is confined to comment lines by construction — hunks A and B
sit in the header block, hunk C in `down.sql`'s — and the proof that the policy bodies are
untouched is not the diff but the **catalog**: 6.6 read the trio 5-tuple back from
`pg_policies` and found the wrapped form on both clauses of all three tables. `down.sql` now
restates the ratio as `2.23-2.27x`, replacing the single `2.26x` figure hunk A removed;
Prisma never checksums `down.sql`, so that half costs nothing.

## Work Unit Evidence

| Evidence             | Value                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command | `INT tests/integration/rls-tenant-isolation.test.ts` → **25 pass / 0 fail / 0 cancelled / 0 skipped**, policy↔guard parity **61**                                                                                               |
| Runtime harness      | `--phase after --runs 3` → **13/13** row-equivalent, exit 0, block rewritten; plus the `pg_indexes` / `pg_policies` catalog read-backs and the Step 9 scratch-database rollback replay                                          |
| Rollback boundary    | the migration directory reverts as a unit with its `schema.prisma` hunk and its `audit.yml` adjudication; `down.sql` is proven to restore the as-shipped index (below); the report and `openspec/` edits lift out independently |

## The Squawk red, the green, and the control that stops it reading as a blanket

Task 6.3 predicted two rules and the repo canon requires a NEW gate entry to ship with its red
demonstrated. Both were done on the pinned artifact — v2.49.0 installed exactly as
`audit.yml` installs it, `sha256sum -c` verified against the workflow's own digest, so the local
run enforces what CI enforces rather than something adjacent:

| Run                                        | Command shape                           | Result                                                                                                                                       |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **7a — RED**, new migration, unadjudicated | `squawk --config .squawk.toml -- <new>` | **exit 1**, exactly two findings: `require-concurrent-index-deletion` ×1 (the `DROP`), `require-concurrent-index-creation` ×1 (the `CREATE`) |
| **7b — GREEN**, with the adjudication      | same + the workflow's `--exclude` list  | **exit 0**, `Found 0 issues in 1 file`                                                                                                       |
| **7c — CONTROL**, F4-edited c1, no waiver  | `squawk --config .squawk.toml -- <c1>`  | **exit 0**, `Found 0 issues in 1 file` — unchanged from task 4.3                                                                             |

7a proves the rules really fire. 7b proves the adjudication silences exactly those two. **7c is
the one that keeps the pair honest**: c1 carries no adjudication at all, so if the exclude list
were somehow global, or if the comment-only F4 edit had disturbed something, that run would say
so. A comment-only edit not moving a linter is the kind of thing that is assumed rather than
confirmed, and this batch confirmed it.

The abort path was pre-declared and did not have to be taken: had 7a reported a THIRD rule, it
would not have been added to the exclude list — silently widening it is precisely the defect
ADJUDICATION 2's digest pin exists to prevent.

## Step 9 — the index rollback, three readings on a scratch database

Run on `omnipost_index_downtest`, created and dropped by the run, with a full `migrate deploy`
replay so the rollback is proven against a real migration history rather than a hand-built
table — Batch 4.8's precedent, kept for the same reason. The three readings are recorded as
three SEPARATE claims because a single "it round-trips" would hide the one that carries the
proof:

| Claim                                                                                          | Reading                                                                                                                                                                                                            | Verdict |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1. AFTER DOWN restores the as-shipped definition, compared as an `(indexname, indexdef)` TUPLE | `Post_accountId_projectId_idx :: CREATE INDEX "Post_accountId_projectId_idx" ON public."Post" USING btree ("accountId", "projectId") WHERE ("deletedAt" IS NULL)` — byte-identical to the pre-migration definition | **YES** |
| 2. FORWARD and RE-APPLIED FORWARD are identical to each other and both differ from AFTER DOWN  | the 3-column partial in both forwards; the 2-column partial after down                                                                                                                                             | **YES** |
| 3. `Post_accountId_projectId_createdAt_idx` absent after down, present in both forwards        | absent / present / present                                                                                                                                                                                         | **YES** |

Claim 2 is what makes the rollback more than a name check: it says the down is not a no-op in
either direction. Claim 1's TUPLE comparison is the distinction task 3.5 red-proved — an index
re-created under the same name with a different key satisfies a name-only proof and fails this
one.

## The authoritative capture, judged against its own acceptance table

The runbook wrote task 6.7's acceptance criteria **so they could fail**, and stated in advance
that a capture disagreeing with the shortlist would be reported as the finding rather than
smoothed or re-run. It did not disagree. Recorded as the outcome of a test that had a real
negative branch:

| Claim to settle                                        | Pass condition                                                      | Read                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Q1`/`Q5` displacement repaired on the COMMITTED index | **no `Sort` node**, `Limit → Index Scan` on the new key             | **PASS** — `Limit → Result → Result → Index Scan` Backward, `Actual Rows: 20` at the scan; scan-node **0.021** / **0.017 ms** |
| `Q2` still `Index Scan`, **not** `Bitmap Heap Scan`    | the `IX2`/`IX3` failure mode must not arrive on the winner          | **PASS** — `Aggregate → Result → Result → Index Scan`, scan-node **0.035 ms**                                                 |
| every out-of-band case adjudicated                     | each named with its cause                                           | **PASS** — `Q1`, `Q5`, `Q4` moved; `Q3` deliberately did not; all four named in the report                                    |
| the single-corpus caveat travels with the decision     | present verbatim wherever the decision is recorded                  | **PASS** — in the new report section AND in the `schema.prisma` docblock                                                      |
| row-equivalence                                        | harness exit 0 IS the 13/13 claim (the digest gate is a hard throw) | **PASS** — exit 0, block rewritten, `--cleanup` left the control at 354                                                       |

**The predictive check that mattered most.** The shortlist arm put `Q1` and `Q5` at 0.019 /
0.019 ms on the scan node; the committed object reads **0.021 / 0.017** — ±2 µs, inside the ≤ 6
µs band that run declared before it ran. An in-transaction arm and a committed index agreeing
to within their own noise band is the strongest available statement that the shortlist filter
was predictive, and it is a bounded one: the structural claim (the absent `Sort`) is what is
proven outright, the magnitudes agree only to within the band.

**Three things the capture showed that nobody asked it for**, each recorded in the report:

1. **`Q4` changed shape.** It is now `Nested Loop → Seq Scan (Project) → Index Only Scan (Post)`
   on the new key, `Heap Fetches: 0`, `Rows Removed by Filter: 0` — the tenant restriction
   reaches the `Index Cond`, so the policy filter discards nothing where the superseded capture
   had it discarding 9 500 of 19 000 entries. Attribution stated rather than claimed: three
   changes separate the two readings, and the one thing provable is which made the plan
   POSSIBLE — under the pre-reshape mirror all four arms ran `Q4` as a hash join over two
   sequential scans, so no index shape could have produced this plan.
2. **The hoisted policy is visible in the planner on every case.** All 13 plans carry
   `InitPlan 1 (returns $0)` and `InitPlan 2 (returns $1)` — counted, 13 and 13 — and the trio's
   scan filters read `$0` / `$1` instead of calling `current_setting()`.
3. **So is the work still outstanding.** `Q3`'s and `Q4`'s `Project` scans still filter on the
   BARE body, `current_setting()` evaluated per row, discarding 417 rows to keep 100. `Project`
   is one of the 58 policies Phase 8 has yet to reach; this capture is a live citation for that
   work rather than an argument for it.

## The prose reconciliation, and why it is not optional

A regeneration rewrites the generated block and leaves every hand-written reading of it
standing. That is how the c1 report contradicted itself in Batch 4b, and Batch 6 inherited the
same trap at a larger scale: §"Reading the after capture" is ~280 lines of prose reading a
capture the block above no longer holds. Reconciled in this pass, all outside every generated
marker:

| Section                             | What it said                                                          | What it says now                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §"Reading the after capture", intro | "outside the generated block, so a re-run does not overwrite it"      | plus a dated scope note: surviving a regeneration is not the same as still describing one; the block was re-captured 2026-09-10T13:31:21Z and every median below is the superseded one    |
| Verdict (c)                         | a displacement table for `Post_accountId_projectId_idx`               | marked the **pre-repair reading**, kept as the evidence the shape decision was made on, with a new sub-table giving the four displaced cases against the COMMITTED index, both statistics |
| regressions row 2 (`listGlobal`)    | "Reshape the query … a follow-up"                                     | **SHIPPED, and it did NOT make `Q3` take an index** — the local predicate is in the plan's `Filter`; the binding constraint is the two-tenant corpus, not the query                       |
| regressions row 3 (index shape)     | "two candidates the evidence supports are extending … or dropping it" | **CLOSED by measurement: the extension was taken**, with the four arms, the decision rule, DROP losing on evidence, and the committed re-measurement — the shape row 1 uses for the trio  |
| regressions preamble                | "the first of the three has since landed"                             | all three have landed; each row closes in place, so the motivating and the settling measurement stay readable side by side                                                                |
| new §"The committed index"          | —                                                                     | the dated headline section, outside every block, carrying the acceptance table, the ±2 µs agreement, `Q3`'s bound, `Q4`'s shape change, and four things the capture does not settle       |

**One thing the reconciliation could not do, and it is a finding rather than an omission.** The
superseded capture's own `Captured <timestamp>` line lived INSIDE the generated block, so the
regeneration destroyed it. The report can no longer say when the reading in §"Reading the after
capture" was taken; only §Before's `2026-09-08T04:48:46.572Z` survives, because that block was
not regenerated. A hand-written reading that wants to stay datable has to copy the timestamp it
was written from into its own prose. This one did not, the omission was invisible until the
regeneration, and it is now stated in the report itself so the next reading does copy it.

## Files written

| File                                                        | Action   | What                                                                                                                             |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                 | Modified | scope note, Verdict (c) dated + repair sub-table, regressions rows 2/3 and preamble, the new hand-written §"The committed index" |
| `openspec/changes/tenant-rls-cost-repair/tasks.md`          | Modified | 6.1–6.8 marked `[x]` with evidence; 7.1 left `[ ]` with its discharged arms recorded                                             |
| `openspec/changes/tenant-rls-cost-repair/apply-progress.md` | Modified | this section                                                                                                                     |

Written in the token window by the orchestrator, verified read-only here:
`infra/prisma/migrations/20260910000100_post_feed_index_winner/{migration,down}.sql` (created),
`infra/prisma/schema.prisma`, `.github/workflows/audit.yml`, and the F4 comment-only edits to
`infra/prisma/migrations/20260910000000_rls_initplan_post_trio/{migration,down}.sql`.

Rollback boundary for this pass: all three files are `.md` and every edit is hand-written prose
outside every generated marker, so they lift out without touching a measurement.

## Gate results for this batch

| Check                                               | Result                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `prisma validate`                                   | valid                                                                                        |
| `prisma migrate status`                             | **up to date, 82 migrations**                                                                |
| `migrate diff --from-config-datasource --to-schema` | **exit 0** — and pre-verified as discriminating (exit 2 against a schema carrying the index) |
| `migrate diff --from-migrations` (shadow database)  | **exit 0**                                                                                   |
| `pg_indexes` on `Post`                              | **10 rows** — old index gone, new present with the expected `indexdef`, **nine untouched**   |
| `pg_policies` trio 5-tuple                          | **wrapped on BOTH clauses ×3**, `PERMISSIVE / ALL / {public}` — c1 survived the F4 re-apply  |
| SQUAWK                                              | **red exit 1 (2 rules) → green exit 0 with the adjudication → c1 control exit 0**            |
| Digest pin                                          | recomputed and re-verified: `digest pin OK`                                                  |
| INT suite file `rls-tenant-isolation.test.ts`       | **25 pass / 0 fail / 0 cancelled / 0 skipped**; parity **61**                                |
| Harness `--phase after --runs 3`                    | **13/13**, exit 0                                                                            |
| Index `down.sql` scratch replay                     | three readings, all three claims **YES**; scratch database dropped                           |
| prettier                                            | `--write` on the report and both `openspec/` artifacts; clean                                |
| Generated-block integrity                           | all **four** blocks byte-identical after prettier, by per-block `sha256`                     |
| Database left as found                              | `--cleanup` ran, control **354** `Account` rows; `omnipost_index_downtest` dropped           |
| git                                                 | **not run** — orchestrator-owned                                                             |

`tsc`, `eslint --max-warnings 0` and the twelve fitness counts are Phase 7's, deliberately not
run here; task 7.1 records which of its arms this batch already discharged.

## Deviations, stated

**None.** Checked rather than assumed, against the three ordering constraints `tasks.md` calls
non-negotiable and against the runbook's step sequence:

1. The c1 ledger row was deleted before any `db:migrate` that followed a c1 edit — confirmed by
   `migrate deploy` applying two migrations in one run rather than failing on a checksum.
2. Migration, `schema.prisma` and `audit.yml` are one commit — confirmed by both `migrate diff`
   invocations at exit 0 and by all three files being in the same window.
3. The digest was computed after the migration was final and before the pin — confirmed by
   mtime ordering and by the recomputed digest still matching.

The runbook's one optional step (Hunk C on c1's `down.sql`) was taken; it is comment-only and
`down.sql` is never checksummed by Prisma, so it costs nothing and removes a stale figure.

## Residuals — named, not fixed

- **The arm-built-index inference is now PARTLY converted, and the honest statement is the
  narrow one.** Batch 3 recorded that no plan took an index-only scan on an index an arm had
  BUILT — all 60 clean `Heap Fetches: 0` observations were on pre-existing indexes. `Q4` in this
  capture IS an `Index Only Scan` with `Heap Fetches: 0` on exactly the `IX1` SHAPE, so **the
  shape is settled as index-only-usable on this corpus**. What is still open is the narrower
  question the residual was about — whether an index built INSIDE an open transaction is
  index-only-usable within that transaction — and this capture cannot close it **by
  construction**, because it measures a committed index after a `VACUUM (ANALYZE)`. The residual
  narrows from "unconverted" to "converted for the shape, open for the arm mode", and it binds
  only a future `--index-ab` run.
- **The account-wide feed is still undecided in both directions** (Batch 3 Finding 1), and this
  phase makes it doubly relevant rather than closing it. The reshape moved `Q3`'s tenant
  predicate local, so the query is no longer the obstacle — and `Q3` still sequentially scans,
  because at **two tenants** `accountId` selects half the table. This corpus cannot tell you
  whether an index would serve that feed on a realistic tenant distribution, and no link may
  read `IX2`'s loss as a finding about `("accountId", "createdAt")`.
- **`sourceSite` line refs are unchecked by anything** (Batch 5), unchanged. No test, gate or
  fitness function reads them, so the next docblock edit retargets them silently. This phase
  edited no harness source, so none moved.
- **SMELL-91** — unchanged: `scripts/` is outside every tsconfig project and every collector,
  so the standalone invocation recorded in Batch 1 §Commands remains its only typecheck.
- **The 58 bare policies**, now with a live citation rather than an inventory count: `Project`'s
  per-row `current_setting()` filter is visible in `Q3`'s and `Q4`'s plans in the committed
  capture. Phase 8's subject, recorded here because the evidence arrived here.

## Review budget and the commit shape

Authored lines this pass are hand-written Markdown only (~230 in the report, ~90 across the two
`openspec/` artifacts); the window's own writes are the migration pair, one `schema.prisma`
hunk, four `audit.yml` hunks and the F4 comments. Exact counts need `git`, which writers do not
run.

**PR-2 commits as THREE commits — c1, c2a, c2b — and the reason is attributability, not size.**
`policy-ab` is the capture that justifies the trio rewrite, and it was taken against the
COMMITTED c1 body with the as-shipped index and the pre-reshape queries. Folding c1 into the
same commit as the reshape or the index would leave that capture describing a state the history
never held, and the migration header's citation would point at a measurement of something else.
c2a (the reshape and its mirrors) and c2b (the index, its schema hunk and its adjudication) are
separated for the constraint each carries internally: the mirrors must land with the query they
mirror, and the schema must land with the migration. Three commits, one PR, each with a capture
that names the state it measured.

## Not done in this batch (by instruction)

- Phase 7's gate in full — `tsc`, `eslint`, the twelve fitness counts, the BATCH invocation, and
  repo-wide `prettier -c .`.
- Any git operation: branch, commit, push, PR create or retarget.
- Any RDD review lifecycle step.
- Phase 8 (the 58-policy sweep) and Phase 9 (the form-uniformity gate). `20260910000200` is
  deliberately left free for the sweep.

## Next

Phase 7's 0-defect gate, then the PR-2 delivery decision. Nothing in Phase 6 is waiting on
anything: the migration is applied, the catalog is read back, the capture is authoritative and
its superseded prose is reconciled in the same commit that superseded it.
