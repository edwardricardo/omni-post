/**
 * Correlation ID Middleware Tests
 *
 * Tests for the correlation ID middleware following TDD principles.
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import {
  correlationMiddleware,
  getCorrelationId,
  getRequestId,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from "../../src/middleware/correlationMiddleware.js";

describe("Correlation ID Middleware", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await correlationMiddleware(app);

    // Add a test route
    app.get("/test", async (request, _reply) => {
      return {
        correlationId: request.correlationId,
        requestId: request.requestId,
      };
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("correlation ID generation", () => {
    it("should generate correlation ID when not provided", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      const correlationId = response.headers[CORRELATION_ID_HEADER];
      expect(correlationId).toBeTruthy();
      expect(typeof correlationId === "string").toBeTruthy();
      expect(correlationId.length > 0).toBeTruthy();

      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(correlationId);
    });

    it("should use existing correlation ID from request header", async () => {
      const existingId = "existing-correlation-id-12345";

      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CORRELATION_ID_HEADER]: existingId,
        },
      });

      const correlationId = response.headers[CORRELATION_ID_HEADER];
      expect(correlationId).toBe(existingId);

      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(existingId);
    });

    it("should generate new ID if header is empty string", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CORRELATION_ID_HEADER]: "",
        },
      });

      const correlationId = response.headers[CORRELATION_ID_HEADER];
      expect(correlationId).toBeTruthy();
      expect(correlationId !== "").toBeTruthy();
    });
  });

  describe("request ID generation", () => {
    it("should always generate a new request ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      const requestId = response.headers[REQUEST_ID_HEADER];
      expect(requestId).toBeTruthy();
      expect(typeof requestId === "string").toBeTruthy();
      expect(requestId.length > 0).toBeTruthy();

      const body = JSON.parse(response.body);
      expect(body.requestId).toBe(requestId);
    });

    it("should generate unique request IDs for each request", async () => {
      const response1 = await app.inject({
        method: "GET",
        url: "/test",
      });

      const response2 = await app.inject({
        method: "GET",
        url: "/test",
      });

      const requestId1 = response1.headers[REQUEST_ID_HEADER];
      const requestId2 = response2.headers[REQUEST_ID_HEADER];

      expect(requestId1).not.toBe(requestId2);
    });
  });

  describe("response headers", () => {
    it("should set correlation ID in response headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.headers[CORRELATION_ID_HEADER]).toBeTruthy();
    });

    it("should set request ID in response headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.headers[REQUEST_ID_HEADER]).toBeTruthy();
    });
  });

  describe("header constants", () => {
    it("should export correct correlation ID header name", () => {
      expect(CORRELATION_ID_HEADER).toBe("x-correlation-id");
    });

    it("should export correct request ID header name", () => {
      expect(REQUEST_ID_HEADER).toBe("x-request-id");
    });
  });
});

describe("Correlation ID utility functions", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await correlationMiddleware(app);

    app.get("/utility-test", async (request, _reply) => {
      return {
        correlationIdFromUtil: getCorrelationId(request),
        requestIdFromUtil: getRequestId(request),
      };
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("getCorrelationId", () => {
    it("should return correlation ID from request", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/utility-test",
      });

      const body = JSON.parse(response.body);
      expect(body.correlationIdFromUtil).toBeTruthy();
      expect(body.correlationIdFromUtil).toBe(response.headers[CORRELATION_ID_HEADER]);
    });
  });

  describe("getRequestId", () => {
    it("should return request ID from request", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/utility-test",
      });

      const body = JSON.parse(response.body);
      expect(body.requestIdFromUtil).toBeTruthy();
      expect(body.requestIdFromUtil).toBe(response.headers[REQUEST_ID_HEADER]);
    });
  });
});
