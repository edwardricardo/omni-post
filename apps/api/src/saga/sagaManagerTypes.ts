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
  /**
   * Ceiling on how many inherited sagas the boot resume pass advances at once.
   * The pass is the heaviest fan-out the engine has — every dispatch opens its
   * own transactions and CQRS work on the client the HTTP layer shares — so an
   * unbounded burst after a long outage would exhaust the connection pool for
   * saga work AND for inbound requests. Sagas beyond the ceiling are not
   * dropped; they wait for a slot.
   */
  maxConcurrentSagas?: number;
  /**
   * Ceiling on how many non-terminal rows one boot load reads. Rows past it are
   * DEFERRED, counted and named in the log — never silently truncated — and are
   * picked up by the retry checker once they schedule a retry or by the next
   * boot. Without it a backlog of thousands of rows is materialized into memory
   * and re-warmed in one burst.
   */
  bootLoadLimit?: number;
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
  /**
   * Sagas boot recovery declined to resume — interrupted at or past their pivot,
   * or carrying a definition this process has not registered. Each one is a row
   * holding an operator window rather than a failure: automatic replay past the
   * pivot cannot be shown to be side-effect-free, so the engine reports instead
   * of guessing. The window is finite — see the timeout checker — so a parked
   * row still reaches a terminal state if nobody acts.
   */
  bootParkedSagas: number;
  /**
   * Non-terminal rows the boot load left unread because the process hit its
   * load ceiling. They are still owned — by the retry checker once they schedule
   * a retry, and by the next boot otherwise — but this process is not covering
   * them, which is what an operator needs to know after a long outage.
   */
  bootLoadDeferred: number;
  /**
   * Rows the resume pass could not decide about because inspecting them threw.
   * Counted per row, never per pass: one unreadable row must cost exactly one
   * saga's recovery, not the whole pass and not the process.
   */
  bootResumeRowFailures: number;
  /**
   * Sagas sitting in `COMPENSATING` at the last boot. NOBODY claims that status:
   * the boot load and the retry scan both filter `RUNNING`/`PENDING`, and the
   * timeout checker only inspects rows the process tracks. Detection only — the
   * engine deliberately does not resume them, because a compensation walk
   * resumed without a claim is a second walk over the same steps. Recovery for
   * them belongs to `saga-engine-terminal-hygiene`.
   */
  compensatingOrphans: number;
}

/**
 * Interface for the execution engine used by SagaManagerLifecycle.
 * Defined here (in sagaManagerTypes.ts) so that SagaManagerLifecycle.ts
 * does NOT need to import SagaManagerExecution.ts directly, breaking the
 * mutual import cycle between those two files.
 */
export interface SagaExecutionEnginePort {
  executeSagaAsync(sagaId: string): void;
  /**
   * The awaitable form of {@link SagaExecutionEnginePort.executeSagaAsync}. The
   * boot resume pass needs it: a fire-and-forget dispatch cannot be counted, so
   * it cannot be capped, and an uncapped pass is the fan-out the ceiling exists
   * to prevent. Callers MUST keep it outside every declared system boundary for
   * the same reason the detached form must — the context would propagate into
   * tenant work.
   */
  executeSaga(sagaId: string): Promise<void>;
  compensateSagaAsync(sagaId: string): void;
  persistSagaInstance(instance: SagaInstance, events?: EventStoreEvent[]): Promise<void>;
  loadSagaInstance(sagaId: string): Promise<SagaInstance | null>;
  failSaga(instance: SagaInstance, error: string, reason?: SagaFailureReason): Promise<void>;
}
