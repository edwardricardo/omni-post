/**
 * @file noop-scheduler.ts
 * @description Test-friendly scheduler that records registrations without
 *              arming real timers. Consumers can drive tasks manually via
 *              `triggerTask(taskId)` to assert side effects without relying
 *              on fake timers or wall-clock delays.
 * @layer infrastructure
 */

import type { BackgroundTaskOptions, BackgroundTaskScheduler } from "./port";

interface NoopTask {
  readonly id: string;
  readonly callback: () => void | Promise<void>;
  readonly intervalMs: number;
  readonly options: BackgroundTaskOptions | undefined;
}

/**
 * Scheduler implementation that never schedules.
 *
 * - `register` stores the task metadata but does not call `setInterval`.
 * - `triggerTask(id)` executes the stored callback on demand (awaits async).
 * - `shutdownAll` clears all registrations.
 *
 * Intended for unit tests that need deterministic behaviour without timers.
 */
export class NoopBackgroundTaskScheduler implements BackgroundTaskScheduler {
  private readonly tasks = new Map<string, NoopTask>();

  register(
    taskId: string,
    callback: () => void | Promise<void>,
    intervalMs: number,
    options?: BackgroundTaskOptions
  ): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(
        `Invalid interval ${String(intervalMs)} for task "${taskId}". Must be a positive finite number.`
      );
    }
    this.tasks.set(taskId, {
      id: taskId,
      callback,
      intervalMs,
      options,
    });
  }

  unregister(taskId: string): void {
    this.tasks.delete(taskId);
  }

  async shutdownAll(): Promise<void> {
    this.tasks.clear();
  }

  getActiveTasks(): readonly string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Invoke the callback for the given task exactly once. Awaits if async.
   * Errors propagate by default; pass `{ swallowErrors: true }` to emulate
   * the DefaultScheduler behaviour of logging and continuing.
   */
  async triggerTask(taskId: string, options?: { swallowErrors?: boolean }): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      throw new Error(`Task "${taskId}" is not registered.`);
    }
    try {
      await task.callback();
    } catch (err) {
      if (options?.swallowErrors === true) {
        if (task.options?.onError !== undefined) {
          task.options.onError(err, taskId);
        }
        return;
      }
      throw err;
    }
  }

  /**
   * Inspect registration metadata — useful for asserting intervals and
   * options without firing the callback.
   */
  getTaskMetadata(taskId: string): NoopTask | undefined {
    return this.tasks.get(taskId);
  }
}
