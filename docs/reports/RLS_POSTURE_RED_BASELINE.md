# RLS posture — the recorded red, and the proof that replaced it

> **What this file is.** The one-shot, historical capture of Row Level Security
> failing to enforce anything for the running application, taken **before** the
> `omnipost_app` role existed. It is unrepeatable by construction: once the role
> is provisioned and the application is cut over, the posture this file records
> is gone, and a gate that was never observed red is a gate nobody has reason to
> believe.
>
> Owning capability: `rls-enforcement` (change `tenant-isolation-composite-fk`,
> Slice 0). Decision record: [ADR-0022](../technical/ADR-0022-rls-enforcement-posture.md).
> Permanent regression proof: `apps/api/tests/integration/rls-tenant-isolation.test.ts`.

---

## 1. Summary

|                                          |                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Captured                                 | 2026-09-07                                                                           |
| Database                                 | PostgreSQL 16.14 (`pgvector/pgvector:pg16`), database `omnipostdb`, schema `public`  |
| Connecting role                          | `postgres` — `rolsuper = true`, `rolbypassrls = true`                                |
| Queried table                            | `Project` — `relrowsecurity = true`, `relforcerowsecurity = false`, owner `postgres` |
| `FORCE ROW LEVEL SECURITY` in the schema | **0 tables of 58 with RLS enabled**                                                  |
| Bound tenant                             | `rls-posture-red-B`                                                                  |
| Expected under an enforcing posture      | zero rows of tenant A                                                                |
| **Observed**                             | **tenant A's rows returned — the proof FAILS**                                       |

The `tenant_isolation` policy is present, syntactically correct, and completely
inert for this connection. All three bypass paths were open at once: the role is
`SUPERUSER`, the role carries `BYPASSRLS`, and the role owns the table while no
table carries `FORCE ROW LEVEL SECURITY`. Closing any two of the three would
still have left the read unguarded.

---

## 2. Exact command

Run from the repository root, against the database `DATABASE_URL` points at.
Host, user and database below are the values used for the capture; substitute
your own. The script is idempotent (it deletes its own fixture first and again
at the end), so it can be re-run without leaving rows behind.

```bash
PGPASSWORD='<superuser-password>' psql \
  -h omnipost-infra -U postgres -d omnipostdb \
  -v ON_ERROR_STOP=1 -f - <<'SQL'
\pset pager off
-- 1. attributes of the role the application connects as
SELECT current_user AS connecting_role, r.rolsuper, r.rolbypassrls, r.rolcanlogin
FROM pg_roles r WHERE r.rolname = current_user;

-- 2. posture of the queried RLS-covered table
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS table_owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'Project';

-- 3. FORCE ROW LEVEL SECURITY across the whole public schema
SELECT count(*) FILTER (WHERE c.relrowsecurity)      AS tables_with_rls_enabled,
       count(*) FILTER (WHERE c.relforcerowsecurity) AS tables_with_force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- 4. the policy that is supposed to gate the read
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'Project';

-- 5. seed two tenants (idempotent)
DELETE FROM "Project" WHERE "accountId" IN ('rls-posture-red-A', 'rls-posture-red-B');
DELETE FROM "Account" WHERE id IN ('rls-posture-red-A', 'rls-posture-red-B');
INSERT INTO "Account" (id, email, name, "updatedAt") VALUES
  ('rls-posture-red-A', 'posture-red-a@rls.invalid', 'Posture Red A', now()),
  ('rls-posture-red-B', 'posture-red-b@rls.invalid', 'Posture Red B', now());
INSERT INTO "Project" (id, name, "accountId", "updatedAt") VALUES
  ('rls-posture-red-A-p1', 'A-1', 'rls-posture-red-A', now()),
  ('rls-posture-red-A-p2', 'A-2', 'rls-posture-red-A', now()),
  ('rls-posture-red-B-p1', 'B-1', 'rls-posture-red-B', now());

-- 6. THE PROOF: wrong-tenant read, app.account_id bound to tenant B
BEGIN;
SELECT set_config('app.account_id', 'rls-posture-red-B', true) AS bound_tenant;
SELECT current_setting('app.account_id', true) AS guc_in_effect;
SELECT id, "accountId" FROM "Project"
WHERE "accountId" IN ('rls-posture-red-A', 'rls-posture-red-B') ORDER BY id;
COMMIT;

-- 7. the same read with NO tenant bound (fail-closed check)
BEGIN;
SELECT id, "accountId" FROM "Project"
WHERE "accountId" IN ('rls-posture-red-A', 'rls-posture-red-B') ORDER BY id;
COMMIT;

-- 8. cleanup
DELETE FROM "Project" WHERE "accountId" IN ('rls-posture-red-A', 'rls-posture-red-B');
DELETE FROM "Account" WHERE id IN ('rls-posture-red-A', 'rls-posture-red-B');
SQL
```

---

## 3. Captured output (step separators added for readability; the SQL results themselves are verbatim)

```text
=== STEP 1 — attributes of the role the application connects as ===
 connecting_role | rolsuper | rolbypassrls | rolcanlogin
-----------------+----------+--------------+-------------
 postgres        | t        | t            | t
(1 row)

=== STEP 2 — posture of the queried RLS-covered table ===
 relname | relrowsecurity | relforcerowsecurity | table_owner
---------+----------------+---------------------+-------------
 Project | t              | f                   | postgres
(1 row)

=== STEP 3 — FORCE ROW LEVEL SECURITY across the whole public schema ===
 tables_with_rls_enabled | tables_with_force_rls
-------------------------+-----------------------
                      58 |                     0
(1 row)

=== STEP 4 — the tenant_isolation policy that is supposed to gate the read ===
    policyname    | cmd |                                          qual
------------------+-----+-----------------------------------------------------------------------------------------
 tenant_isolation | ALL | ((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))
(1 row)

=== STEP 5 — seed two tenants (idempotent) ===
DELETE 0
DELETE 0
INSERT 0 2
INSERT 0 3
=== STEP 6 — THE PROOF: wrong-tenant read, app.account_id bound to tenant B ===
BEGIN
   bound_tenant
-------------------
 rls-posture-red-B
(1 row)

   guc_in_effect
-------------------
 rls-posture-red-B
(1 row)

          id          |     accountId
----------------------+-------------------
 rls-posture-red-A-p1 | rls-posture-red-A
 rls-posture-red-A-p2 | rls-posture-red-A
 rls-posture-red-B-p1 | rls-posture-red-B
(3 rows)

COMMIT
=== STEP 7 — the same read with NO tenant bound (fail-closed check) ===
BEGIN
          id          |     accountId
----------------------+-------------------
 rls-posture-red-A-p1 | rls-posture-red-A
 rls-posture-red-A-p2 | rls-posture-red-A
 rls-posture-red-B-p1 | rls-posture-red-B
(3 rows)

COMMIT
=== STEP 8 — cleanup ===
DELETE 3
DELETE 2
```

### What the output says

- **Step 6 is the failure.** With `app.account_id` bound to tenant B, both of
  tenant A's projects came back. Under an enforcing posture the result is
  `rls-posture-red-B-p1` and nothing else.
- **Step 7 rules out the charitable reading.** With NO tenant bound at all the
  read still returned every row. A policy that is being consulted fails CLOSED
  when the GUC is unset (`current_setting(..., true)` yields NULL, and both
  disjuncts evaluate to NULL, which is not true). Returning three rows means the
  policy was never consulted, not that it was consulted and satisfied.

---

## 4. Index-scan evidence (§Index-scan)

Captured AFTER the `omnipost_app` role was provisioned — this section answers a
different question from §3, and it is only answerable once there is a role that
RLS actually applies to. The claim under test is the one the `rls-enforcement`
spec makes: the policy must not degrade a normal tenant-scoped read to a
sequential scan.

**Method.** `SET LOCAL enable_seqscan = off` inside the same transaction that
does `SET LOCAL ROLE omnipost_app` and binds the GUC. This is deliberate, not a
thumb on the scale: on a small fixture the planner sequential-scans everything
regardless of the policy, so an un-penalised measurement would report the cost
model's opinion about 297 rows rather than the property being claimed. With
sequential scans penalised, a Seq Scan node that survives means index access was
made IMPOSSIBLE — which is the actual failure mode.

**Data shape at capture.** `Project`: 297 rows total, 284 live
(`deletedAt IS NULL`), 2 belonging to the bound tenant.

**Exact query.**

```sql
SET LOCAL ROLE omnipost_app;
SELECT set_config('app.account_id', 'rls-plan-acc-A', true);
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, FORMAT TEXT)
SELECT id, "accountId" FROM "Project"
WHERE "accountId" = 'rls-plan-acc-A' AND "deletedAt" IS NULL;
```

**Captured plan, verbatim.**

```text
 Index Scan using "Project_accountId_idx" on "Project"  (cost=0.27..8.30 rows=1 width=74) (actual time=0.006..0.007 rows=2 loops=1)
   Index Cond: ("accountId" = 'rls-plan-acc-A'::text)
   Filter: ((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))
 Planning Time: 0.172 ms
 Execution Time: 0.013 ms
```

**Adjudication: no regression.** The plan is an Index Scan on
`Project_accountId_idx`, the tenant-leading partial index. The policy qual is
applied as a `Filter` on top of the index condition — it narrows rows already
located by the index rather than replacing the index access with a scan. Had the
plan come out as a sequential scan, this section would record that instead, with
its adjudication; the artifact is not permitted to contain only the favourable
comparisons.

The integration suite asserts the JSON form of this same plan, and it asserts
BOTH properties: no `Seq Scan` node anywhere in the tree, AND at least one plan
node reading an index whose name is tenant-leading (`Project_accountId…`).

**Why both assertions, measured rather than assumed.** The first draft asserted
only "no Seq Scan". Pointing the query at a non-indexed column to demonstrate
the red produced this instead:

```text
AssertionError [ERR_ASSERTION]: tenant-scoped read used no tenant-leading index
  — nodes: [Index Scan], indexes: [Project_deletedAt_idx]
```

The planner satisfied the `deletedAt IS NULL` half of the predicate from
`Project_deletedAt_idx` and avoided a sequential scan without touching a tenant
index at all — so the weaker assertion would have reported a healthy
tenant-scoped read while no tenant-leading index was involved. The tenant-index
assertion exists because that false green was observed, not anticipated.

---

## 5. Re-run instructions

1. `pnpm db:up` — verify Postgres is reachable and authenticating.
2. **§3 (the historical red) cannot be reproduced on a corrected deployment.**
   It requires a connection whose role carries `BYPASSRLS` or `SUPERUSER`, which
   is the posture this change removes. Running the §2 script as `omnipost_app`
   after cutover returns tenant B's single row — the green, not the red. That
   asymmetry is the entire reason this file exists.
3. **§4 (the index-scan plan)** re-runs at any time against the current
   deployment: the SQL in §4 is complete and self-contained apart from its
   fixture, and the equivalent assertion runs on every PR as part of
   `apps/api/tests/integration/rls-tenant-isolation.test.ts` (batch
   `integration:tenant-isolation`).
4. To re-observe a red on the corrected deployment, use the permanent regression
   proofs recorded in [ADR-0022](../technical/ADR-0022-rls-enforcement-posture.md)
   §Demonstrated reds: plant `ALTER ROLE omnipost_app BYPASSRLS`, or plant
   `ALTER TABLE "Project" OWNER TO omnipost_app`, and run the suite.
