# Proposal: tenant-rls-cost-repair

> SMELL-93's three repairs (docs/reports/roadmap-detected-smells-backlog.md), from
> `explore.md` + `research.md` in this folder. Decisions confirmed by Edward 2026-09-09;
> this proposal records them, it does not re-open them.

## Intent

The A′ trio slice regressed measured read paths with one root: the RLS tenant qual is
evaluated **per row** and never becomes an `Index Cond` (17× Filter / 0× Index Cond). The
measured cost is the bare `current_setting()` call itself; the InitPlan form
`(SELECT current_setting(...))` is **~2.1–2.4× cheaper on the same scan node and
semantics-identical** (in-house 4-arm A/B). Spec-level grounding (research facts 1–4):
per-row evaluation is by specification (PG 16 §5.9); `STABLE`'s single-call guarantee is
scoped to index scan conditions (§38.7), so the Filter re-evaluation is expected behavior;
the wrapper is a named, linted industry practice whose lint explicitly covers
`current_setting(%)` (Supabase splinter `0003`); and — security disclaimer — the wrapper's
subselect **reads no table**, so the documented RLS sub-SELECT leak channel does not apply.

## Scope

### In Scope

1. **Harness work (prerequisite):** scan-node median (mechanical cause of the retracted
   4.198 defect); `median()` empty→throw; restore-proof compares
   `(qual, with_check, permissive, cmd, roles)`; abort sentinel class; generated preamble
   narrowed to what `VACUUM` buys; `sourceSite` refresh; per-run index-set annotation for
   Q4 (**no** failing stability guard); lane-4 preconditions: no DML inside arms, `VACUUM`
   before, assert `Heap Fetches: 0`.
2. **Repair 1 (trio policy):** rewrite the 3 trio policies to InitPlan form, measured via
   `--policy-ab` extended to run the 13 real CASES per arm.
3. **Repairs 2+3 in one measured step:**
   - `listGlobal` (PrismaPostQueryRepository.ts:432-441) drops the relation's
     `accountId` — the composite FK (schema.prisma:706) makes disagreement
     unrepresentable — and KEEPS `project: { deletedAt: null }` liveness; the port
     already receives `accountId`.
   - Index via new `--index-ab` mode, arms `{as-shipped, +createdAt extension,
(accountId, createdAt), DROP}`, measured BEFORE any migration is authored; primary
     candidate `(accountId, projectId, createdAt)`; DROP is the measured fallback if the
     winner is still net-negative.
4. **The remaining 58 policies:** `AIPromptTemplate`'s 3-arm variant on an explicit
   branch; migration enumerates from `pg_policy` with a rewritten==found count assertion;
   per-policy EXPLAIN evidence (the S2 flip proves the rewrite can move plans — research
   gap 1).
5. **Form-uniformity gate:** catalog-based (`pg_policies` text-match per research lane 2);
   NULL `with_check` is COMPLIANT (lane 5); red path demonstrated per repo rule.
6. **Tidies:** stale docblocks (`getById` :99-101, `listGlobal` :417-421);
   schema.prisma:744-749 index justification rewritten from measurement.

### Out of Scope (non-goals)

- Q4's 0.11% planner tie — no repair removes it; read for Δ, never for plan.
- `Post_projectId_createdAt_idx` redundancy — follow-up with no backlog id yet (a SMELL
  row is filed at change close; NOT SMELL-92, which owns the unscoped `PostRepository`
  collection reads).
- Write-path speedup claims — unmeasured (research gap 5); every number here is read-path.
- The 3 unmeasured feed-shaped siblings (`PrismaRepurposeDetectionAdapter.ts:204`,
  `zapierRoutes.ts:371`, `makeRoutes.ts:376`) — named follow-up.
- `filterIdsByAccount` / `findOwnerAccountId` — OFF-LIMITS (the join IS the semantics).
- SMELL-91's `scripts/` typecheck gap — named in the gate, not fixed here.

## Capabilities

### New Capabilities

- `rls-policy-form`: canonical InitPlan-wrapped tenant-policy expression form for all 61
  enrolled policies (variant preserved), plus the catalog-based form-uniformity gate and
  the measured Post index-shape record.

### Modified Capabilities

- `post-tenant-isolation`: the global-list read surface's scoping mechanism moves from the
  transitive `project.accountId` relation to the local `accountId` column (rows returned
  are unchanged; row-equivalence is the hard gate).

## Approach

**Approach B (harness-first), sequenced 1 → 2+3 → 58 → gate** (explore §6/§7). The
measurement comes before the schema object exists — the structural fix for D-S1-1's
"justified from reasoning, measured wrong afterwards" defect. Index mechanics stated
honestly (explore §4, research lane 3, T1): the extension repairs the displacement of
Q1/Q2/Q5 and does **not** by itself give the account-wide feed ordered output — with only
`accountId` bound the range is ordered by `(projectId, createdAt)`; Incremental Sort needs
a leading key; skip scan is PG 18, server is 16.14. `(accountId, createdAt)` is the arm
that serves the feed shape; the 3-arm measurement decides.

**Acceptance criterion per re-run (explore §8.9):** NOT "no case regresses" — every case
moving outside the ≤6 µs / <1% band gets a recorded adjudication; **row-equivalence is the
hard gate; timing is evidence.**

**Design-phase question (flagged, not answered here):** research gap 7 — whether the
`__system__` disjunct is merely wrapped or restructured to a single-InitPlan form.
Design + measurement owns it.

## Affected Areas

| Area                                                                    | Impact   | Description                                                                                                       |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `scripts/rls-ab-measurement.ts`                                         | Modified | 13-case `--policy-ab`, new `--index-ab`, all harness advisories, mirror + `sourceSite` refresh                    |
| `infra/prisma/migrations/` (new)                                        | New      | trio policy rewrite; index winner; 58+variant sweep (token-gated; Squawk timeout settings + ADJUDICATION entries) |
| `infra/prisma/schema.prisma:750`                                        | Modified | index shape per measurement; docblock rewritten from measurement (token-gated)                                    |
| `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts` | Modified | `listGlobal` reshape; stale docblocks                                                                             |
| `apps/api/tests/integration/rls-tenant-isolation.test.ts`               | Modified | form-uniformity gate, red demonstrated                                                                            |

**Fitness interactions (config rule):** integration-tier RLS coverage gate (non-numbered)
is extended with form uniformity and stays in the `integration:tenant-isolation` batch
(#30 reachability); #39's 61-enrollment count is unchanged; #38 —
PrismaPostQueryRepository.ts is already file-excepted and the reshape keeps its
`deletedAt` seeds; #8 — no phase refs in new comments.

## Risks

| Risk                                                                      | Likelihood | Mitigation                                                                                                     |
| ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| Stale Q3/Q4 mirrors invisible to fidelity check (highest mechanical risk) | High       | update mirrors + `sourceSite` refs in the same commit as the reshape                                           |
| `AIPromptTemplate`'s third disjunct deleted by a loop rewrite             | Med        | explicit branch + `pg_policy` enumeration with count assertion                                                 |
| Mixed-catalog window if the change stalls after the trio                  | Med        | staged to ALL 61 within this change; gate ships last                                                           |
| In-transaction index IOS is inference, not citation                       | Med        | assert `Heap Fetches: 0`; `--index-ab` is a shortlist filter — commit the winner for the authoritative capture |
| `pg_get_expr` rendered byte form unpinned (research gap 2)                | Med        | read back from our 16.14 catalog before writing the gate regex; plant a bare policy for the red                |
| One corpus shape (100×100; explore §9.8)                                  | Low        | caveat recorded wherever the index decision is recorded                                                        |
| Token-gated migrations drift (`migrate status`)                           | Low        | `sensitive-edit` per invocation; schema edit + migration land together                                         |

## Rollback Plan

- **Policy migrations:** semantics-preserving; each down migration re-creates the bare
  form verbatim (one file per step; trio and 58 are separate migrations).
- **Index migration:** down restores as-shipped `(accountId, projectId)`; the DROP arm is
  reversible the same way.
- **`listGlobal` reshape:** single-file revert; row-equivalence proves identity pre-merge.
- **Gate:** revert the test extension; the existing pg_catalog coverage gate remains.

## Dependencies

- `omnipost-allow sensitive-edit` token per migration/schema invocation.
- Scratch DB via `pnpm db:up`; PostgreSQL 16.14; Slice 1 cluster landed (#230/#232/#233).

## Delivery

`auto-chain`, `stacked-to-main`, 400-line review budget per PR (`size:exception` explicit
when the forecast demands). Expected slicing (final slicing belongs to tasks):
**PR-1** harness work + trio measurement evidence → **PR-2** trio policy migration +
`listGlobal` reshape + index-winner migration (two commits: policy / reshape+index, per
explore §6) → **PR-3** the 58 + variant + form gate.

## Success Criteria

- [ ] Trio policies in InitPlan form; committed re-run (scan-node median) confirms the
      ~2.1–2.4× band; row-equivalence green across all 13 cases.
- [ ] Index shape chosen FROM `--index-ab` measurement; schema docblock states the
      measurement, not reasoning; Q1/Q2/Q5 displacement repaired or DROP taken.
- [ ] All 61 policies uniform in `pg_policies`; `AIPromptTemplate`'s 3 arms preserved;
      per-policy EXPLAIN evidence recorded.
- [ ] Form gate green on the uniform catalog AND red demonstrated on a planted bare policy.
- [ ] Every out-of-band case carries a recorded adjudication; no case returns different rows.
