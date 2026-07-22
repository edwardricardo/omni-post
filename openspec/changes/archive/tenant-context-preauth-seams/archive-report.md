# Archive Report: tenant-context-preauth-seams (Slice 6.1, N-SEC-3, Class A)

**Status**: ARCHIVED (closed) — PASS WITH WARNINGS, reconciled at archive.
**Change**: `tenant-context-preauth-seams` — Class A pre-authentication tenant-context seams.
**Workstream**: N-SEC-3 (`project-scoped-tenant-guard`), context-propagation axis (ADR-0020).
**Artifact store**: hybrid (openspec files + engram).
**Archived**: 2026-07-22.

---

## Delivery map

| Field             | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Branch            | `workstream/cluster-c-tenant-context-boundaries`                        |
| Merged to main    | PR #120 (merge commit `1ebc4a6a`)                                       |
| Verified against  | main @ `8b0334f9` (2026-07-22, fresh-context empirical)                 |
| Delivery strategy | single atomic PR, `size:exception` (consistent with rollout slices 4/5) |
| TDD mode          | Strict TDD — every seam has its RED test before production code         |

### Production files on main (8)

- `apps/api/src/security/tenantParamPreHandler.ts` — D1 shared factory `makeTenantParamPreHandler(paramName)` (create)
- `apps/api/src/auth/integrationAuthMiddleware.ts` — A1/A2 two-hook seam (`integrationAuthResolve` :99 + `integrationAuthBind` :206)
- `apps/api/src/auth/samlRoutes.ts` — A3 preHandler on 3 public routes (accountId 250/274/298)
- `apps/api/src/auth/oidcRoutes.ts` — A4 preHandler on 2 public routes (accountId 279/338)
- `apps/api/src/billing/billingWebhookRoutes.ts` — A5 `withSystemContext("system:billing-webhook")` ×2 (stripe 200, paddle 254)
- `apps/api/src/webhooks/webhookJobProcessor.ts` — A7 `withSystemContext("system:inbound-webhook")` (`INBOUND_WEBHOOK_SYSTEM_REASON`)
- `apps/api/src/index.ts` — A6 health route preHandler (`tenantId`, :714)
- `apps/api/src/providers/.../providerOAuthFlow.ts` — A8 verified no-op + trigger note (:126)

### Test files on main (6)

- `tests/unit/security/tenantParamPreHandler.test.ts`
- `tests/unit/auth/integrationAuthMiddleware.test.ts`
- `tests/integration/preAuthSsoTenantIsolation.test.ts` (all 5 SSO param routes)
- `tests/integration/preAuthIntegrationTenantIsolation.test.ts`
- `tests/integration/preAuthBillingTenantIsolation.test.ts`
- `tests/integration/preAuthInboundWebhookTenantIsolation.test.ts`

### Docs

- `docs/security/MULTI_TENANT_GUARDS.md:350` — "Pre-authentication boundary seams (Class A)" subsection landed with the 3 system reasons.

---

## Verify result summary (obs 408)

**Verdict**: PASS WITH WARNINGS. **0 CRITICAL, 2 WARNING, 3 SUGGESTION.** No CRITICAL =
archive is unblocked.

- **Completeness**: 17/17 tasks `[x]` in both engram obs 346 and the openspec tasks.md.
- **Unit** (vitest, heap 3072): 2 files, **10/10 pass** (grew from apply-time 8/8 due to the two-hook refactor coverage).
- **Integration** (node:test, heap 3072, DB-only `app.inject`, CONCURRENCY=1): the 4 `preAuth*TenantIsolation` suites → **17 tests, 17 pass, 0 fail, 0 cancelled, 0 skipped**, no `TENANT_CONTEXT_MISSING`. DB+Redis reachable on `omnipost-infra`.
- **tsc** apps/api (heap 5120, today's main): exit 0 — the touched seams still compile after the MFA slices, F-1, and dependency bumps.
- **Fitness on touched files**: #8 sprint/phase=0, #9 @file present (both new files), #10 invalid @layer=0, #3 any=0.
- **Fail-closed verified**: D1 param missing → 400; integration null accountId → 401; SSO absent config → 404 (never a 500 context-miss).

### Surface compliance matrix (all PASS)

| Surface               | Seam on main                                                                                                                | Status                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| A1/A2 integration key | two-hook (resolve onRequest + bind preHandler), 10/10 route sites paired; system lookup → tenant bind; null accountId → 401 | PASS                     |
| A3/A4 SSO (5 routes)  | `makeTenantParamPreHandler("accountId")` ×3 saml + ×2 oidc                                                                  | PASS                     |
| A5 billing            | `withSystemContext("system:billing-webhook")` ×2                                                                            | PASS                     |
| A6 health             | `makeTenantParamPreHandler("tenantId")` (seam present; scoping deferred, D5)                                                | PASS (by design)         |
| A7 inbound webhook    | `INBOUND_WEBHOOK_SYSTEM_REASON`, 5 wraps in webhookJobProcessor                                                             | PASS (defensive/unwired) |
| A8 OAuth callback     | verified NO-OP + trigger note                                                                                               | PASS                     |

---

## Two-hook reconciliation note (WARNING-1 / WARNING-2)

The verify pass caught a documentation drift, NOT a regression. Main ships the
integration-auth seam as a **two-hook split**:

- `integrationAuthResolve` (onRequest, `integrationAuthMiddleware.ts:99`) — runs the
  system-scoped key lookup + argon2 verify and resolves the matched `accountId`;
- `integrationAuthBind` (preHandler, `integrationAuthMiddleware.ts:206`) — calls
  `enterTenantContext` so the guarded handler observes a fully-populated context.

Both hooks are wired PAIRED at all 10 route sites (`zapierRoutes.ts` ×5 + `makeRoutes.ts`
×5). This is functionally **superior** to the **mutable-holder** mechanism the original
artifacts described (tasks.md task 3.2 DEVIATION narrative + apply-progress obs 348):
the guard only ever observes a fully-populated context — there is no
empty-holder-by-reference window. The code evolved AFTER the apply snapshot (during the
review/merge campaign); the checkmarks (17/17) were always correct — only the mechanism
NARRATIVE was stale.

**Action taken at archive**: task 3.2's DEVIATION text in the archived
`tasks.md` was rewritten to describe the shipped two-hook mechanism and to state that it
supersedes the stale mutable-holder narrative. The living spec
(`openspec/specs/tenant-context-boundaries/spec.md`) documents the two-hook split as the
canonical mechanism. No code change — main is the source of truth and is correct.

---

## Residual follow-ups (the 3 SUGGESTIONS — non-blocking)

- **S1 — latent silent-half-wire risk of the two-hook pair.** A future integration
  route could wire `integrationAuthResolve` (onRequest) WITHOUT `integrationAuthBind`
  (preHandler), leaving the handler context-less → a context-miss 500. All 10 current
  sites are correct. Candidate mitigation: a single composed-hook export that fuses both
  phases, OR a fitness guard asserting the two hooks are always co-registered on
  integration routes. Track in the tenant-guard backlog.
- **S2 — A7 inbound-webhook seam is defensive-only until WEBHOOK-INGEST wiring lands.**
  `WebhookManager` / `WebhookJobProcessor` are constructed in no composition root today,
  so the A7 seam is safe-by-construction but unexercised on a live BullMQ path. Its live
  assertion activates when the WEBHOOK-INGEST wiring lands (blueprint on the
  `webhook-wiring` branch).
- **S3 — A6 health cross-tenant scoping proof deferred to `api-guarded-client-injection`
  (D5).** The bootstrap adapter at `index.ts:301` is still the raw (unguarded) client,
  so the A6 seam is inert-but-correct. The cross-tenant scoping assertion activates when
  that adapter is swapped to the guarded client in `api-guarded-client-injection`.

None blocks archive; all are documented and tracked.

---

## Spec sync

The **tenant-context-boundaries** capability had no living spec (this is its first
change). Derived the requirement statements from proposal.md + design.md + the verify
report and created `openspec/specs/tenant-context-boundaries/spec.md` (source of truth
for the pre-auth boundary-seam capability). It is DISTINCT from `multi-tenant-isolation`
(data-layer structural enrollment) and `post-tenant-isolation` (app-level ownership) —
no duplicate spec was created.

Requirements captured: (1) every pre-auth boundary reaching an enrolled model binds a
context; (2) tenant-derived route seams via the shared param factory; (3) integration
auth = system lookup then two-hook tenant bind; (4) fn-scoped declared system-context
webhook seams; (5) fail-closed at every seam; (6) A8 verified no-op; (7) deferred
assertions (A6 scoping, A7 live path) documented, not dropped.

---

## Traceability (engram observation IDs)

| Artifact       | Topic key                                                                | Obs ID |
| -------------- | ------------------------------------------------------------------------ | ------ |
| Design         | `sdd/tenant-context-preauth-seams/design`                                | #345   |
| Tasks          | `sdd/tenant-context-preauth-seams/tasks`                                 | #346   |
| Apply progress | `sdd/tenant-context-preauth-seams/apply-progress`                        | #348   |
| Verify report  | `sdd/tenant-context-preauth-seams/verify-report`                         | #408   |
| Proposal       | `openspec/changes/.../proposal.md` (disk; referenced by design obs #345) | —      |

---

## Archive handoff

- **Filesystem move**: the full change folder content (proposal.md, design.md, reconciled
  tasks.md, this archive-report.md) was written to
  `openspec/changes/archive/tenant-context-preauth-seams/`. The originals under
  `openspec/changes/tenant-context-preauth-seams/` (proposal.md, design.md, tasks.md)
  could NOT be deleted by this executor (no Bash). **The orchestrator must remove
  `openspec/changes/tenant-context-preauth-seams/` to complete the move.**
- **Living spec**: `openspec/specs/tenant-context-boundaries/spec.md` (created).
- **MASTER_PLAN**: the N-SEC-3 ficha in `docs/product/MASTER_PLAN_ES.md` was updated to
  code ground truth (7/9 models enrolled; slices 0–5 done; context axis preauth-seams
  VERIFIED+ARCHIVED, coverage-harness proposal+design only; remaining = Channel, Post,
  harness tasks+apply, out-of-context audit, guarded-client injection).

## SDD cycle complete

`tenant-context-preauth-seams` has been planned, implemented (Strict TDD), verified
(PASS, 0 CRITICAL), reconciled (two-hook narrative), and archived. Ready for the next
change in N-SEC-3.
