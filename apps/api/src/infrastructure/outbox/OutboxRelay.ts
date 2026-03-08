/**
 * Infrastructure Layer - Outbox Relay
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Background process that polls the outbox table for unpublished events
 * and dispatches them through the EventDispatcher.
 * Guarantees at-least-once delivery with exponential backoff retry.
 */

import type { PrismaClient } from "@infra/prisma";
import type { EventDispatcher, DomainEvent } from "../../domain/events/DomainEvent.js";

export interface OutboxRelayOptions {
  prisma: PrismaClient;
  eventDispatcher: EventDispatcher;
  pollIntervalMs?: number;
  batchSize?: number;
}

/**
 * Polls the outbox table and dispatches unpublished domain events.
 * Uses exponential backoff for failed dispatches and stops after maxRetries.
 */
export class OutboxRelay {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
  }

  /** Start polling the outbox table on a fixed interval. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref();
  }

  /** Stop the polling interval. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Returns true if the relay is currently polling. */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Exposed for testing — runs a single poll cycle. */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const events = await this.options.prisma.outboxEvent.findMany({
        where: {
          publishedAt: null,
          nextRetryAt: { lte: new Date() },
          retryCount: { lt: 5 },
        },
        orderBy: { occurredAt: "asc" },
        take: this.batchSize,
      });

      for (const row of events) {
        try {
          const event: DomainEvent = {
            eventId: row.id,
            eventType: row.eventType,
            aggregateId: row.aggregateId,
            aggregateType: row.aggregateType,
            occurredAt: row.occurredAt,
            version: row.version,
            metadata: { payload: row.payload, fromOutbox: true },
          };

          await this.options.eventDispatcher.dispatch(event);

          await this.options.prisma.outboxEvent.update({
            where: { id: row.id },
            data: { publishedAt: new Date() },
          });
        } catch {
          const nextRetryMs = Math.pow(2, row.retryCount + 1) * 1000;
          await this.options.prisma.outboxEvent.update({
            where: { id: row.id },
            data: {
              retryCount: row.retryCount + 1,
              nextRetryAt: new Date(Date.now() + nextRetryMs),
            },
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
