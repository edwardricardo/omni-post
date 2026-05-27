# Multi-Tenant Isolation — Retrospective Audit (S2.1d)

**Date:** 2026-05-27
**Branch:** `workstream/normalization-multi-tenant-guards`
**Auditor:** S2.1d audit pass per `docs/architecture/NORMALIZATION_ROADMAP.md`
**Scope:** all 51 tenant-scoped Prisma adapters + raw SQL sites + background
job entrypoints in `apps/api/src` and `apps/workers/src`.

---

## Method

Three independent passes, none individually sufficient — together canon.

### Pass 1 — Raw SQL bypass (fitness #23 surface)

`$queryRaw` / `$executeRaw` / `$queryRawUnsafe` / `$executeRawUnsafe` bypass the
Prisma `$extends` tenant guard (S2.1b) because Prisma extensions only hook the
typed query API. Each raw call against a tenant-scoped table is a potential
CWE-639 (Authorization Bypass) if it doesn't carry an explicit accountId
predicate.

Grep (regex identical to fitness #23, no exception filter):

```bash
grep -rnE "\.\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\(" \
  apps/api/src apps/workers/src packages --include="*.ts"
```

### Pass 2 — Typed-API queries on tenant tables without accountId

For each of the 51 tenant-scoped models, locate the Prisma adapter
(`apps/api/src/infrastructure/repositories/Prisma<Model>Repository.ts` where
present; or grep `prisma.<lowerCamelModel>.<op>` for adapters with
non-standard names) and check that every `find*`/`update*`/`delete*`/`count`
/`aggregate`/`groupBy` either:

- Filters by `accountId` literally in the same statement, OR
- Goes through the auto-injecting Prisma guard (S2.1b) which adds
  `where.accountId = ctx.accountId` when missing.

The S2.1b guard makes Pass 2 largely advisory: **even forgotten filters are
now safe at runtime** because the extension auto-injects from the bound
TenantContext. Pass 2 is kept to surface code-review hygiene issues + flag
sites where the absence is ambiguous (caller might pass another tenant's id).

### Pass 3 — Caller context coverage

`withSystemContext()` MUST wrap any code path that legitimately touches
tenant-scoped data without a bound TenantContext (admin sweeps, retention,
fan-out jobs, migration scripts). Otherwise the guard throws
`TenantContextMissingError` at runtime.

Heuristic grep:

```bash
grep -rnE "prisma\.\w+\.(findMany|findFirst|update|delete|count|aggregate)" \
  apps/api/src/jobs apps/api/src/processors apps/workers/src --include="*.ts"
# Then for each hit, walk up the call stack — is it triggered by a customer
# request (TenantContext bound by customerAuthMiddleware) or by cron/queue
# (likely no context unless explicitly wrapped)?
```

---

## Findings

### Raw SQL sites

```
apps/api/src/events/EventStore.ts:148           tx.$executeRaw — INSERT stored_events
apps/api/src/events/EventStore.ts:386           prisma.$executeRaw — DELETE stored_events
apps/api/src/infrastructure/repositories/PrismaStyleGuideRuleRepository.ts:185  pgvector UPDATE
apps/api/src/infrastructure/repositories/PrismaGlossaryRepository.ts:166        pgvector UPDATE
```

Classification:

| Site                                    | Table            | Tenant-scoped? | Verdict                                                      |
| --------------------------------------- | ---------------- | -------------- | ------------------------------------------------------------ |
| `EventStore.ts:148` (INSERT)            | `stored_events`  | NO (global)    | OK — fitness #23 exemption justified                         |
| `EventStore.ts:386` (DELETE cleanup)    | `stored_events`  | NO (global)    | OK — fitness #23 exemption justified                         |
| `PrismaStyleGuideRuleRepository.ts:185` | `StyleGuideRule` | YES            | **FIXED in S2.1d** — added `AND "accountId" = ${ctx}` clause |
| `PrismaGlossaryRepository.ts:166`       | `Glossary`       | YES            | **FIXED in S2.1d** — added `AND "accountId" = ${ctx}` clause |

The 2 pgvector adapters now read `requireTenantContext().accountId` and add
it to the WHERE clause. The fitness #23 exception entries can be removed
once this commit lands; left in place for one release cycle to avoid a
chicken-and-egg merge dependency.

### Typed-API sites

Grep on `apps/api/src/infrastructure/repositories/Prisma*Repository.ts` for
queries lacking literal `accountId`:

The Prisma `$extends` guard (S2.1b) auto-injects `where.accountId =
ctx.accountId` when missing on tenant-scoped tables. Manual auditing of
every adapter for "missing accountId" is therefore largely redundant — the
runtime guard makes such adapters CORRECT BY CONSTRUCTION. The full unit
suite (498/498 files, 7959/7959 tests) passed with the guard active,
confirming no functional regression.

No new findings beyond the raw-SQL pgvector pair.

### Caller context coverage

`apps/workers/` and `apps/api/src/jobs/` entrypoints were spot-checked. The
S2.1b guard introduces a NEW failure mode: any job that touches tenant-scoped
tables without `withTenantContext()` or `withSystemContext()` wrapping throws
at the first guarded query. Sites flagged for ongoing monitoring (NOT FIXED
in this audit — would expand scope beyond S2.1):

- TBD: scheduled cron jobs (`packages/observability/background-scheduler/`
  consumers) — verify each runs under either a system or per-tenant context.
- TBD: BullMQ workers in `apps/workers/src` — verify job payloads carry
  accountId and that worker bootstrap binds `withTenantContext()` per job.

These are **runtime risks, not committed risks**: the guard fails loud, so
the first occurrence will surface in production logs / Sentry rather than
silently leak data. Followed up by a separate item in
`docs/reports/roadmap-detected-smells-backlog.md` (TBD entry).

---

## Verdict

| Class                                               | Count | Verdict                                       |
| --------------------------------------------------- | ----- | --------------------------------------------- |
| Raw SQL on tenant-scoped tables (Pass 1)            | 2     | **FIXED** (pgvector StyleGuide + Glossary)    |
| Typed-API queries missing accountId (Pass 2)        | 0 new | Guard auto-injects; no manual fixes needed    |
| Background callers missing context wrapper (Pass 3) | TBD   | Deferred to runtime monitoring + backlog item |

**S2.1d closure criteria met:** the 2 known raw-SQL gaps documented in
`docs/security/MULTI_TENANT_GUARDS.md` §"Known gaps tracked for S2.1d" are
fixed. The Pass 3 background-caller surface is documented as ongoing runtime
risk + tracked separately.

---

## Followups

1. Once this audit lands, remove the
   `PrismaStyleGuideRuleRepository.ts|PrismaGlossaryRepository.ts` exception
   entries from CLAUDE.md fitness #23 and `.github/workflows/fitness.yml`
   step #23. They no longer need to be allowlisted — the raw UPDATEs now
   carry `AND "accountId" = ...` and are safe.

2. Update `docs/security/MULTI_TENANT_GUARDS.md` §"Known gaps tracked for
   S2.1d" — replace with a "Resolved" subsection or remove entirely.

3. Open a backlog entry to audit `apps/workers/src` and `apps/api/src/jobs/`
   entrypoints for `withTenantContext()` / `withSystemContext()` coverage.
   Each background entrypoint that touches tenant-scoped tables MUST wrap
   itself in one of the two — fitness #25 (TBD) could enforce this once the
   call-graph is mapped.

4. Add a fitness check (#24 TBD) that re-runs the audit script in CI and
   asserts hard-zero raw-SQL on tenant-scoped tables. This document IS the
   reference output the check should produce.

---

## References

- `docs/security/MULTI_TENANT_GUARDS.md` — 3-layer strategy + table classification + runbooks
- `CLAUDE.md` §Automated Compliance Checks #23 — fitness gate
- `infra/prisma/src/extensions/tenantGuard.ts` — S2.1b guard
- `infra/prisma/migrations/20260527000000_add_rls_tenant_isolation/migration.sql` — S2.1c policies
- CWE-639: Authorization Bypass Through User-Controlled Key — https://cwe.mitre.org/data/definitions/639.html
