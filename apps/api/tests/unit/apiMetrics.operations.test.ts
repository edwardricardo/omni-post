/**
 * @file apiMetrics.operations.test.ts
 * @description Tests for ApiMetrics - Queue Operation Metrics
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import * as client from "prom-client";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import { createTestRegistry, getCounterValue, getGaugeValue } from "./apiMetrics.test-helpers.js";

describe("ApiMetrics - Queue Operation Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record queue operation", async () => {
    const operation = "enqueue";
    const queueName = "publish";

    const beforeCount = await getCounterValue(apiMetrics.metrics.queueOperations, {
      operation,
      queue_name: queueName,
      result: "success",
    });

    const finishFn = apiMetrics.recordQueueOperation(operation, queueName);
    finishFn("success");

    const afterCount = await getCounterValue(apiMetrics.metrics.queueOperations, {
      operation,
      queue_name: queueName,
      result: "success",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should track queue depth", async () => {
    const queueName = "publish";
    const depth = 42;

    apiMetrics.updateQueueDepth(queueName, depth);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.queueDepth, {
      queue_name: queueName,
    });

    expect(gaugeValue).toBe(depth);
  });

  it("should update queue depth dynamically", async () => {
    const queueName = "publish";

    apiMetrics.updateQueueDepth(queueName, 10);
    let depth = await getGaugeValue(apiMetrics.metrics.queueDepth, { queue_name: queueName });
    expect(depth).toBe(10);

    apiMetrics.updateQueueDepth(queueName, 25);
    depth = await getGaugeValue(apiMetrics.metrics.queueDepth, { queue_name: queueName });
    expect(depth).toBe(25);

    apiMetrics.updateQueueDepth(queueName, 0);
    depth = await getGaugeValue(apiMetrics.metrics.queueDepth, { queue_name: queueName });
    expect(depth).toBe(0);
  });
});

describe("ApiMetrics - Storage Operation Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record storage operation", async () => {
    const operation = "upload";
    const provider = "s3";

    const beforeCount = await getCounterValue(apiMetrics.metrics.storageOperations, {
      operation,
      provider,
      result: "success",
    });

    const finishFn = apiMetrics.recordStorageOperation(operation, provider);
    finishFn("success");

    const afterCount = await getCounterValue(apiMetrics.metrics.storageOperations, {
      operation,
      provider,
      result: "success",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should track different storage providers", async () => {
    const providers = ["s3", "gcs", "azure"];
    const operation = "upload";

    for (const provider of providers) {
      const finishFn = apiMetrics.recordStorageOperation(operation, provider);
      finishFn("success");

      const count = await getCounterValue(apiMetrics.metrics.storageOperations, {
        operation,
        provider,
        result: "success",
      });

      expect(count > 0).toBeTruthy();
    }
  });
});

describe("ApiMetrics - Rate Limiting Metrics", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record allowed rate limit check", async () => {
    const clientIp = "192.168.1.1";
    const allowed = true;

    const beforeCount = await getCounterValue(apiMetrics.metrics.rateLimitHits, {
      client_ip: clientIp,
      allowed: "true",
    });

    apiMetrics.recordRateLimit(clientIp, allowed);

    const afterCount = await getCounterValue(apiMetrics.metrics.rateLimitHits, {
      client_ip: clientIp,
      allowed: "true",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should record blocked rate limit check", async () => {
    const clientIp = "192.168.1.2";
    const allowed = false;
    const endpoint = "/api/posts";

    const beforeHits = await getCounterValue(apiMetrics.metrics.rateLimitHits, {
      client_ip: clientIp,
      allowed: "false",
    });
    const beforeBlocks = await getCounterValue(apiMetrics.metrics.rateLimitBlocks, {
      client_ip: clientIp,
      endpoint,
    });

    apiMetrics.recordRateLimit(clientIp, allowed, endpoint);

    const afterHits = await getCounterValue(apiMetrics.metrics.rateLimitHits, {
      client_ip: clientIp,
      allowed: "false",
    });
    const afterBlocks = await getCounterValue(apiMetrics.metrics.rateLimitBlocks, {
      client_ip: clientIp,
      endpoint,
    });

    expect(afterHits > beforeHits).toBeTruthy();
    expect(afterBlocks > beforeBlocks).toBeTruthy();
  });

  it("should not record block without endpoint", async () => {
    const clientIp = "192.168.1.3";
    const allowed = false;

    apiMetrics.recordRateLimit(clientIp, allowed);

    const hitsCount = await getCounterValue(apiMetrics.metrics.rateLimitHits, {
      client_ip: clientIp,
      allowed: "false",
    });

    expect(hitsCount > 0).toBeTruthy();
  });
});

describe("ApiMetrics - Error Recording", () => {
  let registry: client.Registry;
  let apiMetrics: ApiMetrics;

  beforeEach(() => {
    registry = createTestRegistry();
    apiMetrics = new ApiMetrics(registry);
  });

  it("should record recoverable error", async () => {
    const component = "database";
    const errorType = "timeout";
    const isRecoverable = true;

    const beforeCount = await getCounterValue(apiMetrics.metrics.errorsByType, {
      component,
      error_type: errorType,
      recoverable: "true",
    });

    apiMetrics.recordError(component, errorType, isRecoverable);

    const afterCount = await getCounterValue(apiMetrics.metrics.errorsByType, {
      component,
      error_type: errorType,
      recoverable: "true",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should record non-recoverable error", async () => {
    const component = "auth";
    const errorType = "invalid_credentials";
    const isRecoverable = false;

    const beforeCount = await getCounterValue(apiMetrics.metrics.errorsByType, {
      component,
      error_type: errorType,
      recoverable: "false",
    });

    apiMetrics.recordError(component, errorType, isRecoverable);

    const afterCount = await getCounterValue(apiMetrics.metrics.errorsByType, {
      component,
      error_type: errorType,
      recoverable: "false",
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should record validation error", async () => {
    const endpoint = "/api/posts";
    const field = "content";
    const validationType = "required";

    const beforeCount = await getCounterValue(apiMetrics.metrics.validationErrors, {
      endpoint,
      field,
      validation_type: validationType,
    });

    apiMetrics.recordValidationError(endpoint, field, validationType);

    const afterCount = await getCounterValue(apiMetrics.metrics.validationErrors, {
      endpoint,
      field,
      validation_type: validationType,
    });

    expect(afterCount > beforeCount).toBeTruthy();
  });
});
