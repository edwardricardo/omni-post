/**
 * @file throttledErrorListener.ts
 * @description Builds the `error` listeners long-lived connections and workers (a Redis client,
 *              a BullMQ queue or worker) are given so that their faults reach the log without
 *              flooding it or leaking what they carry. During an outage ioredis emits an error on
 *              every reconnection attempt, so a listener that logged each one would write a line
 *              every few seconds per connection.
 *
 *              A listener writes the first error of each identity (its name and message) at once,
 *              then at most one line per window for that identity, carrying the count it held
 *              back. The window is measured on a monotonic clock and restarts at each written
 *              line. A different error is never counted behind the first: each identity has its
 *              own window, up to `MAX_TRACKED_ERROR_IDENTITIES` live windows at a time; past that
 *              bound every further identity shares one window. A window that has expired is
 *              dropped, so the bound limits what is tracked at one time and not over the life of
 *              the process.
 *
 *              Two invariants hold:
 *              - Every held-back error is counted in exactly one later written line: the next line
 *                of its own identity (`suppressed`), the next recovery line (`suppressed`), or,
 *                when its window expired first, the next line of either kind
 *                (`suppressedByExpiredWindows`).
 *              - The last line a source that is ready again wrote is never an error line: `flush`
 *                writes a recovery line whenever an error line was written since the last one.
 *                It writes none when every error since then was held back, which is what a
 *                connection that flaps on one error inside its window does; it never restarts an
 *                error's window. Per window that is at most one line per live identity and one
 *                recovery line after each of them.
 *
 *              A line describes an error by an allow-list of fields, never by the error object:
 *              ioredis attaches `command.args` to the error it emits, and on an AUTH failure those
 *              arguments hold the password. Only the command's NAME is kept.
 * @layer infrastructure
 */

/** The shortest time between two lines a listener writes for one error identity. */
export const CONNECTION_ERROR_LOG_WINDOW_MS = 60_000;

/** The number of live error identities one listener throttles apart; further ones share a window. */
export const MAX_TRACKED_ERROR_IDENTITIES = 16;

/** The number of an AggregateError's nested errors a line describes per level. */
export const MAX_NESTED_ERRORS = 4;

/** The number of levels of nested errors a line describes below the logged error. */
export const MAX_NESTED_DEPTH = 2;

/** The two methods a listener writes through; a Pino logger satisfies it. */
export interface ErrorLogSink {
  error(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
}

/** An `error` listener that also reports, on `flush`, what it held back. */
export interface ThrottledErrorListener {
  (error: unknown): void;
  /**
   * Writes one line saying the source is ready again, with the counts its live windows held
   * back, when an error line was written since the last recovery line; otherwise it writes
   * nothing and the counts wait for the next written line. It never restarts an error's
   * window: the same error inside the window of its last line is still held back.
   */
  flush(): void;
}

/** The emitter `logConnectionErrors` wires: an ioredis client satisfies it. */
export interface ConnectionEventSource {
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(event: "ready", listener: () => void): unknown;
}

interface Window {
  lastWrittenAt: number;
  suppressed: number;
}

interface ListenerKind {
  readonly field: "connection" | "worker";
  readonly errorMessage: string;
  readonly readyMessage: string;
}

const CONNECTION_KIND: ListenerKind = {
  field: "connection",
  errorMessage: "Connection error",
  readyMessage: "Connection ready again",
};

const WORKER_KIND: ListenerKind = {
  field: "worker",
  errorMessage: "Worker error",
  readyMessage: "Worker ready again",
};

/** The diagnostic fields a line copies from an error, when each is a string or a number. */
const DIAGNOSTIC_FIELDS = ["code", "errno", "syscall", "address", "port", "hostname"] as const;

/** The key of the window every identity past the bound shares; no error name holds a NUL. */
const OVERFLOW = "\u0000overflow";

/**
 * The fields of an error a line may carry: its type, message, the allow-listed diagnostics,
 * the NAME of the command it failed on, its stack, and an AggregateError's nested errors
 * described the same way to `MAX_NESTED_ERRORS` per level and `MAX_NESTED_DEPTH` levels.
 * Never the error object, never a field outside the list, never a command's arguments.
 */
function describeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }
  // A null prototype keeps pino's error serializer from replacing `type` with "Object".
  const description = Object.assign(Object.create(null) as Record<string, unknown>, {
    type: error.name,
    message: error.message,
  });
  for (const field of DIAGNOSTIC_FIELDS) {
    const value: unknown = Reflect.get(error, field);
    if (typeof value === "string" || typeof value === "number") {
      description[field] = value;
    }
  }
  const command: unknown = Reflect.get(error, "command");
  const commandName: unknown =
    typeof command === "object" && command !== null ? Reflect.get(command, "name") : undefined;
  if (typeof commandName === "string") {
    description.command = commandName;
  }
  if (error.stack !== undefined) {
    description.stack = error.stack;
  }
  const nested: unknown = Reflect.get(error, "errors");
  if (Array.isArray(nested) && nested.length > 0) {
    const described = depth < MAX_NESTED_DEPTH ? nested.slice(0, MAX_NESTED_ERRORS) : [];
    if (described.length > 0) {
      description.nestedErrors = described.map((item: unknown) => describeError(item, depth + 1));
    }
    if (nested.length > described.length) {
      description.nestedErrorsOmitted = nested.length - described.length;
    }
  }
  return description;
}

function identityOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
}

function createListener(
  logger: ErrorLogSink,
  name: string,
  kind: ListenerKind
): ThrottledErrorListener {
  const windows = new Map<string, Window>();
  let suppressedByExpiredWindows = 0;
  let errorLineSinceRecovery = false;

  /** Drops every expired window but `kept`, keeping its held-back count for the next line. */
  const dropExpired = (now: number, kept?: string): void => {
    for (const [key, window] of windows) {
      if (key !== kept && now - window.lastWrittenAt >= CONNECTION_ERROR_LOG_WINDOW_MS) {
        suppressedByExpiredWindows += window.suppressed;
        windows.delete(key);
      }
    }
  };

  /** The count expired windows held back, as the field the next written line carries; resets it. */
  const takeExpiredCount = (): Record<string, number> => {
    const carried = suppressedByExpiredWindows;
    suppressedByExpiredWindows = 0;
    return carried > 0 ? { suppressedByExpiredWindows: carried } : {};
  };

  const listener = (error: unknown): void => {
    const now = performance.now();
    const identity = identityOf(error);
    const ownWindow = windows.has(identity);
    dropExpired(now, ownWindow ? identity : undefined);
    const tracked = windows.size - (windows.has(OVERFLOW) ? 1 : 0);
    const key = ownWindow || tracked < MAX_TRACKED_ERROR_IDENTITIES ? identity : OVERFLOW;
    const window = windows.get(key);
    if (window !== undefined && now - window.lastWrittenAt < CONNECTION_ERROR_LOG_WINDOW_MS) {
      window.suppressed += 1;
      return;
    }
    logger.error(
      {
        err: describeError(error),
        [kind.field]: name,
        suppressed: window?.suppressed ?? 0,
        ...takeExpiredCount(),
      },
      kind.errorMessage
    );
    windows.set(key, { lastWrittenAt: now, suppressed: 0 });
    errorLineSinceRecovery = true;
  };

  const flush = (): void => {
    if (!errorLineSinceRecovery) {
      return;
    }
    dropExpired(performance.now());
    let suppressed = 0;
    for (const window of windows.values()) {
      suppressed += window.suppressed;
      window.suppressed = 0;
    }
    logger.info({ [kind.field]: name, suppressed, ...takeExpiredCount() }, kind.readyMessage);
    errorLineSinceRecovery = false;
  };

  return Object.assign(listener, { flush });
}

/**
 * @description Returns a throttled listener for a connection's `error` event, writing
 *              "Connection error" with the connection's name under `connection`. Where the
 *              source emits `ready` (an ioredis client), wire `flush` to it, or use
 *              `logConnectionErrors`, which does both. A BullMQ queue emits no `ready`, so on a
 *              queue nothing calls `flush`: when its errors stop, the count still held back is
 *              never written and no line says the queue recovered; the next error after the
 *              window carries the count.
 * @param logger - Logger the listener writes through.
 * @param connection - Name of the connection, a role and never an address: a Redis URL can
 *                     carry its password.
 * @returns The listener, with its `flush`.
 */
export function createThrottledErrorListener(
  logger: ErrorLogSink,
  connection: string
): ThrottledErrorListener {
  return createListener(logger, connection, CONNECTION_KIND);
}

/**
 * @description Returns a throttled listener for a BullMQ worker's `error` event, writing
 *              "Worker error" with the worker's name under `worker`. A worker's `error` carries
 *              job-level failures (lock renewal, moving a job to finished, the stalled check)
 *              as well as its connection's errors, which is why each error identity keeps its
 *              own window. A worker emits no `ready`, so nothing calls `flush` (see
 *              `createThrottledErrorListener`).
 * @param logger - Logger the listener writes through.
 * @param worker - Name of the worker.
 * @returns The listener, with its `flush`.
 */
export function createThrottledWorkerErrorListener(
  logger: ErrorLogSink,
  worker: string
): ThrottledErrorListener {
  return createListener(logger, worker, WORKER_KIND);
}

/**
 * @description Logs a connection's errors through a throttled listener and reports, on its
 *              `ready` event, that it recovered and how many errors were held back. A recovery
 *              line follows every written error line, and none follows errors that were all held
 *              back, so a connection that flaps on one error inside its window stays throttled.
 * @param connection - The connection; an ioredis client emits both events.
 * @param logger - Logger the listener writes through.
 * @param name - Name of the connection, a role and never an address.
 */
export function logConnectionErrors(
  connection: ConnectionEventSource,
  logger: ErrorLogSink,
  name: string
): void {
  const listener = createThrottledErrorListener(logger, name);
  connection.on("error", listener);
  connection.on("ready", listener.flush);
}
