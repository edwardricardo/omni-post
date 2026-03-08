import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as client from "prom-client";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import { createTestRegistry, getCounterValue, getGaugeValue } from "./apiMetrics.test-helpers.js";

describe("ApiMetrics - Initialization", () => {
  it("should initialize with all metric collectors", () => {
    const registry = createTestRegistry();
    const apiMetrics = new ApiMetrics(registry);

    assert.ok(apiMetrics.metrics, "Should have metrics object");
    assert.ok(apiMetrics.metrics.httpRequests, "Should have HTTP request counter");
    assert.ok(apiMetrics.metrics.httpDuration, "Should have HTTP duration histogram");
    assert.ok(apiMetrics.metrics.dbOperations, "Should have DB operations counter");
    assert.ok(apiMetrics.metrics.queueOperations, "Should have queue operations counter");
    assert.ok(apiMetrics.metrics.postsCreated, "Should have posts created counter");
    assert.ok(apiMetrics.metrics.rateLimitHits, "Should have rate limit hits counter");
  });

  it("should set initial healthy state", async () => {
    const registry = createTestRegistry();
    const apiMetrics = new ApiMetrics(registry);

    const healthValue = await getGaugeValue(apiMetrics.metrics.apiHealth);

    assert.strictEqual(healthValue, 1, "Initial health status should be 1 (healthy)");
  });

  it("should clear existing metrics on initialization", () => {
    const registry = createTestRegistry();

    new ApiMetrics(registry);

    assert.doesNotThrow(() => {
      new ApiMetrics(registry);
    }, "Should clear existing metrics without error");
  });

  it("should return registry for metrics endpoint", () => {
    const registry = createTestRegistry();
    const apiMetrics = new ApiMetrics(registry);

    const returnedRegistry = apiMetrics.getRegistry();

    assert.strictEqual(returnedRegistry, registry, "Should return the same registry instance");
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

    assert.ok(afterCount > beforeCount, "Should increment HTTP request counter");
  });

  it("should track in-flight requests", async () => {
    const method = "POST";
    const route = "/api/posts";

    const beforeInFlight = await getGaugeValue(apiMetrics.metrics.httpRequestsInFlight);

    const finishFn = apiMetrics.recordRequest(method, route);

    const duringInFlight = await getGaugeValue(apiMetrics.metrics.httpRequestsInFlight);

    finishFn(201);

    const afterInFlight = await getGaugeValue(apiMetrics.metrics.httpRequestsInFlight);

    assert.ok(duringInFlight > beforeInFlight, "Should increment in-flight during request");
    assert.strictEqual(
      afterInFlight,
      beforeInFlight,
      "Should decrement in-flight after request completes"
    );
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

    assert.ok(count200 > 0, "Should count 2xx responses");
    assert.ok(count404 > 0, "Should count 4xx responses");
    assert.ok(count500 > 0, "Should count 5xx responses");
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

      assert.ok(count > 0, `Should record ${method} request`);
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

    assert.ok(afterCount > beforeCount, "Should increment endpoint request counter");
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

    assert.ok(successCount > 0, "Should count successful requests");
    assert.ok(errorCount > 0, "Should count error requests");
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

    assert.ok(afterCount > beforeCount, "Should increment DB operation counter");
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

    assert.ok(afterCount > beforeCount, "Should increment DB error counter");
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

      assert.ok(count > 0, `Should record ${operation} operation`);
    }
  });

  it("should update database connection count", async () => {
    const pool = "main";
    const count = 10;

    apiMetrics.updateDbConnections(pool, count);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.dbConnections, { pool });

    assert.strictEqual(gaugeValue, count, "Should set DB connection count");
  });
});
