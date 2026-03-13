import { describe, it, beforeEach, expect } from "vitest";
import * as client from "prom-client";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import { createTestRegistry, getCounterValue, getGaugeValue } from "./apiMetrics.test-helpers.js";

describe("ApiMetrics - Initialization", () => {
  it("should initialize with all metric collectors", () => {
    const registry = createTestRegistry();
    const apiMetrics = new ApiMetrics(registry);

    expect(apiMetrics.metrics).toBeTruthy();
    expect(apiMetrics.metrics.httpRequests).toBeTruthy();
    expect(apiMetrics.metrics.httpDuration).toBeTruthy();
    expect(apiMetrics.metrics.dbOperations).toBeTruthy();
    expect(apiMetrics.metrics.queueOperations).toBeTruthy();
    expect(apiMetrics.metrics.postsCreated).toBeTruthy();
    expect(apiMetrics.metrics.rateLimitHits).toBeTruthy();
  });

  it("should set initial healthy state", async () => {
    const registry = createTestRegistry();
    const apiMetrics = new ApiMetrics(registry);

    const healthValue = await getGaugeValue(apiMetrics.metrics.apiHealth);

    expect(healthValue).toBe(1);
  });

  it("should clear existing metrics on initialization", () => {
    const registry = createTestRegistry();

    new ApiMetrics(registry);

    expect(() => {
      new ApiMetrics(registry);
    }).not.toThrow();
  });

  it("should return registry for metrics endpoint", () => {
    const registry = createTestRegistry();
    const apiMetrics = new ApiMetrics(registry);

    const returnedRegistry = apiMetrics.getRegistry();

    expect(returnedRegistry).toBe(registry);
  });
});

describe("ApiMetrics - HTTP Request Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record successful HTTP request", async () => {
    const method = "GET";
    const route = "/api/posts";
    const statusCode = 200;

    const beforeCount = await getCounterValue(apiMetrics.metrics.httpRequests, {
      method,
      route,
      status_code: statusCode.toString(),
    });

    const finishFn = apiMetrics.recordRequest(method, route);
    finishFn(statusCode);

    const afterCount = await getCounterValue(apiMetrics.metrics.httpRequests, {
      method,
      route,
      status_code: statusCode.toString(),
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should track in-flight requests", async () => {
    const method = "POST";
    const route = "/api/posts";

    const beforeInFlight = await getGaugeValue(apiMetrics.metrics.httpRequestsInFlight);

    const finishFn = apiMetrics.recordRequest(method, route);

    const duringInFlight = await getGaugeValue(apiMetrics.metrics.httpRequestsInFlight);

    finishFn(201);

    const afterInFlight = await getGaugeValue(apiMetrics.metrics.httpRequestsInFlight);

    expect(duringInFlight > beforeInFlight).toBeTruthy();
    expect(afterInFlight).toBe(beforeInFlight);
  });

  it("should group status codes by class", async () => {
    const method = "GET";
    const route = "/api/posts";

    const finish200 = apiMetrics.recordRequest(method, route);
    finish200(200);

    const finish404 = apiMetrics.recordRequest(method, route);
    finish404(404);

    const finish500 = apiMetrics.recordRequest(method, route);
    finish500(500);

    const count200 = await getCounterValue(apiMetrics.metrics.httpRequests, {
      method,
      route,
      status_code: "200",
    });
    const count404 = await getCounterValue(apiMetrics.metrics.httpRequests, {
      method,
      route,
      status_code: "404",
    });
    const count500 = await getCounterValue(apiMetrics.metrics.httpRequests, {
      method,
      route,
      status_code: "500",
    });

    expect(count200 > 0).toBeTruthy();
    expect(count404 > 0).toBeTruthy();
    expect(count500 > 0).toBeTruthy();
  });

  it("should handle different HTTP methods", async () => {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    const route = "/api/posts";

    for (const method of methods) {
      const finishFn = apiMetrics.recordRequest(method, route);
      finishFn(200);

      const count = await getCounterValue(apiMetrics.metrics.httpRequests, {
        method,
        route,
        status_code: "200",
      });

      expect(count > 0).toBeTruthy();
    }
  });
});

describe("ApiMetrics - Endpoint Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record endpoint request with status", async () => {
    const endpoint = "/api/posts";
    const method = "GET";
    const status = "success";

    const beforeCount = await getCounterValue(apiMetrics.metrics.endpointRequests, {
      endpoint,
      method,
      status,
    });

    const finishFn = apiMetrics.recordEndpointRequest(endpoint, method);
    finishFn(status);

    const afterCount = await getCounterValue(apiMetrics.metrics.endpointRequests, {
      endpoint,
      method,
      status,
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should track different endpoint statuses", async () => {
    const endpoint = "/api/posts";
    const method = "POST";

    const finishSuccess = apiMetrics.recordEndpointRequest(endpoint, method);
    finishSuccess("success");

    const finishError = apiMetrics.recordEndpointRequest(endpoint, method);
    finishError("error");

    const successCount = await getCounterValue(apiMetrics.metrics.endpointRequests, {
      endpoint,
      method,
      status: "success",
    });
    const errorCount = await getCounterValue(apiMetrics.metrics.endpointRequests, {
      endpoint,
      method,
      status: "error",
    });

    expect(successCount > 0).toBeTruthy();
    expect(errorCount > 0).toBeTruthy();
  });
});

describe("ApiMetrics - Database Operation Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record successful database operation", async () => {
    const operation = "SELECT";
    const table = "posts";

    const beforeCount = await getCounterValue(apiMetrics.metrics.dbOperations, {
      operation,
      table,
      result: "success",
    });

    const finishFn = apiMetrics.recordDbOperation(operation, table);
    finishFn("success");

    const afterCount = await getCounterValue(apiMetrics.metrics.dbOperations, {
      operation,
      table,
      result: "success",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should record failed database operation", async () => {
    const operation = "INSERT";
    const table = "posts";

    const beforeCount = await getCounterValue(apiMetrics.metrics.dbOperations, {
      operation,
      table,
      result: "error",
    });

    const finishFn = apiMetrics.recordDbOperation(operation, table);
    finishFn("error");

    const afterCount = await getCounterValue(apiMetrics.metrics.dbOperations, {
      operation,
      table,
      result: "error",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should track database operations by type", async () => {
    const operations = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const table = "posts";

    for (const operation of operations) {
      const finishFn = apiMetrics.recordDbOperation(operation, table);
      finishFn("success");

      const count = await getCounterValue(apiMetrics.metrics.dbOperations, {
        operation,
        table,
        result: "success",
      });

      expect(count > 0).toBeTruthy();
    }
  });

  it("should update database connection count", async () => {
    const pool = "main";
    const count = 10;

    apiMetrics.updateDbConnections(pool, count);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.dbConnections, { pool });

    expect(gaugeValue).toBe(count);
  });
});
