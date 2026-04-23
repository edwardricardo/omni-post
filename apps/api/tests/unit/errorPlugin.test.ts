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
 *
 * @file errorPlugin.test.ts
 * @description Tests for Error Handler Plugin - Registration
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import errorHandlerPlugin from "../../src/lib/errors/errorPlugin.js";
import { AppError, ErrorCode } from "../../src/lib/errors/AppError.js";

describe("Error Handler Plugin - Registration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should register plugin successfully", async () => {
    expect(app).toBeTruthy();
  });

  it("should have error handler set", async () => {
    // @ts-ignore - accessing internal property for testing
    expect(app.errorHandler).toBeTruthy();
  });
});

describe("Error Handler Plugin - Error Handling", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
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

  afterAll(async () => {
    await app.close();
  });

  it("should handle AppError and return proper response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-apperror",
    });

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.message).toBe("Validation failed");
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.timestamp).toBeTruthy();
  });

  it("should sanitize standard errors", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-standard-error",
    });

    expect(response.statusCode).toBe(500);

    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe("An unexpected error occurred");
    // Should not expose internal error details
    expect(body.error.message.includes("Standard error")).toBeFalsy();
  });

  it("should not interfere with successful responses", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-success",
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toStrictEqual({ success: true });
  });

  it("should include request ID in error response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-apperror",
    });

    const body = JSON.parse(response.body);
    expect(body.error.requestId).toBeTruthy();
    expect(typeof body.error.requestId).toBe("string");
  });

  it("should include timestamp in error response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-apperror",
    });

    const body = JSON.parse(response.body);
    expect(body.error.timestamp).toBeTruthy();
    // Verify ISO format
    expect(body.error.timestamp.match(/^\d{4}-\d{2}-\d{2}T/)).toBeTruthy();
  });
});

describe("Error Handler Plugin - Security", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
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

  afterAll(async () => {
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
    expect(response.body.includes("P2002")).toBeFalsy();
    expect(response.body.includes("PrismaClient")).toBeFalsy();
    expect(body.error.details).toBe(undefined);

    process.env.NODE_ENV = "test";
  });

  it("should not expose internal paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-database-path",
    });

    const body = JSON.parse(response.body);
    // Should not include file paths
    expect(response.body.includes("/var/lib/postgresql")).toBeFalsy();
    expect(body.error.message).toBe("An unexpected error occurred");
  });

  it("should not expose stack traces", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-stack-trace",
    });

    const _body = JSON.parse(response.body);
    // Should not include stack trace
    expect(response.body.includes("file.ts")).toBeFalsy();
    expect(response.body.includes("at /app/src")).toBeFalsy();
  });
});

describe("Error Handler Plugin - Development Mode", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
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

  afterAll(async () => {
    process.env.NODE_ENV = "test";
    await app.close();
  });

  it("should include error details in development", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-with-details",
    });

    const body = JSON.parse(response.body);
    expect(body.error.details).toBeTruthy();
    expect(body.error.details).toStrictEqual({
      fields: ["email", "password"],
      reason: "invalid_format",
    });
  });
});

describe("Error Handler Plugin - HTTP Status Codes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
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

  afterAll(async () => {
    await app.close();
  });

  it("should return 400 for bad request", async () => {
    const response = await app.inject({ method: "GET", url: "/test-400" });
    expect(response.statusCode).toBe(400);
  });

  it("should return 401 for unauthorized", async () => {
    const response = await app.inject({ method: "GET", url: "/test-401" });
    expect(response.statusCode).toBe(401);
  });

  it("should return 403 for forbidden", async () => {
    const response = await app.inject({ method: "GET", url: "/test-403" });
    expect(response.statusCode).toBe(403);
  });

  it("should return 404 for not found", async () => {
    const response = await app.inject({ method: "GET", url: "/test-404" });
    expect(response.statusCode).toBe(404);
  });

  it("should return 409 for conflict", async () => {
    const response = await app.inject({ method: "GET", url: "/test-409" });
    expect(response.statusCode).toBe(409);
  });

  it("should return 429 for rate limit", async () => {
    const response = await app.inject({ method: "GET", url: "/test-429" });
    expect(response.statusCode).toBe(429);
  });

  it("should return 500 for internal error", async () => {
    const response = await app.inject({ method: "GET", url: "/test-500" });
    expect(response.statusCode).toBe(500);
  });

  it("should return 502 for external service error", async () => {
    const response = await app.inject({ method: "GET", url: "/test-502" });
    expect(response.statusCode).toBe(502);
  });
});

describe("Error Handler Plugin - Error Response Format", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get("/test-format", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should have consistent error response format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-format",
    });

    const body = JSON.parse(response.body);

    // Verify structure
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBeTruthy();
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.timestamp).toBeTruthy();
  });

  it("should return JSON content type", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test-format",
    });

    expect(response.headers["content-type"]?.includes("application/json")).toBeTruthy();
  });
});

describe("Error Handler Plugin - Plugin Metadata", () => {
  it("should have correct plugin name", () => {
    // Plugin metadata is set via fastify-plugin
    expect(errorHandlerPlugin[Symbol.for("plugin-meta")]?.name).toBe("error-handler");
  });

  it("should specify Fastify version requirement", () => {
    expect(errorHandlerPlugin[Symbol.for("plugin-meta")]?.fastify).toBe(">=5.0.0");
  });
});
