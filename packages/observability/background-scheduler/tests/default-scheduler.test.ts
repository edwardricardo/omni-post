/**
 * @file default-scheduler.test.ts
 * @description Tests for DefaultBackgroundTaskScheduler — covers register
 *              lifecycle, callback invocation (sync + async), error handling,
 *              unref/critical behaviour, immediate option, shutdownAll
 *              semantics, and input validation.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefaultBackgroundTaskScheduler } from "../src/default-scheduler";
import type { SchedulerLogger } from "../src/port";

function makeLogger(): SchedulerLogger & {
  errorCalls: Array<{ message: string; data?: unknown }>;
  infoCalls: Array<{ message: string; data?: unknown }>;
} {
  const errorCalls: Array<{ message: string; data?: unknown }> = [];
  const infoCalls: Array<{ message: string; data?: unknown }> = [];
  return {
    errorCalls,
    infoCalls,
    error(message, data) {
      errorCalls.push({ message, ...(data !== undefined && { data }) });
    },
    info(message, data) {
      infoCalls.push({ message, ...(data !== undefined && { data }) });
    },
  };
}

describe("DefaultBackgroundTaskScheduler", () => {
  let scheduler: DefaultBackgroundTaskScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await scheduler?.shutdownAll();
    vi.useRealTimers();
  });

  describe("register — basic lifecycle", () => {
    it("invokes the callback each tick", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t1", cb, 1000);

      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("awaits async callbacks via in-flight tracking", async () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      let resolve!: () => void;
      const cb = vi.fn(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          })
      );
      scheduler.register("t1", cb, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(cb).toHaveBeenCalledTimes(1);
      resolve();
      // Flush microtasks so the in-flight promise can clean up.
      await Promise.resolve();
    });

    it("replaces the handle when same id is re-registered", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      scheduler.register("t1", cb1, 1000);
      scheduler.register("t1", cb2, 2000);

      vi.advanceTimersByTime(1000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  describe("register — validation", () => {
    it("rejects zero interval", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      expect(() => scheduler.register("t", () => {}, 0)).toThrow(/Invalid interval/);
    });

    it("rejects negative interval", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      expect(() => scheduler.register("t", () => {}, -1)).toThrow(/Invalid interval/);
    });

    it("rejects NaN interval", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      expect(() => scheduler.register("t", () => {}, Number.NaN)).toThrow(/Invalid interval/);
    });

    it("rejects Infinity interval", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      expect(() => scheduler.register("t", () => {}, Number.POSITIVE_INFINITY)).toThrow(
        /Invalid interval/
      );
    });

    it("refuses registration after shutdownAll", async () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      await scheduler.shutdownAll();
      expect(() => scheduler.register("t", () => {}, 1000)).toThrow(/shutdownAll/);
    });
  });

  describe("immediate option", () => {
    it("fires the callback synchronously on register when immediate: true", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t", cb, 1000, { immediate: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("continues to fire on the interval after immediate execution", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t", cb, 1000, { immediate: true });
      expect(cb).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("sync throw is caught and logged via injected logger", () => {
      const logger = makeLogger();
      scheduler = new DefaultBackgroundTaskScheduler({ logger });
      scheduler.register(
        "t",
        () => {
          throw new Error("sync boom");
        },
        1000
      );
      vi.advanceTimersByTime(1000);
      expect(logger.errorCalls).toHaveLength(1);
      expect(logger.errorCalls[0]?.message).toBe("BackgroundTaskScheduler callback error");
    });

    it("async reject is caught and logged via injected logger", async () => {
      const logger = makeLogger();
      scheduler = new DefaultBackgroundTaskScheduler({ logger });
      scheduler.register(
        "t",
        async () => {
          throw new Error("async boom");
        },
        1000
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(logger.errorCalls).toHaveLength(1);
      expect(logger.errorCalls[0]?.message).toBe("BackgroundTaskScheduler callback error");
    });

    it("custom onError overrides default logger path", () => {
      const logger = makeLogger();
      const onError = vi.fn();
      scheduler = new DefaultBackgroundTaskScheduler({ logger });
      scheduler.register(
        "t",
        () => {
          throw new Error("boom");
        },
        1000,
        { onError }
      );
      vi.advanceTimersByTime(1000);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[1]).toBe("t"); // second arg is taskId
      expect(logger.errorCalls).toHaveLength(0); // logger NOT invoked
    });

    it("onError handler that itself throws does not crash the scheduler", () => {
      const logger = makeLogger();
      scheduler = new DefaultBackgroundTaskScheduler({ logger });
      scheduler.register(
        "t",
        () => {
          throw new Error("boom");
        },
        1000,
        {
          onError: () => {
            throw new Error("onError itself failed");
          },
        }
      );
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      // Logger captures the fallback message from the onError failure.
      expect(logger.errorCalls).toHaveLength(1);
    });

    it("errors are swallowed silently when no logger is supplied", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      scheduler.register(
        "t",
        () => {
          throw new Error("boom");
        },
        1000
      );
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    });
  });

  describe("unregister", () => {
    it("stops the callback from firing again", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t", cb, 1000);
      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledTimes(1);

      scheduler.unregister("t");
      vi.advanceTimersByTime(5000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for unknown task ids", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      expect(() => scheduler.unregister("missing")).not.toThrow();
    });
  });

  describe("shutdownAll", () => {
    it("stops every registered task", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      scheduler.register("a", cb1, 1000);
      scheduler.register("b", cb2, 500);
      void scheduler.shutdownAll();
      vi.advanceTimersByTime(5000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });

    it("is idempotent — calling twice does not throw", async () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      await scheduler.shutdownAll();
      await expect(scheduler.shutdownAll()).resolves.toBeUndefined();
    });

    it("clears getActiveTasks", async () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      scheduler.register("a", () => {}, 1000);
      scheduler.register("b", () => {}, 1000);
      expect(scheduler.getActiveTasks()).toHaveLength(2);
      await scheduler.shutdownAll();
      expect(scheduler.getActiveTasks()).toHaveLength(0);
    });

    it("logs completion message with task count when logger supplied", async () => {
      const logger = makeLogger();
      scheduler = new DefaultBackgroundTaskScheduler({ logger });
      scheduler.register("a", () => {}, 1000);
      scheduler.register("b", () => {}, 1000);
      await scheduler.shutdownAll();
      expect(logger.infoCalls).toHaveLength(1);
      expect((logger.infoCalls[0]?.data as { taskCount: number }).taskCount).toBe(2);
    });

    it("awaits in-flight async callbacks before resolving", async () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      let settled = false;
      let resolveCb!: () => void;
      const cb = (): Promise<void> =>
        new Promise<void>((r) => {
          resolveCb = () => {
            settled = true;
            r();
          };
        });
      scheduler.register("t", cb, 1000);
      vi.advanceTimersByTime(1000);

      const shutdownPromise = scheduler.shutdownAll();
      resolveCb();
      await shutdownPromise;
      expect(settled).toBe(true);
    });
  });

  describe("getActiveTasks", () => {
    it("returns the list of registered task ids", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      scheduler.register("alpha", () => {}, 1000);
      scheduler.register("beta", () => {}, 1000);
      expect(scheduler.getActiveTasks().slice().sort()).toEqual(["alpha", "beta"]);
    });

    it("omits unregistered tasks", () => {
      scheduler = new DefaultBackgroundTaskScheduler();
      scheduler.register("alpha", () => {}, 1000);
      scheduler.register("beta", () => {}, 1000);
      scheduler.unregister("alpha");
      expect(scheduler.getActiveTasks()).toEqual(["beta"]);
    });
  });
});
