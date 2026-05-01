/**
 * @file OutboxRelay.ts
 * @description Polls the outbox table and dispatches unpublished domain
 *              events with at-least-once delivery semantics. Three layers
 *              of correctness apply (T4-C):
 *
 *                1. **Atomic claim** — `OutboxClaimService` runs the
 *                   canonical `UPDATE ... FOR UPDATE SKIP LOCKED ...
 *                   RETURNING` so concurrent OutboxRelay instances do not
 *                   pick the same row.
 *                2. **Consumer dedupe** — `OutboxInbox.tryClaimForProcessing`
 *                   inserts `messageId` with a unique constraint before
 *                   handler invocation. Defense-in-depth against retries
 *                   that occur between claim release and the next poll.
 *                3. **Full-jitter backoff** — `OutboxBackoff.computeNextRetryAt`
 *                   spreads retries across the available window so a batch
 *                   of simultaneous failures does not retry in lockstep.
 *
 *              `archiveToDeadLetter` is itself transactional (single
 *              `$transaction` covering DLQ create + outbox terminal mark),
 *              so a partial failure cannot leave the relay re-polling a row
 *              whose DLQ entry already exists.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { EventDispatcher, DomainEvent } from "../../domain/events/DomainEvent.js";
import type { OutboxClaimService, ClaimedOutboxEvent } from "./OutboxClaimService.js";
import type { OutboxBackoff } from "./OutboxBackoff.js";
import type { OutboxInbox } from "./OutboxInbox.js";

export interface OutboxRelayOptions {
  prisma: PrismaClient;
  eventDispatcher: EventDispatcher;
  scheduler: BackgroundTaskScheduler;
  claimService: OutboxClaimService;
  backoff: OutboxBackoff;
  inbox: OutboxInbox;
  consumerId: string;
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
      const isFresh = await this.options.inbox.tryClaimForProcessing(
        row.id,
        this.options.consumerId
      );
      if (!isFresh) {
        // Already processed by another consumer (or this one in a prior
        // poll that crashed after dispatch). Mark published to release the
        // outbox row — the side effects already occurred.
        await this.options.claimService.markPublished(row.id);
        return;
      }

      const event: DomainEvent = {
        eventId: row.id,
        eventType: row.eventType,
        aggregateId: row.aggregateId,
        aggregateType: row.aggregateType,
        occurredAt: row.occurredAt,
        version: row.version,
        metadata: { payload: row.payload, fromOutbox: true },
      };

      await this.options.eventDispatcher.dispatch(event);
      await this.options.claimService.markPublished(row.id);
    } catch (error) {
      const newRetryCount = row.retryCount + 1;
      if (newRetryCount >= this.maxRetries) {
        await this.options.claimService.archiveToDeadLetter(
          row,
          error instanceof Error ? error.message : "Max retries exhausted",
          newRetryCount
        );
      } else {
        const nextRetryAt = this.options.backoff.computeNextRetryAt(newRetryCount);
        await this.options.claimService.releaseForRetry(row.id, newRetryCount, nextRetryAt);
      }
    }
  }
}
