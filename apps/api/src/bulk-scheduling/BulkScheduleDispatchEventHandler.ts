/**
 * @file BulkScheduleDispatchEventHandler.ts
 * @description Bridges the `BulkScheduleRowConfirmed` domain event (written to the
 *   transactional outbox by `ConfirmBulkScheduleUseCase`) into the `BULK_SCHEDULE`
 *   BullMQ queue. Each confirmed row gets exactly one job, deduplicated by
 *   `dedupeKey = bulk-{batchId}-{itemId}` — replaying the event (outbox at-least-once)
 *   never produces a duplicate job. Mirrors `TriageDispatchEventHandler` in structure.
 *
 *   Boot wiring: `apps/api/src/index.ts` resolves this handler from DI and registers
 *   it for each type in `BULK_SCHEDULE_HANDLED_EVENT_TYPES` on the `eventDispatcher`.
 * @layer infrastructure
 */

import type { DomainEvent, DomainEventHandler } from "@core/domain/events/DomainEvent.js";
import type { QueuePort } from "@ports/core";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("bulk-schedule-dispatch-handler");

/**
 * Domain event types this handler subscribes to. Boot wiring iterates this
 * array and registers the handler for each entry, mirroring the
 * `TriageDispatchEventHandler` convention.
 */
export const BULK_SCHEDULE_HANDLED_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  "BulkScheduleRowConfirmed",
]);

/**
 * @class BulkScheduleDispatchEventHandler
 * @description On `BulkScheduleRowConfirmed`, enqueues a `BULK_SCHEDULE` job
 *   carrying the full row intent from the event payload. Idempotent via
 *   `dedupeKey: bulk-{batchId}-{itemId}` — replaying the event never produces
 *   a duplicate job. Throws on enqueue failure so the outbox relay retries dispatch.
 */
export class BulkScheduleDispatchEventHandler implements DomainEventHandler<DomainEvent> {
  constructor(private readonly queue: QueuePort) {}

  /**
   * @method handle
   * @description Reads the row intent from the outbox-reconstructed event payload
   *   and enqueues the bulk-schedule job. Guards against malformed payloads by
   *   logging a warn and returning without enqueue (no poison-pill). Throws on
   *   enqueue failure so the outbox relay retries dispatch.
   * @param event - The dispatched domain event.
   */
  async handle(event: DomainEvent): Promise<void> {
    if (event.eventType !== "BulkScheduleRowConfirmed") {
      return;
    }

    const p = (event.metadata?.payload as Record<string, unknown> | undefined) ?? {};

    const itemId = typeof p.itemId === "string" ? p.itemId : undefined;
    const batchId = typeof p.batchId === "string" ? p.batchId : undefined;
    const accountId = typeof p.accountId === "string" ? p.accountId : undefined;
    const projectId = typeof p.projectId === "string" ? p.projectId : undefined;
    const body = typeof p.body === "string" ? p.body : undefined;
    const scheduledFor = typeof p.scheduledFor === "string" ? p.scheduledFor : undefined;
    const timezone = typeof p.timezone === "string" ? p.timezone : "UTC";
    const channelIds = Array.isArray(p.channelIds) ? (p.channelIds as string[]) : [];
    const media = Array.isArray(p.media) ? p.media : [];
    const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
    const title = typeof p.title === "string" ? p.title : undefined;

    // Guard: if critical fields are missing, the payload is malformed — log warn
    // and return without enqueue so we don't poison the relay with an un-retryable
    // job. The reconciliation sweep will re-drive the item after the threshold.
    if (!itemId || !batchId || !accountId || !projectId) {
      logger.warn(
        {
          eventId: event.eventId,
          hasItemId: Boolean(itemId),
          hasBatchId: Boolean(batchId),
          hasAccountId: Boolean(accountId),
          hasProjectId: Boolean(projectId),
        },
        "BulkScheduleRowConfirmed missing required fields — skipping enqueue"
      );
      return;
    }

    const result = await this.queue.enqueue({
      payload: {
        batchId,
        itemId,
        accountId,
        projectId,
        row: {
          content: body ?? "",
          scheduledFor: scheduledFor ?? "",
          timezone,
          ...(title !== undefined && { title }),
          media,
          tags,
        },
        channelIds,
      },
      dedupeKey: `bulk-${batchId}-${itemId}`,
    });

    if (!result.ok) {
      logger.error(
        { eventId: event.eventId, itemId, batchId, error: result.error },
        "Failed to enqueue BULK_SCHEDULE job"
      );
      throw new Error(`Failed to enqueue bulk schedule row ${itemId}: ${String(result.error)}`);
    }
  }
}
