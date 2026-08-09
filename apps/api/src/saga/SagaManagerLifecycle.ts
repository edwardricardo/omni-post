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
  resolveSagaTenant,
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
 * What the boot recovery pass did with one loaded saga.
 *
 * The vocabulary carries one member more than a bare "skipped": a saga the
 * checker owns, one that no scope can address, and one whose column contradicts
 * its context are three different operator situations with three different
 * repairs, and a single label would send all of them to the same runbook.
 *
 * - `resumed` — dispatched by this pass.
 * - `nextRetryAt-owned-by-checker` — has a pending retry, so the retry checker
 *   owns it; dispatching here too would execute the same saga twice.
 * - `missing-accountId` — carries no resolvable owning account, so every
 *   tenant-scoped statement would skip it; the timeout checker terminalizes it.
 * - `tenant-mismatch` — its persisted account contradicts its context; the
 *   repair is to stop the stale writer and re-run the backfill, not to retry.
 * - `parked` — interrupted at or past its pivot, so a replay would re-run steps
 *   whose external effects already happened; it waits for a human.
 */
type SagaBootDisposition =
  "resumed" | "nextRetryAt-owned-by-checker" | "missing-accountId" | "tenant-mismatch" | "parked";

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
    bootParkedSagas: 0,
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
    let loaded: SagaInstance[] = [];
    try {
      loaded = await this.loadActiveSagas(correlationId);
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

    // ONE pass over what this process just loaded, never a sweep and never a
    // per-tick re-dispatch: a saga interrupted mid-step is only stuck because
    // the process that held it died, so it needs exactly one nudge from the
    // process that inherited it. The loop sits outside every declared system
    // boundary — the load ended with its own — because a dispatch is detached
    // and the context would propagate into work that must run tenant-scoped.
    this.resumeLoadedSagas(loaded, correlationId);

    logger.info("Saga Manager initialized successfully");
  }

  /**
   * Dispatches the sagas this process inherited, and reports what it decided
   * about every one it did not.
   *
   * Ownership is partitioned on `nextRetryAt` nullability alone: this pass takes
   * the rows with none, the retry checker takes the rows with one that is due.
   * The two predicates cannot both match a row, so a saga is claimed once even
   * though both mechanisms are alive from the same `initialize()`.
   *
   * Within its own share the pass is deliberately narrower than "everything it
   * loaded": a saga interrupted at or past its pivot is PARKED rather than
   * replayed, for the reason spelled out at that branch.
   *
   * The summary is the difference between "this process recovered nothing" and
   * "this process never ran a recovery" — the same distinction the boot-load
   * failure counter draws, but for the pass rather than the read.
   *
   * @param loaded - The non-terminal sagas the boot load returned.
   * @param correlationId - Identifier joining this recovery pass in the logs.
   */
  private resumeLoadedSagas(loaded: SagaInstance[], correlationId: string): void {
    const tally = new Map<SagaBootDisposition, number>();
    const record = (disposition: SagaBootDisposition): void => {
      tally.set(disposition, (tally.get(disposition) ?? 0) + 1);
    };

    for (const instance of loaded) {
      if (instance.nextRetryAt !== undefined) {
        record("nextRetryAt-owned-by-checker");
        continue;
      }

      // The dispatch would rehydrate the tenant and skip an unscopable saga
      // anyway. Deciding here instead keeps the reason in the boot summary
      // where an operator is already looking, and leaves the counting to the
      // timeout checker that terminalizes the row, so one row is not reported
      // as two separate failures.
      const resolution = resolveSagaTenant(instance);
      if (resolution.kind !== "resolved") {
        const disposition: SagaBootDisposition =
          resolution.kind === "tenant-mismatch" ? "tenant-mismatch" : "missing-accountId";
        record(disposition);
        logger.warn(
          {
            sagaId: instance.id,
            definitionId: instance.definitionId,
            status: instance.status,
            reason: disposition,
            correlationId,
          },
          "Boot recovery left a saga alone: its owning account is unresolvable"
        );
        continue;
      }

      // The pivot boundary, and the reason this pass is not a blanket resume.
      //
      // A saga interrupted at or past its pivot has already had its
      // point-of-no-return effects accepted by the outside world, so resuming it
      // re-runs them. The queue absorbs its own share of that — the publish job
      // carries a deterministic id, so a re-enqueue is a no-op while the job is
      // retained — but the step AFTER the pivot re-issues its status transition
      // with the version it read before the interruption, and the use case
      // rejects a stale version with a conflict. Measured end to end against a
      // real queue and a real database, the automatic replay therefore ended a
      // saga that had actually succeeded in the terminal FAILED state, with the
      // reason "version conflict". An operator reading that would be told the
      // publish failed when it did not.
      //
      // So the engine reports instead of guessing: the row is left exactly as
      // the interruption left it — non-terminal, nothing dispatched, nothing
      // written — counted, and logged for a human to resolve. Resuming it by
      // hand stays available through the continue endpoint, which is a decision
      // someone takes with the outcome in view rather than one this pass takes
      // for them.
      const definition = this.definitions.get(instance.definitionId);
      const pivotStepIndex = definition?.pivotStepIndex;
      if (pivotStepIndex === undefined || instance.currentStep >= pivotStepIndex) {
        record("parked");
        this.metrics.bootParkedSagas++;
        recordSagaRecoveryFailure("parked");
        logger.warn(
          {
            sagaId: instance.id,
            definitionId: instance.definitionId,
            status: instance.status,
            currentStep: instance.currentStep,
            // Null when this process has no definition registered for the row:
            // its pivot boundary is unknowable here, so it is parked for the
            // same reason rather than dispatched into a lookup that fails.
            pivotStepIndex: pivotStepIndex ?? null,
            reason: "parked",
            correlationId,
          },
          "PARKED a saga interrupted at or past its pivot: boot recovery will not replay it, manual review required"
        );
        continue;
      }

      this.executionEngine.executeSagaAsync(instance.id);
      record("resumed");
    }

    const resumed = tally.get("resumed") ?? 0;
    const checkerOwned = tally.get("nextRetryAt-owned-by-checker") ?? 0;

    logger.info(
      {
        loaded: loaded.length,
        resumed,
        checkerOwned,
        // Rows that are neither resumed nor owned by another mechanism: these
        // are the ones nothing will pick up on its own.
        skipped: loaded.length - resumed - checkerOwned,
        skipReasons: Object.fromEntries(
          [...tally].filter(([disposition]) => disposition !== "resumed")
        ),
        correlationId,
      },
      "Saga boot recovery pass complete"
    );
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

    // The dispatch below is detached, and the engine SKIPS a saga it cannot
    // scope to a tenant. Resolving here — through the same rehydration the
    // engine would use, so the miss is logged and counted once — is the only
    // point at which the operator who pressed the button can be told. Answering
    // 200 made a saga that never resumed look resumed, exactly as the sibling
    // compensate endpoint used to.
    const outcome = await runAsSagaTenant(instance, async () => undefined, this.metrics);

    if (!outcome.ran) {
      throw AppError.conflict(
        `Saga '${sagaId}' cannot be continued: its owning account is unresolvable (${outcome.reason})`,
        { sagaId, reason: outcome.reason }
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
   * @returns The instances this load registered, in row order, so the resume
   *   pass dispatches exactly what this process inherited rather than whatever
   *   the in-memory set happens to hold.
   */
  private async loadActiveSagas(correlationId: string): Promise<SagaInstance[]> {
    const rows = await withSagaSystemRead(this.config.prisma, (tx) =>
      tx.sagaInstance.findMany({
        where: {
          status: { in: ["RUNNING", "PENDING"] },
        },
      })
    );

    let skipped = 0;
    const loaded: SagaInstance[] = [];
    for (const row of rows) {
      const instance = deserializeSagaInstanceRow(row);
      loaded.push(instance);
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

    return loaded;
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
          const dueRows = await withSagaSystemRead(this.config.prisma, (tx) =>
            tx.sagaInstance.findMany({
              where: {
                // PENDING belongs here as much as RUNNING: a graceful shutdown
                // parks a retry-pending saga by flipping it to PENDING while the
                // persist keeps `nextRetryAt`, so a predicate restricted to
                // RUNNING left that row to nobody — the boot pass owns rows with
                // NO pending retry, and this scan could not see it. It then sat
                // non-terminal until the timeout force-failed it half an hour
                // later. The partition is unchanged: this claims a due retry,
                // the boot pass claims the absence of one, and `@@index([status,
                // nextRetryAt])` still serves the shape.
                status: { in: ["RUNNING", "PENDING"] },
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
   *
   * The decision is re-taken against a FRESH row first. The in-memory copy was
   * loaded at boot and can be arbitrarily old, while the documented repair for
   * this row class is re-running the idempotent backfill — which happens
   * underneath a live process. Terminalizing on the stale copy would kill a saga
   * that had just been made resumable again.
   */
  private async terminalizeUnscopableSaga(
    sagaId: string,
    instance: SagaInstance,
    reason: SagaTenantSkipReason
  ): Promise<void> {
    const row = await withSagaSystemRead(this.config.prisma, (tx) =>
      tx.sagaInstance.findUnique({ where: { id: sagaId } })
    );

    if (!row) {
      // Nothing left to terminalize; an update by primary key would only throw.
      this.stopTracking(sagaId);
      logger.warn({ sagaId }, "Unscopable saga vanished before terminalization; stopped tracking");
      return;
    }

    const fresh = deserializeSagaInstanceRow(row);
    if (resolveSagaTenant(fresh).kind === "resolved") {
      this.activeInstances.set(sagaId, fresh);
      logger.info(
        { sagaId, definitionId: fresh.definitionId, previousReason: reason },
        "Unscopable saga became resolvable; refreshed instead of terminalized"
      );
      return;
    }

    // The FRESH row is what gets terminalized, not the copy the re-read exists
    // to distrust: the audit event carries duration and step tallies, and taking
    // those from a stale in-memory instance would record the transition against
    // state the database no longer holds.
    await failSagaAsSystem(this.config, fresh, reason);

    this.stopTracking(sagaId);
    this.metrics.sagasFailed++;
  }

  /** Drops a saga from the in-memory set and keeps the gauge consistent. */
  private stopTracking(sagaId: string): void {
    if (this.activeInstances.delete(sagaId)) {
      this.metrics.activeInstances--;
    }
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
