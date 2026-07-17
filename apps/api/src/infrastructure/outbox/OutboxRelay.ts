/**
 * @file OutboxRelay.ts
 * @description Polls the outbox table and dispatches unpublished domain
 *              events with at-least-once delivery semantics. Ordering is the
 *              correctness invariant: an event is dispatched FIRST, then marked
 *              terminally published in a single atomic UPDATE. `publishedAt` is
 *              set only after `dispatch()` resolves, so a crash or transient
 *              error before the terminal write leaves the row unpublished and
 *              it is redelivered on the next lease cycle — never silently lost,
 *              never published-without-dispatch.
 *
 *                1. **Atomic claim** — `OutboxClaimService` runs the canonical
 *                   `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING` so
 *                   concurrent OutboxRelay instances never pick the same live
 *                   row; the `publishedAt IS NULL` predicate keeps published
 *                   rows out of every future claim.
 *                2. **Full-jitter backoff** — `OutboxBackoff.computeNextRetryAt`
 *                   spreads retries across the available window so a batch of
 *                   simultaneous failures does not retry in lockstep.
 *
 *              Consumer-observed duplicates are possible only on genuine
 *              crash-retry or lease expiry and are absorbed by idempotent
 *              consumers (canon: "every consumer handler is idempotent").
 *
 *              `archiveToDeadLetter` is itself transactional (single
 *              `$transaction` covering DLQ create + outbox terminal mark). Its
 *              `originalEventId @unique` constraint means a lease-expiry race
 *              where two relays exhaust retries on the same row surfaces a
 *              P2002 on the loser; that is a benign already-terminal outcome
 *              and is swallowed so one lost race does not abort the batch tick.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { EventDispatcher, DomainEvent } from "@core/domain/events/DomainEvent.js";
import type { OutboxClaimService, ClaimedOutboxEvent } from "./OutboxClaimService.js";
import type { OutboxBackoff } from "./OutboxBackoff.js";

/** Prisma error code for a unique-constraint violation. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Narrow an unknown error to a Prisma unique-constraint (P2002) violation. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

export interface OutboxRelayOptions {
  prisma: PrismaClient;
  eventDispatcher: EventDispatcher;
  scheduler: BackgroundTaskScheduler;
  claimService: OutboxClaimService;
  backoff: OutboxBackoff;
  pollIntervalMs?: number;
  batchSize?: number;
  maxRetries?: number;
}

export class OutboxRelay {
  private readonly taskId = "outbox-relay";
  private scheduled = false;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    this.maxRetries = options.maxRetries ?? 5;
  }

  /** Start polling the outbox table on a fixed interval. Idempotent. */
  start(): void {
    if (this.scheduled) return;
    this.options.scheduler.register(this.taskId, () => this.poll(), this.pollIntervalMs);
    this.scheduled = true;
  }

  /** Stop the polling task. Idempotent. */
  stop(): void {
    if (!this.scheduled) return;
    this.options.scheduler.unregister(this.taskId);
    this.scheduled = false;
  }

  /** Returns true if the relay is currently scheduled. */
  get isRunning(): boolean {
    return this.scheduled;
  }

  /**
   * Run a single poll cycle: claim a batch, dispatch each event, mark
   * published or schedule retry / archive to DLQ on failure. Re-entrant
   * guarded — overlapping ticks return immediately.
   */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimed = await this.options.claimService.claim(this.batchSize);

      for (const row of claimed) {
        await this.processClaimed(row);
      }
    } finally {
      this.running = false;
    }
  }

  private async processClaimed(row: ClaimedOutboxEvent): Promise<void> {
    try {
      const event: DomainEvent = {
        eventId: row.id,
        eventType: row.eventType,
        aggregateId: row.aggregateId,
        aggregateType: row.aggregateType,
        occurredAt: row.occurredAt,
        version: row.version,
        metadata: { payload: row.payload, fromOutbox: true },
      };

      // Dispatch FIRST, then mark published. `markPublished` is a single
      // atomic UPDATE that sets `publishedAt` only after delivery succeeded,
      // so the row can never be published without having been dispatched.
      await this.options.eventDispatcher.dispatch(event);
      await this.options.claimService.markPublished(row.id);
    } catch (error) {
      const newRetryCount = row.retryCount + 1;
      if (newRetryCount >= this.maxRetries) {
        try {
          await this.options.claimService.archiveToDeadLetter(
            row,
            error instanceof Error ? error.message : "Max retries exhausted",
            newRetryCount
          );
        } catch (archiveError) {
          // A concurrent relay already dead-lettered this row under lease
          // expiry: the DLQ's `originalEventId @unique` constraint raises
          // P2002 on the loser. The row is already terminal, so swallow it
          // and continue the batch. Any other archival failure (real infra
          // error) still propagates for a lease-expiry retry.
          if (!isUniqueConstraintViolation(archiveError)) throw archiveError;
        }
      } else {
        const nextRetryAt = this.options.backoff.computeNextRetryAt(newRetryCount);
        await this.options.claimService.releaseForRetry(row.id, newRetryCount, nextRetryAt);
      }
    }
  }
}
