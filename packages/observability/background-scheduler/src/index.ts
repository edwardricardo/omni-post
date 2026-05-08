/**
 * @file index.ts
 * @description Public API of @observability/background-scheduler. Consumers
 *              depend on the port; the DI container wires the default
 *              implementation, and tests substitute the noop scheduler.
 * @layer infrastructure
 */

export type {
  BackgroundTaskScheduler,
  BackgroundTaskOptions,
  SchedulerLogger,
  ShutdownResult,
} from "./port";

export { DefaultBackgroundTaskScheduler } from "./default-scheduler";
export { NoopBackgroundTaskScheduler } from "./noop-scheduler";
