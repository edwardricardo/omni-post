/**
 * @file logger.ts
 * @description Lightweight structured logger for server-side code (Server Actions, API routes,
 * middleware, Server Components). Wraps console methods with consistent prefix formatting for
 * searchable log output. Client-side code should NOT import this module -- use toast
 * notifications or error state instead.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

function formatLog(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.context}] ${entry.message}`;
  return base;
}

function createLogEntry(
  level: LogLevel,
  context: string,
  message: string,
  data?: unknown
): LogEntry {
  return {
    level,
    context,
    message,
    timestamp: new Date().toISOString(),
    ...(data !== undefined && { data }),
  };
}

/**
 * Create a scoped logger for a specific module/context.
 *
 * @example
 * ```ts
 * const log = createLogger("loginAction");
 * log.error("Unexpected error", error);
 * log.info("User authenticated", { userId });
 * ```
 */
export function createLogger(context: string) {
  return {
    info(message: string, data?: unknown) {
      const entry = createLogEntry("info", context, message, data);

      console.info(formatLog(entry), ...(data !== undefined ? [data] : []));
    },

    warn(message: string, data?: unknown) {
      const entry = createLogEntry("warn", context, message, data);

      console.warn(formatLog(entry), ...(data !== undefined ? [data] : []));
    },

    error(message: string, data?: unknown) {
      const entry = createLogEntry("error", context, message, data);

      console.error(formatLog(entry), ...(data !== undefined ? [data] : []));
    },

    debug(message: string, data?: unknown) {
      if (process.env.NODE_ENV === "development") {
        const entry = createLogEntry("debug", context, message, data);

        console.debug(formatLog(entry), ...(data !== undefined ? [data] : []));
      }
    },
  };
}
