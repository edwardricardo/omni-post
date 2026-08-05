/**
 * @file SagaManagerExecution.ts
 * @description Saga execution and compensation engine handling step execution, persistence,
 *              retry logic, and completion/failure processing.
 * @layer infrastructure
 */

import type { SagaDefinition, SagaInstance } from "@shared/types/saga.js";
import { SAGA_EVENTS } from "@shared/types/saga.js";
import { createEventStoreEvent, type EventStoreEvent } from "@shared/types/events.js";
import type { SagaManagerLifecycle } from "./SagaManagerLifecycle.js";
import type { SagaManagerConfig, SagaTransactionClient } from "./sagaManagerTypes.js";
import {
  resolveSagaTenant,
  runAsSagaTenant,
  runSagaTenantTransaction,
  withSagaSystemRead,
} from "./sagaTenant.js";
import { deserializeSagaInstanceRow, type SagaInstanceRow } from "./sagaInstanceRow.js";
import {
  recordSagaFailed,
  recordSagaRecoveryFailure,
  type SagaFailureReason,
} from "../metrics/sagaRecoveryMetrics.js";
import { captureError } from "../observability/sentryInit.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";

/**
 * Saga step execution, compensation, and persistence engine
 */
export class SagaExecutionEngine {
  constructor(
    private config: SagaManagerConfig,
    private lifecycle: SagaManagerLifecycle
  ) {}

  // ---------------------------------------------------------------------------
  // Async Entry Points
  // ---------------------------------------------------------------------------

  executeSagaAsync(sagaId: string): void {
    setImmediate(async () => {
      try {
        await this.executeSaga(sagaId);
      } catch (error) {
        logger.error({ err: error, sagaId }, "Saga execution failed");
      }
    });
  }

  compensateSagaAsync(sagaId: string): void {
    setImmediate(async () => {
      try {
        await this.compensateSagaSteps(sagaId);
      } catch (error) {
        logger.error({ err: error, sagaId }, "Saga compensation failed");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Step Execution
  // ---------------------------------------------------------------------------

  private async executeSaga(sagaId: string): Promise<void> {
    const instance = await this.lifecycle.getSaga(sagaId);
    if (!instance) {
      logger.error({ sagaId }, "Saga not found during execution");
      return;
    }

    // Guard: prevent re-execution of sagas already in a terminal state
    const TERMINAL_STATES: ReadonlyArray<SagaInstance["status"]> = [
      "COMPLETED",
      "FAILED",
      "COMPENSATED",
    ];
    if (TERMINAL_STATES.includes(instance.status)) {
      logger.warn(
        { sagaId, status: instance.status },
        "Attempted to execute saga in terminal state, ignoring"
      );
      return;
    }

    const definition = this.lifecycle.definitions.get(instance.definitionId);
    if (!definition) {
      logger.error({ definitionId: instance.definitionId }, "Saga definition not found");
      return;
    }

    // Every step write and every engine persist below belongs to the saga's own
    // account. Rehydrating it here keeps the guard's mismatch protection live on
    // a path that has no request context to inherit. A saga whose tenant cannot
    // be resolved is left untouched here and terminalized by the timeout
    // checker — advancing it unscoped is the one thing this must never do.
    const outcome = await runAsSagaTenant(
      instance,
      () => this.runSagaSteps(instance, definition),
      this.lifecycle.metrics
    );

    if (!outcome.ran) {
      logger.warn(
        { sagaId, reason: outcome.reason },
        "Saga execution skipped: awaiting terminalization by the timeout checker"
      );
    }
  }

  /**
   * @method runSagaSteps
   * @description Advances the saga through its remaining steps, persisting after
   *   each one. Runs inside the saga's rehydrated tenant scope.
   * @param instance - The saga being advanced.
   * @param definition - The definition whose steps drive the walk.
   */
  private async runSagaSteps(instance: SagaInstance, definition: SagaDefinition): Promise<void> {
    const sagaId = instance.id;

    instance.status = "RUNNING";
    await this.persistSagaInstance(instance);

    try {
      while (instance.currentStep < definition.steps.length) {
        const step = definition.steps[instance.currentStep];

        if (!step) {
          throw AppError.internal(`Saga step at index ${instance.currentStep} not found`);
        }

        logger.info(
          {
            stepName: step.name,
            stepIndex: instance.currentStep + 1,
            totalSteps: definition.steps.length,
          },
          "Executing saga step"
        );

        const stepStartTime = Date.now();
        let stepResult;

        try {
          // Countermeasures (Azure §15-20) — activated in canonical order
          // before step.execute():
          //   1. SemanticLock — admission control, rejects concurrent saga.
          //   2. RereadCheck — guards against dirty reads.
          //   3. VersionCheck — enforced inside the use case layer via
          //      expectedVersion in the command.
          const cm = step.countermeasures;

          if (cm?.semanticLock && this.config.lockStore) {
            const key = cm.semanticLock.acquireKey(instance.context);
            if (key) {
              const ttl = cm.semanticLock.ttlMs ?? definition.timeout ?? 30 * 60 * 1000;
              const acquireResult = await this.config.lockStore.acquire(key, instance.id, ttl);
              if (!acquireResult.ok) {
                // CONNECTION_ERROR — fail this step rather than running
                // unguarded. Saga will retry per canon retry policy.
                stepResult = {
                  success: false,
                  error: "Semantic lock acquire failed (lock store unreachable)",
                };
              } else if (!acquireResult.value) {
                // Held by another saga — concurrent execution rejected.
                stepResult = {
                  success: false,
                  error: `Semantic lock held by another saga: ${key}`,
                };
              }
            }
          }

          if (!stepResult && cm?.rereadCheck) {
            const reread = await cm.rereadCheck.rereadBeforeUpdate(instance.context);
            if (!reread.stillValid) {
              stepResult = {
                success: false,
                error: `Reread check failed: ${reread.reason ?? "aggregate state changed"}`,
              };
            }
          }

          if (!stepResult) {
            stepResult = await step.execute(instance.context);
          }
        } catch (error) {
          stepResult = {
            success: false,
            error: error instanceof Error ? error.message : "Step execution failed",
          };
        }

        instance.stepResults[instance.currentStep] = stepResult;

        const stepEventType = stepResult.success
          ? SAGA_EVENTS.SAGA_STEP_COMPLETED
          : SAGA_EVENTS.SAGA_STEP_FAILED;

        const stepEvent = createEventStoreEvent(
          stepEventType,
          sagaId,
          "Saga",
          {
            sagaId,
            stepId: step.id,
            stepName: step.name,
            stepIndex: instance.currentStep,
            result: stepResult,
            completedAt: new Date(),
            executionTime: Date.now() - stepStartTime,
          },
          {
            source: "SagaManager",
            correlationId: instance.context.correlationId,
          }
        );

        if (!stepResult.success) {
          if (this.shouldRetryStep(definition, instance)) {
            instance.retryCount++;
            const retryDelay = this.calculateRetryDelay(definition, instance.retryCount);
            // Persist nextRetryAt instead of in-process setTimeout — survives
            // process restarts. The recovery checker resumes due retries.
            instance.nextRetryAt = new Date(Date.now() + retryDelay);
            await this.persistSagaInstance(instance, [stepEvent]);
            logger.info(
              {
                stepName: step.name,
                retryDelayMs: retryDelay,
                attempt: instance.retryCount,
                nextRetryAt: instance.nextRetryAt.toISOString(),
              },
              "Saga step scheduled for retry"
            );
            return;
          }

          // Retries exhausted. Canon-discriminated terminal handling:
          //   - compensable step (pre-pivot): trigger compensation walk
          //   - pivot step (point of no return): FAILED, no rollback (Azure §5)
          //   - retryable step (post-pivot): FAILED, forward-recovery exhausted
          await this.persistSagaInstance(instance, [stepEvent]);
          const errMsg = stepResult.error || "Step execution failed";

          if (step.class === "compensable") {
            instance.error = errMsg;
            this.compensateSagaAsync(instance.id);
          } else {
            // Pivot or retryable: no compensation by canon
            await this.failSaga(instance, errMsg);
          }
          return;
        }

        // Successful step: clear retry bookkeeping before advancing.
        instance.currentStep++;
        instance.retryCount = 0;
        delete instance.nextRetryAt;
        await this.persistSagaInstance(instance, [stepEvent]);

        // Note: external-event suspension is handled by the retry mechanism,
        // not by special-casing step.id here. A RetryableStep waiting on a
        // worker event returns success:false → schedules retry → worker
        // emits publish.job.completed → SagaIntegration.handleEvent calls
        // executeSagaAsync → engine re-runs the step which now succeeds.
        // This avoids hard-coding step ids in the engine and keeps the
        // canon flow uniform across step classes.
      }

      await this.completeSaga(instance);
    } catch (error) {
      logger.error({ err: error, sagaId }, "Saga execution error");
      await this.failSaga(instance, error instanceof Error ? error.message : "Unknown error");
    }
  }

  // ---------------------------------------------------------------------------
  // Compensation
  // ---------------------------------------------------------------------------

  private async compensateSagaSteps(sagaId: string): Promise<void> {
    const instance = await this.lifecycle.getSaga(sagaId);
    if (!instance) {
      return;
    }

    const definition = this.lifecycle.definitions.get(instance.definitionId);
    if (!definition) {
      return;
    }

    const outcome = await runAsSagaTenant(
      instance,
      () => this.runCompensationWalk(instance, definition),
      this.lifecycle.metrics
    );

    if (!outcome.ran) {
      logger.warn(
        { sagaId, reason: outcome.reason },
        "Saga compensation skipped: awaiting terminalization by the timeout checker"
      );
    }
  }

  /**
   * @method runCompensationWalk
   * @description Walks the compensable steps in reverse and marks the saga
   *   COMPENSATED. Runs inside the saga's rehydrated tenant scope.
   * @param instance - The saga being compensated.
   * @param definition - The definition whose steps are walked back.
   */
  private async runCompensationWalk(
    instance: SagaInstance,
    definition: SagaDefinition
  ): Promise<void> {
    const sagaId = instance.id;

    for (let stepIndex = instance.currentStep - 1; stepIndex >= 0; stepIndex--) {
      const step = definition.steps[stepIndex];
      const stepResult = instance.stepResults[stepIndex];

      if (!step) {
        logger.warn({ stepIndex }, "Saga step not found, skipping compensation");
        continue;
      }

      // Canon enforcement (Azure §5): only compensable steps strictly before
      // the pivot are eligible for compensation. Pivot + post-pivot retryable
      // steps are forward-recovery only — rolling them back has no canon-
      // valid semantics (provider may have already accepted the side-effect).
      if (stepIndex >= definition.pivotStepIndex) {
        continue;
      }
      if (step.class !== "compensable") {
        continue;
      }
      if (!stepResult?.success) {
        continue;
      }

      logger.info({ stepName: step.name }, "Compensating saga step");

      try {
        const compensationResult = await step.compensate(
          instance.context,
          stepResult.compensationData
        );

        instance.compensationResults[stepIndex] = compensationResult;

        if (!compensationResult.success) {
          logger.error(
            { stepName: step.name, error: compensationResult.error },
            "Compensation failed for step"
          );
        }
      } catch (error) {
        logger.error({ err: error, stepName: step.name }, "Compensation error for step");
        instance.compensationResults[stepIndex] = {
          success: false,
          error: error instanceof Error ? error.message : "Compensation failed",
        };
      }
    }

    instance.status = "COMPENSATED";
    instance.completedAt = new Date();

    const compensationCompletedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_COMPENSATION_COMPLETED,
      sagaId,
      "Saga",
      {
        sagaId,
        definitionId: instance.definitionId,
        compensatedAt: instance.completedAt,
        stepsCompensated: instance.compensationResults.filter((r) => r?.success).length,
        totalSteps: instance.currentStep,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    await this.persistSagaInstance(instance, [compensationCompletedEvent]);

    this.lifecycle.metrics.sagasCompensated++;
    this.lifecycle.metrics.activeInstances--;
    this.lifecycle.activeInstances.delete(sagaId);

    logger.info({ sagaId }, "Saga compensation completed");

    await this.releaseAllLocks(sagaId);
  }

  // ---------------------------------------------------------------------------
  // Completion & Failure
  // ---------------------------------------------------------------------------

  private async completeSaga(instance: SagaInstance): Promise<void> {
    const completedAt = new Date();
    const executionTime = completedAt.getTime() - instance.startedAt.getTime();

    instance.status = "COMPLETED";
    instance.completedAt = completedAt;

    const sagaCompletedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_COMPLETED,
      instance.id,
      "Saga",
      {
        sagaId: instance.id,
        definitionId: instance.definitionId,
        correlationId: instance.context.correlationId,
        status: "COMPLETED",
        completedAt,
        duration: executionTime,
        stepsCompleted: instance.stepResults.filter((r) => r?.success).length,
        stepsFailed: instance.stepResults.filter((r) => r && !r.success).length,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    await this.persistSagaInstance(instance, [sagaCompletedEvent]);

    this.lifecycle.metrics.sagasCompleted++;
    this.lifecycle.metrics.activeInstances--;
    this.lifecycle.activeInstances.delete(instance.id);

    this.lifecycle.executionTimes.push(executionTime);
    if (this.lifecycle.executionTimes.length > 100) {
      this.lifecycle.executionTimes.shift();
    }
    this.lifecycle.metrics.averageExecutionTime =
      this.lifecycle.executionTimes.reduce((a, b) => a + b, 0) /
      this.lifecycle.executionTimes.length;

    logger.info(
      { sagaId: instance.id, executionTimeMs: executionTime },
      "Saga completed successfully"
    );

    await this.releaseAllLocks(instance.id);
  }

  /**
   * Best-effort release of every semantic lock held by `sagaId`. Called on
   * every terminal-state transition (COMPLETED / FAILED / COMPENSATED).
   * If the lock store is misconfigured or unreachable the locks will
   * eventually time out via TTL — never deadlock, even on this path.
   */
  private async releaseAllLocks(sagaId: string): Promise<void> {
    if (!this.config.lockStore) return;
    const result = await this.config.lockStore.releaseAllForSaga(sagaId);
    if (!result.ok) {
      logger.warn(
        { sagaId, err: result.error },
        "Semantic lock cleanup failed; locks will expire via TTL"
      );
    }
  }

  /**
   * @method failSaga
   * @description Drives a saga to the terminal FAILED state, persisting the
   *   outcome and its audit event.
   * @param instance - The saga to fail.
   * @param error - Operator-facing description of what ended it.
   * @param reason - Failure class for the alerting series; defaults to a step
   *   failure, which is what exhausted retries and thrown steps are.
   */
  async failSaga(
    instance: SagaInstance,
    error: string,
    reason: SagaFailureReason = "step-failure"
  ): Promise<void> {
    const completedAt = new Date();
    const executionTime = completedAt.getTime() - instance.startedAt.getTime();

    instance.status = "FAILED";
    instance.completedAt = completedAt;
    instance.error = error;

    const sagaFailedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_FAILED,
      instance.id,
      "Saga",
      {
        sagaId: instance.id,
        definitionId: instance.definitionId,
        correlationId: instance.context.correlationId,
        status: "FAILED",
        completedAt,
        duration: executionTime,
        stepsCompleted: instance.stepResults.filter((r) => r?.success).length,
        stepsFailed: instance.stepResults.filter((r) => r && !r.success).length,
        error,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    await this.persistSagaInstance(instance, [sagaFailedEvent]);

    this.lifecycle.metrics.sagasFailed++;
    this.lifecycle.metrics.activeInstances--;
    recordSagaFailed(reason);

    logger.error({ sagaId: instance.id, error, reason }, "Saga failed");

    await this.releaseAllLocks(instance.id);
  }

  // ---------------------------------------------------------------------------
  // Retry Logic
  // ---------------------------------------------------------------------------

  private shouldRetryStep(definition: SagaDefinition, instance: SagaInstance): boolean {
    const retryPolicy = definition.retryPolicy;
    if (!retryPolicy) {
      return false;
    }

    return instance.retryCount < retryPolicy.maxRetries;
  }

  private calculateRetryDelay(definition: SagaDefinition, retryCount: number): number {
    const retryPolicy = definition.retryPolicy;
    if (!retryPolicy) {
      return 0;
    }

    let delay = retryPolicy.backoffMs;
    if (retryPolicy.exponential) {
      delay = delay * Math.pow(2, retryCount - 1);
    }

    return delay;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Redis cache TTL for saga instances: 24 hours */
  private static readonly REDIS_TTL_SECONDS = 24 * 60 * 60;

  /**
   * @method writeSagaState
   * @description Writes the saga row and its audit events inside a transaction
   *   the caller opened and scoped. Extracted so the scoped and the
   *   account-less paths commit byte-identical state.
   * @param tx - The open transaction client.
   * @param instance - The saga being persisted.
   * @param accountId - Owning account, or `null` when none resolved (key omitted).
   * @param events - Durable events committing with the state.
   */
  private async writeSagaState(
    tx: SagaTransactionClient,
    instance: SagaInstance,
    accountId: string | null,
    events: EventStoreEvent[]
  ): Promise<void> {
    const contextJson = JSON.parse(JSON.stringify(instance.context));
    const stepResultsJson = JSON.parse(JSON.stringify(instance.stepResults));
    const compensationResultsJson = JSON.parse(JSON.stringify(instance.compensationResults));

    // The update path explicitly null-clears nextRetryAt when the in-memory
    // value is undefined, so a successful step (or saga completion) wipes the
    // pending retry marker instead of leaving the checker to claim it again.
    await tx.sagaInstance.upsert({
      where: { id: instance.id },
      create: {
        id: instance.id,
        definitionId: instance.definitionId,
        status: instance.status,
        currentStep: instance.currentStep,
        context: contextJson,
        stepResults: stepResultsJson,
        compensationResults: compensationResultsJson,
        retryCount: instance.retryCount,
        startedAt: instance.startedAt,
        ...(instance.error !== undefined && { error: instance.error }),
        ...(accountId !== null && { accountId }),
        ...(instance.completedAt && { completedAt: instance.completedAt }),
        ...(instance.nextRetryAt && { nextRetryAt: instance.nextRetryAt }),
      },
      update: {
        definitionId: instance.definitionId,
        status: instance.status,
        currentStep: instance.currentStep,
        context: contextJson,
        stepResults: stepResultsJson,
        compensationResults: compensationResultsJson,
        retryCount: instance.retryCount,
        startedAt: instance.startedAt,
        ...(instance.error !== undefined && { error: instance.error }),
        ...(accountId !== null && { accountId }),
        ...(instance.completedAt && { completedAt: instance.completedAt }),
        nextRetryAt: instance.nextRetryAt ?? null,
      },
    });

    for (const event of events) {
      // eventService is guaranteed present during saga execution (only
      // reachable after initialize(), which requires a full config).
      await this.config.eventService!.appendEventInTx(tx, event);
    }
  }

  /**
   * Dual-write persistence: PostgreSQL (durable) + Redis (hot cache).
   *
   * Strategy:
   *  - PostgreSQL is the **source of truth** via Prisma `upsert`.
   *  - Redis is a **best-effort hot cache** via `setex` with 24h TTL.
   *  - Both writes run in parallel (`Promise.allSettled`).
   *  - A Redis failure is logged as a warning but does NOT reject the promise,
   *    because the durable Postgres write is what guarantees saga recovery
   *    after a crash or Redis restart.
   *
   * @param instance - The saga instance to persist
   */
  async persistSagaInstance(instance: SagaInstance, events: EventStoreEvent[] = []): Promise<void> {
    const key = `saga:${instance.id}`;
    const serialized = JSON.stringify({
      ...instance,
      startedAt: instance.startedAt.toISOString(),
      ...(instance.completedAt && { completedAt: instance.completedAt.toISOString() }),
      ...(instance.nextRetryAt && { nextRetryAt: instance.nextRetryAt.toISOString() }),
    });

    // The tenant column carries the OWNING ACCOUNT, never the acting user. A row
    // whose column contradicts its context is refused here as well as at the
    // rehydration: writing it would either advance the wrong tenant's saga or
    // collide on the primary key once the guard narrowed the update away.
    const resolution = resolveSagaTenant(instance);
    if (resolution.kind === "tenant-mismatch") {
      throw AppError.conflict(
        `Refusing to persist saga '${instance.id}': the persisted account contradicts its context`,
        {
          sagaId: instance.id,
          columnAccountId: resolution.columnAccountId,
          contextAccountId: resolution.contextAccountId,
        }
      );
    }
    // When no account resolves the key is omitted entirely (not written as
    // `undefined`) so `exactOptionalPropertyTypes` and Prisma both see an
    // absent field rather than an explicit null.
    const accountId = resolution.kind === "resolved" ? resolution.accountId : null;

    // Atomicity gate: saga state + durable event log commit together. Without
    // the wrapping transaction, a Postgres lag between sagaInstance.upsert
    // and eventStore.append could leave the saga advanced but its audit
    // event missing — OWASP A09 (Logging Failures) gap. The tenant variant
    // additionally binds the transaction-local account scope, so the row-level
    // policies govern the same rows the Prisma guard narrowed.
    try {
      if (accountId !== null) {
        await runSagaTenantTransaction(this.config.prisma, accountId, (tx) =>
          this.writeSagaState(tx, instance, accountId, events)
        );
      } else {
        await this.config.prisma.$transaction((tx) =>
          this.writeSagaState(tx, instance, accountId, events)
        );
      }
    } catch (err: unknown) {
      captureError(err, { sagaId: instance.id, operation: "persistSagaInstance" });
      logger.error({ err, sagaId: instance.id }, "Failed to persist saga to PostgreSQL");
      throw err;
    }

    // Best-effort post-commit work — Redis cache + pub/sub broadcast. Failures
    // here do NOT roll back the durable state: the saga has advanced and the
    // event is in the EventStore.
    this.config.redis
      .setex(key, SagaExecutionEngine.REDIS_TTL_SECONDS, serialized)
      .catch((cacheErr: unknown) => {
        logger.warn(
          { err: cacheErr, sagaId: instance.id },
          "Failed to cache saga in Redis (non-fatal)"
        );
      });

    for (const event of events) {
      // eventService is guaranteed present during saga execution (only
      // reachable after initialize(), which requires a full config).
      this.config.eventService!.broadcastEvent(event).catch((broadcastErr: unknown) => {
        logger.warn(
          { err: broadcastErr, eventType: event.type, sagaId: instance.id },
          "Failed to broadcast saga event (non-fatal)"
        );
      });
    }
  }

  /**
   * Read-through cache: Redis first, fallback to PostgreSQL.
   *
   * Strategy:
   *  - **Fast path**: try Redis `GET`. If found, deserialize and return.
   *  - **Slow path**: on Redis miss, query PostgreSQL via Prisma.
   *  - **Cache warming**: on Postgres hit, re-populate Redis asynchronously
   *    (fire-and-forget `setex`) so the next read is fast.
   *
   * @param sagaId - The saga instance ID to load
   * @returns The deserialized SagaInstance, or null if not found anywhere
   */
  async loadSagaInstance(sagaId: string): Promise<SagaInstance | null> {
    const key = `saga:${sagaId}`;

    // Fast path: Redis cache
    try {
      const cached = await this.config.redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        return this.deserializeSagaInstance(parsed);
      }
    } catch (error) {
      logger.warn({ err: error, sagaId }, "Redis read failed, falling back to PostgreSQL");
    }

    // Slow path: PostgreSQL. The engine is triggered detached from any request
    // (boot, scheduler tick, worker pub/sub), so which tenant owns this id is
    // exactly what the read is here to discover. The declared system boundary
    // is therefore scoped to the read itself and ends with it — everything the
    // caller then does with the row runs under the saga's own rehydrated scope.
    try {
      const row = await withSagaSystemRead(this.config.prisma, (tx) =>
        tx.sagaInstance.findUnique({
          where: { id: sagaId },
        })
      );

      if (!row) {
        return null;
      }

      const instance = this.deserializePrismaRow(row);

      // Re-warm Redis cache (fire-and-forget)
      const serialized = JSON.stringify({
        ...instance,
        startedAt: instance.startedAt.toISOString(),
        ...(instance.completedAt && { completedAt: instance.completedAt.toISOString() }),
      });
      this.config.redis
        .setex(key, SagaExecutionEngine.REDIS_TTL_SECONDS, serialized)
        .catch((err: unknown) => {
          logger.warn({ err, sagaId }, "Failed to re-warm Redis cache for saga (non-fatal)");
        });

      return instance;
    } catch (error) {
      // An infrastructure failure is NOT an absent row: both used to return
      // null, so a database outage read to every caller as "this saga does not
      // exist". Counting it separately is what makes the two distinguishable
      // from logs and metrics alone.
      this.lifecycle.metrics.instanceLoadFailures++;
      recordSagaRecoveryFailure("instance-load");
      captureError(error, { sagaId, loop: "instance-load" });
      logger.error(
        {
          err: error,
          sagaId,
          loop: "instance-load",
          errorType: error instanceof Error ? error.name : typeof error,
        },
        "Failed to load saga instance from PostgreSQL"
      );
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Deserialization Helpers
  // ---------------------------------------------------------------------------

  private deserializeSagaInstance(parsed: Record<string, unknown>): SagaInstance {
    return {
      id: parsed.id as string,
      definitionId: parsed.definitionId as string,
      status: parsed.status as SagaInstance["status"],
      currentStep: parsed.currentStep as number,
      // The tenant column travels with the instance. Dropping it here would
      // strand every row whose account lives only in the column — exactly the
      // rows a data repair fixes — because the context alone cannot scope them.
      ...(typeof parsed.accountId === "string" && { accountId: parsed.accountId }),
      context: parsed.context as SagaInstance["context"],
      stepResults: parsed.stepResults as SagaInstance["stepResults"],
      compensationResults: parsed.compensationResults as SagaInstance["compensationResults"],
      startedAt: new Date(parsed.startedAt as string),
      retryCount: parsed.retryCount as number,
      ...(typeof parsed.completedAt === "string"
        ? { completedAt: new Date(parsed.completedAt) }
        : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      ...(typeof parsed.nextRetryAt === "string"
        ? { nextRetryAt: new Date(parsed.nextRetryAt) }
        : {}),
    };
  }

  private deserializePrismaRow(row: SagaInstanceRow): SagaInstance {
    return deserializeSagaInstanceRow(row);
  }
}
