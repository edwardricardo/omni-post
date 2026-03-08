/**
 * Domain Layer - Outbox Writer Port
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Defines the contract for writing domain events to the transactional outbox.
 * The outbox guarantees at-least-once delivery of domain events.
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
