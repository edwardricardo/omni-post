/**
 * @file apiMetrics.monitoring.test.ts
 * @description Tests for ApiMetrics - Health Status Management
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
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

    expect(healthValue).toBe(1);
  });

  it("should set API as unhealthy", async () => {
    apiMetrics.setUnhealthy();

    const healthValue = await getGaugeValue(apiMetrics.metrics.apiHealth);

    expect(healthValue).toBe(0);
  });

  it("should transition between health states", async () => {
    apiMetrics.setHealthy();
    let health = await getGaugeValue(apiMetrics.metrics.apiHealth);
    expect(health).toBe(1);

    apiMetrics.setUnhealthy();
    health = await getGaugeValue(apiMetrics.metrics.apiHealth);
    expect(health).toBe(0);

    apiMetrics.setHealthy();
    health = await getGaugeValue(apiMetrics.metrics.apiHealth);
    expect(health).toBe(1);
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

    expect(rss > 0).toBeTruthy();
    expect(heapUsed > 0).toBeTruthy();
    expect(heapTotal > 0).toBeTruthy();
    expect(external >= 0).toBeTruthy();
  });

  it("should update active connections count", async () => {
    const count = 42;

    apiMetrics.updateActiveConnections(count);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.activeConnections);

    expect(gaugeValue).toBe(count);
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

    expect(id1).not.toBe(id2);
    expect(id1.length > 0).toBeTruthy();
    expect(id2.length > 0).toBeTruthy();
  });

  it("should retrieve correlation ID by request ID", () => {
    const requestId = "request-123";
    const correlationId = apiMetrics.generateCorrelationId(requestId);

    const retrieved = apiMetrics.getCorrelationId(requestId);

    expect(retrieved).toBe(correlationId);
  });

  it("should return undefined for non-existent request ID", () => {
    const retrieved = apiMetrics.getCorrelationId("non-existent");

    expect(retrieved).toBe(undefined);
  });

  it("should remove correlation ID", () => {
    const requestId = "request-456";
    apiMetrics.generateCorrelationId(requestId);

    apiMetrics.removeCorrelationId(requestId);

    const retrieved = apiMetrics.getCorrelationId(requestId);

    expect(retrieved).toBe(undefined);
  });

  it("should track correlation count", async () => {
    const before = await getGaugeValue(apiMetrics.metrics.correlationTracker);

    apiMetrics.generateCorrelationId("req-1");
    apiMetrics.generateCorrelationId("req-2");

    const during = await getGaugeValue(apiMetrics.metrics.correlationTracker);

    apiMetrics.removeCorrelationId("req-1");
    apiMetrics.removeCorrelationId("req-2");

    const after = await getGaugeValue(apiMetrics.metrics.correlationTracker);

    expect(during > before).toBeTruthy();
    expect(after).toBe(before);
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

    expect(afterCount > beforeCount).toBeTruthy();
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

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should update provider health status", async () => {
    const provider = "twitter";

    apiMetrics.updateProviderHealth(provider, true);
    let health = await getGaugeValue(apiMetrics.metrics.providerHealthStatus, { provider });
    expect(health).toBe(1);

    apiMetrics.updateProviderHealth(provider, false);
    health = await getGaugeValue(apiMetrics.metrics.providerHealthStatus, { provider });
    expect(health).toBe(0);
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

    expect(afterCount > beforeCount).toBeTruthy();
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

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should update cache size", async () => {
    const cacheType = "redis";
    const sizeInBytes = 1024 * 1024;

    apiMetrics.updateCacheSize(cacheType, sizeInBytes);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.cacheSize, {
      cache_type: cacheType,
    });

    expect(gaugeValue).toBe(sizeInBytes);
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

    expect(afterCount > beforeCount).toBeTruthy();
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

      expect(count > 0).toBeTruthy();
    }
  });
});
