/**
 * @file OutboxWriter.ts
 * @description Repository port for the transactional outbox — defines the contract for persisting domain events within the same database transaction as aggregate writes.
 * @layer domain
 */

import type { DomainEvent } from "../events/DomainEvent.js";

/**
 * Port for writing domain events to the transactional outbox.
 * Called within the same database transaction as aggregate persistence.
 *
 * @example
 * // Inside a repository's $transaction:
 * await outboxWriter.writeEvents(tx, aggregate.domainEvents);
 */
export interface OutboxWriter {
  /**
   * Write events to the outbox within an active transaction.
   * @param tx - The active Prisma transaction client
   * @param events - Domain events to persist
   */
  writeEvents(tx: unknown, events: readonly DomainEvent[]): Promise<void>;
}
