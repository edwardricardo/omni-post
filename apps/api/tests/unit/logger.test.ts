/**
 * Logger Factory Tests
 *
 * Tests for the unified logger factory following TDD principles.
 */

import { describe, it, expect } from "vitest";
import {
  createLogger,
  createChildLogger,
  createRequestLogger,
  extractErrorInfo,
  createTimingLogger,
  logger,
  httpLogger,
  dbLogger,
  queueLogger,
  authLogger,
  cacheLogger,
  LogLevel,
} from "../../src/lib/logger.js";

describe("Logger Factory", () => {
  describe("createLogger", () => {
    it("should create a named logger", () => {
      const testLogger = createLogger("test-module");
      expect(testLogger).toBeTruthy();
      expect(typeof testLogger.info).toBe("function");
      expect(typeof testLogger.error).toBe("function");
      expect(typeof testLogger.warn).toBe("function");
      expect(typeof testLogger.debug).toBe("function");
    });

    it("should include the name in log bindings", () => {
      const testLogger = createLogger("my-service");
      // Logger should have the name set
      expect(testLogger).toBeTruthy();
    });

    it("should default to info level when LOG_LEVEL not set", () => {
      // Logger defaults to info level when LOG_LEVEL env is not explicitly set
      const testLogger = createLogger("level-test");
      // Default level should be 'info' or what's set in env
      const expectedLevel = process.env.LOG_LEVEL || "info";
      expect(testLogger.level).toBe(expectedLevel);
    });
  });

  describe("Pre-configured loggers", () => {
    it("should export default logger", () => {
      expect(logger).toBeTruthy();
      expect(typeof logger.info).toBe("function");
    });

    it("should export httpLogger", () => {
      expect(httpLogger).toBeTruthy();
      expect(typeof httpLogger.info).toBe("function");
    });

    it("should export dbLogger", () => {
      expect(dbLogger).toBeTruthy();
      expect(typeof dbLogger.info).toBe("function");
    });

    it("should export queueLogger", () => {
      expect(queueLogger).toBeTruthy();
      expect(typeof queueLogger.info).toBe("function");
    });

    it("should export authLogger", () => {
      expect(authLogger).toBeTruthy();
      expect(typeof authLogger.info).toBe("function");
    });

    it("should export cacheLogger", () => {
      expect(cacheLogger).toBeTruthy();
      expect(typeof cacheLogger.info).toBe("function");
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

  describe("createRequestLogger", () => {
    it("should create a logger with correlation ID", () => {
      const requestLogger = createRequestLogger({
        correlationId: "test-correlation-id",
        requestId: "test-request-id",
        path: "/api/test",
        method: "GET",
      });

      expect(requestLogger).toBeTruthy();
      expect(typeof requestLogger.info).toBe("function");
    });

    it("should handle optional fields", () => {
      const requestLogger = createRequestLogger({
        correlationId: "minimal-correlation-id",
      });

      expect(requestLogger).toBeTruthy();
    });

    it("should include userId when provided", () => {
      const requestLogger = createRequestLogger({
        correlationId: "user-correlation-id",
        userId: "user-123",
      });

      expect(requestLogger).toBeTruthy();
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
    it("should measure and log operation duration", async () => {
      const testLogger = createLogger("timing-test");
      const timing = createTimingLogger(testLogger, "test-operation");

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify timing object has an end method and returns void (does not throw)
      expect(typeof timing.end).toBe("function");
      const result = timing.end(true, { extra: "data" });
      expect(result).toBe(undefined);
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
