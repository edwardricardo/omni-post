/**
 * Logger Factory Tests
 *
 * Tests for the unified logger factory following TDD principles.
 *
 * @file logger.test.ts
 * @description Tests for Logger Factory
 * @layer infrastructure
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import pino from "pino";
import { fixedClock } from "@packages/vitest-shared/determinism";
import {
  createLogger,
  createChildLogger,
  extractErrorInfo,
  createTimingLogger,
  LogLevel,
} from "../../src/lib/logger.js";

describe("Logger Factory", () => {
  describe("createLogger", () => {
    it("should include the name in log bindings", () => {
      const testLogger = createLogger("my-service");
      testLogger.level = "warn";
      // The serialized line is what an operator reads, so the assertion reads it.
      const destination = Reflect.get(testLogger, pino.symbols.streamSym) as {
        write(line: string): boolean;
      };
      const write = vi.spyOn(destination, "write").mockImplementation(() => true);

      testLogger.warn("name binding check");

      const [line] = write.mock.calls.map(
        ([chunk]) => JSON.parse(chunk) as Record<string, unknown>
      );
      expect(line?.name).toBe("my-service");
    });

    it("should default to info level when LOG_LEVEL not set", () => {
      // Logger defaults to info level when LOG_LEVEL env is not explicitly set
      const testLogger = createLogger("level-test");
      // Default level should be 'info' or what's set in env
      const expectedLevel = process.env.LOG_LEVEL || "info";
      expect(testLogger.level).toBe(expectedLevel);
    });
  });

  describe("createChildLogger", () => {
    it("should create a child logger with additional context", () => {
      const parent = createLogger("parent");
      const child = createChildLogger(parent, { userId: "123", requestId: "abc" });

      expect(child).toBeTruthy();
      expect(typeof child.info).toBe("function");
      // Child logger should be a valid pino logger
      expect(child !== parent).toBeTruthy();
    });
  });

  describe("extractErrorInfo", () => {
    it("should extract info from Error object", () => {
      const error = new Error("Test error message");
      const info = extractErrorInfo(error);

      expect(info.message).toBe("Test error message");
      expect(info.name).toBe("Error");
      expect(info.stack).toBeTruthy();
    });

    it("should handle error with code property", () => {
      const error = new Error("Connection failed") as Error & { code: string };
      error.code = "ECONNREFUSED";
      const info = extractErrorInfo(error);

      expect(info.message).toBe("Connection failed");
      expect(info.code).toBe("ECONNREFUSED");
    });

    it("should handle error with status property", () => {
      const error = new Error("Not found") as Error & { status: number };
      error.status = 404;
      const info = extractErrorInfo(error);

      expect(info.message).toBe("Not found");
      expect(info.status).toBe(404);
    });

    it("should handle string error", () => {
      const info = extractErrorInfo("String error message");
      expect(info.message).toBe("String error message");
    });

    it("should handle unknown error types", () => {
      const info = extractErrorInfo(12345);
      expect(info.message).toBe("12345");
    });

    it("should handle null", () => {
      const info = extractErrorInfo(null);
      expect(info.message).toBe("null");
    });

    it("should handle undefined", () => {
      const info = extractErrorInfo(undefined);
      expect(info.message).toBe("undefined");
    });
  });

  describe("createTimingLogger", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("should measure and log operation duration", () => {
      const startedAt = fixedClock().getTime();
      vi.useFakeTimers({ now: startedAt, toFake: ["Date"] });
      const testLogger = createLogger("timing-test");
      const info = vi.spyOn(testLogger, "info").mockImplementation(() => undefined);
      const timing = createTimingLogger(testLogger, "test-operation");

      // The operation takes 10 ms on the pinned clock.
      vi.setSystemTime(startedAt + 10);

      // Verify timing object has an end method and returns void (does not throw)
      expect(typeof timing.end).toBe("function");
      const result = timing.end(true, { extra: "data" });
      expect(result).toBe(undefined);
      expect(info).toHaveBeenCalledWith(
        { operation: "test-operation", duration: 10, success: true, extra: "data" },
        "test-operation completed"
      );
    });

    it("should handle failed operations", () => {
      const testLogger = createLogger("timing-fail-test");
      const timing = createTimingLogger(testLogger, "failing-operation");

      // Verify timing.end works for failed operations without throwing
      expect(typeof timing.end).toBe("function");
      const result = timing.end(false, { reason: "timeout" });
      expect(result).toBe(undefined);
    });
  });

  describe("LogLevel constants", () => {
    it("should have all standard log levels", () => {
      expect(LogLevel.TRACE).toBe("trace");
      expect(LogLevel.DEBUG).toBe("debug");
      expect(LogLevel.INFO).toBe("info");
      expect(LogLevel.WARN).toBe("warn");
      expect(LogLevel.ERROR).toBe("error");
      expect(LogLevel.FATAL).toBe("fatal");
    });
  });
});
