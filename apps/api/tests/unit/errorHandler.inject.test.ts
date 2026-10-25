/**
 * @file errorHandler.inject.test.ts
 * @description Drives the production error handler through Fastify's inject the way index.ts wires
 *              it (`app.setErrorHandler(createErrorHandler(app.log))`): an AppError keeps its status
 *              and code, every AppError factory maps to its HTTP status, a plain Error is sanitised
 *              to 500, a successful route passes through, every error body carries a request id and
 *              an ISO timestamp, and in production neither a Prisma error code, an internal path nor
 *              a stack trace reaches the body.
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createErrorHandler } from "../../src/lib/errors/errorHandler.js";
import { AppError, ErrorCode } from "../../src/lib/errors/AppError.js";

describe("createErrorHandler through Fastify inject", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setErrorHandler(createErrorHandler(app.log));
    app.get("/app-error", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
        field: "email",
      });
    });
    app.get("/plain-error", async () => {
      throw new Error("Standard error");
    });
    app.get("/success", async () => ({ success: true }));
    app.get("/prisma-error", async () => {
      const error = new Error("Prisma error") as Error & { code?: string; meta?: unknown };
      error.code = "P2002";
      error.meta = { target: ["email"] };
      throw error;
    });
    app.get("/internal-path", async () => {
      throw new Error("Connection failed at /var/lib/postgresql/data");
    });
    app.get("/stack-trace", async () => {
      const error = new Error("Internal error");
      error.stack = "Error: Internal error\n    at /app/src/sensitive/file.ts:123:45";
      throw error;
    });
    const factories: ReadonlyArray<[string, () => AppError]> = [
      ["bad-request", () => AppError.badRequest("Bad request")],
      ["unauthorized", () => AppError.unauthorized("Unauthorized")],
      ["forbidden", () => AppError.forbidden("Forbidden")],
      ["not-found", () => AppError.notFound("User")],
      ["conflict", () => AppError.conflict("Conflict")],
      ["too-many-requests", () => AppError.tooManyRequests("Rate limited", 60)],
      ["internal", () => AppError.internal("Internal error")],
      ["external-service", () => AppError.externalService("Twitter API")],
    ];
    for (const [route, make] of factories) {
      app.get(`/factory/${route}`, async () => {
        throw make();
      });
    }
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the AppError's status and code with a JSON body", async () => {
    const response = await app.inject({ method: "GET", url: "/app-error" });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.message).toBe("Validation failed");
  });

  it("sanitises a plain Error to a 500 that hides its message", async () => {
    const response = await app.inject({ method: "GET", url: "/plain-error" });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(body.error.message.includes("Standard error")).toBe(false);
  });

  it("leaves a successful response untouched", async () => {
    const response = await app.inject({ method: "GET", url: "/success" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toStrictEqual({ success: true });
  });

  it.each([
    ["bad-request", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not-found", 404],
    ["conflict", 409],
    ["too-many-requests", 429],
    ["internal", 500],
    ["external-service", 502],
  ])("maps the %s factory to HTTP %i", async (route, status) => {
    const response = await app.inject({ method: "GET", url: `/factory/${route}` });

    expect(response.statusCode).toBe(status);
    expect(JSON.parse(response.body).ok).toBe(false);
  });

  it("hides a Prisma error code and its meta in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await app.inject({ method: "GET", url: "/prisma-error" });

      expect(response.statusCode).toBe(500);
      expect(response.body.includes("P2002")).toBe(false);
      expect(response.body.includes("email")).toBe(false);
      expect(JSON.parse(response.body).error.details).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("hides an internal path from the body", async () => {
    const response = await app.inject({ method: "GET", url: "/internal-path" });

    expect(response.body.includes("/var/lib/postgresql")).toBe(false);
    expect(JSON.parse(response.body).error.message).toBe("An unexpected error occurred");
  });

  it("hides the stack trace from the body", async () => {
    const response = await app.inject({ method: "GET", url: "/stack-trace" });

    expect(response.body.includes("file.ts")).toBe(false);
    expect(response.body.includes("at /app/src")).toBe(false);
  });

  it("stamps every error body with a request id and an ISO timestamp", async () => {
    const response = await app.inject({ method: "GET", url: "/app-error" });

    const body = JSON.parse(response.body);
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId.length).toBeGreaterThan(0);
    expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
