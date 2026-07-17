# Delta for multi-tenant-isolation — Slice 6a: Guarded Client Injection Reach

> Slices 1–5 enrolled models (ENROLLMENT = `accountId` + `TENANT_SCOPED_MODELS` + RLS).
> Slice 6a adds a distinct COVERAGE dimension: the guard only protects a query when the
> client executing it is the guarded `TOKENS.PrismaClient`. This delta gates that the api
> deployable INJECTS the guarded client into every repository/adapter, so enrolled-model
> isolation no longer rests on hand-written `where: { accountId }` clauses (CWE-639). No
> model is enrolled here; the "Enrolled models" table is unchanged. Tags follow the living
> taxonomy: **[MERGE-BLOCKING]**, **[static]**, **[integration]**.

## ADDED Requirements

### Requirement: The guarded client is the only Prisma client injected in the api deployable [MERGE-BLOCKING]

Every repository, adapter, and factory constructed in the api composition root
(`apps/api/src/infrastructure/container/**` and the `index.ts` bootstrap) that touches an
enrolled model SHALL receive the guarded `TOKENS.PrismaClient`, NOT the raw `@infra/prisma`
singleton. Raw-singleton injection SHALL be a fitness-gated violation. Consequently,
enrolled-model isolation on these surfaces' request-scope routes SHALL hold by the guard
alone, with NO reliance on a hand-written `where: { accountId }` clause.

#### Scenario: no raw-client injection remains [static]

- GIVEN the change is applied
- WHEN fitness #28 runs (Part A: container value-imports of raw `prisma`; Part B: a bare `prisma` identifier passed to a constructor/factory in `apps/api/src`, tests and JSDoc excluded)
- THEN both parts count **0** (every pre-fix raw value-import and raw-injection site in `container/` + `index.ts` is eliminated; the exact grep-verified baseline is recorded in the design, scoped to composition roots to avoid false positives on already-guarded locals)

#### Scenario: a previously-raw route is guard-scoped without an explicit ownership check [integration]

- GIVEN tenant A is authenticated and tenant B owns rows of an enrolled model served by a previously-raw module (e.g. brand-voice or asset)
- WHEN A calls that module's list/read route carrying B's `projectId`
- THEN the response contains ZERO of B's rows, scoped by the guard, even with no hand-written `accountId` filter in the route

### Requirement: Every swapped out-of-context surface binds a system context [MERGE-BLOCKING]

Swapping a surface from the raw singleton to the guarded client SHALL NOT introduce a
runtime `TenantContextMissingError`. Every swapped surface that runs WITHOUT a request-bound
`TenantContext` SHALL execute inside an explicit `withSystemContext(...)` wrap. This applies
to: the `tenantHealthMonitor.getTenantHealth` bootstrap call, the in-process TRIAGE_INBOX and
TREND_RADAR consumers, and the mention-search dispatch. The wrap grants REACH, not
authorization — it SHALL NOT mask any existing ownership check.

#### Scenario: each swapped surface runs without a missing-context error [integration]

- GIVEN the guarded client is injected into the tenant-health monitor, the TRIAGE_INBOX and TREND_RADAR consumers, and the mention-search dispatch
- WHEN each surface executes its enrolled-model query with no request context
- THEN each runs inside `withSystemContext(...)` and NONE raises `TenantContextMissingError`

#### Scenario: the system-context wrap does not weaken ownership enforcement [integration]

- GIVEN the tenant-health path is wrapped in `withSystemContext(...)`
- WHEN it resolves a tenant↔project pair the caller does not own
- THEN `verifyProjectAccess` still rejects the mismatch — the wrap does not mask the ownership check

#### Scenario: no swapped surface is left out of context [static]

- GIVEN the change is applied
- WHEN every swapped call site is enumerated
- THEN each runs behind a request `TenantContext` or an explicit `withSystemContext(...)` wrap

### Requirement: Interactive-transaction clients inherit the guard extension [MERGE-BLOCKING]

The Prisma client passed to an interactive `$transaction` callback by `PrismaUnitOfWork` SHALL
carry the `$extends` tenant guard, so reads and writes issued inside `executeInTransaction` are
auto-scoped identically to non-transactional queries. This documented assumption SHALL become a
verified invariant.

#### Scenario: a guarded query inside a transaction is tenant-scoped [integration]

- GIVEN tenant A's context is bound and rows of an enrolled model exist for A and B
- WHEN a find/write on that model runs inside `executeInTransaction`
- THEN only A's rows are visible/affected, and the same query with no bound context fails with `TenantContextMissingError`

#### Scenario: guard documentation carries no stale hardcoded table count [static]

- GIVEN the change is applied
- WHEN the `PrismaUnitOfWork.ts` comment (:71) is inspected
- THEN it uses count-free wording — no literal "51 tenant-scoped tables"

## Non-Goals (out of this slice)

- **6b** — standalone `withSystemContext` wraps for the 8 non-swapped background surfaces (saga sweeps, gateway-switch, integration-event relay, data-retention, auto-renewal, inbox-sync, repurpose, bulk-schedule).
- **6c** — `apps/workers` deployable guard enrollment and the mention cross-tenant dedup uniqueness fix (composite-unique migration, blocked on a product decision).
- RLS FORCE / `omnipost_app` role provisioning; SMELL-55 sibling routes; Channel (Slice 7) and Post (Slice 8) enrollment.
- The tenant-health endpoint's missing per-tenant AUTH (IP-allowlist-gated) — a separate observation, NOT this slice.
