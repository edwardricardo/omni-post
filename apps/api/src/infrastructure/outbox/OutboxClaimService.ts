/**
 * @file OutboxClaimService.ts
 * @description Atomic claim + release + DLQ archival for the transactional
 *              outbox. Uses the canonical PostgreSQL `UPDATE ... WHERE id IN
 *              (SELECT ... FOR UPDATE SKIP LOCKED LIMIT N) RETURNING ...`
 *              pattern (inferable.ai, npiontko.pro, postgres docs > SELECT)
 *              so multiple OutboxRelay instances can poll the same table
 *              concurrently without dispatching the same event twice.
 *
 *              Lease semantics: a claimed row whose `claimedAt` is older
 *              than `leaseDurationMs` is considered abandoned (worker
 *              crashed mid-dispatch) and becomes re-claimable. Default
 *              lease 5 minutes — long enough for in-process dispatch +
 *              transient retries, short enough that a crashed worker does
 *              not block its events for long.
 * @layer infrastructure
 */

import { Prisma, type PrismaClient } from "@infra/prisma";

/**
 * Subset of `OutboxEvent` row returned by the atomic claim query. The
 * `payload` is left as `unknown` so callers explicitly cast/parse — the
 * outbox stores it as JSONB and we do not impose a shape at this layer.
 */
export interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  version: number;
  occurredAt: Date;
  retryCount: number;
  createdAt: Date;
}

export interface OutboxClaimServiceOptions {
  prisma: PrismaClient;
  workerId: string;
  leaseDurationMs?: number;
}

export class OutboxClaimService {
  private readonly prisma: PrismaClient;
  private readonly workerId: string;
  private readonly leaseDurationMs: number;

  constructor(options: OutboxClaimServiceOptions) {
    this.prisma = options.prisma;
    this.workerId = options.workerId;
    this.leaseDurationMs = options.leaseDurationMs ?? 5 * 60 * 1000;
  }

  /**
   * Atomically claim up to `batchSize` ready outbox events for processing
   * by this worker. Rows already claimed by other workers within the lease
   * window are skipped via `FOR UPDATE SKIP LOCKED`. Rows whose claim has
   * expired are reclaimable.
   *
   * Eligible rows match all of:
   *   - `publishedAt IS NULL`     (not yet successfully dispatched)
   *   - `retryCount < maxRetries` (not exhausted)
   *   - `nextRetryAt <= now`      (backoff window has elapsed)
   *   - `claimedAt IS NULL OR claimedAt < leaseExpiry` (no live claim)
   *
   * Returned rows have their `claimedAt` and `claimedBy` set so concurrent
   * pollers see them as in-flight.
   */
  async claim(batchSize: number): Promise<ClaimedOutboxEvent[]> {
    if (batchSize <= 0) return [];
    const now = new Date();
    const leaseExpiry = new Date(now.getTime() - this.leaseDurationMs);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        eventType: string;
        aggregateId: string;
        aggregateType: string;
        payload: unknown;
        version: number;
        occurredAt: Date;
        retryCount: number;
        createdAt: Date;
      }>
    >(Prisma.sql`
      UPDATE "OutboxEvent"
      SET "claimedAt" = ${now}, "claimedBy" = ${this.workerId}
      WHERE "id" IN (
        SELECT "id" FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
          AND "retryCount" < "maxRetries"
          AND "nextRetryAt" <= ${now}
          AND ("claimedAt" IS NULL OR "claimedAt" < ${leaseExpiry})
        ORDER BY "occurredAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "eventType", "aggregateId", "aggregateType",
                "payload", "version", "occurredAt", "retryCount", "createdAt"
    `);

    return rows;
  }

  /**
   * Mark the event as successfully published and release the claim. The
   * row will not be re-polled because `publishedAt IS NULL` no longer holds.
   */
  async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { publishedAt: new Date(), claimedAt: null, claimedBy: null },
    });
  }

  /**
   * Release the claim and schedule a retry. The caller computes the next
   * retry time (typically via `OutboxBackoff`); this method just persists
   * it together with the incremented `retryCount`.
   */
  async releaseForRetry(id: string, retryCount: number, nextRetryAt: Date): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { retryCount, nextRetryAt, claimedAt: null, claimedBy: null },
    });
  }

  /**
   * Archive the event to `OutboxDeadLetter` and mark the outbox row terminal
   * — atomically, in a single transaction. If either write fails, both roll
   * back and the next poll will retry the dispatch (preserving the
   * `originalEventId @unique` constraint on the DLQ).
   */
  async archiveToDeadLetter(
    event: ClaimedOutboxEvent,
    failureReason: string,
    retryCount: number
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.outboxDeadLetter.create({
        data: {
          originalEventId: event.id,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          aggregateType: event.aggregateType,
          payload: event.payload as Prisma.InputJsonValue,
          failureReason,
          retryCount,
          firstFailedAt: event.createdAt,
        },
      }),
      this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date(), claimedAt: null, claimedBy: null },
      }),
    ]);
  }
}
