# Tasks: Tenant RLS Cost Repair (SMELL-93 — InitPlan form, feed reshape, measured index)

> Dependency-ordered. Derived from the **two delta specs** (the requirement source —
> `specs/rls-policy-form/spec.md` 9 requirements, `specs/post-tenant-isolation/spec.md` 1
> requirement) and **`design.md`** (the mechanism source). `proposal.md`, `explore.md` and
> `research.md` are context, not sources.
>
> Branch `workstream/tenant-isolation` (continues the A′ cluster). Delivery: **auto-chain**,
> **stacked-to-main** — every link below merges green to main in order. Every new gate ships
> with its RED demonstrated (repo canon, CLAUDE.md §Automated Compliance Checks step 3).
>
> **Declared deviation from `design.md` §Work Units.** The design puts U1+U2+U3 in one PR-1
> and U6+U7 in one PR-3. Both are split here, because both exceed the 400-line review budget
> as single links and both split at a real seam: the three harness units have independent
> rollback boundaries (each reverts its own script hunks, none touches schema), and the sweep
> is provable green before the gate that reads its result exists. Splitting is cheaper than
> the two `size:exception`s the design's slicing would have cost. Nothing else in the design's
> sequencing moves: harness → trio → reshape+index → 58 → gate is preserved.
>
> **Declared deviation from the `sdd-tasks` 530-word budget.** This file follows the house
> format of `openspec/changes/tenant-isolation-composite-fk/tasks.md` (evidence expectation
> per task, deviations inline), which the orchestrator named as binding. The budget rule is
> named rather than silently ignored.
>
> **Chained-PR skill**: `chained-pr` resolved from `.atl/skill-registry.md` →
> `.claude/skills/chained-pr/SKILL.md` and followed — one deliverable work unit per PR, each
> naming start, finish, dependency, verification, rollback boundary, and out-of-scope items;
> `size:exception` only with maintainer acceptance.

## Ordering constraints — provenance is destroyed if taken out of order

These are not "unrepeatable captures" (the harness runs against a scratch corpus and is
re-runnable by construction). What is unrepeatable is the **provenance claim**: once a
migration or a gate pattern exists, no later run can prove it was chosen FROM measurement.

| Constraint                                                     | Task          | Must precede          | Why the order is the evidence                                                                                               |
| -------------------------------------------------------------- | ------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--policy-ab` decision run → form verdict (`W` vs `S`)         | **2.6 → 2.7** | trio migration (4.2)  | `rls-policy-form` "the measurement precedes the migration": a form authored first and measured after is the D-S1-1 defect   |
| `--index-ab` 4-arm run → index shortlist verdict               | **3.5 → 3.6** | index migration (6.1) | same requirement for the index shape; DROP is an admissible verdict only if it was a measured arm                           |
| If `S` wins: author the 3-arm variant text in **S-rendering**  | **2.8**       | sweep migration (7.2) | `design.md` gives the variant only in `W`-rendering — a sweep that renders it by analogy is how the third disjunct dies     |
| Catalog read-back of the winner's rendered `qual`/`with_check` | **8.1**       | gate matcher (8.2)    | `pg_get_expr` normalizes casts/spacing/aliases; a pattern written from migration bytes gates intent, not the deployed truth |

## Sensitive-edit gate

**Token REQUIRED: YES — `omnipost-allow sensitive-edit`, per invocation.** Sensitive trees in
this change: `infra/prisma/**` (`schema.prisma`, all 3 new migrations + their `down.sql`) and
`.github/workflows/**` (`audit.yml`). Author each under an active token; the token gates both
direct sensitive-path edits and tripwire bypass, and every use is audited in
`.claude/heuristic-overrides.log`.

`scripts/`, `apps/api/src/**` and `apps/api/tests/**` are NOT token-gated — but note
**SMELL-91**: `scripts/` sits outside every tsconfig project and outside every fitness scope,
so `scripts/rls-ab-measurement.ts` must be typechecked STANDALONE at each gate (see legend).

## Orchestrator-owned work units (writers never touch these)

| Unit                                                                    | Task(s)     | Why                                                     |
| ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| `.github/workflows/audit.yml` — ADJUDICATION 4 + stale-file loop repair | **6.4–6.5** | Gated workflow — applied under a `sensitive-edit` token |
| All git: branch, commit, push, PR creation/retarget                     | every link  | Writers never run git                                   |
| RDD lifecycle (review START → capture → acknowledge) per link           | every link  | Orchestrator owns the transaction                       |

## Command legend (LXC-safe, single-file — heap 3072, never the full local suite)

- **DBUP**: `pnpm db:up` (mandatory before every harness run, migration, and integration test)
- **AB**: `pnpm exec tsx scripts/rls-ab-measurement.ts <mode>` — modes `--policy-ab`,
  `--index-ab`, `--phase after`; `--runs` kept **odd** (the median helper's upper-middle
  choice is biased at even run counts)
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **BATCH**: `apps/api/scripts/run-tests.sh` batch `integration:tenant-isolation`
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/api exec vitest run <file>`
- **MIGRATE**: author `prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply `pnpm db:up && pnpm db:migrate`
- **TSC**: `pnpm typecheck` **plus** a standalone `tsc --noEmit` over `scripts/rls-ab-measurement.ts` with `tsconfig.base.json` flags (SMELL-91 — nothing in CI opens that file)
- **SQUAWK**: the `audit.yml` migration-lint step, run locally over each new migration file

## Review Workload Forecast

| Field                   | Value                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | PR-1a ~180–240 · PR-1b ~220–300 · PR-1c ~250–330 · PR-2 ~340–400 · PR-3 ~220–280 · PR-4 ~180–240 · **total ~1390–1790** (authored only) |
| 400-line budget risk    | High                                                                                                                                    |
| Chained PRs recommended | Yes                                                                                                                                     |
| Suggested split         | PR-1a → PR-1b → PR-1c → PR-2 → PR-3 → PR-4 (stacked to main, in order)                                                                  |
| Delivery strategy       | auto-chain                                                                                                                              |
| Chain strategy          | stacked-to-main                                                                                                                         |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**`Decision needed before apply: No`** because auto-chain starts at PR-1a, which is comfortably
inside budget, and **no link is currently forecast to need `size:exception`** — the split above
is what buys that. The spec phase flagged the 58-sweep link as the likely exception candidate;
splitting the sweep from the gate that reads its result removes the need, and both halves land
inside budget.

**PR-2 is the one link at risk (~340–400) and its split point is pre-authorized here rather
than improvised at apply**: it ships as two commits (c1 trio policy migration, c2
reshape+index+audit.yml), so if c2's mirror and `sourceSite` refresh push the total past 400,
split at that commit boundary into PR-2a / PR-2b. The two commits are already separately
verifiable and separately revertible; the only cost is one more link. They are kept together by
default because `design.md` sequences them as one PR and c2's index migration is only meaningful
once the trio's policy form is committed.

**Generated evidence is excluded from the authored count.** `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`
is regenerated by the harness on every capture and can move hundreds of lines per link; per the
review-budget rule (authored additions + deletions only), it does not consume budget — but it IS
part of the candidate manifest and must be prettier-clean.

### Suggested Work Units

| Unit | Goal                                                                                                           | Likely PR | Focused test command                                                          | Runtime harness                                                                                                 | Rollback boundary                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | Harness fidelity: six advisories, each with a planted-violation red                                            | PR-1a     | `AB --policy-ab --runs 3` (existing 3 shapes)                                 | DBUP + scratch corpus reseeded by the harness; planted empty-median / mutated-restore / bare-message violations | revert script hunks; no schema, no test, no docs beyond the regenerated report      |
| 2    | Three-arm `{A′, W, S}` × 13-case `--policy-ab` → **form verdict recorded**                                     | PR-1b     | `AB --policy-ab --runs 3`                                                     | DBUP + digest equality across arms for all 13 cases; InitPlan count read from the plan                          | revert script hunks; no schema touched — the verdict is a report section            |
| 3    | New `--index-ab` 4-arm mode → **index shortlist verdict** (DROP admissible)                                    | PR-1c     | `AB --index-ab --runs 3`                                                      | DBUP + `VACUUM` before the arm tx, `Heap Fetches: 0` asserted, `pg_indexes` 2-tuple restore proof               | revert script hunks; arms roll back by construction                                 |
| 4    | Trio policy migration (winner form) + `down.sql` + committed authoritative re-run                              | PR-2 c1   | INT `apps/api/tests/integration/rls-tenant-isolation.test.ts`                 | DBUP + MIGRATE apply + `AB --policy-ab` re-run against the committed form                                       | `down.sql` restores the bare trio form verbatim                                     |
| 5    | `listGlobal` reshape + mirrors + `sourceSite` refresh + index-winner migration + schema + ADJUDICATION 4       | PR-2 c2   | VITEST `apps/api/tests/unit/infrastructure/PrismaPostQueryRepository.test.ts` | DBUP + mirror-fidelity 13/13 + cross-shape old-vs-new digest probe in one bound tx                              | `down.sql` restores the as-shipped index; reshape is a single-file revert           |
| 6    | 58-policy sweep migration (`pg_policy`-enumerated, explicit variant branch) + `down.sql` + per-policy evidence | PR-3      | INT `apps/api/tests/integration/rls-tenant-isolation.test.ts`                 | DBUP + MIGRATE apply; count assertions hit; variant `IS NULL` postcondition; per-table before/after EXPLAIN     | sweep `down.sql` (mirror `DO $$` re-creating the bare form + explicit bare variant) |
| 7    | Form-uniformity gate, read-back-derived, red demonstrated; change-close backlog rows                           | PR-4      | INT `apps/api/tests/integration/rls-tenant-isolation.test.ts` via BATCH       | DBUP + planted bare policy on `WebhookEvent` → real non-zero exit → restore → re-green                          | revert the test extension; the existing pg_catalog coverage gate is untouched       |

---

# PR-1a — Harness fidelity advisories (dep: none; branch tip)

> Nothing measured downstream is believable until these land. Each advisory repairs a way the
> harness could report a number it did not measure. Out of scope: any arm change, any new mode,
> anything under `infra/`.

## Phase 1: The six advisories, each red-proven

- [x] 1.1 [GREEN] `scripts/rls-ab-measurement.ts`: extend `walkPlan` (`:891`) to collect `Relation Name`, `Actual Total Time`, `Actual Loops`, `Heap Fetches` and `Subplan Name` alongside the existing node types and index names. Pure collection — no consumer yet, so this task changes no reported number. **[DONE — `walkPlan` now collects `Relation Name` / `Actual Total Time` / `Actual Loops` / `Heap Fetches` / `Subplan Name` into a typed `WalkedPlan`; `Heap Fetches` has no consumer until 3.4, as scoped.]**
- [x] 1.2 [RED → GREEN] Same file: add the **scan-node median**. Per run, scan-time = Σ(`Actual Total Time` × `Actual Loops`) over nodes whose `Relation Name` is the measured table; the quoted statistic is the median of THAT series, rendered **beside** the statement-time median, with the run count recorded. RED first: assert in a scratch probe that the two medians differ on a case with a SubPlan, since a harness reporting them as equal is the retracted-4.198 defect reproduced. **[DONE — scan-node median live beside the statement median in BOTH renderers. RED is the gap itself, present on 13/13 cases: `Q3` 4.236 vs 6.686 ms (1.58×), `Q7` 0.007 vs 0.021 ms (3.00×). On arm `S3` the `A′→A′+init` ratio is 2.26× on scan-node vs 1.81× on statement — only the former is inside task 4.6's expected band.]**
- [x] 1.3 [RED → GREEN] `median()`: **throw** on empty input. RED = call it with `[]` and observe the current `-1` render as `-1.000 ms`. JSDoc the even-length upper-middle choice and state that `--runs` must stay odd. **[DONE — RED verbatim `median([]) = -1.000 ms`; GREEN verbatim `median([]) THREW — median() received an empty series…`. JSDoc states the even-length upper-middle bias and the odd-`--runs` requirement.]**
- [x] 1.4 [RED → GREEN] Restore proof: read the 5-tuple `(qual, with_check, permissive, cmd, roles)` from `pg_policies` (today `qual` only) and fail on any divergence. RED = have an arm restore a policy with a NULL `with_check` and observe today's proof pass; after the change it fails. **[DONE — RED: an arm-shaped re-create (`USING` only) drove `with_check` to `null` and the shipped qual-only proof said `IDENTICAL (passes)`. GREEN: same mutation, 5-tuple proof says `DIVERGED (fails)`.]**
- [x] 1.5 [GREEN] Replace the forced-rollback string compare with `class DeliberateRollback extends Error`; every arm throws and catches the class, never a message. **[DONE — `class DeliberateRollback extends Error`; the `ABORT` string constant and its `error.message ===` compare are both gone.]**
- [x] 1.6 [GREEN] Narrow the generated preamble to what `VACUUM` actually buys — "the visibility map is set, so index-only-scan costing reflects a settled heap" — and DELETE the reproducibility claim the artifact's own `Q4` data disproves. **[DONE — the "reproducible across reseeds" claim is deleted and replaced by what `VACUUM` buys, naming `Q4`'s own 0.11 % tie as the disproof. Gate addendum: the fix landed in the GENERATOR, but `--policy-ab` never renders §Data shape, so the ARTIFACT retained the claim at `:69` (§Before, unregenerable) and `:1987` (§After) until the fresh gate caught it; both hand-edited to the generator's exact wording by the orchestrator — no divergence, it is what any regeneration now emits, and `:1987` self-heals at 6.7.]**
- [x] 1.7 [RED → GREEN] **Per-run index-set annotation, in BOTH places.** `CaptureResult` keeps `indexNames` per run (`capture()` at `:934`/`:970` keeps only the last run's set) **and so does `runPolicyArm`** (`:1175`/`:1189`/`:1203` — the same last-run-only defect, found at the design gate and fixed by the same per-run shape; fixing only `capture()` leaves the policy arms silently reporting one run's plan as the arm's). Intra-capture divergence renders as an ANNOTATION line with the per-run sets. **No failing `Q4` stability guard** — the 0.11 % tie is repaired by nothing in this change and `Q4` is read for its Δ, never for its plan. RED = force two runs onto different indexes and observe today's single-set output. **[DONE — RED in BOTH sites (`capture()` Q3 and `runPolicyArm` A′ S1: run 2 on no index, reported as one set). GREEN: 11 capture-side + 8 arm-side annotations, run still exits zero and still writes. No failing guard added.]**
- [x] 1.8 [evidence] Re-verify all seven `sourceSite` references (`:570`, `:603`, `:628`, `:655`, `:675`, `:700`, `:724`, `:754`, `:788`, `:807`, `:820`, `:832`, `:866` — enumerate from the file, the list here is a snapshot) against the live line numbers. This link changes no production code, so any drift found is pre-existing and is repaired here rather than carried into PR-2, where a stale ref becomes indistinguishable from the reshape's own. **[DONE — 13 `sourceSite` entries / 17 line refs enumerated from the file and checked against the live sources: `PrismaPostQueryRepository.ts` :152 :155 :156 :162 :186 :444 :454 and `PrismaPostRepository.ts` :66 :67 :226 :229 :230 :386 :389 :492 :527. **Zero drift** — nothing to repair, which is itself the recorded result.]**
- [x] 1.9 [evidence] DBUP + `AB --policy-ab --runs 3` on the existing 3 shapes → green, restore proof passes on the 5-tuple, report regenerates. Record in the PR body: the scan-node vs statement-time medians side by side, and the run count each was taken over. **[DONE — 100×10 000 corpus, `--policy-ab --runs 3` green, 12 arm measurements, 5-tuple restore proof passed, report regenerated + prettier-clean. Medians side by side and the InitPlan/SubPlan column are in the report and in apply-progress §Findings.]**
- [x] 1.10 **0-defect gate (PR-1a)**: TSC = 0 (workspace **plus** the standalone `scripts/rls-ab-measurement.ts` typecheck — SMELL-91); `eslint --max-warnings 0` = 0 on touched files; fitness #8/#9/#10/#16/#23 = 0; prettier clean including the regenerated report; every planted red above restored byte-exact (verify with `cmp`). **[DONE — workspace typecheck 169/169 exit 0 (one task needed a raised heap: LXC cap, not a type error); standalone script typecheck exit 0 with its red proven; eslint 0; fitness #8/#9/#10/#16/#23 all 0; prettier clean; every plant restored byte-exact via `cmp` + `sha256sum -c`; DB left as found, verified out of band.]**

---

# PR-1b — Three-arm × 13-case policy A/B and the form verdict (dep: PR-1a)

> The verdict this link produces is what PR-2's migration is authored FROM. Out of scope: any
> migration, any production query, the index question.

## Phase 2: Arms, cases, and the decision run

- [x] 2.1 [GREEN] `scripts/rls-ab-measurement.ts` `POLICY_ARMS` (`:995`): retire `B′` and `B′+sys` (the decorrelated-set direction was rejected by the prior A/B and neither can ship — `B′` carries no `__system__` escape at all) and land three arms: **`A′`** shipped bare form (`using: null`, live control), **`W`** `(SELECT current_setting('app.account_id', true)) = '__system__' OR "accountId" = (SELECT current_setting('app.account_id', true))`, **`S`** `(SELECT current_setting('app.account_id', true)) IN ('__system__', "accountId")`. **[DONE — three arms live; `B′`/`B′+sys` retired with the reason recorded in the arm docblock and their measurements KEPT in the report under §The retired four-arm results, not deleted. `A′+init` is renamed `W` (same form) and the rename is stated where the old numbers live.]**
- [x] 2.2 [GREEN] Extend `runPolicyArm` to run the 13 `CASES` SQL mirrors per arm (raw SQL — the Prisma half cannot run inside the owner transaction; mirror fidelity is the standing proof via `capture()`), with per-case digest + EXPLAIN × runs. **[DONE — `AB_PROBES` = 3 shapes + 13 cases, built FROM the two existing lists so a new case is measured without a second edit. 48 measurements per sweep (3 arms × 16 probes). **Deviation, declared**: the arm now swaps all three TRIO_TABLES, not `Post` alone — five cases read `PostContent`/`PostMedia` and against a bare child policy their numbers could not respond to the arm at all.]**
- [x] 2.3 [GREEN] Extend `runPolicyAb`'s refusal logic over the cases: empty → throw; **digest divergence between any two arms for the same case → throw and write nothing** (an arm returning different rows answers a different question; one returning nothing is trivially fastest). **[DONE — whole-row digests (`rawDigest`), compared across every arm AND every sweep, not just the pooled result. The gate caught a real modelling error of mine on first run: a scalar `count(*)` returns one row while matching nothing, so `rows.length` reported the declared miss probe `Q8` as live. Emptiness is now the probe's own `matched()`.]**
- [x] 2.4 [GREEN] Record the **InitPlan count per arm** from `Subplan Name` (1.1's collection). Neither sharing nor non-sharing is assumed: `W` may show `InitPlan 1` + `InitPlan 2`, each once per execution. The plan says which, not the design. **[DONE — measured `InitPlan 1 (returns $0)` + `InitPlan 2 (returns $1)`, count **2**, for BOTH `W` and `S`; `A′` carries none. Batch 1's finding 2 is confirmed on this run: the two wrapped reads do NOT share one InitPlan — and `S`, despite reading the GUC once syntactically, plans to two InitPlans as well, which is the measured answer to why the forms are indistinguishable. Labels kept PER RUN with a divergence annotation; the last-run-only defect at `:1400` was the field 2.4 depends on, so it was repaired here (RED/GREEN below).]**
- [x] 2.5 [RED → GREEN] Semantic-equivalence obligation for `S`, pinned rather than argued: assert `x IN ('__system__', "accountId")` returns the same rows as `x = '__system__' OR "accountId" = x` for a bound tenant, for `__system__`, **and for an UNSET GUC** (NULL propagates through `=` and `IN` identically → row suppressed). RED = plant an arm body that drops the `__system__` member and observe a digest divergence throw. **[DONE — `proveFormEquivalence` over 3 GUC states × a 3-row sample (local tenant, foreign tenant, NULL account). RED: the mutated body passed all 48 digests and WROTE a report at exit 0; GREEN: exit 1, nothing written. Verbatim below.]**
- [x] 2.6 [evidence · ORDERING — blocks 2.7 and 4.2] DBUP + `AB --policy-ab --runs 3` over `{A′, W, S}` × 13 cases. Row-equivalence is the **hard gate**; timing is evidence. Every case moving outside the **≤6 µs / <1 %** band gets a **recorded adjudication** naming what moved and why it is accepted, repaired, or deferred — an artifact reporting only the favourable cases does not satisfy the requirement. **[DONE — row-equivalence 16/16 across all three arms and all five sweeps. **The run had to become five sweeps**: at `--runs 3` alone, six consecutive sweeps of the SAME comparison returned `S` wins / `W` wins / UNDECIDED / UNDECIDED / `S` wins / UNDECIDED. Adjudications for the `A′`→`W` comparison are a named table in the report, including the ONE regression (`S2`, a moved plan; 3.67× slower on run 1, 3.50× on the F1 corrective's regeneration — the figures IN the report are the regeneration's) and both moved plans.]**
- [x] 2.7 [evidence] Record the **form verdict** in `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`. **Pre-declared tiebreak**: if `W` and `S` land inside the band on every case, **`W` wins** — it is the textually minimal delta, keeps the sweep rewriter a pure "wrap each `current_setting` call" transform identical for standard and variant policies, and keeps the gate matcher one adjacency rule. **[DONE — **`W` WINS by the pre-declared tiebreak**, on two independent runs of the full comparison. The verdict is COMPUTED (`decideForm`) and rendered into the generated block, so the section cannot disagree with its own table; the F1 corrective additionally renders the TIEBREAK ITSELF as a fifth rule bullet and names the winning body inline in the verdict line. Run 1: all 16 probes inside the band on the pooled 15-sample medians, no probe's `S − W` sign stable. Run 2 (the regeneration, the figures now IN the report): 15/16 inside the band — `S3` out at 20 µs / 1.11 % with a sign that FLIPPED across sweeps — and 1/16 sign-stable — `S2`, but 4 µs, inside the band. Neither probe clears BOTH conditions, so neither is attributable and the tiebreak governs on both runs.]**
- [x] 2.8 [CONDITIONAL · ORDERING — blocks 7.2] **If `S` wins**: write the `AIPromptTemplate` 3-arm variant text in **S-rendering** explicitly into the report and into this file, before any sweep migration is authored. `design.md` gives the variant only in `W`-rendering; a sweep that renders the third disjunct by analogy from a `W` example is exactly the mechanism that drops it. If `W` wins, record "not applicable — `W` rendering stands" rather than leaving the task unchecked. **[NOT APPLICABLE — `W` won, so `design.md`'s `W` rendering of the 3-arm variant stands unchanged and no S-rendering is authored. Task 8.2's "use the 2.8 S-rendering if `S` won" is therefore inert; the sweep uses the design's variant text as written.]**
- [x] 2.9 **0-defect gate (PR-1b)**: TSC = 0 (workspace + standalone script); eslint 0; fitness #8/#9/#10/#16/#23 = 0; the existing `rls-tenant-isolation.test.ts` behavioural suites green over the winner arm (NULL-GUC fail-closed + `__system__` bypass); prettier clean; database left as found, proven by the harness's own cleanup count plus one out-of-band read. **[DONE — gate table in apply-progress. 169/169 typecheck (one task needs the raised heap, same LXC cap as PR-1a), standalone script typecheck 0, eslint 0, fitness 0/0/0/0/0, integration suite 21/21 with 0 cancelled / 0 skipped, prettier clean, DB read out of band: 61 policies, trio qual still the BARE form, `Account` 354, 0 leftovers.]**

---

# PR-1c — `--index-ab` and the index shortlist verdict (dep: PR-1b)

> A shortlist filter, not the authoritative capture. Out of scope: committing any index — the
> winner is committed in PR-2 and re-measured there.

## Phase 3: The four arms and their preconditions

- [ ] 3.1 [GREEN] `scripts/rls-ab-measurement.ts`: new `--index-ab` mode. Arm transaction shape on the owner client: `SET LOCAL lock_timeout` → arm DDL (`DROP INDEX` / `CREATE INDEX`, **plain, never `CONCURRENTLY`**) → `ANALYZE "Post"` in-tx → `SET LOCAL ROLE omnipost_app` → `set_config('app.account_id', …, true)` → posture assert → 13 CASES (rows + digest + EXPLAIN × runs) → `throw DeliberateRollback`.
- [ ] 3.2 [GREEN] Arms, all partial `WHERE "deletedAt" IS NULL`: **as-shipped `(accountId, projectId)` (control)**, **`+createdAt` → `(accountId, projectId, createdAt)`**, **`(accountId, createdAt)`**, **DROP**. DROP is a first-class arm: if every candidate measures net-negative against the control, dropping is the measured answer, not a failure of the exercise.
- [ ] 3.3 [RED → GREEN] **No DML on the measured table inside the arm transaction** — any write clears visibility-map bits and silently destroys index-only-scan eligibility. `vacuumAnalyze()` runs BEFORE the transaction and is part of the recorded setup. RED = plant one `INSERT` inside an arm and observe `Heap Fetches` go non-zero.
- [ ] 3.4 [RED → GREEN] **Assert `Heap Fetches: 0`** on every `Index Only Scan` node; a non-zero value ABORTS the arm as unrepresentative rather than being reported as an index-only result. This converts "an index built inside an open transaction still yields index-only scans within it" from an uncited inference into evidence. RED = 3.3's planted write.
- [ ] 3.5 [GREEN] Restore proof: `(indexname, indexdef)` tuples from `pg_indexes` for `Post`, before == after, compared as tuples.
- [ ] 3.6 [evidence · ORDERING — blocks 6.1] DBUP + `AB --index-ab --runs 3`. Record the **shortlist verdict** in `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` with: the winner (or DROP), the per-case Δ against the control, and the **single-corpus caveat** verbatim — the measurement rests on one shape (100 projects × 10 000 posts, exactly 100 per project), which is the condition under which the displaced index wins.
- [ ] 3.7 [evidence] Record the index mechanics honestly in the same section: with only `accountId` equality-bound, the scanned range of `(accountId, projectId, createdAt)` is ordered by `(projectId, createdAt)`, so the extension **does not by itself** give ordered output for the account-wide feed — Incremental Sort needs a leading key, and B-tree skip scan is PostgreSQL 18 while this server is **16.14**.
- [ ] 3.8 **0-defect gate (PR-1c)**: TSC = 0 (workspace + standalone script); eslint 0; fitness #8/#9/#10/#16/#23 = 0; `pg_indexes` restore proof green; prettier clean; database left as found.

---

# PR-2 — Trio policy migration, `listGlobal` reshape, index winner (dep: PR-1c)

> Two commits. **c1** = the trio's form; **c2** = the query reshape and the index. Kept as
> separate migrations so a red is attributable to one of them. Pre-authorized split point:
> if the link exceeds 400 authored lines, split at the c1/c2 boundary.
> Out of scope: `filterIdsByAccount` and `findOwnerAccountId` (the join IS the semantics), the
> point reads, and the three unmeasured feed-shaped siblings.

## Phase 4: c1 — the trio policy rewrite [SENSITIVE — token] (dep: 2.7)

- [ ] 4.1 [SENSITIVE] MIGRATE `<ts>_rls_initplan_post_trio`: open with `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '30s'` (Squawk `require-timeout-settings`) BEFORE any DDL; then plain `DROP POLICY` (**not `IF EXISTS`** — a missing policy is state drift and must fail) + `CREATE POLICY` in the winner form for `Post`, `PostContent`, `PostMedia`, explicit tables, no loop.
- [ ] 4.2 [SENSITIVE] Same migration folder: `down.sql` re-creating the bare form **verbatim** — the bytes of `infra/prisma/migrations/20260909000500_add_rls_post_trio/migration.sql` (read-only), following that folder's `down.sql` pattern (session-level `SET`, scope header).
- [ ] 4.3 [evidence] SQUAWK over the new migration → lints clean. A firing rule is INVESTIGATED, never waived; if one fires, it gets an adjudication entry, not a suppression.
- [ ] 4.4 [GREEN] DBUP + MIGRATE apply; `prisma validate` + `prisma migrate status` report no drift.
- [ ] 4.5 [integration] Read `qual` back from `pg_policies` for all three trio policies and assert the SUBSELECT rendering is what the CATALOG holds — the proof is the deployed catalog, never the migration source bytes. Assert both clauses of a two-arm policy use one form, and that a policy that declared no `WITH CHECK` still declares none.
- [ ] 4.6 [evidence] DBUP + `AB --policy-ab --runs 3` re-run against the **committed** form (the authoritative capture — not inherited from the rollback arm). Expect the ~2.1–2.4× scan-node band; row-equivalence 13/13; every out-of-band case adjudicated.
- [ ] 4.7 [integration] INT `apps/api/tests/integration/rls-tenant-isolation.test.ts` → green, 0 cancelled, 0 skipped: NULL-GUC fail-closed and `__system__` bypass hold over the committed winner form, and the policy↔guard 1:1 parity still reports 61.
- [ ] 4.8 [integration] Apply the `down.sql` on a scratch database and prove the restore by comparing the **policy 5-tuple**, not `qual` alone; then re-apply forward. Record both directions.

## Phase 5: c2 — the `listGlobal` reshape and its mirrors (dep: 4.4)

> **The highest mechanical risk in this change**: mirror fidelity validates the QUERY, not the
> REFERENCE, so a stale mirror returns the same rows and passes the identity check while
> measuring code that no longer exists. Everything in this phase lands in ONE commit.

- [ ] 5.1 [RED] `apps/api/tests/unit/infrastructure/PrismaPostQueryRepository.test.ts` §"listGlobal — project liveness (feed gate)" (`:522`): **`baseRow()` (`:27`) must carry a local `accountId`, and the a3 fixture's must be a FOREIGN one**, and `applyWhere` (`:561`) needs an explicit `accountId` branch — it THROWS on unmodelled keys (`:582`), so without the branch the suite ERRORS instead of failing, which is not a red. Write the failing shape first: assert the emitted `where` filters `accountId` locally and no longer carries `project.accountId`.
- [ ] 5.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts` `:432-438`: `where` becomes `{ accountId: accountId.value, deletedAt: null, project: { deletedAt: null } }`. **The project-liveness predicate is RETAINED** — soft deletion does not cascade, so `project.deletedAt IS NULL` is what excludes a soft-deleted project's posts and is NOT part of what moves local. The account value stays server-derived; no call signature changes and no client-supplied scope selector is introduced.
- [ ] 5.3 [GREEN] Same commit: update the `Q3`/`Q4` mirror SQL to `WHERE p."accountId" = … AND p."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "Project" pr WHERE pr.id = p."projectId" AND pr."deletedAt" IS NULL)`, update their Prisma mirrors to the new `where`, add "EMISSION CHANGED with the reshape" to their `why` lines, and refresh **every** `sourceSite` line reference in `scripts/rls-ab-measurement.ts`.
- [ ] 5.4 [GREEN] Docblock tidies ride along in the same commit: `PrismaPostQueryRepository.ts` `:99-101` (`getById` — "Post has no direct accountId" has been false since `20260909000000`) and `:417-421` (`listGlobal`). Tidies, not scoping changes — the point reads do not move.
- [ ] 5.5 [GREEN] VITEST `apps/api/tests/unit/infrastructure/PrismaPostQueryRepository.test.ts` → green: the foreign-account project and the soft-deleted project are BOTH still excluded, which is the reshape's whole obligation.
- [ ] 5.6 [evidence] Row-equivalence proof, three independent legs recorded in the report: (a) the where-shape evaluator suite above; (b) harness mirror fidelity — new mirrors vs live emission, digest-equal on 13/13; (c) a **one-off cross-shape probe**: old-shape and new-shape SQL executed in ONE bound transaction, digests compared. A faster shape returning different rows FAILS the reshape regardless of timing.

## Phase 6: c2 — the index winner [SENSITIVE — token] (dep: 3.6, 5.6)

- [ ] 6.1 [SENSITIVE] MIGRATE `<ts>_post_feed_index_winner` with `SET LOCAL lock_timeout` + `statement_timeout` first: `DROP INDEX "Post_accountId_projectId_idx"` + `CREATE INDEX` for the 3.6 winner (partial `WHERE "deletedAt" IS NULL`), **or DROP-only if the DROP arm won**. `down.sql` restores the as-shipped `(accountId, projectId)` partial — the DROP arm reverses the same way.
- [ ] 6.2 [SENSITIVE · SAME COMMIT] `infra/prisma/schema.prisma` `:750`: the index shape, and `:744-749`: the docblock **rewritten from the measurement**. It states the measured outcome, the index mechanics of 3.7, and the single-corpus caveat; **no superseded reasoning-based justification survives in it**. Schema edit and migration land together or `migrate status` drifts.
- [ ] 6.3 [evidence] SQUAWK: `require-concurrent-index-creation` + `require-concurrent-index-deletion` will fire. Expected, adjudicated — not waived silently.
- [ ] 6.4 [ORCHESTRATOR · SENSITIVE token] `.github/workflows/audit.yml`: add **ADJUDICATION 4** for this migration — digest-pinned, carrying ADJUDICATION 2/3's rationale (`CONCURRENTLY` cannot run inside Prisma's migration transaction; single deployable; the live-path runbook named as the remove-when).
- [ ] 6.5 [ORCHESTRATOR · SENSITIVE token · drive-by, owned by this work unit] Same file, the stale-file existence loop at `:473`: it iterates only `"$ALIGNMENT_MIGRATION" "$RETENTION_MIGRATION"` while `exception_rules_for` and `exception_digest_for` (`:456`, `:464`) already carry `$POST_TRIO_MIGRATION`. Add **`$POST_TRIO_MIGRATION`** and the new index-migration variable to the loop. A waiver naming a file that no longer exists is a slot a future file inherits unlinted — the loop's own comment says so, and it has been short by one since the trio landed.
- [ ] 6.6 [GREEN] DBUP + MIGRATE apply; `prisma validate` + `migrate status` up to date.
- [ ] 6.7 [evidence] DBUP + `AB --phase after --runs 3` — the authoritative capture against the COMMITTED index. Record whether `Q1`/`Q2`/`Q5`'s displacement is repaired or the DROP was taken; every out-of-band case adjudicated; the single-corpus caveat travels with the decision.
- [ ] 6.8 [integration] Apply the index `down.sql` on a scratch database, confirm `pg_indexes` returns the as-shipped definition, re-apply forward.

## Phase 7: PR-2 gate

- [ ] 7.1 **0-defect gate (PR-2)**: TSC = 0 (workspace + standalone script); `eslint --max-warnings 0` = 0 on touched files; fitness **#3/#8/#9/#10/#16/#21/#23/#30/#32/#38/#39/#40 = 0** (#38: `PrismaPostQueryRepository.ts` is already file-excepted and the reshape keeps its `deletedAt` seeds — re-measure the db-prisma ratchet, it may fall and must never rise; #39: the 61-enrollment count is unchanged); `prisma validate` + `migrate status` up to date; BATCH `integration:tenant-isolation` green, 0 cancelled / 0 skipped; SQUAWK green or adjudicated; prettier clean including the regenerated report; database left as found.

---

# PR-3 — The 58-policy sweep [SENSITIVE — token] (dep: PR-2)

> Out of scope: the gate that reads the result — it ships in PR-4, so the sweep is provably
> green before anything gates on it.

## Phase 8: The sweep migration and its evidence

- [ ] 8.1 [SENSITIVE] MIGRATE `<ts>_rls_initplan_sweep`, opening with `SET LOCAL lock_timeout = '5s'` + `SET LOCAL statement_timeout = '60s'` (116 DDLs in one `DO` statement — 61 `ACCESS EXCLUSIVE` locks held to commit needs a bounded failure mode). A `DO $$` loop over `pg_policy JOIN pg_class JOIN pg_namespace WHERE polname = 'tenant_isolation'`, excluding `Post`/`PostContent`/`PostMedia` (already rewritten by 4.1) and `AIPromptTemplate`. **Enumeration comes from the live catalog — no hardcoded table array**: the 61 live across 10 migrations, so a file-derived or list-derived enumeration is how a policy is missed or a variant is deleted.
- [ ] 8.2 [SENSITIVE] Same migration: `AIPromptTemplate` on an **explicit branch after the loop**, excluded from the generic rewrite, producing the **3-arm** form — `__system__` OR `"accountId" = …` OR **`"accountId" IS NULL`**. The third arm is global-template visibility; losing it is a silent behaviour change, not a performance detail. `WITH CHECK` stays strict (two arms). Use the 2.8 S-rendering if `S` won.
- [ ] 8.3 [SENSITIVE · deploy-time] Same migration: assert **`rewritten = found`** AND **`found = 57`** (61 − 3 trio − 1 variant), and after the variant rewrite assert `pg_get_expr(polqual, polrelid)` still matches `IS NULL`. A mismatch RAISES and aborts the transaction — a partial sweep SHALL NOT commit.
- [ ] 8.4 [SENSITIVE] Branch on **`polwithcheck IS NULL`** and emit **no** `WITH CHECK` for such policies. Vacuous today — all 61 declare one — but the invariant must be STRUCTURAL: an unspecified `WITH CHECK` inherits the `USING` expression by specification, so synthesizing one would change the effective write-path predicate of a policy that deliberately had none. (Design-gate observation; recorded here rather than left to the author to rediscover.)
- [ ] 8.5 [SENSITIVE] `down.sql`: a mirror `DO $$` re-creating the bare form for the 57 plus an explicit bare variant, carrying the SAME count assertions. Reversibility is symmetric or it is not reversibility.
- [ ] 8.6 [deploy-time RED] Prove 8.3's abort: on a scratch database, plant a state where the loop rewrites fewer than it found (e.g. add a `tenant_isolation` policy the loop's filter skips), run the migration, observe the RAISE and a rolled-back transaction with the catalog unchanged. Restore; re-run clean. A count assertion never observed firing is a count assertion nobody has tested.
- [ ] 8.7 [GREEN] DBUP + MIGRATE apply; `prisma validate` + `migrate status` up to date.
- [ ] 8.8 [integration] Assert the variant keeps its third arm BEHAVIOURALLY, not textually: a tenant reading `AIPromptTemplate` gets its own rows AND the global (`"accountId" IS NULL`) rows, exactly as before the rewrite.
- [ ] 8.9 [evidence] **Per-policy before/after `EXPLAIN` for the 58 + the variant** — the trio's verdict SHALL NOT be inherited by the others. One measured case in this repo already showed the wrapper CHANGING the chosen index, so a moved plan is live and unbounded by literature. Generic sweep-evidence pass per table (rollback arm: bare vs winner, `LIMIT 20` listing + `count(*)`, digest by PK, EXPLAIN capture). **A plan that MOVES is a recorded finding with an adjudication** — it is NOT omitted because the row set was unchanged. **The digest pass MUST carry the three-GUC-state check — bound tenant, `__system__`, UNSET — PER POLICY**, not only the row digest: the digest binds ONE tenant, and under a bound tenant a rewritten policy that lost its `__system__` disjunct returns identical rows and ships green while having silently revoked every `withSystemContext()` flow's visibility. This is the identical blindness task 2.5 closed for the trio, and it generalises here because 57 policies are rewritten by a `DO $$` loop that no per-policy eye reads. `proveFormEquivalence` (`scripts/rls-ab-measurement.ts`) already reads its two bodies from a list and evaluates them over a non-RLS `VALUES` sample, so it generalises to `(bare, winner)` per rewritten policy — reuse it rather than re-deriving the check. A sweep whose evidence omits the sentinel state can drop it from any of the 57 and still report green.
- [ ] 8.10 [evidence · stated honestly] Record in the report that most of the 58 tables are EMPTY on the scratch corpus, so their timings are meaningless: this pass proves the qual becomes a Param/InitPlan reference in the plan and that rows are identical where rows exist. **Timing claims remain trio-only.** This is the maximum closable portion of the S2-flip gap on a scratch corpus, and the report says so rather than implying more.
- [ ] 8.11 [integration] Apply the sweep `down.sql` on a scratch database; prove restoration by comparing the policy **5-tuple** per table, not `qual` alone; re-apply forward.
- [ ] 8.12 **0-defect gate (PR-3)**: TSC = 0 (workspace + standalone script); eslint 0; fitness #8/#9/#10/#23/#30/#32/#39 = 0 (#39's enrollment count unchanged at 61); `prisma validate` + `migrate status` up to date; BATCH green, 0 cancelled / 0 skipped; SQUAWK clean (policy DDL has no rule — a firing rule is investigated); prettier clean; database left as found.

---

# PR-4 — The form-uniformity gate, its red, and change close (dep: PR-3)

> The gate ships LAST, over a catalog that is already uniform. A mixed catalog SHALL NOT be
> reported as done with the remainder deferred — which is why this link is the change's end,
> not a follow-up.

## Phase 9: Read-back, then the gate

- [ ] 9.1 [evidence · ORDERING — blocks 9.2] With the winner installed on all 61, read `pg_policies.qual` and `pg_policies.with_check` back from **this project's own PostgreSQL 16.14** and paste the observed rendering into the test as a fixture comment. `pg_get_expr` normalizes casts, spacing and subquery aliases, so the gate SHALL NOT byte-compare against migration SQL. If `S` won and PostgreSQL deparses the Var-bearing IN-list as `= ANY (ARRAY[...])`, the matcher becomes THAT observed adjacency — read-back decides, bytes are never guessed.
- [ ] 9.2 [RED] Extend `apps/api/tests/integration/rls-tenant-isolation.test.ts` with the form-uniformity `it()`: compliance per rendered expression = `occurrences("current_setting(") === occurrences("select current_setting(")` after lowercasing + whitespace collapse (or 9.1's observed adjacency). Expected policy count derived from `getTenantScopedModels().size` — **never a literal**. The failure message NAMES the offending policy.
- [ ] 9.3 [integration] **A NULL `with_check` is COMPLIANT** — an unspecified `WITH CHECK` inherits the `USING` expression by specification, and a gate demanding a non-null `with_check` would red-line correct policies. Assert it explicitly with a fixture, not by omission. The 3-arm variant likewise PASSES.
- [ ] 9.4 [integration] Run the gate over the uniform catalog → reports uniform, exits zero, all 61 pass including the variant.
- [ ] 9.5 [RED-PROOF · mandatory, canon step 3] Plant a **bare** `tenant_isolation` policy on `WebhookEvent` (scratch) → the suite exits with a **REAL non-zero exit naming the table** (an `::error` annotation or log line alone leaves the job green and proves nothing) → restore → prove the restored policy 5-tuple byte-equal to pre-plant → re-confirm green. Record the demonstration in the PR body and in `docs/technical/ADR-0022-rls-enforcement-posture.md` §Coverage-gate red alongside the existing three.
- [ ] 9.6 [static] In the gate's own comment, NAME **SMELL-91** as a known, unfixed limit: `scripts/` sits outside every tsconfig project and every fitness scope, so the harness this gate's evidence came from is typechecked by nothing in CI. A limit stated in the check is a limit the next reader finds.
- [ ] 9.7 [static] CONFIRM — do not add — the wiring: `apps/api/scripts/run-tests.sh` (read-only) already names `rls-tenant-isolation.test.ts` in the `integration:tenant-isolation` `run_batch` at `:273` (fitness #30 — a suite no batch names never executes), and ci.yml's Integration Tests job runs that batch on every PR against the migrated Postgres service. **Create no `.github/workflows/fitness.yml` step** — rendered policy text is database state no grep can read; a fitness step here is drift, exactly as D-S0-4 ruled for the coverage gate.

## Phase 10: Change close

- [ ] 10.1 [integration] Final uniformity assertion for the record: all **61** enrolled policies read from the catalog are in the canonical form. State it as a measured count, not as "the sweep completed".
- [ ] 10.2 `docs/reports/roadmap-detected-smells-backlog.md`: file the **`Post_projectId_createdAt_idx` redundancy** row — currently id-less and deliberately **NOT SMELL-92** (which owns the unscoped `PostRepository` collection reads). Next available id is **SMELL-94** (SMELL-93 is this change's own parent row; re-verify at apply). Carry the single-corpus caveat and the 6.7 measurement that motivates it.
- [ ] 10.3 Same file: file the **three unmeasured feed-shaped siblings** as a follow-up — `PrismaRepurposeDetectionAdapter.ts:204`, `zapierRoutes.ts:371`, `makeRoutes.ts:376`. Named in the proposal as out of scope; a non-goal recorded only in a change record is a lost finding.
- [ ] 10.4 Update SMELL-93's row to DONE with the PR numbers and the measured outcome per repair (form rewrite / reshape / index shape), including whichever of its three repairs measured net-negative — the row records what happened, not what was hoped.
- [ ] 10.5 [evidence] Change-close statement in `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §Completion: what this change does **NOT** claim — no write-path speedup (the `WITH CHECK` cost is unmeasured, every number here is read-path), no repair of `Q4`'s 0.11 % planner tie, no resolution of the index redundancy, no fix for SMELL-91.
- [ ] 10.6 **0-defect gate (PR-4)**: TSC = 0 (workspace + standalone script); `eslint --max-warnings 0` = 0; fitness **#3/#8/#9/#10/#16/#21/#23/#30/#32/#38/#39/#40 = 0** with #30 at its ratchet baseline and #38's db-prisma ratchet re-measured (may fall, never rise); `prisma validate` + `migrate status` up to date; BATCH green, 0 cancelled / 0 skipped; the planted red of 9.5 restored byte-exact (verify with `cmp`); prettier clean; database left as found, proven by an out-of-band read rather than assumed.
