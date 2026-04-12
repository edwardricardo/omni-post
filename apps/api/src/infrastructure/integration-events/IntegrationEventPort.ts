/**
 * @file IntegrationEventPort.ts
 * @description Port interface for publishing integration events to a message broker.
 *              Implementations: BullMQIntegrationPublisher (production), NoopPublisher (tests).
 * @layer infrastructure
 */

import type { IntegrationEvent } from "./IntegrationEvent.js";

/**
 * Port for publishing integration events to a message broker.
 *
 * This interface lives in the infrastructure layer (not domain/) because
 * integration events are an infrastructure concern — they cross process
 * boundaries via BullMQ and are not part of the domain model.
 */
export interface IntegrationEventPublisher {
  /** Publish a single integration event to the message broker */
  publish(event: IntegrationEvent): Promise<void>;

  /** Publish a batch of integration events atomically */
  publishBatch(events: readonly IntegrationEvent[]): Promise<void>;

  /** Close the publisher and release underlying broker resources */
  close(): Promise<void>;
}
