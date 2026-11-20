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
  MAX_NESTED_DEPTH,
  MAX_NESTED_ERRORS,
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

  it("carries what expired windows held back, the overflow's included, to the recovery line", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    for (let index = 0; index < MAX_TRACKED_ERROR_IDENTITIES + 3; index += 1) {
      listener(new Error(`distinct ${index}`));
    }

    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener.flush();

    expect(sink.info.mock.calls).toEqual([
      [
        { connection: CONNECTION, suppressed: 0, suppressedByExpiredWindows: 2 },
        "Connection ready again",
      ],
    ]);
  });

  it("carries an expired window's count to the next error line once, on a source nothing flushes", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("job 1 lost its lock"));
    listener(new Error("job 1 lost its lock"));
    listener(new Error("job 1 lost its lock"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("job 2 lost its lock"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("job 3 lost its lock"));

    expect(sink.error.mock.calls.map(([context]) => context)).toEqual([
      expect.objectContaining({ suppressed: 0 }),
      expect.objectContaining({ suppressed: 0, suppressedByExpiredWindows: 2 }),
      expect.not.objectContaining({ suppressedByExpiredWindows: expect.anything() }),
    ]);
  });

  it("carries the overflow window's count to an error line once that window has expired", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    const tracked = Array.from(
      { length: MAX_TRACKED_ERROR_IDENTITIES },
      (_, index) => `tracked ${index}`
    );
    for (const message of tracked) {
      listener(new Error(message));
    }
    vi.advanceTimersByTime(1);
    listener(new Error("overflow 1"));
    listener(new Error("overflow 2"));
    listener(new Error("overflow 3"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS - 1);
    for (const message of tracked) {
      listener(new Error(message));
    }
    vi.advanceTimersByTime(1);

    listener(new Error("overflow 4"));

    expect(sink.error.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ suppressed: 0, suppressedByExpiredWindows: 2 })
    );
  });

  it("writes a recovery line after every written error line, so a healthy source never ends on an error", () => {
    const written: string[] = [];
    const sink = {
      error: vi.fn((_context: Record<string, unknown>, message: string) => written.push(message)),
      info: vi.fn((_context: Record<string, unknown>, message: string) => written.push(message)),
    };
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
    vi.advanceTimersByTime(1_000);
    listener.flush();
    vi.advanceTimersByTime(29_000);
    listener(new Error("READONLY You can't write against a read only replica."));
    vi.advanceTimersByTime(1_000);
    listener.flush();

    expect(written).toEqual([
      "Connection error",
      "Connection ready again",
      "Connection error",
      "Connection ready again",
    ]);
  });

  it("drops an identity whose window has expired, so the bound counts only live windows", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    for (let round = 0; round < 3; round += 1) {
      for (let index = 0; index < MAX_TRACKED_ERROR_IDENTITIES; index += 1) {
        listener(new Error(`job ${round}-${index} lost its lock`));
      }
      vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    }

    expect(sink.error).toHaveBeenCalledTimes(3 * MAX_TRACKED_ERROR_IDENTITIES);
  });

  it("flush reports the count held back and keeps the window, so the same error inside it stays held", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);

    listener(new Error("same"));
    listener(new Error("same"));
    listener.flush();
    listener(new Error("same"));
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("same"));

    expect(sink.info.mock.calls).toEqual([
      [{ connection: CONNECTION, suppressed: 1 }, "Connection ready again"],
    ]);
    expect(suppressedCounts(sink)).toEqual([0, 1]);
  });

  it("a connection that flaps N times inside one window writes one error line and one recovery line", () => {
    const sink = makeSink();
    const listener = createThrottledErrorListener(sink, CONNECTION);
    const cycles = 10;

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      listener(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
      listener.flush();
      vi.advanceTimersByTime(1_000);
    }
    const linesInsideTheWindow = sink.error.mock.calls.length + sink.info.mock.calls.length;
    vi.advanceTimersByTime(CONNECTION_ERROR_LOG_WINDOW_MS);
    listener(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
    listener.flush();

    expect(linesInsideTheWindow).toBe(2);
    expect([suppressedCounts(sink), sink.info.mock.calls.length]).toEqual([[0, cycles - 1], 2]);
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

describe("the error a line describes", () => {
  /** A socket error as Node raises it when a connection is refused. */
  function refused(address: string): Error {
    return Object.assign(new Error(`connect ECONNREFUSED ${address}:6379`), {
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
      address,
      port: 6379,
    });
  }

  /** The `err` of the first line written. */
  function firstErr(sink: ReturnType<typeof makeSink>): Record<string, unknown> {
    const [context] = sink.error.mock.calls[0] ?? [];
    return (context as { err: Record<string, unknown> }).err;
  }

  it("keeps the socket diagnostics: errno, syscall, address and port", () => {
    const sink = makeSink();
    const error = refused("127.0.0.1");

    createThrottledErrorListener(sink, CONNECTION)(error);

    expect(firstErr(sink)).toEqual({
      type: "Error",
      message: error.message,
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
      address: "127.0.0.1",
      port: 6379,
      stack: error.stack,
    });
  });

  it("copies no field outside the allow-list", () => {
    const sink = makeSink();
    const error = Object.assign(new Error("boom"), { internalNote: SECRET_MARKER });

    createThrottledErrorListener(sink, CONNECTION)(error);

    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(SECRET_MARKER);
  });

  it("describes each nested error of an AggregateError the same way", () => {
    const sink = makeSink();
    const error = new AggregateError([refused("::1"), refused("127.0.0.1")], "");

    createThrottledErrorListener(sink, CONNECTION)(error);

    expect(
      (firstErr(sink).nestedErrors as Array<Record<string, unknown>>).map(
        ({ address, port, syscall }) => ({ address, port, syscall })
      )
    ).toEqual([
      { address: "::1", port: 6379, syscall: "connect" },
      { address: "127.0.0.1", port: 6379, syscall: "connect" },
    ]);
  });

  it("never writes a nested error's command arguments", () => {
    const sink = makeSink();

    createThrottledErrorListener(sink, CONNECTION)(new AggregateError([authFailure()], "failed"));

    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(SECRET_MARKER);
    expect((firstErr(sink).nestedErrors as Array<{ command: unknown }>)[0]?.command).toBe("auth");
  });

  it(`describes at most ${MAX_NESTED_ERRORS} nested errors per level and counts the rest`, () => {
    const sink = makeSink();
    const nested = Array.from({ length: MAX_NESTED_ERRORS + 2 }, (_, index) =>
      refused(`10.0.0.${index}`)
    );

    createThrottledErrorListener(sink, CONNECTION)(new AggregateError(nested, ""));

    const err = firstErr(sink);
    expect([(err.nestedErrors as unknown[]).length, err.nestedErrorsOmitted]).toEqual([
      MAX_NESTED_ERRORS,
      2,
    ]);
  });

  it(`describes nested errors down to ${MAX_NESTED_DEPTH} levels and counts what lies deeper`, () => {
    const sink = makeSink();
    const deepest = new AggregateError([refused("10.0.0.9")], "level 2");
    const error = new AggregateError([new AggregateError([deepest], "level 1")], "level 0");

    createThrottledErrorListener(sink, CONNECTION)(error);

    const level1 = (firstErr(sink).nestedErrors as Array<Record<string, unknown>>)[0];
    const level2 = (level1?.nestedErrors as Array<Record<string, unknown>> | undefined)?.[0];
    expect([level2?.message, level2?.nestedErrors, level2?.nestedErrorsOmitted]).toEqual([
      "level 2",
      undefined,
      1,
    ]);
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
