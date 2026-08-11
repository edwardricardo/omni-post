# Delta for tenant-context-boundaries

> Change `saga-tenant-scope-and-recovery` (N-COR-2a root). The saga engine is the
> raw-bypass class the living spec explicitly deferred. This delta declares it, and the
> declaration is narrower and stronger than a blanket bypass: the engine's REQUEST-scoped
> persistence inherits the caller's bound tenant context; its process-owned internals use
> a declared system context ONLY for the tenant-UNKNOWN queries (boot load, retry-recovery
> scan, by-id instance load), each wrap scoped to the query expression; and every per-saga
> persistence or resumed execution — the instance and its `accountId` already in hand —
> runs under the saga's own REHYDRATED `withTenantContext`, so the guard validates those
> writes instead of skipping them.
>
> The background loops are NOT dead today: the bootstrap hands the engine the RAW Prisma
> singleton (`apps/api/src/index.ts:41,:687`), so the guard is not in the engine's query
> path and neither loop can raise `TenantContextMissingError` — a live run shows both
> working, and the `sagaCustomerFlow` test-13 failure is horizon arithmetic, not a dead
> scan (design D6). Dead loops are the POST-fix hazard this declaration prevents once the
> guarded client lands, not the pre-fix cause. Declaring the context is therefore a
> prerequisite for any recovery behavior; the recovery behavior itself lives in the
> `saga-crash-recovery` capability.
>
> RFC 2119 keywords are normative. **[MERGE-BLOCKING]** requirements MUST be proven green
> before merge. **[static]** scenarios are checkable by inspecting source; **[integration]**
> scenarios require a real-DB run with at least two tenants.

## ADDED Requirements

### Requirement: Saga engine internals are a declared system-context boundary [MERGE-BLOCKING]

> **AMENDED AT GATE (2026-07-31, design-driven — design.md D3).** The original text
> required `withSystemContext` for ALL engine-internal operations including per-saga
> persistence. Design D3 strengthens the persistence half: once the instance (and its
> `accountId`) is in hand, per-saga persistence and resumed step execution SHALL run under
> the saga's own rehydrated `withTenantContext({ accountId })` — the guard then VALIDATES
> every write instead of bypassing it. `withSystemContext` remains required, but only for
> tenant-UNKNOWN operations, and is constrained by the dispatch invariant below. Rationale:
> the guard checks system context FIRST (`tenantGuard.ts:198-201`) and `withSystemContext`
> has no exit primitive, so a system wrap is unrecoverable from inside — minimizing its
> footprint is the only sound shape.

Every saga engine operation that reaches an enrolled model with NO request tenant in
scope SHALL execute under an explicitly declared context — never a bare context-less
reach, never an unguarded client, never an ambient bypass:

- **Tenant-unknown operations** — the boot load of non-terminal sagas, the retry-recovery
  scan, and the by-id instance load before the row is in hand — SHALL execute inside an
  explicit `withSystemContext(reason)` wrap using the fixed, guard-audited reason
  constant. The wrap SHALL be scoped to the query expression only.
- **Per-saga operations with the instance in hand** — engine `persistSagaInstance` calls
  detached from a request (timeout-checker persistence, shutdown persistence, boot
  re-warm, resumed execution persists) and resumed step execution — SHALL run under the
  saga's own rehydrated `withTenantContext({ accountId })`; a missing `accountId` SHALL
  fail loud (ERROR log + counter), never fall back to system context.
- **Dispatch invariant** — a `withSystemContext` callback SHALL NEVER lexically enclose an
  `executeSagaAsync`/`compensateSagaAsync` dispatch (ALS propagates through
  `setImmediate`; an enclosed dispatch would run the entire saga guard-bypassed).

Conversely, persistence that DOES have a request tenant in scope (the awaited first
persist inside `startSaga`, and step persistence executed within the customer request)
SHALL keep the caller's bound `TenantContext` so the guard scopes it to the true account.
System context SHALL NOT leak into customer-facing saga reads: the route-facing saga
get/list paths SHALL remain tenant-scoped and SHALL NEVER be served under system context.

#### Scenario: each engine-internal loop declares its context [static]

_(AMENDED AT GATE 2026-07-31 — aligned with the amended requirement above.)_

- **GIVEN** the change is applied
- **WHEN** the boot load, retry-recovery scan, timeout checker, and background persist paths are inspected
- **THEN** each tenant-unknown query runs inside a query-scoped `withSystemContext` with the fixed reason constant, each per-saga persist/execution runs under the saga's rehydrated `withTenantContext`, and NO `executeSagaAsync`/`compensateSagaAsync` dispatch sits lexically inside a `withSystemContext` callback — never a bare context-less reach at an enrolled model

#### Scenario: the background loops actually execute after the declaration [integration]

- **GIVEN** non-terminal saga rows exist for two different accounts and the process starts
- **WHEN** the boot load and the retry-recovery scan run
- **THEN** both observe the rows of BOTH accounts under the declared system context and raise no `TenantContextMissingError`

#### Scenario: request-scoped persistence stays tenant-bound [integration]

- **GIVEN** an authenticated customer of account A starts a saga
- **WHEN** the first persist and any in-request step persistence execute
- **THEN** they run under A's bound tenant context (not system context) and the persisted rows carry A's account

#### Scenario: system context never leaks into customer-visible saga reads [integration]

- **GIVEN** account A is authenticated and account B owns saga instances
- **WHEN** A calls the saga status/list routes
- **THEN** only A's sagas are returned; no route-facing read is served under system context, and B's sagas are never visible to A

---

### Requirement: Saga context failures are observable, never swallowed [MERGE-BLOCKING]

A context or query failure inside a saga background loop SHALL be logged at ERROR with
the failing loop, the error type, and a correlation id, AND SHALL increment a counter
metric. A failure SHALL NOT be swallowed by a bare catch, and SHALL NOT be
indistinguishable from a successful scan that found no work. A loop that fails on every
tick SHALL therefore be detectable from logs and metrics alone, without reading source.

#### Scenario: no saga background catch discards its error [static]

- **GIVEN** the change is applied
- **WHEN** the catch blocks of the boot load, the retry-recovery scan, and the timeout checker are inspected
- **THEN** each logs at ERROR with the error and increments the failure metric — none discards the error silently

#### Scenario: an induced context failure is visible in logs and metrics [integration]

- **GIVEN** a saga background loop is forced to fail (its declared context is removed in the test harness)
- **WHEN** one tick executes
- **THEN** an ERROR log naming the loop and the error type is emitted and the failure counter increases — the tick does NOT report as an empty successful scan

## MODIFIED Requirements

### Requirement: System-context webhook seams are function-scoped and declared [MERGE-BLOCKING]

(Previously: the fixed reason set had three members and covered pre-auth webhook seams
only. This delta EXTENDS the fixed set with the saga engine-internal reason; the
function-scoped rule, the no-ambient-bypass prohibition, and both existing scenarios are
unchanged.)

Boundaries that are genuinely cross-tenant before attribution SHALL wrap the handler
body in a function-scoped `withSystemContext(reason)`; NO irreversible ambient
`enterSystemContext` primitive SHALL be added (an ambient bypass is a footgun that would
disable the guard for the rest of the request). Three surfaces apply:

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
- **Saga engine internals** — _(AMENDED AT GATE 2026-07-31, design-driven — design.md
  D3)_ the tenant-unknown queries (boot load, retry-recovery scan, by-id instance load)
  SHALL be wrapped in the single declared saga reason constant, QUERY-scoped so the wrap
  can never span a customer request NOR enclose an `executeSagaAsync` /
  `compensateSagaAsync` dispatch. Per-saga persistence (timeout checker, shutdown,
  re-warm, resumed executions) SHALL run under the saga's rehydrated tenant context
  instead — the stronger, guard-validated form.

The system-context reason strings SHALL be the fixed set:
`system:integration-key-auth`, `system:billing-webhook`, `system:inbound-webhook`,
`system:saga-recovery`.

#### Scenario: a signed billing webhook processes under the declared system context [integration]

- **GIVEN** a validly-signed Stripe/Paddle webhook
- **WHEN** it is delivered to the billing webhook route
- **THEN** it resolves 200 and its `billingEvent` write lands through the guarded client under `system:billing-webhook`, with no context-miss

#### Scenario: the inbound-webhook seam wraps the worker callbacks [integration]

- **GIVEN** a probe webhook job
- **WHEN** it runs through `processWebhookJob`
- **THEN** the enrolled-model reads/writes execute under `system:inbound-webhook` and the job processes clean with no `TenantContextMissingError`

#### Scenario: the saga reason constant is fixed and audited [static]

- **GIVEN** the change is applied
- **WHEN** every `withSystemContext` call site in the saga engine is inspected
- **THEN** each passes the single declared saga reason constant from the fixed set — never an ad-hoc string and never an ambient bypass
