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
> **Extended by Slice 7** — change `channel-tenant-guard`, archived 2026-07-28,
> PR #152 (structural + API) and PR #164 (worker reconciliation). Enrolling `Channel`
> INVERTED the premise of the A8 boundary: the OAuth callback that Slice 6.1 recorded
> as a "verified no-op boundary" (because `Channel` was unenrolled) now REACHES an
> enrolled model, so its in-file trigger note FIRED. That superseded requirement was
> REMOVED and replaced by "A8 OAuth callback binds tenant context from the consumed
> OAuth state and rejects a foreign projectId" below, and the A8 row of the pre-auth
> inventory now names the bound context. Slice 7 also introduced the rollout's FIRST
> worker-deployable seams reaching an enrolled model, recorded below as "Channel
> worker seams declare their context (Class D preview)".
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
> **Extended by the saga engine declaration** — change
> `saga-tenant-scope-and-recovery`. The saga engine was the raw-bypass class this spec
> explicitly deferred: the bootstrap handed it the RAW Prisma singleton, so the guard
> was not in its query path at all and neither of its background loops could raise
> `TenantContextMissingError`. Putting the guarded client in that path made the
> declaration a prerequisite, and the declaration landed narrower and stronger than a
> blanket bypass — a query-scoped system context for the tenant-UNKNOWN reads only, and
> the saga's own REHYDRATED tenant context for every per-saga write. Recorded below as
> "Saga engine internals are a declared system-context boundary" and "Saga context
> failures are observable, never swallowed"; the fixed reason set gains
> `system:saga-recovery`.
>
> **Extended by change `password-reset-integrity`**, archived 2026-09-12 (PRs
> #242/#243/#244, main @ `190625ec`). The four bare pre-identity customer-auth
> handlers — register, refresh, request-password-reset, reset-password confirm — enter
> the Class A inventory as the A9 row of declared `withSystemContext` seams (login and
> MFA login, the other two A9 handlers, were already wrapped ad-hoc before this change).
> Recorded below in the Class A table, the A9 bullet under "System-context webhook seams
> are function-scoped and declared", and the new requirement "A pre-identity seam never
> degrades a context failure into a credential failure" — closing a live violation where
> the guard's fail-closed throw on the reset-confirm path was swallowed by the adapter
> into "Invalid or expired reset token", making a security outage indistinguishable from
> a genuinely bad token. The fixed reason-string set gains one `system:customer-*`
> constant per A9 seam. **Recorded residual, carried rather than retrofitted**: login and
> MFA login's pre-existing ad-hoc (one interpolated) reason strings are NOT brought into
> the declared form by this change; the divergence is named in the requirement text so it
> stays attributable instead of silently absorbed.
>
> **Class taxonomy (from the reachability blast-radius audit, engram**
> **`tenant-guard/reachability-blast-radius`).** This spec covers **Class A —
> pre-authentication surfaces** plus the process-owned seams explicitly recorded below.
> Admin surfaces (Class B) and the full workers-deployable audit are separate slices and
> out of scope here — with TWO recorded exceptions: the three Channel worker seams that
> Slice 7 activated the moment `Channel` was enrolled (see the Class D preview
> requirement below), and the saga engine internals declared by
> `saga-tenant-scope-and-recovery`.

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
(key-prefix lookup, gateway-customer→account mapping, webhook-subscription resolution,
credential resolution by a globally-unique token) and its reason string SHALL be one of
the fixed, guard-audited constants.

(Previously: the inventory listed eight Class A surfaces and omitted the customer-auth
pre-identity handlers, four of which reach the enrolled `customerUser` model context-less.)

The Class A surfaces and their bound context:

| Surface                              | Boundary                                                                                                                                                                                                                | Context              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A1/A2 Zapier / Make integration auth | `integrationAuthMiddleware` (two-hook: resolve + bind)                                                                                                                                                                  | system → tenant      |
| A3/A4 SSO public (SAML ×3, OIDC ×2)  | shared param preHandler on the 5 public routes                                                                                                                                                                          | tenant (URL param)   |
| A5 billing webhooks (Stripe, Paddle) | handler body `withSystemContext("system:billing-webhook")`                                                                                                                                                              | system (declared)    |
| A6 tenant health                     | shared param preHandler (`tenantId`)                                                                                                                                                                                    | tenant (URL param)   |
| A7 inbound provider webhooks         | worker callbacks `withSystemContext("system:inbound-webhook")`                                                                                                                                                          | system (declared)    |
| A8 OAuth callback                    | `handleOAuthCallback` body `withTenantContext({accountId: record.accountId})` + guarded `projectRepository.findById` probe (foreign `projectId` → NotFound → error redirect 302)                                        | tenant (OAuth state) |
| A9 customer pre-identity auth        | the six `/auth/customer/*` handlers that resolve a subject BEFORE any identity is bound — login and MFA login (already wrapped) plus register, refresh, request-password-reset and reset-password confirm (this change) | system (declared)    |

The A9 subject is resolved by a value that is globally unique by construction (an e-mail
address across accounts, a refresh token, a reset token) or, for register, by a tenant that
does not yet exist at the boundary — so the resolution genuinely precedes attribution and
cannot be pre-scoped. The declaration SHALL state, per seam, HOW FAR the system scope
extends and why: whether it covers the whole handler (defensible when the following write's
own predicate names a globally-unique value and is therefore self-scoping) or only the
resolution, with tenant context re-entered for the write once the account is known. Extent
is a design choice; leaving it UNSTATED is not — an undeclared extent is how a bypass grows
past the operation that needed it.

#### Scenario: a pre-auth boundary never reaches an enrolled model context-less [integration]

- **GIVEN** any Class A boundary that reaches an enrolled model
- **WHEN** the boundary executes for a legitimate request
- **THEN** no `TENANT_CONTEXT_MISSING` / `TenantContextMissingError` is raised, because a tenant or declared system context is bound at the seam

#### Scenario: every enrolled-model reach is behind a seam [static]

- **GIVEN** the change is applied
- **WHEN** each Class A surface is inspected for reaching an enrolled model
- **THEN** each runs behind `enterTenantContext`, `withTenantContext`, or an explicit `withSystemContext(reason)` — never bare on the guarded client

#### Scenario: the four A9 handlers answer their contract under the guarded client [integration]

- **GIVEN** a seeded customer user, a valid refresh token, and a live reset token
- **WHEN** `POST /auth/customer/register`, `/refresh`, `/request-password-reset`, and `/reset-password` are each exercised through `app.inject` against the guarded client
- **THEN** each answers its contract response (never a 500, a 401 `USER_NOT_FOUND`, or a 400 token error produced by a missing context), and no `TenantContextMissingError` is raised in any of the four flows

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
disable the guard for the rest of the request). Four surfaces apply:

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
- **Saga engine internals** — the tenant-unknown queries (boot load, retry-recovery
  scan, by-id instance load) SHALL be wrapped in the single declared saga reason
  constant, QUERY-scoped so the wrap can never span a customer request NOR enclose an
  `executeSagaAsync` / `compensateSagaAsync` dispatch. Per-saga persistence (timeout
  checker, shutdown, boot re-warm, resumed executions) SHALL run under the saga's
  rehydrated tenant context instead — the stronger, guard-validated form.
- **A9 customer pre-identity auth** — the four previously bare handlers (register, refresh,
  request-password-reset, reset-password confirm) SHALL be brought under a DECLARED seam,
  each naming an exported reason constant rather than an inline literal. The declaration
  MAY be one route-group seam covering the group rather than four separate wraps; what is
  normative is that no such handler reaches `customerUser` undeclared, and that the reason
  is grep-able from one module.

The system-context reason strings SHALL be drawn from a fixed, single-module set:
`system:integration-key-auth`, `system:billing-webhook`, `system:inbound-webhook`,
`system:saga-recovery`, plus one declared `system:customer-*` constant per A9 seam.
(Previously: the fixed set named the first four only, while the customer-auth surfaces
already in the tree used ad-hoc inline literals.) A reason string SHALL NOT be an inline
literal introduced at a call site and SHALL NOT interpolate request data; the constant is
the boundary's whole auditability, because the guard bypasses on system context WITHOUT
emitting an audit event.

**Recorded residual, not silently absorbed:** the two customer-auth handlers wrapped before
this change (login, MFA login) and the admin MFA force-disable path use ad-hoc, and in one
case interpolated, reason strings. This change SHALL bring the four NEW seams into the
declared form and SHALL NOT be blocked on retrofitting the pre-existing three; the
divergence is recorded here so it is attributable rather than invisible.

#### Scenario: a signed billing webhook processes under the declared system context [integration]

- **GIVEN** a validly-signed Stripe/Paddle webhook
- **WHEN** it is delivered to the billing webhook route
- **THEN** it resolves 200 and its `billingEvent` write lands through the guarded client under `system:billing-webhook`, with no context-miss

#### Scenario: the inbound-webhook seam wraps the worker callbacks [integration]

- **GIVEN** a probe webhook job
- **WHEN** it runs through `processWebhookJob`
- **THEN** the enrolled-model reads/writes execute under `system:inbound-webhook` and the job processes clean with no `TenantContextMissingError`

#### Scenario: the saga reason constant is fixed and audited [static]

- **GIVEN** the saga engine declaration is applied
- **WHEN** every `withSystemContext` call site in the saga engine is inspected
- **THEN** each passes the single declared saga reason constant from the fixed set — never an ad-hoc string and never an ambient bypass

#### Scenario: each A9 seam declares an exported reason constant [static]

- **GIVEN** the change is applied
- **WHEN** the four newly declared customer-auth seams are inspected
- **THEN** each names an exported constant from the fixed set, none passes an inline literal, none interpolates request data into the reason, and each records how far its system scope extends and why

---

### Requirement: Saga engine internals are a declared system-context boundary [MERGE-BLOCKING]

Every saga engine operation that reaches an enrolled model with NO request tenant in
scope SHALL execute under an explicitly declared context — never a bare context-less
reach, never an unguarded client, never an ambient bypass:

- **Tenant-unknown operations** — the boot load of non-terminal sagas, the
  retry-recovery scan, and the by-id instance load before the row is in hand — SHALL
  execute inside an explicit `withSystemContext(reason)` wrap declaring the single
  saga reason constant. The wrap SHALL be scoped to the query expression only. The
  constant is a single grep-able declaration point, NOT an audited one: the guard
  bypasses on system context without emitting any audit event, so the boundary's
  auditability rests on that one constant and the source scan over its call sites.
- **Per-saga operations with the instance in hand** — engine persistence detached from
  a request (timeout-checker persistence, shutdown persistence, boot re-warm, resumed
  execution persists) and resumed step execution — SHALL run under the saga's own
  rehydrated `withTenantContext({ accountId })`; a missing or CONTRADICTED `accountId`
  SHALL fail loud (ERROR log + counter) and the work SHALL be skipped, never fall back
  to system context. The skip SHALL be reported to the caller rather than reading as a
  success, and a saga left unscopable SHALL be driven to a terminal state rather than
  retried indefinitely.
- **Dispatch invariant** — a `withSystemContext` callback SHALL NEVER lexically enclose
  an `executeSagaAsync` / `compensateSagaAsync` dispatch. AsyncLocalStorage propagates
  through `setImmediate`, so an enclosed dispatch would run the entire saga
  guard-bypassed, and the system wrap has no exit primitive that could restore
  enforcement from inside.
- **Effective-declaration invariant** — each wrap callback SHALL await its query inside
  the wrap. A Prisma call is lazy and reaches the database only when awaited, so a
  callback that returns the unawaited promise runs its query AFTER the declared context
  has been released; the declaration then reads as correct in source while the guarded
  read fails with `TenantContextMissingError` at runtime.

Conversely, persistence that DOES have a request tenant in scope (the awaited first
persist inside `startSaga`, and step persistence executed within the customer request)
SHALL keep the caller's bound `TenantContext` so the guard scopes it to the true
account.

#### Scenario: each engine-internal loop declares its context [static]

- **GIVEN** the saga engine declaration is applied
- **WHEN** the boot load, retry-recovery scan, timeout checker, and background persist paths are inspected
- **THEN** each tenant-unknown query runs inside a query-scoped `withSystemContext` with the fixed reason constant, each wrap callback is `async` and awaits its query, each per-saga persist/execution runs under the saga's rehydrated `withTenantContext`, and NO `executeSagaAsync` / `compensateSagaAsync` dispatch sits lexically inside a `withSystemContext` callback

#### Scenario: the background loops actually execute after the declaration [integration]

- **GIVEN** non-terminal saga rows exist for two different accounts and the process starts
- **WHEN** the boot load and the retry-recovery scan run
- **THEN** both observe the rows of BOTH accounts under the declared system context and raise no `TenantContextMissingError`

#### Scenario: a detached resume runs under the saga's own tenant [integration]

- **GIVEN** two accounts each own a saga whose retry has elapsed, and no tenant context is bound
- **WHEN** one recovery tick resumes both
- **THEN** each saga's step executes with that saga's own account bound as tenant context, and each resumed persist keeps its row on its owning account

#### Scenario: request-scoped persistence stays tenant-bound [integration]

- **GIVEN** an authenticated customer of account A starts a saga
- **WHEN** the first persist and any in-request step persistence execute
- **THEN** they run under A's bound tenant context (not system context) and the persisted rows carry A's account

#### Scenario: the engine's by-id load is system-scoped and the route check is its control [integration]

- **GIVEN** account A's context is bound, account B owns a saga, and the Redis hot cache holds no copy of it
- **WHEN** A loads B's saga through the engine and, separately, reads it through the guarded client
- **THEN** the engine load resolves the row because it declares the system reason to discover the owner — its tenant control being the route's ownership check, which answers NOT_FOUND — while the guarded client read resolves to nothing, and this asymmetry is recorded as a residual rather than described as guard scoping

---

### Requirement: Saga context failures are observable, never swallowed [MERGE-BLOCKING]

A context or query failure inside a saga background loop SHALL be logged at ERROR with
the failing loop, the error type, and a correlation id, AND SHALL increment a counter
metric. A failure SHALL NOT be swallowed by a bare catch, and SHALL NOT be
indistinguishable from a successful scan that found no work. A loop that fails on every
tick SHALL therefore be detectable from logs and metrics alone, without reading source.

#### Scenario: no saga background catch discards its error [static]

- **GIVEN** the saga engine declaration is applied
- **WHEN** the catch blocks of the boot load, the retry-recovery scan, and the timeout checker are inspected
- **THEN** each logs at ERROR with the error and increments the failure metric — none discards the error silently

#### Scenario: an induced context failure is visible in logs and metrics [integration]

- **GIVEN** a saga background loop is forced to fail (its declared context is removed in the test harness)
- **WHEN** one tick executes
- **THEN** an ERROR log naming the loop, the error type and the correlation id is emitted and the failure counter increases — the tick does NOT report as an empty successful scan

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

### Requirement: Channel worker seams declare their context (Class D preview) [MERGE-BLOCKING]

Slice 7 introduced the rollout's FIRST worker-deployable seams that reach an enrolled
model on the RAW client — Channel credential resolution, the auth-failure recorder, and
the mention channel lookup. Per the Class taxonomy, the FULL workers-deployable audit is a
separate, later slice; however, because these three paths reach `Channel` the moment it is
enrolled, they SHALL NOT run context-less. Each SHALL declare its context — binding the
job's `accountId` as an explicit query scope AND the `app.account_id` GUC inside the
worker transaction — so the access is tenant-attributed rather than an unscoped raw-client
read. The one worker Channel access that cannot pre-scope to a tenant because discovering
the tenant is its entire job (the owner lookup behind the bounded deploy-compat fallback)
SHALL declare the `'__system__'` scope explicitly and SHALL project the `accountId` column
alone, never the credential envelope. The ENFORCEMENT detail and the publish-flow
regression live in the `multi-tenant-isolation` capability's "Channel worker credential
and reconciliation paths are tenant-safe under both DB-role postures" requirement; this
requirement records the boundary obligation so no Channel worker seam is left as a silent
context-less reach.

#### Scenario: each Channel worker seam declares its context [static]

- **GIVEN** the change is applied
- **WHEN** the credential-resolution, auth-failure-recorder, and mention-lookup worker paths are inspected
- **THEN** each declares a job-scoped account context (explicit `accountId` scope and the `app.account_id` GUC bound in-tx) — never a bare context-less raw-client `Channel` read

#### Scenario: the owner lookup declares the system scope and leaks no credential [static]

- **GIVEN** the deploy-compat owner lookup used when a legacy job payload carries no account
- **WHEN** it is inspected
- **THEN** it binds the `'__system__'` scope explicitly, is a primary-key lookup projecting only the `accountId` column, and can never return a credential column

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

---

### Requirement: A pre-identity seam never degrades a context failure into a credential failure [MERGE-BLOCKING]

A `TenantContextMissingError` raised on a pre-identity credential path SHALL NOT be caught
and re-reported as a not-found, an invalid token, or an invalid credential. The guard's
throw is a fail-closed security signal; answering it with "invalid or expired reset token"
makes an outage indistinguishable from a genuinely bad token — which is exactly why this
capability's violation survived undetected on the reset path, and why a reachability fix
alone would have been unverifiable from the outside.

The prohibition is on the CONVERSION, not on error handling: a context failure MAY be mapped
to any response that is distinguishable from a credential verdict, and SHALL be observable in
logs as a context failure.

#### Scenario: no credential-path catch converts a context failure [static]

- **GIVEN** the change is applied
- **WHEN** the catch blocks on the customer-user read and claim paths are inspected
- **THEN** none converts a tenant-context failure into an entity-not-found or invalid-token result

#### Scenario: an induced context failure is not a token verdict [unit]

- **GIVEN** the reset confirm running with the guarded client and the seam's declaration removed in the harness
- **WHEN** a VALID token is submitted
- **THEN** the failure surfaced is a context/internal failure — never `INVALID_TOKEN`, and never a 400 that a caller could read as a bad token
