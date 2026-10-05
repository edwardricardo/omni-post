/**
 * @file loggerPortContract.type-test.ts
 * @description Compile-time pin for `LoggerPort`: the logger the API's redacting
 *   `createLogger(name)` returns implements the port as is, and a message-first
 *   logger does not.
 *
 *   ## Why the order is the contract
 *
 *   Pino reads `(mergeObject, message)` as structured fields and a message, but
 *   `(message, object)` as a message plus a printf argument, which it drops when
 *   the message has no format specifier. A message-first port therefore admits a raw
 *   Pino logger that compiles and silently loses every context field. The port
 *   uses Pino's own order instead, so the factory's logger is a correct
 *   implementation by construction and the composition root passes it directly.
 *
 *   ## How the pin fails
 *
 *   The assignment below stops compiling if the factory's logger ever stops
 *   satisfying the port. The `@ts-expect-error` stops compiling (TS2578, unused
 *   directive) if a message-first logger is ever accepted again, which is
 *   exactly what a message-first port does. The file is named `.type-test.ts`,
 *   so the vitest collector never runs it; `tsconfig.type-tests.json` compiles it
 *   in the package's `typecheck` script.
 * @layer infrastructure
 */
import type { LoggerPort } from "@ports/core";
import type { createLogger } from "../../../src/lib/logger.js";

declare const factoryLogger: ReturnType<typeof createLogger>;

declare const messageFirstLogger: {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

/** The redacting factory's logger is the port's implementation, with no adapter between. */
export const factoryLoggerIsAPort: LoggerPort = factoryLogger;

// @ts-expect-error a message-first logger would have Pino drop the context, so it is not a LoggerPort
export const messageFirstLoggerIsRejected: LoggerPort = messageFirstLogger;
