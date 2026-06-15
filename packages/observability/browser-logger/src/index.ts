/**
 * @file index.ts
 * @description Public API surface of @observability/browser-logger. Exposes
 *              the port interface, context helpers, and the initial console
 *              adapter. Swap adapters by registering a different factory in
 *              the LoggerProvider — consumers depend only on this barrel.
 * @layer infrastructure
 */

export type { BrowserLoggerPort, LogContext, ErrorInfo, LogLevelType } from "./port";
export { LogLevel, extractErrorInfo } from "./port";

export { ConsoleLoggerAdapter } from "./console-adapter";

export { LoggerProvider, useLogger, useLoggerContext } from "./context";
