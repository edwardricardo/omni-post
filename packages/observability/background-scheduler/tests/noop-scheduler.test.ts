/**
 * @file noop-scheduler.test.ts
 * @description Tests for NoopBackgroundTaskScheduler — verify no real timers
 *              are scheduled, triggerTask fires callbacks on demand, metadata
 *              is preserved, and input validation parity with default impl.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { NoopBackgroundTaskScheduler } from "../src/noop-scheduler.js";

describe("NoopBackgroundTaskScheduler", () => {
  describe("register", () => {
    it("stores the task without arming a real timer", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t", cb, 1000);
      expect(scheduler.getActiveTasks()).toContain("t");
      expect(cb).not.toHaveBeenCalled();
    });

    it("rejects non-positive intervals (parity with default)", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      expect(() => scheduler.register("t", () => {}, 0)).toThrow(/Invalid interval/);
      expect(() => scheduler.register("t", () => {}, -5)).toThrow(/Invalid interval/);
      expect(() => scheduler.register("t", () => {}, Number.NaN)).toThrow(/Invalid interval/);
    });

    it("replaces existing task with same id", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      scheduler.register("t", cb1, 1000);
      scheduler.register("t", cb2, 2000);
      expect(scheduler.getActiveTasks()).toEqual(["t"]);
      const metadata = scheduler.getTaskMetadata("t");
      expect(metadata?.callback).toBe(cb2);
      expect(metadata?.intervalMs).toBe(2000);
    });
  });

  describe("triggerTask", () => {
    it("invokes the registered callback once", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t", cb, 1000);
      await scheduler.triggerTask("t");
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("awaits async callbacks", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      let resolved = false;
      scheduler.register(
        "t",
        async () => {
          await Promise.resolve();
          resolved = true;
        },
        1000
      );
      await scheduler.triggerTask("t");
      expect(resolved).toBe(true);
    });

    it("propagates errors by default", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      scheduler.register(
        "t",
        () => {
          throw new Error("boom");
        },
        1000
      );
      await expect(scheduler.triggerTask("t")).rejects.toThrow(/boom/);
    });

    it("swallows errors when swallowErrors: true is set", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      scheduler.register(
        "t",
        () => {
          throw new Error("boom");
        },
        1000
      );
      await expect(scheduler.triggerTask("t", { swallowErrors: true })).resolves.toBeUndefined();
    });

    it("invokes onError handler when configured and errors swallowed", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const onError = vi.fn();
      scheduler.register(
        "t",
        () => {
          throw new Error("boom");
        },
        1000,
        { onError }
      );
      await scheduler.triggerTask("t", { swallowErrors: true });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[1]).toBe("t");
    });

    it("throws for unknown task ids", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      await expect(scheduler.triggerTask("missing")).rejects.toThrow(/not registered/);
    });
  });

  describe("unregister and shutdownAll", () => {
    it("unregister removes the task", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      scheduler.register("t", () => {}, 1000);
      scheduler.unregister("t");
      expect(scheduler.getActiveTasks()).toHaveLength(0);
    });

    it("shutdownAll clears everything", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      scheduler.register("a", () => {}, 1000);
      scheduler.register("b", () => {}, 1000);
      await scheduler.shutdownAll();
      expect(scheduler.getActiveTasks()).toHaveLength(0);
    });
  });

  describe("getTaskMetadata", () => {
    it("exposes interval and options without firing the callback", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const cb = vi.fn();
      scheduler.register("t", cb, 5000, { immediate: true, critical: true });
      const metadata = scheduler.getTaskMetadata("t");
      expect(metadata?.intervalMs).toBe(5000);
      expect(metadata?.options?.immediate).toBe(true);
      expect(metadata?.options?.critical).toBe(true);
      expect(cb).not.toHaveBeenCalled();
    });

    it("returns undefined for unknown ids", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      expect(scheduler.getTaskMetadata("missing")).toBeUndefined();
    });
  });
});
