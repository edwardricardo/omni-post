/**
 * Infrastructure Layer - Composed Event Dispatcher
 *
 * Part of P2-2: Integration Events via BullMQ
 * Wraps InMemoryEventDispatcher (in-process) + IntegrationEventPublisher (cross-process).
 * Ensures in-process handlers always fire, even if BullMQ is unavailable.
 *
 * Error isolation guarantee: if the IntegrationEventPublisher (BullMQ) throws, the
 * in-process dispatch is still treated as successful. The outbox relay provides
 * at-least-once delivery as a safety net for any dropped integration events.
 */

import type {
  DomainEvent,
  DomainEventHandler,
  EventDispatcher,
} from "../../domain/events/DomainEvent.js";
import type { IntegrationEventPublisher } from "./IntegrationEventPort.js";
import { toIntegrationEvent } from "./IntegrationEvent.js";

/**
 * ComposedEventDispatcher — dual-path event dispatcher.
 *
 * Dispatches every domain event through two channels:
 * 1. `inMemory` — synchronous in-process handlers (always fires, primary path)
 * 2. `publisher` — cross-process BullMQ queue (best-effort, errors swallowed)
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
    } catch {
      // Swallow BullMQ errors — do NOT propagate to callers.
      // In production this would write to a structured logger (e.g., pino).
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
    } catch {
      // Swallow BullMQ errors — do NOT propagate to callers.
    }
  }
}
