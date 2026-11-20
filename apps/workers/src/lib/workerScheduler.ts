/**
 * @file workerScheduler.ts
 * @description Builds the workers' background task scheduler with its errors and notices routed
 *              to a Pino logger. The scheduler's logger takes `(message, data)`; Pino takes
 *              `(context, message)`, so the adapter carries the data under `data`.
 * @layer infrastructure
 */
import { DefaultBackgroundTaskScheduler } from "@observability/background-scheduler";
import type { Logger } from "@observability/logger";

/**
 * @description Builds a task scheduler whose error, info and debug lines go to `logger`.
 * @param logger - The worker module's logger.
 * @returns The scheduler; its owner calls `shutdownAll()` on teardown.
 */
export function createWorkerTaskScheduler(
  logger: Pick<Logger, "error" | "info" | "debug">
): DefaultBackgroundTaskScheduler {
  return new DefaultBackgroundTaskScheduler({
    logger: {
      error: (msg, data) => logger.error({ data }, msg),
      info: (msg, data) => logger.info({ data }, msg),
      debug: (msg, data) => logger.debug({ data }, msg),
    },
  });
}
