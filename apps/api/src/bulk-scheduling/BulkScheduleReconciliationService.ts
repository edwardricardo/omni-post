/**
 * @file BulkScheduleReconciliationService.ts
 * @description Backstop sweep that re-drives stuck bulk-scheduling rows. Registered
 *   via `BackgroundTaskScheduler` (NOT raw setInterval — per LOGGING_CANON §Background
 *   Tasks) with a 60-second interval. Mirrors `SagaManagerLifecycle.startRetryRecoveryChecker`.
 *
 *   Stuck detection: queries `OutboxDeadLetter` for unresolved `BulkScheduleItem` events.
 *   These are rows whose `BulkScheduleRowConfirmed` outbox event was exhausted by the relay
 *   and archived to the DLQ, leaving the item PENDING with no live outbox row to pick up.
 *
 *   Re-drive: reads the full row intent from the DLQ payload (which retains all fields from
 *   `toPayload()`) and re-enqueues a fresh BullMQ job with the original deterministic
 *   `dedupeKey = bulk-{batchId}-{itemId}`. Never mutates terminal outbox rows; idempotency
 *   is guaranteed by the existing worker item-status guard (already-SCHEDULED ⇒ SKIPPED).
 *
 *   Boot wiring: `apps/api/src/infrastructure/container/setupPostUseCases.ts` registers
 *   this service; `index.ts` calls `start()` after `outboxRelay.start()`.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { QueuePort } from "@ports/core";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("bulk-schedule-reconciliation");

/** Stable task id registered with the BackgroundTaskScheduler. */
const TASK_ID = "bulk-schedule-reconciliation";

/** How many DLQ rows to process per sweep tick (prevents runaway execution). */
const MAX_PER_TICK = 50;

/**
 * Minimal shape of an OutboxDeadLetter row that this service reads.
 * Kept internal to avoid coupling to the generated Prisma types in the
 * application/domain layers.
 */
interface DlqRow {
  aggregateId: string;
  payload: unknown;
}

/**
 * Minimal Prisma client surface the service needs.
 * Accepted as a constructor parameter to allow test injection without
 * importing the full Prisma singleton.
 */
export interface BulkScheduleReconciliationPrismaClient {
  outboxDeadLetter: {
    findMany(args: {
      where: { aggregateType: string; resolvedAt: null };
      select: { aggregateId: true; payload: true };
      take: number;
    }): Promise<DlqRow[]>;
  };
}

/**
 * @class BulkScheduleReconciliationService
 * @description Registers a 60-second background sweep that re-enqueues BullMQ jobs
 *   for stuck bulk-scheduling rows whose outbox events ended up in the DLQ.
 */
export class BulkScheduleReconciliationService {
  constructor(
    private readonly prisma: BulkScheduleReconciliationPrismaClient | PrismaClient,
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly queue: QueuePort
  ) {
    // Register the sweep immediately in the constructor so that DI wiring in
    // setupPostUseCases.ts does not need a separate start() call convention.
    this.scheduler.register(TASK_ID, () => this.sweep(), 60_000);
  }

  /**
   * @method start
   * @description No-op — registration happens in the constructor. Kept for
   *   symmetry with other lifecycle services (e.g. OutboxRelay, recurrenceScheduler)
   *   so the boot wiring in index.ts has a consistent call site.
   */
  start(): void {
    // Registration already done in constructor.
  }

  /**
   * @method sweep
   * @description Queries the OutboxDeadLetter for unresolved BulkScheduleItem events
   *   and re-enqueues each row's original BullMQ job from the saved payload.
   */
  private async sweep(): Promise<void> {
    let dlqRows: DlqRow[];

    try {
      const client = this.prisma as BulkScheduleReconciliationPrismaClient;
      dlqRows = await client.outboxDeadLetter.findMany({
        where: {
          aggregateType: "BulkScheduleItem",
          resolvedAt: null,
        },
        select: { aggregateId: true, payload: true },
        take: MAX_PER_TICK,
      });
    } catch (err) {
      logger.error({ err }, "Bulk-schedule reconciliation query failed");
      return;
    }

    if (dlqRows.length === 0) return;

    logger.info({ count: dlqRows.length }, "Reconciliation sweep found stuck bulk-schedule rows");

    for (const row of dlqRows) {
      await this.redriveRow(row);
    }
  }

  /**
   * @method redriveRow
   * @description Re-enqueues one stuck row from its DLQ payload. Logs warn and
   *   continues on failure — a failed re-enqueue will be retried on the next
   *   sweep tick.
   * @param row - The dead-lettered outbox row.
   */
  private async redriveRow(row: DlqRow): Promise<void> {
    const p = (row.payload as Record<string, unknown> | null) ?? {};

    const itemId = typeof p.itemId === "string" ? p.itemId : row.aggregateId;
    const batchId = typeof p.batchId === "string" ? p.batchId : undefined;

    if (!batchId) {
      logger.warn({ aggregateId: row.aggregateId }, "DLQ row missing batchId — cannot re-enqueue");
      return;
    }

    const result = await this.queue.enqueue({
      payload: {
        batchId,
        itemId,
        accountId: typeof p.accountId === "string" ? p.accountId : "",
        projectId: typeof p.projectId === "string" ? p.projectId : "",
        row: {
          content: typeof p.body === "string" ? p.body : "",
          scheduledFor: typeof p.scheduledFor === "string" ? p.scheduledFor : "",
          timezone: typeof p.timezone === "string" ? p.timezone : "UTC",
          ...(typeof p.title === "string" && { title: p.title }),
          media: Array.isArray(p.media) ? p.media : [],
          tags: Array.isArray(p.tags) ? p.tags : [],
        },
        channelIds: Array.isArray(p.channelIds) ? p.channelIds : [],
      },
      dedupeKey: `bulk-${batchId}-${itemId}`,
    });

    if (!result.ok) {
      logger.warn(
        { itemId, batchId, error: result.error },
        "Reconciliation re-enqueue failed — will retry on next sweep"
      );
      // Intentionally do NOT throw — the sweep continues for remaining items
      // and this row will be re-attempted on the next 60-second tick.
      return;
    }

    logger.info({ itemId, batchId }, "Reconciliation re-enqueued stuck bulk-schedule row");
  }
}
