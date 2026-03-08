/**
 * Infrastructure Layer - BullMQ Integration Event Publisher
 *
 * Part of P2-2: Integration Events via BullMQ
 * Publishes integration events to a BullMQ queue for cross-process delivery.
 *
 * Design decisions:
 * - Receives a pre-configured `Queue` instance via constructor (DI-friendly).
 *   The queue is created in index.ts so connection lifecycle is managed externally.
 * - Uses `jobId: event.eventId` for BullMQ deduplication. When the OutboxRelay
 *   re-dispatches an event already sent by the use case, BullMQ silently ignores
 *   the duplicate (same jobId = no-op on second add).
 * - Job options (attempts, backoff, removeOnComplete) are configured at the queue
 *   level in index.ts. Per-job options here are limited to `jobId` for dedup.
 * - Errors from `queue.add()` propagate to the caller. The ComposedEventDispatcher
 *   (or equivalent) is responsible for error isolation.
 */

import type { Queue } from "bullmq";
import type { IntegrationEvent } from "./IntegrationEvent.js";
import type { IntegrationEventPublisher } from "./IntegrationEventPort.js";

/**
 * BullMQ adapter for `IntegrationEventPublisher`.
 *
 * Publishes integration events as BullMQ jobs where:
 * - Job name = `event.eventType` (enables per-event-type worker routing)
 * - Job data = the full `IntegrationEvent` DTO (JSON-serializable)
 * - Job id  = `event.eventId` (ensures at-most-once delivery for duplicate dispatches)
 */
export class BullMQIntegrationPublisher implements IntegrationEventPublisher {
  constructor(private readonly queue: Queue) {}

  /**
   * Publish a single integration event to the BullMQ queue.
   *
   * The event type is used as the job name so workers can route by type.
   * The event id is used as the BullMQ job id for idempotent delivery.
   */
  async publish(event: IntegrationEvent): Promise<void> {
    await this.queue.add(event.eventType, event, {
      jobId: event.eventId, // Dedup: same eventId → no-op on second add
    });
  }

  /**
   * Publish a batch of integration events in a single BullMQ call.
   *
   * Uses `addBulk` for efficiency — fewer round-trips to Redis compared
   * to calling `add()` in a loop. Empty arrays are short-circuited.
   */
  async publishBatch(events: readonly IntegrationEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.queue.addBulk(
      events.map((event) => ({
        name: event.eventType,
        data: event,
        opts: {
          jobId: event.eventId,
        },
      }))
    );
  }

  /**
   * Close the BullMQ queue and release its underlying Redis connection.
   *
   * Delegates directly to `queue.close()`. Safe to call even if the queue
   * is already closed (BullMQ handles the double-close gracefully).
   */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
