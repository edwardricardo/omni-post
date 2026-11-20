/**
 * @file throttledErrorListener.test.ts
 * @description Tests for the throttled error listeners: what a written line carries (never a
 *              command's arguments), the throttle per error identity with its window measured on a
 *              monotonic clock and re-anchored on each written line, the reset of the held-back
 *              count, the bound on tracked identities and the overflow bucket past it, the
 *              recovery line `flush` writes, the worker variant, and `logConnectionErrors` wiring
 *              both onto an emitter. The clock is faked, never waited on.
 * @layer infrastructure
 */
import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CONNECTION_ERROR_LOG_WINDOW_MS,
  MAX_TRACKED_ERROR_IDENTITIES,
  createThrottledErrorListener,
  createThrottledWorkerErrorListener,
  logConnectionErrors,
  type ErrorLogSink,
} from "../src/index.js";

const CONNECTION = "redis:test-connection";
const SECRET_MARKER = "MARKER-not-to-be-logged";

function makeSink(): ErrorLogSink & {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  return { error: vi.fn(), info: vi.fn() };
}

/** An error as ioredis emits it on an AUTH failure: the command and its arguments attached. */
function authFailure(): Error {
  const error = new Error("WRONGPASS invalid username-password pair");
  error.name = "ReplyError";
  return Object.assign(error, {
    code: "WRONGPASS",
    command: { name: "auth", args: [SECRET_MARKER] },
  });
}

/** The `suppressed` count of every line written so far, in order. */
function suppressedCounts(sink: ReturnType<typeof makeSink>): unknown[] {
  return sink.error.mock.calls.map(([context]) => (context as { suppressed: unknown }).suppressed);
}

describe("createThrottledErrorListener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs the first error at once with its type, message, code and stack and the connection's name", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
      code: "ECONNREFUSED",
    });

    listener(error);

    expect(sink.error.mock.calls).toEqual([
      [
        {
          err: { type: "Error", message: error.message, code: "ECONNREFUSED", stack: error.stack },
          connection: CONNECTION,
          suppressed: 0,
        },
        "Connection error",
      ],
    ]);
  });

  it("logs the name of the command an error carries and never its arguments", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(authFailure());

    const [context] = sink.error.mock.calls[0] ?? [];
    expect((context as { err: { command: unknown } }).err.command).toBe("auth");
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(SECRET_MARKER);
  });

  it("holds back a repeat of the same error inside the window", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS - 1);
    listener(new Error("same"));
    listener(new Error("same"));

    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  it("logs one line with the count it held back once the window has passed", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    listener(new Error("same"));
    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("same"));

    expect(suppressedCounts(sink)).toEqual([0, 2]);
  });

  it("resets the held-back count once a line has reported it", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("same"));
    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("same"));

    expect(suppressedCounts(sink)).toEqual([0, 1, 1]);
  });

  it("measures the window from the last written line, not from the first", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS - 1);
    listener(new Error("same"));

    expect(sink.error).toHaveBeenCalledTimes(2);
  });

  it("measures the window on a monotonic clock that a wall-clock jump does not move", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    vi.setSystemTime(Date.now() + 2 * CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("same"));

    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  it("writes a different error inside the window instead of counting it behind the first", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("connect ECONNREFUSED"));
    listener(authFailure());

    expect(
      sink.error.mock.calls.map(
        ([context]) => (context as { err: { message: unknown } }).err.message
      )
    ).toEqual(["connect ECONNREFUSED", "WRONGPASS invalid username-password pair"]);
  });

  it("past the bound of tracked identities, throttles every further identity together", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    for (let index = 0; index < MAX_TRACKED_ERROR_IDENTITIES + 5; index += 1) {
      listener(new Error(`distinct ${index}`));
    }

    expect(sink.error).toHaveBeenCalledTimes(MAX_TRACKED_ERROR_IDENTITIES + 1);
  });

  it("reports the count the overflow bucket held back once its window has passed", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    for (let index = 0; index < MAX_TRACKED_ERROR_IDENTITIES + 3; index += 1) {
      listener(new Error(`distinct ${index}`));
    }

    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("one more distinct"));

    expect(suppressedCounts(sink).at(-1)).toBe(2);
  });

  it("flush writes one recovery line with the count held back, and the next error is written at once", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    listener(new Error("same"));
    listener.flush();
    listener(new Error("same"));

    expect(sink.info.mock.calls).toEqual([
      [{ connection: CONNECTION, suppressed: 1 }, "Connection ready again"],
    ]);
    expect(suppressedCounts(sink)).toEqual([0, 0]);
  });

  it("flush writes nothing when no error came since the last flush", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener.flush();
    listener(new Error("same"));
    listener.flush();
    listener.flush();

    expect(sink.info).toHaveBeenCalledTimes(1);
  });
});

describe("createThrottledWorkerErrorListener", () => {
  it("names the worker and says the error is the worker's, not a connection's", () => {
    const sink = makeSink();
    const listener = createThrottledWorkerErrorListener(sink, "bullmq-worker:test");
    const error = new Error("Missing lock for job 1");

    listener(error);

    expect(sink.error.mock.calls).toEqual([
      [
        {
          err: { type: "Error", message: error.message, stack: error.stack },
          worker: "bullmq-worker:test",
          suppressed: 0,
        },
        "Worker error",
      ],
    ]);
  });
});

describe("logConnectionErrors", () => {
  it("throttles the emitter's errors and reports recovery when it is ready again", () => {
    const sink = makeSink();
    const connection = new EventEmitter();
    logConnectionErrors(connection, sink, CONNECTION);

    connection.emit("error", new Error("same"));
    connection.emit("error", new Error("same"));
    connection.emit("ready");

    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(sink.info.mock.calls).toEqual([
      [{ connection: CONNECTION, suppressed: 1 }, "Connection ready again"],
    ]);
  });
});
