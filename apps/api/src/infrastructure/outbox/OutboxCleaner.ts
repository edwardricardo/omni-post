/**
 * @file OutboxCleaner.ts
 * @description Outbox cleaner that periodically removes old published events from the
 *              OutboxEvent table to prevent unbounded table growth.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";

/**
 * Runs hourly to delete outbox events older than retentionDays that have
 * already been published. Prevents unbounded table growth over time.
 */
export class OutboxCleaner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly retentionDays: number = 7
  ) {}

  /** Start the hourly cleanup interval. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.clean(), 60 * 60 * 1000);
    this.timer.unref();
  }

  /** Stop the cleanup interval. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Returns true if the cleaner is currently scheduled. */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Delete published outbox events older than the retention period. Returns count deleted. */
  async clean(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.outboxEvent.deleteMany({
      where: {
        publishedAt: { not: null },
        createdAt: { lt: cutoff },
      },
    });
    return result.count;
  }
}
