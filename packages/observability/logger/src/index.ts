/**
 * @file index.ts
 * @description Shared logger factory for all monorepo packages. Exposes one
 *              process-wide base Pino logger and returns lightweight named
 *              child loggers per call. Honours the LOG_LEVEL env var.
 *
 *              Why a shared base: Pino registers a `process.on("exit")`
 *              listener per transport-backed logger (to flush on shutdown,
 *              pino/lib/transport.js). The previous implementation built a
 *              fresh transport-backed root logger on every `createLogger()`
 *              call, so each importing package/module added its own `exit`
 *              listener. With 11 provider adapters (plus adapters/observability)
 *              calling the factory at module scope, the count crossed Node's
 *              default `MaxListeners` (10) and emitted a spurious
 *              `MaxListenersExceededWarning`. One base + `child({ name })`
 *              means exactly one transport and one `exit` listener for the
 *              whole process, with per-logger namespacing preserved.
 * @layer infrastructure
 */
import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

/**
 * Single process-wide base logger. Created once when this module is first
 * imported — one transport, one `process` `exit` listener for the whole
 * process. In non-production a pino/file transport writes to stdout (fd 1);
 * in production pino writes synchronously to stdout with no transport thread.
 */
const baseLogger: pino.Logger = pino({
  level: LOG_LEVEL,
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino/file",
      options: { destination: 1 }, // stdout
    },
  }),
});

/**
 * @function createLogger
 * @description Returns a namespaced child of the shared base logger. Child
 *              loggers reuse the base's stream/transport, so repeated calls
 *              add no additional process listeners or transport threads.
 * @param name - Logical name bound to every line this logger emits (`name` field).
 * @returns A pino child logger namespaced with `{ name }`.
 */
export function createLogger(name: string): pino.Logger {
  return baseLogger.child({ name });
}

export type { Logger } from "pino";
