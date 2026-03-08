import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

    assert.ok(afterCount > beforeCount, "Should increment queue operation counter");
  });

  it("should track queue depth", async () => {
    const queueName = "publish";
    const depth = 42;

    apiMetrics.updateQueueDepth(queueName, depth);

    const gaugeValue = await getGaugeValue(apiMetrics.metrics.queueDepth, {
      queue_name: queueName,
    });

    assert.strictEqual(gaugeValue, depth, "Should set queue depth");
  });

  it("should update queue depth dynamically", async () => {
    const queueName = "publish";

    apiMetrics.updateQueueDepth(queueName, 10);
    let depth = await getGaugeValue(apiMetrics.metrics.queueDepth, { queue_name: queueName });
    assert.strictEqual(depth, 10, "Should set initial depth");

    apiMetrics.updateQueueDepth(queueName, 25);
    depth = await getGaugeValue(apiMetrics.metrics.queueDepth, { queue_name: queueName });
    assert.strictEqual(depth, 25, "Should update depth");

    apiMetrics.updateQueueDepth(queueName, 0);
    depth = await getGaugeValue(apiMetrics.metrics.queueDepth, { queue_name: queueName });
    assert.strictEqual(depth, 0, "Should clear depth");
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

    assert.ok(afterCount > beforeCount, "Should increment storage operation counter");
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

      assert.ok(count > 0, `Should record operation for ${provider}`);
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

    assert.ok(afterCount > beforeCount, "Should increment allowed rate limit counter");
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

    assert.ok(afterHits > beforeHits, "Should increment blocked rate limit hits");
    assert.ok(afterBlocks > beforeBlocks, "Should increment rate limit blocks");
  });

  it("should not record block without endpoint", async () => {
    const clientIp = "192.168.1.3";
    const allowed = false;

    apiMetrics.recordRateLimit(clientIp, allowed);

    const hitsCount = await getCounterValue(apiMetrics.metrics.rateLimitHits, {
      client_ip: clientIp,
      allowed: "false",
    });

    assert.ok(hitsCount > 0, "Should record rate limit hit even without endpoint");
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

    assert.ok(afterCount > beforeCount, "Should increment recoverable error counter");
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

    assert.ok(afterCount > beforeCount, "Should increment non-recoverable error counter");
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

    assert.ok(afterCount > beforeCount, "Should increment validation error counter");
  });
});
