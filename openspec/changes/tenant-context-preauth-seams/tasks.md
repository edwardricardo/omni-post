# Tasks: Pre-auth tenant-context seams (Class A) — Slice 6.1

Requirement anchors = proposal surfaces A1–A8 + design D1–D6. No spec.md (child slice).
Strict TDD: every seam gets its RED test before production code.

## Review Workload Forecast

| Field                   | Value                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Estimated changed lines | ~550–650 (prod ~150; unit+two-tenant tests ~400–450; allowlist −40)                        |
| 400-line budget risk    | High                                                                                       |
| Chained PRs recommended | No (single atomic + `size:exception`)                                                      |
| Suggested split         | Optional fallback: 6.1a (D1+SSO+health+integration-auth) → 6.1b (billing+inbound webhooks) |
| Delivery strategy       | ask-on-risk                                                                                |
| Chain strategy          | size-exception (fallback: feature-branch-chain)                                            |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (fallback split only)

| Unit | Goal                                                                                 | Base           | Focused test command                                                            | Runtime harness                                                | Rollback boundary                             |
| ---- | ------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| 6.1a | Tenant-derived seams: D1 primitive, SSO+health preHandlers, integration-auth reorder | tracker branch | `pnpm --filter @apps/api test tenantParamPreHandler integrationAuthMiddleware`  | `pnpm db:up` + preAuthSso/preAuthIntegration two-tenant suites | revert D1 file + SSO/health/integration edits |
| 6.1b | System-context webhook seams: billing + inbound                                      | 6.1a branch    | `pnpm --filter @apps/api test:integration preAuthBilling preAuthInboundWebhook` | `pnpm db:up` + billing/inbound suites                          | revert billing + webhookJobProcessor edits    |

Recommendation: **single atomic PR with `size:exception`** — consistent with prior rollout slices (4, 5); the D1 primitive is shared by SSO+health and the tests form one tenant-isolation ratchet, so splitting fragments the 6.0 harness evidence.

## Phase 1: Foundation — D1 shared primitive (A3/A4/A6, D1)

- [x] 1.1 RED unit `tests/unit/security/tenantParamPreHandler.test.ts`: binds `accountId` via `enterTenantContext` when param present; returns 400 when absent (vitest).
- [x] 1.2 Create `src/security/tenantParamPreHandler.ts` — `makeTenantParamPreHandler(paramName)` + JSDoc → GREEN.

## Phase 2: Tenant-derived route seams (A3/A4 SSO, A6 health)

- [x] 2.1 Attach preHandler (`accountId`) to `auth/samlRoutes.ts` (3 public) + `auth/oidcRoutes.ts` (2 public).
- [x] 2.2 Attach preHandler (`tenantId`) to health route in `index.ts`. RESOLVED: `tenantId==accountId` (health monitor calls `getProjectsByAccount(tenantId)` → `where: { accountId: tenantId }`), so binding `accountId: tenantId` is correct.
- [x] 2.3 RED two-tenant `tests/integration/preAuthSsoTenantIsolation.test.ts` (flat, matches batch convention): each account's `/auth/saml/:accountId/metadata` serves only its own SP metadata; absent config → 404 (never a 500 context-miss). Wired into the `integration:tenant-isolation` batch. A6 health scoping test deferred to injection slice (D5 — bootstrap client still raw, guard inert).

## Phase 3: Integration-auth seam — HIGHEST RISK, gates the slice (A1/A2, D2)

- [x] 3.1 RED unit `tests/unit/auth/integrationAuthMiddleware.test.ts` (mock repo + `getTenantContext`/`getSystemContext`): lookup+verify runs under system ctx; on match tenant ctx bound to key's `accountId`; `markUsed`/`save` runs AFTER entry; key with null `accountId` → 401.
- [x] 3.2 Modify `auth/integrationAuthMiddleware.ts`: lookup+verify under `withSystemContext("system:integration-key-auth")`; on match bind tenant context to the key's `accountId` THEN reordered `markUsed`/`save`; null `accountId` → 401. DEVIATION (documented): `enterWith` post-`await` does NOT propagate to the Fastify handler, so the seam reserves an empty tenant holder synchronously (before the first await) and populates it after match — preserves the "one seam" property for all 10 integration handlers.
- [x] 3.3 RED two-tenant `tests/integration/preAuthIntegrationTenantIsolation.test.ts`: valid key A → 200, lists only A's `integrationSubscription`s, no `TENANT_CONTEXT_MISSING`, cannot reach B's data; unknown key → 401. (Null-`accountId` → 401 covered at the unit level: the DB FK forbids seeding a null-account key.)

## Phase 4: System-context webhook seams (A5 billing, A7 inbound, D3/D4)

- [x] 4.1 Modify `billing/billingWebhookRoutes.ts`: wrap stripe + paddle handler bodies in `withSystemContext("system:billing-webhook")`.
- [x] 4.2 Modify `webhooks/webhookJobProcessor.ts`: wrap `processWebhookJob`, `processDeadLetterJob`, and `worker.on("completed"/"failed")` + `deadLetterWorker.on("completed")` bodies in `withSystemContext("system:inbound-webhook")` (exported `INBOUND_WEBHOOK_SYSTEM_REASON` constant).
- [x] 4.3 RED integration `preAuthBillingTenantIsolation.test.ts` (signed webhook → 200 + real guarded `billingEvent` row under the seam) + `preAuthInboundWebhookTenantIsolation.test.ts` (probe job processes clean, enrolled read under system ctx). RESOLVED: A7 is UNWIRED (`WebhookManager` constructed in no composition root) — seam is defensive/safe-by-construction; test asserts the seam contract directly.

## Phase 5: Non-tasks, cleanup, gate

- [x] 5.1 NON-TASK (A8, D6): VERIFIED `providerOAuthFlow.ts` `handleOAuthCallback` persists only via `channelRepository` (Channel NOT in TENANT_SCOPED_MODELS) + OAuth state via cache port — no seam. Documented trigger note added in-file.
- [x] 5.2 NON-GOAL (D5): bootstrap adapter `index.ts:301` NOT swapped — deferred to `api-guarded-client-injection` (A6 scoping test activates there).
- [x] 5.3 Conditional: 6.0 harness has NOT landed — `expected-context-missing.json` does not exist (verified via `fd`). Skipped cleanly; the `preAuth*TenantIsolation` suites are the primary evidence.
- [x] 5.4 Docs: added "Pre-authentication boundary seams (Class A)" subsection to `docs/security/MULTI_TENANT_GUARDS.md` (the doc tracks `withSystemContext()` bypasses).
- [x] 5.5 0-defect gate: tsc exit 0; `eslint --max-warnings 0` exit 0; fitness #8/#9/#10 = 0; new unit 8/8; full `integration:tenant-isolation` batch 96/96 pass, 0 cancelled.
