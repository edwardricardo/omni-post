# Delta for tenant-context-boundaries

> Slice 7 of the `project-scoped-tenant-guard` rollout. Enrolling `Channel` into
> `TENANT_SCOPED_MODELS` INVERTS the premise of the A8 boundary: the OAuth callback
> that Slice 6.1 documented as a "verified no-op boundary" (because `Channel` was
> unenrolled) now REACHES an enrolled model, so its in-file trigger note has FIRED.
> This delta (a) REMOVES the superseded no-op requirement, (b) ADDS the requirement
> that the A8 callback binds tenant context from the consumed OAuth state, (c)
> MODIFIES the pre-auth boundary inventory so the A8 row reflects the bound context,
> and (d) records that this slice introduces the rollout's FIRST worker-deployable
> Channel seams whose context declaration is enforced in the `multi-tenant-isolation`
> capability (the workers deployable remains a separate, later slice per the Class
> taxonomy).
>
> RFC 2119 keywords are normative. **[MERGE-BLOCKING]** requirements MUST be proven
> green before merge. **[static]** scenarios are checkable by inspecting source/config;
> **[integration]** scenarios require a real-DB, two-tenant run through HTTP.

## REMOVED Requirements

### Requirement: A8 OAuth callback is a verified no-op boundary

(Reason: `Channel` is now enrolled in `TENANT_SCOPED_MODELS` (Slice 7), so the OAuth callback DOES reach an enrolled model through the guarded client — the exact condition the requirement's in-file trigger note anticipated. The "no seam required" premise no longer holds.)
(Migration: replaced by "A8 OAuth callback binds tenant context from the consumed OAuth state" below; the in-file trigger note becomes an active `withTenantContext` binding.)

## ADDED Requirements

### Requirement: A8 OAuth callback binds tenant context from the consumed OAuth state [MERGE-BLOCKING]

The provider OAuth callback (`providerOAuthFlow.ts` `handleOAuthCallback`) SHALL bind a
`TenantContext` for the DURATION of the callback body via
`withTenantContext({ accountId: record.accountId })`, where `record.accountId` comes from
the consumed, server-side OAuth-state record (NOT from any client-supplied value). Because
`Channel` is now enrolled, the persisting `Channel.create` SHALL execute under this bound
context, so the guard scopes the save to the account that owns the OAuth flow. A
client-supplied `projectId` carried in the OAuth state that does NOT belong to
`record.accountId` SHALL be rejected as NOT_FOUND BEFORE any channel is persisted; because
`handleOAuthCallback` is a browser-redirect flow whose catch converts every error into a
302 (`providerOAuthFlow.ts:310-318`), this NOT_FOUND surfaces as the standard **error
redirect (302)**, never a literal 404 status — the ownership check SHALL survive both the
use-case catch and the redirect, with NO channel persisted. This closes the create-path
ownership gap (the callback previously persisted a client-supplied `projectId` with no
ownership check).

#### Scenario: the callback binds context from the OAuth state [static]

- **GIVEN** `handleOAuthCallback` after the change
- **WHEN** its persistence path is inspected
- **THEN** its body runs inside `withTenantContext({ accountId: record.accountId })` and `Channel.create` runs under that bound context, with the `accountId` sourced from the consumed OAuth-state record

#### Scenario: a foreign projectId in the OAuth state is rejected [integration]

- **GIVEN** the consumed OAuth state binds account A but carries a `projectId` owned by account B
- **WHEN** the callback completes
- **THEN** the request resolves to an ERROR REDIRECT (302 — the browser-redirect callback flow surfaces the NOT_FOUND as the standard error redirect via `providerOAuthFlow.ts:310-318`, never a literal 404 status) and NO channel is persisted under B's project

#### Scenario: the callback binds context and persists a consistent channel [integration]

- **GIVEN** the consumed OAuth state binds account A and its `projectId` belongs to A
- **WHEN** the callback completes
- **THEN** the channel is persisted with `accountId == A` and no `TenantContextMissingError` is raised

---

### Requirement: Channel worker seams declare their context (Class D preview) [MERGE-BLOCKING]

This slice introduces the rollout's FIRST worker-deployable seams that reach an enrolled
model on the RAW client — Channel credential resolution, the auth-failure recorder, and the
mention channel lookup. Per the Class taxonomy, the FULL workers-deployable audit is a
separate, later slice; however, because these three paths reach `Channel` the moment it is
enrolled, they SHALL NOT run context-less. Each SHALL declare its context — binding the
job's `accountId` (as an explicit query scope AND/OR the `app.account_id` GUC in the worker
transaction) so it is tenant-attributed rather than an unscoped raw-client read. The
ENFORCEMENT detail and the publish-flow regression live in the `multi-tenant-isolation`
capability's "Channel worker credential and reconciliation paths are tenant-safe under both
DB-role postures" requirement; this requirement records the boundary obligation so no
Channel worker seam is left as a silent context-less reach.

#### Scenario: each Channel worker seam declares its context [static]

- **GIVEN** the change is applied
- **WHEN** the credential-resolution, auth-failure-recorder, and mention-lookup worker paths are inspected
- **THEN** each declares a job-scoped account context (explicit `accountId` scope and/or `app.account_id` GUC bound in-tx) — never a bare context-less raw-client `Channel` read

## MODIFIED Requirements

### Requirement: Every pre-auth boundary reaching an enrolled model binds a context [MERGE-BLOCKING]

(Previously: the A8 row read "none — verified no enrolled model reached | n/a" because `Channel` was unenrolled. This delta updates the A8 row to the bound context now that `Channel` is enrolled; the invariant text and scenarios are otherwise unchanged.)

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

| Surface                              | Boundary                                                                                  | Context              |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------- |
| A1/A2 Zapier / Make integration auth | `integrationAuthMiddleware` (two-hook: resolve + bind)                                    | system → tenant      |
| A3/A4 SSO public (SAML ×3, OIDC ×2)  | shared param preHandler on the 5 public routes                                            | tenant (URL param)   |
| A5 billing webhooks (Stripe, Paddle) | handler body `withSystemContext("system:billing-webhook")`                                | system (declared)    |
| A6 tenant health                     | shared param preHandler (`tenantId`)                                                      | tenant (URL param)   |
| A7 inbound provider webhooks         | worker callbacks `withSystemContext("system:inbound-webhook")`                            | system (declared)    |
| A8 OAuth callback                    | callback body `withTenantContext({ accountId: record.accountId })` (Channel now enrolled) | tenant (OAuth state) |

#### Scenario: a pre-auth boundary never reaches an enrolled model context-less [integration]

- **GIVEN** any Class A boundary that reaches an enrolled model
- **WHEN** the boundary executes for a legitimate request
- **THEN** no `TENANT_CONTEXT_MISSING` / `TenantContextMissingError` is raised, because a tenant or declared system context is bound at the seam

#### Scenario: every enrolled-model reach is behind a seam [static]

- **GIVEN** the change is applied
- **WHEN** each Class A surface is inspected for reaching an enrolled model
- **THEN** each runs behind `enterTenantContext`, `withTenantContext`, or an explicit `withSystemContext(reason)` — never bare on the guarded client
