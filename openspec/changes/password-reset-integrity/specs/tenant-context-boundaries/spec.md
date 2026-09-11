# Tenant-Context Boundaries — Delta Spec (password-reset-integrity / PR-1)

> **MODIFIED capability** `tenant-context-boundaries` for change `password-reset-integrity`.
> Delta: **the four bare pre-identity customer-auth handlers — register, refresh,
> request-password-reset, and reset-password confirm — enter the Class A boundary map as
> DECLARED `withSystemContext` seams, and a context failure at a pre-identity credential
> seam may never be degraded into a credential failure.**
>
> **This delta closes a live violation of the capability's own MERGE-BLOCKING requirement.**
> `customerUser` is enrolled in `TENANT_SCOPED_MODELS`, and those four handlers reach it with
> no bound context: the guard throws, and the four endpoints are DEAD today (two 500s, one
> 401, and — worst — one 400 "Invalid or expired reset token", because the adapter catches the
> guard's throw and converts it into a not-found. The security control reads to the caller as
> a bad token. Two sibling handlers in the SAME file (login, MFA login) are already wrapped
> correctly, so the seam pattern is in place and only these four were missed.
>
> ADR-0020 rejects `withSystemContext` patched per CALL SITE and sanctions it DECLARED at a
> boundary; a public pre-identity auth route is such a boundary. Whether the declaration is
> four inline handler wraps or one route-group `preHandler`, and whether system scope covers
> the whole handler or only the token→tenant resolution with a `withTenantContext` re-entry
> for the write, are DESIGN choices — this spec constrains the observable outcome, not the
> seam's shape.
>
> RFC 2119 keywords are normative; tags follow the living spec (`[unit]`, `[integration]`,
> `[static]`, `[by-design-deferred]`).

---

## MODIFIED Requirements

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

## ADDED Requirements

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

---

## Verification note

The A9 integration scenario is the change's D0 acceptance and is RED today in four distinct
shapes (500, 500, 401, 400) — the 400 being the one that reads as normal behavior, which is
the reason the static and induced-failure scenarios above exist alongside it. The A9
integration run needs DB + Redis via `pnpm db:up`, and its file MUST be named in a
`run_batch` (fitness #30). The `multi-tenant-isolation` and `post-tenant-isolation`
capabilities are NOT modified by this delta: the enrolment and the route-layer gates are
unchanged; only the context-propagation axis moves.
