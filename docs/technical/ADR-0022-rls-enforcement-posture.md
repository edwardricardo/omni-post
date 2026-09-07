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

| Environment                              | Connecting role                                                                                           | `SUPERUSER`                              | `BYPASSRLS`                              | Owns RLS-covered tables        | How measured                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| dev (`omnipost-infra` LXC, `omnipostdb`) | `postgres` → cutting over to `omnipost_app`                                                               | `postgres`: yes · `omnipost_app`: **no** | `postgres`: yes · `omnipost_app`: **no** | `omnipost_app`: **0 tables**   | Live query, 2026-09-07: `pg_roles` + `pg_class.relowner`                                                  |
| test                                     | Same database and role as dev — `.env` and `.env.test` both point at `omnipost-infra:5432/omnipostdb`     | as dev                                   | as dev                                   | as dev                         | Read of both env files; this is a shared-database FACT, not an inference from dev                         |
| CI (Integration Tests job)               | `postgres` (service `pgvector/pgvector:pg16`, `POSTGRES_USER: postgres`) → cutting over to `omnipost_app` | yes, until cutover                       | yes, until cutover                       | migration role owns the tables | Static read of `.github/workflows/ci.yml`; the live assertion is the suite itself, which runs in that job |
| staging                                  | **Does not exist**                                                                                        | n/a                                      | n/a                                      | n/a                            | No such deployment today                                                                                  |
| production                               | **Does not exist**                                                                                        | n/a                                      | n/a                                      | n/a                            | No such deployment today                                                                                  |

The dev/test row is the one with live evidence on both sides. As `omnipost_app`,
over a real connection (not `SET LOCAL ROLE`):

```text
$ psql -U omnipost_app -d omnipostdb -tAX -c 'SELECT current_user, count(*) FROM "Project";'
omnipost_app|0                      -- no GUC bound → fail-closed

BEGIN; SELECT set_config('app.account_id','__system__',true); SELECT count(*) FROM "Project";
293                                 -- system sentinel → full visibility
```

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
  migrations/seeds need their own owner channel. That split is a separate, bounded
  work unit; until it lands, RLS remains inert for the RUNNING application even
  though the proofs are green — the proofs run as `omnipost_app` by `SET LOCAL
ROLE`, which is not the same thing as the app connecting as it.
- Integration suites that seed "as superuser" through the raw `@infra/prisma`
  singleton will fail closed under the app role. The harness needs a superuser
  seed client in the same unit as the cutover.
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
