/**
 * @file ComposedEventDispatcher.ts
 * @description Dual-path event dispatcher wrapping InMemoryEventDispatcher (in-process) and
 *              IntegrationEventPublisher (cross-process via BullMQ) with error isolation.
 * @layer infrastructure
 */

import type {
  DomainEvent,
  DomainEventHandler,
  EventDispatcher,
} from "../../domain/events/DomainEvent.js";
import type { IntegrationEventPublisher } from "./IntegrationEventPort.js";
import { toIntegrationEvent } from "./IntegrationEvent.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("events:composed-dispatcher");

/**
 * ComposedEventDispatcher — dual-path event dispatcher.
 *
 * Dispatches every domain event through two channels:
 * 1. `inMemory` — synchronous in-process handlers (always fires, primary path)
 * 2. `publisher` — cross-process BullMQ queue (best-effort, errors logged and swallowed)
 *
 * The `register()` method only affects the in-process dispatcher — integration
 * event consumers subscribe via BullMQ worker configuration, not here.
 */
export class ComposedEventDispatcher implements EventDispatcher {
  constructor(
    private readonly inMemory: EventDispatcher,
    private readonly publisher: IntegrationEventPublisher
  ) {}

  /**
   * Register an in-process domain event handler.
   * Delegates entirely to the InMemoryEventDispatcher.
   */
  register<T extends DomainEvent>(eventType: string, handler: DomainEventHandler<T>): void {
    this.inMemory.register(eventType, handler);
  }

  /**
   * Dispatch a single domain event.
   *
   * Step 1: in-process dispatch (awaited — primary path, must complete).
   * Step 2: publish to BullMQ (best-effort — error is caught and swallowed).
   */
  async dispatch(event: DomainEvent): Promise<void> {
    // 1. Always dispatch in-process first — this is the authoritative path
    await this.inMemory.dispatch(event);

    // 2. Publish to BullMQ — best-effort; outbox relay provides at-least-once safety net
    try {
      const integrationEvent = toIntegrationEvent(event);
      await this.publisher.publish(integrationEvent);
    } catch (err: unknown) {
      // Swallow BullMQ errors — do NOT propagate to callers (in-process dispatch
      // is the authoritative path; outbox relay provides at-least-once recovery).
      // Log so the failure is visible in observability — T4-F will add a metric
      // counter to alert on sustained publisher failures.
      log.error(
        { err, eventType: event.eventType, aggregateId: event.aggregateId },
        "Integration event publish failed (swallowed)"
      );
    }
  }

  /**
   * Dispatch multiple domain events.
   *
   * Step 1: in-process dispatch for each event, sequentially (preserves ordering).
   * Step 2: batch-publish all events to BullMQ (best-effort).
   */
  async dispatchAll(events: DomainEvent[]): Promise<void> {
    // 1. In-process dispatch — sequential to preserve domain event ordering
    for (const event of events) {
      await this.inMemory.dispatch(event);
    }

    // 2. Batch-publish to BullMQ — best-effort
    try {
      const integrationEvents = events.map(toIntegrationEvent);
      await this.publisher.publishBatch(integrationEvents);
    } catch (err: unknown) {
      // Swallow BullMQ errors — do NOT propagate to callers. See dispatch()
      // above for the full rationale; T4-F will add a counter metric.
      log.error(
        { err, batchSize: events.length, eventTypes: events.map((e) => e.eventType) },
        "Integration event batch publish failed (swallowed)"
      );
    }
  }
}
