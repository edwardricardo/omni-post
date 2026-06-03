/**
 * @file OutboxCleaner.ts
 * @description Outbox cleaner that periodically removes old published events from the
 *              OutboxEvent table to prevent unbounded table growth. Runs via the
 *              centralised BackgroundTaskScheduler; callers drive lifecycle with
 *              `start()` / `stop()`.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

/**
 * Runs hourly to delete outbox events older than retentionDays that have
 * already been published. Prevents unbounded table growth over time.
 */
export class OutboxCleaner {
  private readonly taskId = "outbox-cleaner";
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly retentionDays: number = 7
  ) {}

  /** Start the hourly cleanup task. Idempotent. */
  start(): void {
    if (this.running) return;
    this.scheduler.register(this.taskId, () => this.clean().then(() => undefined), 60 * 60 * 1000);
    this.running = true;
  }

  /** Stop the cleanup task. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.scheduler.unregister(this.taskId);
    this.running = false;
  }

  /** Returns true if the cleaner is currently scheduled. */
  get isRunning(): boolean {
    return this.running;
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
