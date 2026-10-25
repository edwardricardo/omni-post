/**
 * @file errorHandler.inject.test.ts
 * @description Drives the production error handler through Fastify's inject the way index.ts wires
 *              it (`app.setErrorHandler(createErrorHandler(app.log))`): an AppError keeps its status
 *              and code, a plain Error is sanitised to 500, a successful route passes through, and
 *              every error body carries a request id and an ISO timestamp.
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

  it("stamps every error body with a request id and an ISO timestamp", async () => {
    const response = await app.inject({ method: "GET", url: "/app-error" });

    const body = JSON.parse(response.body);
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId.length).toBeGreaterThan(0);
    expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
