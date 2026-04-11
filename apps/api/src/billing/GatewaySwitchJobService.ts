/**
 * @file GatewaySwitchJobService.ts
 * @description Manages BullMQ jobs for the gateway switch lifecycle.
 *   Enqueues reminder (24h) and suspend (48h) delayed jobs,
 *   and supports cancellation and rescheduling.
 * @layer infrastructure
 */

import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

const ONE_HOUR_MS = 60 * 60 * 1000;

const JOBS = {
  REMINDER: (accountId: string) => `gateway-switch-reminder-${accountId}`,
  SUSPEND: (accountId: string) => `gateway-switch-suspend-${accountId}`,
};

interface SwitchJobData {
  accountId: string;
  switchEventId: string;
  type: "REMINDER" | "SUSPEND";
}

export class GatewaySwitchJobService {
  private queue: Queue<SwitchJobData>;

  constructor(redisConnection: Redis) {
    this.queue = new Queue<SwitchJobData>(QUEUE_NAMES.GATEWAY_SWITCH, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: "exponential", delay: 30000 },
      },
    });
  }

  /**
   * @method startCheckoutWindow
   * @description Enqueues a reminder job (24h) and a suspend job (48h).
   */
  async startCheckoutWindow(accountId: string, switchEventId: string): Promise<void> {
    await Promise.all([
      this.queue.add(
        JOBS.REMINDER(accountId),
        { accountId, switchEventId, type: "REMINDER" },
        {
          delay: 24 * ONE_HOUR_MS,
          jobId: JOBS.REMINDER(accountId),
          removeOnComplete: true,
        }
      ),
      this.queue.add(
        JOBS.SUSPEND(accountId),
        { accountId, switchEventId, type: "SUSPEND" },
        {
          delay: 48 * ONE_HOUR_MS,
          jobId: JOBS.SUSPEND(accountId),
          removeOnComplete: true,
        }
      ),
    ]);
  }

  /**
   * @method cancelJobs
   * @description Cancels both reminder and suspend jobs for an account.
   */
  async cancelJobs(accountId: string): Promise<void> {
    const [reminder, suspend] = await Promise.all([
      this.queue.getJob(JOBS.REMINDER(accountId)),
      this.queue.getJob(JOBS.SUSPEND(accountId)),
    ]);
    await Promise.allSettled([reminder?.remove(), suspend?.remove()]);
  }

  /**
   * @method rescheduleJobs
   * @description Cancels existing jobs and creates new ones with recalculated delays.
   */
  async rescheduleJobs(accountId: string, newDeadline: Date): Promise<void> {
    const now = Date.now();
    const deadlineMs = newDeadline.getTime();

    await this.cancelJobs(accountId);

    // Get the switch event ID from the existing event
    const reminderDelay = Math.max(deadlineMs - 24 * ONE_HOUR_MS - now, ONE_HOUR_MS);
    const suspendDelay = Math.max(deadlineMs - now, 2 * ONE_HOUR_MS);

    await Promise.all([
      this.queue.add(
        JOBS.REMINDER(accountId),
        { accountId, switchEventId: "", type: "REMINDER" },
        {
          delay: reminderDelay,
          jobId: JOBS.REMINDER(accountId),
          removeOnComplete: true,
        }
      ),
      this.queue.add(
        JOBS.SUSPEND(accountId),
        { accountId, switchEventId: "", type: "SUSPEND" },
        {
          delay: suspendDelay,
          jobId: JOBS.SUSPEND(accountId),
          removeOnComplete: true,
        }
      ),
    ]);
  }

  /**
   * @method close
   * @description Gracefully close the queue connection.
   */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
