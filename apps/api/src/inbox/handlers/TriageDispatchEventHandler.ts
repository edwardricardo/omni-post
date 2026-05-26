/**
 * @file TriageDispatchEventHandler.ts
 * @description Bridges the `SocialMessageReceived` domain event (emitted by
 *              `SocialMessageAggregate` and dispatched through the outbox-driven
 *              `EventDispatcher`) into the `TRIAGE_INBOX` BullMQ queue. Each
 *              inbound message gets exactly one classification job, deduped
 *              by message id. Mirrors `IntegrationEventDeliveryHandler` —
 *              see boot wiring in `apps/api/src/index.ts`.
 * @layer infrastructure
 */

import type { DomainEvent, DomainEventHandler } from "@core/domain/events/DomainEvent.js";
import type { QueuePort } from "@ports/core";
import { createLogger } from "../../lib/logger.js";

const logger = createLogger("triage-dispatch-handler");

/**
 * Domain event types this handler subscribes to. Boot wiring iterates this
 * array and registers the handler for each entry, mirroring the
 * `IntegrationEventDeliveryHandler` convention.
 */
export const TRIAGE_HANDLED_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  "SocialMessageReceived",
]);

/**
 * @class TriageDispatchEventHandler
 * @description On `SocialMessageReceived`, enqueues a `TRIAGE_INBOX` job
 *   carrying `{ messageId, accountId }`. Idempotent via `dedupeKey:
 *   triage-${messageId}` — replaying the event never produces a duplicate
 *   classification.
 */
export class TriageDispatchEventHandler implements DomainEventHandler<DomainEvent> {
  constructor(private readonly queue: QueuePort) {}

  /**
   * @method handle
   * @description Reads `{ messageId, accountId }` from the outbox-reconstructed
   *   event payload and enqueues the triage job. Throws on enqueue failure so
   *   the outbox relay retries dispatch.
   */
  async handle(event: DomainEvent): Promise<void> {
    if (event.eventType !== "SocialMessageReceived") {
      return;
    }

    const payload = (event.metadata?.payload as Record<string, unknown> | undefined) ?? {};
    const messageId = typeof payload.messageId === "string" ? payload.messageId : event.aggregateId;
    const accountId = typeof payload.accountId === "string" ? payload.accountId : undefined;

    if (!messageId || !accountId) {
      logger.warn(
        {
          eventId: event.eventId,
          hasMessageId: Boolean(messageId),
          hasAccountId: Boolean(accountId),
        },
        "SocialMessageReceived missing messageId or accountId — skipping triage enqueue"
      );
      return;
    }

    const result = await this.queue.enqueue({
      payload: { messageId, accountId },
      dedupeKey: `triage-${messageId}`,
    });

    if (!result.ok) {
      logger.error(
        { eventId: event.eventId, messageId, error: result.error },
        "Failed to enqueue TRIAGE_INBOX job"
      );
      throw new Error(`Failed to enqueue triage job for message ${messageId}: ${result.error}`);
    }
  }
}
