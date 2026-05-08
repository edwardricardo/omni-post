/**
 * @file port.ts
 * @description Technology-free abstraction for background task scheduling.
 *              Replaces direct `setInterval` usage across the backend with a
 *              centrally-managed registry that applies `.unref()` by default,
 *              wraps callbacks with error handling, and exposes a single
 *              `shutdownAll()` entry point for graceful termination.
 * @layer infrastructure
 */

/**
 * Minimal logger interface accepted by scheduler implementations.
 * Both the backend Pino logger and the browser logger satisfy this shape
 * structurally, so schedulers can be built against either sink without
 * depending on a concrete logger package.
 */
export interface SchedulerLogger {
  error(message: string, data?: unknown): void;
  info?(message: string, data?: unknown): void;
  debug?(message: string, data?: unknown): void;
}

/**
 * Options applied when registering a background task.
 */
export interface BackgroundTaskOptions {
  /**
   * When true, the interval handle is NOT unref'd — the process will wait for
   * the task loop to stop before exiting. Use only for tasks that genuinely
   * must complete before shutdown (rare). Default: false.
   */
  critical?: boolean;

  /**
   * Run the callback once immediately upon registration (errors are still
   * caught and reported), then continue on the normal interval cadence.
   * Default: false.
   */
  immediate?: boolean;

  /**
   * Custom error handler invoked when the callback throws or rejects. When
   * omitted, the scheduler logs via its injected `SchedulerLogger`.
   */
  onError?: (err: unknown, taskId: string) => void;
}

/**
 * Result of a shutdown attempt.
 */
export interface ShutdownResult {
  /** Number of tasks that were registered when shutdown started. */
  taskCount: number;
  /** Number of in-flight async callbacks that completed before shutdown returned. */
  drained: number;
  /** Number that did NOT complete because the timeout fired. */
  pending: number;
  /** Whether the shutdown deadline was hit. */
  timedOut: boolean;
}

/**
 * Scheduler port — registers, cancels, and tears down recurring tasks.
 * Implementations decide how to actually execute the schedule (real timers,
 * noop for tests, future APM-instrumented variants).
 */
export interface BackgroundTaskScheduler {
  /**
   * Register a recurring task. If `taskId` is already registered, the existing
   * handle is cleared and replaced (no leak).
   *
   * @param taskId - Stable identifier (used for unregister + logs).
   * @param callback - Work to perform every tick. Sync or async; errors caught.
   * @param intervalMs - Interval between ticks in milliseconds.
   * @param options - Optional critical/immediate/onError configuration.
   */
  register(
    taskId: string,
    callback: () => void | Promise<void>,
    intervalMs: number,
    options?: BackgroundTaskOptions
  ): void;

  /**
   * Stop a single registered task. No-op if `taskId` is not registered.
   */
  unregister(taskId: string): void;

  /**
   * Cancel every registered task and clear internal state. Intended for
   * SIGTERM/SIGINT handlers. Idempotent.
   *
   * Waits up to `timeoutMs` for in-flight async callbacks to settle so the
   * process exits cleanly. Default 10000ms keeps shutdown well under typical
   * Kubernetes grace periods (30s) so a hanging callback can't deadlock the
   * pod past its terminationGracePeriod.
   *
   * Pattern: Agenda's `drain(timeoutMs)` — timeout-bounded graceful drain
   * that reports how many tasks finished vs were left hanging.
   */
  shutdownAll(timeoutMs?: number): Promise<ShutdownResult>;

  /**
   * Snapshot of currently-registered task identifiers — useful for diagnostics
   * and health endpoints.
   */
  getActiveTasks(): readonly string[];
}
