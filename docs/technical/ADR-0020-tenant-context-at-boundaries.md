# ADR-0020: Tenant context is established at entry boundaries (AsyncLocalStorage), never patched per call-site with `withSystemContext`

- **Status**: Accepted
- **Date**: 2026-07-16
- **Deciders**: Edward Velasquez
- **Supersedes**: — (reshapes the wrapping approach drafted in the Slice-6a design; see "Relationship to the tenant-guard rollout")
- **Superseded by**: —

## Context

The multi-tenant isolation guard (`infra/prisma/src/extensions/tenantGuard.ts`) is a
Prisma `$extends` layer. On any guarded operation against an **enrolled** model
(`TENANT_SCOPED_MODELS`, 57 models), it reads the ambient `TenantContext` (an
`AsyncLocalStorage` holder in `apps/api/src/security/tenantContext.ts`) and:

- injects/validates `accountId` when a `TenantContext` is bound, or
- runs unscoped when a `SystemContext` is bound (`withSystemContext`, the sanctioned
  cross-tenant escape hatch), or
- **throws `TenantContextMissingError` when neither is bound** — fail-closed by design.

The guard therefore only protects code that runs the **guarded** client (registered as
`TOKENS.PrismaClient` in the composition root) **with a context bound**. Two coverage
gaps were found while extending the rollout (engram `tenant-guard/slice6-coverage-gap`):

1. **Client gap.** The entire `apps/workers` deployable and ~12 `apps/api` container
   `setup*UseCases` modules construct repositories with the **raw** `@infra/prisma`
   singleton instead of the guarded client, so layer 1 never runs for them.
2. **Context gap.** Even on the guarded client, many surfaces run with **no**
   `TenantContext`:
   - **Pre-authentication routes** — SSO SAML/OIDC `metadata`/`login`/`callback`
     take `accountId` from the URL; the user is not logged in, so no middleware
     binds a context.
   - **Admin routes** — `adminAuthMiddleware` binds **no** `TenantContext` (verified);
     every admin handler touching an enrolled model is context-less.
   - **Background surfaces** — BullMQ consumers, scheduler ticks, saga steps, worker
     job handlers, and bootstrap code run outside any request.

Putting a context-less surface on the guarded client makes it throw
`TenantContextMissingError` at runtime — a fail-closed **outage**, not a leak, but an
outage invisible to a green `0/0` gate because tests exercise context-bound customer
routes. An adversarial design gate caught exactly this: swapping the SSO modules to the
guarded client would have 500'd **every enterprise SSO login** in production while every
lint/type/test/fitness check stayed green.

The tempting fix is to wrap each offending call-site in `withSystemContext(...)`. This
ADR rejects that and records the clean alternative, so this class of problem is solved
once — by principle — and never re-patched.

## Decision

**Tenant (or system) context is established exactly once at every ENTRY BOUNDARY, as a
declared property of that boundary. No enrolled-model query anywhere downstream runs
without a context, and business/repository code never contains an ad-hoc
`withSystemContext` wrap to "make the guard stop throwing".**

Boundaries and their context source:

| Boundary                                                | Context established                                     | Source of `accountId`               |
| ------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| Authenticated customer route                            | `withTenantContext` (already: `customerAuthMiddleware`) | authenticated session               |
| Pre-auth route (SSO metadata/login/callback)            | `withTenantContext`                                     | the route's `:accountId` path param |
| Admin route, account-scoped                             | `withTenantContext`                                     | the operation's target `accountId`  |
| Admin route, genuinely global (list-all / aggregate)    | `withSystemContext` — **declared on that route**        | n/a                                 |
| BullMQ consumer / worker job (single tenant)            | `withTenantContext`                                     | `job.data.accountId`                |
| Scheduler / saga sweep / relay (genuinely cross-tenant) | `withSystemContext` — **declared at the boundary**      | n/a                                 |

The context is established at the **framework seam** — a Fastify `preHandler` on the
route group, the consumer-adapter wrapper, the scheduler registration, the worker job
runner — not sprinkled through handlers or repositories. `withTenantContext` is the
default; `withSystemContext` survives **only** as the rare, explicit, code-reviewed
exception for operations that are genuinely global.

Complementary invariant (already in flight, kept): every deployable's composition root
wraps its Prisma client with the guard, and every repository/adapter receives the
**guarded** client by injection — enforced by a fitness function that gates raw-singleton
**injection**, not just import location.

## Rationale

- **Fail-safe by construction.** A new route/consumer cannot be silently context-less:
  it inherits its boundary's context, or it is a compile/boot-visible omission — never a
  production `500`. The guard's throw becomes a true safety net that should only ever fire
  in dev.
- **Enforcement, not bypass.** `withTenantContext(accountId-from-URL)` for SSO _uses_ the
  guard — the config read is scoped to that account and physically cannot read another
  account's config — whereas `withSystemContext` would _disable_ the guard for that
  surface, defeating the very reason the model was enrolled. The clean fix is also the
  _safer_ one.
- **Locality of reasoning.** Context is a property of "how you entered", which is exactly
  a boundary concern. Answering "is this query tenant-scoped?" requires reading one
  boundary, not auditing N call-sites.
- **The `AsyncLocalStorage` idiom, done right.** ALS is designed for exactly this:
  establish the ambient value at the async entry point; everything below inherits it.
  Per-call wrapping is fighting the idiom.

## Alternatives considered

1. **Per-call `withSystemContext` wraps** (the patch). Rejected: fragile (the audit found
   the design's 5-wrap set missed 12 surfaces — SSO alone is 11, not the 1 the gate first
   saw), and it bypasses the guard on every wrapped surface, so enrollment buys nothing
   there. It scales as O(call-sites) and each new call-site is a fresh chance to forget.
2. **Keep the raw client for "system" surfaces.** Rejected: perpetuates a two-client split
   and pushes isolation back onto hand-written `where: { accountId }` clauses — one
   forgotten clause is a silent cross-tenant leak (the exact failure mode the guard exists
   to remove).
3. **Make the guard default-open when no context is bound.** Rejected outright: turns a
   loud fail-closed outage into a silent cross-tenant leak. Fail-closed is correct; the
   fix is to always provide context, not to weaken the guard.

## Consequences

- `apps/api/src/security/tenantContext.ts` is extracted to a shared package so
  `apps/workers` (and any future deployable) establishes context with the same primitives.
- A context-establishing seam is added per boundary class: an SSO route-group `preHandler`
  (`enterTenantContext(params.accountId)`), an admin-route context rule (target-scoped →
  tenant; global → declared system), a consumer-adapter/worker-job wrapper
  (`withTenantContext(job.data.accountId)`), and the scheduler/bootstrap system wraps.
- **Context completeness is enforced by a LAYERED net** — no single mechanism is complete
  (three design gates confirmed this: an import-scoped audit, a named-seam presence-check,
  and a runtime observer each had blind spots). The net has four layers, each covering the
  others' gaps, with the coverage of each declared honestly:
  - **Static leaf-census (the completeness ORACLE)** — a fitness/test enumerating every
    enrolled-model access site (typed AND raw `$queryRaw`/`$executeRaw`) and asserting each
    reaching entry point establishes a context. This is the authoritative backstop: it sees
    what runtime observation cannot — raw SQL, `start()`-only background surfaces, and
    undriveable paths.
  - **Runtime guard-observation harness (the empirical HTTP-typed LAYER)** — boots the app,
    drives HTTP routes, observes `TENANT_CONTEXT_MISSING` via a `diagnostics_channel` publish
    inside the guard, and is the permanent HTTP regression net. **Honest limit**: it covers
    ONLY typed-query surfaces reachable via `createApp()` HTTP with a valid body; it is
    structurally BLIND to raw SQL (the `$extends` guard hooks only the typed API) and to
    `start()`-only consumers/scheduler. Guard-observation coverage == typed-query coverage;
    `contextMissing:false` is NEVER read as isolation-proven for a raw path.
  - **Guarded-client injection fitness** (statically checkable) — a grep gating a raw
    `prisma` singleton passed to any repository/adapter/factory constructor.
  - **Fitness #23** (pre-existing) — raw queries restricted to an audited allowlist; each raw
    query on a tenant-scoped table manually filters by `accountId` (verified — see
    `MULTI_TENANT_AUDIT`).
  - **The ratchet** — a committed blast-radius snapshot; a NEW context-miss OR a stale
    allowlist entry fails CI, so the net tightens as remediation closes each class.
- Migration is larger than a swap-and-wrap, and is done deliberately now rather than
  carried as latent risk — an explicit decision to pay the cost up front (Edward,
  2026-07-16).
- The rollout's Slice-6 work is reshaped around this principle (guarded-client injection +
  boundary context) instead of the swap-plus-scattered-wraps draft.

## Revisit if

- A future boundary class genuinely cannot derive an `accountId` and is not legitimately
  global (would indicate a modeling gap, not a reason to wrap).
- The HTTP/queue framework changes such that the boundary seam moves.
- `withSystemContext` call-sites grow beyond the small, enumerable set of genuinely-global
  operations — that growth is the smell that this ADR is being eroded.

## Risks

- The boundary audit MUST be **reachability-scoped, not import-scoped**. A first audit
  enumerated only the modules that import the raw `@infra/prisma` singleton and missed
  every surface that already resolves the _guarded_ client yet runs context-less
  (`oidcAdminRoutes.ts` admin secret-rotation, the two repurpose consumers, the
  gateway-switch billing worker) — a static, import-scoped enumeration is provably
  incomplete. The complete boundary set is "every entry point that transitively reaches an
  enrolled-model query", found by reachability and confirmed by the runtime coverage test
  above, NOT by grepping for raw-singleton imports.
- Extracting `tenantContext.ts` to a shared package must not fork the ALS holder (a second
  holder instance = a context that the guard cannot see). Single-instance discipline
  required.

## References

- Coverage-gap discovery: engram `tenant-guard/slice6-coverage-gap`.
- Pattern + solution (recall aid): engram `architecture/tenant-context-at-boundaries`.
- Adversarial design gate that caught the SSO outage: workflow `wf_6b059230-ccf`.
- Guard: `infra/prisma/src/extensions/tenantGuard.ts`; context holder:
  `apps/api/src/security/tenantContext.ts`; context precedents:
  `customerAuthMiddleware.ts:70`, `customerAuthRoutes.ts:137`, `linkRoutes.ts:211`.
- Rollout invariants: `docs/security/MULTI_TENANT_GUARDS.md`,
  `openspec/specs/multi-tenant-isolation/spec.md`.
