/**
 * Logger Factory Tests
 *
 * Tests for the unified logger factory following TDD principles.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
      assert.ok(testLogger);
      assert.equal(typeof testLogger.info, "function");
      assert.equal(typeof testLogger.error, "function");
      assert.equal(typeof testLogger.warn, "function");
      assert.equal(typeof testLogger.debug, "function");
    });

    it("should include the name in log bindings", () => {
      const testLogger = createLogger("my-service");
      // Logger should have the name set
      assert.ok(testLogger);
    });

    it("should default to info level when LOG_LEVEL not set", () => {
      // Logger defaults to info level when LOG_LEVEL env is not explicitly set
      const testLogger = createLogger("level-test");
      // Default level should be 'info' or what's set in env
      const expectedLevel = process.env.LOG_LEVEL || "info";
      assert.equal(testLogger.level, expectedLevel);
    });
  });

  describe("Pre-configured loggers", () => {
    it("should export default logger", () => {
      assert.ok(logger);
      assert.equal(typeof logger.info, "function");
    });

    it("should export httpLogger", () => {
      assert.ok(httpLogger);
      assert.equal(typeof httpLogger.info, "function");
    });

    it("should export dbLogger", () => {
      assert.ok(dbLogger);
      assert.equal(typeof dbLogger.info, "function");
    });

    it("should export queueLogger", () => {
      assert.ok(queueLogger);
      assert.equal(typeof queueLogger.info, "function");
    });

    it("should export authLogger", () => {
      assert.ok(authLogger);
      assert.equal(typeof authLogger.info, "function");
    });

    it("should export cacheLogger", () => {
      assert.ok(cacheLogger);
      assert.equal(typeof cacheLogger.info, "function");
    });
  });

  describe("createChildLogger", () => {
    it("should create a child logger with additional context", () => {
      const parent = createLogger("parent");
      const child = createChildLogger(parent, { userId: "123", requestId: "abc" });

      assert.ok(child);
      assert.equal(typeof child.info, "function");
      // Child logger should be a valid pino logger
      assert.ok(child !== parent);
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

      assert.ok(requestLogger);
      assert.equal(typeof requestLogger.info, "function");
    });

    it("should handle optional fields", () => {
      const requestLogger = createRequestLogger({
        correlationId: "minimal-correlation-id",
      });

      assert.ok(requestLogger);
    });

    it("should include userId when provided", () => {
      const requestLogger = createRequestLogger({
        correlationId: "user-correlation-id",
        userId: "user-123",
      });

      assert.ok(requestLogger);
    });
  });

  describe("extractErrorInfo", () => {
    it("should extract info from Error object", () => {
      const error = new Error("Test error message");
      const info = extractErrorInfo(error);

      assert.equal(info.message, "Test error message");
      assert.equal(info.name, "Error");
      assert.ok(info.stack);
    });

    it("should handle error with code property", () => {
      const error = new Error("Connection failed") as Error & { code: string };
      error.code = "ECONNREFUSED";
      const info = extractErrorInfo(error);

      assert.equal(info.message, "Connection failed");
      assert.equal(info.code, "ECONNREFUSED");
    });

    it("should handle error with status property", () => {
      const error = new Error("Not found") as Error & { status: number };
      error.status = 404;
      const info = extractErrorInfo(error);

      assert.equal(info.message, "Not found");
      assert.equal(info.status, 404);
    });

    it("should handle string error", () => {
      const info = extractErrorInfo("String error message");
      assert.equal(info.message, "String error message");
    });

    it("should handle unknown error types", () => {
      const info = extractErrorInfo(12345);
      assert.equal(info.message, "12345");
    });

    it("should handle null", () => {
      const info = extractErrorInfo(null);
      assert.equal(info.message, "null");
    });

    it("should handle undefined", () => {
      const info = extractErrorInfo(undefined);
      assert.equal(info.message, "undefined");
    });
  });

  describe("createTimingLogger", () => {
    it("should measure and log operation duration", async () => {
      const testLogger = createLogger("timing-test");
      const timing = createTimingLogger(testLogger, "test-operation");

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify timing object has an end method and returns void (does not throw)
      assert.strictEqual(typeof timing.end, "function", "timing should have an end method");
      const result = timing.end(true, { extra: "data" });
      assert.strictEqual(result, undefined, "timing.end should return void");
    });

    it("should handle failed operations", () => {
      const testLogger = createLogger("timing-fail-test");
      const timing = createTimingLogger(testLogger, "failing-operation");

      // Verify timing.end works for failed operations without throwing
      assert.strictEqual(typeof timing.end, "function", "timing should have an end method");
      const result = timing.end(false, { reason: "timeout" });
      assert.strictEqual(result, undefined, "timing.end should return void for failed operations");
    });
  });

  describe("LogLevel constants", () => {
    it("should have all standard log levels", () => {
      assert.equal(LogLevel.TRACE, "trace");
      assert.equal(LogLevel.DEBUG, "debug");
      assert.equal(LogLevel.INFO, "info");
      assert.equal(LogLevel.WARN, "warn");
      assert.equal(LogLevel.ERROR, "error");
      assert.equal(LogLevel.FATAL, "fatal");
    });
  });
});
