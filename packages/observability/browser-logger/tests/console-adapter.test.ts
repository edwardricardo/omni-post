/**
 * @file console-adapter.test.ts
 * @description Tests for the ConsoleLoggerAdapter. Covers level routing,
 *              SSR safety, child context binding, error overload parsing,
 *              and boundContext merge semantics.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConsoleLoggerAdapter } from "../src/console-adapter.js";

describe("ConsoleLoggerAdapter", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("basic level routing", () => {
    it("debug routes to console.debug", () => {
      new ConsoleLoggerAdapter("t").debug("msg");
      expect(debugSpy).toHaveBeenCalledOnce();
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("info routes to console.info", () => {
      new ConsoleLoggerAdapter("t").info("msg");
      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it("warn routes to console.warn", () => {
      new ConsoleLoggerAdapter("t").warn("msg");
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("error routes to console.error", () => {
      new ConsoleLoggerAdapter("t").error("msg");
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  describe("prefix formatting", () => {
    it("includes timestamp, level, and logger name in the prefix", () => {
      new ConsoleLoggerAdapter("MyComponent").info("hello");
      const arg = infoSpy.mock.calls[0]?.[0] as string;
      expect(arg).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[MyComponent\] hello$/
      );
    });
  });

  describe("context merge", () => {
    it("omits context arg when empty", () => {
      new ConsoleLoggerAdapter("t").info("msg");
      expect(infoSpy.mock.calls[0]?.length).toBe(1);
    });

    it("includes context when per-call data provided", () => {
      new ConsoleLoggerAdapter("t").info("msg", { userId: "u1" });
      expect(infoSpy.mock.calls[0]?.[1]).toEqual({ userId: "u1" });
    });

    it("merges bound context with per-call data (per-call wins on conflict)", () => {
      const logger = new ConsoleLoggerAdapter("t", {
        boundContext: { userId: "bound", app: "admin" },
      });
      logger.info("msg", { userId: "override" });
      expect(infoSpy.mock.calls[0]?.[1]).toEqual({ userId: "override", app: "admin" });
    });
  });

  describe("error overload", () => {
    it("accepts only a message", () => {
      new ConsoleLoggerAdapter("t").error("failed");
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.length).toBe(1);
    });

    it("accepts (message, Error)", () => {
      const err = new Error("boom");
      new ConsoleLoggerAdapter("t").error("failed", err);
      const ctx = errorSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(ctx).toHaveProperty("err");
      expect((ctx.err as { message: string }).message).toBe("boom");
    });

    it("accepts (message, Error, context)", () => {
      const err = new Error("boom");
      new ConsoleLoggerAdapter("t").error("failed", err, { requestId: "r1" });
      const ctx = errorSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(ctx).toHaveProperty("err");
      expect(ctx.requestId).toBe("r1");
    });

    it("accepts (message, context) when no Error is involved", () => {
      new ConsoleLoggerAdapter("t").error("failed", { code: "X" });
      const ctx = errorSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(ctx).toEqual({ code: "X" });
    });
  });

  describe("child", () => {
    it("returns a new instance with merged bindings", () => {
      const parent = new ConsoleLoggerAdapter("t", {
        boundContext: { app: "admin" },
      });
      const child = parent.child({ userId: "u1" });
      child.info("msg");
      expect(infoSpy.mock.calls[0]?.[1]).toEqual({ app: "admin", userId: "u1" });
    });

    it("does not mutate the parent context", () => {
      const parent = new ConsoleLoggerAdapter("t", {
        boundContext: { app: "admin" },
      });
      parent.child({ userId: "u1" });
      parent.info("msg");
      expect(infoSpy.mock.calls[0]?.[1]).toEqual({ app: "admin" });
    });
  });

  describe("SSR safety", () => {
    const originalWindow = globalThis.window;

    afterEach(() => {
      // Restore window in case a test removed it
      if (originalWindow !== undefined) {
        (globalThis as unknown as { window: unknown }).window = originalWindow;
      }
    });

    it("skips emission when window is undefined and alwaysEmit is false", () => {
      // Remove window to simulate SSR
      delete (globalThis as { window?: unknown }).window;
      new ConsoleLoggerAdapter("t").info("msg");
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("emits when alwaysEmit is true even without window", () => {
      delete (globalThis as { window?: unknown }).window;
      new ConsoleLoggerAdapter("t", { alwaysEmit: true }).info("msg");
      expect(infoSpy).toHaveBeenCalledOnce();
    });
  });

  describe("name and level accessors", () => {
    it("exposes the name and default level", () => {
      const logger = new ConsoleLoggerAdapter("my-logger");
      expect(logger.name).toBe("my-logger");
      expect(logger.level).toBe("info");
    });
  });
});
