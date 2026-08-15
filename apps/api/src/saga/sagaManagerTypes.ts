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
   * How long a step that has NOT FINISHED waits before the engine asks it
   * again, in milliseconds. Defaults to 30 000.
   *
   * A POLL cadence, and deliberately not the definition's retry backoff: a
   * waiting step is not failing, so an interval that grows with a retry count
   * which never moves would be meaningless. Sizing is the reason it is its own
   * knob — at the retry policy's 5 s a waiting step is re-entered up to 360
   * times per saga over the 30-minute horizon, each one a saga load, a real
   * job-status read and a persist; at 30 s the worst case is 60. Worker
   * completion events remain the PRIMARY advance, so this only has to bound how
   * long a lost event can stall a saga.
   */
  waitPollMs?: number;
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
   * Sagas mid-ROLLBACK, as of the last measurement this process took.
   *
   * The boot load counts them and the Prometheus gauge re-measures the same
   * level at every scrape, which also refreshes this field — so a non-zero
   * value here is current, not a boot-time fossil. The engine RESUMES these
   * rows (boot disposition `compensation-resumed`) and an operator can re-drive
   * them, so a value that never drains is a rollback nothing can finish, not a
   * class nobody claims.
   */
  compensatingOrphans: number;
}

/**
 * Where a forward dispatch came from. Only an EVENT carries news, so only an
 * event may coalesce into a pass already running; the retry scan re-selects the
 * same due row every tick and would otherwise turn one slow pass into a chain
 * of them.
 */
export type SagaDispatchTrigger = "event" | "scan" | "boot" | "operator" | "start";

/**
 * Interface for the execution engine used by SagaManagerLifecycle.
 * Defined here (in sagaManagerTypes.ts) so that SagaManagerLifecycle.ts
 * does NOT need to import SagaManagerExecution.ts directly, breaking the
 * mutual import cycle between those two files.
 */
export interface SagaExecutionEnginePort {
  executeSagaAsync(sagaId: string, trigger?: SagaDispatchTrigger): void;
  /**
   * The awaitable form of {@link SagaExecutionEnginePort.executeSagaAsync}. The
   * boot resume pass needs it: a fire-and-forget dispatch cannot be counted, so
   * it cannot be capped, and an uncapped pass is the fan-out the ceiling exists
   * to prevent. Callers MUST keep it outside every declared system boundary for
   * the same reason the detached form must — the context would propagate into
   * tenant work.
   */
  executeSaga(sagaId: string, trigger?: SagaDispatchTrigger): Promise<void>;
  /**
   * Resumes the compensation WALK, detached.
   *
   * Named for the walk rather than for the saga because the lifecycle's
   * `compensateSaga` is a DIFFERENT operation — validate the status, take the
   * durable transition, hand off — and one name for two operations is how a
   * future dispatcher gets an early return where it expected a rollback.
   */
  resumeCompensationWalkAsync(sagaId: string): void;
  /**
   * The awaitable form of
   * {@link SagaExecutionEnginePort.resumeCompensationWalkAsync}, needed for the
   * same reason the awaitable forward dispatch is: the boot resume pass caps
   * what it advances at once, and a fire-and-forget walk cannot be counted.
   */
  resumeCompensationWalk(sagaId: string): Promise<void>;
  /**
   * Whether this process is already walking `sagaId` backwards. One walk per
   * saga: two of them interleave read-modify-write on one compensation record,
   * and canon idempotency is a promise about repeated invocation, not
   * concurrent invocation.
   */
  isCompensationWalkInFlight(sagaId: string): boolean;
  /**
   * Whether this process is advancing the saga at all, in either direction. The
   * operator re-drive asks THIS one: a forward holder would turn its walk away
   * just as a walk would, and answering success for a rollback that never
   * started is the failure mode the endpoint exists to avoid.
   */
  isAdvancerInFlight(sagaId: string): boolean;
  /**
   * Makes the decision to compensate durable — `COMPENSATING`, the triggering
   * error and a cleared retry marker, committed with the compensation-started
   * event — before anything acts on it. ONE transition shared by the automatic
   * path and the operator re-drive, so the two doors cannot drift apart.
   */
  beginCompensation(instance: SagaInstance, error?: string): Promise<void>;
  persistSagaInstance(instance: SagaInstance, events?: EventStoreEvent[]): Promise<void>;
  loadSagaInstance(sagaId: string): Promise<SagaInstance | null>;
  failSaga(instance: SagaInstance, error: string, reason?: SagaFailureReason): Promise<void>;
}
