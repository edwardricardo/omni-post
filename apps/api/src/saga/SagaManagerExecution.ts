/**
 * @file SagaManagerExecution.ts
 * @description Saga execution and compensation engine handling step execution, persistence,
 *              retry logic, and completion/failure processing.
 * @layer application
 */

import type { SagaDefinition, SagaInstance } from "@shared/saga";
import { SAGA_EVENTS } from "@shared/saga";
import { createEventStoreEvent, type EventStoreEvent } from "@shared/events";
import type { SagaManagerLifecycle } from "./SagaManagerLifecycle.js";
import type { SagaManagerConfig } from "./sagaManagerTypes.js";
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

  async failSaga(instance: SagaInstance, error: string): Promise<void> {
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

    logger.error({ sagaId: instance.id, error }, "Saga failed");

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

    // Cast domain types to Prisma-compatible JSON values
    const contextJson = JSON.parse(JSON.stringify(instance.context));
    const stepResultsJson = JSON.parse(JSON.stringify(instance.stepResults));
    const compensationResultsJson = JSON.parse(JSON.stringify(instance.compensationResults));

    // Atomicity gate: saga state + durable event log commit together. Without
    // the wrapping $transaction, a Postgres lag between sagaInstance.upsert
    // and eventStore.append could leave the saga advanced but its audit
    // event missing — OWASP A09 (Logging Failures) gap. Update path explicitly
    // null-clears nextRetryAt when the in-memory value is undefined so a
    // successful step (or saga completion) wipes the pending retry marker.
    try {
      await this.config.prisma.$transaction(async (tx) => {
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
            ...(instance.context.userId && { accountId: instance.context.userId }),
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
            ...(instance.context.userId && { accountId: instance.context.userId }),
            ...(instance.completedAt && { completedAt: instance.completedAt }),
            nextRetryAt: instance.nextRetryAt ?? null,
          },
        });

        for (const event of events) {
          await this.config.eventService.appendEventInTx(tx, event);
        }
      });
    } catch (err: unknown) {
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
      this.config.eventService.broadcastEvent(event).catch((broadcastErr: unknown) => {
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

    // Slow path: PostgreSQL
    try {
      const row = await this.config.prisma.sagaInstance.findUnique({
        where: { id: sagaId },
      });

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
      logger.error({ err: error, sagaId }, "Failed to load saga instance from PostgreSQL");
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

  private deserializePrismaRow(row: {
    id: string;
    definitionId: string;
    status: string;
    currentStep: number;
    context: unknown;
    stepResults: unknown;
    compensationResults: unknown;
    retryCount: number;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
    nextRetryAt?: Date | null;
  }): SagaInstance {
    return {
      id: row.id,
      definitionId: row.definitionId,
      status: row.status as SagaInstance["status"],
      currentStep: row.currentStep,
      context: row.context as SagaInstance["context"],
      stepResults: row.stepResults as SagaInstance["stepResults"],
      compensationResults: row.compensationResults as SagaInstance["compensationResults"],
      retryCount: row.retryCount,
      startedAt: row.startedAt,
      ...(row.error !== null && { error: row.error }),
      ...(row.completedAt !== null && { completedAt: row.completedAt }),
      ...(row.nextRetryAt && { nextRetryAt: row.nextRetryAt }),
    };
  }
}
