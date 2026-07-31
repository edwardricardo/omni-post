# Delta for multi-tenant-isolation

> Change `saga-tenant-scope-and-recovery` (N-COR-7 portion). `sagaInstance` is ALREADY
> listed in `TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts:132`), so
> this delta does NOT extend the slice enrollment table. It closes a DATA-CORRECTNESS
> defect on an already-enrolled model: the engine writes `context.userId` (a
> `CustomerUser.id`) into `SagaInstance.accountId`
> (`apps/api/src/saga/SagaManagerExecution.ts:523,537`), so every saga row is keyed on a
> value that is not a tenant.
>
> **Empirical facts baked into these requirements (probe run 2026-07-31).** The tenant
> guard DOES intercept writes issued inside `prisma.$transaction(async (tx) => ...)` — an
> explicit account mismatch throws `TenantContextMismatchError` both directly and in-itx.
> There is NO `$transaction` layer-1 bypass. The wrong value is written SILENTLY because
> the bootstrap hands the saga engine the RAW Prisma singleton
> (`apps/api/src/index.ts:41` import, `:685-687` construction) — layer 1 is simply not in
> the engine's write path. The corrective posture is therefore: put the guarded client in
> the engine's path AND write the true tenant value.
>
> RFC 2119 keywords are normative. **[MERGE-BLOCKING]** requirements MUST be proven green
> before merge. **[static]** scenarios are checkable by inspecting source, schema, or
> migration; **[integration]** scenarios require a real-DB, two-tenant run;
> **[deploy-time]** scenarios are enforced by a migration-time `RAISE`.

## ADDED Requirements

### Requirement: SagaInstance.accountId carries the TRUE tenant, never a CustomerUser.id [MERGE-BLOCKING]

`SagaContext` SHALL carry `accountId` as a first-class, typed field (not only inside the
untyped `metadata` bag), populated at saga start from the authenticated customer's
`accountId`. Every persisted `SagaInstance` row SHALL store that account in the
`accountId` column on BOTH upsert branches. The engine SHALL NOT write
`context.userId` into `accountId` under any code path.

The two identifiers are provably distinct: `customerAuthMiddleware` derives
`customerUser.id` from `payload.sub` and binds `enterTenantContext({ accountId:
payload.accountId })` from a SEPARATE claim, so a saga row keyed on `userId` is keyed on
a non-tenant value and every `@@index([accountId, status])` lookup, tenant-scoped saga
query, and future RLS predicate resolves against garbage. A saga started for an account
with several users SHALL produce rows carrying ONE stable account value, not one value
per user.

#### Scenario: the two identifiers are distinct, so the proof cannot pass by coincidence [static]

- **GIVEN** the customer auth boundary and the test fixtures
- **WHEN** `customerUser.id` and the bound `accountId` are compared
- **THEN** they come from different claims (`sub` vs `accountId`) and the fixture asserts `customerUser.id !== account.id`, so no isolation proof below can pass by accidental equality

#### Scenario: a started saga persists the account, not the user [integration]

- **GIVEN** an authenticated customer of account A whose user id differs from A
- **WHEN** the customer starts a post-publishing saga and the first persist completes
- **THEN** the persisted row's `accountId` equals A's account id, does NOT equal the customer's user id, and no `TenantContextMismatchError` is raised

#### Scenario: two-tenant saga isolation holds through the guarded client [integration]

- **GIVEN** account A and account B each own saga instances and A's tenant context is bound
- **WHEN** A lists saga instances and reads B's saga instance by id through the guarded client
- **THEN** the list contains ZERO of B's rows and the by-id read resolves NOT_FOUND — never 403, never 500 — and no mutation of B's row is possible under A's context

---

### Requirement: Saga persistence executes on the guarded client so layer 1 is in the write path [MERGE-BLOCKING]

The saga engine SHALL receive the tenant-GUARDED Prisma client. The bootstrap SHALL NOT
construct the saga integration with the raw `@infra/prisma` singleton, because layer 1
cannot enforce, inject, or reject on a client it never sees — that absence, not any
`$transaction` behavior, is why a non-tenant value persisted silently. Consequently a
saga write whose `accountId` disagrees with the bound context SHALL FAIL LOUDLY
(`TenantContextMismatchError`) instead of persisting, and a saga write with no bound
context SHALL fail with `TenantContextMissingError` unless it runs inside an explicit
`withSystemContext(reason)` wrap.

#### Scenario: no engine construction path takes the raw singleton [static]

- **GIVEN** the change is applied
- **WHEN** every saga-engine construction site is enumerated (bootstrap and container)
- **THEN** each is handed the guarded client, and no saga-engine path receives the raw `@infra/prisma` singleton

#### Scenario: a mismatched account fails loudly instead of persisting [integration]

- **GIVEN** tenant A's context is bound and a saga persist is attempted carrying account B
- **WHEN** the write executes through the engine, including inside a transaction
- **THEN** it raises `TenantContextMismatchError`, no row is written, and the failure is visible in logs — it SHALL NOT be silently accepted

---

### Requirement: SagaInstance backfill integrity — zero CustomerUser.id values remain [MERGE-BLOCKING]

A forward migration SHALL repair historical rows. For each `SagaInstance` row whose
`accountId` is not an account: the true tenant SHALL be resolved from
`context->'metadata'->>'accountId'` when present (authoritative), otherwise from the
`CustomerUser.id -> CustomerUser.accountId` join. Rows resolvable by either source are
MAPPABLE and SHALL be corrected. Rows resolvable by neither are UNMAPPABLE and SHALL be
dispositioned by state:

- an unmappable row in a TERMINAL state (`COMPLETED` / `FAILED` / `COMPENSATED`) SHALL be
  set to an explicit, documented sentinel value and counted in a migration report — never
  left holding a `CustomerUser.id`, never silently deleted;
- an unmappable row in a NON-TERMINAL state SHALL HALT the migration with a `RAISE`,
  because a live saga with no true tenant is not safely recoverable and MUST be resolved
  by an operator rather than guessed.

After the migration, ZERO `SagaInstance` rows SHALL hold a value that matches any
`CustomerUser.id`, and the pre-migration row count SHALL be preserved. The down migration
is a documented no-op by design: restoring corrupted user ids is not a rollback goal.

#### Scenario: mappable rows are corrected to the true tenant [integration]

- **GIVEN** historical rows whose `accountId` holds a `CustomerUser.id`, some also carrying `context.metadata.accountId`
- **WHEN** the backfill migration runs
- **THEN** each row's `accountId` becomes the owning account (metadata preferred over the join), the count of rows matching any `CustomerUser.id` is **0**, and the row count is unchanged

#### Scenario: an unmappable terminal row gets the sentinel and is reported [integration]

- **GIVEN** a terminal-state row whose account is resolvable by neither metadata nor the join
- **WHEN** the backfill migration runs
- **THEN** the row is set to the documented sentinel, the migration reports the count of sentinel rows, and the row is neither deleted nor left holding a user id

#### Scenario: an unmappable non-terminal row halts the migration [deploy-time]

- **GIVEN** a PENDING or RUNNING row whose account is resolvable by neither source
- **WHEN** the backfill migration runs
- **THEN** the in-transaction `RAISE` HALTS the migration with no partial backfill committed and surfaces the offending saga id for operator resolution

---

### Requirement: SagaInstance's missing structural legs are recorded and escalated, not silently closed

`SagaInstance` satisfies leg 2 (`TENANT_SCOPED_MODELS`) but its `accountId` is nullable
with NO `Account` relation (`infra/prisma/schema.prisma:2058`) and it is not covered by
this change's scope for leg 1 (non-null + relation + accountId-led index) or a leg 3 RLS
policy. Completing those legs is OUT OF SCOPE here (the column cannot be flipped
non-null while sentinel dispositions exist). This change SHALL record the residual gap in
`docs/security/MULTI_TENANT_GUARDS.md` and file it as a tracked backlog item — it SHALL
NOT be presented as closed and SHALL NOT be silently dropped.

#### Scenario: the residual structural gap is documented and tracked [static]

- **GIVEN** the change is applied
- **WHEN** `docs/security/MULTI_TENANT_GUARDS.md` and the backlog are inspected
- **THEN** the `SagaInstance` leg-1 and leg-3 gap is documented with its reason, and a tracked backlog item exists for completing the enrollment
