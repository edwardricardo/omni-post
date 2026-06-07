/**
 * @file SagaManagerLifecycle.ts
 * @description Saga lifecycle management handling initialization, registration, start,
 *              event handling, health checks, metrics collection, and graceful shutdown.
 * @layer infrastructure
 */

import type { SagaManager, SagaDefinition, SagaInstance, SagaContext } from "@shared/saga";
import { createSagaId, createSagaContext, SAGA_EVENTS } from "@shared/saga";
import type { EventStoreEvent } from "@shared/events";
import { createEventStoreEvent } from "@shared/events";
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

    await this.loadActiveSagas();

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

    const context = createSagaContext(
      sagaId,
      correlationId,
      contextData.userId,
      contextData.metadata || {}
    );

    const instance: SagaInstance = {
      id: sagaId,
      definitionId,
      status: "PENDING",
      currentStep: 0,
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

    await this.executionEngine.persistSagaInstance(instance, [compensationStartedEvent]);

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

  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: {
      definitionsRegistered: number;
      activeInstances: number;
      database: boolean;
      redis: boolean;
    };
  }> {
    try {
      await this.config.prisma.$queryRaw`SELECT 1`;
      const dbHealthy = true;

      const redisResponse = await this.config.redis.ping();
      const redisHealthy = redisResponse === "PONG";

      return {
        status: dbHealthy && redisHealthy ? "healthy" : "unhealthy",
        details: {
          definitionsRegistered: this.definitions.size,
          activeInstances: this.activeInstances.size,
          database: dbHealthy,
          redis: redisHealthy,
        },
      };
    } catch (error) {
      logger.error({ err: error }, "Saga Manager health check failed");
      return {
        status: "unhealthy",
        details: {
          definitionsRegistered: this.definitions.size,
          activeInstances: this.activeInstances.size,
          database: false,
          redis: false,
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
      if (instance.status === "RUNNING") {
        instance.status = "PENDING";
        await this.executionEngine.persistSagaInstance(instance);
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
   */
  private async loadActiveSagas(): Promise<void> {
    try {
      const rows = await this.config.prisma.sagaInstance.findMany({
        where: {
          status: { in: ["RUNNING", "PENDING"] },
        },
      });

      for (const row of rows) {
        const instance = this.deserializePrismaRow(row);
        this.activeInstances.set(instance.id, instance);
        this.metrics.activeInstances++;

        // Re-warm Redis cache (fire-and-forget)
        this.executionEngine.persistSagaInstance(instance).catch((err: unknown) => {
          logger.warn(
            { err, sagaId: instance.id },
            "Failed to re-warm Redis cache during recovery"
          );
        });
      }

      logger.info(
        { count: this.activeInstances.size },
        "Loaded active saga instances from PostgreSQL"
      );
    } catch (error) {
      logger.error({ err: error }, "Failed to load active sagas from PostgreSQL");
    }
  }

  /**
   * Convert a Prisma SagaInstance row into the domain SagaInstance type.
   */
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
        try {
          const now = new Date();
          const dueRows = await this.config.prisma.sagaInstance.findMany({
            where: {
              status: "RUNNING",
              nextRetryAt: { lte: now, not: null },
            },
            select: { id: true },
            take: 50,
          });

          for (const { id: sagaId } of dueRows) {
            this.executionEngine.executeSagaAsync(sagaId);
          }

          if (dueRows.length > 0) {
            logger.info({ count: dueRows.length }, "Resumed sagas with due retries");
          }
        } catch (err) {
          logger.error({ err }, "Saga retry recovery scan failed");
        }
      },
      5000
    );
  }

  private startTimeoutChecker(): void {
    this.config.scheduler.register(
      "saga-timeout-checker",
      async () => {
        for (const [sagaId, instance] of this.activeInstances) {
          const definition = this.definitions.get(instance.definitionId);
          if (!definition) continue;

          const timeout = definition.timeout || this.config.defaultTimeout || 30 * 60 * 1000;
          const elapsed = Date.now() - instance.startedAt.getTime();

          if (elapsed > timeout) {
            logger.warn({ sagaId, elapsedMs: elapsed, timeoutMs: timeout }, "Saga timeout");
            await this.executionEngine.failSaga(instance, "Saga timeout exceeded");
          }
        }
      },
      60000
    );
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
