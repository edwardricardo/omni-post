/**
 * Correlation ID Middleware Tests
 *
 * Tests for the correlation ID middleware following TDD principles.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import {
  correlationMiddleware,
  getCorrelationId,
  getRequestId,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from "../../src/middleware/correlationMiddleware.js";

describe("Correlation ID Middleware", { concurrency: 1 }, () => {
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
      assert.ok(correlationId, "Should have correlation ID header");
      assert.ok(typeof correlationId === "string");
      assert.ok(correlationId.length > 0);

      const body = JSON.parse(response.body);
      assert.equal(body.correlationId, correlationId);
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
      assert.equal(correlationId, existingId);

      const body = JSON.parse(response.body);
      assert.equal(body.correlationId, existingId);
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
      assert.ok(correlationId);
      assert.ok(correlationId !== "");
    });
  });

  describe("request ID generation", () => {
    it("should always generate a new request ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      const requestId = response.headers[REQUEST_ID_HEADER];
      assert.ok(requestId, "Should have request ID header");
      assert.ok(typeof requestId === "string");
      assert.ok(requestId.length > 0);

      const body = JSON.parse(response.body);
      assert.equal(body.requestId, requestId);
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

      assert.notEqual(requestId1, requestId2, "Request IDs should be unique");
    });
  });

  describe("response headers", () => {
    it("should set correlation ID in response headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      assert.ok(response.headers[CORRELATION_ID_HEADER]);
    });

    it("should set request ID in response headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      assert.ok(response.headers[REQUEST_ID_HEADER]);
    });
  });

  describe("header constants", () => {
    it("should export correct correlation ID header name", () => {
      assert.equal(CORRELATION_ID_HEADER, "x-correlation-id");
    });

    it("should export correct request ID header name", () => {
      assert.equal(REQUEST_ID_HEADER, "x-request-id");
    });
  });
});

describe("Correlation ID utility functions", { concurrency: 1 }, () => {
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
      assert.ok(body.correlationIdFromUtil);
      assert.equal(body.correlationIdFromUtil, response.headers[CORRELATION_ID_HEADER]);
    });
  });

  describe("getRequestId", () => {
    it("should return request ID from request", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/utility-test",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.requestIdFromUtil);
      assert.equal(body.requestIdFromUtil, response.headers[REQUEST_ID_HEADER]);
    });
  });
});
