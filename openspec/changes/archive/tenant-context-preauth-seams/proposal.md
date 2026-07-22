# Proposal: Pre-auth tenant-context seams (tenant-context-at-boundaries, Class A)

> Child slice of `openspec/changes/tenant-context-at-boundaries/` (ADR-0020, N-SEC-3).
> Scope: **Class A — pre-authentication surfaces**, the highest-severity LIVE-BROKEN
> class from the reachability blast-radius audit (engram
> `tenant-guard/reachability-blast-radius`).

## Why

Only `customerAuthMiddleware.ts:70` binds a `TenantContext` today. Every pre-auth
surface that reaches an enrolled model (`TENANT_SCOPED_MODELS`, `tenantGuard.ts`) runs
context-less on the guarded client and **throws `TenantContextMissingError` right now**:

- **A1/A2** `integrationAuthMiddleware.ts:74` — `integrationApiKey` is enrolled, so
  **every Zapier/Make request 500s at the auth preHandler**; even if it passed, the 10
  downstream handlers (`zapierRoutes.ts`, `makeRoutes.ts` → `integrationSubscription`,
  `project`, `campaign`, `task`) would throw next.
- **A3/A4** SSO public flow (`samlRoutes.ts:242,265,288`, `oidcRoutes.ts:271,329`) —
  `samlConfiguration`/`oidcConfiguration` are enrolled; **every enterprise SSO
  metadata/login/callback throws**.
- **A5** `billingWebhookRoutes.ts:186,235` — `billingEvent`/`accountSubscription`/
  `invoice`/`gatewaySwitchEvent` enrolled; **every Stripe/Paddle webhook throws**,
  billing silently unprocessed.
- **A7** inbound provider webhook pipeline (`webhookHandlerCore.ts` + processors →
  `webhookEvent`, `webhookSubscription`, `instagramAnalytics`, `project`).
- **A6** `/health/tenant/:tenantId/project/:projectId` (`index.ts:704`) — binds no
  context; today inert because the bootstrap adapter (`index.ts:301`) is still the RAW
  client, but it becomes an outage the moment the injection slice swaps it.
- **A8** `providerOAuth.ts:37` `/auth/callback/:provider` — **verified NO-OP**: the
  callback writes only via `channelRepository` (Channel is NOT enrolled) and OAuth-flow
  state lives in `CachePort`, not Prisma. No seam needed; trigger documented.

## What changes

Per ADR-0020, context is established **once at each boundary seam** — never per
call-site:

| Surface             | Seam                                                                                                                                                                                                                         | Context            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| A1/A2 Zapier/Make   | `integrationAuthMiddleware`: key lookup+verify under `withSystemContext("system:integration-key-auth")`, then `enterTenantContext({accountId: matchedKey.accountId})` after match (mirror of `customerAuthMiddleware.ts:70`) | system → tenant    |
| A3/A4 SSO public    | shared param-derived preHandler on the 5 public routes → `enterTenantContext(params.accountId)`                                                                                                                              | tenant (URL param) |
| A5 billing webhooks | handler body wrapped in `withSystemContext("system:billing-webhook")`                                                                                                                                                        | system (declared)  |
| A7 inbound webhooks | BullMQ worker callbacks + status listeners in `webhookJobProcessor.ts` wrapped in `withSystemContext("system:inbound-webhook")`                                                                                              | system (declared)  |
| A6 tenant health    | same shared preHandler with `tenantId` param                                                                                                                                                                                 | tenant (URL param) |
| A8 OAuth callback   | none (no enrolled model reached — verified)                                                                                                                                                                                  | n/a                |

`withTenantContext`/`enterTenantContext` is preferred wherever the tenant is derivable
(param, matched key) — it **uses** the guard: SSO physically cannot read another
account's config. `withSystemContext` survives only where the operation is genuinely
cross-tenant _before_ attribution (key-prefix lookup, gateway-customer→account mapping,
webhook subscription resolution).

Each seam gets a two-tenant integration test proving (a) no
`TenantContextMissingError` and (b) correct scoping where tenant-bound. These tests are
the same evidence the coverage-harness ratchet (`tenant-context-coverage-harness`)
asserts; landed Class A entries are removed from `expected-context-missing.json` when
that allowlist exists.

## Non-Goals

- Admin surfaces (B1–B16) — next slice.
- Consumers/scheduler ticks (C1–C7, D1–D5) — background slice.
- Workers deployable + saga (raw-bypass class) — separate slice, partially blocked.
- Guarded-client injection + fitness #28, **including the bootstrap adapter swap at
  `index.ts:301`** — belongs to `api-guarded-client-injection` (seams land first by the
  parent's load-bearing ordering). A6's cross-tenant scoping assertion activates there.
- Channel/Post enrollment (Slices 7/8).

## Delivery + Review Workload Forecast

Stacked on the tip of `workstream/cluster-c-tenant-context-boundaries`.

| Field                        | Value                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| Estimated changed lines      | ~550–650 (production ~150, two-tenant + unit tests ~400–450, allowlist −40) |
| Decision needed before apply | **Yes**                                                                     |
| Chained PRs recommended      | **Yes**                                                                     |
| 400-line budget risk         | **High**                                                                    |

Suggested split honoring the budget: **6.1a** tenant-derived seams (integration
middleware + SSO + health + tests) / **6.1b** system-context webhook seams (billing +
inbound + tests). Each is autonomous, independently verifiable, and rollback-safe
(seams are additive; the guard fail-closed default is unchanged).

## Risks

- **Integration keys without `accountId`**: entity marks it optional. Fail-closed
  decision: reject 401 instead of continuing context-less.
- **Harness ordering**: if the 6.0 harness has not landed at apply time, the allowlist
  file does not exist — tests remain the primary evidence; ratchet cleanup is
  conditional.
- **A7 wiring**: `WebhookManager`/`WebhookJobProcessor` are currently constructed
  nowhere in the api composition root (verified) — seams still land at the worker
  callbacks so any future wiring is safe-by-construction; confirm live reachability at
  apply against the harness census.

## Open questions

1. `tenantId == accountId` semantics of `tenantHealthMonitor.getTenantHealth` — verify
   at apply before binding the param as `accountId`.
2. Exact test-batch wiring (`tenant-isolation` integration batch name/script) — pin at
   task time.
