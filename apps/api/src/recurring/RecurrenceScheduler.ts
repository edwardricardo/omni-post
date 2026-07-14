/**
 * @file RecurrenceScheduler.ts
 * @description Wires the recurring-post pipeline into the API process via
 *              `BackgroundTaskScheduler`. On each tick:
 *              (1) ProcessRecurrenceUseCase advances every recurrence whose
 *              `nextScheduledAt <= now`, (2) for each due result, this
 *              service invokes CreatePostFromRecurrenceUseCase to clone +
 *              schedule the resulting Post.
 *
 *              Inline post creation (no intermediate queue). The
 *              `RECURRING_POSTS` queue constant remains unused; if tick
 *              latency or fan-out grows, the implementation can be
 *              promoted to BullMQ job schedulers later.
 * @layer infrastructure
 */

import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { Logger } from "pino";
import type { ProcessRecurrenceUseCase } from "@core/recurring/ProcessRecurrenceUseCase.js";
import type { CreatePostFromRecurrenceUseCase } from "@core/recurring/CreatePostFromRecurrenceUseCase.js";
import { withSystemContext } from "../security/tenantContext.js";

/** Tick interval. 60 s matches typical CMS competitor cadence (Buffer/Hootsuite). */
const TICK_INTERVAL_MS = 60_000;

/** Stable task ID for the BackgroundTaskScheduler registry. */
export const RECURRENCE_SCHEDULER_TASK_ID = "recurring-posts-tick";

export class RecurrenceScheduler {
  constructor(
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly processRecurrenceUseCase: ProcessRecurrenceUseCase,
    private readonly createPostFromRecurrenceUseCase: CreatePostFromRecurrenceUseCase,
    private readonly logger: Logger
  ) {}

  /**
   * @method start
   * @description Registers the recurrence tick with the shared scheduler.
   *              Idempotent — the underlying scheduler de-duplicates by
   *              task ID. Call once during bootstrap.
   */
  start(): void {
    this.scheduler.register(
      RECURRENCE_SCHEDULER_TASK_ID,
      async () => {
        await this.tick();
      },
      TICK_INTERVAL_MS,
      {
        onError: (error: unknown) => {
          this.logger.error({ err: error }, "RecurrenceScheduler tick failed — skipping this run");
        },
      }
    );
    this.logger.info(
      { taskId: RECURRENCE_SCHEDULER_TASK_ID, intervalMs: TICK_INTERVAL_MS },
      "RecurrenceScheduler started"
    );
  }

  /**
   * @method stop
   * @description Unregisters the tick — used on graceful shutdown so the
   *              scheduler can drain in-flight callbacks.
   */
  stop(): void {
    this.scheduler.unregister(RECURRENCE_SCHEDULER_TASK_ID);
  }

  /**
   * Single tick body — exported as a method so tests can fire it directly
   * via the noop scheduler's `triggerTask` instead of waiting on real time.
   */
  async tick(): Promise<void> {
    // The sweep is a system-level, cross-account job: `findActiveByNextScheduled`
    // is cross-account by design and every enrolled-model read/write it triggers
    // (RecurringPost round-trips) runs outside any customer request. Without an
    // explicit context the guard flip would throw TenantContextMissingError on
    // every tick. NOTE: the template-clone exfil is closed at CREATE (D3
    // ownership checks), NOT by this wrap — the wrap only declares the context.
    await withSystemContext("recurrence-sweep", async () => {
      const result = await this.processRecurrenceUseCase.execute({});
      if (!result.ok) {
        this.logger.warn(
          { err: result.error },
          "ProcessRecurrenceUseCase returned error — skipping post creation"
        );
        return;
      }

      const { processed } = result.value;
      if (processed.length === 0) return;

      this.logger.info(
        { dueCount: processed.length },
        "Recurrences due — creating + scheduling posts"
      );

      let created = 0;
      let failed = 0;
      for (const recurrence of processed) {
        const createResult = await this.createPostFromRecurrenceUseCase.execute({
          recurringPostId: recurrence.recurringPostId,
          templatePostId: recurrence.templatePostId,
          projectId: recurrence.projectId,
          channels: recurrence.channels,
          dueAt: recurrence.dueAt,
          contentVariation: recurrence.contentVariation,
        });

        if (createResult.ok) {
          created++;
        } else {
          failed++;
          this.logger.warn(
            {
              recurringPostId: recurrence.recurringPostId,
              err: createResult.error,
            },
            "Failed to create + schedule post from recurrence"
          );
        }
      }

      this.logger.info({ created, failed }, "Recurrence tick complete");
    });
  }
}
