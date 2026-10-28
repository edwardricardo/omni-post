# Delta for Multi-Tenant Isolation

> Extends the living `multi-tenant-isolation` capability along the **COVERAGE**
> dimension (guarded client + established context), distinct from model
> ENROLLMENT. Implements ADR-0020. Chained delivery: **PR1** adds the context
> seams (no client swap); **PR2** swaps to the guarded client, adds fitness #28
> and the two-tenant tests. Seams MUST land before (or atomically with) the swap.

## ADDED Requirements

### Requirement: Every enrolled-model surface establishes a context at its entry boundary [MERGE-BLOCKING]

No surface in the api deployable SHALL reach a guarded query on an enrolled model
without an established context. Each boundary CLASS SHALL bind its context at the
framework seam — never inside handler, use-case, or repository code:

| Boundary class                                                                                        | Seam                                                                                         | Context                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Authenticated customer routes                                                                         | `customerAuthMiddleware` (already binds)                                                     | tenant (session)                       |
| Pre-auth SSO (SAML + OIDC metadata/login/callback)                                                    | one route-group `preHandler` per plugin → `enterTenantContext(params.accountId)`             | tenant (URL `:accountId`)              |
| Admin routes on enrolled models                                                                       | admin boundary rule: account-scoped → tenant from target; genuinely-global → declared system | tenant or declared system              |
| Background (TRIAGE_INBOX, TREND_RADAR, mention search/reconcile dispatch ×2, tenant-health bootstrap) | consumer-adapter / scheduler / bootstrap wrapper                                             | declared system or per-tenant from job |

#### Scenario: pre-auth SSO config lookup is scoped, not context-less [integration]

- GIVEN an anonymous SSO request whose URL carries tenant B's `:accountId`
- WHEN a SAML/OIDC metadata/login/callback route reads B's enrolled config
- THEN it does NOT raise `TenantContextMissingError`, returns B's config, and CANNOT read another account's config

#### Scenario: an admin op on an enrolled model runs with context [integration]

- GIVEN an admin-authenticated request touching an enrolled model (SSO admin, webhook-secret rotation)
- WHEN the handler issues the guarded query
- THEN a context is bound at the admin boundary and no `TenantContextMissingError` is raised

#### Scenario: each background surface runs without a missing context [integration]

- GIVEN the TRIAGE_INBOX consumer, TREND_RADAR consumer, both mention dispatch surfaces, and the tenant-health bootstrap
- WHEN each executes an enrolled-model query
- THEN each runs inside its declared context wrapper and NONE raises `TenantContextMissingError`

#### Scenario: no enrolled-model surface is reachable context-less [static]

- GIVEN the change is applied
- WHEN the context-at-boundary fitness (or boot-time assertion) enumerates api boundaries
- THEN every enrolled-model surface establishes a context, and a context-less boundary FAILS CI

### Requirement: The guarded client is the only Prisma client injected in the api deployable [MERGE-BLOCKING]

Every repository, adapter, and factory in `apps/api` SHALL receive the guarded
client (`container.resolve(TOKENS.PrismaClient)`); NO raw `@infra/prisma`
singleton SHALL be injected into a constructor in `container/` or `index.ts`.
Fitness **#28** (raw-singleton injection) SHALL be hard-zero.

#### Scenario: fitness #28 finds no raw-singleton injection [static]

- GIVEN the swap (PR2) is applied
- WHEN fitness #28 scans `apps/api/src` `container/` + `index.ts` for a bare `prisma` passed to a constructor
- THEN the count is **0**

#### Scenario: a previously-raw module is auto-scoped without a where-clause [integration]

- GIVEN tenant A's context is bound and a previously-raw module's route (e.g. brand-voice / asset) reads an enrolled model that also has rows for tenant B
- WHEN the guarded query runs
- THEN it returns ZERO of B's rows, with NO hand-written `where: { accountId }` clause

### Requirement: withSystemContext is the declared boundary exception, not the default [MERGE-BLOCKING]

`withTenantContext` SHALL be the default at every boundary. `withSystemContext`
SHALL be used ONLY for genuinely-global operations, declared explicitly AT the
boundary seam (scheduler / relay / bootstrap), never scattered in business or
repository code. The set of system-context surfaces SHALL be enumerable.

#### Scenario: every system-context use is declared at a boundary [static]

- GIVEN the change is applied
- WHEN all `withSystemContext(...)` call-sites are enumerated
- THEN each is a boundary seam for a genuinely-global surface, and NONE appears in handler/use-case/repository business logic

#### Scenario: a declared-global surface runs under system context [integration]

- GIVEN a genuinely-global background surface (e.g. a cross-tenant scheduler sweep) declared with `withSystemContext`
- WHEN it queries an enrolled model
- THEN it runs unscoped by design and does NOT raise `TenantContextMissingError`

### Requirement: Transaction clients inherit the guard extension [MERGE-BLOCKING]

Interactive-transaction (`itx`) and `$transaction` clients derived from the
guarded client SHALL carry the `$extends` guard, so enrolled-model queries inside
a transaction remain auto-scoped to the bound context.

#### Scenario: a query inside a transaction stays tenant-scoped [integration]

- GIVEN tenant A's context is bound and an enrolled-model query runs inside an `itx` / `$transaction` block, with rows for both A and B
- WHEN the transactional query executes
- THEN only A's rows are visible/affected — identical to a non-transactional guarded query
