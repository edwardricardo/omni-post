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
import {
  recordSagaBootLoadDeferred,
  recordSagaCompensatingOrphans,
  recordSagaParked,
  recordSagaRecoveryFailure,
  setSagaCompensatingOrphansProvider,
} from "../metrics/sagaRecoveryMetrics.js";
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

/** The three states the saga canon accepts as an ending. */
const TERMINAL_SAGA_STATES: ReadonlyArray<SagaInstance["status"]> = [
  "COMPLETED",
  "FAILED",
  "COMPENSATED",
];

/** Fallback saga horizon when neither the definition nor the config names one. */
const DEFAULT_SAGA_TIMEOUT_MS = 30 * 60 * 1000;

/** Fallback ceiling on rows one boot load reads when the config names none. */
const DEFAULT_BOOT_LOAD_LIMIT = 500;

/** Fallback ceiling on sagas the boot pass advances at once. */
const DEFAULT_BOOT_DISPATCH_CONCURRENCY = 100;

/** The operator-facing text a parked row carries once its window runs out. */
const PARKED_WINDOW_EXPIRED_ERROR =
  "Saga parked at its pivot was terminalized: its operator window expired";

/**
 * How many saga horizons a rollback may stay open before it is terminalized
 * regardless of how recently its walk wrote.
 *
 * Three, because the liveness horizon (ONE) already catches a walk that stopped
 * writing; this second bound exists only for the walk that keeps writing and
 * keeps failing. It has to leave room for a legitimately long undo — several
 * steps, each a provider round trip, re-attempted across a deploy — while still
 * being short enough that a crash loop cannot defer the canon's terminal
 * guarantee indefinitely. Three horizons is 90 minutes at the default.
 */
const COMPENSATION_ABSOLUTE_HORIZONS = 3;

/**
 * The operator-facing text a compensating row carries once its walk stops
 * writing. Deliberately says COMPENSATION rather than "timeout": the saga's
 * forward work already failed, and what ran out here is the undo — some of the
 * saga's effects may still be standing, which sends the operator to a different
 * runbook than a hung step does.
 */
const COMPENSATION_EXPIRED_ERROR =
  "Saga compensation was terminalized: its walk stopped making progress, so some effects " +
  "may still stand";

/**
 * What the boot recovery pass did with one loaded saga.
 *
 * The vocabulary carries more members than a bare "skipped": a saga the checker
 * owns, one that no scope can address, one whose column contradicts its context,
 * one this process has no definition for, and one cut past its pivot are five
 * different operator situations with five different repairs, and a single label
 * would send all of them to the same runbook.
 *
 * - `resumed` — dispatched by this pass.
 * - `compensation-resumed` — inherited mid-UNDO. Its own word, not a flavour of
 *   `resumed`: "this process is finishing an interrupted undo" and "this
 *   process is finishing an interrupted publish" are different operator
 *   situations with different runbooks, and its dispatch is the compensation
 *   walk, never forward execution.
 * - `nextRetryAt-owned-by-checker` — has a pending retry, so the retry checker
 *   owns it; dispatching here too would execute the same saga twice.
 * - `unresolvable-account` — carries no resolvable owning account, so every
 *   tenant-scoped statement would skip it; the timeout checker terminalizes it.
 *   Named exactly as the rehydration and the failure series name it, so the boot
 *   summary and the per-saga warnings can be correlated without a translation.
 * - `tenant-mismatch` — its persisted account contradicts its context; the
 *   repair is to stop the stale writer and re-run the backfill, not to retry.
 * - `parked` — interrupted at or past its pivot, so a replay would re-run steps
 *   whose external effects already happened; it holds an operator window.
 * - `definition-unregistered` — this process has no definition for the row, so
 *   its pivot boundary is unknowable here. Exceptional rather than routine: with
 *   the definitions registered before the manager initializes, the only ways to
 *   see one are a genuinely foreign row or a composition defect, and if EVERY
 *   loaded row lands here the pass reports the latter.
 * - `row-failed` — inspecting the row threw, so no decision could be taken about
 *   it. Counted per row; its neighbours are unaffected.
 */
type SagaBootDisposition =
  | "resumed"
  | "compensation-resumed"
  | "nextRetryAt-owned-by-checker"
  | "unresolvable-account"
  | "tenant-mismatch"
  | "parked"
  | "definition-unregistered"
  | "row-failed";

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
    bootLoadDeferred: 0,
    bootResumeRowFailures: 0,
    compensatingOrphans: 0,
  };
  readonly executionTimes: number[] = [];

  /**
   * When this process parked each row it declined to resume.
   *
   * Parking is a decision about a DURABLE row taken by ONE process, and it is
   * deliberately not persisted: the row is left byte-identical to how the
   * interruption left it, which is the whole promise. The consequence is that
   * the operator window it opens is per-process — a restart re-derives the
   * parking and re-opens the window — and that is what makes this map the
   * window's only origin. The timeout checker reads it to keep a parked row out
   * of the ordinary sweep until the window it actually granted has run out.
   */
  readonly parkedAt = new Map<string, number>();

  /**
   * When each compensation was BORN, remembered per saga.
   *
   * Read from the durable compensation-started event the first time a row is
   * bounded and kept because the value cannot change. It is the anchor a
   * restart loop cannot reset — unlike `updatedAt`, which every re-attempt
   * moves — so it is what makes "every saga reaches a terminal state" true for
   * a walk that keeps failing across restarts.
   */
  private readonly compensationStartedAt = new Map<string, number>();

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

    // The COMPENSATING level is measured AT SCRAPE TIME from here on. A level
    // published only at boot cannot see the rows that appear between boots —
    // which, now that the automatic path writes that status, is the population
    // the alert exists for — and latches a stale non-zero value for the life of
    // the process once it has published one.
    setSagaCompensatingOrphansProvider(() => this.countCompensatingRows());

    // ONE pass over what this process just loaded, never a sweep and never a
    // per-tick re-dispatch: a saga interrupted mid-step is only stuck because
    // the process that held it died, so it needs exactly one nudge from the
    // process that inherited it. The loop sits outside every declared system
    // boundary — the load ended with its own — because a dispatch is detached
    // and the context would propagate into work that must run tenant-scoped.
    //
    // Guarded for the same reason the load is: recovery is a best-effort part of
    // startup, and a process that cannot recover must still SERVE. Without this,
    // one unreadable row rejects initialize(), the bootstrap exits, and because
    // the row is durable it exits again on the next boot — a permanent outage
    // out of one tenant's bad data.
    try {
      this.resumeLoadedSagas(loaded, correlationId);
    } catch (error) {
      this.metrics.bootLoadFailures++;
      recordSagaRecoveryFailure("boot");
      captureError(error, { loop: "boot-resume", correlationId });
      logger.error(
        {
          err: error,
          loop: "boot-resume",
          errorType: error instanceof Error ? error.name : typeof error,
          correlationId,
        },
        "Saga boot recovery pass failed; the process is serving without recovery coverage"
      );
    }

    // The recovery ownership constraint, in the process's OWN output. It is a
    // real limit on how this service may be deployed, and a limit that exists
    // only in a document is one nobody reads at 3am while scaling out: no row is
    // marked as claimed, so a second replica loads and dispatches the same rows.
    logger.info(
      {
        recoveryOwnership: "per-process",
        multiReplicaSupported: false,
        tracking: "SMELL-73",
      },
      "Saga recovery owns rows PER PROCESS: there is no row claim, so running more than " +
        "one replica with the saga engine enabled is not supported until claims land"
    );

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

    const resumable: SagaInstance[] = [];
    const compensating: SagaInstance[] = [];

    for (const instance of loaded) {
      // Per row, not per pass. The row's persisted context is deserialized with
      // a cast, so a malformed one throws while it is being classified — and one
      // unreadable row must cost exactly one saga's recovery, never the recovery
      // of every row behind it in the list.
      try {
        const disposition = this.disposeLoadedSaga(instance, correlationId);
        record(disposition);
        if (disposition === "resumed") {
          resumable.push(instance);
        }
        if (disposition === "compensation-resumed") {
          compensating.push(instance);
        }
        if (disposition === "resumed" || disposition === "nextRetryAt-owned-by-checker") {
          this.rewarmLoadedSaga(instance, correlationId);
        }
      } catch (error) {
        record("row-failed");
        this.metrics.bootResumeRowFailures++;
        recordSagaRecoveryFailure("resume-row");
        captureError(error, { loop: "boot-resume", sagaId: instance.id, correlationId });
        logger.error(
          {
            err: error,
            loop: "boot-resume",
            sagaId: instance.id,
            definitionId: instance.definitionId,
            errorType: error instanceof Error ? error.name : typeof error,
            correlationId,
          },
          "Boot recovery could not classify a saga; the row is skipped and the pass continues"
        );
      }
    }

    const resumed = tally.get("resumed") ?? 0;
    const compensationResumed = tally.get("compensation-resumed") ?? 0;
    const checkerOwned = tally.get("nextRetryAt-owned-by-checker") ?? 0;
    const unregistered = tally.get("definition-unregistered") ?? 0;

    // Every single loaded row carrying a definition this process does not know
    // is not a data condition, it is a WIRING one: the pass ran before anything
    // registered a definition. Reported as a boot failure — which also degrades
    // the health check — because the alternative is a fleet-wide silent park
    // that reads, on every counter and in every log line, exactly like a fleet
    // of genuinely stuck sagas.
    if (unregistered > 0 && unregistered === loaded.length) {
      this.metrics.bootLoadFailures++;
      recordSagaRecoveryFailure("boot");
      logger.error(
        {
          loop: "boot-resume",
          loaded: loaded.length,
          definitionsRegistered: this.definitions.size,
          correlationId,
        },
        "Saga boot recovery parked EVERY inherited saga for want of a registered definition: " +
          "the saga definitions must be registered before the manager initializes"
      );
    }

    logger.info(
      {
        loaded: loaded.length,
        resumed,
        // Counted apart from `resumed` on purpose: these rows are being UNDONE.
        compensationResumed,
        checkerOwned,
        // Rows that are neither resumed nor owned by another mechanism.
        skipped: loaded.length - resumed - compensationResumed - checkerOwned,
        // Neither RESUMED disposition is a skip reason. Filing one here put a
        // resumed row in the same list as the rows nothing advanced, next to a
        // `skipped` count that had already subtracted it.
        skipReasons: Object.fromEntries(
          [...tally].filter(
            ([disposition]) => disposition !== "resumed" && disposition !== "compensation-resumed"
          )
        ),
        deferred: this.metrics.bootLoadDeferred,
        correlationId,
      },
      "Saga boot recovery pass complete"
    );

    this.dispatchResumableSagas(resumable, compensating, correlationId);
  }

  /**
   * Decides what this pass does with ONE loaded saga, and says so where the
   * operator is already looking. The decision is the method's whole output: the
   * dispatch itself is bounded and happens afterwards, so that no single row can
   * both take a decision and start work in the middle of the classification.
   *
   * @param instance - The loaded saga being classified.
   * @param correlationId - Identifier joining this recovery pass in the logs.
   * @returns The disposition the summary tallies.
   */
  private disposeLoadedSaga(instance: SagaInstance, correlationId: string): SagaBootDisposition {
    // STATUS FIRST, ahead of the retry marker. A row written by this engine
    // carries no `nextRetryAt` once it enters compensation — the transition
    // clears it — but a row written by an OLDER process, or by the operator
    // endpoint before this change, can still carry a stale one, and the
    // checker-owned branch would hand such a row to the retry scan, which
    // drives it FORWARD over state a partial undo already reverted. The
    // direction of travel outranks the retry marker.
    const compensating = instance.status === "COMPENSATING";

    if (!compensating && instance.nextRetryAt !== undefined) {
      return "nextRetryAt-owned-by-checker";
    }

    // The dispatch would rehydrate the tenant and skip an unscopable saga
    // anyway. Deciding here instead keeps the reason in the boot summary where
    // an operator is already looking, and leaves the counting to the timeout
    // checker that terminalizes the row, so one row is not reported as two
    // separate failures.
    const resolution = resolveSagaTenant(instance);
    if (resolution.kind === "tenant-mismatch") {
      // A DIFFERENT repair from the one below, so a different sentence: this
      // account IS resolvable, it is contradicted. Telling the operator it is
      // unresolvable sends them to look for missing data that is not missing.
      logger.warn(
        {
          sagaId: instance.id,
          definitionId: instance.definitionId,
          status: instance.status,
          reason: "tenant-mismatch",
          columnAccountId: resolution.columnAccountId,
          contextAccountId: resolution.contextAccountId,
          correlationId,
        },
        "Boot recovery left a saga alone: its persisted account contradicts its context — " +
          "stop the stale writer and re-run the backfill (docs/security/MULTI_TENANT_GUARDS.md)"
      );
      return "tenant-mismatch";
    }
    if (resolution.kind === "unresolvable-account") {
      logger.warn(
        {
          sagaId: instance.id,
          definitionId: instance.definitionId,
          status: instance.status,
          reason: "unresolvable-account",
          correlationId,
        },
        "Boot recovery left a saga alone: it carries no resolvable owning account — " +
          "the timeout checker terminalizes it (docs/security/MULTI_TENANT_GUARDS.md)"
      );
      return "unresolvable-account";
    }

    const definition = this.definitions.get(instance.definitionId);
    if (definition === undefined) {
      this.park(instance, "definition-unregistered");
      logger.warn(
        {
          sagaId: instance.id,
          definitionId: instance.definitionId,
          status: instance.status,
          currentStep: instance.currentStep,
          definitionsRegistered: this.definitions.size,
          reason: "definition-unregistered",
          correlationId,
        },
        "PARKED a saga this process has no definition for: its pivot boundary is unknowable " +
          "here, so it is left alone rather than dispatched into a lookup that fails"
      );
      return "definition-unregistered";
    }

    // Scoped and resolvable, and this process knows its definition: the walk
    // can be resumed — but only from a row that is PRE-PIVOT.
    //
    // "A compensating saga is pre-pivot by construction" is false, and it was
    // the justification for skipping this check. The operator door accepts a
    // FAILED saga at ANY step, including one cut after its point of no return,
    // so a post-pivot row can and does sit in COMPENSATING. Auto-resuming it
    // would roll back pre-pivot steps that a COMMITTED pivot depends on, on
    // every boot, unattended — and past the very human gate the pivot-parking
    // branch exists to impose. A human opened that rollback; a human decides
    // whether to continue it.
    if (compensating && instance.currentStep >= definition.pivotStepIndex) {
      this.park(instance, "pivot");
      logger.warn(
        {
          sagaId: instance.id,
          definitionId: instance.definitionId,
          status: instance.status,
          currentStep: instance.currentStep,
          pivotStepIndex: definition.pivotStepIndex,
          reason: "parked",
          correlationId,
        },
        "PARKED a COMPENSATING saga cut at or past its pivot: an unattended rollback of a " +
          "saga whose point of no return already fired needs a human, not a boot pass"
      );
      return "parked";
    }

    if (compensating) {
      logger.info(
        {
          sagaId: instance.id,
          definitionId: instance.definitionId,
          status: instance.status,
          currentStep: instance.currentStep,
          reason: "compensation-resumed",
          correlationId,
        },
        "Resuming an interrupted compensation walk: this row is being UNDONE, not advanced"
      );
      return "compensation-resumed";
    }

    // The pivot boundary, and the reason this pass is not a blanket resume.
    //
    // A saga interrupted at or past its pivot has already had its
    // point-of-no-return effects accepted by the outside world, so resuming it
    // re-runs them. The queue absorbs its own share of that — the publish job
    // carries a deterministic id, so a re-enqueue is a no-op while the job is
    // retained — but the step AFTER the pivot re-issues its status transition
    // with the version it read before the interruption, and the use case rejects
    // a stale version with a conflict. Measured end to end against a real queue
    // and a real database, the automatic replay therefore ended a saga that had
    // actually succeeded in the terminal FAILED state, with the reason "version
    // conflict". An operator reading that would be told the publish failed when
    // it did not.
    //
    // So the engine reports instead of guessing: the row is left exactly as the
    // interruption left it — non-terminal, nothing dispatched, nothing written —
    // counted, and logged for a human to resolve. Resuming it by hand stays
    // available through the continue endpoint, which is a decision someone takes
    // with the outcome in view rather than one this pass takes for them. The
    // window is finite: see `checkSagaTimeout`, which terminalizes the row as
    // `parked-expired` once the operator has had one full horizon to act.
    //
    // @see apps/api/tests/integration/sagaCrashRecovery.test.ts — "the parked
    //   saga, resumed deliberately by an operator" holds the measurement.
    // Revisit when THAT test's terminal assertion changes from FAILED to
    // COMPLETED: only that exact transition means the post-pivot step finally
    // tolerates re-application and the branch can be dropped.
    if (instance.currentStep >= definition.pivotStepIndex) {
      this.park(instance, "pivot");
      logger.warn(
        {
          sagaId: instance.id,
          definitionId: instance.definitionId,
          status: instance.status,
          currentStep: instance.currentStep,
          pivotStepIndex: definition.pivotStepIndex,
          reason: "parked",
          correlationId,
        },
        "PARKED a saga interrupted at or past its pivot: boot recovery will not replay it, manual review required"
      );
      return "parked";
    }

    return "resumed";
  }

  /**
   * Records that this process declined to resume a row, and when.
   *
   * @param instance - The saga being parked.
   * @param reason - Why recovery declined it.
   */
  private park(instance: SagaInstance, reason: "pivot" | "definition-unregistered"): void {
    this.parkedAt.set(instance.id, Date.now());
    this.metrics.bootParkedSagas++;
    recordSagaParked(reason);
  }

  /**
   * Re-warms one loaded saga into the Redis hot cache.
   *
   * Only rows this pass leaves in play are re-warmed, and only rows it does not
   * itself write.
   *
   * A PARKED row is DELIBERATELY not: the promise made about it is that the
   * interruption's state is what an operator will find, and a re-warm goes
   * through the ordinary persist, which rewrites the row and moves `updatedAt` —
   * so the one witness that separates "left alone" from "rewritten identically"
   * would be spent on a cache warm nobody asked for.
   *
   * A COMPENSATION-RESUMED row is not re-warmed for a sharper reason: the
   * compensation horizon is measured from `updatedAt`, so a re-warm would reset
   * the liveness anchor of a walk that has made no progress — and a
   * crash-looping process would then defer that row's terminal guarantee
   * indefinitely, one restart at a time. The walk this pass dispatches warms
   * the cache with its own writes when it actually advances, which is the only
   * time the anchor should move.
   *
   * @param instance - The saga to re-warm.
   * @param correlationId - Identifier joining this recovery pass in the logs.
   */
  private rewarmLoadedSaga(instance: SagaInstance, correlationId: string): void {
    // Fire-and-forget, but the outcome is consumed rather than discarded: a
    // re-warm that never ran is a saga this process cannot scope, which the
    // operator needs in the same correlated pass.
    const rewarm = runAsSagaTenant(
      instance,
      () => this.executionEngine.persistSagaInstance(instance),
      this.metrics
    );
    void rewarm
      .then((outcome) => {
        if (!outcome.ran) {
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

  /**
   * Advances the inherited sagas, at most `maxConcurrentSagas` at a time.
   *
   * Detached on purpose — `initialize()` must not wait for saga work — but NOT
   * unbounded: each dispatch opens its own transactions and CQRS work on the
   * client the HTTP layer shares, so a restart after a long outage would
   * otherwise fire the entire backlog at a pool sized in the low tens and take
   * the inbound request path down with it. The knob is the one already declared
   * in both composition roots; before this it was read nowhere, which is worse
   * than absent because an operator would reasonably believe it capped exactly
   * this.
   *
   * The runner sits outside every declared system boundary, for the same reason
   * the loop above it does: AsyncLocalStorage propagates into awaited work, and
   * a resumed step must run under the saga's OWN rehydrated tenant scope.
   *
   * A compensating row rides the SAME runner and the same ceiling, dispatched
   * into the WALK rather than into forward execution. Two lists, one bound:
   * an undo opens the same transactions a forward step does, so exempting it
   * from the ceiling would reintroduce exactly the burst the ceiling exists to
   * prevent — and only a counted dispatch can be followed by a re-measurement
   * of what is still compensating once the pass has drained.
   *
   * @param resumable - The sagas the pass decided to advance, in row order.
   * @param compensating - The sagas the pass decided to UNDO, in row order.
   * @param correlationId - Identifier joining this recovery pass in the logs.
   */
  private dispatchResumableSagas(
    resumable: SagaInstance[],
    compensating: SagaInstance[],
    correlationId: string
  ): void {
    const work: { sagaId: string; direction: "forward" | "compensation" }[] = [
      ...resumable.map((instance) => ({ sagaId: instance.id, direction: "forward" as const })),
      ...compensating.map((instance) => ({
        sagaId: instance.id,
        direction: "compensation" as const,
      })),
    ];
    if (work.length === 0) return;

    const limit = Math.max(1, this.config.maxConcurrentSagas ?? DEFAULT_BOOT_DISPATCH_CONCURRENCY);
    let cursor = 0;

    const advanceNext = async (): Promise<void> => {
      for (;;) {
        const item = work[cursor++];
        if (item === undefined) return;
        try {
          if (item.direction === "compensation") {
            if (this.executionEngine.isCompensationWalkInFlight(item.sagaId)) {
              logger.warn(
                { sagaId: item.sagaId, correlationId },
                "Skipped a compensation resume: a walk for this saga is already in flight"
              );
              continue;
            }
            await this.executionEngine.resumeCompensationWalk(item.sagaId);
          } else {
            await this.executionEngine.executeSaga(item.sagaId);
          }
        } catch (error) {
          if (item.direction === "compensation") {
            // A rollback that died on dispatch is exactly what the
            // compensation stage exists to count; logging it alone leaves the
            // operator's own signal blind to it.
            recordSagaRecoveryFailure("compensation");
          }
          captureError(error, {
            loop: "boot-resume-dispatch",
            sagaId: item.sagaId,
            correlationId,
          });
          logger.error(
            {
              err: error,
              loop: "boot-resume-dispatch",
              sagaId: item.sagaId,
              direction: item.direction,
              errorType: error instanceof Error ? error.name : typeof error,
              correlationId,
            },
            "Resumed saga failed during boot recovery"
          );
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(limit, work.length) }, advanceNext))
      .then(async () => {
        logger.info(
          {
            dispatched: work.length,
            compensationResumed: compensating.length,
            concurrency: limit,
            correlationId,
          },
          "Saga boot recovery dispatch drained"
        );
      })
      .catch((err: unknown) => {
        logger.error({ err, correlationId }, "Saga boot recovery dispatch ended unexpectedly");
      });
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

    // This endpoint IS the unpark: a human looked at the outcome and decided to
    // advance the row, so the operator window it was holding is over. Leaving
    // the entry would let the timeout checker terminalize an ACTIVELY RETRYING
    // saga as `parked-expired` — the wrong reason on a row nobody parked any
    // more.
    if (this.parkedAt.delete(sagaId)) {
      logger.info(
        { sagaId, definitionId: instance.definitionId },
        "Operator resumed a parked saga: its parked window is released"
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

    // COMPENSATING is accepted alongside FAILED: a row a crashed walk left
    // mid-undo is exactly the row an operator needs to re-drive, and answering
    // "not FAILED" to that request is how a human was sent to the database
    // with an UPDATE statement. Terminal sagas stay refused — the re-drive is
    // not a way around the canon re-execution guard.
    const previousStatus = instance.status;
    if (previousStatus !== "FAILED" && previousStatus !== "COMPENSATING") {
      throw AppError.badRequest(`Saga '${sagaId}' is not in a failed state: ${instance.status}`);
    }

    // A walk already in flight is not re-driven. The alert fires minutes before
    // the horizon, so the runbook actively invites a re-drive while the first
    // walk may still be running; obliging it would run two walks over one
    // in-memory instance and one `compensationResults` array.
    if (this.executionEngine.isCompensationWalkInFlight(sagaId)) {
      throw AppError.conflict(
        `Saga '${sagaId}' is already being compensated by a walk in flight; wait for it to ` +
          `finish or expire before re-driving`,
        { sagaId }
      );
    }

    // Reached from the admin route, which authenticates an operator and binds
    // no tenant scope, so the write rehydrates the saga's own account. The
    // transition itself is the SAME one the automatic path takes — one shape,
    // two doors — and the dispatch below stays outside every declared context.
    const outcome = await runAsSagaTenant(
      instance,
      () => this.executionEngine.beginCompensation(instance),
      this.metrics
    );

    if (!outcome.ran) {
      // The operator asked for compensation and it did not start. Answering
      // with a success envelope here is what made an unscopable saga look
      // compensated to whoever pressed the button.
      instance.status = previousStatus;
      throw AppError.conflict(
        `Saga '${sagaId}' cannot be compensated: its owning account is unresolvable (${outcome.reason})`,
        { sagaId, reason: outcome.reason }
      );
    }

    // The walk RESUMES from the durable per-step record: steps already
    // recorded as compensated are not re-dispatched, whether the previous walk
    // was automatic or operator-driven. "Restart" is not a second code path —
    // it falls out of this one as "no persisted successes yet".
    this.executionEngine.resumeCompensationWalkAsync(sagaId);

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

    // The drain HANDS OFF, it does not park. The two are opposite operational
    // states and must not share a word: a drained row is benign and self-
    // recovering — the retry checker claims it on the next process — while a
    // PARKED row is stuck at its pivot and needs a human. An on-call grepping
    // one term has to get one answer.
    for (const instance of this.activeInstances.values()) {
      if (instance.status !== "RUNNING") continue;

      // One saga that cannot be handed off must not stop the others from being
      // handed off, and must not stop the process from shutting down: a drain
      // that throws here used to abort the whole teardown.
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
            "Saga not handed off on shutdown: its owning account is unresolvable"
          );
        }
      } catch (error) {
        captureError(error, { sagaId: instance.id, operation: "sagaShutdownHandoff" });
        logger.error(
          {
            err: error,
            sagaId: instance.id,
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "Failed to hand off a running saga during shutdown"
        );
      }
    }

    setSagaCompensatingOrphansProvider(undefined);

    this.activeInstances.clear();
    this.parkedAt.clear();
    this.compensationStartedAt.clear();
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
   * of truth.
   *
   * The read is BOUNDED and ordered oldest-first. An unbounded read after a long
   * outage materializes the entire backlog into memory in one go, and the pass
   * that follows would then act on all of it at once; oldest-first means the
   * rows closest to their horizon are the ones this process covers. Rows past
   * the ceiling are not lost — they are counted, named in the log, and left to
   * the retry checker (once they schedule a retry) or to the next boot.
   *
   * The scan itself spans every tenant and runs before any of them is known,
   * so it declares the saga system boundary — narrowed to the read. Re-warming
   * happens LATER, in the resume pass, under each saga's own rehydrated scope
   * and only for the rows the pass leaves in play.
   *
   * `COMPENSATING` is IN the predicate. A row mid-undo is inherited exactly
   * like a row mid-publish — the pass then dispatches it into the compensation
   * walk rather than forward — because a status nothing loads is a status
   * nothing can finish, and the saga canon forbids an unbounded non-terminal
   * state. The same read still counts the COMPENSATING level for the orphan
   * gauge, which the resume pass re-measures once it has drained.
   *
   * @param correlationId - Identifier joining this recovery pass in the logs.
   * @returns The instances this load registered, in row order, so the resume
   *   pass dispatches exactly what this process inherited rather than whatever
   *   the in-memory set happens to hold.
   */
  private async loadActiveSagas(correlationId: string): Promise<SagaInstance[]> {
    const limit = Math.max(1, this.config.bootLoadLimit ?? DEFAULT_BOOT_LOAD_LIMIT);
    const where = { status: { in: ["RUNNING", "PENDING", "COMPENSATING"] } };

    // All three statements share the ONE declared boundary and its transaction,
    // so the counts and the page describe the same snapshot — a deferred figure
    // computed against a different one would be noise at exactly the moment an
    // operator needs it to be exact.
    const { total, compensating, rows } = await withSagaSystemRead(
      this.config.prisma,
      async (tx) => ({
        total: await tx.sagaInstance.count({ where }),
        compensating: await tx.sagaInstance.count({ where: { status: "COMPENSATING" } }),
        rows: await tx.sagaInstance.findMany({
          where,
          orderBy: { startedAt: "asc" },
          take: limit,
        }),
      })
    );

    const loaded: SagaInstance[] = [];
    for (const row of rows) {
      const instance = deserializeSagaInstanceRow(row);
      loaded.push(instance);
      this.activeInstances.set(instance.id, instance);
      this.metrics.activeInstances++;
    }

    const deferred = Math.max(0, total - loaded.length);
    this.metrics.bootLoadDeferred = deferred;
    recordSagaBootLoadDeferred(deferred);
    if (deferred > 0) {
      logger.warn(
        { total, loaded: loaded.length, deferred, limit, correlationId },
        "Saga boot load hit its ceiling: the rows beyond it are NOT covered by this process — " +
          "they wait for the retry checker or for the next boot"
      );
    }

    this.metrics.compensatingOrphans = compensating;
    recordSagaCompensatingOrphans(compensating);
    if (compensating > 0) {
      logger.warn(
        { compensating, correlationId },
        "Sagas were inherited mid-COMPENSATION: this process RESUMES their walks from the " +
          "durable per-step record rather than replaying them forward. The level is " +
          "re-measured once the resume pass drains; what remains after that is a walk this " +
          "process could not finish (docs/security/MULTI_TENANT_GUARDS.md)"
      );
    }

    logger.info(
      { count: loaded.length, total, deferred, compensating, correlationId },
      "Loaded active saga instances from PostgreSQL"
    );

    return loaded;
  }

  /**
   * Counts the rows currently mid-rollback, for the scrape-time gauge.
   *
   * It also refreshes the in-process snapshot `/sagas/metrics` serves, so the
   * operator-facing number and the Prometheus series cannot drift into two
   * different vintages.
   *
   * @returns Rows whose persisted status is `COMPENSATING`.
   */
  private async countCompensatingRows(): Promise<number> {
    try {
      const compensating = await withSagaSystemRead(this.config.prisma, (tx) =>
        tx.sagaInstance.count({ where: { status: "COMPENSATING" } })
      );
      this.metrics.compensatingOrphans = compensating;
      return compensating;
    } catch (error) {
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { err: error, loop: "compensating-level" },
        "Failed to measure the COMPENSATING level for the orphan gauge"
      );
      throw error;
    }
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
                // HANDS OFF a retry-pending saga by flipping it to PENDING while
                // the persist keeps `nextRetryAt`, so a predicate restricted to
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
   * Fails one saga that has outlived the horizon that applies to it.
   *
   * THREE horizons, because three situations. An ORDINARY row is measured from
   * `startedAt`: it has been advancing (or hanging) since then. A PARKED row is
   * measured from the moment this process parked it, because that is when the
   * operator was told — measuring it from `startedAt` would terminalize a row
   * that was inherited already older than the horizon on the FIRST tick after
   * boot, which is a window of at most sixty seconds and reads to the operator
   * as "a step hung" rather than "you had time and it ran out". A COMPENSATING
   * row is measured from its own LIVENESS, for the reason spelled out at that
   * branch, and is checked FIRST so neither of the other two can claim it.
   *
   * A saga the engine cannot scope to a tenant is TERMINALIZED through the
   * system path instead: no tenant-scoped statement can address it, so without
   * that it would stay non-terminal forever while every tick logged and counted
   * it again — the infinite RUNNING state the saga canon forbids.
   */
  private async checkSagaTimeout(sagaId: string, instance: SagaInstance): Promise<void> {
    // A saga that already ended is never re-failed. It should not be here at
    // all — every terminal transition stops tracking — but a tracked terminal
    // row would otherwise be re-failed on every tick past its horizon, appending
    // a fresh audit event each time and re-persisting a row nothing changed.
    if (TERMINAL_SAGA_STATES.includes(instance.status)) {
      this.stopTracking(sagaId);
      return;
    }

    const definition = this.definitions.get(instance.definitionId);

    // A COMPENSATING row is bounded whether or not THIS process knows its
    // definition. "A definition this process has not registered" is one of the
    // causes the alert and the runbook name for a stuck rollback, and the
    // definition-gated early return below made the promised backstop false for
    // exactly that class: the boot pass parks such a row, nothing else claims
    // it, and it would sit non-terminal forever. The horizon needs a duration,
    // not a definition — the configured default is one.
    const compensationTimeout =
      definition?.timeout || this.config.defaultTimeout || DEFAULT_SAGA_TIMEOUT_MS;
    if (instance.status === "COMPENSATING") {
      await this.checkCompensationLiveness(sagaId, instance, compensationTimeout);
      return;
    }

    if (!definition) return;

    const timeout = definition.timeout || this.config.defaultTimeout || DEFAULT_SAGA_TIMEOUT_MS;

    const parkedSince = this.parkedAt.get(sagaId);
    if (parkedSince !== undefined) {
      const parkedFor = Date.now() - parkedSince;
      if (parkedFor <= timeout) return;

      logger.warn(
        { sagaId, parkedForMs: parkedFor, windowMs: timeout },
        "Parked saga expired its operator window"
      );

      const parkedOutcome = await runAsSagaTenant(
        instance,
        () =>
          this.executionEngine.failSaga(instance, PARKED_WINDOW_EXPIRED_ERROR, "parked-expired"),
        this.metrics
      );

      if (!parkedOutcome.ran) {
        await this.terminalizeUnscopableSaga(sagaId, instance, parkedOutcome.reason);
      }
      // Both branches above stop tracking the saga, which releases the window;
      // deleted here as well so the map cannot outlive the row on a path that
      // ever stops doing so.
      this.parkedAt.delete(sagaId);
      return;
    }

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
   * Bounds a COMPENSATING row by the LIVENESS of its walk.
   *
   * The ordinary `startedAt` horizon is the wrong instrument here. A row
   * inherited after an outage longer than the saga horizon would be
   * terminalized on the FIRST tick after boot — under the reason `timeout`,
   * with ZERO re-drive window (a terminal row is refused at the re-drive
   * endpoint), and racing the walk this same process just resumed. So the
   * anchor is `updatedAt`, which a live walk keeps moving: the transition
   * writes it, and so does every step. A live walk therefore never expires; a
   * stalled one does.
   *
   * Suspicion forms on the CARRIED copy, which may be arbitrarily old — the
   * conservative direction, since old means "look closer". `undefined` is
   * suspicious for the same reason: an in-process instance built by `startSaga`
   * carries no `updatedAt` at all, and reading that absence as "fresh" would
   * hide a stalled walk. Nothing is terminalized on the strength of a stale or
   * missing value: the decision is re-taken against a FRESH row, the same
   * distrust-the-stale-copy pattern the unscopable path uses. When even the
   * fresh row carries no `updatedAt`, `startedAt` is the fallback anchor — a
   * real one, so the canon's "every saga terminates" still holds without ever
   * resting on an absent value.
   *
   * LIVENESS ALONE IS NOT ENOUGH, and this is the second anchor. A walk whose
   * `compensate()` fails records that failure and persists it, which moves
   * `updatedAt`; a process that restarts more often than the horizon therefore
   * re-attempts, rewrites, and resets the anchor forever — the very hazard the
   * re-warm exclusion closes, reopened by the walk's own honesty. So the
   * compensation also has an ABSOLUTE deadline measured from its BIRTH: the
   * durable `SAGA_COMPENSATION_STARTED` event written in the same transaction
   * as the transition. Nothing a later process does can move it.
   * `COMPENSATION_ABSOLUTE_HORIZONS` × the saga horizon is the bound; when the
   * event cannot be found (a row that predates it), the row's `startedAt` is
   * the fallback birth, which is always older and therefore never lenient.
   *
   * @param sagaId - The saga being checked.
   * @param instance - The tracked (possibly stale) copy.
   * @param timeout - The horizon that applies to this saga.
   */
  private async checkCompensationLiveness(
    sagaId: string,
    instance: SagaInstance,
    timeout: number
  ): Promise<void> {
    const carried = instance.updatedAt;
    const livenessSuspicious = carried === undefined || Date.now() - carried.getTime() > timeout;
    // The absolute deadline is checked on EVERY tick, not only a suspicious
    // one: its whole purpose is to bound a row whose liveness anchor keeps
    // being reset, which by definition never looks suspicious.
    const bornAt = await this.compensationBornAt(sagaId, instance);
    const absoluteExpired =
      bornAt !== undefined && Date.now() - bornAt > timeout * COMPENSATION_ABSOLUTE_HORIZONS;
    if (!livenessSuspicious && !absoluteExpired) return;

    const row = await withSagaSystemRead(this.config.prisma, (tx) =>
      tx.sagaInstance.findUnique({ where: { id: sagaId } })
    );

    if (!row) {
      this.stopTracking(sagaId);
      logger.warn({ sagaId }, "Compensating saga vanished before its horizon; stopped tracking");
      return;
    }

    const fresh = deserializeSagaInstanceRow(row);

    if (TERMINAL_SAGA_STATES.includes(fresh.status)) {
      this.stopTracking(sagaId);
      return;
    }

    if (fresh.status !== "COMPENSATING") {
      // Another process moved it on. Refresh the copy rather than acting on a
      // classification the database has already contradicted.
      this.activeInstances.set(sagaId, fresh);
      return;
    }

    const anchor = fresh.updatedAt ?? fresh.startedAt;
    const stalledFor = Date.now() - anchor.getTime();
    if (stalledFor <= timeout && !absoluteExpired) {
      // The walk IS alive — it wrote inside the horizon. Take the fresh copy so
      // the next tick judges the same row the database holds.
      this.activeInstances.set(sagaId, fresh);
      return;
    }

    logger.warn(
      {
        sagaId,
        stalledForMs: stalledFor,
        windowMs: timeout,
        anchor: anchor.toISOString(),
        expiredBy: absoluteExpired ? "absolute-deadline" : "liveness",
        ...(bornAt !== undefined && { compensationAgeMs: Date.now() - bornAt }),
      },
      absoluteExpired
        ? "Compensating saga expired its ABSOLUTE deadline: its rollback has been open for " +
            "several full horizons, however recently the walk last wrote"
        : "Compensating saga expired its liveness horizon: no step of its walk has written " +
            "inside a full horizon, so nothing is advancing it"
    );

    // Scope is bound from the FRESH row, which is also the row being written.
    // Binding it from the copy this method exists to distrust makes the two
    // isolation layers name two different tenants on one write whenever a
    // backfill repaired the column underneath a live process — the guard then
    // refuses the write, the checker swallows the throw, and the row never
    // terminalizes at all.
    const outcome = await runAsSagaTenant(
      fresh,
      () =>
        this.executionEngine.failSaga(fresh, COMPENSATION_EXPIRED_ERROR, "compensation-expired"),
      this.metrics
    );

    if (!outcome.ran) {
      await this.terminalizeUnscopableSaga(sagaId, fresh, outcome.reason);
      return;
    }

    // `failSaga` stops tracking, so a later tick has nothing to revisit: the
    // row is terminalized EXACTLY once however many ticks run.
    this.stopTracking(sagaId);
  }

  /**
   * When this saga's rollback was BORN, as milliseconds since the epoch.
   *
   * Read once per saga and remembered: the compensation-started event is
   * written exactly once and never moves, so re-reading it every minute would
   * be a query per COMPENSATING row per tick for a value that cannot change.
   * A row with no such event predates the durable transition; its own
   * `startedAt` is then the birth, which is always earlier and therefore never
   * grants a longer deadline than the truth.
   *
   * @param sagaId - The saga being bounded.
   * @param instance - The tracked copy, for the fallback anchor.
   * @returns The birth timestamp, or `undefined` when it cannot be established.
   */
  private async compensationBornAt(
    sagaId: string,
    instance: SagaInstance
  ): Promise<number | undefined> {
    const remembered = this.compensationStartedAt.get(sagaId);
    if (remembered !== undefined) return remembered;

    try {
      const event = await withSagaSystemRead(this.config.prisma, (tx) =>
        tx.storedEvent.findFirst({
          where: {
            streamId: `stream:Saga:${sagaId}`,
            eventType: SAGA_EVENTS.SAGA_COMPENSATION_STARTED,
          },
          orderBy: { timestamp: "asc" },
          select: { timestamp: true },
        })
      );
      const bornAt = event?.timestamp?.getTime() ?? instance.startedAt.getTime();
      this.compensationStartedAt.set(sagaId, bornAt);
      return bornAt;
    } catch (error) {
      // Unknown, never "young": the liveness anchor still governs this tick.
      logger.warn(
        { err: error, sagaId },
        "Could not read when this compensation started; the absolute deadline is not applied " +
          "on this tick"
      );
      return undefined;
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
    this.parkedAt.delete(sagaId);
    this.metrics.sagasFailed++;
  }

  /**
   * @method stopTracking
   * @description Drops a saga from the in-memory set and keeps the gauge
   *   consistent. Every terminal transition goes through here — completion,
   *   compensation and failure alike — so the tracked set and the counter cannot
   *   drift apart, and the timeout checker cannot find a saga that already
   *   ended.
   *
   *   The parked window is released with it, because the window belongs to a row
   *   nobody is advancing. A saga an operator resumed BY HAND leaves this method
   *   through the ordinary terminal path, and a stale entry would then outlive
   *   the row it described: the next non-terminal saga to advance past it would
   *   be terminalized as `parked-expired` — a wrong reason, on a row that was
   *   actively retrying.
   * @param sagaId - The saga to stop tracking.
   */
  stopTracking(sagaId: string): void {
    this.parkedAt.delete(sagaId);
    this.compensationStartedAt.delete(sagaId);
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
