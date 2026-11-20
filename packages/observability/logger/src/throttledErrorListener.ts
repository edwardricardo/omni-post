/**
 * @file throttledErrorListener.ts
 * @description Builds the `error` listener a long-lived connection (a Redis client, a BullMQ
 *              queue) is given so that its faults reach the log without flooding it. During an
 *              outage ioredis emits an error on every reconnection attempt, so a listener that
 *              logs each one writes a line every few seconds per connection; this one writes the
 *              first error at once and then at most one line per window, carrying the count of
 *              the errors it held back. The window is measured by comparing timestamps on each
 *              error, with no timer: a count still held back when the errors stop is never
 *              written, because no later error arrives to carry it.
 * @layer infrastructure
 */

/** The shortest time between two lines one listener writes. */
export const CONNECTION_ERROR_LOG_WINDOW_MS = 60_000;

/** The one method the listener writes through; a Pino logger satisfies it. */
export interface ErrorLogSink {
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * @description Returns a listener for a connection's `error` event that logs the error under
 *              `err` with the connection's name, at most once per
 *              `CONNECTION_ERROR_LOG_WINDOW_MS`, with the number of errors held back since the
 *              previous line under `suppressed`. Each call returns a listener with its own state.
 * @param logger - Logger the listener writes through.
 * @param connection - Name of the connection, bound to every line as `connection`. It names a
 *                     role, never an address: a Redis URL can carry its password.
 * @returns The listener to attach with `.on("error", listener)`.
 */
export function createThrottledErrorListener(
  logger: ErrorLogSink,
  connection: string
): (error: unknown) => void {
  let lastLoggedAt: number | undefined;
  let suppressed = 0;

  return (error: unknown) => {
    const now = Date.now();
    if (lastLoggedAt !== undefined && now - lastLoggedAt < CONNECTION_ERROR_LOG_WINDOW_MS) {
      suppressed += 1;
      return;
    }
    logger.error({ err: error, connection, suppressed }, "Connection error");
    lastLoggedAt = now;
    suppressed = 0;
  };
}
