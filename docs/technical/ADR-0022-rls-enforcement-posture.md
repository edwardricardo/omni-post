# ADR-0022: RLS enforcement posture — a non-owner `omnipost_app` role, not `FORCE ROW LEVEL SECURITY`

- **Status**: Accepted
- **Date**: 2026-09-07
- **Deciders**: Edward Velasquez, Platform engineering

## Context

Since `20260527000000_add_rls_tenant_isolation` the schema has carried a
`tenant_isolation` policy on every guard-enrolled table — 58 of them at the time
of writing. The policy is correct. It was also, for the running application,
doing nothing at all.

A role escapes row security in exactly three ways, and every one of them was open
simultaneously:

1. **`SUPERUSER`** — the application connects as `postgres`.
2. **`BYPASSRLS`** — the same role carries it.
3. **Table ownership** — a table's owner is exempt from its own policies unless
   the table carries `FORCE ROW LEVEL SECURITY`, and `postgres` owns every table
   while **zero** of the 58 carry `FORCE`.

This is measured, not inferred. The capture is
[`docs/reports/RLS_POSTURE_RED_BASELINE.md`](../reports/RLS_POSTURE_RED_BASELINE.md):
with `app.account_id` bound to tenant B, a read of `Project` returned tenant A's
rows. The same read with **no** tenant bound also returned every row, which rules
out the charitable reading — a policy that is being consulted fails closed on an
unset GUC, so three rows means the policy was never consulted.

The existing integration suite did not catch this, and could not have. It created
a synthetic `rls_test_role` and proved the policy against that. Proving that the
POLICY is well-formed and proving that the APPLICATION is subject to it are
different claims, and only the first one had a test.

## Decision

**Enforcement rests on the app role's attributes and on it owning nothing.
No `FORCE ROW LEVEL SECURITY` anywhere.**

1. A migration (`<ts>_create_omnipost_app_role`) provisions `omnipost_app` as
   `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, grants it DML on the schema's
   tables and `USAGE` on its sequences, and sets `ALTER DEFAULT PRIVILEGES` so
   tables created by later migrations stay covered without anyone remembering.
   The migration re-asserts `NOSUPERUSER NOBYPASSRLS` on every run — a role that
   already exists may have been granted `BYPASSRLS` by hand — but deliberately
   does **not** re-assert `NOLOGIN`, which would revoke the application's own
   connection on the next deploy.
2. **No password appears in the migration** (CWE-798; the security canon grants
   no exception). Each environment enables login from its own secret channel via
   `scripts/db/enable-app-role-login.sh` (`pnpm db:app-role`), which refuses to
   run without `OMNIPOST_APP_DB_PASSWORD` rather than inventing a default.
3. `omnipost_app` owns nothing. Ownership stays with the migration role.
4. The three properties are permanently gated by
   `apps/api/tests/integration/rls-tenant-isolation.test.ts`, which runs as
   `omnipost_app` on every PR in the Integration Tests job.

## Rationale — why non-owner instead of `FORCE`

`FORCE ROW LEVEL SECURITY` only bites when the table's OWNER queries it. Our
owner is `postgres`, a superuser, which bypasses RLS whether or not `FORCE` is
set. So in every environment that exists today, `FORCE` on all 58 tables would be
**untestable dead configuration**: it could be added, it would change no observed
behaviour, and no test could tell whether it was still there.

It is also actively hazardous for a future managed deployment whose migrations
run as a non-superuser owner. There, `FORCE` applies to the owner — so every
backfill would silently see zero rows unless it opened with
`set_config('app.account_id', '__system__', true)`. A migration that quietly
updates nothing is worse than one that fails.

The hole `FORCE` closes is the ownership hole, and gate (c) closes it
equivalently **and testably**: the suite asserts that zero RLS-covered tables
have `relowner = omnipost_app`. "Someone runs the app as the table owner" becomes
a red CI run instead of a silent bypass. An operator who holds owner credentials
is outside RLS's threat model either way.

## Per-environment role audit

Deployment configuration, not schema — so each row is measured on its own
environment. **No row is inferred from another.**

| Environment                              | Connecting role                                                                                       | `SUPERUSER`                              | `BYPASSRLS`                              | Owns RLS-covered tables        | How measured                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| dev (`omnipost-infra` LXC, `omnipostdb`) | `postgres` → `omnipost_app` once the owner applies the `.env` flip                                    | `postgres`: yes · `omnipost_app`: **no** | `postgres`: yes · `omnipost_app`: **no** | `omnipost_app`: **0 tables**   | Live query as `omnipost_app` over a real LOGIN connection, 2026-09-08: `rolsuper=f, rolbypassrls=f, rolcanlogin=t`; owned tables = 0 |
| test                                     | Same database and role as dev — `.env` and `.env.test` both point at `omnipost-infra:5432/omnipostdb` | as dev                                   | as dev                                   | as dev                         | Read of both env files; this is a shared-database FACT, not an inference from dev                                                    |
| CI (Integration Tests job)               | `postgres` → `omnipost_app` for the application steps once task 6d.6 applies the workflow hunks       | `postgres`: yes · `omnipost_app`: **no** | `postgres`: yes · `omnipost_app`: **no** | migration role owns the tables | Static read of the COMMITTED `.github/workflows/ci.yml`, labelled as such: no CI job has been observed on the flipped channel yet    |
| staging                                  | **Does not exist**                                                                                    | n/a                                      | n/a                                      | n/a                            | No such deployment today                                                                                                             |
| production                               | **Does not exist**                                                                                    | n/a                                      | n/a                                      | n/a                            | No such deployment today                                                                                                             |

The dev and CI rows say different things on purpose. Dev's is a LIVE measurement on the role's
own login connection; CI's is a reading of configuration, because a workflow file is what CI's
posture is made of until a job runs. Neither is inferred from the other, and neither is inferred
from the code.

The dev/test row is the one with live evidence on both sides. As `omnipost_app`,
over a real connection (not `SET LOCAL ROLE`):

```text
$ psql -U omnipost_app -d omnipostdb -tAX -c 'SELECT current_user, count(*) FROM "Project";'
omnipost_app|0                      -- no GUC bound → fail-closed

BEGIN; SELECT set_config('app.account_id','__system__',true); SELECT count(*) FROM "Project";
309                                 -- system sentinel → full visibility (re-measured 2026-09-08)
```

**Re-deriving the login channel** (the credential is never recorded — a recorded URL is a
recorded secret AND goes stale on the next rotation, so it fails both ways):

```bash
export OMNIPOST_APP_DB_PASSWORD='<generated for this session>'
pnpm db:app-role                    # scripts/db/enable-app-role-login.sh, over the owner channel
# then build the URL from DATABASE_URL by swapping user and password:
#   postgresql://omnipost_app:${OMNIPOST_APP_DB_PASSWORD}@<host>:5432/omnipostdb?schema=public
```

CI's reference implementation of the same two steps is the `Enable app-role login` step in each
job of `.github/workflows/ci.yml`.

Zero rows with no tenant bound is the exact inverse of the recorded red, where
the same query returned everything.

**When a staging or production environment appears, its audit row is mandatory
before it serves traffic.** An environment whose role posture has not been
measured is red by default, and the change's completion reporting says so rather
than generalising from dev.

## Demonstrated reds

A gate whose red was never observed does not merge (`CLAUDE.md` §Automated
Compliance Checks, step 3). Each defect below was planted in the live database,
the suite observed to exit **non-zero** — an annotation or a log line would prove
nothing — and the state then restored and the suite re-confirmed green.

| Planted defect                                  | Suite result                                            | Named by                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| _(none — role absent)_                          | `tests 15 · pass 6 · fail 9 · cancelled 0`, exit **1**  | The initial red: nine tests failed on `role "omnipost_app" does not exist` before the migration existed                   |
| `ALTER ROLE omnipost_app BYPASSRLS`             | `tests 15 · pass 10 · fail 5 · cancelled 0`, exit **1** | `AssertionError: omnipost_app must not carry BYPASSRLS`, plus all three zero-rows proofs and the `WITH CHECK` rejection   |
| `ALTER TABLE "Project" OWNER TO omnipost_app`   | `tests 15 · pass 11 · fail 4 · cancelled 0`, exit **1** | `AssertionError: omnipost_app owns RLS-covered tables and is therefore exempt from their policies`, plus the tenant reads |
| Index-scan proof pointed at a non-tenant column | `tests 15 · pass 14 · fail 1 · cancelled 0`, exit **1** | `AssertionError: tenant-scoped read used no tenant-leading index — nodes: [Index Scan], indexes: [Project_deletedAt_idx]` |

Restored state: `tests 15 · pass 15 · fail 0 · cancelled 0 · skipped 0`, exit 0.

### Two findings from running the reds, recorded because they will bite again

**1. Reverting `ALTER TABLE … OWNER TO` does not restore the ACL.** When
`omnipost_app` became the owner of `Project`, PostgreSQL dropped its explicit
grant (an owner's rights are implicit, so the ACL entry is folded away). Handing
ownership back to `postgres` left the role with **no** privileges at all, and the
suite stayed red with `permission denied for table Project` — a failure that
looks nothing like the defect that was planted. The correct restore is to re-run
the idempotent role migration, which re-issues the grants. Any future plant that
touches ownership must restore the same way.

**2. "No Seq Scan" was too weak an assertion, and the red is what proved it.**
The index-scan proof originally asserted only the absence of a `Seq Scan` node.
Pointing the query at a non-indexed column — the intended way to demonstrate its
red — did **not** turn it red: the planner satisfied the `deletedAt IS NULL` half
of the predicate from `Project_deletedAt_idx` and avoided a sequential scan
without touching any tenant index. The assertion now requires the plan to name a
tenant-leading index (`Project_accountId…`) as well, and it is that stronger form
whose red is recorded above. The weaker gate would have reported a healthy
tenant-scoped read while no tenant index was involved.

## Coverage-gate red

The role posture above answers "can the app role bypass row security?". It does
not answer "is row security actually covering every table the guard enrolls?",
and those are different questions with three independent failure axes. The
`pg_catalog` coverage gate — `apps/api/tests/integration/rls-tenant-isolation.test.ts`,
`describe("pg_catalog coverage gate")` — reads `relrowsecurity`,
`relforcerowsecurity`, the table owner, and the policy count for every model in
`getTenantScopedModels()`, and passes a table only when row security is on AND
at least one policy exists AND (the app role does not own the table OR
`relforcerowsecurity` is true).

### The gap the gate closes, measured before it existed

The gate was not added on suspicion. With `UsageMetric` placed in the
policy-without-RLS state — the table fully readable by every tenant, its
`tenant_isolation` policy still sitting in `pg_policy` — the suite as it stood
before the gate reported `tests 15 · pass 15 · fail 0`, **exit 0**. A leaking
table produced a green run. That is the gap, observed rather than argued: the
existing proofs are per-table (they query `Project` and `ApiKey`) and the
policy↔guard 1:1 test counts policies, which a `DISABLE ROW LEVEL SECURITY`
does not remove.

### The three planted states

Each state was planted in the live database from a named SQL file, the suite
observed to exit **non-zero**, the state restored, and the suite re-confirmed
green. A log line or an annotation would leave the job green and prove nothing.

| Planted state                                          | Suite result                              | Named by the gate as                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ALTER TABLE "UsageMetric" DISABLE ROW LEVEL SECURITY` | `tests 17 · pass 16 · fail 1`, exit **1** | `policy-without-RLS (LEAKS…)` — observed `relrowsecurity=false, relforcerowsecurity=false, owner=postgres, policies=1`                 |
| `DROP POLICY tenant_isolation ON "UsageMetric"`        | `tests 17 · pass 14 · fail 3`, exit **1** | `RLS-without-policy (DENIES…)` — observed `relrowsecurity=true, relforcerowsecurity=false, owner=postgres, policies=0`                 |
| `ALTER TABLE "UsageMetric" OWNER TO omnipost_app`      | `tests 17 · pass 14 · fail 3`, exit **1** | `owner-without-FORCE (OWNER-EXEMPT LEAK…)` — observed `relrowsecurity=true, relforcerowsecurity=false, owner=omnipost_app, policies=1` |

Restored state, after every plant: `tests 17 · pass 17 · fail 0 · cancelled 0 ·
skipped 0`, exit 0.

Two of the three also trip older assertions — the policy↔guard 1:1 pair fires on
the dropped policy, and the PR-1 ownership gate fires on the ownership change.
Only the first state is caught by nothing else, and it is the one this gate was
written for. The three are still asserted separately because the gate's
obligation is to NAME which state it found: `policy-without-RLS` leaks while
`RLS-without-policy` denies, so a message that said only "RLS not covered" would
send whoever reads it toward the wrong repair.

### Finding 1 reproduced, and it is now a written restore procedure

The ownership plant re-ran into finding 1 below, measured this time rather than
recalled: `omnipost_app` held `SELECT, INSERT, UPDATE, DELETE` on `UsageMetric`
before the plant, and **zero** privileges after ownership was handed back to
`postgres`. The restore is therefore two steps — hand ownership back, then
re-run the idempotent `20260907000000_create_omnipost_app_role` migration, which
re-issues the grants. Confirmed: the four privileges return and the suite goes
green. Any future plant that touches ownership restores the same way.

### The fourth planted state: a policy that is covered but not UNIFORM

The three states above ask whether row security COVERS a table. A fourth,
independent axis opened with `tenant-rls-cost-repair`: whether every covered
policy expresses its tenant predicate in the one canonical InitPlan-wrapped
form. A policy left in the bare form is fully covered on all three axes above —
row security on, one policy, non-owner role — and leaks nothing. It re-evaluates
`current_setting('app.account_id', true)` once per candidate row instead of once
per statement, which is a cost rather than a hole, and not one of the three gates
can see it.

The form-uniformity gate — same suite, `describe("form-uniformity gate — every
enrolled policy, read from the catalog")` — reads `pg_policies.qual` and
`pg_policies.with_check` for every `tenant_isolation` policy and requires, per
clause, that the count of GUC reads equals the count of HOISTED GUC reads. The
expected population is `getTenantScopedModels().size`, never a literal, so it is
the same 1:1 source the coverage gate uses. Recorded here because this ADR is
where the reds of this suite live, and a fourth gate whose red lived somewhere
else would be a fourth gate nobody could audit against the other three.

Its red was planted on `WebhookEvent` and, unlike the three above, it had to be
**committed**: the suite opens its own connection, so a plant rolled back in the
planting session is a state the gate can never observe. The restore was proven
capable of reproducing the exact 5-tuple in a rolled-back dry run BEFORE the
plant was committed, so the window between commit and restore was never a
window in which the correct bytes were unknown.

| Planted state                                                 | Batch result                                                                                       | Named by the gate as                                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ALTER POLICY tenant_isolation ON "WebhookEvent"` → bare body | `integration:tenant-isolation 246 tests 245 pass 1 fail 0 cancel 0 skip exit 1 [FAIL]`, exit **1** | `"WebhookEvent" → USING holds 2 un-hoisted GUC read(s) of 2 (0 hoisted)` — and the same line again for `WITH CHECK` |

Verbatim, from the failing batch:

```text
2 tenant_isolation policy clause(s) are NOT in the canonical InitPlan-wrapped form, out of 61 enrolled policies. A bare GUC read is re-evaluated once per candidate row, which is the cost this form exists to remove:
  "WebhookEvent" → USING holds 2 un-hoisted GUC read(s) of 2 (0 hoisted) — each bare read is re-evaluated once per candidate row
      USING:      ((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))
      WITH CHECK: ((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))
  "WebhookEvent" → WITH CHECK holds 2 un-hoisted GUC read(s) of 2 (0 hoisted) — each bare read is re-evaluated once per candidate row
```

Restored state: the `WebhookEvent` policy 5-tuple md5 returned to its pre-plant
value `03eb3ab226fc5de8d14dc207e8068e1e` (planted: `4e1d18b9c49d8084d679bd76e14dcd89`),
and the WHOLE-catalog 5-tuple digest over all 61 policies returned to
`70322c28db1c0684897b49e4d70de014` — the value the sweep migration committed —
so the restore is proven against the whole enrollment rather than only against
the table that was touched.

### The matcher is read back, never written from migration bytes

The gate's adjacency pattern was derived from the catalog and the derivation
found a real defect in the obvious spelling. `pg_get_expr` re-prints a policy
body from the parsed tree, and on this server it emits `( SELECT
current_setting(` — **with one space** after the parenthesis. Counting
occurrences of the glued literal `"(select current_setting("` after lowercasing
and collapsing whitespace therefore matches **zero** times across all 61
deployed policies: measured, not supposed. A gate written from that literal
would have red-lined the entire compliant catalog on its first run and taught
whoever hit it that the gate was wrong rather than that the catalog was.

That is the same failure mode as reading migration source: both assert an intent
the database does not hold. The pattern the gate ships with tolerates the
whitespace, and it is the same pattern
`20260910000200_rls_initplan_sweep`'s own `DO $$` guard uses, so the gate and the
migration cannot disagree about what "hoisted" means.

### Why the integration tier and not a fitness grep

`pg_class.relrowsecurity` is database state. The fitness workflow runs no
Postgres service, and no grep can read a catalog. The gate is wired through
`apps/api/scripts/run-tests.sh` (`integration:tenant-isolation` batch, which
already named this suite) and runs in CI's Integration Tests job on every pull
request against the migrated Postgres service. `CLAUDE.md` §Automated Compliance
Checks carries a pointer note naming it — a note, not a numbered workflow step,
so the gate inventory stays complete without pretending a grep can do this.

The form-uniformity gate rides the same wiring for a stronger version of the same
reason: rendered policy TEXT is not merely database state, it is database state
the database itself re-writes. No `grep` over `infra/prisma/**` can see that
`pg_get_expr` adds a `::text` cast and an ` AS current_setting` alias, which is
precisely the gap between the migration's bytes and the deployed truth. It was
therefore confirmed — not added — that `run-tests.sh:273` already names this
suite in the `integration:tenant-isolation` `run_batch` at `:291`, and that
`ci.yml`'s `test-integration` job runs that batch under `TIER: full-integration`
on every `pull_request`. **No `fitness.yml` step was created**, for the same
reason D-S0-4 ruled it out for the coverage gate: a grep step here would be a
check that measures nothing while reading as coverage.

## Runtime cutover — the URL split, and the flip it was blocking

The split itself is small and now shipped: `infra/prisma/prisma.config.ts` reads
`MIGRATE_DATABASE_URL ?? DATABASE_URL ?? ""` (the owner channel for migrate and
seed), `apps/api/src/config/env.ts` declares `MIGRATE_DATABASE_URL` as an
optional server entry so the pair is schema-visible rather than ambient, and the
integration harness builds every fixture through `createSeedPrismaClient()`
(`apps/api/tests/integration/helpers/seedPrismaClient.ts`), which resolves the
same precedence. Both fallbacks keep an environment that has not configured the
pair behaving exactly as before.

What the split deliberately did NOT do was flip `DATABASE_URL` to the application
role. That flip was attempted, measured, and REFUSED — and the record of the
refusal is kept below, because it is the red this section's green is measured
against.

### The blocked measurement, as it stood

The `integration:tenant-isolation` batch (18 suites, 177 tests) was run twice
against the live dev database, same files, same `CONCURRENCY=1`, differing only
in which role `DATABASE_URL` names:

| Channel                               | Result                                        | Exit |
| ------------------------------------- | --------------------------------------------- | ---- |
| `postgres` (owner, the value then)    | `tests 177 · pass 177 · fail 0 · cancelled 0` | 0    |
| `omnipost_app` (the intended cutover) | `tests 177 · pass 170 · fail 7 · cancelled 0` | 1    |

The zero-rows proof itself was **green on the app-role channel** even then: the
whole of `rls-tenant-isolation.test.ts` passed `21/21` with `DATABASE_URL`
pointing at `omnipost_app`, which is the Slice 0 exit condition. All 15 dedicated
`*TenantIsolation` suites passed on both channels.

The 7 failures were confined to two suites — `postDeleteOwnership.test.ts` (3) and
`postReadOwnership.test.ts` (4) — and they were not harness defects. They were the
application misbehaving under the cutover: the owner's own post became
unreadable (`404`), and deleting it returned `500` where the route contract says
`200`.

### Root cause: the tenant GUC is bound ONLY inside a transaction

`app.account_id` is set in exactly one place per path —
`PrismaUnitOfWork.executeInTransaction` (and the saga's equivalent). There is no
request-scoped binding. So every statement the application issues OUTSIDE a unit
of work runs with the GUC unset, and under a role that cannot bypass row
security that means the `tenant_isolation` policy evaluates false: the read fails
closed, exactly as designed, against the application itself.

The ownership gate is where it surfaces first, because ownership is resolved
through a JOIN into the RLS-covered `Project` table
(`PrismaPostRepository.findOwnerAccountId`, which selects
`{ project: { select: { accountId: true } } }` and then dereferences
`row.project.accountId`). Measured directly, as `omnipost_app`:

```text
-- no GUC bound
 current_user | bound_tenant |  post_visible  | project_visible | owner_account_id
--------------+--------------+----------------+-----------------+------------------
 omnipost_app |              | pr3-probe-post |                 |

-- same read, app.account_id bound
      step      |  post_visible  | project_visible | owner_account_id
----------------+----------------+-----------------+------------------
 with GUC bound | pr3-probe-post | pr3-probe-proj  | pr3-probe-acct
```

`Post` carries no policy today, so the post row is visible while the project it
points at is not. `row.project` is therefore `null`, dereferencing it throws, the
route's catch converts the throw into a `500`, and the anti-enumeration contract
("a foreign id is byte-indistinguishable from a nonexistent one") is broken in
both directions at once.

### Two consequences worth stating separately

1. **The flip was blocked, and Slice 1 would not have unblocked it by itself.**
   Once the trio carries `accountId` and is enrolled, `Post` becomes RLS-covered
   too, so the same out-of-transaction read returns zero rows instead of a null
   join — a `404` for the owner's own post rather than a `500`. Cleaner, still
   wrong. The remedy was request-scoped tenant binding, which is what Slice 0d
   went and built.
2. **`findOwnerAccountId` dereferenced an optional relation.** `row.project` is
   nullable in the generated type's runtime shape whenever a policy, a soft
   delete, or a race can hide the parent. It was recorded rather than fixed at
   the time, deliberately: fixing it first would have converted the `500` into a
   `404` and made the cutover LOOK survivable while the owner still could not
   read their own post. It carries a null check now, landed together with the
   binding that makes the parent visible in the first place.

### The landed result

Slice 0d made the binding request-scoped, converted the composition root onto the
guarded client, swept the harness onto named channels, and repaired the
application defects the role exposed. The same batch, re-run on both channels
after that work — 20 suites now, 185 tests, `CONCURRENCY=1`, only the role
differing:

| Channel                            | Result                                                    | Exit | Wall time |
| ---------------------------------- | --------------------------------------------------------- | ---- | --------- |
| `postgres` (owner)                 | `tests 185 · pass 185 · fail 0 · cancelled 0 · skipped 0` | 0    | 31 s      |
| `omnipost_app` (the LOGIN channel) | `tests 185 · pass 185 · fail 0 · cancelled 0 · skipped 0` | 0    | 30 s      |

Wall time is the free empirical check on the cost of per-operation binding, and it
holds: the difference is inside the run-to-run noise of a shared dev database, in
the app role's favour if anything. The design accepted a second pooled connection
per unbound operation; on this workload that is not paying rent.

The FULL integration tier was then run on the app-role channel with the API and
the workers booted as `omnipost_app` on that same channel:

| Scope                                             | Result                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `TIER=pr-integration` (DB-only, BEFORE the sweep) | `420 tests · 248 pass · 11 fail · 161 cancelled`, exit 1          |
| `TIER=pr-integration` (DB-only, after the sweep)  | `420 tests · 420 pass · 0 fail · 0 cancelled · 0 skipped`, exit 0 |
| `TIER=full-integration` (live API + live workers) | `821 tests · 818 pass · 3 fail · 0 cancelled · 0 skipped`         |

The 3 remaining failures are `integration:saga-live`, and they are NOT the role —
but the cause first recorded for them was wrong, and the correction is kept here
rather than quietly swapped.

**Withdrawn:** that a locally booted worker cannot decrypt the seeded channel
credentials because the suite and the booted processes load different env files
and disagree on `PLATFORM_ENCRYPTION_KEY`.

**Measured instead:** the decrypt failure is universal and by fixture design.
`sagaCustomerFlow.test.ts:146-148` and `:508-510` seed literal fixture strings
(`"test-ciphertext"` / `"test-iv"` / `"test-auth-tag"`), so
`channelCredentialsCrypto.ts:88` throws `Decryption failed: invalid auth tag
length` on `authTag.length !== 16` before the key decrypts anything — no key
decrypts these. The error string rules the key out on its own: a missing or
wrong-length key throws the distinct named error from `decodeKey` (`:34-38`), and
a right-length wrong-value key would fail later in `decipher.final()`. **CI
carries the identical signature and is green** — run `34167031322`, job
`101880011422`, HEAD `585a01bb`: 12 `invalid auth tag length` and 12
`"error":"AUTH"` alongside `integration:saga-live 14 tests · 14 pass · exit 0`
and `TOTAL: 818 tests, 818 pass`.

**What remains open:** not why the decrypt fails, but why these three sagas do
not terminalize inside the suite's 120 s budget locally when CI's do. The local
failure mode is the timeout itself (`did not reach terminal state within
120000ms`, at ~120.1 s each), and the known precedent class is
`docs/reports/SAGA_LIVE_CI_RED_ROOT_CAUSE.md` §H3, which names these exact three
subtests: with nothing draining the publish queue the saga parks in `waiting` and
only the 30-minute horizon terminalizes it. Here a worker WAS booted, so that is
a lead, not a conclusion, and it is recorded as undiagnosed.

**What the controls do establish** is the classification, in two arms: the same
three fail on the OWNER channel with working-tree code (arm A), and again with
HEAD (`585a01bb`) content planted in all six changed source files (arm B,
restored byte-exact). Neither the role nor this change's diff is the variable.
The carry-forward is binary: diagnose it, or declare the hand-driven local live
tier an unsupported measurement surface — `SAGA_LIVE_CI_RED_ROOT_CAUSE.md` §Fix 2
already specifies the fail-loud consumer precondition that would have turned this
into a named failure in seconds instead of a wrong diagnosis.

### What the role exposed, and what was repaired

Every defect below pre-dates the flip. Under a superuser each one was silent; the
non-bypassing role turned all of them into failures, which is the argument for the
cutover in one sentence.

| Defect                                                                                                                                                                                        | Under a superuser                          | Under `omnipost_app`                               | Repair                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PrismaProjectRepository.save`, `PrismaCrisisProjectRepository.save`, `PrismaTrackedLinkRepository.save` / `.delete` issued their statements on the BASE client while a unit of work was open | committed outside the caller's transaction | `42501`, or a probe that cannot see its own row    | each resolves `PrismaUnitOfWork.getTransactionClient()` first, as the canon requires |
| `db-prisma` `getPostById` read the parent chain as a nested `include`                                                                                                                         | joined fine through the bypass             | `project` came back NULL and was dereferenced      | the parent liveness read is separate and DECLARES `__system__`, projecting 2 columns |
| every `*-dispatch` scheduler tick, and the `DETECT_REPURPOSE` consumer, ran with no declared scope                                                                                            | swept every account through the bypass     | the first enrolled read threw, swallowed as a warn | `withSystemContext("system:<task-id>")` per tick; the payload's account per consumer |

The first row is a CLASS, not three sites: a repository statement issued on the
base client while a unit of work is open. `apps/api/src` holds **256** candidate
`this.prisma.<model>.<write>` call sites; only those reached from inside a unit of
work can fail, which is why three of them surfaced and the rest did not. The
systematic sweep of the remainder, and a gate for it, are follow-up work rather
than a claim made here.

### The Slice 0d decision trail

- **Request-scoped binding through ONE extension, not two.** The design planned a
  chained `$extends` (guard, then bind). Chaining works under the application's
  resolver and breaks under the unit-test runner's: `vitest.shared.ts` maps
  `@infra/prisma` to an entry whose `prisma` export is a no-op `Proxy` answering
  every `$`-prefixed property with `async () => undefined`, so the first `$extends`
  yields a Promise and the second call on it throws. The design's own named
  fallback was taken — `tenantGuardWithGucBindingExtension`, guard-then-bind inside
  a single hook. An earlier record blamed a module-instance split and proposed a
  `tsconfig.base.json` remedy; that was refuted by direct execution, and the
  withdrawn claim is kept beside its refutation rather than quietly deleted.
- **A marker, and one helper, so a transaction owns its own connection.**
  `runWithBoundGuc` marks a transaction as owning GUC adjudication and
  `withGucBoundTransaction` is the single seam that opens one. Without the marker
  an operation issued inside a transaction is re-wrapped onto a SECOND pooled
  connection and commits through its caller's rollback — measured before the fix,
  with a `Post` row surviving its own transaction's rollback.
- **Drift is gated, not trusted.** Fitness **#40** is an allowlist in the shape of
  #28: every `.$transaction(` in `apps/api/src` and `packages/adapters/db-prisma/src`
  must be a `withGucBoundTransaction` call outside three named seams, and every
  seam call must derive its scope from `getAmbientGucScope()`. Both parts shipped
  with their red demonstrated on the installed copies.
- **The residual, stated rather than implied.** #40 gates the transaction SEAM and
  the scope EXPRESSION. It does not gate which CLIENT a repository method reaches
  for, which is exactly the class this cutover exposed. Until that has a gate of
  its own, the canon rule — repositories detect the active transaction — is held
  by review.

The flip itself is applied per environment by its owner: the env files by hand,
`.github/workflows/ci.yml` under a sensitive-edit token. CI's readiness gate on the
flipped channel is observable only in CI, and it is reported there rather than
asserted here.

## Alternatives considered

| Alternative                                                              | Why not                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORCE ROW LEVEL SECURITY` on all 58 tables                              | Untestable dead configuration while the owner is a superuser, and a silent-zero-rows trap for any future non-superuser-owner migration path. See §Rationale.                                                                                                          |
| Keep the synthetic `rls_test_role` and add the app-role proofs beside it | Two proofs of adjacent claims, one of which is the one nobody was asking about. The synthetic role is retired by the same migration (rework over patches).                                                                                                            |
| Provision the role by hand per environment, outside the migration tree   | The posture would then differ per environment by accident rather than by decision, which is exactly the failure this ADR exists to close.                                                                                                                             |
| Pre-create the role login-enabled from a compose `initdb` hook           | Technically tolerable (the migration's idempotent block would not fight it) but it duplicates provisioning outside the migration tree — the row above — and puts a credential in compose. Moot in practice: nothing invokes compose for the dev DB lifecycle anymore. |
| Put the role's password in the migration                                 | CWE-798. Security canon, no exception, no marker.                                                                                                                                                                                                                     |

## Consequences

- The application's connection URL becomes the `omnipost_app` URL at cutover, and
  migrations/seeds need their own owner channel. That split has landed (see
  §Runtime cutover); the flip of `DATABASE_URL` itself has NOT, and until it does
  RLS remains inert for the RUNNING application even though the proofs are green
  — the proofs run as `omnipost_app` by `SET LOCAL ROLE` and over a real login
  connection, neither of which is the same thing as the app connecting as it.
- Integration suites that seed "as superuser" fail closed under the app role. The
  harness now writes every fixture through `createSeedPrismaClient()`, which is
  named rather than implicit precisely so a future test cannot bypass row
  security without saying so at the call site.
- Cutting the application over requires the tenant GUC to be bound outside a unit
  of work, which is a design decision this ADR records rather than makes.
- Every future table is covered by `ALTER DEFAULT PRIVILEGES` without a follow-up
  grant, so a new migration cannot leave the application locked out of its own
  table.

## Revisit if

- **A deployment appears whose migrations run as a non-superuser owner.** Then
  `FORCE ROW LEVEL SECURITY` becomes live rather than dead configuration and
  SHOULD be adopted there — together with the
  `set_config('app.account_id', '__system__', true)` opening line in every
  backfill, without which those backfills silently update zero rows.
- **A staging or production environment is created.** Its audit row above is
  mandatory before it serves traffic.
- **The app role ever needs to own a table** (for example to run `CREATE INDEX`
  from the application). The ownership gate would then have to be narrowed
  per-table, and `FORCE` re-enters the discussion for exactly those tables.
- **A request-scoped tenant binding is adopted** (the GUC bound per connection
  checkout rather than per transaction). That is the precondition for flipping
  `DATABASE_URL` to the app role; when it lands, re-run the two-channel batch
  measurement in §Runtime cutover and the flip becomes a configuration change
  per environment rather than a behavioural one.

## Risks

| Risk                                                      | Mitigation                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone re-grants `BYPASSRLS` to unblock a task           | The role-attribute gate fails the Integration Tests job on the next PR; the red is demonstrated above, so it is known to work.                                                |
| A later migration creates a table the app cannot read     | `ALTER DEFAULT PRIVILEGES` covers tables created by the migration role; the policy↔guard 1:1 assertion catches an enrolled model without its policy.                          |
| An ownership change silently strips the app role's grants | Recorded as finding 1 above; the restore procedure is to re-run the idempotent role migration.                                                                                |
| The dev password is set once and forgotten                | The script refuses to run without `OMNIPOST_APP_DB_PASSWORD` and verifies the resulting posture (`rolcanlogin, rolsuper, rolbypassrls` = `t, f, f`) before reporting success. |

## References

- [`docs/reports/RLS_POSTURE_RED_BASELINE.md`](../reports/RLS_POSTURE_RED_BASELINE.md) — the one-shot historical red and the index-scan evidence
- [`docs/security/MULTI_TENANT_GUARDS.md`](../security/MULTI_TENANT_GUARDS.md) — the three-layer isolation strategy this posture is layer 2 of
- [ADR-0014](ADR-0014-multi-tenant-isolation-guards.md) — the guard model that layer 1 implements
- `infra/prisma/migrations/20260527000000_add_rls_tenant_isolation` — the policies whose enforcement this ADR restores
- `apps/api/tests/integration/rls-tenant-isolation.test.ts` — the permanent gate
- PostgreSQL docs, _Row Security Policies_: superusers and roles with `BYPASSRLS` always bypass; table owners bypass unless `FORCE ROW LEVEL SECURITY` is set
