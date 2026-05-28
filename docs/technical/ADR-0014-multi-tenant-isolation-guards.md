# ADR-0014: Multi-Tenant Isolation Guards — 3-Layer Defense-in-Depth

- **Status**: Accepted (retroactive record)
- **Date**: 2026-05-28 (decisions implemented 2026-05-23 → 2026-05-27)
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

OmniPost is a multi-tenant B2B SaaS. The data model has 51 tenant-scoped
tables (Post, Channel, Mention, AIPromptTemplate, etc.) and a handful of
global tables (Account, Provider, system templates).

The threat model is **CWE-639: Authorization Bypass Through User-Controlled Key**:

- Customer A holds a valid JWT for account `A`.
- API endpoints accept resource IDs (postId, channelId, mentionId, …) as
  path/query/body parameters.
- Without enforcement, customer A submits a resource ID owned by account
  `B`. If a repository method forgets `where: { accountId }`, the query
  returns B's row to A.

Pre-mitigation state: every repository method had to **remember** to filter
by `accountId`. Auditing the codebase revealed inconsistent enforcement
(`PrismaPostRepository.findById()` shipped without the filter; pgvector
raw queries had no filter at all). One forgotten check = customer-data
leak — the canonical failure mode for B2B SaaS, and a pre-acquisition
diligence checker item.

Single-layer defenses (a single `$extends` middleware, a single fitness
function, a single RLS pass) all have a single point of failure. The
strategy must be **defense-in-depth**: multiple independent layers, each
catching what the others miss.

## Decision

**Three independent, cumulative layers**, each tied to a distinct PR
checkpoint, deployed in this order:

### Layer 1 — `TenantContext` + Prisma `$extends` middleware (S2.1a + S2.1b)

`AsyncLocalStorage`-backed `TenantContext { accountId }` bound by the customer
auth middleware after the JWT is decoded. A Prisma `$extends` extension reads
it on **every query** against tenant-scoped tables and either:

- **Injects** `where.accountId = ctx.accountId` when the caller didn't set
  it explicitly,
- **Validates** that an explicit `where.accountId` matches the context
  (throws `TenantContextMismatchError` if not),
- **Throws** `TenantContextMissingError` when the table is tenant-scoped
  and neither a `TenantContext` nor a `SystemContext` is bound.

Catches programming mistakes (forgot the filter) AND tampering attempts
(client tries to pass a different `accountId` in a body parameter).

Cross-tenant flows that legitimately need to bypass per-account scoping
(admin reports, system maintenance) use `withSystemContext()` — an
explicit, audited entry point that binds `SystemContext` instead of
`TenantContext`. The decision is opt-in (must be invoked deliberately)
and traceable via `git grep`.

**Files:**

- `apps/api/src/security/tenantContext.ts`
- `infra/prisma/src/extensions/tenantGuard.ts`
- Tenant-scoped models registry: `TENANT_SCOPED_MODELS` Set in
  `infra/prisma/src/extensions/tenantGuard.ts`.

### Layer 2 — PostgreSQL Row Level Security (RLS) (S2.1c)

A Postgres-level backstop independent of the application-layer middleware.
Each of the 51 tenant-scoped tables receives:

```sql
ALTER TABLE "<Model>" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "<Model>"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
```

The `app.account_id` Postgres GUC is bound at transaction start by
`PrismaUnitOfWork.executeInTransaction` via
`set_config('app.account_id', <value>, true)`, reading the bound
`TenantContext` / `SystemContext`. Three states:

- **TenantContext active** → real `accountId`. RLS returns only matching
  rows.
- **SystemContext active** → sentinel `'__system__'`. RLS passes for
  every row.
- **No context bound** → GUC unset. `current_setting('app.account_id', true)`
  returns NULL. The USING/CHECK clause evaluates `NULL = NULL` → fails;
  zero rows visible, no inserts/updates. **Fail-closed.**

`AIPromptTemplate` has an extended USING that additionally allows
`accountId IS NULL` (global system templates visible to every tenant).
WITH CHECK retains the strict form — only the system context can write
NULL `accountId` rows.

Runs through a non-superuser role in production. Superusers and
BYPASSRLS roles skip RLS entirely; the integration test
(`apps/api/tests/integration/rls-tenant-isolation.test.ts`) creates a
non-superuser `rls_test_role` and `SET LOCAL ROLE` to exercise the
production code path.

**Files:**

- `infra/prisma/migrations/20260527000000_add_rls_tenant_isolation/migration.sql`
- `apps/api/src/unitofwork/PrismaUnitOfWork.ts` (set_config binding)

### Layer 3 — Fitness function #23 (S2.1d, ratchet to hard-zero)

Grep-based static check, runs on every push and pull_request. Flags:

```
prisma.<tenantTable>.findMany|findFirst|update|delete
```

inside repository adapters without `accountId` in the `where` clause.
Excludes the tenant guard extension itself, the composition root, and
test files. Hard-zero in CI today (S2.1d).

Also blocks **raw Prisma queries** (`$queryRaw`, `$executeRaw`,
`$queryRawUnsafe`, `$executeRawUnsafe`) outside the guard extension —
raw SQL bypasses `$extends` and is the carrier for the historical
pgvector breach (fixed in S2.1d via explicit `AND "accountId" = ...`
clauses in `PrismaStyleGuideRuleRepository` and
`PrismaGlossaryRepository`).

**File:** `.github/workflows/fitness.yml` (rules #1 + #23) + the regex
documented in `CLAUDE.md §Automated Compliance Checks`.

## Rationale

### Why three layers and not one stronger one?

| Approach          | Failure mode if alone                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Only $extends     | Raw queries (`$queryRaw`) bypass the extension entirely.                        |
| Only RLS          | Superuser/BYPASSRLS roles skip RLS. Dev env often runs as `postgres` superuser. |
| Only fitness grep | Regex misses dynamic builders, ORM-generated SQL, runtime composition.          |

Each layer catches the others' failure modes. Three layers ≠ three times
the cost — the cost is dominated by Layer 1 (the $extends middleware) which
is also the most user-friendly (auto-injects the filter; no test churn).
Layers 2 and 3 are configured once and run forever.

### Why the migration scope (51 tables)?

The tenant-scoped table list comes from the `TENANT_SCOPED_MODELS` Set
in `infra/prisma/src/extensions/tenantGuard.ts`. The criterion is binary:
_"Does this model have an `accountId` column (or a transitive one via a
parent relation that does)?"_. Models without `accountId` (Account itself,
provider catalog, global system tables) are explicitly out of scope and
not in the Set.

When adding a new model:

1. Append the lowerCamel model name to `TENANT_SCOPED_MODELS`.
2. Append the PascalCase table name to the RLS migration (or add a new
   migration that ALTERs the table to enable RLS).
3. Document in `docs/security/MULTI_TENANT_GUARDS.md`.

The 3-step checklist is enforced by code review; fitness #23 catches
queries that bypass the extension but doesn't catch missing-from-Set
oversights.

### Why `set_config(..., true)` and not a connection-level setting?

`set_config('app.account_id', <value>, true)` is **transaction-local**;
the GUC resets at COMMIT/ROLLBACK. This is essential because Prisma's
connection pool reuses connections across requests. A connection-level
setting would leak: tenant A's request returns, the connection goes back
to the pool, tenant B picks it up with A's GUC still set. The
transaction-local form is reset before B sees the connection.

## Alternatives Considered

### A. Single-layer Prisma middleware only

**Rejected.** Raw queries bypass the extension entirely, and the pgvector
breach was found via a separate audit (`MULTI_TENANT_AUDIT_2026-05-27.md`).
Single-point-of-failure for a P0 threat.

### B. RLS only, skip the application layer

**Rejected.** Dev environments run as `postgres` superuser; RLS would be
bypassed locally, hiding cross-tenant bugs until prod. Layer 1 catches
those at the application layer regardless of database role.

### C. JSONB-encoded accountId in every row

**Rejected.** Schema disruption proportional to value (high refactor cost,
zero new properties caught). The `accountId` column already exists per
model — leveraging it is cheaper.

### D. Per-tenant database / schema

**Rejected.** Operational complexity (51 schemas per tenant, migration
fan-out, backup restore complexity, cross-tenant analytics impossible).
Single-DB + RLS is the canonical pattern for SaaS multi-tenancy at this
scale.

## Consequences

### Positive

- Cross-tenant data leak is now blocked at three independent layers; a
  P0 threat moves from "depends on every dev remembering" to "depends on
  multiple coordinated mistakes".
- The `withSystemContext()` opt-in pattern is auditable via `git grep`.
- RLS provides a hard line: even a malicious code change inside the
  application can't make Postgres return cross-tenant rows (unless the
  attacker controls the GUC binding, which requires application-server
  compromise).
- Pre-acquisition diligence checkers find the controls documented and
  enforced.

### Negative

- Three layers = three test surfaces. New tenant-scoped models require
  the 3-step checklist or lose protection silently.
- Raw queries are tightly restricted (fitness #23). Two legitimate cases
  exist today (pgvector UPDATE in `PrismaStyleGuideRuleRepository` and
  `PrismaGlossaryRepository`) and require manual audit; documented in
  `MULTI_TENANT_AUDIT_2026-05-27.md`.
- RLS in dev with the `postgres` superuser silently bypasses; the
  integration test forces a non-superuser role explicitly.

## Revisit if

- A new tenant-scoped model is added without updating the registry → the
  $extends middleware will throw `TenantContextMissingError`, but only on
  the first query in tests. Spot-check: run the audit grep against
  schema.prisma vs `TENANT_SCOPED_MODELS` periodically.
- Connection pool semantics change in Prisma 8.x or later — the
  transaction-local GUC binding may need re-validation.
- A new query path (e.g., a stored-procedure caller, an external SQL
  client) emerges that bypasses Prisma — fitness #23 will not catch it.
  Audit retroactively per `MULTI_TENANT_AUDIT_<date>.md`.

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Dev runs as superuser → RLS bypassed locally                         | Integration test creates non-superuser role explicitly; CI runs with the same role.                    |
| Connection pool leak (cross-request GUC contamination)               | `set_config(..., true)` is transaction-local — automatic reset at COMMIT/ROLLBACK.                     |
| Raw SQL outside the extension → both layers 1 and 3 bypassed         | Fitness #23 hard-zero on raw queries outside the guard. Two documented exceptions audited per quarter. |
| New tenant model added without updating `TENANT_SCOPED_MODELS`       | $extends middleware throws on first query if no context bound; CI tests catch in dev.                  |
| `app.account_id` GUC unset → silent zero-row return (denial of work) | Documented behavior. Application layer enforces the binding via `PrismaUnitOfWork`; absence is a bug.  |
| pgvector / raw query audit drift                                     | `docs/security/MULTI_TENANT_AUDIT_<date>.md` cadence; quarterly audit documented and committed.        |

## References

- [docs/security/MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) — detailed strategy + 51-table list + runbooks (canon source for this ADR)
- [docs/security/MULTI_TENANT_AUDIT_2026-05-27.md](../security/MULTI_TENANT_AUDIT_2026-05-27.md) — retroactive audit and pgvector fix
- [docs/architecture/NORMALIZATION_ROADMAP.md](../architecture/NORMALIZATION_ROADMAP.md) — §2.1 closure
- [CWE-639: Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html)
- PostgreSQL Row Security Policies — [https://www.postgresql.org/docs/current/ddl-rowsecurity.html](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- OWASP A01:2021 Broken Access Control
- ADR-0005 (Unit of Work) — the host where `set_config` is bound
- ADR-0007 (DI Composition Root) — where `TenantContext` is bound by the auth middleware
- ADR-0012 (Fitness Functions) — host doc for fitness #23
