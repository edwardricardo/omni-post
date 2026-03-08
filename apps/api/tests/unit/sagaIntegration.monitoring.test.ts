/**
 * SagaIntegration — Monitoring Route Tests
 *
 * Validates the health-check, metrics and list endpoints exposed by
 * SagaIntegration:
 * - GET /api/sagas          — active-instance summary
 * - GET /api/sagas/health   — structured health status
 * - GET /api/sagas/metrics  — performance KPIs and success-rate calculation
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SagaIntegration } from "../../src/saga/SagaIntegration";
import { buildIntegration, passthroughReply } from "./sagaIntegration.helpers";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Monitoring Route Tests
// ============================================================================

describe("SagaIntegration - Monitoring Routes", { concurrency: 1 }, () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;

  beforeEach(async () => {
    ({ integration, routes } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should return saga list with metrics", async () => {
    const handler = routes.get("GET:/api/sagas");
    const result = await handler({}, passthroughReply);

    assert.ok(result.success, "Should return success");
    assert.ok("activeInstances" in result.data);
    assert.ok("totalStarted" in result.data);
    assert.ok("totalCompleted" in result.data);
    assert.ok("totalFailed" in result.data);
    assert.ok(Array.isArray(result.data.definitions));
  });

  it("should return saga health check status", async () => {
    const handler = routes.get("GET:/api/sagas/health");
    const result = await handler({}, passthroughReply);

    assert.ok(result.status, "Should have status field");
    assert.ok(result.details, "Should have details field");
    assert.ok(result.metrics, "Should include metrics");
    assert.ok(result.timestamp, "Should have timestamp");
  });

  it("should return saga metrics with performance data", async () => {
    const handler = routes.get("GET:/api/sagas/metrics");
    const result = await handler({}, passthroughReply);

    assert.ok(result.success, "Should return success");
    assert.ok(result.data.performance, "Should have performance metrics");
    assert.ok(result.data.active, "Should have active metrics");
    assert.ok(result.timestamp, "Should have timestamp");
  });

  it("should calculate success rate in metrics", async () => {
    const handler = routes.get("GET:/api/sagas/metrics");
    const result = await handler({}, passthroughReply);

    assert.ok(typeof result.data.performance.successRate === "number");
    assert.ok(
      result.data.performance.successRate >= 0 && result.data.performance.successRate <= 100
    );
  });

  it("should include definition count in metrics", async () => {
    const handler = routes.get("GET:/api/sagas/metrics");
    const result = await handler({}, passthroughReply);

    assert.ok(typeof result.data.active.definitions === "number");
    // At least post-publishing-saga must be registered
    assert.ok(result.data.active.definitions >= 1);
  });
});
