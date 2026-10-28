# Design: Tenant context at boundaries (ADR-0020)

## Technical Approach

Two chained PRs. PR1 makes `apps/api` context-complete: every audited boundary binds a
`TenantContext`/`SystemContext` at its framework seam (inert while modules still hold the raw
client). PR2 swaps the 12 raw-injecting container modules + the bootstrap repo adapter to the
guarded client and locks both invariants with fitness checks. Ordering is load-bearing:
context before client.

## Architecture Decisions

### D1 — Context-establishment seams

| Boundary                                                                      | Seam                                                   | Mechanism                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSO public flow (5 routes: SAML metadata/login/callback, OIDC login/callback) | route-level `preHandler: [bindSsoTenantContext]`       | `enterTenantContext({ accountId: params.accountId })`                                                                                                                                                                                                                                                                                |
| SSO admin (8 routes: config get/put, enable, disable × 2 plugins)             | `preHandler: [requireAdminAuth, bindSsoTenantContext]` | binder falls back to `request.auth?.user?.id` — the exact value the handlers already pass to the use cases (`adminAuthMiddleware.ts:125` sets it from JWT `sub`)                                                                                                                                                                     |
| Webhook-admin rotate-secret (`webhookAdminRoutes.ts:105`)                     | handler two-phase                                      | accountId is NOT pre-op available (`:id` = subscription id) → resolve via `withSystemContext("admin:webhook-rotation:resolve-tenant", () => repo.findById(id))`, then `withTenantContext({ accountId }, () => useCase.execute(...))`. Requires adding `accountId` to `WebhookSubscriptionForRotation` (port + Prisma adapter select) |
| TRIAGE_INBOX (`index.ts:1024`) / TREND_RADAR (`index.ts:1042`) consumers      | wrap the `subscribe` callback                          | `withJobTenantContext(payload, handler)` — payloads already carry `accountId`; missing accountId fails loud                                                                                                                                                                                                                          |
| mention-search / mention-reconcile scheduler ticks (`index.ts:904/914`)       | wrap registered callback                               | `withSystemContext("system:mention-search-dispatch" / "system:mention-reconcile-dispatch", ...)` — genuinely cross-tenant sweeps                                                                                                                                                                                                     |
| Tenant-health route (`index.ts:704`)                                          | wrap `getTenantHealth` call                            | `withTenantContext({ accountId: params.tenantId })` — enforcement, not bypass (route carries the tenant)                                                                                                                                                                                                                             |

Binders live in new `apps/api/src/security/tenantBoundaries.ts`. Verified corrections to the
audit: SSO is 13 routes (only the 5 public carry `:accountId`; 8 admin derive from auth); the
2 `disable` routes hit only `account` (`DisableSsoUseCase`/`DisableOidcSsoUseCase` take
`AccountQueryRepository` only; `account` is NOT in `TENANT_SCOPED_MODELS`,
`tenantGuard.ts:90-148`) → binder there is a harmless no-op; attached uniformly anyway.
Rejected: wrapping `createBullMQConsumerAdapter` itself (shared package must stay
tenant-agnostic; workers get their own slice); whole-op `withSystemContext` for webhook
rotation (disables the guard on the write); binder erroring when no accountId derivable
(handlers already 400/401; the fail-closed guard remains the net).

### D2 — Guarded-client swap (PR2)

Per module: drop `import { prisma } from "@infra/prisma"`, add
`const guardedPrisma = container.resolve<PrismaClient>(TOKENS.PrismaClient)` at the top of the
setup function. All 12 modules receive `container` (verified). Order-safe:
`setup.ts:64` registers `TOKENS.PrismaClient` before `setupUseCases()` runs (`setup.ts:89`).
Also swap `index.ts:301` (`createPrismaRepoAdapter`). `setupReferralUseCases` swaps too
(harmless; dead-code disposition stays in backlog).

### D3 — Fitness #28 (raw-singleton injection gate) [SENSITIVE — orchestrator]

- **Part A** (baseline today: 12 → 0 at PR2):
  `grep -rlE "import \{[^}]*\bprisma\b[^}]*\} from \"@infra/prisma\"" apps/api/src/infrastructure/container --include="*.ts" | grep -vE "/setup\.ts$" | wc -l # expect 0`
  (`setup.ts` excluded: its only match is a JSDoc `@example`; it receives prisma via options.)
- **Part B** — pinned count: `grep -cE "\bprisma\b" apps/api/src/index.ts` must equal **7**
  post-swap (`@adapters/db-prisma` import, `@infra/prisma` import, `setupContainer`,
  ipAllowlist, csrf, EventService, SagaIntegration — each enumerated in the check comment).
  Any new bootstrap reference changes the count → CI fails → forced re-audit + pin update.
  Rejected: allowlist grep (bare `prisma,` property lines are content-indistinguishable →
  residual hole). EventService/SagaIntegration/csrf/ipAllowlist stay raw: models global or
  unenrolled; saga boundary context is deferred with the workers slice.

### D4 — Context-at-boundary invariant (#29, PR1) [SENSITIVE — orchestrator]

Static presence check (#24/#25 style): `samlRoutes.ts` + `oidcRoutes.ts` MUST contain
`bindSsoTenantContext`; `webhookAdminRoutes.ts` MUST contain `withTenantContext`; `index.ts`
MUST contain `withJobTenantContext` and both `system:mention-*` reasons. Honest limit: greps
pin the audited seams; NEW surfaces are covered dynamically by the fail-closed guard + the
PR2 integration suite (route→model reachability is not statically enumerable). Boot-time
assertion rejected for the same reason.

### D5 — PR split (feature-branch-chain)

| PR               | Content                                                                                                         | Verification                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| PR1 (~300 lines) | `tenantBoundaries.ts`, SSO/webhook-admin/index.ts seams, port `accountId` field, fitness #29, binder unit tests | binders bind correct context (unit); behavior unchanged (raw client ignores context) |
| PR2 (~340 lines) | 12-module + `index.ts:301` swap, fitness #28, two-tenant integration tests, itx test                            | full isolation suite green on guarded client                                         |

## Data Flow

    request/job → boundary seam (binder) → ALS context → use case → guarded client → tenantGuard reads context

## File Changes

Create: `apps/api/src/security/tenantBoundaries.ts`; `apps/api/tests/unit/security/tenantBoundaries.test.ts`;
`apps/api/tests/integration/{ssoBoundary,webhookAdmin,crmRoute}TenantIsolation.test.ts` + itx test.
Modify: `samlRoutes.ts`, `oidcRoutes.ts`, `webhookAdminRoutes.ts`,
`packages/core/webhooks/src/WebhookSubscriptionRotationRepository.ts`,
`PrismaWebhookSubscriptionRotationRepository.ts`, `apps/api/src/index.ts`, 12 container
`setup*UseCases.ts`, `CLAUDE.md` + `.github/workflows/fitness.yml` [SENSITIVE], MULTI_TENANT_GUARDS.md.

## Testing Strategy

| Layer                        | What                                                                                                                                                  | How                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Unit (PR1, Vitest)           | binder derivations: params / auth-fallback / job payload / missing-accountId                                                                          | direct calls asserting `getTenantContext()`                                         |
| Integration (PR2, node:test) | two-tenant isolation: one previously-raw customer route (CRM), pre-auth SAML metadata, admin rotate-secret; itx: UoW transaction inherits ALS context | `*TenantIsolation.test.ts` convention (template: `campaignTenantIsolation.test.ts`) |

## Threat Matrix

All rows N/A — no shell, subprocess, VCS/PR automation, or executable-file classification;
route changes are preHandler additions on existing routes, covered by the tests above.

## Migration / Rollout

No migration. PR2 revert alone restores the raw client (pre-change behavior); PR1 revert
removes inert binders. Both independently revertible.

## Open Questions

- [ ] Tenant-health `:tenantId` == `accountId`? Verify at apply; else derive from project.
- [ ] SSO admin uses JWT `sub` as accountId (existing modeling oddity) — mirrored, not changed; flag for the auth-model backlog.
