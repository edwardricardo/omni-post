/**
 * @file saga-step-retry-recovery.integration.test.ts
 * @description Chaos scenario: a saga step fails transiently — the recovery
 *   scheduler picks up the saga from the persisted `nextRetryAt` and eventually
 *   reaches COMPLETED.
 *
 *   Validates the invariant: **a process crash between attempts of a retryable
 *   step must not lose the saga**. The test simulates the crash with a step
 *   that fails N times (not by killing the process) and triggers the recovery
 *   scheduler manually to avoid a 5 s wall-clock wait per iteration.
 *
 *   The invariant depends on THREE properties of the saga engine:
 *   1. `nextRetryAt` is persisted onto the `SagaInstance` when a retryable
 *      step fails with a retry policy in scope.
 *   2. `startRetryRecoveryChecker` (`SagaManagerLifecycle.ts:380-408`) polls
 *      sagas with `status=RUNNING` and `nextRetryAt <= now`.
 *   3. `executionEngine.executeSagaAsync(sagaId)` resumes the saga from the
 *      current step using the prior `compensationData`.
 *
 *   If ANY of the three breaks → this test fails → potential data loss between
 *   crashes.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { until } from "@packages/vitest-shared/determinism";
import type { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import type { SagaExecutionEngine } from "../../src/saga/SagaManagerExecution.js";
import {
  createChaosHarness,
  TransientFailingStep,
  waitForSagaStatus,
  type ChaosHarness,
} from "./chaos-helpers.js";
import { SuccessfulStep } from "../unit/sagaManager.test-helpers.js";

/**
 * The engine behind the facade, reached through a documented cast: whether a pass still holds a
 * saga is engine state the facade does not expose, and the recovery tick drops its dispatch for
 * a saga a pass still holds.
 */
function engineOf(manager: SagaManagerImpl): SagaExecutionEngine {
  return (manager as unknown as { execution: SagaExecutionEngine }).execution;
}

/**
 * Waits until the step has run `attempts` times, the pass that ran it has released the saga, and
 * the retry it scheduled is due: the three conditions under which the next recovery tick
 * dispatches a pass instead of finding nothing to do or dropping it.
 */
async function awaitDueRetry(
  harness: ChaosHarness,
  step: TransientFailingStep,
  sagaId: string,
  attempts: number
): Promise<void> {
  let nextRetryAt: Date | undefined;
  await until(
    async () => {
      if (step.attempts !== attempts || engineOf(harness.manager).isAdvancerInFlight(sagaId)) {
        return false;
      }
      nextRetryAt = (await harness.manager.getSaga(sagaId))?.nextRetryAt;
      return nextRetryAt !== undefined && nextRetryAt.getTime() <= Date.now();
    },
    {
      description: () =>
        `attempt ${attempts} to release saga ${sagaId} with a due retry ` +
        `(attempts: ${step.attempts}, nextRetryAt: ${nextRetryAt?.toISOString()})`,
      timeoutMs: 3_000,
    }
  );
}

describe("Chaos: saga step transient failure → recovery scheduler retries", () => {
  let harness: ChaosHarness;

  before(async () => {
    harness = await createChaosHarness();
  });

  after(async () => {
    await harness.teardown();
  });

  it("retries a step that fails twice and reaches COMPLETED via recovery scheduler", async () => {
    const transientStep = new TransientFailingStep(/* failuresBeforeSuccess */ 2);

    harness.manager.registerSaga({
      id: "chaos-retry-saga",
      name: "Chaos Retry Saga",
      version: "1.0",
      timeout: 60_000,
      retryPolicy: { maxRetries: 5, backoffMs: 10, exponential: false },
      steps: [transientStep, new SuccessfulStep()],
    });

    // The owning account is not decoration: a saga without one models a
    // corrupted row, which the engine refuses to start and never resumes.
    const instance = await harness.manager.startSaga("chaos-retry-saga", {
      correlationId: "corr-chaos-1",
      accountId: harness.accountId,
      userId: "user-1",
      metadata: { accountId: harness.accountId },
    });

    // startSaga defers the first pass. Once it has failed the transient step,
    // the saga is RUNNING with nextRetryAt persisted. The in-process scheduler
    // is NoOp; we must manually trigger the recovery checker to advance the
    // retry cycle.
    await awaitDueRetry(harness, transientStep, instance.id, 1);

    // Retry 1 → step still fails (attempts=2). Recovery checker picks it up.
    await harness.scheduler.triggerTask("saga-retry-recovery");
    await awaitDueRetry(harness, transientStep, instance.id, 2);

    // Retry 2 → step succeeds (attempts=3). Then SuccessfulStep runs. Saga
    // should reach COMPLETED.
    await harness.scheduler.triggerTask("saga-retry-recovery");

    // Wait for the async resume to complete the saga.
    await waitForSagaStatus(harness.manager, instance.id, "COMPLETED", {
      timeoutMs: 3_000,
    });

    assert.ok(
      transientStep.attempts >= 3,
      `Step should have been retried until success. attempts=${transientStep.attempts}`
    );

    const final = await harness.manager.getSaga(instance.id);
    assert.ok(final, "Saga should still exist post-completion");
    assert.strictEqual(final.status, "COMPLETED", "Saga should be COMPLETED");
    assert.ok(
      final.nextRetryAt === null || final.nextRetryAt === undefined,
      `nextRetryAt should be cleared after success, got ${final.nextRetryAt}`
    );
  });
});
