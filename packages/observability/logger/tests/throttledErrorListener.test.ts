/**
 * @file throttledErrorListener.test.ts
 * @description Tests for the throttled connection-error listener: the first error is logged at
 *              once, the errors inside the window are held back, and the first error after the
 *              window is logged with the count held back. The clock is faked, never waited on.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CONNECTION_ERROR_LOG_WINDOW_MS,
  createThrottledErrorListener,
  type ErrorLogSink,
} from "../src/index.js";

const CONNECTION = "redis:test-connection";

function makeSink(): ErrorLogSink & { error: ReturnType<typeof vi.fn> } {
  return { error: vi.fn() };
}

describe("createThrottledErrorListener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs the first error at once with the error under err and the connection's name", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");

    listener(error);

    expect(sink.error.mock.calls).toEqual([
      [{ err: error, connection: CONNECTION, suppressed: 0 }, "Connection error"],
    ]);
  });

  it("holds back every further error inside the window", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("first"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS - 1);
    listener(new Error("second"));
    listener(new Error("third"));

    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  it("logs one line with the count it held back once the window has passed", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    const afterWindow = new Error("after the window");

    listener(new Error("first"));
    listener(new Error("held back 1"));
    listener(new Error("held back 2"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(afterWindow);

    expect(sink.error.mock.calls[1]).toEqual([
      { err: afterWindow, connection: CONNECTION, suppressed: 2 },
      "Connection error",
    ]);
  });
});
