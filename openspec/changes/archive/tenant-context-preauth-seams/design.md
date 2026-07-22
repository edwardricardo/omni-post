# Design: Pre-auth tenant-context seams (Class A)

## Technical Approach

Add one context-establishing seam per Class A boundary, exactly as ADR-0020 prescribes:
tenant context via `enterTenantContext` where the tenant is derivable at the boundary
(URL param, matched API key), fn-scoped `withSystemContext` only where the operation is
cross-tenant before attribution. No handler, repository, or use case changes. All seams
are additive and inert-safe: they bind context; the guard keeps enforcing fail-closed.

## Architecture Decisions

### D1: One shared param-derived preHandler factory (SSO + health)

**Choice**: new `apps/api/src/security/tenantParamPreHandler.ts` exporting
`makeTenantParamPreHandler(paramName: string)` → Fastify preHandler that reads
`request.params[paramName]`, rejects 400 on absence, and calls
`enterTenantContext({ accountId })`. Attached explicitly to the 5 SSO public routes
(`accountId`) and the tenant-health route (`tenantId`).
**Alternatives**: plugin-scoped `addHook("preHandler")` — rejected: the SAML/OIDC
plugins also register admin routes (no `:accountId` param; Class B, out of scope), so a
plugin hook would need a silent no-op branch — implicit where the ADR demands declared.
Per-route wraps inside handlers — rejected: per-call-site patching, O(handlers).
**Rationale**: one primitive, declared at each route definition; handlers keep their
existing `AccountIdParamSchema` validation. `enterWith` semantics match the HTTP
one-tenant-per-request model (same as `customerAuthMiddleware.ts:70`).

### D2: Integration auth = system lookup, then tenant entry

**Choice**: in `integrationAuthMiddleware.ts`, wrap ONLY `findByKeyPrefix` + the
argon2 verify loop in `withSystemContext("system:integration-key-auth")`; on match,
`enterTenantContext({ accountId: matchedKey.accountId })`, THEN `markUsed`/`save`
(reordered after entry so the write is tenant-scoped). Keys with no `accountId` → 401.
**Alternatives**: whole-middleware system wrap — rejected: downstream handlers would
run unguarded (guard bypassed for the entire Zapier/Make surface). Tenant-first —
impossible: the tenant IS derived from the key.
**Rationale**: minimal bypass window; every one of the 10 integration handlers inherits
tenant scope from one seam.

### D3: System context stays fn-scoped — no `enterSystemContext` primitive

**Choice**: A5 wraps the two webhook handler bodies (`billingWebhookRoutes.ts`) in
`withSystemContext("system:billing-webhook", ...)`; no `enterWith` variant is added to
`tenantContext.ts`.
**Alternatives**: `enterSystemContext(reason)` preHandler for symmetry — rejected: an
irreversible ambient BYPASS primitive is a footgun (one stray call disables the guard
for the rest of the request); the ADR wants system context rare, explicit, and visibly
scoped.
**Rationale**: 2 sites; the handler body IS the boundary; guard audit events carry the
declared reason.

### D4: A7 seams at the BullMQ worker callbacks

**Choice**: in `webhookJobProcessor.ts`, wrap `processWebhookJob`, `processDeadLetterJob`,
and the `worker.on("completed"/"failed")` + `deadLetterWorker.on("completed")` listener
bodies (they write `webhookEvent`/`webhookDeadLetter` outside the job fn) in
`withSystemContext("system:inbound-webhook")`. `webhookHandlerCore.ts` untouched.
**Alternatives**: two-phase (resolve subscription → `withTenantContext`) — rejected for
this slice: dedupe (`webhookEvent.findUnique`) and subscription resolution
(`webhookSubscription.findFirst` by provider, global) precede attribution, so phase 1
still needs system context; refinement possible later. Wrapping inside
`handleWebhook` — rejected: the framework seam is the worker registration, not the
business class.
**Rationale**: covers every current and future invocation path of the pipeline
(verified: constructed only via `WebhookManager`, not in workers).

### D5: Bootstrap client swap deferred; A6 gets seam only

**Choice**: A6 receives the D1 preHandler now; swapping `index.ts:301`'s raw
`repoAdapter` to the guarded client stays in `api-guarded-client-injection`, where A6's
cross-tenant scoping test activates.
**Alternatives**: swap here — rejected: flips every `repoAdapter` consumer onto the
guarded client before non-Class-A boundaries have seams (parent ordering: seams before
swap, load-bearing).
**Rationale**: seam is inert until the swap, correct after it; no mid-slice blast
radius.

### D6: A8 is a verified no-op

`handleOAuthCallback` (`providerOAuthFlow.ts:121`) persists only via
`channelRepository` (Channel not in `TENANT_SCOPED_MODELS`); flow state is `CachePort`.
No seam. Documented trigger: if Channel enrolls or token-persist moves to
`accountCredential`, the seam is `withTenantContext({ accountId: record.accountId })`
(from consumed OAuth state) at the callback boundary. Apply-time check: confirm the
channel repository touches no enrolled model.

## Data Flow

    Zapier/Make ─→ integrationAuth: [system: key lookup+verify] ─match→ enterTenantContext ─→ handlers (guard-scoped)
    SSO /auth/{saml|oidc}/:accountId/* ─→ preHandler enterTenantContext(param) ─→ config read (guard-scoped)
    Stripe/Paddle ─→ handler body [withSystemContext] ─→ billing models (audited bypass)
    Webhook job ─→ worker callback [withSystemContext] ─→ handleWebhook → processors
    /health/tenant/:tenantId ─→ preHandler enterTenantContext(param) ─→ (inert until client swap)

## File Changes

| File                                                          | Action               | Description                                 |
| ------------------------------------------------------------- | -------------------- | ------------------------------------------- |
| `apps/api/src/security/tenantParamPreHandler.ts`              | Create               | D1 factory + JSDoc                          |
| `apps/api/src/auth/integrationAuthMiddleware.ts`              | Modify               | D2 seam; 401 on null accountId              |
| `apps/api/src/auth/samlRoutes.ts`                             | Modify               | preHandler on 3 public routes               |
| `apps/api/src/auth/oidcRoutes.ts`                             | Modify               | preHandler on 2 public routes               |
| `apps/api/src/billing/billingWebhookRoutes.ts`                | Modify               | D3 wraps (stripe, paddle)                   |
| `apps/api/src/webhooks/webhookJobProcessor.ts`                | Modify               | D4 wraps                                    |
| `apps/api/src/index.ts`                                       | Modify               | health route preHandler (D5)                |
| `apps/api/tests/unit/security/tenantParamPreHandler.test.ts`  | Create               | factory unit tests                          |
| `apps/api/tests/unit/auth/integrationAuthMiddleware.test.ts`  | Create/extend        | context ordering via fake repo              |
| `apps/api/tests/integration/tenantIsolation/preAuth*.test.ts` | Create               | two-tenant suites (below)                   |
| `expected-context-missing.json`                               | Modify (conditional) | remove landed Class A entries if 6.0 landed |

## Interfaces / Contracts

```typescript
export function makeTenantParamPreHandler(
  paramName: string
): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
```

System-context reasons (fixed strings, guard-audited): `system:integration-key-auth`,
`system:billing-webhook`, `system:inbound-webhook`.

## Testing Strategy

| Layer                                          | What                                                                                                                                                                                                                                                                                                                  | Approach                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit (vitest, RED first)                       | D1 factory (binds/400s); D2 ordering (lookup under system ctx, tenant ctx bound after match, null-accountId → 401) via mock repo + `getTenantContext`/`getSystemContext`                                                                                                                                              | strict TDD                                                     |
| Integration (node:test, two-tenant, RED first) | A1/A2: key A lists only A's `integrationSubscription`s, no TENANT_CONTEXT_MISSING; A3/A4: `/auth/saml/A/metadata` 200 with A seeded, 404 when only B seeded (cross-read blocked); A5: signed webhook → 200 + `billingEvent` row; A7: probe job processes clean; A6: route 200, no context-miss (scoping deferred, D5) | real DB+Redis, wired into the tenant-isolation batch; LXC-safe |

These suites are the evidence the 6.0 harness ratchet asserts for Class A.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. Route dispatch is unchanged (additive preHandlers only);
the security behavior they add is covered by the two-tenant RED tests above.

## Migration / Rollout

No migration. Seams are additive; rollback = revert. Order within the workstream:
after 6.0 harness (preferred, for ratchet evidence), before `api-guarded-client-injection`.

## Open Questions

- [ ] `tenantId == accountId` in `tenantHealthMonitor.getTenantHealth` — verify at apply.
- [ ] Tenant-isolation batch script name — pin at task time.
- [ ] A7 live reachability in the api deployable (pipeline currently unconstructed) — confirm against harness census at apply.
