/**
 * Infrastructure Layer - Integration Event Handler Interface
 *
 * Part of P2-2: Integration Events via BullMQ
 * Contract for handlers that process integration events consumed from the queue.
 * Each handler declares which event types it handles and provides a `handle()` method.
 */

import type { IntegrationEvent } from "./IntegrationEvent.js";

/**
 * Handler for a specific type (or set of types) of integration event.
 *
 * Handlers are registered with `IntegrationEventConsumer` at startup.
 * Multiple handlers may handle the same event type — all will be invoked in parallel.
 */
export interface IntegrationEventHandler {
  /**
   * Event types this handler processes.
   * Example: ["PostCreated", "PostPublished"]
   * An empty array means the handler processes no events (safe no-op).
   */
  readonly eventTypes: readonly string[];

  /**
   * Process an integration event.
   *
   * Implementations must be idempotent where possible — the outbox relay
   * may deliver the same event more than once under failure conditions.
   * BullMQ's jobId dedup reduces (but does not eliminate) duplicate delivery.
   *
   * @param event - The integration event to process
   */
  handle(event: IntegrationEvent): Promise<void>;
}
