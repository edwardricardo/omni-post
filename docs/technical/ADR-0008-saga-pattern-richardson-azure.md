# ADR-0008: Saga Pattern canon-aligned (Richardson + Azure §4-20)

- **Status**: Accepted
- **Date**: 2026-05-18
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

OmniPost orchestrates multi-step workflows that span database state,
external SDK calls (Stripe / Paddle / 11 social providers), and queued
side-effects (BullMQ). Examples:

- **Gateway switch** (`GatewayBillingService.initiateGatewaySwitch`):
  validate eligibility → create switch event → cancel-at-period-end on
  current gateway → schedule reminder + suspend jobs → on webhook,
  transition state → complete switch on new gateway.
- **Post publish**: validate post → reserve channel credentials →
  call provider SDK → on success, persist publish event + analytics
  baseline; on failure, retry / mark failed / notify user.
- **Subscription change**: cancel old → create new → prorate → emit
  events.

Each workflow has irreversible operations (a published post is
publicly visible; a Stripe charge is debited) and steps that can fail
independently (provider rate-limit, network blip, retry timeout). Two
unacceptable failure modes:

1. **Inconsistent terminal state.** Stripe charged, post not
   published, customer billed for nothing → support nightmare.
2. **Infinite retry without compensation.** A failing step retried
   forever without bound; no rollback semantics for the partial work
   already done.

The literature provides two complementary canons:

- **Chris Richardson** (microservices.io): saga as a sequence of
  local transactions with compensation, choreography vs orchestration,
  outbox for event publication.
- **Azure Architecture Center** ("Saga design pattern" §4-20): step
  classification (compensable, pivot, retryable), pivot-step concept
  (point of no return), countermeasures (semantic lock, re-read
  check, version check), terminal state enforcement.

## Decision

**Adopt the union of Richardson + Azure §4-20 as canon, enforced by
the `defineSaga()` factory in `packages/shared/src/saga.ts`. Sagas
that compile are canon-by-construction.**

### Step classification (Azure §4-8)

Every step MUST declare its `class` — a discriminated union enforced
by the TypeScript compiler:

- **`compensable`** — pre-pivot. MUST implement `compensate()` (TS
  rejects classes without it). Idempotent. On saga failure pre-pivot,
  compensable steps are walked in reverse and their `compensate()` is
  invoked.
- **`pivot`** — point of no return. NO `compensate()`. If retries
  exhausted → saga FAILED, no rollback (the pivot's external side-
  effects, e.g., enqueued provider jobs that may have already
  published, cannot be canonically undone).
- **`retryable`** — post-pivot. NO `compensate()`. Idempotent
  forward-recovery only; retried until success or terminal failure.

### `pivotStepIndex` (Azure §5)

Every `SagaDefinition` MUST declare `pivotStepIndex` (the array
index of the pivot step). Use the `defineSaga()` factory, which
forces preCommit / pivot / postCommit segments and derives the index
— TS rejects passing a `PivotStep` into preCommit, a `RetryableStep`
as pivot, etc.

```typescript
const saga = defineSaga({
  id: "my-saga",
  name: "My Saga",
  version: "1.0.0",
  preCommit: [validateStep, createStep], // CompensableStep[]
  pivot: scheduleStep, // PivotStep
  postCommit: [waitStep, finalizeStep], // RetryableStep[]
});
```

### Countermeasures (Azure §15-20)

Sagas with concurrent execution risk attach the relevant
countermeasures via `step.countermeasures`:

- **`SemanticLock`** — application-level lock keyed by aggregate.
  Rejects a second saga from progressing while the first holds the
  lock. Use when 2+ sagas can race on the same aggregate.
- **`RereadCheck`** — confirms aggregate state hasn't changed pre-
  write. Activated by the engine before `step.execute()`; returns
  `{stillValid:false}` aborts the step. Use to close dirty-read
  windows between read-and-write steps.
- **`VersionCheck`** — Optimistic Concurrency Control via aggregate
  version. Saga step emits `expectedVersion` in the command; use
  case rejects with `CONFLICT` if persisted version has advanced.
  Use for retryable post-pivot updates that race with manual writes.

### Compensation (Richardson + Azure §3)

- Compensation is **idempotent and retryable**.
- Compensations execute in **reverse order** of forward steps, and
  ONLY on `compensable` steps strictly before `pivotStepIndex`. The
  engine refuses a compensation walk past the pivot by construction.
- "No no-op compensations" — every compensable step's `compensate()`
  is real undo logic. If a step has nothing to undo (e.g., pure
  validation), declare its compensate as `{ success: true }`
  explicitly so the canon classification is self-documenting.

### Terminal state (Azure §9 + Richardson)

Sagas MUST reach `COMPLETED`, `FAILED`, or `COMPENSATED`. Infinite
`RUNNING` is a canon violation enforced by the timeout checker in
`SagaManagerLifecycle` (default 30 min). Recovery scheduler resumes
due retries on every tick (5 s).

### DedupeKey

Deterministic: `cmd-${sagaId}-${stepId}[-compensate]`. Never
`randomUUID()`. The CQRS bus dedupes by command ID; the outbox
dedupes by message ID — both rely on this determinism. Enforced by
fitness `#7 No randomUUID in dedupeKey`.

### Outbox coupling (Richardson Outbox)

Domain events emitted via outbox in the SAME DB transaction as saga
state mutation. Consumer dedupe via `messageId` unique constraint.
Saga + Outbox are tightly coupled — Richardson explicitly says "the
Saga and Domain event patterns create the need for this pattern."

### Re-execution guard

```typescript
const TERMINAL = ["COMPLETED", "FAILED", "COMPENSATED"];
if (TERMINAL.includes(saga.status)) return;
```

Engine checks this at the top of `executeSaga` — terminal sagas
never re-execute regardless of how the engine is invoked (recovery
checker, event resume, manual re-trigger).

## Rationale

1. **Compile-time enforcement.** `defineSaga()` returns a typed
   `SagaDefinition` only when pre-pivot steps are `CompensableStep`,
   pivot is `PivotStep`, post-pivot are `RetryableStep`. A saga that
   compiles cannot violate the canon class structure.
2. **No silent unrecoverable state.** Pre-pivot failures →
   compensation. Pivot failure → terminal FAILED (we acknowledge the
   irreversibility honestly). Post-pivot failure → forward-recovery
   retries until success. Each path is explicit.
3. **Concurrency is named, not implicit.** Countermeasures
   (`SemanticLock`, `RereadCheck`, `VersionCheck`) make the
   concurrency hazard visible at the saga definition level — a
   reviewer can see "this saga acquires a lock on Account#id" without
   reading any step body.
4. **Outbox + Saga are coupled by design.** Richardson's writeup
   explicitly says it; we follow it. The same DB tx that mutates
   saga state writes outbox events. Consumers dedupe on messageId.

## Alternatives Considered

- **2PC (two-phase commit) across services.** Out of scope —
  OmniPost is a monolith with one DB. 2PC would only be relevant if
  Stripe/providers offered XA-style coordination, which they don't.
- **Ad-hoc try/catch chains with manual rollback.** Rejected:
  reinvents saga primitives badly, no termination guarantees, no
  audit trail, impossible to test compensations in isolation.
- **Temporal.io / Cadence as a workflow engine.** Considered. Heavy
  for our scale (separate cluster, separate worker model). The
  `SagaManager` in-process + outbox solves our needs with much less
  ops surface. Revisit if we need cross-service workflows.
- **Choreography only (no orchestrator).** Considered. Rejected for
  workflows with HITL or with strict pre-pivot validation — explicit
  orchestration is easier to reason about for non-trivial flows.
  Choreography stays available for simpler patterns (e.g., a
  `PostPublished` event triggering analytics fan-out).

## Consequences

**Positive**

- Sagas have type-checked class structure (compensable vs pivot vs
  retryable) — TS compiler catches misclassification.
- Compensation is idempotent and retryable by contract; recovery
  scheduler handles partial failures automatically.
- Outbox coupling guarantees at-least-once event delivery for cross-
  context choreography without inconsistency windows.
- Concurrency hazards are visible at the saga definition (named
  countermeasures), not buried in step bodies.

**Negative / costs**

- Adds machinery (`SagaManagerImpl`, `SagaManagerLifecycle`,
  `defineSaga()`, recovery scheduler, terminal-state timeout
  checker). Significant codebase footprint.
- Devs must learn the saga vocabulary (compensable/pivot/retryable,
  countermeasures) before contributing a new workflow. ADR-0008 +
  CLAUDE.md §Saga Pattern are the on-ramp.
- Saga state lives in the DB; queries to inspect a stuck saga
  require knowing the schema. Mitigated by admin-facing tooling
  (planned, not in scope of this ADR).

## Revisit if

If cross-service workflows become common (more than 2-3 services
participating in saga steps), the in-process `SagaManager` stops
fitting and we revisit by introducing Temporal.io or a similar
external workflow engine. The saga step abstractions
(compensable/pivot/retryable) port over to Temporal directly.

## Risks and Mitigations

| Risk                                                           | Mitigation                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Saga stuck in `RUNNING` indefinitely                           | `SagaManagerLifecycle` timeout checker (default 30 min) marks stuck sagas as FAILED with terminal state.                                  |
| Compensation not idempotent → repeated rollback corrupts state | Compensation is contract-tested: every `compensate()` is called twice in unit tests; second call must succeed and not double-rollback.    |
| Pivot step misclassified as compensable                        | `defineSaga()` type-level enforcement: a `PivotStep` (`class: "pivot"`) cannot land in the `preCommit` segment by signature.              |
| DedupeKey collision via `randomUUID()`                         | Fitness `#7 No randomUUID in dedupeKey` greps for the antipattern — hard-zero.                                                            |
| Outbox + Saga write split across two transactions              | Both writes share the same `UnitOfWork` (ADR-0005); the saga engine is responsible for opening the tx and committing once.                |
| Chaos in production (process kill mid-step)                    | Recovery scheduler resumes due retries on every 5s tick; saga step idempotency makes resume safe. Chaos testing TBD (Normalization §4.1). |

## References

- Richardson, "Saga pattern" — https://microservices.io/patterns/data/saga.html
- Richardson, "Transactional Outbox" — https://microservices.io/patterns/data/transactional-outbox.html
- Azure Architecture Center, "Saga design pattern" — https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- "Saga design pattern" detailed §4-20 (countermeasures, pivot step, terminal state)
- OmniPost `CLAUDE.md §Saga Pattern`
- Factory: `packages/shared/src/saga.ts` (`defineSaga()`)
- Engine: `apps/api/src/saga/SagaManager.ts` + `SagaIntegration.ts`
