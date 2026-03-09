/**
 * Unified Logger Factory
 *
 * Provides consistent structured logging across all API components.
 * Uses pino for high-performance JSON logging with automatic redaction
 * of sensitive fields.
 */

import pino, { Logger, LoggerOptions } from "pino";

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
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
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
  if (process.env.NODE_ENV === "test") {
    return pino.destination({ sync: true });
  }
  return undefined; // Use default (stdout)
}

/**
 * Create a named logger instance
 * @param name - Logger name (e.g., "http", "database", "queue")
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
export const queueLogger = createLogger("queue");
export const authLogger = createLogger("auth");
export const cacheLogger = createLogger("cache");
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
 * Create a request-scoped logger with correlation ID
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
 * Create a child logger with additional context bindings
 * @param parent - Parent logger instance
 * @param bindings - Additional context to attach to all log entries
 */
export function createChildLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}

/**
 * Extract structured error information from any error type
 * @param error - The error to extract information from
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
 * Create a timing logger for measuring operation duration
 * @param parentLogger - Logger to use for output
 * @param operation - Name of the operation being timed
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
