/**
 * @file port.ts
 * @description Technology-free abstraction for browser-side structured logging.
 *              Defines the BrowserLoggerPort interface, LogContext shape, log
 *              level constants, and error extraction utility. Implementations
 *              (console, Sentry, Datadog, etc.) can be swapped without
 *              refactoring any call site.
 * @layer infrastructure
 */

/**
 * Standard log severity levels. Order (ascending): debug < info < warn < error.
 */
export const LogLevel = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

export type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Structured context that travels with every log entry.
 * Optional convenience fields hint at common patterns; arbitrary keys allowed.
 */
export interface LogContext extends Record<string, unknown> {
  correlationId?: string;
  userId?: string;
  sessionId?: string;
}

/**
 * Browser-side logger port. Implementations route log entries to the
 * appropriate sink (console, Sentry, Datadog RUM, etc.). Consumers depend on
 * this interface, never on a concrete implementation.
 *
 * Design notes:
 * - Methods are synchronous. Async buffering/flush is an implementation detail.
 * - `error` accepts an overloaded signature to match common call patterns:
 *   `logger.error(msg)`, `logger.error(msg, err)`, `logger.error(msg, err, ctx)`,
 *   or `logger.error(msg, ctx)` when no Error instance is involved.
 * - `child` returns a new logger with additional bound context (correlation
 *   propagation pattern, matches Pino semantics).
 */
export interface BrowserLoggerPort {
  /** Logger name, set at creation, immutable. */
  readonly name: string;

  /** Current minimum log level for this logger instance. */
  readonly level: LogLevelType;

  /**
   * Log a debug-level message. May be dropped by adapters in production.
   */
  debug(message: string, data?: LogContext): void;

  /**
   * Log an info-level message.
   */
  info(message: string, data?: LogContext): void;

  /**
   * Log a warning-level message.
   */
  warn(message: string, data?: LogContext): void;

  /**
   * Log an error-level message. Accepts an optional Error-like value (any
   * `unknown` is accepted to make `catch (error)` sites ergonomic) and/or
   * additional structured context. Non-Error values are stringified via
   * `extractErrorInfo` and attached under the `err` field.
   */
  error(message: string, error?: unknown, context?: LogContext): void;

  /**
   * Create a child logger with additional bound context. Child logger will
   * include `bindings` in every entry in addition to any per-call context.
   */
  child(bindings: LogContext): BrowserLoggerPort;
}

/**
 * Structured representation of an error for logging.
 */
export interface ErrorInfo {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  status?: number;
}

/**
 * @method extractErrorInfo
 * @description Extract a structured representation from an unknown error value.
 *              Handles `Error` instances (including subclasses with `code` or
 *              `status`), strings, and fallback values gracefully.
 * @param error - Any thrown value (Error, string, null, unknown)
 * @returns ErrorInfo with at least `message` populated
 */
export function extractErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const info: ErrorInfo = {
      message: error.message,
      name: error.name,
    };
    if (error.stack !== undefined) {
      info.stack = error.stack;
    }
    const maybeCode = (error as Error & { code?: unknown }).code;
    if (typeof maybeCode === "string") {
      info.code = maybeCode;
    }
    const maybeStatus = (error as Error & { status?: unknown }).status;
    if (typeof maybeStatus === "number") {
      info.status = maybeStatus;
    }
    return info;
  }

  if (typeof error === "string") {
    return { message: error };
  }

  if (error === null) {
    return { message: "null" };
  }

  if (error === undefined) {
    return { message: "undefined" };
  }

  return { message: String(error) };
}
