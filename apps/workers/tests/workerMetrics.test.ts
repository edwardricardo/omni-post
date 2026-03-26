import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import { WorkerMetrics } from "../src/metrics/workerMetrics.js";

describe("WorkerMetrics", { concurrency: 1 }, () => {
  let registry: client.Registry;
  let metrics: WorkerMetrics;

  beforeEach(() => {
    registry = new client.Registry();
    metrics = new WorkerMetrics(registry);
  });

  describe("constructor", { concurrency: 1 }, () => {
    it("should create all expected metric collectors", () => {
      const m = metrics.metrics;

      assert.ok(m.publishOk, "publishOk counter should exist");
      assert.ok(m.publishErr, "publishErr counter should exist");
      assert.ok(m.publishDuration, "publishDuration histogram should exist");
      assert.ok(m.threadCreated, "threadCreated counter should exist");
      assert.ok(m.threadPublished, "threadPublished counter should exist");
      assert.ok(m.threadErrors, "threadErrors counter should exist");
      assert.ok(m.threadsInProgress, "threadsInProgress gauge should exist");
      assert.ok(m.threadTweetCount, "threadTweetCount histogram should exist");
      assert.ok(m.threadDuration, "threadDuration histogram should exist");
      assert.ok(m.jobsActive, "jobsActive gauge should exist");
      assert.ok(m.jobsCompleted, "jobsCompleted counter should exist");
      assert.ok(m.jobsFailed, "jobsFailed counter should exist");
      assert.ok(m.jobsSkipped, "jobsSkipped counter should exist");
      assert.ok(m.jobProcessingDuration, "jobProcessingDuration histogram should exist");
      assert.ok(m.queueDepth, "queueDepth gauge should exist");
      assert.ok(m.workerHealth, "workerHealth gauge should exist");
      assert.ok(m.correlationTracker, "correlationTracker gauge should exist");
      assert.ok(m.renderDuration, "renderDuration histogram should exist");
      assert.ok(m.dbOperationDuration, "dbOperationDuration histogram should exist");
      assert.ok(m.providerRequestDuration, "providerRequestDuration histogram should exist");
      assert.ok(m.errorsByType, "errorsByType counter should exist");
      assert.ok(m.retryAttempts, "retryAttempts counter should exist");
      assert.ok(m.circuitBreakerTrips, "circuitBreakerTrips counter should exist");
    });

    it("should set initial health status to 1 (healthy)", async () => {
      const value = await metrics.metrics.workerHealth.get();
      assert.strictEqual(value.values[0]?.value, 1);
    });

    it("should register metrics on the provided registry", async () => {
      const registeredMetrics = await registry.getMetricsAsJSON();
      const metricNames = registeredMetrics.map((m) => m.name);

      assert.ok(metricNames.includes("worker_publish_success_total"));
      assert.ok(metricNames.includes("worker_publish_errors_total"));
      assert.ok(metricNames.includes("worker_publish_duration_seconds"));
      assert.ok(metricNames.includes("worker_health_status"));
    });
  });

  describe("generateCorrelationId", { concurrency: 1 }, () => {
    it("should return a UUID string", () => {
      const id = metrics.generateCorrelationId("test-key");
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it("should store the correlation ID for the dedupe key", () => {
      const id = metrics.generateCorrelationId("key-1");
      const retrieved = metrics.getCorrelationId("key-1");
      assert.strictEqual(retrieved, id);
    });

    it("should increment the correlation tracker gauge", async () => {
      metrics.generateCorrelationId("key-1");
      metrics.generateCorrelationId("key-2");

      const value = await metrics.metrics.correlationTracker.get();
      assert.strictEqual(value.values[0]?.value, 2);
    });

    it("should overwrite correlation ID for the same dedupe key", () => {
      const id1 = metrics.generateCorrelationId("same-key");
      const id2 = metrics.generateCorrelationId("same-key");

      assert.notStrictEqual(id1, id2);
      assert.strictEqual(metrics.getCorrelationId("same-key"), id2);
    });
  });

  describe("removeCorrelationId", { concurrency: 1 }, () => {
    it("should remove the tracked correlation ID", () => {
      metrics.generateCorrelationId("key-remove");
      assert.ok(metrics.getCorrelationId("key-remove"));

      metrics.removeCorrelationId("key-remove");
      assert.strictEqual(metrics.getCorrelationId("key-remove"), undefined);
    });

    it("should decrement the correlation tracker gauge", async () => {
      metrics.generateCorrelationId("key-a");
      metrics.generateCorrelationId("key-b");
      metrics.removeCorrelationId("key-a");

      const value = await metrics.metrics.correlationTracker.get();
      assert.strictEqual(value.values[0]?.value, 1);
    });

    it("should be a no-op for non-existent keys", async () => {
      metrics.generateCorrelationId("existing");
      metrics.removeCorrelationId("non-existent");

      const value = await metrics.metrics.correlationTracker.get();
      // Only 1 (from generateCorrelationId), no decrement for non-existent
      assert.strictEqual(value.values[0]?.value, 1);
    });
  });

  describe("recordJobStart", { concurrency: 1 }, () => {
    it("should increment jobsActive gauge", async () => {
      metrics.recordJobStart();

      const value = await metrics.metrics.jobsActive.get();
      assert.strictEqual(value.values[0]?.value, 1);
    });

    it("should return a finish function that decrements jobsActive", async () => {
      const finish = metrics.recordJobStart();

      let value = await metrics.metrics.jobsActive.get();
      assert.strictEqual(value.values[0]?.value, 1);

      finish();

      value = await metrics.metrics.jobsActive.get();
      assert.strictEqual(value.values[0]?.value, 0);
    });

    it("should track multiple concurrent jobs", async () => {
      const finish1 = metrics.recordJobStart();
      const finish2 = metrics.recordJobStart();
      const finish3 = metrics.recordJobStart();

      let value = await metrics.metrics.jobsActive.get();
      assert.strictEqual(value.values[0]?.value, 3);

      finish1();
      finish2();

      value = await metrics.metrics.jobsActive.get();
      assert.strictEqual(value.values[0]?.value, 1);

      finish3();

      value = await metrics.metrics.jobsActive.get();
      assert.strictEqual(value.values[0]?.value, 0);
    });
  });

  describe("recordThreadStart", { concurrency: 1 }, () => {
    it("should increment threadsInProgress gauge for provider", async () => {
      metrics.recordThreadStart("x");

      const value = await metrics.metrics.threadsInProgress.get();
      const xGauge = value.values.find((v) => v.labels.provider === "x");
      assert.ok(xGauge);
      assert.strictEqual(xGauge.value, 1);
    });

    it("should return a finish function that decrements threadsInProgress", async () => {
      const finish = metrics.recordThreadStart("x");

      finish();

      const value = await metrics.metrics.threadsInProgress.get();
      const xGauge = value.values.find((v) => v.labels.provider === "x");
      assert.ok(xGauge);
      assert.strictEqual(xGauge.value, 0);
    });
  });

  describe("recordError", { concurrency: 1 }, () => {
    it("should increment errorsByType counter with correct labels", async () => {
      metrics.recordError("publisher", "provider_error", true);

      const value = await metrics.metrics.errorsByType.get();
      const match = value.values.find(
        (v) =>
          v.labels.component === "publisher" &&
          v.labels.error_type === "provider_error" &&
          v.labels.recoverable === "true"
      );
      assert.ok(match);
      assert.strictEqual(match.value, 1);
    });

    it("should track non-recoverable errors", async () => {
      metrics.recordError("database", "connection_lost", false);

      const value = await metrics.metrics.errorsByType.get();
      const match = value.values.find(
        (v) => v.labels.component === "database" && v.labels.recoverable === "false"
      );
      assert.ok(match);
      assert.strictEqual(match.value, 1);
    });
  });

  describe("getTweetCountRange", { concurrency: 1 }, () => {
    it("should return '1-2' for counts 1 and 2", () => {
      assert.strictEqual(metrics.getTweetCountRange(1), "1-2");
      assert.strictEqual(metrics.getTweetCountRange(2), "1-2");
    });

    it("should return '3-5' for counts 3 to 5", () => {
      assert.strictEqual(metrics.getTweetCountRange(3), "3-5");
      assert.strictEqual(metrics.getTweetCountRange(4), "3-5");
      assert.strictEqual(metrics.getTweetCountRange(5), "3-5");
    });

    it("should return '6-10' for counts 6 to 10", () => {
      assert.strictEqual(metrics.getTweetCountRange(6), "6-10");
      assert.strictEqual(metrics.getTweetCountRange(10), "6-10");
    });

    it("should return '11-20' for counts 11 to 20", () => {
      assert.strictEqual(metrics.getTweetCountRange(11), "11-20");
      assert.strictEqual(metrics.getTweetCountRange(20), "11-20");
    });

    it("should return '20+' for counts above 20", () => {
      assert.strictEqual(metrics.getTweetCountRange(21), "20+");
      assert.strictEqual(metrics.getTweetCountRange(100), "20+");
    });
  });

  describe("setHealthy / setUnhealthy", { concurrency: 1 }, () => {
    it("should set health gauge to 1 when healthy", async () => {
      metrics.setUnhealthy(); // first set unhealthy
      metrics.setHealthy();

      const value = await metrics.metrics.workerHealth.get();
      assert.strictEqual(value.values[0]?.value, 1);
    });

    it("should set health gauge to 0 when unhealthy", async () => {
      metrics.setUnhealthy();

      const value = await metrics.metrics.workerHealth.get();
      assert.strictEqual(value.values[0]?.value, 0);
    });
  });

  describe("updateQueueDepth", { concurrency: 1 }, () => {
    it("should set queue depth gauge to given value", async () => {
      metrics.updateQueueDepth(42);

      const value = await metrics.metrics.queueDepth.get();
      assert.strictEqual(value.values[0]?.value, 42);
    });

    it("should update to new values", async () => {
      metrics.updateQueueDepth(10);
      metrics.updateQueueDepth(5);

      const value = await metrics.metrics.queueDepth.get();
      assert.strictEqual(value.values[0]?.value, 5);
    });
  });

  describe("recordRetry", { concurrency: 1 }, () => {
    it("should increment retry attempts counter", async () => {
      metrics.recordRetry("publisher", "rate_limit");

      const value = await metrics.metrics.retryAttempts.get();
      const match = value.values.find(
        (v) => v.labels.component === "publisher" && v.labels.retry_reason === "rate_limit"
      );
      assert.ok(match);
      assert.strictEqual(match.value, 1);
    });
  });

  describe("recordCircuitBreakerTrip", { concurrency: 1 }, () => {
    it("should increment circuit breaker trips counter", async () => {
      metrics.recordCircuitBreakerTrip("database", "write_breaker");

      const value = await metrics.metrics.circuitBreakerTrips.get();
      const match = value.values.find(
        (v) => v.labels.component === "database" && v.labels.breaker_name === "write_breaker"
      );
      assert.ok(match);
      assert.strictEqual(match.value, 1);
    });
  });

  describe("getRegistry", { concurrency: 1 }, () => {
    it("should return the registry passed in constructor", () => {
      const returned = metrics.getRegistry();
      assert.strictEqual(returned, registry);
    });
  });
});
