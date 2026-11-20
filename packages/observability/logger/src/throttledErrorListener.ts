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
 *              own window, up to `MAX_TRACKED_ERROR_IDENTITIES`; past that bound every further
 *              identity shares one window, so a stream of distinct errors still writes a bounded
 *              number of lines.
 *
 *              A line carries the error's type, message, code, stack and the NAME of the command
 *              it failed on, never the error object: ioredis attaches `command.args` to the error
 *              it emits, and on an AUTH failure those arguments hold the password.
 * @layer infrastructure
 */

/** The shortest time between two lines a listener writes for one error identity. */
export const CONNECTION_ERROR_LOG_WINDOW_MS = 60_000;

/** The number of error identities one listener throttles apart; further ones share a window. */
export const MAX_TRACKED_ERROR_IDENTITIES = 16;

/** The two methods a listener writes through; a Pino logger satisfies it. */
export interface ErrorLogSink {
  error(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
}

/** An `error` listener that also reports, on `flush`, what it held back. */
export interface ThrottledErrorListener {
  (error: unknown): void;
  /**
   * Writes one line saying the source is ready again, with the count held back since the
   * last line, and forgets every window, so the first error of the next outage is written at
   * once. It writes nothing when no error came since the last flush.
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

/** The fields of an error a line may carry: never the error itself, never a command's arguments. */
function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }
  const code: unknown = Reflect.get(error, "code");
  const command: unknown = Reflect.get(error, "command");
  const commandName: unknown =
    typeof command === "object" && command !== null ? Reflect.get(command, "name") : undefined;
  // A null prototype keeps pino's error serializer from replacing `type` with "Object".
  return Object.assign(Object.create(null) as Record<string, unknown>, {
    type: error.name,
    message: error.message,
    ...((typeof code === "string" || typeof code === "number") && { code }),
    ...(typeof commandName === "string" && { command: commandName }),
    ...(error.stack !== undefined && { stack: error.stack }),
  });
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
  let overflow: Window | undefined;
  let erredSinceFlush = false;

  const listener = (error: unknown): void => {
    erredSinceFlush = true;
    const now = performance.now();
    const identity = identityOf(error);
    const tracked = windows.get(identity);
    const tracksIdentity = tracked !== undefined || windows.size < MAX_TRACKED_ERROR_IDENTITIES;
    const window = tracksIdentity ? tracked : overflow;
    if (window !== undefined && now - window.lastWrittenAt < CONNECTION_ERROR_LOG_WINDOW_MS) {
      window.suppressed += 1;
      return;
    }
    logger.error(
      { err: describeError(error), [kind.field]: name, suppressed: window?.suppressed ?? 0 },
      kind.errorMessage
    );
    const written: Window = { lastWrittenAt: now, suppressed: 0 };
    if (tracksIdentity) {
      windows.set(identity, written);
    } else {
      overflow = written;
    }
  };

  const flush = (): void => {
    if (!erredSinceFlush) {
      return;
    }
    let suppressed = overflow?.suppressed ?? 0;
    for (const window of windows.values()) {
      suppressed += window.suppressed;
    }
    logger.info({ [kind.field]: name, suppressed }, kind.readyMessage);
    windows.clear();
    overflow = undefined;
    erredSinceFlush = false;
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
 *              `ready` event, that it recovered and how many errors were held back.
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
