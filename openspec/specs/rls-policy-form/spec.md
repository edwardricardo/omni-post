# RLS Policy Form — Delta Spec (tenant-rls-cost-repair)

> **NEW capability** for change `tenant-rls-cost-repair`. Capability: **the tenant predicate
> of every enrolled RLS policy is expressed in ONE canonical InitPlan-wrapped form; that form
> and the Post index shape are chosen from MEASUREMENT rather than from reasoning; and the
> deployed catalog is gated so the form cannot drift back.**
>
> **Why the form is a capability and not a tuning detail.** The measured cost is the bare
> `current_setting()` call evaluated per row (17× `Filter`, 0× `Index Cond`), and PostgreSQL
> documents that as the specified behaviour, not an anomaly: a policy expression is evaluated
> for each row (PG 16 §5.9), and `STABLE`'s single-call guarantee is scoped to index scan
> conditions (§38.7). No index can change that — only the expression can. The repo's standing
> convention for policies is _copy the origin migration and never edit it in place_, which is
> exactly what turned one unmeasured choice into 61 identical ones; a form that is not gated
> in the catalog is a form the next author copies by coin flip.
>
> **Security note, stated so it is not re-litigated in review.** The wrapper's subselect reads
> **no table**. PostgreSQL's documented sub-`SELECT`-in-a-policy hazard is scoped to policies
> that consult _other rows or other tables_, so the documented information-leak channel does
> not apply here.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the PR of the slice that owns them.
>
> **Scenario tags** are as defined in the `rls-enforcement` delta of change
> `tenant-isolation-composite-fk`: `[static]` — checkable by inspecting schema, migrations,
> config, or workflow files. `[integration]` — requires a real-DB run. `[deploy-time]` —
> enforced by a migration-time assertion that halts rather than by a CI test. `[evidence]` —
> requires a real-DB run whose OUTPUT is recorded as a durable, re-runnable artifact; it is
> satisfied by CAPTURING the measurement and FAILS when the measurement is asserted instead.
>
> **Non-goals (from the proposal, restated so they are not re-litigated here):** this
> capability claims **no write-path speedup** — every number in it is a read-path number, and
> the `WITH CHECK` cost is unmeasured. It does not repair `Q4`'s 0.11 % planner tie, does not
> resolve `Post_projectId_createdAt_idx` redundancy (a follow-up with no backlog id yet —
> NOT SMELL-92, which owns the unscoped `PostRepository` collection reads; a row is filed
> at change close), does not touch the three
> unmeasured feed-shaped siblings, and does not fix SMELL-91's `scripts/` typecheck gap.
> Whether the `__system__` disjunct is merely wrapped in place or restructured to a
> single-InitPlan shape is **deliberately left undetermined here** — design plus measurement
> owns it; this capability requires only that whatever shape is chosen is the SAME across all
> enrolled policies.

---

## ADDED Requirements

### Requirement: Every enrolled policy expresses the tenant predicate in one canonical InitPlan-wrapped form **[MERGE-BLOCKING]**

All **61** enrolled tenant policies SHALL reference `current_setting('app.account_id', true)`
through an uncorrelated expression subselect — the form the planner converts into an InitPlan
evaluated once per execution — rather than as a bare call. Where a policy explicitly declares
`WITH CHECK`, that clause SHALL use the SAME form as `USING`; a policy whose two halves use
different forms is the drift this capability exists to remove. A policy that declares no
`WITH CHECK` SHALL be left declaring none: it inherits the `USING` expression by
specification, and rewriting `USING` therefore rewrites the effective write-path predicate.

The rewrite SHALL be **semantics-preserving**: the same rows for the same bound tenant. The
`AIPromptTemplate` variant SHALL retain **all three** of its disjuncts — its
`"accountId" IS NULL` arm is global-template visibility, and losing it is a silent behaviour
change, not a performance detail.

A catalog holding both forms SHALL NOT be the end state of this change.

#### Scenario: the wrapped form is what the catalog actually holds [integration]

- **GIVEN** an enrolled policy has been rewritten
- **WHEN** its `qual` is read back from `pg_policies`
- **THEN** the rendering shows the subselect form — the proof is the deployed catalog, never the migration source bytes

#### Scenario: the variant keeps its third arm [integration]

- **GIVEN** the `AIPromptTemplate` policy after the sweep
- **WHEN** a tenant reads templates
- **THEN** its own rows AND the global (`"accountId" IS NULL`) rows are returned, exactly as before the rewrite

#### Scenario: both clauses of a two-arm policy use one form [static]

- **GIVEN** a policy that declares both `USING` and `WITH CHECK`
- **WHEN** the rewritten policy is inspected
- **THEN** both clauses use the wrapped form — and a policy that declared no `WITH CHECK` still declares none

#### Scenario: the catalog is uniform when the change completes [integration]

- **GIVEN** every slice of this change has landed
- **WHEN** all 61 enrolled policies are read from the catalog
- **THEN** all 61 are in the canonical form — a mixed catalog SHALL NOT be reported as done with the remainder deferred

---

### Requirement: Acceptance is row-equivalence; timing is evidence, never the gate **[MERGE-BLOCKING]**

The acceptance criterion for every re-run in this change SHALL be **row-equivalence**: no case
may return different rows. Timing is EVIDENCE and SHALL NOT be promoted to a pass/fail gate —
the harness's own contract already says so, and a timing gate on a planner tie turns the
harness red for being right.

"No case regresses" SHALL NOT be adopted as the criterion. Instead, every case that moves
outside the **≤6 µs / <1 %** band SHALL carry a **recorded adjudication** naming what moved
and why it is accepted, repaired, or deferred. An out-of-band case that is reported without an
adjudication does not satisfy this requirement, and neither does an artifact that reports only
the cases that came out favourable.

#### Scenario: an out-of-band case is adjudicated, not smoothed over [evidence]

- **GIVEN** a re-run in which a case moves outside the ≤6 µs / <1 % band
- **WHEN** the evidence artifact is inspected
- **THEN** that case is named with its adjudication (accepted with a stated reason, repaired, or deferred to a named follow-up)

#### Scenario: differing rows fail the change [integration]

- **GIVEN** any rewritten policy or reshaped query under measurement
- **WHEN** the row-equivalence comparison runs across the 13 cases
- **THEN** an identical row set is required to proceed — a faster case that returns different rows FAILS, regardless of its timing

---

### Requirement: The harness satisfies its fidelity preconditions before any number is believed **[MERGE-BLOCKING]**

The headline A/B figures are **scan-node** figures, so the harness SHALL report a **scan-node
median** across runs. Re-running without it repeats the false-precision defect that already
forced one retraction. Additionally:

1. The median helper SHALL **throw** on empty input. Returning a sentinel is worse than
   failing, because `-1` renders as a plausible `-1.000 ms` measurement.
2. The restore proof SHALL compare the policy tuple `(qual, with_check, permissive, cmd,
roles)` — comparing `qual` alone cannot notice an arm that restored a policy with a NULL
   `with_check`.
3. The forced-rollback sentinel SHALL be a **class**, not a string comparison on an error
   message.
4. The generated preamble SHALL be narrowed to what `VACUUM` actually buys. A generated
   artifact SHALL NOT assert reproducibility that the same artifact's own data disproves.
5. Every `sourceSite` reference and query mirror SHALL be refreshed in the SAME commit as the
   reshape. Mirror fidelity validates the QUERY, not the REFERENCE, so a stale mirror returns
   the same rows and passes the identity check while measuring code that no longer exists —
   the highest mechanical risk in this change.
6. `Q4`'s index instability SHALL be surfaced as a **per-run index-set annotation**. A failing
   stability guard SHALL NOT be added: the underlying 0.11 % tie is not repaired by anything in
   this change, and `Q4` is read for its Δ, never for its plan.

#### Scenario: the headline number is a scan-node median [evidence]

- **GIVEN** a committed re-run of the A/B
- **WHEN** its reported figures are inspected
- **THEN** each is a median across runs taken at the scan node, and the run count it was taken over is recorded

#### Scenario: an empty measurement set fails loudly [static]

- **GIVEN** the median helper receives no samples
- **WHEN** it is called
- **THEN** it throws — it SHALL NOT return a value that renders as a measurement

#### Scenario: a restored policy is proven restored on all five attributes [static]

- **GIVEN** an arm has re-created a policy after its forced rollback
- **WHEN** the restore proof runs
- **THEN** it compares `(qual, with_check, permissive, cmd, roles)` and fails on any divergence

#### Scenario: Q4 divergence annotates and never fails [static]

- **GIVEN** `Q4` selects a different index between runs of one capture
- **WHEN** the harness reports
- **THEN** the divergence appears as an annotation with the per-run index sets, and the run still exits zero

#### Scenario: mirrors move with the code they mirror [static]

- **GIVEN** the reshape commit
- **WHEN** its diff is inspected
- **THEN** the affected query mirrors and every `sourceSite` line reference are updated in that same commit

---

### Requirement: The index arms are measured under conditions that make an index-only scan believable **[MERGE-BLOCKING]**

The index A/B measures arms inside a transaction that is rolled back, so its representativeness
has preconditions that SHALL be met rather than assumed:

1. The arm SHALL perform **no DML** on the measured table inside the arm transaction — any
   write clears visibility-map bits for the touched pages and silently destroys index-only-scan
   eligibility.
2. Seeding SHALL happen BEFORE, followed by `VACUUM` outside the transaction, so the visibility
   map matches the shape the measurement stands in for.
3. The arm SHALL **assert `Heap Fetches: 0`** in its `EXPLAIN (ANALYZE, BUFFERS)` output. That
   an index built inside an open transaction still yields index-only scans within it is an
   INFERENCE with no citation behind it; asserting the counter converts the gap into evidence
   instead of leaving it as a premise.
4. The A/B SHALL be treated as a **shortlist filter**. The winning shape SHALL be committed and
   re-measured for the authoritative capture, and the harness SHALL run against a scratch
   database rather than anything shared.

#### Scenario: index-only scan is asserted, not assumed [evidence]

- **GIVEN** an index arm whose plan reports an index-only scan
- **WHEN** the arm's output is checked
- **THEN** `Heap Fetches: 0` is asserted and a non-zero value fails the arm rather than being reported as an index-only result

#### Scenario: the arm performs no writes on the measured table [static]

- **GIVEN** an arm transaction under measurement
- **WHEN** the statements it issues are inspected
- **THEN** none is an INSERT, UPDATE, or DELETE on the measured table, and the pre-transaction `VACUUM` is part of the recorded setup

#### Scenario: the shortlist winner is re-measured after it is committed [evidence]

- **GIVEN** an arm has won the in-transaction A/B
- **WHEN** the authoritative capture is taken
- **THEN** it is taken against the committed index, not inherited from the rollback arm

---

### Requirement: The remaining 58 are enumerated from the catalog with a count assertion **[MERGE-BLOCKING]**

The sweep SHALL enumerate the policies it rewrites from **`pg_policy` at migration time** — not
from a hardcoded list, and not from the migration files. The 61 live across 10 migrations, so a
file-derived or list-derived enumeration is how a policy is missed or a variant is deleted.

The migration SHALL assert that **rewritten count == found count** and SHALL fail rather than
commit a partial sweep. `AIPromptTemplate` SHALL be handled on an **explicit branch**; a generic
loop reusing the origin migration's table array is precisely the mechanism that would drop its
third disjunct silently.

#### Scenario: enumeration comes from the live catalog [static]

- **GIVEN** the sweep migration
- **WHEN** its enumeration source is inspected
- **THEN** it reads `pg_policy`, and no hardcoded table array stands in for the catalog

#### Scenario: a count mismatch aborts the migration [deploy-time]

- **GIVEN** the sweep rewrites fewer policies than it found
- **WHEN** the assertion runs
- **THEN** the migration raises and the transaction aborts — a partial sweep SHALL NOT commit

#### Scenario: the variant is never rewritten by the generic path [static]

- **GIVEN** the sweep migration
- **WHEN** the `AIPromptTemplate` handling is inspected
- **THEN** it is an explicit branch producing the 3-arm form, and it is excluded from the generic rewrite

---

### Requirement: Every rewritten policy carries its own EXPLAIN evidence **[MERGE-BLOCKING]**

The trio's verdict SHALL NOT be inherited by the other 58. One measured case in this repo
already showed the wrapper CHANGING the chosen index, and no external source explains that, so
the possibility that a rewrite moves a plan is live and unbounded by literature.

Each rewritten policy SHALL therefore carry per-policy `EXPLAIN` evidence recorded before and
after. A plan that MOVES SHALL be recorded as a finding with an adjudication; it SHALL NOT be
omitted because the row set was unchanged.

#### Scenario: per-policy before/after is captured for the sweep [evidence]

- **GIVEN** the 58 plus the variant have been rewritten
- **WHEN** the evidence artifact is inspected
- **THEN** each policy has its own before/after plan recorded, and none is covered only by the trio's result

#### Scenario: a moved plan is a recorded finding [evidence]

- **GIVEN** a rewritten policy whose plan selects a different index or node type than before
- **WHEN** the evidence is reported
- **THEN** the move is named explicitly with its adjudication

---

### Requirement: The form-uniformity gate reads the catalog, treats a NULL `with_check` as compliant, and is born red **[MERGE-BLOCKING]**

A gate that reads migration files measures intent; only a gate that reads the catalog measures
the deployed truth — the same dead-scope lesson this repo's fitness checks already encode. The
form-uniformity gate SHALL therefore read `pg_policies`, and SHALL match a **normalized**
rendering read back from this project's own PostgreSQL 16.14 catalog. It SHALL NOT byte-compare
against migration SQL: `pg_get_expr` normalizes casts, spacing, and subquery aliases, so the
exact rendered form SHALL be read back before the gate's pattern is written.

A **NULL `with_check` SHALL be treated as COMPLIANT**, because an unspecified `WITH CHECK`
inherits the `USING` expression by specification. A gate demanding a non-null `with_check` would
red-line correct policies. The 3-arm variant SHALL likewise PASS.

The gate SHALL live in the **integration tier** — `relrowsecurity`-class facts and rendered
policy text are database state that no grep can read — SHALL be named in a `run_batch` so it
actually executes (fitness #30's reachability rule), and SHALL run on every PR against the
migrated Postgres service alongside the existing `pg_catalog` coverage gate. Per this repo's
rule that a new gate is born with its red demonstrated, a **bare policy SHALL be planted**, the
suite observed to fail with a REAL non-zero exit (an annotation or log line alone leaves the job
green and proves nothing), the planted state restored, and the suite re-confirmed green — and
that demonstration SHALL be recorded. The gate SHALL name SMELL-91's `scripts/` typecheck gap as
a known, unfixed limit rather than leaving it unstated.

#### Scenario: a uniform catalog passes [integration]

- **GIVEN** all 61 policies are in the canonical form
- **WHEN** the form-uniformity gate runs
- **THEN** it reports uniform and exits zero, and the 3-arm variant is among the passing policies

#### Scenario: a planted bare policy produces a real non-zero exit [integration]

- **GIVEN** one policy is re-created in the bare form
- **WHEN** the suite runs
- **THEN** it FAILS with a real non-zero exit naming the offending policy, and after restoration the suite is re-confirmed green

#### Scenario: a policy with no `WITH CHECK` is compliant [integration]

- **GIVEN** an enrolled policy whose `with_check` is NULL and whose `qual` is in the canonical form
- **WHEN** the gate runs
- **THEN** the policy PASSES — a NULL `with_check` SHALL NOT be reported as a miss

#### Scenario: the gate is wired and reachable [static]

- **GIVEN** the gate suite exists
- **WHEN** `apps/api/scripts/run-tests.sh` and the Integration Tests job are inspected
- **THEN** the suite file is named in a `run_batch` and runs on every PR — a suite no batch names SHALL NOT be counted as the gate

---

### Requirement: The Post index shape is chosen FROM measurement and recorded as measured **[MERGE-BLOCKING]**

The index shape SHALL be selected from a measured comparison of the arms **{as-shipped,
`+createdAt` extension, `(accountId, createdAt)`, DROP}**, taken BEFORE any migration is
authored. **DROP is a legitimate outcome**, not a failure of the exercise: if the winner is
still net-negative against the as-shipped baseline, dropping is the measured answer.

The schema docblock SHALL be rewritten to state **what was measured**. It SHALL NOT restate the
reasoning the measurement contradicted — a justification written from reasoning and left
standing in the voice of a decision after the measurement disagreed is the exact defect this
capability exists to stop repeating.

The record SHALL state the index mechanics honestly: with only `accountId` equality-bound, the
scanned range of `(accountId, projectId, createdAt)` is ordered by `(projectId, createdAt)`, so
the extension **does not by itself** give ordered output for the account-wide feed — Incremental
Sort needs a leading key and B-tree skip scan is PostgreSQL 18 while this server is 16.14. The
record SHALL also carry the **single-corpus caveat**: the measurement rests on one shape
(100 projects × 10 000 posts, exactly 100 per project), which is the condition under which the
displaced index wins, and that caveat SHALL appear wherever the decision is recorded.

#### Scenario: the measurement precedes the migration [evidence]

- **GIVEN** the index migration
- **WHEN** its provenance is inspected
- **THEN** the arm comparison it cites was captured before the migration was authored, and the recorded command is re-runnable

#### Scenario: the docblock states the measurement, not the reasoning [static]

- **GIVEN** the schema index docblock after this change
- **WHEN** it is read
- **THEN** it states the measured outcome and its caveats, and no superseded reasoning-based justification survives in it

#### Scenario: DROP is an admissible recorded outcome [evidence]

- **GIVEN** every candidate arm measures net-negative against as-shipped
- **WHEN** the decision is recorded
- **THEN** the index is dropped and the record says so — a net-negative shape SHALL NOT be kept because it was already built

#### Scenario: the corpus caveat travels with the decision [static]

- **GIVEN** any artifact recording the index decision
- **WHEN** it is inspected
- **THEN** it names the single corpus shape the measurement rests on

---

### Requirement: Migrations are timeout-bounded, token-gated, reversible, and land with their schema edit **[MERGE-BLOCKING]**

Every migration in this change SHALL open by setting `lock_timeout` and `statement_timeout`
(the active `squawk require-timeout-settings` convention), because 61 `ACCESS EXCLUSIVE` locks
held to commit is a shape that needs a bounded failure mode rather than an unbounded wait.

Each migration and schema edit SHALL be performed under an explicit `sensitive-edit`
authorization per invocation. The `schema.prisma` edit and its migration SHALL land
**together**, or `migrate status` drifts.

The trio rewrite and the 58-policy sweep SHALL be **separate migrations**, so a red is
attributable to one of them. Each SHALL ship a down migration that re-creates the prior bare
form **verbatim**, and the index migration's down SHALL restore the as-shipped shape (the DROP
arm reversing the same way).

#### Scenario: every migration bounds its locks [static]

- **GIVEN** a migration authored by this change
- **WHEN** its first statements are read
- **THEN** it sets `lock_timeout` and `statement_timeout` before any DDL

#### Scenario: schema and migration land together [static]

- **GIVEN** the commit carrying the index shape change
- **WHEN** it is inspected
- **THEN** the `schema.prisma` edit and its migration are in that same commit, and `migrate status` reports no drift

#### Scenario: the down migration restores the prior form verbatim [integration]

- **GIVEN** a landed policy migration
- **WHEN** its down migration is applied
- **THEN** the affected policies are restored to their prior form, proven by comparing the policy tuple rather than `qual` alone
