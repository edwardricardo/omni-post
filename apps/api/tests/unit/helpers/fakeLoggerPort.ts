/**
 * @file fakeLoggerPort.ts
 * @description Recording `LoggerPort` for unit suites of application services. Each
 *   level is a `vi.fn`, so a suite can assert the context and message a failure path
 *   reported, and a suite that only needs a logger to construct its subject passes one
 *   and ignores it.
 * @layer infrastructure
 */

import { vi, type Mock } from "vitest";
import type { LoggerPort } from "@ports/core";

/**
 * Both call forms of a port level, `(context, message)` and `(message)`, as the one
 * signature a single mock can implement.
 */
type LogCall = (contextOrMessage: Record<string, unknown> | string, message?: string) => void;

/**
 * A `LoggerPort` whose levels are mocks. Declared as properties rather than methods
 * so `expect(logger.error)` reads a mock, not a method detached from its object.
 */
export interface FakeLoggerPort extends LoggerPort {
  readonly warn: Mock<LogCall>;
  readonly error: Mock<LogCall>;
}

/**
 * @function createFakeLoggerPort
 * @description Builds a recording logger with fresh mocks, so no call leaks between suites.
 * @returns A `LoggerPort` whose `warn` and `error` record every call
 */
export function createFakeLoggerPort(): FakeLoggerPort {
  return { warn: vi.fn<LogCall>(), error: vi.fn<LogCall>() };
}
