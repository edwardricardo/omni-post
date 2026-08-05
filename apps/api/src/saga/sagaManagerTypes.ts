/**
 * @file sagaManagerTypes.ts
 * @description Shared type definitions for the Saga Manager (config, lifecycle hooks,
 *              execution state), extracted to break circular deps between lifecycle and
 *              execution modules.
 * @layer infrastructure
 *
 * @module saga/sagaManagerTypes
 */

import type { Prisma, PrismaClient } from "@infra/prisma";
import type { Redis } from "ioredis";
import type { SagaInstance } from "@shared/types/saga.js";
import type { EventStoreEvent } from "@shared/types/events.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { SemanticLockPort } from "@ports/core";
import type { SagaFailureReason } from "../metrics/sagaRecoveryMetrics.js";
import type { EventService } from "../events/EventService.js";

/**
 * The Prisma client the saga engine holds. Named at the seam so call sites read
 * as intent: the engine receives the tenant-guarded client by injection and
 * never reaches for a singleton.
 */
export type SagaEngineClient = PrismaClient;

/** The client Prisma hands an interactive transaction the engine opened. */
export type SagaTransactionClient = Prisma.TransactionClient;

export interface SagaManagerConfig {
  prisma: SagaEngineClient;
  redis: Redis;
  /** Required for full saga execution. Omit only when the manager will never
   *  be initialized (e.g. schemaOnly mode where routes register but no steps
   *  execute). All runtime paths that call appendEventInTx / broadcastEvent
   *  are guarded behind sagaManager.initialize(), which is skipped in
   *  schema-only mode. */
  eventService?: EventService;
  scheduler: BackgroundTaskScheduler;
  enableMetrics?: boolean;
  defaultTimeout?: number;
  maxConcurrentSagas?: number;
  /**
   * Optional semantic-lock backend (Azure §15-20). When provided, steps
   * that declare a `semanticLock` countermeasure are gated through
   * lockStore.acquire() and released on terminal-state transitions.
   * When omitted, semanticLock declarations are silently skipped — useful
   * for tests that opt out of the concurrency check.
   */
  lockStore?: SemanticLockPort;
}

export interface SagaMetrics {
  sagasStarted: number;
  sagasCompleted: number;
  sagasFailed: number;
  sagasCompensated: number;
  averageExecutionTime: number;
  activeInstances: number;
  /**
   * Boot recovery load failures. A non-zero value means the process started
   * without knowing which sagas were in flight — the loop must never report a
   * failed scan as an empty successful one.
   */
  bootLoadFailures: number;
  /** Retry recovery scan ticks that failed to read their due set. */
  recoveryScanFailures: number;
  /**
   * Per-saga tenant rehydration misses. Each one is a saga whose owning account
   * could not be resolved, so its work was skipped rather than run unscoped.
   */
  rehydrationFailures: number;
  /**
   * Sagas whose persisted account contradicts their context. Each one is a row
   * written before the tenant column carried the truth; it is skipped, counted
   * and terminalized rather than executed under a guessed tenant.
   */
  tenantMismatches: number;
  /**
   * Timeout-checker iterations that threw. Counted per saga so one poisoned row
   * is visible as a failure instead of silently ending the pass.
   */
  timeoutCheckFailures: number;
  /**
   * By-id instance reads that failed on infrastructure. Distinct from a row that
   * does not exist: both used to read as "not found" to every caller.
   */
  instanceLoadFailures: number;
}

/**
 * Interface for the execution engine used by SagaManagerLifecycle.
 * Defined here (in sagaManagerTypes.ts) so that SagaManagerLifecycle.ts
 * does NOT need to import SagaManagerExecution.ts directly, breaking the
 * mutual import cycle between those two files.
 */
export interface SagaExecutionEnginePort {
  executeSagaAsync(sagaId: string): void;
  compensateSagaAsync(sagaId: string): void;
  persistSagaInstance(instance: SagaInstance, events?: EventStoreEvent[]): Promise<void>;
  loadSagaInstance(sagaId: string): Promise<SagaInstance | null>;
  failSaga(instance: SagaInstance, error: string, reason?: SagaFailureReason): Promise<void>;
}
