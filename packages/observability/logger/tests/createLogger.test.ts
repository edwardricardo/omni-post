/**
 * @file createLogger.test.ts
 * @description Tests for the shared logger factory: verifies name namespacing,
 *              isolated per-instance bindings, and the regression that
 *              repeated createLogger() calls do NOT accumulate one process
 *              `exit` listener each (the cause of the spurious
 *              MaxListenersExceededWarning in the publish worker).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { createLogger } from "../src/index.js";

describe("createLogger", () => {
  it("binds the given name onto the logger", () => {
    const log = createLogger("my-feature");

    expect(log.bindings().name).toBe("my-feature");
  });

  it("isolates bindings per logger instance", () => {
    const a = createLogger("alpha");
    const b = createLogger("beta");

    expect(a.bindings().name).toBe("alpha");
    expect(b.bindings().name).toBe("beta");
  });

  it("does not add a process 'exit' listener per call (regression: MaxListenersExceededWarning)", () => {
    // The shared base logger (one transport, one exit listener) is created
    // once at module import — already accounted for in `before`. Each
    // createLogger() must return a child that reuses that transport and
    // therefore adds zero further process listeners.
    const before = process.listenerCount("exit");

    for (let i = 0; i < 50; i++) {
      createLogger(`logger-${i}`);
    }

    expect(process.listenerCount("exit")).toBe(before);
  });
});
