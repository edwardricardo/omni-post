# Tenant-Context Boundaries — Living Spec

> Cumulative living specification for the **tenant-context-boundaries** capability:
> establishing a `TenantContext` (or an explicit, declared `withSystemContext()` bypass)
> at every PRE-AUTHENTICATION boundary that reaches a model enrolled in the two-layer
> tenant guard (`TENANT_SCOPED_MODELS`, `infra/prisma/src/extensions/tenantGuard.ts`).
> This capability is the CONTEXT-PROPAGATION axis of the `project-scoped-tenant-guard`
> rollout (ADR-0020, N-SEC-3). It is DISTINCT from — and complementary to — the
> `multi-tenant-isolation` capability (which STRUCTURALLY enrolls models at the data
> layer) and the app-level `post-tenant-isolation` capability (which gates at the
> route/use-case layer): those specs describe the guard's ENFORCEMENT; this spec
> describes how a bound context is made AVAILABLE to that guard at surfaces that run
> before the customer-auth middleware.
>
> Established by change `tenant-context-preauth-seams` (Slice 6.1, Class A), archived
> 2026-07-22, PR #120 (branch `workstream/cluster-c-tenant-context-boundaries`),
> verified against main @ 8b0334f9. Source of truth for the bypass inventory:
> `docs/security/MULTI_TENANT_GUARDS.md` §"Pre-authentication boundary seams (Class A)".
>
> **Why the capability exists.** Before this change only `customerAuthMiddleware.ts:70`
> bound a `TenantContext`. Every pre-auth surface reaching an enrolled model ran
> context-less on the guarded client and threw `TenantContextMissingError` — a LIVE
> outage class across enterprise SSO, Zapier/Make integration auth, billing webhooks,
> and the inbound-webhook pipeline. Per ADR-0020, context is established ONCE at each
> boundary seam, never per call-site.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge. Scenarios marked **[unit]**
> are proven by a fake-repo / context-inspection unit test; **[integration]** scenarios
> require a real-DB, two-tenant run through `app.inject` HTTP — a mocked unit test
> CANNOT prove a guard that operates at the Prisma layer; **[static]** scenarios are
> checkable by inspecting source/config; **[by-design-deferred]** scenarios document a
> seam that is present and correct but whose live assertion activates in a later slice.
>
> **Class taxonomy (from the reachability blast-radius audit, engram**
> **`tenant-guard/reachability-blast-radius`).** This spec covers **Class A —
> pre-authentication surfaces** only. Admin surfaces (Class B), consumers/scheduler
> ticks, and the workers deployable + saga (raw-bypass class) are separate slices and
> out of scope here.

---

## Requirements

### Requirement: Every pre-auth boundary reaching an enrolled model binds a context [MERGE-BLOCKING]

Every pre-authentication HTTP route, middleware, or background-worker callback that can
reach a model in `TENANT_SCOPED_MODELS` through the guarded Prisma client SHALL execute
inside EITHER a bound `TenantContext` (via `enterTenantContext` / `withTenantContext`
where the tenant is derivable at the boundary) OR an explicit, declared
`withSystemContext(reason)` wrap (where the operation is genuinely cross-tenant BEFORE
attribution). A pre-auth boundary SHALL NOT reach an enrolled model with no bound
context; doing so SHALL surface as `TenantContextMissingError` (fail-closed) rather than
a silent unscoped read. `withTenantContext`/`enterTenantContext` SHALL be PREFERRED
wherever the tenant is derivable (URL param, matched API key) because it USES the guard;
`withSystemContext` SHALL be reserved for pre-attribution cross-tenant operations
(key-prefix lookup, gateway-customer→account mapping, webhook-subscription resolution)
and its reason string SHALL be one of the fixed, guard-audited constants.

The eight Class A surfaces and their bound context:

| Surface                              | Boundary                                                                                                                                                                         | Context              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A1/A2 Zapier / Make integration auth | `integrationAuthMiddleware` (two-hook: resolve + bind)                                                                                                                           | system → tenant      |
| A3/A4 SSO public (SAML ×3, OIDC ×2)  | shared param preHandler on the 5 public routes                                                                                                                                   | tenant (URL param)   |
| A5 billing webhooks (Stripe, Paddle) | handler body `withSystemContext("system:billing-webhook")`                                                                                                                       | system (declared)    |
| A6 tenant health                     | shared param preHandler (`tenantId`)                                                                                                                                             | tenant (URL param)   |
| A7 inbound provider webhooks         | worker callbacks `withSystemContext("system:inbound-webhook")`                                                                                                                   | system (declared)    |
| A8 OAuth callback                    | `handleOAuthCallback` body `withTenantContext({accountId: record.accountId})` + guarded `projectRepository.findById` probe (foreign `projectId` → NotFound → error redirect 302) | tenant (OAuth state) |

#### Scenario: a pre-auth boundary never reaches an enrolled model context-less [integration]

- **GIVEN** any Class A boundary that reaches an enrolled model
- **WHEN** the boundary executes for a legitimate request
- **THEN** no `TENANT_CONTEXT_MISSING` / `TenantContextMissingError` is raised, because a tenant or declared system context is bound at the seam

#### Scenario: every enrolled-model reach is behind a seam [static]

- **GIVEN** the change is applied
- **WHEN** each Class A surface is inspected for reaching an enrolled model
- **THEN** each runs behind `enterTenantContext`, `withTenantContext`, or an explicit `withSystemContext(reason)` — never bare on the guarded client

---

### Requirement: Tenant-derived route seams bind context from a URL param via one shared factory [MERGE-BLOCKING]

The SSO public routes and the tenant-health route SHALL derive the tenant from a URL
path parameter using ONE shared primitive: `makeTenantParamPreHandler(paramName)`
(`apps/api/src/security/tenantParamPreHandler.ts`), a Fastify preHandler that reads
`request.params[paramName]`, rejects with **400** on absence, and calls
`enterTenantContext({ accountId })`. It SHALL be attached DECLARATIVELY at each route
definition — not as a plugin-scoped hook with a silent no-op branch, and not as a
per-call-site wrap inside handlers. The 5 public SSO routes (`/auth/saml/:accountId/*`
×3, `/auth/oidc/:accountId/*` ×2) bind `accountId`; the tenant-health route
(`/health/tenant/:tenantId/...`) binds `accountId: tenantId` (resolved:
`tenantId == accountId`, the health monitor calls `getProjectsByAccount(tenantId)` →
`where: { accountId: tenantId }`).

Because the tenant is bound from the URL param, an SSO flow physically CANNOT read
another account's configuration: absent config for the bound account SHALL resolve to
**404** (never a 500 context-miss).

#### Scenario: the factory binds the param account [unit]

- **GIVEN** a request whose `params[paramName]` is present
- **WHEN** the preHandler runs
- **THEN** it calls `enterTenantContext` with that account and does not reject

#### Scenario: the factory rejects a missing param [unit]

- **GIVEN** a request whose `params[paramName]` is absent
- **WHEN** the preHandler runs
- **THEN** it rejects with 400 and binds no context

#### Scenario: SSO serves only the bound account's config [integration]

- **GIVEN** account A has SSO configuration seeded and account B does not
- **WHEN** `/auth/saml/A/metadata` is requested with A seeded, and `/auth/saml/B/metadata` is requested with only A seeded
- **THEN** A's request is 200 with A's own SP metadata, and B's request is 404 — never a 500 context-miss, and never A's metadata served under B

---

### Requirement: Integration auth resolves the tenant under system context, then binds it before the handler [MERGE-BLOCKING]

The Zapier/Make integration-auth boundary SHALL run the API-key lookup + argon2 verify
loop under `withSystemContext("system:integration-key-auth")` (the key prefix maps
across tenants BEFORE a match), and on a successful match SHALL bind a `TenantContext`
to the matched key's `accountId` so that ALL downstream integration handlers inherit
tenant scope from ONE seam. The `markUsed`/`save` write SHALL be reordered to run AFTER
tenant entry so it is itself tenant-scoped. A matched key whose `accountId` is null
SHALL be rejected with **401** (fail-closed) rather than continuing context-less.

**Shipped mechanism (two-hook split).** The seam is implemented as TWO paired Fastify
hooks in `apps/api/src/auth/integrationAuthMiddleware.ts`:

1. `integrationAuthResolve` (`onRequest`) — runs the system-scoped lookup + verify and
   resolves the matched `accountId`;
2. `integrationAuthBind` (`preHandler`) — calls `enterTenantContext` so the guarded
   handler observes a FULLY-POPULATED context.

Both hooks SHALL be wired PAIRED at every integration route site (`zapierRoutes.ts` ×5 +
`makeRoutes.ts` ×5 = 10 sites). This two-hook split is the canonical mechanism: the
guard only ever observes a fully-populated context — there is no empty-holder-by-
reference window. (This SUPERSEDES the mutable-holder mechanism described in the
change's original apply narrative; the shipped code is functionally superior and is the
source of truth.)

#### Scenario: lookup runs under system context, tenant bound after match [unit]

- **GIVEN** a fake key repository and a valid key belonging to account A
- **WHEN** the integration-auth boundary runs
- **THEN** `findByKeyPrefix` + verify observe a system context, and after the match a tenant context for A is bound before `markUsed`/`save`

#### Scenario: a matched key with null accountId is rejected [unit]

- **GIVEN** a key that verifies but carries a null `accountId`
- **WHEN** the integration-auth boundary runs
- **THEN** the request is rejected with 401 and no tenant context is bound

#### Scenario: a valid key sees only its own tenant's data [integration]

- **GIVEN** valid key A and integration data owned by both A and B
- **WHEN** an authenticated Zapier/Make request with key A lists `integrationSubscription`s
- **THEN** the response is 200 listing ONLY A's rows, with no `TENANT_CONTEXT_MISSING`, and B's data is never reachable; an unknown key is 401

#### Scenario: both hooks are wired at every integration route site [static]

- **GIVEN** the change is applied
- **WHEN** `zapierRoutes.ts` and `makeRoutes.ts` route registrations are inspected
- **THEN** all 10 sites wire `integrationAuthResolve` (onRequest) AND `integrationAuthBind` (preHandler) as a pair

---

### Requirement: System-context webhook seams are function-scoped and declared [MERGE-BLOCKING]

Boundaries that are genuinely cross-tenant before attribution SHALL wrap the handler
body in a function-scoped `withSystemContext(reason)`; NO irreversible ambient
`enterSystemContext` primitive SHALL be added (an ambient bypass is a footgun that would
disable the guard for the rest of the request). Two surfaces apply:

- **A5 billing** — the Stripe and Paddle webhook handler bodies in
  `billingWebhookRoutes.ts` SHALL each be wrapped in
  `withSystemContext("system:billing-webhook")`, so `billingEvent` /
  `accountSubscription` / `invoice` / `gatewaySwitchEvent` reads and writes run under a
  declared, guard-audited bypass.
- **A7 inbound provider webhooks** — in `webhookJobProcessor.ts`, the `processWebhookJob`,
  `processDeadLetterJob`, and the `worker.on("completed"/"failed")` +
  `deadLetterWorker.on("completed")` listener bodies (which write `webhookEvent` /
  `webhookDeadLetter` outside the job fn) SHALL be wrapped in
  `withSystemContext("system:inbound-webhook")` (exported constant
  `INBOUND_WEBHOOK_SYSTEM_REASON`). The seam covers every current AND future invocation
  path of the pipeline (it wraps the framework worker registration, not the business
  class).

The system-context reason strings SHALL be the fixed set:
`system:integration-key-auth`, `system:billing-webhook`, `system:inbound-webhook`.

#### Scenario: a signed billing webhook processes under the declared system context [integration]

- **GIVEN** a validly-signed Stripe/Paddle webhook
- **WHEN** it is delivered to the billing webhook route
- **THEN** it resolves 200 and its `billingEvent` write lands through the guarded client under `system:billing-webhook`, with no context-miss

#### Scenario: the inbound-webhook seam wraps the worker callbacks [integration]

- **GIVEN** a probe webhook job
- **WHEN** it runs through `processWebhookJob`
- **THEN** the enrolled-model reads/writes execute under `system:inbound-webhook` and the job processes clean with no `TenantContextMissingError`

---

### Requirement: Fail-closed at every seam [MERGE-BLOCKING]

Every seam SHALL fail CLOSED, never toward a context-less guarded read: a missing
route param SHALL yield **400**; a matched integration key with a null `accountId` SHALL
yield **401**; an absent SSO configuration for the bound account SHALL yield **404**. In
no case SHALL a pre-auth boundary emit a **500** `TenantContextMissingError` on a
legitimate request, and in no case SHALL it silently return unscoped rows.

#### Scenario: fail-closed codes are exact, never a context-miss 500 [integration]

- **GIVEN** the Class A surfaces
- **WHEN** a param is missing (health/SSO), a matched key has a null accountId (integration), or an SSO config is absent
- **THEN** the responses are 400, 401, and 404 respectively — never a 500 context-miss and never an unscoped read

---

### Requirement: A8 OAuth callback binds tenant context from the consumed OAuth state and rejects a foreign projectId [MERGE-BLOCKING]

(Previously a verified no-op boundary because `Channel` was NOT enrolled. Slice 7
(`channel-tenant-guard`) enrolls `Channel` in `TENANT_SCOPED_MODELS`, activating the
trigger note, so the boundary is now a real seam.)

The provider OAuth callback (`providerOAuthFlow.ts` `handleOAuthCallback`) persists via
`channelRepository` on the now-enrolled `Channel` model, so its persistence body SHALL run
inside `withTenantContext({ accountId: record.accountId })` bound from the consumed OAuth
state — otherwise the guard would throw `TenantContextMissingError` on the `Channel`
read/write. Because the `projectId` carried in the OAuth state is attacker-influenced, the
handler SHALL probe it through the guarded `projectRepository.findById` BEFORE any external
token exchange or `Channel` persistence: under the bound account a foreign/stale `projectId`
resolves nothing → `AppError.notFound("Project")`, and NO channel is created. Because
`handleCallback` is a browser-redirect flow (its catch converts every error into a 302), the
NOT_FOUND surfaces as the standard **error redirect (302)**, never a literal 404 status.

#### Scenario: the callback binds the account context from the OAuth state [static]

- **GIVEN** `handleOAuthCallback`
- **WHEN** its persistence paths are inspected
- **THEN** the body runs inside `withTenantContext({ accountId: record.accountId })` and the guarded `projectRepository.findById` probe runs before token exchange / `Channel.create`

#### Scenario: a foreign projectId in the OAuth state is rejected without persisting a channel [integration]

- **GIVEN** tenant A completes an OAuth callback whose consumed state carries a `projectId` belonging to tenant B
- **WHEN** the callback runs
- **THEN** the response is an ERROR REDIRECT (302, never a literal 404 status), NO external token exchange occurs, and NO channel is persisted under B's project

---

### Requirement: Deferred boundary assertions are documented, not silently dropped

Two Class A assertions are deferred by design and SHALL be tracked, not treated as
complete:

- **A6 health cross-tenant SCOPING** — the health route receives its seam now, but the
  bootstrap adapter at `index.ts:301` is still the RAW (unguarded) client, so the seam
  is inert-but-correct. The cross-tenant scoping proof SHALL activate in
  `api-guarded-client-injection` when that adapter is swapped to the guarded client
  (D5). This is a **[by-design-deferred]** obligation.
- **A7 live path** — the inbound-webhook pipeline (`WebhookManager` /
  `WebhookJobProcessor`) is constructed in NO composition root today, so the A7 seam is
  DEFENSIVE / safe-by-construction. Its live assertion SHALL activate when the
  WEBHOOK-INGEST wiring lands. This is a **[by-design-deferred]** obligation.

#### Scenario: A6 scoping proof is deferred to the injection slice [by-design-deferred]

- **GIVEN** the bootstrap adapter at `index.ts:301` is still the raw client
- **WHEN** the A6 health route runs
- **THEN** the seam is present and the route is 200 with no context-miss, and the cross-tenant scoping assertion is deferred to `api-guarded-client-injection` (D5)

#### Scenario: A7 seam is defensive until the pipeline is wired [by-design-deferred]

- **GIVEN** `WebhookManager` is constructed in no composition root
- **WHEN** the A7 seam is inspected
- **THEN** it wraps the worker callbacks so any future wiring is safe-by-construction, and its live-path assertion is tracked until WEBHOOK-INGEST wiring lands
