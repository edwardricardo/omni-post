# Saga Canon

**Owner:** Maintainers
**Read:** before a saga is written or changed. The other architecture rules are in [ARCHITECTURE_CANON.md](ARCHITECTURE_CANON.md).

---

## Saga Pattern

**Every saga is defined with the `defineSaga()` factory (`packages/shared/src/saga.ts`): steps are classified, the pivot is identified, countermeasures are explicit.**

- Every step MUST declare its `class`:
  - **`compensable`** — pre-pivot. MUST implement `compensate()`, idempotent
  - **`pivot`** — point of no return. NO `compensate()`. If retries are exhausted the saga is FAILED, with no rollback
  - **`retryable`** — post-pivot. NO `compensate()`. Idempotent forward recovery only, retried until success or terminal failure
- Every `SagaDefinition` MUST declare `pivotStepIndex`: `defineSaga()` takes `preCommit` (`CompensableStep[]`), `pivot` (`PivotStep`) and `postCommit` (`RetryableStep[]`) and derives it
- A saga with concurrent execution risk MUST attach the relevant countermeasures via `step.countermeasures`:
  - **`SemanticLock`** — when 2+ sagas can race on the same aggregate
  - **`RereadCheck`** — to close a dirty-read window between a read step and a write step
  - **`VersionCheck`** — for retryable post-pivot updates that race with manual writes: the step emits `expectedVersion` in the command and the use case rejects with `CONFLICT` if the persisted version has advanced
- Compensation is **idempotent and retryable**, executes in **reverse order** of the forward steps, and ONLY on `compensable` steps strictly before `pivotStepIndex`
- No no-op compensations: every `compensate()` is real undo logic. A step with nothing to undo (e.g. pure validation) declares its compensate as `{ success: true }` explicitly
- A saga MUST reach `COMPLETED`, `FAILED` or `COMPENSATED`. Infinite `RUNNING` is a canon violation
- DedupeKey is deterministic: `cmd-${sagaId}-${stepId}[-compensate]`. Never `randomUUID()`
- Domain events are emitted via the outbox in the SAME DB transaction as the saga state mutation
- Sources, the factory's example and what the engine enforces by itself are in this section's reference

### Reference: sources, the factory's example and what the engine does

Sources: Richardson (microservices.io, the Saga and Transactional Outbox patterns) and the Azure Architecture Center's "Saga design pattern" (compensation §3, step classes §4-8, the pivot §5, the terminal state §9, countermeasures §15-20). Richardson: "the Saga and Domain event patterns create the need for this pattern."

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

Enforced by construction: a step's `class` is a discriminated union, so TypeScript rejects a compensable step without `compensate()`, a `PivotStep` in `preCommit` and a `RetryableStep` as the pivot. A pivot has no rollback because its external side effects (enqueued provider jobs that may already have published) cannot be undone.

What the engine does by itself:

- On a failure before the pivot it walks the compensable steps in reverse and invokes `compensate()`; it refuses a compensation walk past the pivot.
- `SemanticLock` is an application-level lock keyed by aggregate: a second saga does not progress while the first holds it. `RereadCheck` runs before `step.execute()`, and `{ stillValid: false }` aborts the step.
- The timeout checker in `SagaManagerLifecycle` fails a saga still `RUNNING` past its limit (default 30 min); the recovery scheduler resumes due retries on every tick (5 s).
- The CQRS bus dedupes by command ID and the outbox by message ID; both rely on the deterministic dedupe key.
- `executeSaga` returns at once for a saga in a terminal state, however it is invoked (recovery checker, event resume, manual re-trigger).
