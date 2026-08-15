/**
 * @file SagaManagerExecution.ts
 * @description Saga execution and compensation engine handling step execution, persistence,
 *              retry logic, and completion/failure processing.
 * @layer infrastructure
 */

import type {
  CompensableStep,
  SagaDefinition,
  SagaInstance,
  SagaStepResult,
} from "@shared/types/saga.js";
import { SAGA_EVENTS } from "@shared/types/saga.js";
import { createEventStoreEvent, type EventStoreEvent } from "@shared/types/events.js";
import type { SagaManagerLifecycle } from "./SagaManagerLifecycle.js";
import type {
  SagaDispatchTrigger,
  SagaManagerConfig,
  SagaTransactionClient,
} from "./sagaManagerTypes.js";
import {
  resolveSagaTenant,
  runAsSagaTenant,
  runSagaTenantTransaction,
  withSagaSystemRead,
} from "./sagaTenant.js";
import {
  countStepOutcomes,
  deserializeSagaInstanceRow,
  normalizeLegacyStepResults,
  type SagaInstanceRow,
} from "./sagaInstanceRow.js";
import {
  recordSagaDuration,
  recordSagaFailed,
  recordSagaRecoveryFailure,
  type SagaFailureReason,
} from "../metrics/sagaRecoveryMetrics.js";
import { captureError } from "../observability/sentryInit.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";

/** The three states the saga canon accepts as an ending. */
const TERMINAL_SAGA_STATUSES: ReadonlyArray<SagaInstance["status"]> = [
  "COMPLETED",
  "FAILED",
  "COMPENSATED",
];

/**
 * How long a step that has NOT finished waits before the engine asks it again.
 *
 * A poll cadence, deliberately slower than the 5 s retry scan, and NOT the
 * definition's error backoff: the step is not failing, so an interval that
 * grows with a retry count that never moves would be meaningless. At the retry
 * policy's own 5 s a waiting step would be re-entered up to 360 times per saga
 * across the 30-minute horizon, each one a saga load, a real job-status read
 * and a persist. At 30 s the worst case is 60, and the poll is only the safety
 * net: worker completion events remain the primary advance.
 */
const DEFAULT_WAIT_POLL_MS = 30_000;

/** A step outcome the engine may compensate or count as progress. */
type SucceededStepResult = Extract<SagaStepResult, { outcome: "succeeded" }>;

/**
 * The right to advance ONE saga, and what the holder learned while it did.
 *
 * Discriminated on direction because the two cases genuinely differ: a forward
 * holder can coalesce a dispatch and can inherit a walk to hand off, while a
 * compensation holder does neither. A shared `rerun` flag on both would be a
 * field bolted onto a case with no use for it — the same modelling error the
 * step-outcome union deleted.
 */
type SagaAdvanceClaim =
  | {
      direction: "forward";
      /** An EVENT arrived mid-pass: run one more pass before releasing. */
      rerun: boolean;
      /** A compensation walk was refused mid-pass: dispatch it on release. */
      pendingWalk: boolean;
    }
  | { direction: "compensation" };

/**
 * Whether a recorded compensation counts as DONE for the resume predicate.
 *
 * A resumed walk decides whether to re-invoke a step's `compensate()` from this
 * answer, so a recorded success misread as "not done" is a second undo of an
 * effect already reverted.
 *
 * @param result - The recorded compensation outcome, if any.
 * @returns True only for a recorded SUCCESS. A hole, a recorded failure and a
 *   compensation that has not finished are all NOT DONE, and the walk treats
 *   them alike ON PURPOSE: each one leaves the row `COMPENSATING` for a resume,
 *   an operator re-drive or the liveness horizon, which is the honest answer to
 *   all three. What they must never share is the word "compensated" — that is
 *   the distinction the three-state contract buys here, and it is enforced by
 *   this predicate rather than by four separate branches that could drift.
 */
function compensationSucceeded(result: SagaStepResult | undefined): boolean {
  return result?.outcome === "succeeded";
}

/**
 * Merges a durable compensation record into an in-memory one, BY INDEX.
 *
 * Persisting the whole array wholesale is a lost update: a walk holding a copy
 * taken before another process recorded step N erases that success on its next
 * write, and the runbook drives irreversible human action off exactly that
 * record ("undo whatever it says is still missing"). Per index, a recorded
 * SUCCESS always wins — it describes an effect that is already reverted, which
 * no later observation can undo.
 *
 * @param durable - The record as the row currently holds it.
 * @param inMemory - This walk's record, mutated in place.
 */
function mergeCompensationResults(
  durable: SagaStepResult[] | undefined,
  inMemory: SagaStepResult[]
): void {
  if (!durable) return;
  for (let index = 0; index < durable.length; index++) {
    const durableResult = durable[index];
    if (durableResult === undefined || durableResult === null) continue;
    if (compensationSucceeded(durableResult) || inMemory[index] === undefined) {
      inMemory[index] = durableResult;
    }
  }
}

/**
 * Saga step execution, compensation, and persistence engine
 */
export class SagaExecutionEngine {
  /**
   * The sagas this process is advancing right now, and which way.
   *
   * ONE advancer per saga, in either direction. The boot pass, the retry scan,
   * a worker completion event, the operator endpoints and the start path are
   * five independent dispatch sources for one row, and concurrent executions
   * obtain the SAME in-memory instance from the tracked set: they interleave
   * read-modify-write on one `currentStep`, one `retryCount` and one
   * `compensationResults` array, so two walks can both observe "not recorded"
   * for the same step and invoke `compensate()` concurrently — and canon
   * idempotency is a promise about REPEATED invocation, not about CONCURRENT
   * invocation.
   *
   * A forward dispatch arriving while a forward execution holds the saga is
   * COALESCED rather than dropped: it raises `rerun`, and the holder runs one
   * more pass when its current one ends, which is what makes the wait step
   * answer the last channel's event promptly without a second execution.
   * Compensation never coalesces — an undo is not a repeat of a forward
   * advance — so a walk that finds the saga held is refused, logged and
   * counted, and the row keeps its `COMPENSATING` status for the boot resume,
   * the operator re-drive and the liveness horizon.
   *
   * Deliberately IN-PROCESS: it is the single-replica sibling of the row claims
   * that close the cross-process case, and it states nothing about concurrent
   * replicas. Not a cache (fitness #14 is about cross-pod cached STATE); this
   * is coordination state whose whole meaning is "this process, right now",
   * and a crashed process leaves nothing durable behind by construction.
   */
  private readonly inFlight = new Map<string, SagaAdvanceClaim>();

  constructor(
    private config: SagaManagerConfig,
    private lifecycle: SagaManagerLifecycle
  ) {}

  /**
   * @method isCompensationWalkInFlight
   * @description Whether this process is already walking `sagaId` backwards.
   *   Read by the boot pass, which skips a saga whose walk is already running
   *   rather than dispatching a second one.
   * @param sagaId - The saga being asked about.
   * @returns True while a WALK holds the saga.
   */
  isCompensationWalkInFlight(sagaId: string): boolean {
    return this.inFlight.get(sagaId)?.direction === "compensation";
  }

  /**
   * @method isAdvancerInFlight
   * @description Whether this process is advancing `sagaId` at all, in either
   *   direction. Read by the operator re-drive, which must not answer success
   *   for a walk the shared claim would turn away — a forward holder
   *   disqualifies a re-drive exactly as a walk does.
   * @param sagaId - The saga being asked about.
   * @returns True while any execution holds the saga.
   */
  isAdvancerInFlight(sagaId: string): boolean {
    return this.inFlight.has(sagaId);
  }

  /**
   * The saga's status as the DATABASE holds it, bypassing every cache.
   *
   * One indexed primary-key read of one column. It exists because two
   * decisions must never be taken on a best-effort copy: refusing forward
   * execution for a row the walk owns, and refusing to write over a row that
   * already reached a terminal state.
   *
   * @param sagaId - The saga being asked about.
   * @returns The persisted status, `null` when the row is gone, or `undefined`
   *   when it could not be read — which callers MUST treat as "unknown", never
   *   as "fine".
   */
  private async readPersistedStatus(sagaId: string): Promise<string | null | undefined> {
    try {
      const row = await withSagaSystemRead(this.config.prisma, (tx) =>
        tx.sagaInstance.findUnique({ where: { id: sagaId }, select: { status: true } })
      );
      return row === null ? null : row.status;
    } catch (error) {
      captureError(error, { sagaId, operation: "readPersistedStatus" });
      logger.error({ err: error, sagaId }, "Failed to read the persisted saga status");
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Async Entry Points
  // ---------------------------------------------------------------------------

  executeSagaAsync(sagaId: string, trigger: SagaDispatchTrigger = "scan"): void {
    setImmediate(async () => {
      try {
        await this.executeSaga(sagaId, trigger);
      } catch (error) {
        logger.error({ err: error, sagaId }, "Saga execution failed");
      }
    });
  }

  /**
   * @method resumeCompensationWalkAsync
   * @description The detached form of {@link resumeCompensationWalk}. Named for
   *   what it does — resume the WALK — because the operator-facing
   *   `compensateSaga` on the lifecycle is a different operation (validate the
   *   status, take the durable transition, hand off) and one name for two
   *   operations is how a future dispatcher gets an early return where it
   *   expected a completed rollback.
   * @param sagaId - The saga whose compensation walk is (re-)driven.
   */
  resumeCompensationWalkAsync(sagaId: string): void {
    setImmediate(async () => {
      try {
        await this.loadAndRunCompensationWalk(sagaId);
      } catch (error) {
        // Counted, not only logged: a detached walk that dies here is a
        // rollback nobody is waiting on and nothing else would notice.
        recordSagaRecoveryFailure("compensation");
        logger.error({ err: error, sagaId }, "Saga compensation failed");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Step Execution
  // ---------------------------------------------------------------------------

  /**
   * @method executeSaga
   * @description Advances one saga under its own rehydrated tenant scope, and
   *   resolves when it has either reached a terminal state or parked itself on a
   *   scheduled retry. Public because the boot resume pass counts what is in
   *   flight in order to cap it; every other trigger uses the detached form.
   *
   *   THE SINGLE FUNNEL. Every dispatcher arrives here, which is what makes the
   *   in-flight claim below a real guarantee rather than a convention: a saga
   *   already being advanced by this process is not advanced a second time
   *   concurrently. A dispatch that arrives mid-run is COALESCED into one
   *   trailing pass, so an event is never lost and N simultaneous events never
   *   become N executions.
   *
   *   Each pass re-reads the DURABLE status before it touches the saga, which
   *   is also what closes the trailing rerun's own hole: an event arriving
   *   during the final failing attempt would otherwise re-enter after the
   *   compensation transition persisted `COMPENSATING`, and forward execution
   *   would overwrite it with `RUNNING` and re-run the failed step over
   *   partially-undone state.
   * @param sagaId - The saga to advance.
   */
  async executeSaga(sagaId: string, trigger: SagaDispatchTrigger = "scan"): Promise<void> {
    const holder = this.inFlight.get(sagaId);
    if (holder) {
      if (holder.direction === "forward" && trigger === "event") {
        // Coalesced, not dropped: the holder runs one more pass, so the event
        // that arrived while it was inside the step is still answered. ONLY an
        // event does this — a scan re-selection would schedule a pass carrying
        // no new information, and the scan will re-select the row on its next
        // tick anyway if it is still due.
        holder.rerun = true;
        logger.debug(
          { sagaId, trigger },
          "A saga execution is already in flight in this process; the event is coalesced into " +
            "its trailing pass"
        );
        return;
      }
      // Benign by design, so it is logged at DEBUG and NOT counted: the failure
      // series exists for work the engine could not complete, and a dispatch
      // that arrives while the saga is already being advanced has lost nothing.
      logger.debug(
        { sagaId, trigger, heldBy: holder.direction },
        "A dispatch arrived for a saga this process is already advancing; it is dropped rather " +
          "than run alongside the holder"
      );
      return;
    }

    const claim: SagaAdvanceClaim = { direction: "forward", rerun: false, pendingWalk: false };
    this.inFlight.set(sagaId, claim);
    try {
      do {
        // Cleared BEFORE the pass, so an event arriving during it schedules the
        // NEXT pass instead of being absorbed by this one.
        claim.rerun = false;
        if (!(await this.advanceSagaOnce(sagaId))) return;
      } while (claim.rerun);
    } finally {
      // Every exit releases: normal, terminal, refused and throwing alike. An
      // entry that outlived its execution would block the saga for the life of
      // the process, which is worse than the concurrency it prevents.
      this.inFlight.delete(sagaId);

      // A walk this pass turned away is dispatched now that the saga is free.
      // Without the hand-off the rollback is simply LOST: the compensation
      // transition nulls `nextRetryAt` so the retry scan cannot see the row,
      // boot recovery only runs at startup, and the liveness horizon
      // terminalizes rather than rolls back — the pre-pivot effects would be
      // left standing under a reason that reads like an ordinary failure.
      if (claim.pendingWalk) {
        logger.info(
          { sagaId },
          "Dispatching the compensation walk this execution turned away while it held the saga"
        );
        this.resumeCompensationWalkAsync(sagaId);
      }
    }
  }

  /**
   * One forward pass over a saga, with the in-flight claim already held.
   *
   * @param sagaId - The saga to advance.
   * @returns False when nothing further should be attempted for this saga —
   *   a refusal, a terminal row or an unloadable one — so a pending trailing
   *   dispatch is not answered by re-entering a row that just refused.
   */
  private async advanceSagaOnce(sagaId: string): Promise<boolean> {
    const instance = await this.lifecycle.getSaga(sagaId);
    if (!instance) {
      logger.error({ sagaId }, "Saga not found during execution");
      return false;
    }

    // Guard: prevent re-execution of sagas already in a terminal state
    if (TERMINAL_SAGA_STATUSES.includes(instance.status)) {
      logger.warn(
        { sagaId, status: instance.status },
        "Attempted to execute saga in terminal state, ignoring"
      );
      return false;
    }

    // A row the WALK owns is never advanced forward. `runSagaSteps` sets
    // RUNNING unconditionally and re-executes the step whose failure triggered
    // the compensation — over state a partial walk may already have undone —
    // so the refusal has to sit ahead of it rather than inside it.
    //
    // It decides on the DURABLE row, never on the copy above it. `getSaga`
    // answers from the tracked set or from the Redis hot cache, which is
    // written fire-and-forget and which the engine is explicitly designed to
    // survive losing — so a pre-transition `RUNNING` copy would let exactly the
    // defect this guard exists to close through, and every statement of the
    // invariant says "persisted".
    //
    // Which dispatch paths this closes: `handleEvent` requires RUNNING and
    // `continueSaga` requires RUNNING/PENDING, the retry scan needs a due
    // `nextRetryAt` (nulled by the COMPENSATING transition), the boot pass
    // routes a COMPENSATING row into the walk, and `startSaga` writes a new
    // row. It is the backstop for all of them AND the primary guard for the
    // trailing rerun, which re-enters here and therefore re-reads the durable
    // status before it can touch the saga again.
    const persistedStatus = await this.readPersistedStatus(sagaId);
    if (persistedStatus === undefined) {
      // The durable status could not be established, so "this row is not being
      // compensated" cannot be established either. Refusing costs one deferred
      // advance, which the retry checker re-drives; advancing costs the
      // guarantee.
      recordSagaRecoveryFailure("instance-load");
      logger.error(
        { sagaId },
        "Refused to advance a saga whose persisted status could not be read: the compensation " +
          "guard decides on the durable row, and an unreadable one is not a safe RUNNING"
      );
      return false;
    }
    if (persistedStatus === "COMPENSATING") {
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { sagaId, status: persistedStatus, cachedStatus: instance.status },
        "Refused to advance a saga whose persisted status is COMPENSATING: the compensation " +
          "walk owns this row, and forward execution would re-run a failed step over " +
          "partially-undone state"
      );
      return false;
    }

    // EVERY ADVANCER IS ALSO A TERMINALIZER. The timeout checker walks the
    // tracked set, and nothing tracks a row this process merely loaded by id —
    // a row deferred past the boot ceiling, or one whose tracked copy was
    // dropped. While the retry budget bounded every step, that gap was
    // invisible: an untracked saga still died of exhausted retries. A waiting
    // step spends no budget, so the horizon is now the ONLY bound, and a bound
    // that only covers tracked rows is not the guarantee the canon requires.
    // Checking it here — on the one path every dispatcher funnels through —
    // makes the coverage structural instead of dependent on bookkeeping.
    if (await this.lifecycle.terminalizeIfPastHorizon(sagaId, instance)) {
      return false;
    }

    const definition = this.lifecycle.definitions.get(instance.definitionId);
    if (!definition) {
      logger.error({ definitionId: instance.definitionId }, "Saga definition not found");
      return false;
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
      return false;
    }
    return true;
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
        let stepResult: SagaStepResult;

        try {
          // Countermeasures (Azure §15-20) — activated in canonical order
          // before step.execute():
          //   1. SemanticLock — admission control, rejects concurrent saga.
          //   2. RereadCheck — guards against dirty reads.
          //   3. VersionCheck — enforced inside the use case layer via
          //      expectedVersion in the command.
          //
          // A countermeasure that blocks the step produces the step's outcome
          // itself, so the decision is one named value rather than the
          // truthiness of a half-assigned variable.
          const blocked = await this.runCountermeasures(step, instance, definition);
          stepResult = blocked ?? (await step.execute(instance.context));
        } catch (error) {
          stepResult = {
            outcome: "failed",
            error: error instanceof Error ? error.message : "Step execution failed",
          };
        }

        instance.stepResults[instance.currentStep] = stepResult;

        // A step that has NOT FINISHED is not an attempt, so it neither spends
        // budget nor writes an audit line. It re-arms the poll and returns: the
        // completion event is the primary advance and this is the safety net
        // for one that never arrives. The saga stays on the same step, keeps
        // its retry count, records no error, and remains bounded by the
        // ordinary timeout horizon — which is what stops "ask again later" from
        // meaning "ask forever".
        if (stepResult.outcome === "waiting") {
          // The re-arm is bookkeeping, and bookkeeping never terminalizes a
          // saga. A DB blip here used to fall into the step loop's catch, which
          // calls `failSaga` — so a degraded database would end sagas that were
          // merely waiting, and it now runs up to sixty times per saga instead
          // of three. The in-memory marker also stays honest: claiming a re-arm
          // that did not land would make the engine believe it rescheduled work
          // the row does not carry.
          const armedBefore = instance.nextRetryAt;
          instance.nextRetryAt = new Date(Date.now() + this.waitPollMs());
          try {
            await this.persistSagaInstance(instance);
          } catch (error) {
            if (armedBefore === undefined) {
              delete instance.nextRetryAt;
            } else {
              instance.nextRetryAt = armedBefore;
            }
            recordSagaRecoveryFailure("wait-poll");
            captureError(error, { sagaId, operation: "waitPollRearm" });
            logger.error(
              { err: error, sagaId, stepName: step.name },
              "The waiting step's poll could not be re-armed; the saga keeps the marker the row " +
                "already holds and is re-selected on the existing schedule"
            );
            return;
          }
          logger.debug(
            {
              sagaId,
              stepName: step.name,
              stepIndex: instance.currentStep,
              reason: stepResult.reason,
              nextPollAt: instance.nextRetryAt.toISOString(),
            },
            "Saga step has not finished yet; re-armed without spending retry budget"
          );
          return;
        }

        const stepEventType =
          stepResult.outcome === "succeeded"
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

        if (stepResult.outcome === "failed") {
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
          const errMsg = stepResult.error;

          if (step.class === "compensable") {
            // Write-ahead intent: the decision to compensate and the durable
            // record of it are not separated by a dispatch. A process that
            // dies from here on leaves a COMPENSATING row, never a RUNNING one
            // that the next boot would drive FORWARD.
            //
            // The transition ORDERS the undo; it never GATES it. A durable
            // write can fail — the pool it competes for is the one this very
            // situation is straining — and a rollback that is skipped because
            // its bookkeeping failed is strictly worse than one whose
            // bookkeeping is late: the walk's first per-step persist
            // re-establishes the status, while a saga terminalized here would
            // leave its pre-pivot effects standing under a reason
            // indistinguishable from an ordinary step failure.
            try {
              await this.beginCompensation(instance, errMsg);
            } catch (error) {
              recordSagaRecoveryFailure("compensation");
              logger.error(
                { err: error, sagaId, currentStep: instance.currentStep },
                "The compensation transition could not be persisted; dispatching the walk anyway " +
                  "— its first per-step persist re-establishes the durable status"
              );
            }
            this.resumeCompensationWalkAsync(instance.id);
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

        // Note: external-event suspension is expressed by the step's OUTCOME,
        // not by special-casing step.id here. A RetryableStep waiting on a
        // worker event returns `waiting` → the branch above re-arms the poll
        // without spending budget → the worker emits publish.job.completed →
        // SagaIntegration.handleEvent calls executeSagaAsync → the engine
        // re-runs the step, which now succeeds. This avoids hard-coding step
        // ids in the engine and keeps the canon flow uniform across step
        // classes.
      }

      await this.completeSaga(instance);
    } catch (error) {
      logger.error({ err: error, sagaId }, "Saga execution error");
      await this.failSaga(instance, error instanceof Error ? error.message : "Unknown error");
    }
  }

  /**
   * How long a step that has not finished waits before it is asked again.
   *
   * @returns The configured poll cadence, or the engine default.
   */
  private waitPollMs(): number {
    return this.config.waitPollMs ?? DEFAULT_WAIT_POLL_MS;
  }

  /**
   * Runs a step's countermeasures and reports whether one of them BLOCKS it.
   *
   * Returning the blocking outcome, rather than half-assigning the step's
   * result, is what keeps the caller's control flow on the discriminator: a
   * blocked step failed for a stated reason, and an unblocked one has no
   * outcome at all until it executes.
   *
   * @param step - The step about to run.
   * @param instance - The saga being advanced.
   * @param definition - Its definition, for the lock's default lifetime.
   * @returns The failure that blocks the step, or `undefined` to proceed.
   */
  private async runCountermeasures(
    step: SagaDefinition["steps"][number],
    instance: SagaInstance,
    definition: SagaDefinition
  ): Promise<SagaStepResult | undefined> {
    const cm = step.countermeasures;

    if (cm?.semanticLock && this.config.lockStore) {
      const key = cm.semanticLock.acquireKey(instance.context);
      if (key) {
        const ttl = cm.semanticLock.ttlMs ?? definition.timeout ?? 30 * 60 * 1000;
        const acquireResult = await this.config.lockStore.acquire(key, instance.id, ttl);
        if (!acquireResult.ok) {
          // CONNECTION_ERROR — fail this step rather than running unguarded.
          // Saga will retry per canon retry policy.
          return {
            outcome: "failed",
            error: "Semantic lock acquire failed (lock store unreachable)",
          };
        }
        if (!acquireResult.value) {
          // Held by another saga — concurrent execution rejected.
          return { outcome: "failed", error: `Semantic lock held by another saga: ${key}` };
        }
      }
    }

    if (cm?.rereadCheck) {
      const reread = await cm.rereadCheck.rereadBeforeUpdate(instance.context);
      if (!reread.stillValid) {
        return {
          outcome: "failed",
          error: `Reread check failed: ${reread.reason ?? "aggregate state changed"}`,
        };
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Compensation
  // ---------------------------------------------------------------------------

  /**
   * @method beginCompensation
   * @description Makes the decision to compensate DURABLE before anything acts
   *   on it: writes `COMPENSATING`, carries the triggering error onto the row,
   *   clears the retry marker, and commits the `SAGA_COMPENSATION_STARTED`
   *   event in the same transaction — awaited, never dispatched.
   *
   *   ONE transition, every entry point: the automatic path, the operator
   *   re-drive and the walk's own defensive check all come through here, so the
   *   two doors cannot drift into two shapes.
   *
   *   Clearing `nextRetryAt` is load-bearing rather than tidy. It is what
   *   removes the row from the retry scan's predicate and from the boot pass's
   *   checker-owned branch, so no reader can convert a compensation into a
   *   forward retry. Runs inside the saga's rehydrated tenant scope, which the
   *   caller has already bound.
   * @param instance - The saga entering compensation.
   * @param error - The failure that triggered it, when there is one.
   */
  async beginCompensation(instance: SagaInstance, error?: string): Promise<void> {
    instance.status = "COMPENSATING";
    if (error !== undefined) {
      instance.error = error;
    }
    delete instance.nextRetryAt;

    const compensationStartedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_COMPENSATION_STARTED,
      instance.id,
      "Saga",
      {
        sagaId: instance.id,
        definitionId: instance.definitionId,
        failedAt: instance.completedAt ?? new Date(),
        stepsToCompensate: instance.currentStep,
        ...(instance.error !== undefined && { error: instance.error }),
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    await this.persistSagaInstance(instance, [compensationStartedEvent]);
  }

  /**
   * @method resumeCompensationWalk
   * @description The awaitable form of
   *   {@link resumeCompensationWalkAsync}. The boot resume pass needs it for
   *   the same reason it needs the awaitable forward dispatch: a
   *   fire-and-forget walk cannot be counted, so it cannot be capped.
   * @param sagaId - The saga whose compensation walk is (re-)driven.
   */
  async resumeCompensationWalk(sagaId: string): Promise<void> {
    await this.loadAndRunCompensationWalk(sagaId);
  }

  /**
   * Loads, scopes and runs one compensation walk.
   *
   * Every exit is LOUD. The caller is a detached dispatch with nobody waiting
   * on it, so a silent return here produces a saga that simply never gets
   * undone — no log line, no metric and no row change to notice it by.
   */
  private async loadAndRunCompensationWalk(sagaId: string): Promise<void> {
    // ONE advancer per saga, claimed before anything is loaded so a second
    // dispatch cannot slip past while the first is still reading.
    const holder = this.inFlight.get(sagaId);
    if (holder) {
      if (holder.direction === "forward") {
        // HANDED OFF, not dropped. A forward pass releasing the saga dispatches
        // this walk, which is what keeps an automatic rollback automatic: the
        // walk is deferred by a macrotask, so a trailing pass doing real I/O
        // routinely wins the race to the claim, and there is no other in-process
        // re-driver — the transition already nulled the retry marker.
        holder.pendingWalk = true;
        logger.info(
          { sagaId },
          "A compensation walk arrived while a forward execution held the saga; it is handed to " +
            "that execution's release rather than run alongside it"
        );
        return;
      }
      // A second WALK is refused outright: two walks interleave
      // read-modify-write over one durable record, and canon idempotency is a
      // promise about repeated invocation, not concurrent invocation. Benign
      // and therefore uncounted — the row keeps its COMPENSATING status, so the
      // first walk, the boot resume, the operator re-drive and the liveness
      // horizon all still own it.
      logger.debug(
        { sagaId },
        "A compensation walk was refused: this process is already walking that saga"
      );
      return;
    }
    this.inFlight.set(sagaId, { direction: "compensation" });
    try {
      await this.claimedCompensationWalk(sagaId);
    } finally {
      this.inFlight.delete(sagaId);
    }
  }

  /** The walk proper, with the in-flight claim already held. */
  private async claimedCompensationWalk(sagaId: string): Promise<void> {
    // On the DURABLE status, for the same reason the forward guard is: the
    // horizon may have terminalized this row while a previous walk was inside a
    // long `compensate()`, and the defensive transition below would then
    // RESURRECT it — COMPENSATING again, then COMPENSATED, both after
    // `SAGA_FAILED`. A terminal row already says the rollback did not finish.
    const persistedStatus = await this.readPersistedStatus(sagaId);
    if (persistedStatus === undefined || persistedStatus === null) {
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { sagaId, persistedStatus },
        "Saga compensation could not start: its persisted status could not be established"
      );
      return;
    }
    if (TERMINAL_SAGA_STATUSES.includes(persistedStatus as SagaInstance["status"])) {
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { sagaId, status: persistedStatus },
        "Saga compensation refused: the row already reached a terminal state, and a walk never " +
          "writes over one"
      );
      return;
    }

    const instance = await this.lifecycle.getSaga(sagaId);
    if (!instance) {
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { sagaId },
        "Saga compensation could not start: the instance could not be loaded"
      );
      return;
    }

    const definition = this.lifecycle.definitions.get(instance.definitionId);
    if (!definition) {
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { sagaId, definitionId: instance.definitionId },
        "Saga compensation could not start: this process has no definition registered for it"
      );
      return;
    }

    const outcome = await runAsSagaTenant(
      instance,
      () => this.runCompensationWalk(instance, definition),
      this.lifecycle.metrics
    );

    if (!outcome.ran) {
      recordSagaRecoveryFailure("compensation");
      logger.warn(
        { sagaId, reason: outcome.reason },
        "Saga compensation skipped: awaiting terminalization by the timeout checker"
      );
    }
  }

  /**
   * Persists one step's compensation outcome, against the row as it stands.
   *
   * Two things stand between "record what I just did" and a lost update:
   *
   *   - the row may have gone TERMINAL while this walk was inside a long
   *     `compensate()` — the liveness horizon fails a walk that has not written
   *     inside its window, and nothing else stops this walk from resurrecting
   *     that row (COMPENSATING again, then COMPENSATED, both AFTER
   *     `SAGA_FAILED`). Abandoning is the honest end: the terminal row already
   *     says the rollback did not finish;
   *   - another walk may have recorded a success this copy predates. The merge
   *     is BY INDEX so a success can never be erased by an older array.
   *
   * @param instance - The saga being walked, mutated with anything it learns.
   * @returns False when the walk must stop.
   */
  private async persistWalkProgress(instance: SagaInstance): Promise<boolean> {
    if (!(await this.syncWalkRecord(instance))) return false;
    await this.persistSagaInstance(instance);
    return true;
  }

  /**
   * Brings this walk's record up to date with the row, and says whether it may
   * continue.
   *
   * Called BEFORE the walk decides what to dispatch and again before every
   * write, because both decisions are wrong on a stale copy: the instance can
   * come from the Redis hot cache (best-effort by design), and another walk may
   * have recorded a step since it was cached.
   *
   * @param instance - The saga being walked, mutated with anything it learns.
   * @returns False when the walk must stop.
   */
  private async syncWalkRecord(instance: SagaInstance): Promise<boolean> {
    const sagaId = instance.id;
    try {
      const row = await withSagaSystemRead(this.config.prisma, (tx) =>
        tx.sagaInstance.findUnique({ where: { id: sagaId } })
      );

      if (row === null) {
        recordSagaRecoveryFailure("compensation");
        logger.error({ sagaId }, "Saga compensation stopped: its row no longer exists");
        return false;
      }

      const fresh = deserializeSagaInstanceRow(row);
      if (TERMINAL_SAGA_STATUSES.includes(fresh.status)) {
        recordSagaRecoveryFailure("compensation");
        logger.error(
          { sagaId, status: fresh.status },
          "Saga compensation stopped: the row reached a terminal state while this walk was " +
            "running, and a walk never writes over a terminal row"
        );
        return false;
      }

      mergeCompensationResults(fresh.compensationResults, instance.compensationResults);
    } catch (error) {
      // A read failure is not permission to write over an unknown row.
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { err: error, sagaId },
        "Saga compensation stopped: the row could not be re-read before recording progress"
      );
      return false;
    }

    return true;
  }

  /**
   * @method runCompensationWalk
   * @description Walks the eligible compensable steps in reverse, persisting
   *   after every one, and settles the saga COMPENSATED only when all of them
   *   hold a recorded success. Runs inside the saga's rehydrated tenant scope.
   *
   *   What the machine guarantees, beyond the canon obligation that every
   *   `compensate()` be idempotent and retryable:
   *
   *     - STATUS HONESTY — `COMPENSATING` is durable before any undo runs, and
   *       a walk that could not finish leaves it that way rather than claiming
   *       a rollback that did not happen.
   *     - MONOTONIC DURABLE PROGRESS — the row is written after every step, so
   *       the crash window is exactly ONE in-flight step. Idempotency is relied
   *       on for at most one re-invocation, never for the whole walk.
   *     - NO RE-EXECUTION OF RECORDED WORK — a step whose compensation is
   *       recorded as succeeded is never dispatched again, by an automatic
   *       resume or by an operator re-drive.
   *     - TERMINAL HONESTY — `COMPENSATED` means every eligible step holds a
   *       persisted success; anything else stays `COMPENSATING` for the boot
   *       resume, the operator, and finally the liveness horizon.
   * @param instance - The saga being compensated.
   * @param definition - The definition whose steps are walked back.
   */
  private async runCompensationWalk(
    instance: SagaInstance,
    definition: SagaDefinition
  ): Promise<void> {
    const sagaId = instance.id;

    // The record this walk decides on is the DURABLE one, not the copy it was
    // handed: the resume predicate skips steps another walk already recorded,
    // and deciding that from a cached array re-runs an undo that is done.
    if (!(await this.syncWalkRecord(instance))) return;

    // Defensive, and the reason the static invariant holds for every site: a
    // walk never starts from a row whose persisted status still says the saga
    // is moving forward, whichever door it came through.
    if (instance.status !== "COMPENSATING") {
      await this.beginCompensation(instance);
    }

    const eligible: {
      stepIndex: number;
      step: CompensableStep;
      stepResult: SucceededStepResult;
    }[] = [];
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
      // Only an effect that really landed is undone. A step that failed, or one
      // that never finished, left nothing for a compensation to revert.
      if (stepResult?.outcome !== "succeeded") {
        continue;
      }

      eligible.push({ stepIndex, step, stepResult });
    }

    for (const { stepIndex, step, stepResult } of eligible) {
      // The resume predicate. A recorded success is work this walk — or the
      // walk of a process that no longer exists — already did.
      if (compensationSucceeded(instance.compensationResults[stepIndex])) {
        logger.info(
          { sagaId, stepName: step.name, stepIndex },
          "Skipping a saga step whose compensation is already recorded as succeeded"
        );
        continue;
      }

      logger.info({ stepName: step.name }, "Compensating saga step");

      try {
        const compensationResult = await step.compensate(
          instance.context,
          stepResult.compensationData
        );

        instance.compensationResults[stepIndex] = compensationResult;

        if (compensationResult.outcome !== "succeeded") {
          logger.error(
            {
              stepName: step.name,
              outcome: compensationResult.outcome,
              cause:
                compensationResult.outcome === "failed"
                  ? compensationResult.error
                  : compensationResult.reason,
            },
            "Compensation did not succeed for step"
          );
        }
      } catch (error) {
        logger.error({ err: error, stepName: step.name }, "Compensation error for step");
        instance.compensationResults[stepIndex] = {
          outcome: "failed",
          error: error instanceof Error ? error.message : "Compensation failed",
        };
      }

      // Per step, not once at the end. A failed compensation is persisted too:
      // a resumed walk must be able to tell "attempted and failed" from "never
      // attempted", and only a recorded outcome carries that difference.
      if (!(await this.persistWalkProgress(instance))) {
        return;
      }
    }

    const unfinished = eligible
      .filter(({ stepIndex }) => !compensationSucceeded(instance.compensationResults[stepIndex]))
      .map(({ stepIndex }) => stepIndex);

    if (unfinished.length > 0) {
      // The row keeps saying COMPENSATING, which is the truth: something this
      // saga did is still standing. The boot resume, the operator re-drive and
      // the liveness horizon all act on that status, so the saga still reaches
      // a terminal state — it just does not LIE about having reached one.
      recordSagaRecoveryFailure("compensation");
      logger.error(
        { sagaId, definitionId: instance.definitionId, unfinished },
        "Saga compensation did not finish: the row stays COMPENSATING for a resume, an " +
          "operator re-drive, or the compensation liveness horizon"
      );
      return;
    }

    const compensatedAt = new Date();
    instance.status = "COMPENSATED";
    instance.completedAt = compensatedAt;

    const compensationCompletedEvent = createEventStoreEvent(
      SAGA_EVENTS.SAGA_COMPENSATION_COMPLETED,
      sagaId,
      "Saga",
      {
        sagaId,
        definitionId: instance.definitionId,
        compensatedAt: instance.completedAt,
        // The same predicate the walk itself decides on, so the audit tally and
        // the resume predicate can never disagree about what "compensated" is.
        stepsCompensated: instance.compensationResults.filter((result) =>
          compensationSucceeded(result)
        ).length,
        totalSteps: instance.currentStep,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    await this.persistSagaInstance(instance, [compensationCompletedEvent]);

    // The third ending, measured where it happens. A rolled-back saga is the
    // LONGEST lifetime the engine produces — a forward run plus an undo walk —
    // so a series that carried only COMPLETED and FAILED under-reported exactly
    // the tail the SLO budget is stated against.
    recordSagaDuration(
      instance.definitionId,
      "COMPENSATED",
      compensatedAt.getTime() - instance.startedAt.getTime()
    );

    this.lifecycle.metrics.sagasCompensated++;
    this.lifecycle.stopTracking(sagaId);

    logger.info({ sagaId }, "Saga compensation completed");

    await this.releaseAllLocks(sagaId);
  }

  // ---------------------------------------------------------------------------
  // Completion & Failure
  // ---------------------------------------------------------------------------

  private async completeSaga(instance: SagaInstance): Promise<void> {
    const completedAt = new Date();
    const executionTime = completedAt.getTime() - instance.startedAt.getTime();
    const tally = countStepOutcomes(instance.stepResults);

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
        stepsCompleted: tally.completed,
        stepsFailed: tally.failed,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    await this.persistSagaInstance(instance, [sagaCompletedEvent]);

    // Observed at the ONE place a saga can end successfully, so the series
    // cannot silently miss a terminal path.
    recordSagaDuration(instance.definitionId, "COMPLETED", executionTime);

    this.lifecycle.metrics.sagasCompleted++;
    this.lifecycle.stopTracking(instance.id);

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

    // The in-memory copy is NOT moved to FAILED until the row is. The timeout
    // checker's first act is to stop tracking a terminal-looking instance, so a
    // copy that says FAILED while the row still says RUNNING silently removes
    // the saga from the only sweep that could terminalize it — a durable
    // RUNNING row nobody owns, out of one failed write.
    const previous = {
      status: instance.status,
      completedAt: instance.completedAt,
      error: instance.error,
    };
    instance.status = "FAILED";
    instance.completedAt = completedAt;
    instance.error = error;

    const tally = countStepOutcomes(instance.stepResults);

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
        stepsCompleted: tally.completed,
        stepsFailed: tally.failed,
        error,
      },
      {
        source: "SagaManager",
        correlationId: instance.context.correlationId,
      }
    );

    try {
      await this.persistSagaInstance(instance, [sagaFailedEvent]);
    } catch (persistError) {
      // The row did not move, so neither does the copy. Restoring lets the
      // timeout checker keep tracking a saga that is still durably non-terminal
      // and terminalize it on a later tick, instead of dropping it from the
      // only sweep that covers it.
      instance.status = previous.status;
      if (previous.completedAt === undefined) delete instance.completedAt;
      else instance.completedAt = previous.completedAt;
      if (previous.error === undefined) delete instance.error;
      else instance.error = previous.error;
      throw persistError;
    }

    recordSagaDuration(instance.definitionId, "FAILED", executionTime);

    // Stop tracking it, exactly as the completion and compensation paths do. A
    // terminal saga left in the tracked set is re-visited by the timeout checker
    // on every tick, and once past its horizon re-failed — re-persisting a
    // terminal row and appending a FRESH audit event every minute for the life
    // of the process.
    this.lifecycle.stopTracking(instance.id);
    this.lifecycle.metrics.sagasFailed++;
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
   *   the caller opened and scoped. Kept separate from the refusal checks and
   *   the post-commit cache work above it so the durable write is one readable
   *   unit with exactly one shape.
   * @param tx - The open transaction client.
   * @param instance - The saga being persisted.
   * @param accountId - The owning account, resolved by the caller. Not nullable:
   *   a saga with no resolvable account is refused before a transaction opens.
   * @param events - Durable events committing with the state.
   */
  private async writeSagaState(
    tx: SagaTransactionClient,
    instance: SagaInstance,
    accountId: string,
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
        accountId,
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
        accountId,
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
   * The durable write has exactly ONE shape: a transaction scoped to the saga's
   * owning account on both isolation layers. There is no account-less variant to
   * fall back to, so no engine write can reach the database unscoped.
   *
   * @param instance - The saga instance to persist
   * @param events - Durable events committing in the same transaction.
   * @throws AppError conflict when the persisted account contradicts the saga
   *   context, and AppError internal when no owning account resolves at all —
   *   both before any transaction opens, so a refused persist writes nothing.
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
    // A saga with no resolvable owning account cannot be written at all. Every
    // caller reaches this method through the tenant rehydration, which returns
    // without running on exactly the two resolutions that are not `resolved`,
    // so arriving here with one is a caller that skipped it — a defect in the
    // engine, not a state the database should absorb. Writing it anyway would
    // open a transaction that binds NEITHER isolation layer: no tenant scope for
    // the guard and no `app.account_id` for the row-level policies. Refusing
    // makes "every engine write binds both layers" true without an asterisk.
    if (resolution.kind === "unresolvable-account") {
      throw AppError.internal(
        `Refusing to persist saga '${instance.id}': it carries no resolvable owning account`,
        { sagaId: instance.id, definitionId: instance.definitionId }
      );
    }
    const accountId = resolution.accountId;

    // Atomicity gate: saga state + durable event log commit together. Without
    // the wrapping transaction, a Postgres lag between sagaInstance.upsert
    // and eventStore.append could leave the saga advanced but its audit
    // event missing — OWASP A09 (Logging Failures) gap. The transaction also
    // binds the account scope as its first statement, so the row-level policies
    // govern the same rows the Prisma guard narrowed.
    try {
      await runSagaTenantTransaction(this.config.prisma, accountId, (tx) =>
        this.writeSagaState(tx, instance, accountId, events)
      );
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
      // The SAME normalization the row seam applies. A cached copy written
      // before the three-state contract carries the boolean shape, and a
      // normalization present at only one seam hands the engine a shape it
      // cannot branch on through the other.
      stepResults: normalizeLegacyStepResults(parsed.stepResults),
      compensationResults: normalizeLegacyStepResults(parsed.compensationResults),
      startedAt: new Date(parsed.startedAt as string),
      retryCount: parsed.retryCount as number,
      ...(typeof parsed.completedAt === "string"
        ? { completedAt: new Date(parsed.completedAt) }
        : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      ...(typeof parsed.nextRetryAt === "string"
        ? { nextRetryAt: new Date(parsed.nextRetryAt) }
        : {}),
      // Symmetric with the write path, which serializes the whole instance.
      // Dropping it here made every cached COMPENSATING row look like one with
      // no liveness anchor at all, so the timeout checker paid a full-row
      // re-read for it on every tick, forever.
      ...(typeof parsed.updatedAt === "string" ? { updatedAt: new Date(parsed.updatedAt) } : {}),
    };
  }

  private deserializePrismaRow(row: SagaInstanceRow): SagaInstance {
    return deserializeSagaInstanceRow(row);
  }
}
