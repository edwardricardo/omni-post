/**
 * @file console-adapter.ts
 * @description Initial BrowserLoggerPort implementation that routes entries
 *              through console.*. Replace with Sentry/Datadog/other APM adapters
 *              in the future by registering a different factory in LoggerProvider —
 *              call sites do not change.
 * @layer infrastructure
 */

import { BrowserLoggerPort, LogContext, LogLevel, LogLevelType, extractErrorInfo } from "./port.js";

/**
 * Format a log entry into a human-readable prefix line. Matches the backend
 * Pino output conceptually: `[timestamp] [LEVEL] [name] message`.
 */
function formatPrefix(
  timestamp: string,
  level: LogLevelType,
  loggerName: string,
  message: string
): string {
  return `[${timestamp}] [${level.toUpperCase()}] [${loggerName}] ${message}`;
}

/**
 * Merge bound context with per-call data. Returns `undefined` if the result
 * would be an empty object, so the console call stays terse.
 */
function mergeContext(bound: LogContext, extra?: LogContext): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = { ...bound };
  if (extra !== undefined) {
    for (const key of Object.keys(extra)) {
      merged[key] = extra[key];
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Console-backed implementation of BrowserLoggerPort.
 *
 * - SSR-safe: skips emission when `window` is undefined (e.g., during
 *   Next.js server rendering) to avoid noisy server logs in unexpected
 *   contexts. Server Actions that explicitly use this adapter will still emit
 *   because Node exposes `console.*` but no `window` — see `options.alwaysEmit`
 *   for that scenario.
 * - `child` creates a new instance with merged bound context, leaving the
 *   parent unchanged.
 */
export class ConsoleLoggerAdapter implements BrowserLoggerPort {
  readonly name: string;
  readonly level: LogLevelType = LogLevel.INFO;

  private readonly boundContext: LogContext;
  private readonly alwaysEmit: boolean;

  constructor(name: string, options?: { boundContext?: LogContext; alwaysEmit?: boolean }) {
    this.name = name;
    this.boundContext = options?.boundContext ?? {};
    this.alwaysEmit = options?.alwaysEmit ?? false;
  }

  private shouldEmit(): boolean {
    if (this.alwaysEmit) return true;
    return typeof window !== "undefined";
  }

  debug(message: string, data?: LogContext): void {
    if (!this.shouldEmit()) return;
    const prefix = formatPrefix(new Date().toISOString(), LogLevel.DEBUG, this.name, message);
    const ctx = mergeContext(this.boundContext, data);
    if (ctx !== undefined) {
      console.debug(prefix, ctx);
    } else {
      console.debug(prefix);
    }
  }

  info(message: string, data?: LogContext): void {
    if (!this.shouldEmit()) return;
    const prefix = formatPrefix(new Date().toISOString(), LogLevel.INFO, this.name, message);
    const ctx = mergeContext(this.boundContext, data);
    if (ctx !== undefined) {
      console.info(prefix, ctx);
    } else {
      console.info(prefix);
    }
  }

  warn(message: string, data?: LogContext): void {
    if (!this.shouldEmit()) return;
    const prefix = formatPrefix(new Date().toISOString(), LogLevel.WARN, this.name, message);
    const ctx = mergeContext(this.boundContext, data);
    if (ctx !== undefined) {
      console.warn(prefix, ctx);
    } else {
      console.warn(prefix);
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (!this.shouldEmit()) return;
    const prefix = formatPrefix(new Date().toISOString(), LogLevel.ERROR, this.name, message);

    let errorPart: Record<string, unknown> | undefined;
    let dataPart: LogContext | undefined;

    if (error instanceof Error) {
      errorPart = { err: extractErrorInfo(error) };
      dataPart = context;
    } else if (error !== undefined && error !== null && typeof error === "object") {
      // Treat plain object as structured context (no Error extraction needed).
      dataPart = error as LogContext;
    } else if (error !== undefined) {
      // Primitive (string/number/bool) or null: extract as error payload.
      errorPart = { err: extractErrorInfo(error) };
      dataPart = context;
    }

    const merged: Record<string, unknown> = { ...this.boundContext };
    if (errorPart !== undefined) {
      Object.assign(merged, errorPart);
    }
    if (dataPart !== undefined) {
      for (const key of Object.keys(dataPart)) {
        merged[key] = dataPart[key];
      }
    }

    if (Object.keys(merged).length > 0) {
      console.error(prefix, merged);
    } else {
      console.error(prefix);
    }
  }

  child(bindings: LogContext): BrowserLoggerPort {
    return new ConsoleLoggerAdapter(this.name, {
      boundContext: { ...this.boundContext, ...bindings },
      alwaysEmit: this.alwaysEmit,
    });
  }
}
