# Tenant Key Integrity — Delta Spec (tenant-isolation-composite-fk / Slice 1 + Slice 2)

> **NEW capability** for change `tenant-isolation-composite-fk`. Capability: **a row whose
> tenant key diverges from its parent's is UNWRITABLE — refused by the database engine, not
> detected after the fact by a reconciliation job, a fitness grep, or a code review.**
>
> The mechanism is decision **A′**, already signed: denormalized `accountId` on the child,
> `UNIQUE (id, accountId)` on the parent, and a composite foreign key
> `FOREIGN KEY (parentFk, accountId) REFERENCES parent(id, accountId)` on the child. The
> chain propagates locally — each table references its IMMEDIATE parent including the tenant
> column — and anchors in `Project`, then `Account`.
>
> **Why this capability is separate from `rls-enforcement`.** Referential integrity checks
> **always bypass row security** (PostgreSQL, Row Security Policies). The composite FK
> therefore holds whether or not RLS is configured correctly — it is the one guarantee in
> this change that does not depend on the Slice 0 red being cleared. That independence SHALL
> be stated wherever the two are reported together, and it SHALL NOT be used to imply that
> RLS is fixed.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the PR of the slice that owns them.
>
> **Scenario tags** are as defined in the `rls-enforcement` delta of this change: `[static]`,
> `[integration]`, `[deploy-time]`, and `[evidence]` (a real-DB run whose OUTPUT is recorded
> as a durable artifact; satisfied by CAPTURING the measurement, failed by asserting it).
>
> **Non-goals (from the proposal — explicit, not open here):**
>
> | Out of scope                                     | Reason                                                                                                                                                                   |
> | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | Composite PRIMARY keys (`@@id([accountId, id])`) | Explicitly rejected by the signed decision. The unique-constraint form buys the same guarantee without touching single-column PKs across 125 models — that IS the point. |
> | Sweeping all 65 keyless models                   | Slice 2 delivers the CLASSIFICATION only. Migrating the classified subset is follow-up work sized by that deliverable.                                                   |
> | Moving a `Project` between accounts              | Stays an explicit cascade migration. The noisy failure is the intended behavior.                                                                                         |

---

## ADDED Requirements

### Requirement: A row whose tenant key diverges from its parent's cannot be written **[MERGE-BLOCKING]**

For every enrolled child, an INSERT or UPDATE that sets `accountId` to a value differing from
its immediate parent's `accountId` SHALL be **refused by the database with a foreign-key
violation**. The refusal SHALL come from the engine, not from application code: it SHALL hold
for the raw client, inside a transaction, from a migration, from a seed, and from `psql` —
any path that reaches the table.

This is the requirement that dissolves the objection which motivated the whole investigation
("a denormalized column can drift and nothing detects it"). It is true of naive
denormalization and FALSE here. Every write path that "forgets" the tenant column fails
LOUDLY at INSERT — the opposite of silent drift.

#### Scenario: a divergent accountId is refused — the FK-violation proof [integration]

- **GIVEN** a `Project` owned by tenant A and a `Post` insert naming that project
- **WHEN** the insert supplies tenant B's `accountId`
- **THEN** the statement FAILS with a foreign-key violation, NO row is persisted, and the failure is raised by PostgreSQL — not by a use case, a guard, or a validator

#### Scenario: the refusal survives every access path [integration]

- **GIVEN** the composite FK is validated
- **WHEN** the same divergent write is attempted through the raw Prisma client, inside an explicit transaction, and via direct SQL
- **THEN** each path fails identically with a foreign-key violation — no path writes the row

#### Scenario: the refusal is independent of RLS configuration [integration]

- **GIVEN** the app role still carries `BYPASSRLS` (the Slice 0 red is not yet cleared)
- **WHEN** the divergent write is attempted
- **THEN** it STILL fails with a foreign-key violation — the guarantee does not depend on row security being enforced

#### Scenario: a consistent write succeeds unchanged [integration]

- **GIVEN** a `Post` insert whose `accountId` equals its project's `accountId`
- **WHEN** the insert runs
- **THEN** it succeeds, and the persisted row satisfies `accountId == project.accountId`

---

### Requirement: The tenant column is a single, non-nullable column that participates in the composite FK **[MERGE-BLOCKING]**

The guarantee holds only if the column the guard reads and the column the FK constrains are
the **SAME** column. Therefore, for every enrolled child:

1. the tenant key SHALL be exactly ONE column (`accountId`) — there SHALL NOT be a second,
   independently-writable tenant column that the FK does not constrain, because two columns
   can diverge and the divergence would be invisible to both the guard and the engine;
2. that column SHALL be `NOT NULL` once the migration completes;
3. the parent-reference column(s) participating in the composite FK SHALL be `NOT NULL`.

Item 3 closes the **`MATCH SIMPLE` escape**: PostgreSQL's default match type does NOT enforce
a composite FK when any referencing column is NULL, so a nullable parent reference would let a
row slip past the constraint entirely. Nullability SHALL be verified **per table** at
enrollment — it is not inheritable from a sibling table's verification.

#### Scenario: one tenant column, constrained by the FK [static]

- **GIVEN** an enrolled child model
- **WHEN** `schema.prisma` and the generated migration are inspected
- **THEN** the model carries exactly one tenant column, that column appears in the composite FK's referencing column list, and no second tenant-bearing column exists outside the constraint

#### Scenario: no referencing column is nullable — the MATCH SIMPLE escape is closed [static]

- **GIVEN** an enrolled child model
- **WHEN** the composite FK's referencing columns are inspected
- **THEN** every one of them is `NOT NULL`, and this is verified for THAT table rather than inferred from another enrolled table

#### Scenario: a NULL parent reference cannot be used to escape the constraint [integration]

- **GIVEN** an enrolled child whose referencing columns are non-nullable
- **WHEN** an insert attempts to leave a referencing column NULL
- **THEN** the insert fails on the `NOT NULL` constraint — it does NOT succeed as an unconstrained row

---

### Requirement: Parents carry a TOTAL `UNIQUE (id, accountId)` that coexists with the partial soft-delete uniques **[MERGE-BLOCKING]**

A composite FK requires its referenced columns to form a primary key, a unique constraint, or
a non-partial unique index. Therefore every parent in the chain SHALL carry a **TOTAL** (not
partial, not filtered) `UNIQUE (id, accountId)`.

This constraint SHALL coexist with the existing partial uniques introduced by the soft-delete
work (`WHERE deletedAt IS NULL` on `Account.email` and `Project(accountId, name)`) without
weakening either. Because soft-deleted rows still EXIST, children referencing a soft-deleted
parent keep their referential integrity — the FK does not break on soft delete. A partial
unique index SHALL NOT be used as the FK target, because PostgreSQL does not accept one.

#### Scenario: the parent's unique constraint is total, not partial [static]

- **GIVEN** a parent in the composite-FK chain
- **WHEN** its migration is inspected
- **THEN** it declares `UNIQUE (id, accountId)` with NO `WHERE` clause, and that constraint is the FK's target

#### Scenario: the existing partial soft-delete uniques still hold [integration]

- **GIVEN** the total unique constraint has been added
- **WHEN** the pre-existing partial-unique invariants are exercised (duplicate live `Account.email`, duplicate live `Project(accountId, name)`)
- **THEN** each is still rejected, and a soft-deleted row still does NOT block reuse of its name or email

#### Scenario: a child survives its parent being soft-deleted [integration]

- **GIVEN** an enrolled child referencing a live parent
- **WHEN** the parent is soft-deleted
- **THEN** the child's composite FK remains satisfied and the child row is neither orphaned nor removed by the constraint

---

### Requirement: Backfill integrity — zero NULL, zero divergent, zero rows lost **[MERGE-BLOCKING]**

Every pre-existing row SHALL receive its `accountId` derived from its immediate parent's
`accountId` BEFORE the `SET NOT NULL` flip and BEFORE the FK is validated. After the backfill:

- the count of rows with NULL `accountId` SHALL be **0**;
- every row SHALL satisfy `accountId == <immediate parent>.accountId`;
- the pre-migration row count SHALL be preserved — zero rows dropped, zero orphaned.

**Soft-deleted rows SHALL be backfilled too.** They still exist, they still carry children,
and the composite FK constrains them like any other row; skipping them would leave rows that
the later `SET NOT NULL` cannot accept. Any TypeScript read this change adds over a swept
soft-delete model (`post`, `project`) SHALL either carry its `deletedAt` filter or the
greppable deliberate marker required by fitness **#38** — a backfill read that must see
soft-deleted rows is exactly the marker's purpose, not an exemption from it.

Verification SQL SHALL respect fitness **#23**: it runs inside a Unit of Work or an explicit
`withSystemContext()` wrap, not as an unsanctioned raw query bypassing the tenant guard.

#### Scenario: no row survives the migration with a NULL or divergent tenant key [integration]

- **GIVEN** rows exist for several tenants before the migration, including soft-deleted rows
- **WHEN** the backfill runs and `SET NOT NULL` is applied
- **THEN** the NULL count is **0**, every row satisfies `accountId == <parent>.accountId`, and the row count is unchanged

#### Scenario: a residual NULL halts the migration rather than shipping a hole [deploy-time]

- **GIVEN** a row the backfill could not resolve (e.g. an unexpected orphan)
- **WHEN** the migration reaches the `SET NOT NULL` stage
- **THEN** it HALTS with an in-transaction `RAISE`, no partial state is committed, and the offending rows are surfaced for remediation — the column SHALL NOT be flipped over an unresolved row

#### Scenario: the backfill reads declare their soft-delete intent [static]

- **GIVEN** the change adds reads over `post` or `project`
- **WHEN** fitness #38's scan runs over them
- **THEN** each read either carries its `deletedAt` filter or the greppable deliberate marker, and the swept-tree count stays at zero

---

### Requirement: The migration is staged so every stage is safe to stop at, and no stage takes an unbounded lock **[MERGE-BLOCKING]**

Adding a foreign key takes an `AccessExclusive` lock on BOTH tables; a measured precedent
(GoCardless) recorded 15 seconds of API downtime when such a migration collided with a long
`SELECT`. The migration SHALL therefore be staged so that:

1. each stage runs in its own transaction with a budgeted `lock_timeout`, so a collision FAILS
   FAST rather than queueing behind a long read and stalling the API;
2. the backfill runs in **batches** — a single-pass `UPDATE` over the whole table is
   explicitly warned against and SHALL NOT be used;
3. the FK is added `NOT VALID` first and validated with a separate `VALIDATE CONSTRAINT`, so
   the blocking window is bounded and separable;
4. **every stage is safe to stop at**, and each stage is individually revertible in reverse
   order: the nullable-column stage carries no application dependency; a `NOT VALID` FK drops
   without a table rewrite; `UNIQUE (id, accountId)` drops independently of the partial
   uniques; dropping the column reverts the schema fully.

#### Scenario: each stage is separately revertible in reverse order [static]

- **GIVEN** the migration set is complete
- **WHEN** the stages and their down-migrations are inspected
- **THEN** each stage has a down path that reverts only itself, and applying the down paths in reverse order returns the schema to its pre-change state

#### Scenario: a lock collision fails fast instead of stalling the API [deploy-time]

- **GIVEN** a long-running read holds a conflicting lock when the FK stage begins
- **WHEN** the stage attempts its `AccessExclusive` acquisition
- **THEN** it aborts on the budgeted `lock_timeout` and the migration reports the collision — it SHALL NOT wait unbounded and block application traffic behind it

#### Scenario: the backfill is batched, not single-pass [static]

- **GIVEN** the backfill migration
- **WHEN** its SQL is inspected
- **THEN** it processes rows in bounded batches, and no stage performs a single unbounded `UPDATE` over the full table

#### Scenario: dropping the column leaves the enrollment gate green [static]

- **GIVEN** the full rollback has been applied
- **WHEN** fitness #39 runs
- **THEN** it is green — the bearing column is gone together with its enrollment, so no model is left accountId-bearing and unenrolled

---

### Requirement: Index cost is paid by demonstration, not in bulk **[MERGE-BLOCKING]**

`Post` today carries seven partial indexes, all led by `projectId`. Adding a tenant-leading
index is not free, and the authority on this point recommends paying for such indexes **by
demonstration, not in bulk** — PostgreSQL 16 has no B-tree skip scan to make a
`(accountId, projectId)` index also serve `projectId`-only queries.

Therefore `EXPLAIN ANALYZE` SHALL be captured on the **hot `Post` listing paths BEFORE and
AFTER** the change, on representative data, and both captures SHALL be recorded as durable
artifacts alongside the exact queries and the data shape. A plan that regresses SHALL be
reported as a finding with its adjudication — never omitted.

#### Scenario: before/after plans are captured on the hot listings [evidence]

- **GIVEN** representative `Post` data and the identified hot listing queries
- **WHEN** each query is run under `EXPLAIN ANALYZE` before the change and again after
- **THEN** both plans are recorded with the query text, row counts, and timings, and the recorded commands are re-runnable

#### Scenario: a regression is reported, not filtered out of the artifact [evidence]

- **GIVEN** an after-plan that is worse than its before-plan
- **WHEN** the evidence is reported
- **THEN** the regression appears in the artifact with its adjudication (index added, query reshaped, or accepted with a stated reason) — the artifact SHALL NOT contain only the favorable comparisons

#### Scenario: no index is added without a plan that justifies it [static]

- **GIVEN** the set of indexes this change adds
- **WHEN** each is traced to the evidence artifact
- **THEN** each is justified by a captured plan (it serves the composite FK, the RLS policy, or a measured read), and no tenant-leading index is added speculatively across tables that did not demonstrate the need

---

### Requirement: The A′-vs-B′ measurement is recorded on the three query shapes **[MERGE-BLOCKING]**

B′ — the decorrelated set-membership RLS policy
(`"projectId" IN (SELECT p.id FROM "Project" p WHERE p."accountId" = current_setting(...))`)
— is the cheapest alternative to try and is **unmeasured, not measured-and-failed**. While the
representative data is mounted for the index evidence above, A′ and B′ SHALL be measured
against each other on `Post`, under `EXPLAIN ANALYZE`, on exactly the **three query shapes
that matter**:

| Shape                               | Why it is in the set                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Point read by ID                    | The cheapest, most frequent access; where a policy's per-row cost is least visible. |
| Listing filtered by `projectId`     | The dominant product read; where an index-leading choice decides.                   |
| Listing with no selective predicate | Where B-family policies are known to degrade — the case that decides.               |

The result SHALL be RECORDED whatever it says. If B′ measures well AND the Slice 2 triage
returns substantially more than three tenant-owned tables, the recorded measurement is the
input to revisiting the per-table choice — A′ and B′ are **not mutually exclusive per table**.
This requirement is satisfied by the measurement being captured and recorded; it is NOT
satisfied by a claim about which option is faster.

#### Scenario: both options are measured on all three shapes [evidence]

- **GIVEN** representative `Post` data with a realistic number of projects per account
- **WHEN** each of the three query shapes is run under `EXPLAIN ANALYZE` under A′ and under B′
- **THEN** six plans are recorded with their timings, the data shape (rows, projects per account) is recorded alongside them, and the commands are re-runnable

#### Scenario: an unfavorable result for A′ is recorded, not discarded [evidence]

- **GIVEN** B′ measures better than A′ on one or more shapes
- **WHEN** the measurement is reported
- **THEN** that result is recorded plainly, together with the note that the structural integrity guarantee is A′-only and is not something B′ provides at any speed — the decision is informed by the number, not overturned by it silently

---

### Requirement: The 65 keyless models are CLASSIFIED by the Buffer discriminator — this deliverable is a triage, not a sweep **[MERGE-BLOCKING]**

No published playbook exists for retrofitting tenant keys across dozens of tables, and the
actionable number is not 65 — it is **"how many of the 65 are tenant-owned"**, which nobody
has computed. Computing it IS the deliverable.

Every one of the 65 models carrying no tenant key SHALL receive **exactly one** classification,
with a recorded rationale, using the published discriminator: _can this entity exist before its
container, or be orphaned from its ownership path?_

| Classification                          | Criterion                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Needs its own key**                   | It can exist before its container, OR its parent reference is nullable, OR some route reaches it without loading the parent first.         |
| **Covered by composite-FK inheritance** | It cannot exist without its parent AND every route passes through the parent — the chain already covers it, and the column is unnecessary. |
| **Legitimately global**                 | It is a reference/global table by design and deliberately carries no tenant key.                                                           |

The deliverable SHALL state the resulting COUNT per classification, and SHALL migrate
**nothing** — migrating the classified subset is follow-up work that this deliverable sizes.

#### Scenario: every keyless model is classified exactly once, with a reason [static]

- **GIVEN** the classification deliverable
- **WHEN** it is compared against the set of models in `schema.prisma` carrying no tenant key
- **THEN** the two sets match exactly, each model carries exactly one of the three classifications, and each carries a recorded rationale referencing the discriminator — no model is left unclassified or classified twice

#### Scenario: the actionable count is stated [static]

- **GIVEN** the classification is complete
- **WHEN** the deliverable is read
- **THEN** it states how many models fall in each class, so the follow-up work is sized by a number rather than by the undifferentiated 65

#### Scenario: the triage migrates nothing [static]

- **GIVEN** the triage slice is complete
- **WHEN** its diff is inspected
- **THEN** it contains no schema migration for the classified models — the deliverable is the classification, and a sweep disguised as a triage does not satisfy this requirement

#### Scenario: a "covered by inheritance" claim is checked against a real path [static]

- **GIVEN** a model classified as covered by composite-FK inheritance
- **WHEN** its access paths are enumerated
- **THEN** every enumerated path resolves the parent first, and the rationale names those paths — the classification SHALL NOT rest on the assumption that no such path exists
