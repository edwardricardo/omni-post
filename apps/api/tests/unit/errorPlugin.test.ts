#!/usr/bin/env tsx
/**
 * Comprehensive Unit Tests for Error Handler Plugin
 * Target Coverage: 95%+
 *
 * Testing:
 * - Plugin registration
 * - Error handler setup
 * - Integration with Fastify
 * - Error interception
 * - Security sanitization
 *
 * Converted to node:test standard
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import errorHandlerPlugin from "../../src/lib/errors/errorPlugin.js";
import { AppError, ErrorCode } from "../../src/lib/errors/AppError.js";

describe("Error Handler Plugin - Registration", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
  });

  after(async () => {
    await app.close();
  });

  it("should register plugin successfully", async () => {
    assert.ok(app);
  });

  it("should have error handler set", async () => {
    // @ts-ignore - accessing internal property for testing
    assert.ok(app.errorHandler);
  });
});

describe("Error Handler Plugin - Error Handling", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    // Register test routes
    app.get("/test-apperror", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
        field: "email",
      });
    });

    app.get("/test-standard-error", async () => {
      throw new Error("Standard error");
    });

    app.get("/test-success", async () => {
      return { success: true };
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("should handle AppError and return proper response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-apperror",
    });

    assert.strictEqual(response.statusCode, 400);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, ErrorCode.VALIDATION_ERROR);
    assert.strictEqual(body.error.message, "Validation failed");
    assert.ok(body.error.requestId);
    assert.ok(body.error.timestamp);
  });

  it("should sanitize standard errors", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-standard-error",
    });

    assert.strictEqual(response.statusCode, 500);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, ErrorCode.INTERNAL_SERVER_ERROR);
    assert.strictEqual(body.error.message, "An unexpected error occurred");
    // Should not expose internal error details
    assert.ok(!body.error.message.includes("Standard error"));
  });

  it("should not interfere with successful responses", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-success",
    });

    assert.strictEqual(response.statusCode, 200);

    const body = JSON.parse(response.body);
    assert.deepStrictEqual(body, { success: true });
  });

  it("should include request ID in error response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-apperror",
    });

    const body = JSON.parse(response.body);
    assert.ok(body.error.requestId);
    assert.strictEqual(typeof body.error.requestId, "string");
  });

  it("should include timestamp in error response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-apperror",
    });

    const body = JSON.parse(response.body);
    assert.ok(body.error.timestamp);
    // Verify ISO format
    assert.ok(body.error.timestamp.match(/^\d{4}-\d{2}-\d{2}T/));
  });
});

describe("Error Handler Plugin - Security", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get("/test-prisma-error", async () => {
      const error: any = new Error("Prisma error");
      error.code = "P2002";
      error.meta = { target: ["email"] };
      error.constructor = { name: "PrismaClientKnownRequestError" };
      throw error;
    });

    app.get("/test-database-path", async () => {
      throw new Error("Connection failed at /var/lib/postgresql/data");
    });

    app.get("/test-stack-trace", async () => {
      const error = new Error("Internal error");
      error.stack = "Error: Internal error\n    at /app/src/sensitive/file.ts:123:45";
      throw error;
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("should not expose Prisma error codes in production", async () => {
    process.env.NODE_ENV = "production";

    const response = await app.inject({
      method: "GET",
      url: "/test-prisma-error",
    });

    const body = JSON.parse(response.body);
    // Should not include P2002 or Prisma-specific details
    assert.ok(!response.body.includes("P2002"));
    assert.ok(!response.body.includes("PrismaClient"));
    assert.strictEqual(body.error.details, undefined);

    process.env.NODE_ENV = "test";
  });

  it("should not expose internal paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-database-path",
    });

    const body = JSON.parse(response.body);
    // Should not include file paths
    assert.ok(!response.body.includes("/var/lib/postgresql"));
    assert.strictEqual(body.error.message, "An unexpected error occurred");
  });

  it("should not expose stack traces", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-stack-trace",
    });

    const _body = JSON.parse(response.body);
    // Should not include stack trace
    assert.ok(!response.body.includes("file.ts"));
    assert.ok(!response.body.includes("at /app/src"));
  });
});

describe("Error Handler Plugin - Development Mode", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = "development";

    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get("/test-with-details", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
        fields: ["email", "password"],
        reason: "invalid_format",
      });
    });

    await app.ready();
  });

  after(async () => {
    process.env.NODE_ENV = "test";
    await app.close();
  });

  it("should include error details in development", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-with-details",
    });

    const body = JSON.parse(response.body);
    assert.ok(body.error.details);
    assert.deepStrictEqual(body.error.details, {
      fields: ["email", "password"],
      reason: "invalid_format",
    });
  });
});

describe("Error Handler Plugin - HTTP Status Codes", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get("/test-400", async () => {
      throw AppError.badRequest("Bad request");
    });

    app.get("/test-401", async () => {
      throw AppError.unauthorized("Unauthorized");
    });

    app.get("/test-403", async () => {
      throw AppError.forbidden("Forbidden");
    });

    app.get("/test-404", async () => {
      throw AppError.notFound("User");
    });

    app.get("/test-409", async () => {
      throw AppError.conflict("Conflict");
    });

    app.get("/test-429", async () => {
      throw AppError.tooManyRequests("Rate limited", 60);
    });

    app.get("/test-500", async () => {
      throw AppError.internal("Internal error");
    });

    app.get("/test-502", async () => {
      throw AppError.externalService("Twitter API");
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("should return 400 for bad request", async () => {
    const response = await app.inject({ method: "GET", url: "/test-400" });
    assert.strictEqual(response.statusCode, 400);
  });

  it("should return 401 for unauthorized", async () => {
    const response = await app.inject({ method: "GET", url: "/test-401" });
    assert.strictEqual(response.statusCode, 401);
  });

  it("should return 403 for forbidden", async () => {
    const response = await app.inject({ method: "GET", url: "/test-403" });
    assert.strictEqual(response.statusCode, 403);
  });

  it("should return 404 for not found", async () => {
    const response = await app.inject({ method: "GET", url: "/test-404" });
    assert.strictEqual(response.statusCode, 404);
  });

  it("should return 409 for conflict", async () => {
    const response = await app.inject({ method: "GET", url: "/test-409" });
    assert.strictEqual(response.statusCode, 409);
  });

  it("should return 429 for rate limit", async () => {
    const response = await app.inject({ method: "GET", url: "/test-429" });
    assert.strictEqual(response.statusCode, 429);
  });

  it("should return 500 for internal error", async () => {
    const response = await app.inject({ method: "GET", url: "/test-500" });
    assert.strictEqual(response.statusCode, 500);
  });

  it("should return 502 for external service error", async () => {
    const response = await app.inject({ method: "GET", url: "/test-502" });
    assert.strictEqual(response.statusCode, 502);
  });
});

describe("Error Handler Plugin - Error Response Format", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get("/test-format", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("should have consistent error response format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-format",
    });

    const body = JSON.parse(response.body);

    // Verify structure
    assert.strictEqual(body.ok, false);
    assert.ok(body.error);
    assert.ok(body.error.code);
    assert.ok(body.error.message);
    assert.ok(body.error.requestId);
    assert.ok(body.error.timestamp);
  });

  it("should return JSON content type", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-format",
    });

    assert.ok(response.headers["content-type"]?.includes("application/json"));
  });
});

describe("Error Handler Plugin - Plugin Metadata", { concurrency: 1 }, () => {
  it("should have correct plugin name", () => {
    // Plugin metadata is set via fastify-plugin
    assert.strictEqual(errorHandlerPlugin[Symbol.for("plugin-meta")]?.name, "error-handler");
  });

  it("should specify Fastify version requirement", () => {
    assert.strictEqual(errorHandlerPlugin[Symbol.for("plugin-meta")]?.fastify, ">=5.0.0");
  });
});
