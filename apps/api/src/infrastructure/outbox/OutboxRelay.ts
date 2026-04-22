/**
 * @file OutboxRelay.ts
 * @description Outbox relay that polls the OutboxEvent table for unpublished events
 *              and dispatches them via EventDispatcher with at-least-once delivery.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { EventDispatcher, DomainEvent } from "../../domain/events/DomainEvent.js";

export interface OutboxRelayOptions {
  prisma: PrismaClient;
  eventDispatcher: EventDispatcher;
  scheduler: BackgroundTaskScheduler;
  pollIntervalMs?: number;
  batchSize?: number;
}

/**
 * Polls the outbox table and dispatches unpublished domain events.
 * Uses exponential backoff for failed dispatches and stops after maxRetries.
 */
export class OutboxRelay {
  private readonly taskId = "outbox-relay";
  private scheduled = false;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
  }

  /** Start polling the outbox table on a fixed interval. Idempotent. */
  start(): void {
    if (this.scheduled) return;
    this.options.scheduler.register(this.taskId, () => this.poll(), this.pollIntervalMs);
    this.scheduled = true;
  }

  /** Stop the polling task. Idempotent. */
  stop(): void {
    if (!this.scheduled) return;
    this.options.scheduler.unregister(this.taskId);
    this.scheduled = false;
  }

  /** Returns true if the relay is currently scheduled. */
  get isRunning(): boolean {
    return this.scheduled;
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
        } catch (error) {
          const newRetryCount = row.retryCount + 1;
          if (newRetryCount >= 5) {
            // Move to dead letter — event exhausted all retries
            await this.options.prisma.outboxDeadLetter.create({
              data: {
                originalEventId: row.id,
                eventType: row.eventType,
                aggregateId: row.aggregateId,
                payload: row.payload as object,
                failureReason: error instanceof Error ? error.message : "Max retries exhausted",
                retryCount: newRetryCount,
                firstFailedAt: row.createdAt,
              },
            });
            // Mark as terminal — prevents future relay attempts
            await this.options.prisma.outboxEvent.update({
              where: { id: row.id },
              data: { publishedAt: new Date() },
            });
          } else {
            const nextRetryMs = Math.pow(2, newRetryCount) * 1000;
            await this.options.prisma.outboxEvent.update({
              where: { id: row.id },
              data: {
                retryCount: newRetryCount,
                nextRetryAt: new Date(Date.now() + nextRetryMs),
              },
            });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
