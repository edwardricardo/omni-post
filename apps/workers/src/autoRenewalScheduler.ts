/**
 * @file autoRenewalScheduler.ts
 * @description Declares the daily auto-renewal recurring job via the BullMQ
 *              Job Scheduler API. `upsertJobScheduler` is idempotent by
 *              scheduler id, so re-running it on every worker boot keeps
 *              exactly one schedule with no manual de-duplication. Kept free
 *              of module-load side effects so it is unit-testable in
 *              isolation from the worker process wiring.
 * @layer infrastructure
 */

import type { JobSchedulerTemplateOptions, RepeatOptions } from "bullmq";

/** Stable scheduler id — the upsert key that guarantees a single schedule. */
export const AUTO_RENEWAL_SCHEDULER_ID = "auto-renewal-daily";

/** Job name produced by the scheduler; the worker consumes by queue, not name. */
export const AUTO_RENEWAL_JOB_NAME = "process-auto-renewals";

/** Cron pattern: every day at 02:00. `tz` makes the hour an absolute UTC time. */
export const AUTO_RENEWAL_PATTERN = "0 2 * * *";

/**
 * Minimal structural view of the queue surface this module needs. The real
 * BullMQ `Queue` satisfies it; a test double can implement it without
 * constructing Redis-backed infrastructure.
 */
export interface SchedulableQueue {
  upsertJobScheduler(
    jobSchedulerId: string,
    repeatOpts: Omit<RepeatOptions, "key">,
    jobTemplate?: { name?: string; data?: unknown; opts?: JobSchedulerTemplateOptions }
  ): Promise<unknown>;
}

/**
 * @function upsertAutoRenewalSchedule
 * @description Upserts the daily auto-renewal job scheduler. Idempotent by
 *   `AUTO_RENEWAL_SCHEDULER_ID`: calling it again (e.g. on every boot or
 *   deploy) updates the single existing schedule instead of creating a
 *   duplicate, so no prior-schedule cleanup is required.
 * @param queue - The queue the recurring job is scheduled on.
 * @returns Resolves once the scheduler is registered/updated.
 */
export async function upsertAutoRenewalSchedule(queue: SchedulableQueue): Promise<void> {
  await queue.upsertJobScheduler(
    AUTO_RENEWAL_SCHEDULER_ID,
    { pattern: AUTO_RENEWAL_PATTERN, tz: "UTC" },
    {
      name: AUTO_RENEWAL_JOB_NAME,
      data: {},
      opts: { removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } },
    }
  );
}
