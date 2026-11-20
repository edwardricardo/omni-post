/**
 * @file loggerCommandArgsRedaction.test.ts
 * @description Pins that the API's redacting `createLogger(name)` never writes the arguments of
 *   the Redis command an error carries. ioredis attaches `command: { name, args }` to the error
 *   it emits, and on an AUTH failure `args` holds the password; pino's error serializer copies
 *   every enumerable property. Both an error logged directly under `err` or `error` and one
 *   logged by the throttled listener are written, through the factory's own destination, with
 *   the command's name and without its arguments.
 * @layer infrastructure
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import pino from "pino";
import { createThrottledErrorListener } from "@observability/logger";
import { createLogger } from "../../../src/lib/logger.js";

/** A value no written line may hold: it stands for the password an AUTH command carries. */
const COMMAND_ARG_MARKER = "fake-redis-password-marker";

/** An error as ioredis emits it when AUTH fails: the command, with its arguments, attached. */
function redisAuthFailure(): Error {
  const error = new Error("WRONGPASS invalid username-password pair");
  error.name = "ReplyError";
  return Object.assign(error, { command: { name: "auth", args: [COMMAND_ARG_MARKER] } });
}

/**
 * Builds the factory's logger and captures the lines its destination receives, replacing the
 * destination's `write` so nothing reaches the output. The level is pinned to `info`.
 */
function captureFromFactory(name: string) {
  const logger = createLogger(name);
  logger.level = "info";
  const destination = Reflect.get(logger, pino.symbols.streamSym) as
    { write(line: string): boolean } | undefined;
  if (typeof destination?.write !== "function") {
    throw new Error(
      "pino.symbols.streamSym no longer resolves the logger's destination: update this capture before trusting the assertions"
    );
  }
  const write = vi.spyOn(destination, "write").mockImplementation(() => true);
  return {
    logger,
    lines: () => write.mock.calls.map(([line]) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("API createLogger and the arguments of a Redis command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("masks the arguments of the command an error logged directly carries", () => {
    const { logger, lines } = captureFromFactory("redis-args-direct");

    logger.error({ err: redisAuthFailure() }, "error under err");
    logger.error({ error: redisAuthFailure() }, "error under error");

    expect(JSON.stringify(lines())).not.toContain(COMMAND_ARG_MARKER);
    expect(lines()).toHaveLength(2);
  });

  it("writes the command's name and no argument when the throttled listener logs the error", () => {
    const { logger, lines } = captureFromFactory("redis-args-listener");

    createThrottledErrorListener(logger, "redis:test")(redisAuthFailure());

    const [entry, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(JSON.stringify(entry)).not.toContain(COMMAND_ARG_MARKER);
    expect((entry?.err as { command?: unknown } | undefined)?.command).toBe("auth");
  });
});
