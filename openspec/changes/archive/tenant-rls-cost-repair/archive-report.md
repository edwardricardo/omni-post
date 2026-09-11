# Archive Report: tenant-rls-cost-repair

> **STAGING NOTE (mechanical steps blocked — see below).** This report was authored by the
> `sdd-archive` executor in a session with **no shell/Bash tool available** (tool set: Read,
> Edit, Write, Glob, Engram MCP only — no execute/move/delete capability of any kind). Per
> `~/.claude/skills/sdd-archive/SKILL.md` §"Mechanical Copy Contract", moving the change
> folder to `openspec/changes/archive/` and creating a new capability spec by mechanical
> copy both REQUIRE `cp -R` / `mv` / `git mv` + an independent `diff -r` readback, and the
> skill is explicit: **if shell access is unavailable, STOP and report blocked — do NOT
> fall back to Read/Write copying.** This file therefore still lives at
> `openspec/changes/tenant-rls-cost-repair/archive-report.md` (NOT yet at
> `openspec/changes/archive/tenant-rls-cost-repair/`), and the new `rls-policy-form`
> capability spec has **not** been created. Both are safe, mechanical, shell-only follow-ups
> for a session with Bash access (or the orchestrator, which already owns git/mv-class
> operations per this change's own tasks.md "Orchestrator-owned work units" table). `pnpm
exec prettier` likewise could not be run for the same reason; the additions below are
> hand-formatted to match the surrounding file's existing style but are UNVERIFIED by
> `prettier --check`.
>
> What WAS completed in this session, safely, within the available tools:
>
> 1. The `post-tenant-isolation` MODIFIED delta was merged into the existing main spec
>    `openspec/specs/post-tenant-isolation/spec.md` via text edit (not a copy — a
>    considered merge, the form the skill prescribes for "if main spec exists").
> 2. The living-spec preamble's now-false claim ("Post has no direct `accountId`") was
>    fixed in that same file to state the shipped truth.
> 3. This report was written and will also be saved to Engram
>    (`sdd/tenant-rls-cost-repair/archive-report`) per explicit instruction, independent of
>    the filesystem archive state.
>
> **Outstanding, for a shell-capable follow-up:**
>
> - Create `openspec/specs/rls-policy-form/spec.md` as a mechanical copy of
>   `openspec/changes/tenant-rls-cost-repair/specs/rls-policy-form/spec.md` (no main spec
>   exists yet for this new capability), verified with `diff -r`.
> - Move `openspec/changes/tenant-rls-cost-repair/` to
>   `openspec/changes/archive/tenant-rls-cost-repair/` (this repo's established convention
>   has NO date prefix — verified by inspecting all 16 existing archived folders, none of
>   which carry a `YYYY-MM-DD-` prefix), verified with `diff -r` against a pre-move snapshot.
> - Run `pnpm exec prettier --write` then `--check` over this file and the merged spec.
>
> The Task Completion Gate and verification gate below were both checked and both PASS —
> nothing about the change's completeness is in question, only the mechanical filesystem
> relocation.

## Task Completion Gate

All 75 implementation tasks across `tasks.md` (Phases 1–10, PR-1a through PR-4) read `[x]`
at the time of this archive, including the orchestrator-owned gate tasks 1.10, 2.9, 3.8, 7.1,
8.12, and 10.6. No stale unchecked checkbox exists. Native SDD status at hand-off reported
`taskProgress 75/75`, `allComplete: true`.

## Verification Gate

`verify-report.md` (`sdd/tenant-rls-cost-repair/verify-report`, evidence revision
`sha256:cc81d46c…`): **verdict `pass_with_warnings`, 0 blockers, 0 critical findings**,
10/10 requirements, 35/35 scenarios, independently reproduced test/build commands both exit 0. The one WARNING (an aggregate assertion in the form-uniformity gate that contradicted its
own NULL-`WITH CHECK` compliance rule — vacuous on the deployed catalog, latent once the
sweep's `polwithcheck IS NULL` branch is exercised) and both SUGGESTIONs (stale size figures;
a task/apply-progress checkbox-timing artifact of the writer/orchestrator handoff pattern)
were **fixed before commit, not merely accepted** — see the Addendum in `verify-report.md`
and Batch 8's Amendment in `apply-progress.md`. RDD re-ran on the corrected candidate and
burned `approved` with zero advisories (lineage `review-e5c8e5f5a9001613`).

## What Shipped

Four PRs, stacked to main in order, each green on every real check (the only non-pass rows
on any rung were the four chronic pre-existing Container Security jobs, unrelated to this
change):

| PR   | SHA        | Content                                                                                                                                                                                                                                                             |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #236 | `3498d880` | Harness fidelity advisories (PR-1a/Phase 1) + the three-arm `{A′, W, S}` × 13-case decision run (PR-1b/Phase 2) + the four-arm index shortlist (PR-1c/Phase 3) — measurement and verdicts, no schema touched                                                        |
| #237 | `ac68e2da` | Trio policy migration in the `W` (InitPlan) form + `listGlobal` reshape to the local `accountId` column + the `IX1` `(accountId, projectId, createdAt)` index winner + ADJUDICATION 5 (Squawk fix `c9808cb9` for the `IX1` `down.sql`, its red observed live in CI) |
| #238 | `567f8f56` | The 58-policy sweep (`pg_policy`-enumerated, `AIPromptTemplate` on an explicit branch preserving its 3-arm form)                                                                                                                                                    |
| #239 | `77992838` | The form-uniformity gate (read-back-derived matcher, red demonstrated on a committed planted policy) + change-close bookkeeping — main's tip at close                                                                                                               |

### Capability changes

- **`rls-policy-form` (new capability)**: all 61 enrolled `tenant_isolation` policies now
  express the tenant predicate as `(SELECT current_setting('app.account_id', true))` —
  an uncorrelated expression subselect the planner hoists into an InitPlan evaluated once
  per statement rather than once per row — on both `USING` and `WITH CHECK` where both are
  declared. `AIPromptTemplate` keeps its third `"accountId" IS NULL` disjunct. A
  MERGE-BLOCKING form-uniformity gate lives in
  `apps/api/tests/integration/rls-tenant-isolation.test.ts`, wired into the
  `integration:tenant-isolation` batch (`apps/api/scripts/run-tests.sh`, fitness #30
  reachability), reads the matcher back from the deployed `pg_policies` catalog (never
  migration bytes), treats a NULL `with_check` as compliant, and derives its expected
  population from `getTenantScopedModels().size` — never a literal.
- **`post-tenant-isolation` (modified)**: the global unfiltered list's (`GET /posts` with no
  `projectId`) scoping mechanism moved from the transitive `project.accountId` relation to
  the post's own local `accountId` column, made safe by the composite foreign key the A′
  trio slice added (a Post/Project `accountId` disagreement is unrepresentable). The
  project-liveness predicate (`project.deletedAt IS NULL`) was retained. Row-equivalence —
  not timing — was the hard gate for this move.

## Measured Outcomes

- **Trio policy form (the primary repair)**: **2.27× / 2.24× / 2.23×** scan-node speedup on
  the committed `W` form vs. the pre-change bare form (`S3`, `Q3`, `Q4`), inside the
  predicted 2.1–2.4× band. `W` won over the syntactically-tighter `S` (single `IN`) only on
  the **pre-declared tiebreak** — six repeated sweeps showed neither form's difference was
  sign-stable, and both forms measured to **2 InitPlans**, not 1, so `S`'s premise (one GUC
  read → one InitPlan) did not hold at the plan level either.
- **A real, accepted regression carried with the win**: the synthetic probe `S2` (no tenant
  predicate at all, not a query the application issues) moved **3.50×–3.67× slower** because
  the wrapped form changed the chosen index (`Post_projectId_createdAt_idx` →
  `Post_projectId_archivedAt_idx`); its real-world counterparts `Q1`/`Q5` (which DO carry the
  application's own predicates) got faster under the same rewrite. Recorded as an accepted,
  bounded, and named adjudication — not smoothed over.
- **`listGlobal` reshape**: **net-zero on timing** (`Q3` unchanged, still `Seq Scan`, still
  `Indexes used: (none)` — the corpus's two-tenant shape means `accountId` selects half the
  table either way). It ships on **row-equivalence**, not speed, and on `Q4` reaching an
  `Index Cond` on the tenant restriction where the superseded mirror discarded ~9,500 of
  19,000 candidate rows in a `Filter`.
- **Index shape**: `IX1` `(accountId, projectId, createdAt)` won on MEASUREMENT against
  `{as-shipped, (accountId, createdAt), DROP}` — `DROP` was measured as a first-class arm
  and LOST on a sign-stable `Q2` regression under the narrower candidates. `Q1`/`Q5` lost
  their `Sort` node entirely (0.047→0.021 / 0.048→0.017 ms scan-node).
- **The 58-policy sweep**: **58/58 identical** (row count + whole-row `md5`) across THREE GUC
  states (bound tenant, `__system__`, UNSET) — the same three-state check that closed the
  trio's `__system__`-blindness gap (task 2.5), generalized because a per-tenant digest alone
  cannot see a rewritten policy that silently lost its `__system__` escape. **No plan moved**
  on the 3-of-58 tables sampled for per-policy `EXPLAIN` (52 of 58 carry `reltuples` 0 or −1
  and plan nothing informative), so this link owed no plan-move adjudication.
- **Final catalog state**: 61/61 policies compliant, 0 non-compliant, 244 hoisted GUC reads /
  0 un-hoisted, catalog 5-tuple digest `70322c28db1c0684897b49e4d70de014`.

## What This Change Does NOT Claim

- **No write-path speedup.** Every number in this change is a read-path number; the
  `WITH CHECK` cost was never measured.
- **`Q4`'s 0.11% planner tie is unrepaired.** Nothing in this change touches it; `Q4` is read
  for its Δ, never for its plan, throughout.
- **`Post_projectId_createdAt_idx` redundancy is unresolved** — filed as **SMELL-94**
  (backlog: `docs/reports/roadmap-detected-smells-backlog.md`), carrying the single-corpus
  caveat and the 6.7 measurement (zero of the 13 authoritative cases read that index).
- **SMELL-91 is named, not fixed**: `scripts/` (home of the measurement harness) sits outside
  every tsconfig project and every fitness scope; the change's own gate names this limit in
  its own docblock rather than leaving it undiscoverable.
- **The three unmeasured feed-shaped siblings** (`PrismaRepurposeDetectionAdapter.ts:204`,
  `zapierRoutes.ts:371`, `makeRoutes.ts:376`) were named as out of scope in the proposal and
  filed as **SMELL-95** at close, with all three line refs re-verified live.
- **One corpus shape** (100 projects × 10,000 posts, 100/project) underlies every timing
  figure; the caveat travels with the index decision wherever it is recorded.

## Residuals Carried Forward

- **SMELL-94** (`Post_projectId_createdAt_idx` redundancy) and **SMELL-95** (the three
  unmeasured feed-shaped siblings) — both filed in
  `docs/reports/roadmap-detected-smells-backlog.md` at change close, with SMELL-93 (this
  change's own parent backlog row) updated to DONE citing the four PR SHAs above and the
  outcome per repair (form rewrite net-positive with the accepted `S2` regression; reshape
  net-zero on timing; index shape net-positive with DROP measured and rejected).
- **SMELL-91** — `scripts/` remains outside every tsconfig project and every fitness scope;
  the harness's only typecheck is the standalone invocation documented in `apply-progress.md`
  Batch 1 §Commands, run by hand at each gate.
- **PR-4's fresh-context gate risks on `down.sql`, noted fail-closed**: reversibility for the
  policy and index migrations rests on each `down.sql` restoring the prior form verbatim and
  on the count/tuple-comparison proofs (5-tuple, not `qual` alone) rather than a byte-level
  migration diff; these were exercised on scratch databases (tasks 4.8, 6.8, 8.11) with the
  restore direction proven before the forward direction was trusted, and the fresh-context
  review treated any unexercised down-path branch as fail-closed rather than assumed-safe.
  Flagged here as a residual because the down-migrations are exercised on a corpus this
  change controls, not on a production-shaped one.
- **The account-wide feed's index question is still undecided in both directions** on a
  realistic tenant distribution — this corpus has exactly two tenants, so `Q3`/`Q4` still
  `Seq Scan` regardless of index shape, and no link may read that as a finding about a
  realistic distribution.
- **The mechanical filesystem steps named at the top of this report** (new `rls-policy-form`
  main spec via mechanical copy; the archive folder move to
  `openspec/changes/archive/tenant-rls-cost-repair/`; `prettier --write`/`--check`) — blocked
  in this session by the absence of a shell/Bash tool, not by any defect in the change
  itself.

## Archived Change Directory Contents (staged, not yet moved)

- `proposal.md`, `explore.md`, `research.md`, `design.md`, `tasks.md` (75/75 complete),
  `apply-progress.md` (8 batches + 2 correctives + 2 amendments), `verify-report.md`
  (`pass_with_warnings`, addendum recording the pre-commit fix), `specs/post-tenant-isolation/spec.md`
  (delta, merged into the main spec by this report), `specs/rls-policy-form/spec.md` (delta;
  IS the new capability's full spec, pending mechanical copy), this `archive-report.md`.

## Traceability — Observation IDs / Sources Read

- `openspec/changes/tenant-rls-cost-repair/proposal.md` (file, read in full)
- `openspec/changes/tenant-rls-cost-repair/specs/post-tenant-isolation/spec.md` (file, read in full)
- `openspec/changes/tenant-rls-cost-repair/specs/rls-policy-form/spec.md` (file, read in full)
- `openspec/changes/tenant-rls-cost-repair/design.md` (file, read in full)
- `openspec/changes/tenant-rls-cost-repair/tasks.md` (file, read in full, both pages)
- `openspec/changes/tenant-rls-cost-repair/apply-progress.md` (file, read across four ranges
  covering Batches 1, 2, 6, 7, 8 and both correctives/amendments; ~2,633 lines total)
- `openspec/changes/tenant-rls-cost-repair/verify-report.md` (file, read in full)
- `openspec/specs/post-tenant-isolation/spec.md` (file, read in full, then merged in place)
- `openspec/specs/multi-tenant-isolation/spec.md`, `openspec/specs/tenant-context-boundaries/spec.md`
  (files, read in full to confirm the false "Post has no direct accountId" claim does not
  recur elsewhere in the main specs tree — confirmed absent from both)

## Change Status

**Implementation and verification are COMPLETE and PASS.** The change is functionally
closed: all 75 tasks done, verify-report `pass_with_warnings` with 0 criticals and its one
warning fixed before commit, all four PRs merged to main in stacked order. **The OpenSpec
filesystem archival (folder move + new capability spec copy + prettier) is PENDING**, blocked
only by the absence of a shell tool in this session, and is a mechanical, low-risk follow-up
for a shell-capable session or the orchestrator.
