import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as client from "prom-client";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import { createTestRegistry, getCounterValue, getGaugeValue } from "./apiMetrics.test-helpers.js";

describe("ApiMetrics - Health Status Management", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should set API as healthy", async () => {
    apiMetrics.setHealthy();

    const healthValue = await getGaugeValue(apiMetrics.metrics.apiHealth);

    assert.strictEqual(healthValue, 1, "Should set health to 1");
  });

  it("should set API as unhealthy", async () => {
    apiMetrics.setUnhealthy();

    const healthValue = await getGaugeValue(apiMetrics.metrics.apiHealth);

    assert.strictEqual(healthValue, 0, "Should set health to 0");
  });

  it("should transition between health states", async () => {
    apiMetrics.setHealthy();
    let health = await getGaugeValue(apiMetrics.metrics.apiHealth);
    assert.strictEqual(health, 1, "Should be healthy");

    apiMetrics.setUnhealthy();
    health = await getGaugeValue(apiMetrics.metrics.apiHealth);
    assert.strictEqual(health, 0, "Should be unhealthy");

    apiMetrics.setHealthy();
    health = await getGaugeValue(apiMetrics.metrics.apiHealth);
    assert.strictEqual(health, 1, "Should be healthy again");
  });
});

describe("ApiMetrics - System Metrics Updates", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should update memory usage metrics", async () => {
    apiMetrics.updateMemoryUsage();

    const rss = await getGaugeValue(apiMetrics.metrics.memoryUsage, { type: "rss" });
    const heapUsed = await getGaugeValue(apiMetrics.metrics.memoryUsage, { type: "heapUsed" });
    const heapTotal = await getGaugeValue(apiMetrics.metrics.memoryUsage, { type: "heapTotal" });
    const external = await getGaugeValue(apiMetrics.metrics.memoryUsage, { type: "external" });

    assert.ok(rss > 0, "RSS should be positive");
    assert.ok(heapUsed > 0, "Heap used should be positive");
    assert.ok(heapTotal > 0, "Heap total should be positive");
    assert.ok(external >= 0, "External should be non-negative");
  });

  it("should update active connections count", async () => {
    const count = 42;

    apiMetrics.updateActiveConnections(count);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.activeConnections);

    assert.strictEqual(gaugeValue, count, "Should set active connections count");
  });
});

describe("ApiMetrics - Correlation ID Management", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should generate unique correlation IDs", () => {
    const id1 = apiMetrics.generateCorrelationId("request-1");
    const id2 = apiMetrics.generateCorrelationId("request-2");

    assert.notStrictEqual(id1, id2, "Correlation IDs should be unique");
    assert.ok(id1.length > 0, "Correlation ID should not be empty");
    assert.ok(id2.length > 0, "Correlation ID should not be empty");
  });

  it("should retrieve correlation ID by request ID", () => {
    const requestId = "request-123";
    const correlationId = apiMetrics.generateCorrelationId(requestId);

    const retrieved = apiMetrics.getCorrelationId(requestId);

    assert.strictEqual(retrieved, correlationId, "Should retrieve same correlation ID");
  });

  it("should return undefined for non-existent request ID", () => {
    const retrieved = apiMetrics.getCorrelationId("non-existent");

    assert.strictEqual(retrieved, undefined, "Should return undefined for missing ID");
  });

  it("should remove correlation ID", () => {
    const requestId = "request-456";
    apiMetrics.generateCorrelationId(requestId);

    apiMetrics.removeCorrelationId(requestId);

    const retrieved = apiMetrics.getCorrelationId(requestId);

    assert.strictEqual(retrieved, undefined, "Should not find removed correlation ID");
  });

  it("should track correlation count", async () => {
    const before = await getGaugeValue(apiMetrics.metrics.correlationTracker);

    apiMetrics.generateCorrelationId("req-1");
    apiMetrics.generateCorrelationId("req-2");

    const during = await getGaugeValue(apiMetrics.metrics.correlationTracker);

    apiMetrics.removeCorrelationId("req-1");
    apiMetrics.removeCorrelationId("req-2");

    const after = await getGaugeValue(apiMetrics.metrics.correlationTracker);

    assert.ok(during > before, "Should increment tracker on generate");
    assert.strictEqual(after, before, "Should decrement tracker on remove");
  });
});

describe("ApiMetrics - Provider API Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record provider API call", async () => {
    const provider = "twitter";
    const operation = "publish";

    const beforeCount = await getCounterValue(apiMetrics.metrics.providerApiCalls, {
      provider,
      operation,
      status: "success",
    });

    const finishFn = apiMetrics.recordProviderApiCall(provider, operation);
    finishFn("success");

    const afterCount = await getCounterValue(apiMetrics.metrics.providerApiCalls, {
      provider,
      operation,
      status: "success",
    });

    assert.ok(afterCount > beforeCount, "Should increment provider API call counter");
  });

  it("should record provider error", async () => {
    const provider = "twitter";
    const errorType = "rate_limit";
    const operation = "publish";

    const beforeCount = await getCounterValue(apiMetrics.metrics.providerApiErrors, {
      provider,
      error_type: errorType,
      operation,
    });

    apiMetrics.recordProviderError(provider, errorType, operation);

    const afterCount = await getCounterValue(apiMetrics.metrics.providerApiErrors, {
      provider,
      error_type: errorType,
      operation,
    });

    assert.ok(afterCount > beforeCount, "Should increment provider error counter");
  });

  it("should update provider health status", async () => {
    const provider = "twitter";

    apiMetrics.updateProviderHealth(provider, true);
    let health = await getGaugeValue(apiMetrics.metrics.providerHealthStatus, { provider });
    assert.strictEqual(health, 1, "Should set provider as healthy");

    apiMetrics.updateProviderHealth(provider, false);
    health = await getGaugeValue(apiMetrics.metrics.providerHealthStatus, { provider });
    assert.strictEqual(health, 0, "Should set provider as unhealthy");
  });
});

describe("ApiMetrics - Cache Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record cache hit", async () => {
    const operation = "get";
    const cacheType = "redis";

    const beforeCount = await getCounterValue(apiMetrics.metrics.cacheOperations, {
      operation,
      cache_type: cacheType,
      result: "hit",
    });

    const finishFn = apiMetrics.recordCacheOperation(operation, cacheType);
    finishFn("hit");

    const afterCount = await getCounterValue(apiMetrics.metrics.cacheOperations, {
      operation,
      cache_type: cacheType,
      result: "hit",
    });

    assert.ok(afterCount > beforeCount, "Should increment cache hit counter");
  });

  it("should record cache miss", async () => {
    const operation = "get";
    const cacheType = "memory";

    const beforeCount = await getCounterValue(apiMetrics.metrics.cacheOperations, {
      operation,
      cache_type: cacheType,
      result: "miss",
    });

    const finishFn = apiMetrics.recordCacheOperation(operation, cacheType);
    finishFn("miss");

    const afterCount = await getCounterValue(apiMetrics.metrics.cacheOperations, {
      operation,
      cache_type: cacheType,
      result: "miss",
    });

    assert.ok(afterCount > beforeCount, "Should increment cache miss counter");
  });

  it("should update cache size", async () => {
    const cacheType = "redis";
    const sizeInBytes = 1024 * 1024;

    apiMetrics.updateCacheSize(cacheType, sizeInBytes);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.cacheSize, {
      cache_type: cacheType,
    });

    assert.strictEqual(gaugeValue, sizeInBytes, "Should set cache size");
  });

  it("should record cache eviction", async () => {
    const cacheType = "memory";
    const reason = "size";

    const beforeCount = await getCounterValue(apiMetrics.metrics.cacheEvictions, {
      cache_type: cacheType,
      reason,
    });

    apiMetrics.recordCacheEviction(cacheType, reason);

    const afterCount = await getCounterValue(apiMetrics.metrics.cacheEvictions, {
      cache_type: cacheType,
      reason,
    });

    assert.ok(afterCount > beforeCount, "Should increment cache eviction counter");
  });

  it("should track different eviction reasons", async () => {
    const cacheType = "redis";
    const reasons: Array<"size" | "ttl" | "manual"> = ["size", "ttl", "manual"];

    for (const reason of reasons) {
      apiMetrics.recordCacheEviction(cacheType, reason);

      const count = await getCounterValue(apiMetrics.metrics.cacheEvictions, {
        cache_type: cacheType,
        reason,
      });

      assert.ok(count > 0, `Should record ${reason} eviction`);
    }
  });
});
