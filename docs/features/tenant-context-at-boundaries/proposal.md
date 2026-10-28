# Proposal: Tenant context at boundaries (reshaped Slice 6, N-SEC-3)

> Implements **ADR-0020**. Supersedes the drafted approach in
> `openspec/changes/api-guarded-client-injection/` — the guarded-client injection and
> fitness #28 survive; the per-call `withSystemContext` wrapping is replaced by
> context established at entry boundaries.

## Why

The tenant guard (`infra/prisma/src/extensions/tenantGuard.ts`) only protects code that
runs the **guarded** client (`TOKENS.PrismaClient`) **with a `TenantContext` bound**. Two
coverage gaps break that premise (engram `tenant-guard/slice6-coverage-gap`):

- **Client gap** — ~12 `apps/api` container `setup*UseCases` modules construct repositories
  with the **raw** `@infra/prisma` singleton, so layer 1 never runs for them.
- **Context gap** — several surfaces on the guarded client run with **no** `TenantContext`:
  pre-auth SSO routes (accountId from URL), admin routes (`adminAuthMiddleware` binds no
  context), and background surfaces (consumers, scheduler, saga, bootstrap).

Putting a context-less surface on the guarded client throws `TenantContextMissingError` at
runtime — a fail-closed **outage** invisible to a green `0/0` gate. An adversarial design
gate proved the naive "swap + scatter `withSystemContext` wraps" approach would 500 **every
enterprise SSO login** in production. ADR-0020 records the accepted root fix: **establish
context once at every entry boundary**; never patch per call-site.

## What changes

Close both gaps by the ADR-0020 principle: every enrolled-model query runs on the guarded
client **and** inherits a context established at its entry boundary. `withTenantContext` is
the default (uses + enforces the guard); `withSystemContext` survives only as the rare,
explicit, declared exception for genuinely-global operations.

### Boundary-seam inventory (api deployable)

| Boundary class                                                                                    | Seam                                                                                                            | Context                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Authenticated customer routes                                                                     | `customerAuthMiddleware` (already binds)                                                                        | tenant (session)                         |
| Pre-auth SSO (SAML+OIDC metadata/login/callback)                                                  | **one `preHandler` per route plugin** → `enterTenantContext(params.accountId)`                                  | tenant (URL `:accountId`)                |
| Admin routes on enrolled models (SSO admin, webhook secret rotation)                              | context rule at the admin boundary — account-scoped op → tenant from target; genuinely-global → declared system | tenant or declared system                |
| Background: TRIAGE_INBOX, TREND_RADAR, mention-search/reconcile dispatch, tenant-health bootstrap | consumer-adapter / scheduler / bootstrap wrapper                                                                | system (declared) or per-tenant from job |

The 11 SSO surfaces collapse into **2 preHandlers** (one per plugin), not 11 wraps — every
SAML/OIDC route already carries `:accountId` in its path. This is the clean seam the ADR
prescribes.

### Guarded-client injection (surviving from the old draft)

Swap **all** raw-injecting api modules to `container.resolve(TOKENS.PrismaClient)`. Under
boundary context every module is now safe to swap, including SSO/webhook-admin (their
boundaries bind context). Audit verdicts:

- **CLEAN-SWAP** (surfaces already tenant-bound / model not enrolled): setupCrmUseCases,
  setupAssetUseCases, setupBrandKitUseCases, setupLocalizedGenerationUseCases,
  setupCustomReportUseCases, setupBrandVoiceUseCases, setupSecretsRotationUseCases.
- **Swap + boundary seam**: setupSamlUseCases (SSO preHandler), setupWebhookAdminUseCases
  (admin context), setupInboxUseCases + setupTrendUseCases + bootstrap (background seams).
- **setupReferralUseCases** — swapped is harmless, but it is **DEAD** (4 use cases
  registered, resolved by zero surfaces) → flagged to backlog (forgotten-feature 3-question
  audit), NOT wired to "cover" it.

### Fitness invariants (hard-zero)

- **#28** — gate raw-singleton **injection** (a bare `prisma` passed to a repo/adapter/factory
  constructor in `container/` + `index.ts`), closing the #21 loophole (#21 gates import
  location, not injection). Baseline (grep-verified in design) → 0.
- **Context-at-boundary invariant** — a fitness (or a boot-time assertion / test) that fails
  if an enrolled-model surface can be reached without an established context. Exact mechanism
  is a design decision; the goal is that a future context-less boundary fails CI, not prod.

## Slicing recommendation + Review Workload Forecast

The boundary approach unifies the old 6a (injection) + 6b (background wraps) into one
coherent **api-side** change, too large for a single reviewable PR. Recommended: a
**chained pair**, ordered so the tree is never in a broken state.

| Field                               | Value                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Estimated changed lines (api total) | ~600–750 (seams ~120, swap ~40, fitness ×2 ~40, tests ~250, docs ~60, openspec ~200) |
| 400-line budget                     | **Exceeds** → chained PRs                                                            |
| Chain strategy                      | **feature-branch-chain** (rollback control on a security change)                     |

- **PR 1 — Establish context at every api boundary** (no client swap). Add the SSO
  route-group preHandlers, the admin context rule, the consumer/scheduler/bootstrap system
  wraps, and the context-at-boundary fitness. Safe by construction: binding a context that
  the still-raw client ignores changes no behavior; verifiable independently (assert every
  boundary binds a context). This PR makes the codebase context-complete.
- **PR 2 — Swap to the guarded client + fitness #28** (depends on PR 1). Now every surface
  has context, so the swap cannot throw. Add the two-tenant integration tests (including the
  admin + pre-auth SSO surfaces the old design missed) and the itx-inheritance test; wire
  into the `integration:tenant-isolation` batch.

**Ordering is load-bearing**: context seams MUST land before (or atomically with) the swap.
Chaining PR2 on PR1 enforces it.

### Slice 6-workers (separate, later — not this change)

Extract `apps/api/src/security/tenantContext.ts` to a shared package (**single ALS holder —
must not fork**), wrap `workerPrisma` with the guard, establish per-job context, and fix the
mention cross-tenant dedup (`@@unique([provider, externalId])` global → collision). **Blocked
on Edward's product decision**: is one mention row per public post global (today), or should
each tenant get its own (→ `@@unique([accountId, provider, externalId])`)?

## Non-Goals

Slice 6-workers + mention fix (blocked); RLS `FORCE` + `omnipost_app` role provisioning
(own infra ADR); Channel enrollment (Slice 7); Post enrollment (Slice 8); SMELL-55 sibling
routes (blocked on delete-gate merge); `setupReferralUseCases` dead-code disposition (backlog
flag); the tenant-health endpoint's missing per-tenant auth (IP-allowlist-gated observation).

## Risks

- **ALS single-holder extraction** (workers slice): a second `AsyncLocalStorage` instance =
  a context the guard cannot see. The shared package must export the one holder.
- **Missing a boundary**: reintroduces the outage. Mitigated by the context-at-boundary
  fitness + the fail-closed guard (a missed boundary fails loud in dev/CI, never silent in
  prod) + the completed surface audit.
- **Admin context semantics**: some admin ops are genuinely global (list-all) and correctly
  take `withSystemContext`; the design must classify each admin surface, not blanket-wrap.

## Open questions

1. Mention `@@unique` semantics (blocks the workers slice) — product decision.
2. `setupReferralUseCases` dead-code — confirm it is abandoned before backlog disposition.
