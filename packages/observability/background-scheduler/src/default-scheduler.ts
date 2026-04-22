/**
 * @file default-scheduler.ts
 * @description Production implementation of BackgroundTaskScheduler using
 *              Node's `setInterval`. Applies `.unref()` by default so the
 *              process can exit promptly, wraps callbacks with try/catch,
 *              and tracks in-flight async callbacks to await on shutdown.
 * @layer infrastructure
 */

import type { BackgroundTaskOptions, BackgroundTaskScheduler, SchedulerLogger } from "./port";

interface RegisteredTask {
  readonly id: string;
  readonly handle: NodeJS.Timeout;
  readonly inFlight: Set<Promise<void>>;
}

/**
 * Default scheduler — real timers, error-safe, shutdown-aware.
 *
 * Construct with an optional `SchedulerLogger` to route callback errors to
 * the project's standard logging sink. When no logger is supplied, errors
 * are silently swallowed (use this mode in tests that assert on spies).
 */
export class DefaultBackgroundTaskScheduler implements BackgroundTaskScheduler {
  private readonly tasks = new Map<string, RegisteredTask>();
  private readonly logger?: SchedulerLogger;
  private isShuttingDown = false;

  constructor(options?: { logger?: SchedulerLogger }) {
    if (options?.logger !== undefined) {
      this.logger = options.logger;
    }
  }

  register(
    taskId: string,
    callback: () => void | Promise<void>,
    intervalMs: number,
    options?: BackgroundTaskOptions
  ): void {
    if (this.isShuttingDown) {
      throw new Error(`Cannot register task "${taskId}" after shutdownAll() has been initiated.`);
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        `Invalid interval ${String(intervalMs)} for task "${taskId}". Must be a positive finite number.`
      );
    }

    // Replace any existing task with the same id — no leak.
    this.unregister(taskId);

    const inFlight = new Set<Promise<void>>();
    const runOnce = (): void => {
      const promise = this.runCallbackSafely(taskId, callback, options);
      inFlight.add(promise);
      void promise.finally(() => inFlight.delete(promise));
    };

    if (options?.immediate === true) {
      runOnce();
    }

    const handle = setInterval(runOnce, intervalMs);
    if (options?.critical !== true) {
      handle.unref();
    }

    this.tasks.set(taskId, { id: taskId, handle, inFlight });
  }

  unregister(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task === undefined) return;
    clearInterval(task.handle);
    this.tasks.delete(taskId);
  }

  async shutdownAll(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    const active = Array.from(this.tasks.values());
    for (const task of active) {
      clearInterval(task.handle);
    }

    // Wait for any in-flight callback to settle so shutdown is clean.
    const pending: Promise<void>[] = [];
    for (const task of active) {
      for (const p of task.inFlight) {
        pending.push(p);
      }
    }
    await Promise.allSettled(pending);

    this.tasks.clear();
    this.logger?.info?.("BackgroundTaskScheduler shutdownAll complete", {
      taskCount: active.length,
    });
  }

  getActiveTasks(): readonly string[] {
    return Array.from(this.tasks.keys());
  }

  private async runCallbackSafely(
    taskId: string,
    callback: () => void | Promise<void>,
    options: BackgroundTaskOptions | undefined
  ): Promise<void> {
    try {
      await callback();
    } catch (err) {
      if (options?.onError !== undefined) {
        try {
          options.onError(err, taskId);
        } catch {
          // An onError handler that itself throws must not crash the scheduler.
          // Fall through to the default logger path below.
          this.logger?.error("BackgroundTaskScheduler onError handler threw", {
            taskId,
            err,
          });
        }
        return;
      }
      this.logger?.error("BackgroundTaskScheduler callback error", {
        taskId,
        err,
      });
    }
  }
}
