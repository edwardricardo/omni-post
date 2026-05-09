/**
 * @file IntegrationEventDeliveryHandler.ts
 * @description Bridges domain events from the outbox to the customer-facing
 *              integration delivery service. The OutboxRelay claims a row,
 *              dispatches a DomainEvent to the EventDispatcher; this handler
 *              maps the internal event name to the public integration event
 *              name (e.g. PostPublished → post.published) and fires it via
 *              TriggerIntegrationEventService, which fans out to every
 *              IntegrationSubscription whose `event` matches.
 *
 *              Delivery semantic: the outbox guarantees the handler runs
 *              at-least-once. The fire() call itself is best-effort
 *              (Promise.allSettled, no per-subscription retry). True
 *              at-least-once to customer URLs requires per-subscription
 *              delivery jobs with their own retry/DLQ — tracked in PR-59.
 * @layer infrastructure
 */

import type { DomainEvent, DomainEventHandler } from "../domain/events/DomainEvent.js";
import type { TriggerIntegrationEventService } from "../application/integrations/TriggerIntegrationEventService.js";
import { logger } from "../lib/logger.js";

/**
 * Mapping of internal `eventType` (from domain event class `readonly eventType`)
 * to the public integration event name customers subscribe to via
 * `POST /zapier/subscribe { event, targetUrl }`. Internal renames must NOT
 * leak through this surface — change the right column only when the public
 * contract changes (breaking change for subscribers).
 */
export const INTEGRATION_EVENT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  PostCreated: "post.created",
  PostContentUpdated: "post.updated",
  PostScheduled: "post.scheduled",
  PostUnscheduled: "post.unscheduled",
  PostPublishingStarted: "post.publishing_started",
  PostPublished: "post.published",
  PostPublishingFailed: "post.failed",
  PostCancelled: "post.cancelled",
  PostMediaAdded: "post.media_added",
  PostMediaRemoved: "post.media_removed",
  PostSubmittedForReview: "post.submitted_for_review",
});

/**
 * Outbox-driven event types this handler subscribes to. Used by the boot
 * wiring in `index.ts` to register one dispatcher entry per type.
 */
export const HANDLED_EVENT_TYPES: ReadonlyArray<string> = Object.freeze(
  Object.keys(INTEGRATION_EVENT_NAMES)
);

export class IntegrationEventDeliveryHandler implements DomainEventHandler<DomainEvent> {
  constructor(private readonly trigger: TriggerIntegrationEventService) {}

  async handle(event: DomainEvent): Promise<void> {
    const integrationEventName = INTEGRATION_EVENT_NAMES[event.eventType];
    if (!integrationEventName) {
      // Event type isn't in the public catalog. Silently drop — keeps the
      // dispatcher safe to wire broadly without leaking unmapped events.
      return;
    }

    // OutboxRelay reconstructs the event with `metadata.payload` carrying
    // the JSON column written by PrismaOutboxWriter (event.toPayload()).
    const payload = (event.metadata?.payload as Record<string, unknown> | undefined) ?? {};

    const enriched: Record<string, unknown> = {
      ...payload,
      eventId: event.eventId,
      eventType: integrationEventName,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      occurredAt: event.occurredAt,
    };

    try {
      await this.trigger.fire(integrationEventName, enriched);
    } catch (err) {
      // Propagate so the outbox relay retries dispatch. The fire() impl is
      // already fire-and-forget per-subscription, so a throw here means
      // something pre-fan-out failed (e.g., subscription repo unreachable).
      logger.error(
        {
          err,
          eventType: event.eventType,
          integrationEventName,
          eventId: event.eventId,
        },
        "Integration event delivery handler failed"
      );
      throw err;
    }
  }
}
