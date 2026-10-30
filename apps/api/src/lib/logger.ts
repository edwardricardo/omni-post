/**
 * @file logger.ts
 * @description Provides the unified Pino logger factory with automatic redaction of
 *              sensitive fields and structured JSON output for all API components.
 * @layer infrastructure
 */

import pino, { Logger, LoggerOptions } from "pino";
import { env } from "../config/env.js";

/**
 * Sensitive fields to redact from logs
 */
const REDACT_PATHS = [
  "password",
  "token",
  "apiKey",
  "apiSecret",
  "accessToken",
  "accessTokenSecret",
  "refreshToken",
  "bearerToken",
  "secret",
  "credentials",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.secret",
  "req.headers.authorization",
  "req.headers.cookie",
  // Use bracket notation for hyphenated keys
  'res.headers["set-cookie"]',
];

/**
 * Base logger options
 */
const baseOptions: LoggerOptions = {
  level: env.LOG_LEVEL || "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
    // Pino hands the logger's `name` to this formatter with the other root bindings,
    // so a formatter that omits it strips the name from every line `createLogger(name)` writes.
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      ...(bindings.name !== undefined && { name: bindings.name }),
      service: "omnipost-api",
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/**
 * Create logger options with test environment handling
 */
function createLoggerOptions(name: string): LoggerOptions {
  return {
    ...baseOptions,
    name,
  };
}

/**
 * Create a destination for the logger
 * Uses synchronous destination in test environment to prevent hanging tests
 */
function createDestination() {
  if (env.NODE_ENV === "test") {
    return pino.destination({ sync: true });
  }
  return undefined; // Use default (stdout)
}

/**
 * @description Creates a named Pino logger with the shared options (redaction, level,
 *              bindings) and a synchronous destination under the test environment.
 * @param name - Logger name (e.g., "http", "database", "queue")
 * @returns The configured logger
 */
export function createLogger(name: string): Logger {
  const options = createLoggerOptions(name);
  const destination = createDestination();

  if (destination) {
    return pino(options, destination);
  }

  return pino(options);
}

// Pre-configured loggers for common use cases
export const logger = createLogger("api");
export const httpLogger = createLogger("http");
export const dbLogger = createLogger("database");
export const authLogger = createLogger("auth");
export const providerLogger = createLogger("provider");
export const webhookLogger = createLogger("webhook");

/**
 * Request context for correlation tracking
 */
interface RequestContext {
  correlationId: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  path?: string;
  method?: string;
}

/**
 * @description Creates a request-scoped child of the HTTP logger that carries the
 *              correlation ID and whichever optional request fields are present.
 * @param context - The correlation ID and the optional request identifiers to bind
 * @returns The child logger bound to the request context
 */
export function createRequestLogger(context: RequestContext): Logger {
  return httpLogger.child({
    correlationId: context.correlationId,
    ...(context.requestId && { requestId: context.requestId }),
    ...(context.userId && { userId: context.userId }),
    ...(context.path && { path: context.path }),
    ...(context.method && { method: context.method }),
  });
}

/**
 * Standard log level constants
 */
export const LogLevel = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
} as const;

/**
 * @description Creates a child logger that attaches the given bindings to every entry.
 * @param parent - Parent logger instance
 * @param bindings - Additional context to attach to all log entries
 * @returns The child logger
 */
export function createChildLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}

/**
 * @description Extracts the message, name, stack, code and status an error carries, or
 *              the string form of a value that is not an Error.
 * @param error - The error to extract information from
 * @returns The structured error information
 */
export function extractErrorInfo(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  status?: number;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack !== undefined && { stack: error.stack }),
      ...("code" in error && { code: (error as Error & { code: string }).code }),
      ...("status" in error && { status: (error as Error & { status: number }).status }),
    };
  }

  return { message: String(error) };
}

/**
 * @description Creates a timer whose end method logs the operation's duration and outcome,
 *              at info on success and at warn on failure.
 * @param parentLogger - Logger to use for output
 * @param operation - Name of the operation being timed
 * @returns An object whose end method writes the timing entry
 */
export function createTimingLogger(
  parentLogger: Logger,
  operation: string
): { end: (success: boolean, meta?: Record<string, unknown>) => void } {
  const start = Date.now();

  return {
    end(success: boolean, meta?: Record<string, unknown>): void {
      const duration = Date.now() - start;
      const logData = { operation, duration, success, ...meta };

      if (success) {
        parentLogger.info(logData, `${operation} completed`);
      } else {
        parentLogger.warn(logData, `${operation} failed`);
      }
    },
  };
}

// Re-export pino types for convenience
export type { Logger, LoggerOptions } from "pino";
