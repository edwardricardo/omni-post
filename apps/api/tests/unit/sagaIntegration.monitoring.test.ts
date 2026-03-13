/**
 * SagaIntegration — Monitoring Route Tests
 *
 * Validates the health-check, metrics and list endpoints exposed by
 * SagaIntegration:
 * - GET /api/sagas          — active-instance summary
 * - GET /api/sagas/health   — structured health status
 * - GET /api/sagas/metrics  — performance KPIs and success-rate calculation
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
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

describe("SagaIntegration - Monitoring Routes", () => {
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

    expect(result.success).toBeTruthy();
    expect("activeInstances" in result.data).toBeTruthy();
    expect("totalStarted" in result.data).toBeTruthy();
    expect("totalCompleted" in result.data).toBeTruthy();
    expect("totalFailed" in result.data).toBeTruthy();
    expect(Array.isArray(result.data.definitions)).toBeTruthy();
  });

  it("should return saga health check status", async () => {
    const handler = routes.get("GET:/api/sagas/health");
    const result = await handler({}, passthroughReply);

    expect(result.status).toBeTruthy();
    expect(result.details).toBeTruthy();
    expect(result.metrics).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
  });

  it("should return saga metrics with performance data", async () => {
    const handler = routes.get("GET:/api/sagas/metrics");
    const result = await handler({}, passthroughReply);

    expect(result.success).toBeTruthy();
    expect(result.data.performance).toBeTruthy();
    expect(result.data.active).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
  });

  it("should calculate success rate in metrics", async () => {
    const handler = routes.get("GET:/api/sagas/metrics");
    const result = await handler({}, passthroughReply);

    expect(typeof result.data.performance.successRate === "number").toBeTruthy();
    expect(
      result.data.performance.successRate >= 0 && result.data.performance.successRate <= 100
    ).toBeTruthy();
  });

  it("should include definition count in metrics", async () => {
    const handler = routes.get("GET:/api/sagas/metrics");
    const result = await handler({}, passthroughReply);

    expect(typeof result.data.active.definitions === "number").toBeTruthy();
    // At least post-publishing-saga must be registered
    expect(result.data.active.definitions >= 1).toBeTruthy();
  });
});
