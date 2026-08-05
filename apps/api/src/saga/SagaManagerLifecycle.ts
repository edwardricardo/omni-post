/**
 * @file SagaManagerLifecycle.ts
 * @description Saga lifecycle management handling initialization, registration, start,
 *              event handling, health checks, metrics collection, and graceful shutdown.
 * @layer infrastructure
 */

import type { SagaManager, SagaDefinition, SagaInstance, SagaContext } from "@shared/types/saga.js";
import { createSagaId, createSagaContext, SAGA_EVENTS } from "@shared/types/saga.js";
import type { EventStoreEvent } from "@shared/types/events.js";
import { createEventStoreEvent } from "@shared/types/events.js";
import {
  failSagaAsSystem,
  newSagaRecoveryCorrelationId,
  resolveContextAccountId,
  runAsSagaTenant,
  withSagaSystemRead,
  type SagaTenantSkipReason,
} from "./sagaTenant.js";
import { deserializeSagaInstanceRow } from "./sagaInstanceRow.js";
import { recordSagaRecoveryFailure } from "../metrics/sagaRecoveryMetrics.js";
import { captureError } from "../observability/sentryInit.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";
import type {
  SagaManagerConfig,
  SagaMetrics,
  SagaExecutionEnginePort,
} from "./sagaManagerTypes.js";

// Re-export for consumers that import types from this file.
export type { SagaManagerConfig, SagaMetrics } from "./sagaManagerTypes.js";

/**
 * Saga engine health. `degraded` is distinct from `unhealthy` on purpose: the
 * dependencies answer, but the process could not read what was in flight when it
 * started, so it is serving without recovery coverage.
 */
export interface SagaHealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  details: {
    definitionsRegistered: number;
    activeInstances: number;
    database: boolean;
    redis: boolean;
    /** False when the boot recovery load failed for this process. */
    recoveredAtBoot: boolean;
  };
}

/**
 * Saga lifecycle management: init, register, start, get, shutdown
 */
export class SagaManagerLifecycle implements SagaManager {
  readonly definitions = new Map<string, SagaDefinition>();
  readonly activeInstances = new Map<string, SagaInstance>();
  readonly metrics: SagaMetrics = {
    sagasStarted: 0,
    sagasCompleted: 0,
    sagasFailed: 0,
    sagasCompensated: 0,
    averageExecutionTime: 0,
    activeInstances: 0,
    bootLoadFailures: 0,
    recoveryScanFailures: 0,
    rehydrationFailures: 0,
    tenantMismatches: 0,
    timeoutCheckFailures: 0,
    instanceLoadFailures: 0,
  };
  readonly executionTimes: number[] = [];

  /** Set by SagaManagerImpl facade after construction */
  executionEngine!: SagaExecutionEnginePort;

  constructor(readonly config: SagaManagerConfig) {}

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    // Ensure the event service is ready before saga recovery.
    // This call is idempotent (guards on an internal isInitialized flag).
    // eventService is guaranteed present when initialize() is called (only
    // invoked during full startup, never in schema-only mode).
    await this.config.eventService!.initialize();

    // One correlation id per recovery pass, so an operator can join the load,
    // whatever it registered, and any failure it hit. A failed load must not
    // kill boot, but it must never read as an empty successful one either.
    const correlationId = newSagaRecoveryCorrelationId();
    try {
      await this.loadActiveSagas(correlationId);
    } catch (error) {
      this.metrics.bootLoadFailures++;
      recordSagaRecoveryFailure("boot");
      captureError(error, { loop: "boot-load", correlationId });
      logger.error(
        {
          err: error,
          loop: "boot-load",
          errorType: error instanceof Error ? error.name : typeof error,
          correlationId,
        },
        "Failed to load active sagas from PostgreSQL"
      );
    }

    this.startTimeoutChecker();
    this.startMetricsCollector();
    this.startRetryRecoveryChecker();

    logger.info("Saga Manager initialized successfully");
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  registerSaga(definition: SagaDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw AppError.conflict(`Saga definition '${definition.id}' is already registered`);
    }

    this.definitions.set(definition.id, definition);
    logger.info({ sagaName: definition.name, sagaId: definition.id }, "Registered saga definition");
  }

  // ---------------------------------------------------------------------------
  // Start Saga
  // ---------------------------------------------------------------------------

  async startSaga(definitionId: string, contextData: Partial<SagaContext>): Promise<SagaInstance> {
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      throw AppError.notFound(`Saga definition '${definitionId}'`);
    }

    const sagaId = createSagaId(definitionId);
    const correlationId = contextData.correlationId || `corr-${sagaId}`;

    const context = createSagaContext({
      sagaId,
      correlationId,
      ...(contextData.accountId !== undefined && { accountId: contextData.accountId }),
      ...(contextData.userId !== undefined && { userId: contextData.userId }),
      metadata: contextData.metadata || {},
    });

    // Fail CLOSED before anything is written. A saga created without a
    // resolvable owning account can never be scoped afterwards: every detached
    // path would skip it and it would sit non-terminal until a timeout. The two
    // account sources must also agree, because the pivot step's fail-closed
    // check reads the metadata copy while the engine scopes on the field — a
    // divergence there would publish under one account and persist under another.
    const startAccountId = resolveContextAccountId(context);
    if (startAccountId === null) {
      throw AppError.badRequest(`Saga '${definitionId}' cannot start without an owning account`, {
        definitionId,
      });
    }
    const metadataAccountId = context.metadata.accountId;
    if (typeof metadataAccountId === "string" && metadataAccountId !== startAccountId) {
      throw AppError.badRequest(`Saga '${definitionId}' declares two different owning accounts`, {
        definitionId,
        contextAccountId: startAccountId,
        metadataAccountId,
      });
    }

    const instance: SagaInstance = {
      id: sagaId,
      definitionId,
      status: "PENDING",
      currentStep: 0,
      accountId: startAccountId,
      context,
      stepResults: [],
      compensationResults: [],
      startedAt: new Date(),
      retryCount: 0,
    };

    const sagaStartedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_STARTED,
      sagaId,
      "Saga",
      {
        sagaId,
        definitionId,
        correlationId,
        userId: context.userId,
        startedAt: instance.startedAt,
        totalSteps: definition.steps.length,
      },
      {
        source: "SagaManager",
        correlationId,
      }
    );

    await this.executionEngine.persistSagaInstance(instance, [sagaStartedEvent]);

    this.activeInstances.set(sagaId, instance);

    this.metrics.sagasStarted++;
    this.metrics.activeInstances++;

    this.executionEngine.executeSagaAsync(sagaId);

    return instance;
  }

  // ---------------------------------------------------------------------------
  // Continue & Compensate
  // ---------------------------------------------------------------------------

  async continueSaga(sagaId: string): Promise<SagaInstance> {
    const instance = await this.getSaga(sagaId);
    if (!instance) {
      throw AppError.notFound(`Saga '${sagaId}'`);
    }

    if (instance.status !== "RUNNING" && instance.status !== "PENDING") {
      throw AppError.badRequest(
        `Saga '${sagaId}' is not in a continuable state: ${instance.status}`
      );
    }

    this.executionEngine.executeSagaAsync(sagaId);

    return instance;
  }

  async compensateSaga(sagaId: string): Promise<SagaInstance> {
    const instance = await this.getSaga(sagaId);
    if (!instance) {
      throw AppError.notFound(`Saga '${sagaId}'`);
    }

    if (instance.status !== "FAILED") {
      throw AppError.badRequest(`Saga '${sagaId}' is not in a failed state: ${instance.status}`);
    }

    instance.status = "COMPENSATING";

    const compensationStartedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_COMPENSATION_STARTED,
      sagaId,
      "Saga",
      {
        sagaId,
        definitionId: instance.definitionId,
        failedAt: instance.completedAt,
        stepsToCompensate: instance.currentStep,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    // Reached from the admin route, which authenticates an operator and binds
    // no tenant scope, so the write rehydrates the saga's own account. The
    // dispatch below stays outside every declared context.
    const outcome = await runAsSagaTenant(
      instance,
      () => this.executionEngine.persistSagaInstance(instance, [compensationStartedEvent]),
      this.metrics
    );

    if (!outcome.ran) {
      // The operator asked for compensation and it did not start. Answering
      // with a success envelope here is what made an unscopable saga look
      // compensated to whoever pressed the button.
      instance.status = "FAILED";
      throw AppError.conflict(
        `Saga '${sagaId}' cannot be compensated: its owning account is unresolvable (${outcome.reason})`,
        { sagaId, reason: outcome.reason }
      );
    }

    this.executionEngine.compensateSagaAsync(sagaId);

    return instance;
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  async getSaga(sagaId: string): Promise<SagaInstance | null> {
    const memoryInstance = this.activeInstances.get(sagaId);
    if (memoryInstance) {
      return memoryInstance;
    }

    return await this.executionEngine.loadSagaInstance(sagaId);
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  async handleEvent(event: EventStoreEvent): Promise<void> {
    if (event.type === "publish.job.completed" || event.type === "publish.job.failed") {
      const sagaId = event.metadata?.sagaId as string;
      if (sagaId) {
        const instance = await this.getSaga(sagaId);
        if (instance && instance.status === "RUNNING") {
          const definition = this.definitions.get(instance.definitionId);
          if (definition) {
            const currentStep = definition.steps[instance.currentStep];
            if (currentStep?.id === "wait-publishing-completion") {
              this.executionEngine.executeSagaAsync(sagaId);
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Metrics & Health
  // ---------------------------------------------------------------------------

  getMetrics(): SagaMetrics & { definitions: string[] } {
    return {
      ...this.metrics,
      definitions: Array.from(this.definitions.keys()),
    };
  }

  async healthCheck(): Promise<SagaHealthReport> {
    try {
      await this.config.prisma.$queryRaw`SELECT 1`;
      const dbHealthy = true;

      const redisResponse = await this.config.redis.ping();
      const redisHealthy = redisResponse === "PONG";

      // A process whose boot load failed is REACHABLE but does not know which
      // sagas were in flight when it started. Reporting that as healthy is how
      // a permanently blind engine passes every probe it is asked.
      const recoveredAtBoot = this.metrics.bootLoadFailures === 0;
      const dependenciesHealthy = dbHealthy && redisHealthy;

      return {
        status: !dependenciesHealthy ? "unhealthy" : recoveredAtBoot ? "healthy" : "degraded",
        details: {
          definitionsRegistered: this.definitions.size,
          activeInstances: this.activeInstances.size,
          database: dbHealthy,
          redis: redisHealthy,
          recoveredAtBoot,
        },
      };
    } catch (error) {
      captureError(error, { operation: "sagaHealthCheck" });
      logger.error({ err: error }, "Saga Manager health check failed");
      return {
        status: "unhealthy",
        details: {
          definitionsRegistered: this.definitions.size,
          activeInstances: this.activeInstances.size,
          database: false,
          redis: false,
          recoveredAtBoot: this.metrics.bootLoadFailures === 0,
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    logger.info("Shutting down Saga Manager");

    for (const instance of this.activeInstances.values()) {
      if (instance.status !== "RUNNING") continue;

      // One saga that cannot be parked must not stop the others from being
      // parked, and must not stop the process from shutting down: a drain that
      // throws here used to abort the whole teardown.
      try {
        instance.status = "PENDING";
        const outcome = await runAsSagaTenant(
          instance,
          () => this.executionEngine.persistSagaInstance(instance),
          this.metrics
        );
        if (!outcome.ran) {
          logger.warn(
            { sagaId: instance.id, reason: outcome.reason },
            "Saga not parked on shutdown: its owning account is unresolvable"
          );
        }
      } catch (error) {
        captureError(error, { sagaId: instance.id, operation: "sagaShutdownPark" });
        logger.error(
          {
            err: error,
            sagaId: instance.id,
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "Failed to park a running saga during shutdown"
        );
      }
    }

    this.activeInstances.clear();
    this.definitions.clear();

    logger.info("Saga Manager shutdown complete");
  }

  // ---------------------------------------------------------------------------
  // Private: Background Processes
  // ---------------------------------------------------------------------------

  /**
   * Load active sagas from PostgreSQL (crash recovery).
   *
   * Queries Postgres for sagas whose status is RUNNING or PENDING.
   * This survives a Redis restart because the durable store is the source
   * of truth. Each loaded saga is also re-warmed into the Redis hot cache
   * via `persistSagaInstance` so subsequent reads are fast.
   *
   * The scan itself spans every tenant and runs before any of them is known,
   * so it declares the saga system boundary — narrowed to the read. The rows it
   * returns are then re-warmed under each saga's own rehydrated scope.
   *
   * @param correlationId - Identifier joining this recovery pass in the logs.
   */
  private async loadActiveSagas(correlationId: string): Promise<void> {
    const rows = await withSagaSystemRead(() =>
      this.config.prisma.sagaInstance.findMany({
        where: {
          status: { in: ["RUNNING", "PENDING"] },
        },
      })
    );

    let skipped = 0;
    for (const row of rows) {
      const instance = deserializeSagaInstanceRow(row);
      this.activeInstances.set(instance.id, instance);
      this.metrics.activeInstances++;

      // Re-warm Redis cache (fire-and-forget). The outcome is consumed rather
      // than discarded: a re-warm that never ran is a saga this process cannot
      // scope, which the operator needs in the same correlated pass.
      const rewarm = runAsSagaTenant(
        instance,
        () => this.executionEngine.persistSagaInstance(instance),
        this.metrics
      );
      void rewarm
        .then((outcome) => {
          if (!outcome.ran) {
            skipped++;
            logger.warn(
              { sagaId: instance.id, reason: outcome.reason, correlationId },
              "Loaded saga could not be re-warmed: its owning account is unresolvable"
            );
          }
        })
        .catch((err: unknown) => {
          logger.warn(
            { err, sagaId: instance.id, correlationId },
            "Failed to re-warm Redis cache during recovery"
          );
        });
    }

    logger.info(
      { count: this.activeInstances.size, skipped, correlationId },
      "Loaded active saga instances from PostgreSQL"
    );
  }

  /**
   * Polls every 5s for sagas whose nextRetryAt has elapsed and resumes them.
   * Persisted retries survive process restarts: a saga that scheduled a
   * retry just before a crash gets picked up here at the next boot tick.
   * Indexed by (status, nextRetryAt) so the scan is cheap.
   */
  private startRetryRecoveryChecker(): void {
    this.config.scheduler.register(
      "saga-retry-recovery",
      async () => {
        const correlationId = newSagaRecoveryCorrelationId();
        try {
          const now = new Date();
          // Tenant-unknown by construction: the tick asks which sagas are due
          // across every account. The boundary ends with the read so the
          // resumes below run under each saga's own rehydrated scope. Ordering
          // by due time makes the `take` window deterministic — an unordered
          // limit lets the same late saga fall off the page on every tick.
          const dueRows = await withSagaSystemRead(() =>
            this.config.prisma.sagaInstance.findMany({
              where: {
                status: "RUNNING",
                nextRetryAt: { lte: now, not: null },
              },
              select: { id: true },
              orderBy: { nextRetryAt: "asc" },
              take: 50,
            })
          );

          for (const { id: sagaId } of dueRows) {
            this.executionEngine.executeSagaAsync(sagaId);
          }

          if (dueRows.length > 0) {
            logger.info({ count: dueRows.length, correlationId }, "Resumed sagas with due retries");
          }
        } catch (err) {
          this.metrics.recoveryScanFailures++;
          recordSagaRecoveryFailure("retry-scan");
          captureError(err, { loop: "retry-recovery-scan", correlationId });
          logger.error(
            {
              err,
              loop: "retry-recovery-scan",
              errorType: err instanceof Error ? err.name : typeof err,
              correlationId,
            },
            "Saga retry recovery scan failed"
          );
        }
      },
      5000
    );
  }

  private startTimeoutChecker(): void {
    this.config.scheduler.register(
      "saga-timeout-checker",
      async () => {
        const correlationId = newSagaRecoveryCorrelationId();
        for (const [sagaId, instance] of this.activeInstances) {
          // Per saga, not per pass: one row that throws used to end the pass,
          // so every saga after it in the map went unchecked until the next
          // tick — and forever if the same row threw again.
          try {
            await this.checkSagaTimeout(sagaId, instance);
          } catch (error) {
            this.metrics.timeoutCheckFailures++;
            recordSagaRecoveryFailure("timeout");
            captureError(error, { loop: "timeout-checker", sagaId, correlationId });
            logger.error(
              {
                err: error,
                loop: "timeout-checker",
                errorType: error instanceof Error ? error.name : typeof error,
                sagaId,
                correlationId,
              },
              "Saga timeout check failed"
            );
          }
        }
      },
      60000
    );
  }

  /**
   * Fails one saga that has outlived its timeout. A saga the engine cannot scope
   * to a tenant is TERMINALIZED instead: no tenant-scoped statement can address
   * it, so without this it would stay non-terminal forever while every tick
   * logged and counted it again — the infinite RUNNING state the saga canon
   * forbids.
   */
  private async checkSagaTimeout(sagaId: string, instance: SagaInstance): Promise<void> {
    const definition = this.definitions.get(instance.definitionId);
    if (!definition) return;

    const timeout = definition.timeout || this.config.defaultTimeout || 30 * 60 * 1000;
    const elapsed = Date.now() - instance.startedAt.getTime();
    if (elapsed <= timeout) return;

    logger.warn({ sagaId, elapsedMs: elapsed, timeoutMs: timeout }, "Saga timeout");

    const outcome = await runAsSagaTenant(
      instance,
      () => this.executionEngine.failSaga(instance, "Saga timeout exceeded", "timeout"),
      this.metrics
    );

    if (!outcome.ran) {
      await this.terminalizeUnscopableSaga(sagaId, instance, outcome.reason);
    }
  }

  /**
   * Drives a saga no tenant scope can address to FAILED through the engine's
   * single system-scoped write, and stops tracking it so the checker cannot
   * revisit it on the next tick.
   */
  private async terminalizeUnscopableSaga(
    sagaId: string,
    instance: SagaInstance,
    reason: SagaTenantSkipReason
  ): Promise<void> {
    await failSagaAsSystem(this.config.prisma, instance, reason);

    this.activeInstances.delete(sagaId);
    this.metrics.sagasFailed++;
    this.metrics.activeInstances--;
  }

  private startMetricsCollector(): void {
    if (!this.config.enableMetrics) return;

    this.config.scheduler.register(
      "saga-metrics-collector",
      () => {
        this.metrics.activeInstances = this.activeInstances.size;
      },
      30000
    );
  }
}
