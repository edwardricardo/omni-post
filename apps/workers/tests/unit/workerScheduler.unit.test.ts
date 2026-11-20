/**
 * @file workerScheduler.unit.test.ts
 * @description Pins the workers' task scheduler factory: the scheduler's `error`, `info` and
 *   `debug` reach the given logger in Pino's `(context, message)` order, with the scheduler's
 *   data under `data`, and the scheduler is built with no option but that logger.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { constructed } = vi.hoisted(() => ({
  constructed: [] as Array<{
    logger: {
      error(message: string, data?: unknown): void;
      info?(message: string, data?: unknown): void;
      debug?(message: string, data?: unknown): void;
    };
  }>,
}));

vi.mock("@observability/background-scheduler", () => ({
  DefaultBackgroundTaskScheduler: vi.fn(function MockScheduler(options: {
    logger: (typeof constructed)[number]["logger"];
  }) {
    constructed.push(options);
    return { shutdownAll: vi.fn() };
  }),
}));

const { createWorkerTaskScheduler } = await import("../../src/lib/workerScheduler.js");

function makeLogger() {
  return { error: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

describe("createWorkerTaskScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructed.length = 0;
  });

  it("passes the scheduler's error, info and debug through to the logger", () => {
    const logger = makeLogger();
    createWorkerTaskScheduler(logger);
    const schedulerLogger = constructed[0]?.logger;

    schedulerLogger?.error("task failed", { taskId: "a" });
    schedulerLogger?.info?.("task registered", { taskId: "b" });
    schedulerLogger?.debug?.("task ran", { taskId: "c" });

    expect([logger.error.mock.calls, logger.info.mock.calls, logger.debug.mock.calls]).toEqual([
      [[{ data: { taskId: "a" } }, "task failed"]],
      [[{ data: { taskId: "b" } }, "task registered"]],
      [[{ data: { taskId: "c" } }, "task ran"]],
    ]);
  });

  it("builds the scheduler with the logger adapter as its only option", () => {
    createWorkerTaskScheduler(makeLogger());

    expect(constructed.map((options) => Object.keys(options))).toEqual([["logger"]]);
  });
});
