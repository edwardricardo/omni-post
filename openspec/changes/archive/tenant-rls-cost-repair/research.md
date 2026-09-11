# Research: tenant-rls-cost-repair

> Scope: external, source-backed evidence only. Complements
> `openspec/changes/tenant-rls-cost-repair/explore.md`; does not re-derive it. Target
> engine: PostgreSQL **16.14**.
>
> **Source-quality tiers used below:** **T1** PostgreSQL official docs / PostgreSQL source /
> release notes · **T2** pgsql-hackers or maintainer material · **T3** established
> engineering orgs (Supabase, pganalyze, Citus, Crunchy Data, use-the-index-luke,
> PlanetScale, dian m fay) · **T4** other independent blogs.

---

## Lane 1 — The `(SELECT current_setting(...))` idiom for RLS policies

### 1a. Is a bare stable call in a policy qual re-evaluated per row?

**Finding.** Yes, and the documentation gives the precise mechanism: a policy expression is
defined to be evaluated per row, and the `STABLE` volatility guarantee of "optimize
multiple calls into a single call" is explicitly scoped by the docs to _index scan
conditions_ — it is not a promise to hoist the call out of a general qual Filter. Our
measured shape (17× Filter, 0× Index Cond) is exactly the case the guarantee does not
cover.

**Evidence.**

| Citation                                                                                                       | What it says                                                                                                                                                                                                                                                                                                                                                                                                          | Tier   |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [PG 16 §5.9 Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)                    | "This expression will be evaluated for each row prior to any conditions or functions coming from the user's query." The only exception named is `leakproof` functions, which "the optimizer may choose to apply … ahead of the row-security check."                                                                                                                                                                   | **T1** |
| [PG 16 §38.7 Function Volatility Categories](https://www.postgresql.org/docs/16/xfunc-volatility.html)         | `STABLE`: "This category allows the optimizer to optimize multiple calls of the function to a single call. **In particular, it is safe to use an expression containing such a function in an index scan condition.** (Since an index scan will evaluate the comparison value only once, not once at each row …)" — the single-evaluation property is stated for the index-scan-condition case, not for a Filter qual. | **T1** |
| [PlanetScale — _RLS sounds great until it isn't_](https://planetscale.com/blog/rls-sounds-great-until-it-isnt) | "RLS policies are generally executed per row"; and directly on volatility: "When using RLS however, Postgres does not cache the value when evaluating the policy on each row during queries."                                                                                                                                                                                                                         | **T3** |
| [dian m fay — _fixing slow row-level security policies_](https://di.nmfay.com/rls-performance)                 | Without InitPlan extraction, policies using `current_setting` force re-evaluation "for each candidate record" — "a million loops" executed once per row.                                                                                                                                                                                                                                                              | **T3** |

**Implication for this change.** The proposal can assert the per-row cost from the
specification itself, not only from our A/B: the documented contract never promised
hoisting for a disjunctive Filter qual, so the 17×-Filter measurement is the expected
behaviour, not an anomaly or a version quirk.

**Confidence: high.**

### 1b. Is the `(SELECT ...)` wrapper recognized/recommended practice, and does it produce an InitPlan?

**Finding.** Yes. The wrapper converts an uncorrelated expression subselect into an
InitPlan node evaluated once per execution; this is Supabase's documented recommendation,
is enforced by a production linter they run against every project (which explicitly names
`current_setting(%)`, not only their own `auth.*` helpers), and is independently described
by two engineering write-ups.

**Evidence.**

| Citation                                                                                                                                                              | What it says                                                                                                                                                                                                                                                             | Tier   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [PostgreSQL source, `src/include/nodes/plannodes.h` (REL_16_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/include/nodes/plannodes.h) | Plan struct field comment: `initPlan; /* Init Plan nodes (un-correlated expr subselects) */` — the node class is defined for exactly the shape the wrapper creates.                                                                                                      | **T1** |
| [Supabase Docs — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)                                                                          | "Wrapping the function causes an `initPlan` to be run by the Postgres optimizer, which allows it to 'cache' the results **per-statement**, rather than calling the function on each row."                                                                                | **T3** |
| [Supabase Troubleshooting — _RLS Performance and Best Practices_](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)         | Same mechanism, plus measured deltas: `auth.uid()` 179 ms → 9 ms; an `is_admin()` helper 11,000 ms → 7 ms; a `has_role()` helper 178,000 ms → 12 ms.                                                                                                                     | **T3** |
| [Supabase `splinter` lint `0003_auth_rls_initplan.sql`](https://raw.githubusercontent.com/supabase/splinter/main/lints/0003_auth_rls_initplan.sql)                    | Flags bare calls across five patterns, **including `current_setting(%)`**, in both `qual` and `with_check`. Detail message: "This produces suboptimal query performance at scale. Resolve the issue by replacing `auth.<function>()` with `(select auth.<function>())`." | **T3** |
| [Supabase database linter `0003_auth_rls_initplan`](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)                            | Remediation: rewrite `using ( auth.uid() = creator_id )` to `using ( (select auth.uid()) = user_id )`, which "executes the function only once and reuses the result for all row comparisons."                                                                            | **T3** |
| [dian m fay](https://di.nmfay.com/rls-performance)                                                                                                                    | Wrapping stable calls in `select` lets the planner "extract them as InitPlans — execution units that run exactly once and cache their results"; the inner `current_setting` becomes an InitPlan referenced through a parameter node.                                     | **T3** |

**Implication for this change.** Our in-house 4-arm A/B (~2.1–2.4× on the same scan node)
is _lower_ than the published headline numbers, which is consistent and unsurprising:
`current_setting()` is a cheap C function, whereas Supabase's largest deltas came from
wrapping SQL helper functions that themselves query tables. The proposal should present
~2.1–2.4× as the honest, self-measured figure and cite the external material only for the
mechanism, never for the magnitude.

**Confidence: high.**

### 1c. Known caveats: correctness precondition, plan caching, leakproof/security, regression potential

**Finding.** One correctness precondition applies and our expression satisfies it. The
documented sub-SELECT hazard for RLS policies is about consulting _other rows or tables_
and therefore does not apply to a table-free `current_setting()` subselect. Plan-cache
interaction is benign because an InitPlan runs once **per execution**, not once per cached
plan. No source was found asserting that the idiom can regress a plan — so our observed S2
index flip is unexplained by literature and remains a measurement obligation.

**Evidence.**

| Citation                                                                                                                                                                             | What it says                                                                                                                                                                                                                                                                                                                                                                                                                        | Tier   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [Supabase Troubleshooting](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)                                                               | The precondition: "You can only do this if the results of the query or function do not change based on the row data."                                                                                                                                                                                                                                                                                                               | **T3** |
| [PG 16 §5.9](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)                                                                                                                | "the policy expressions consider only the current values in the row to be accessed or updated. **This is the simplest and best-performing case** … If it is necessary to consult other rows or other tables … that can be accomplished using sub-`SELECT`s … Be aware however that such accesses can create race conditions that could allow information leakage." The hazard is explicitly scoped to consulting other rows/tables. | **T1** |
| [PostgreSQL source, `src/include/utils/plancache.h` (REL_16_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/include/utils/plancache.h)                | `CachedPlanSource.dependsOnRLS` ("is rewritten query specific to the above?"), `CachedPlan.dependsOnRole` and `planRoleId` — RLS-dependent cached plans are tracked and scoped to the role they were planned for. (Header is thin; it defers: "See plancache.c for comments.")                                                                                                                                                      | **T1** |
| [PG 16 §5.9](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)                                                                                                                | "Policy expressions are run as part of the query and with the privileges of the user running the query"; superusers and `BYPASSRLS` roles bypass entirely; referential-integrity checks "always bypass row security."                                                                                                                                                                                                               | **T1** |
| [dian m fay](https://di.nmfay.com/rls-performance)                                                                                                                                   | `current_setting` "is not leakproof," which is why isolating it in its own `select` turns it from an inlining obstacle into an independently optimizable boundary. Also names the residual ceiling: even optimized, expect "not-quite-double the duration" versus an unpolicied query, "because we have to perform double the tests" in index conditions.                                                                           | **T3** |
| [pganalyze — _5mins E28: RLS, security invoker views, LEAKPROOF_](https://pganalyze.com/blog/5mins-postgres-row-level-security-bypassrls-security-invoker-views-leakproof-functions) | Non-`LEAKPROOF` functions must be applied _after_ the row-security check; this "forces conservative query execution that bypasses optimizations," and the planner may ignore otherwise-useful indexes.                                                                                                                                                                                                                              | **T3** |

**Implication for this change.** Three concrete consequences. (i) The precondition is
satisfied — `current_setting('app.account_id', true)` has no row dependency, so the
rewrite is semantics-identical by construction, matching our measurement. (ii) The
wrapper's subselect touches no table, so it does **not** open the documented READ
COMMITTED information-leak channel; the proposal should say this explicitly, because "we
added a sub-SELECT to an RLS policy" otherwise reads as a security regression to a
reviewer who knows that warning. (iii) InitPlan is per-execution, so the idiom stays
correct under a pooled connection that re-reads `app.account_id` via `SET LOCAL` on every
transaction — a cached generic plan does not freeze the tenant id.

**Confidence: high on (i)–(iii); low on regression potential — no source found.**

---

## Lane 2 — Does the catalog rendering preserve the wrapper?

**Finding.** `pg_policies.qual` and `.with_check` are produced by `pg_get_expr()` over the
stored policy expression tree. Because InitPlan conversion is a _planner-time_
transformation and not a stored-rewrite, the `SubLink` survives into the stored tree and
is deparsed back as a `SELECT` subquery. Supabase's production linter depends on exactly
this round-trip, which is strong practical proof that a form-uniformity gate can
distinguish wrapped from bare.

**Evidence.**

| Citation                                                                                                                                                                            | What it says                                                                                                                                                                                                                                                                                                                  | Tier   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [PostgreSQL source, `src/backend/catalog/system_views.sql` (REL_16_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/catalog/system_views.sql) | `CREATE VIEW pg_policies AS SELECT … pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS qual, pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check FROM pg_catalog.pg_policy pol …`                                                                                                                         | **T1** |
| [PG 16 §53.15 `pg_policies`](https://www.postgresql.org/docs/16/view-pg-policies.html)                                                                                              | Column contract: `qual` = "The expression added to the security barrier qualifications for queries that this policy applies to"; `with_check` = "The expression added to the WITH CHECK qualifications …". Column set is identical across the 9.6 → 18 doc pages — no PG-16-specific caveat found.                            | **T1** |
| [Supabase `splinter` lint `0003`](https://raw.githubusercontent.com/supabase/splinter/main/lints/0003_auth_rls_initplan.sql)                                                        | Discriminates purely on the rendered text: `qual like '%auth.uid()%' and lower(qual) not like '%select auth.uid()%'` — i.e. a wrapped policy's rendered `qual` reliably contains the literal `select` token. The same predicate set is applied to `with_check`, and the monitored pattern list includes `current_setting(%)`. | **T3** |
| [dev.to — _76 RLS policies rewritten in one migration_](https://dev.to/arvavit/76-rls-policies-rewritten-in-one-migration-the-authuid-init-plan-trap-in-supabase-4hg)               | Corroborates the operational shape: the advisor "scans `pg_policies`, parses the `qual` and `with_check` expressions, and flags any direct `auth.<function>()` call that isn't wrapped." Reports a 76-policy single-migration sweep — same order of magnitude as our 61.                                                      | **T4** |

**Implication for this change.** A `pg_policies`-based form-uniformity gate is viable and
is the right shape for the fitness check (it reads the _catalog_, i.e. the deployed truth,
not the migration file — which is the same "dead scope" lesson fitness #2/#3/#4 and #36
already encode in this repo). But `pg_get_expr` **normalizes**: it adds explicit casts
(`'app.account_id'::text`), canonical spacing (`( SELECT …)`), and a result-column alias
on the subquery. The gate must therefore match a normalized pattern, never byte-compare
against migration SQL.

**Confidence: high on preservation; medium on the exact rendered byte sequence** — no
source pinned the alias/whitespace form, so read it back from our own PG 16.14 before
writing the gate regex (see Gaps).

---

## Lane 3 — B-tree ordering mechanics

**Finding.** On an index `(a, b, c)` with only `a` equality-bound, the scanned range is
ordered by `(b, c)` — so `ORDER BY c` is **not** satisfied by the index and a Sort is
required. Incremental Sort does not help, because it requires the input to already be
sorted by _leading_ keys of the requested ordering, and `c` is not a leading key of
`ORDER BY c` in that range. B-tree skip scan, which would let the planner jump over an
unbound middle column, arrives in PostgreSQL **18** — it does not exist on 16.14.

**Evidence.**

| Citation                                                                                                      | What it says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Tier   |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [PG 16 §11.4 Indexes and ORDER BY](https://www.postgresql.org/docs/16/indexes-ordering.html)                  | "only B-tree can produce sorted output"; "Consider a two-column index on `(x, y)`: this can satisfy `ORDER BY x, y` if we scan forward, or `ORDER BY x DESC, y DESC` if we scan backward."                                                                                                                                                                                                                                                                                                                                                                                                                                             | **T1** |
| [PG 16 §11.3 Multicolumn Indexes](https://www.postgresql.org/docs/16/indexes-multicolumn.html)                | "The exact rule is that equality constraints on leading columns, plus any inequality constraints on the first column that does not have an equality constraint, will be used to limit the portion of the index that is scanned." And: an index on `(a,b,c)` "could in principle be used for queries that have constraints on `b` and/or `c` with no constraint on `a` — but the entire index would have to be scanned, so in most cases the planner would prefer a sequential table scan." Constraints on rightmost columns "save visits to the table proper, but they do not reduce the portion of the index that has to be scanned." | **T1** |
| [PG 13 release notes — incremental sort](https://www.postgresql.org/docs/release/13.0/)                       | "If an intermediate query result is known to be sorted by one or more **leading keys** of a required sort ordering, the additional sorting can be done considering only the remaining keys, if the rows are sorted in batches that have equal leading keys." Controlled by `enable_incremental_sort`.                                                                                                                                                                                                                                                                                                                                  | **T1** |
| [PG 18 release notes — skip scan](https://www.postgresql.org/docs/release/18.0/)                              | "Allow skip scans of btree indexes (Peter Geoghegan) — This allows multi-column btree indexes to be used in more cases such as when there are no restrictions on the first or early indexed columns (or there are non-equality ones), and there are useful restrictions on later indexed columns."                                                                                                                                                                                                                                                                                                                                     | **T1** |
| [use-the-index-luke — Indexed ORDER BY](https://use-the-index-luke.com/sql/sorting-grouping/indexed-order-by) | "SQL queries with an `order by` clause do not need to sort the result explicitly if the relevant index already delivers the rows in the required order"; "For this optimization, it is sufficient that the scanned index range is sorted according to the `order by` clause" — equality-bound leading columns fix a constant prefix, and the _following_ columns then determine the range's order.                                                                                                                                                                                                                                     | **T3** |

**Implication for this change.** The proposal's justification for extending
`(accountId, projectId)` → `(accountId, projectId, createdAt)` must state which win it is
buying, and it is **not** ordering for an account-wide feed. With only `accountId` bound,
`createdAt` buys range narrowing on a date predicate and heap-fetch avoidance (covering),
while the Sort remains. Pipelined `ORDER BY createdAt` requires _either_ `projectId` also
equality-bound (then `(accountId, projectId, createdAt)` is ordered) _or_ the
`(accountId, createdAt)` arm. That is precisely why the explore plan's three-arm
measurement — extend, `(accountId, createdAt)`, DROP — is the correct design rather than a
formality: the arms buy different things and only the real query shape decides.

**Confidence: high.**

---

## Lane 4 — `CREATE INDEX` inside a transaction, and index-only scans in a rollback harness

**Finding.** Non-`CONCURRENTLY` `CREATE INDEX` is explicitly transactional, so the
forced-rollback A/B harness is legal. Index-only-scan eligibility depends on the **heap's**
visibility map, not on the index's age, and `CREATE INDEX` itself refreshes
`pg_class.relallvisible` — so a harness arm sees IOS costing derived from VM state
established _before_ the transaction. The harness is representative **provided it performs
no DML on the measured table inside the transaction**, because any write clears VM bits
for the touched pages.

**Evidence.**

| Citation                                                                                         | What it says                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tier   |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [PG 16 `CREATE INDEX`](https://www.postgresql.org/docs/16/sql-createindex.html)                  | "a regular `CREATE INDEX` command can be performed within a transaction block, but `CREATE INDEX CONCURRENTLY` cannot."                                                                                                                                                                                                                                                                                                                       | **T1** |
| [PG 16 `CREATE INDEX`](https://www.postgresql.org/docs/16/sql-createindex.html)                  | "Normally PostgreSQL locks the table to be indexed against writes and performs the entire index build with a single scan of the table. Other transactions can still read the table, but if they try to insert, update, or delete rows in the table they will block until the index build is finished."                                                                                                                                        | **T1** |
| [PG 16 §11.9 Index-Only Scans](https://www.postgresql.org/docs/16/indexes-index-only-scans.html) | "An index-only scan, after finding a candidate index entry, checks the visibility map bit for the corresponding heap page. If it's set, the row is known visible and so the data can be returned with no further work." The VM is a per-heap-page structure; "In most situations the visibility map remains cached in memory all the time." Index-only scans are effective for "tables in which a large fraction of the rows are unchanging." | **T1** |
| [PG 16 §52.11 `pg_class`](https://www.postgresql.org/docs/16/catalog-pg-class.html)              | `relallvisible`: "Number of pages that are marked all-visible in the table's visibility map. This is only an estimate used by the planner. **It is updated by VACUUM, ANALYZE, and a few DDL commands such as CREATE INDEX.**" (Same wording for `relpages` and `reltuples`.)                                                                                                                                                                 | **T1** |

**Implication for this change.** Four concrete harness requirements fall out. (1) Use
plain `CREATE INDEX`, never `CONCURRENTLY` — the latter would abort the
transaction-scoped design outright. (2) The harness must **not** insert/update/delete on
the measured table inside the arm transaction; seeding must happen before, followed by
`VACUUM` (which cannot run inside a transaction block) so the VM matches the production
shape it is standing in for. (3) `ANALYZE` may run inside the transaction; combined with
`CREATE INDEX`'s own `relallvisible` refresh, the planner's IOS costing in-arm reflects
real pre-transaction visibility. (4) The arm build takes a write-blocking lock and each
rollback leaves catalog churn, so the harness belongs on a scratch database with a
`lock_timeout`, not on anything shared.

**Confidence: high on transactionality, locking, and the VM/`relallvisible` mechanics;
medium-high on the composite claim** that an index created in an open transaction yields
index-only scans within it. **No source found** stating that in one sentence — it is an
inference from (i) the index being catalog-visible to its creating transaction and (ii)
IOS eligibility being a property of the heap VM. The harness must therefore _assert_
`Heap Fetches: 0` in the `EXPLAIN (ANALYZE, BUFFERS)` output rather than assume it, which
also converts this gap into evidence.

---

## Lane 5 — `WITH CHECK` evaluation semantics

**Finding.** `WITH CHECK` fires on new rows for `INSERT` and `UPDATE` (and `MERGE`), after
`BEFORE` triggers and before any other constraint; a false/null result raises an error
rather than silently filtering. Its cost is per new row, so the InitPlan win is negligible
for single-row writes and material only for multi-row writes. That the wrapper benefits
`WITH CHECK` the same way is ecosystem-corroborated but **not** documented by PostgreSQL.

**Evidence.**

| Citation                                                                                                                     | What it says                                                                                                                                                                                                                                                                                                                                | Tier   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [PG 16 `CREATE POLICY`, Table 292](https://www.postgresql.org/docs/16/sql-createpolicy.html)                                 | `SELECT`/`DELETE` use `USING` to filter existing rows; `INSERT` uses `WITH CHECK` on the new row; `UPDATE` uses `USING` to filter existing rows **and** `WITH CHECK` on the new row. `USING` false/null ⇒ row silently suppressed; `WITH CHECK` false/null ⇒ **error is thrown**. `WITH CHECK` "cannot have aggregate or window functions." | **T1** |
| [PG 16 `CREATE POLICY`](https://www.postgresql.org/docs/16/sql-createpolicy.html)                                            | "For `INSERT`, `UPDATE`, and `MERGE` statements, `WITH CHECK` expressions are enforced after `BEFORE` triggers are fired, and before any actual data modifications are made … **WITH CHECK expressions are enforced before any other constraints.**"                                                                                        | **T1** |
| [PG 16 §5.9](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)                                                        | If `WITH CHECK` is not explicitly specified it defaults to the same expression as `USING` (documented via the `account_managers` example, which "implicitly has: `WITH CHECK (manager = current_user)`").                                                                                                                                   | **T1** |
| [PG 16 `CREATE POLICY`](https://www.postgresql.org/docs/16/sql-createpolicy.html)                                            | An `UPDATE` that reads columns also needs `SELECT` rights, so "the appropriate `SELECT` or `ALL` policies will be applied **in addition to** the `UPDATE` policies" — the write path can evaluate more than one policy per row.                                                                                                             | **T1** |
| [Supabase `splinter` lint `0003`](https://raw.githubusercontent.com/supabase/splinter/main/lints/0003_auth_rls_initplan.sql) | Applies the identical wrapped/bare rule to `with_check` as to `qual`, over the same function set including `current_setting(%)` — i.e. the ecosystem treats the two clauses as one optimization surface.                                                                                                                                    | **T3** |

**Implication for this change.** Two consequences for the 61-policy sweep. (i) Policies
declared with `USING` only inherit `WITH CHECK` from `USING`, so rewriting `USING`
rewrites the effective write-path predicate for free — and the uniformity gate must
therefore treat a `NULL` `with_check` as **compliant**, not as a miss, or it will red-line
correct policies. (ii) The expected write-path gain is small on single-row inserts (one
evaluation either way) and concentrates on bulk `INSERT … SELECT` / bulk `UPDATE`; the
proposal should not claim a write-path speedup it has not measured. Note also that an
`UPDATE` under our policies evaluates `USING` _and_ `WITH CHECK` _and_ the applicable
`SELECT` policy — so the per-row multiplier on the write path is larger than on the read
path, which is an argument for rewriting both clauses rather than only `USING`.

**Confidence: high on semantics; medium on the InitPlan benefit transferring to
`WITH CHECK`** — no PostgreSQL source found; **no source found** for measured write-path
cost characteristics of RLS at all.

---

## Lane 6 — Multi-tenant index precedent

**Finding.** Tenant-leading composite indexes are established guidance: Citus makes
tenant-inclusive composite keys a structural requirement, Supabase states the
leading-column rule for policy-filtered columns, and the `(tenant_id, created_at DESC)`
feed shape is recommended explicitly — but only by an independent blog, not by a tier-1 or
tier-2 source. Crunchy Data's multi-tenant RLS article corroborates our _architecture_
(single application role + `current_setting` GUC) and says nothing about indexes.

**Evidence.**

| Citation                                                                                                                                   | What it says                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tier   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [Citus 13 — Multi-tenant Applications](https://docs.citusdata.com/en/stable/use_cases/multi_tenant.html)                                   | Primary and foreign key constraints must include the distribution column, "making primary and foreign keys composite by including `company_id`," because "what we really need there is to ensure uniqueness on a per-tenant basis." The design principle: "the resulting SQL … contains a `WHERE company_id = :value` clause on every table (including tables in JOIN queries)." Also demonstrates per-tenant _partial_ indexes for individual tenants' query patterns. | **T3** |
| [Citus — Choosing Distribution Column](https://docs.citusdata.com/en/v12.0/sharding/data_modeling.html)                                    | Tenant ID is the distribution column that "has been found to work well in practice" for multi-tenant applications; local per-shard performance still matters, so index on filtered columns and join keys.                                                                                                                                                                                                                                                               | **T3** |
| [Supabase Docs — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)                                               | "Add an index on every column your policies filter on," because the database evaluates policies against each candidate row; and "a column counts as indexed only when it comes **first** in a `btree` index."                                                                                                                                                                                                                                                           | **T3** |
| [Crunchy Data — _Row Level Security for Tenants in Postgres_](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres) | Recommends exactly our policy architecture: `CREATE POLICY event_session_user ON events TO application USING (org_id = NULLIF(current_setting('rls.org_id', TRUE), '')::uuid);` — one application role, tenant selected by a session GUC. **Contains no index guidance and no per-row cost discussion** — stated plainly rather than stretched.                                                                                                                         | **T3** |
| [theroadtoenterprise — _Postgres RLS for Multi-Tenant SaaS_](https://theroadtoenterprise.com/blog/postgres-rls-multi-tenant-saas)          | "Composite indexes work too when the same query filters on tenant plus another column (a common shape for 'the most recent invoices for this tenant'): `CREATE INDEX invoices_tenant_id_created_at_idx ON invoices (tenant_id, created_at DESC)` keeps both the policy and the order-by inside one index scan." Also: "every column referenced by a policy needs an index."                                                                                             | **T4** |

**Implication for this change.** Our `(accountId, …)` leading-column convention matches
the mainstream multi-tenant pattern, and the `(accountId, createdAt)` candidate arm is the
textbook shape for a tenant-scoped feed with an ordered page. But because the only
on-point citation for that exact shape is T4, the proposal must justify the index arm from
**our own measurement**, citing this material as precedent for the _shape being worth
measuring_ — never as authority for the choice.

**Confidence: medium** — the general leading-column rule is solidly attested; the specific
`(tenant, created_at)` feed recommendation is not attested above tier 4. **No source
found** for AWS prescriptive guidance on multi-tenant Postgres index shapes.

---

## Summary for the proposal

Facts the `propose` phase may cite, each traceable to a citation above:

1. **The per-row cost is by specification, not by accident.** PostgreSQL documents that a
   row-security expression "will be evaluated for each row prior to any conditions or
   functions coming from the user's query" ([PG 16 §5.9](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)).
2. **`STABLE` never promised what we assumed.** The docs scope the "optimize multiple
   calls to a single call" guarantee to _index scan conditions_
   ([PG 16 §38.7](https://www.postgresql.org/docs/16/xfunc-volatility.html)) — which is
   why a disjunctive Filter qual re-evaluates, exactly as our 17×-Filter / 0×-Index-Cond
   measurement shows.
3. **The wrapper is a named, linted industry practice, and it names `current_setting`
   specifically.** Supabase documents the InitPlan mechanism and ships lint
   `0003_auth_rls_initplan`, whose monitored pattern list includes `current_setting(%)`
   across both `qual` and `with_check`
   ([lint source](https://raw.githubusercontent.com/supabase/splinter/main/lints/0003_auth_rls_initplan.sql),
   [docs](https://supabase.com/docs/guides/database/postgres/row-level-security)).
4. **The wrapper does not open the documented RLS sub-SELECT leak channel.** That warning
   is scoped to policies that "consult other rows or other tables"; ours reads no table
   ([PG 16 §5.9](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)).
5. **A catalog-based uniformity gate is viable.** `pg_policies.qual`/`.with_check` are
   `pg_get_expr()` renderings of the stored expression
   ([`system_views.sql`](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/catalog/system_views.sql)),
   and Supabase's linter distinguishes wrapped from bare purely by text-matching that
   output — but the deparse normalizes casts, spacing and aliases, so the gate must match
   a normalized pattern, never migration bytes.
6. **A `NULL` `with_check` is compliant, not a miss.** `WITH CHECK` defaults to the
   `USING` expression when unspecified
   ([PG 16 §5.9](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)) — a gate that
   demands a non-null `with_check` would red-line correct policies.
7. **The third index column does not buy ordering for the account-wide feed.** With only
   `accountId` bound, `(accountId, projectId, createdAt)` yields a range ordered by
   `(projectId, createdAt)`; `ORDER BY createdAt` still sorts, Incremental Sort needs a
   _leading_ key ([PG 13 notes](https://www.postgresql.org/docs/release/13.0/)), and skip
   scan is PG 18, not 16.14 ([PG 18 notes](https://www.postgresql.org/docs/release/18.0/)).
8. **The rollback-A/B harness is sound but has three hard preconditions.** Plain
   `CREATE INDEX` is transactional and `CONCURRENTLY` is not
   ([PG 16 `CREATE INDEX`](https://www.postgresql.org/docs/16/sql-createindex.html)); it
   refreshes `relallvisible`
   ([PG 16 `pg_class`](https://www.postgresql.org/docs/16/catalog-pg-class.html)); and it
   write-locks the table — so: no DML inside the arm, `VACUUM` before, scratch database
   only.

---

## Gaps — only our own measurement can answer these

1. **The S2 index flip.** No source found stating that the `(SELECT …)` idiom can change a
   chosen index or regress a plan. Our one observed flip is literature-unexplained, so
   per-policy `EXPLAIN` evidence across all 61 policies is not optional — the sweep must
   carry its own before/after, not inherit the trio's verdict.
2. **The exact deparsed byte form on PG 16.14.** Whether `pg_get_expr` renders
   `( SELECT current_setting('app.account_id'::text, true) AS current_setting)` — the
   alias, spacing and cast placement — was not pinned by any source. Read it back from our
   own catalog before writing the uniformity-gate regex, and prove the gate's red path by
   planting a bare policy (per this repo's "new gates are born with their red
   demonstrated" rule).
3. **Which of the three index arms wins.** The literature gives shape precedent, not a
   verdict on our row distribution, feed predicate, and page size. The DROP arm in
   particular can only be settled by measurement.
4. **Whether index-only scans actually fire in the harness.** The composite claim (index
   built in-transaction + pre-transaction VM ⇒ IOS) is inference, not a quoted sentence.
   Assert `Heap Fetches: 0` in the arm output.
5. **Write-path delta.** No source found for measured RLS `WITH CHECK` cost. If the
   proposal wants to claim a write-path benefit, it needs its own bulk-`INSERT`/
   bulk-`UPDATE` arm; otherwise it should claim nothing.
6. **The 3-arm `AIPromptTemplate` variant.** Its non-standard policy shape is outside
   everything cited here; treat it as its own measured case, not as a member of the 61.
7. **Whether the `__system__` disjunct itself should survive the rewrite.** The literature
   covers wrapping a call, not restructuring a disjunction; whether
   `(SELECT …) = '__system__' OR "accountId" = (SELECT …)` is the best target form versus
   a single-InitPlan alternative is an in-house design + measurement question.
