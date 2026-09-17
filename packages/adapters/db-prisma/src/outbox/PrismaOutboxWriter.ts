/**
 * @file PrismaOutboxWriter.ts
 * @description Outbox writer that persists domain events to the OutboxEvent table
 *              within a Prisma transaction for transactional event publishing.
 *
 *              When `tx` is falsy the adapter self-resolves the active transaction
 *              client from `PrismaUnitOfWork.getTransactionClient()` (AsyncLocalStorage).
 *              This keeps the application layer (ConfirmBulkScheduleUseCase) free of
 *              infrastructure imports while guaranteeing the outbox write is always
 *              part of the enclosing UoW transaction.
 * @layer infrastructure
 */

import type { Prisma } from "@infra/prisma";
import type { DomainEvent } from "@core/domain/events/DomainEvent.js";
import type { OutboxWriter } from "@core/domain/repositories/OutboxWriter.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";

type TxClient = Prisma.TransactionClient;

/**
 * Prisma adapter for OutboxWriter port.
 * Persists domain events in the OutboxEvent table atomically within
 * the same transaction as aggregate state changes.
 *
 * Resolution priority for the transaction client:
 *   1. Explicit `tx` argument (non-null) — callers that hold the client directly.
 *   2. `PrismaUnitOfWork.getTransactionClient()` — active UoW via AsyncLocalStorage.
 *   3. Neither — throws to surface misconfiguration rather than silently omitting events.
 */
export class PrismaOutboxWriter implements OutboxWriter {
  /**
   * @method writeEvents
   * @description Persist N domain events into OutboxEvent rows. Resolves the
   *   active transaction client from the argument or from the UoW AsyncLocalStorage.
   *   Throws if neither is available.
   * @param tx - Explicit transaction client, or undefined/null to auto-resolve.
   * @param events - Domain events to persist.
   */
  async writeEvents(tx: unknown, events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Resolve the transaction client: explicit arg takes precedence; fall back to
    // the UoW AsyncLocalStorage so use cases never need to import the infra UoW class.
    const resolvedTx: TxClient | undefined =
      tx != null ? (tx as TxClient) : PrismaUnitOfWork.getTransactionClient();

    if (!resolvedTx) {
      throw new Error(
        "PrismaOutboxWriter.writeEvents: no active transaction client. " +
          "Call writeEvents inside a UoW transaction (executeInTransaction) or pass an explicit tx."
      );
    }

    await resolvedTx.outboxEvent.createMany({
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
