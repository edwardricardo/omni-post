/**
 * @file PrismaOutboxWriter.ts
 * @description Outbox writer that persists domain events to the OutboxEvent table
 *              within a Prisma transaction for transactional event publishing.
 * @layer infrastructure
 */

import type { Prisma } from "@infra/prisma";
import type { DomainEvent } from "../../domain/events/DomainEvent.js";
import type { OutboxWriter } from "../../domain/repositories/OutboxWriter.js";

type TxClient = Prisma.TransactionClient;

/**
 * Prisma adapter for OutboxWriter port.
 * Persists domain events in the OutboxEvent table atomically within
 * the same transaction as aggregate state changes.
 */
export class PrismaOutboxWriter implements OutboxWriter {
  async writeEvents(tx: unknown, events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    const client = tx as TxClient;
    await client.outboxEvent.createMany({
      data: events.map((event) => ({
        id: event.eventId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        payload: ("toPayload" in event && typeof event.toPayload === "function"
          ? event.toPayload()
          : { metadata: event.metadata }) as Prisma.InputJsonValue,
        version: event.version,
        occurredAt: event.occurredAt,
      })),
    });
  }
}
