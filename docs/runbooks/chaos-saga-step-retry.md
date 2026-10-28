# Runbook — Chaos scenario: saga step transient failure

> Tests: `apps/api/tests/chaos/saga-step-retry-recovery.integration.test.ts` (retry recovery)
> and `apps/api/tests/chaos/sagaWaitAmplification.integration.test.ts` (the three-state outcome).

## Invariant validated

A retryable saga step that fails transiently (e.g., an HTTP timeout, an optimistic lock conflict) must be **resumed by the recovery scheduler** and reach `COMPLETED` without losing the saga, EVEN if the process dies between attempts.

The invariant rests on THREE properties of the saga engine:

1. **Retry state persistence** — when a step fails (outcome `failed`) with a retry policy in scope, `nextRetryAt` is persisted to `SagaInstance` (not an in-memory setTimeout). Source: `apps/api/src/saga/SagaManagerExecution.ts`, the `stepResult.outcome === "failed"` branch inside `runSagaSteps`.
2. **Recovery poll** — `SagaManagerLifecycle.startRetryRecoveryChecker()` registers a task that every 5s looks for `SagaInstance` rows with `status IN (RUNNING, PENDING)` and `nextRetryAt ≤ now`. Source: `apps/api/src/saga/SagaManagerLifecycle.ts`, task `saga-retry-recovery`.
3. **Resume from persisted state** — `executionEngine.executeSagaAsync(sagaId, trigger)` resumes the saga from the current step using the previous `compensationData`.

If ANY of the 3 breaks → this test fails → potential data loss between crashes.

## The outcome contract (what changed, and why the old vocabulary no longer applies)

A step answers **one of three things**, and only one of them is an attempt:

| Outcome     | Meaning                              | What the engine does                                                                                   |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `succeeded` | the effect happened                  | advances to the next step and clears the retry bookkeeping                                             |
| `failed`    | it will not work out as things stand | spends ONE retry; with the budget spent, it compensates (pre-pivot) or fails (from the pivot on)       |
| `waiting`   | not decided yet (external work)      | **spends NO retry**, writes no error, emits no step event; re-arms the poll (`SAGA_WAIT_POLL_MS`, 30s) |

Operational consequences to keep in mind while diagnosing:

- **`nextRetryAt` means TWO things.** A due retry and a re-armed poll use the same column. The tie-breaker is `retryCount`: at `0` the row is WAITING (the step never failed), at `> 0` it is retrying after real failures. The boot disposition `nextRetryAt-owned-by-checker` covers both.
- **The ~35 s envelope no longer exists.** A publish whose jobs do not finish does not die of an exhausted budget: it waits, and it ends by the saga horizon (30 min) if nobody advances it. If you were looking for "why did this take a minute?", the answer is usually a poll interval, not a retry.
- **`success: false` no longer exists** as a value, nor `handleStepFailure()` as a method (it never existed: the handling lives inline in `runSagaSteps`).

## How to run it by hand

```bash
cd apps/api
NODE_OPTIONS="--max-old-space-size=3072" node --import tsx --conditions development --test \
  --test-force-exit tests/chaos/saga-step-retry-recovery.integration.test.ts
```

Expected result: 1 suite + 1 test green in ~150ms.

It does NOT need DB/Redis up — it uses the mocks of `tests/unit/sagaManager.test-helpers.ts`. The "chaos" here is exercising the retry-recovery cycle with a step that fails deterministically N times.

The second chaos test, `sagaWaitAmplification.integration.test.ts`, runs the same way (no services) and pins the fan-out arithmetic: four channels that publish fine reach `COMPLETED` without spending a single retry, and a channel that really fails still spends budget and ends in `FAILED`.

## What to do if it fails

### Case 1: the test hits its timeout without reaching COMPLETED

It indicates the recovery scheduler is NOT resuming the saga. Possible causes:

1. **`nextRetryAt` is not persisted**: check the `failed` branch of `runSagaSteps` — it persists `nextRetryAt` together with the step event, in the same tenant-scoped transaction.
2. **The scheduler taskId changed**: the test calls `scheduler.triggerTask("saga-retry-recovery")`. If the registered id changed, update the test.
3. **The recovery query does not find the saga**: `findMany({ where: { status: { in: ["RUNNING","PENDING"] }, nextRetryAt: { lte: now, not: null } } })` — check that the `status` + `nextRetryAt` combination is persisted correctly.

### Case 2: the test reaches COMPLETED but `attempts < 3`

It indicates the saga COMPLETED without going through the retry flow. Possible causes:

1. **The step is not inside the retry policy scope**: the saga definition must declare `retryPolicy`.
2. **The step returns `waiting` where it should return `failed`**: `waiting` does NOT spend budget, so a misclassified step never retries — and worse, it hides a dependency that is down behind "not finished yet". The authoring rule is in the `SagaStepResult` docblock: `waiting` is what **becomes decidable by asking again**; everything else is `failed`, "I could not observe" included.

### Case 3: assertion `nextRetryAt should be cleared after success` fails

It indicates the saga COMPLETED but `nextRetryAt` was not cleared. Possible causes:

1. **The success path does not clear the marker**: in `runSagaSteps`, the `succeeded` step does `delete instance.nextRetryAt` before persisting.
2. **The saga COMPLETED through a path other than retry-recovery** (e.g., the step succeeded on its first attempt). Check `attempts >= 3` in the previous assert.

### Case 4: the amplification came back (the fan-out test turns red)

`sagaWaitAmplification.integration.test.ts` red with `retryCount > 0` means that the waiting step went back to reporting "not finished yet" as a failure, or that the engine stopped exempting `waiting` from the budget. That was the defect that made a 4-channel publish end `FAILED` with all 4 channels published: do not patch it in the test.

## References

- Saga engine source: `apps/api/src/saga/SagaManager.ts`, `SagaManagerLifecycle.ts`, `SagaManagerExecution.ts`.
- Outcome contract: `packages/shared/src/saga.ts` (`SagaStepResult`), `docs/api/saga.md`.
- Test helpers: `apps/api/tests/chaos/chaos-helpers.ts`, `apps/api/tests/unit/sagaManager.test-helpers.ts`.
- What exists and where it runs: [Testing Infrastructure, section 5](../development/TESTING_INFRASTRUCTURE.md#5-chaos-scenarios).
