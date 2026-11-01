/**
 * SagaIntegration — Monitoring Route Tests
 *
 * Validates the metrics endpoint exposed by SagaIntegration and the
 * health status of the SagaManager it initialises:
 * - SagaManager.healthCheck — degraded after a boot load failure
 * - GET /api/sagas/metrics  — the recovery counters, as an exact set
 * - GET /api/sagas/metrics  — performance KPIs and success-rate calculation
 *
 * @file sagaIntegration.monitoring.test.ts
 * @description Tests for SagaIntegration - Monitoring Routes
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import { buildIntegration, passthroughReply } from "./sagaIntegration.helpers.js";

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

  it("should calculate success rate in metrics", async () => {
    const handler = routes.get("GET:/sagas/metrics");
    const result = await handler({}, passthroughReply);

    expect(typeof result.data.performance.successRate === "number").toBeTruthy();
    expect(
      result.data.performance.successRate >= 0 && result.data.performance.successRate <= 100
    ).toBeTruthy();
  });

  it("should include definition count in metrics", async () => {
    const handler = routes.get("GET:/sagas/metrics");
    const result = await handler({}, passthroughReply);

    expect(typeof result.data.active.definitions === "number").toBeTruthy();
    // At least post-publishing-saga must be registered
    expect(result.data.active.definitions >= 1).toBeTruthy();
  });

  it("should expose every recovery counter in metrics", async () => {
    // The engine's detached loops are invisible from the outside; this block is
    // the operator-facing snapshot for one process, and during an incident where
    // Prometheus is the thing that is down it is the ONLY place to read them. A
    // counter that stops being published here goes silent without anything
    // failing — including the two that are DECISIONS rather than failures
    // (`bootParkedSagas`, `bootLoadDeferred`), which is exactly why they are
    // pinned as an exact set and not a subset.
    const handler = routes.get("GET:/sagas/metrics");
    const result = await handler({}, passthroughReply);

    expect(result.data.recovery).toEqual({
      bootLoadFailures: 0,
      bootLoadDeferred: 0,
      bootParkedSagas: 0,
      bootResumeRowFailures: 0,
      compensatingOrphans: 0,
      recoveryScanFailures: 0,
      rehydrationFailures: 0,
      tenantMismatches: 0,
      instanceLoadFailures: 0,
      timeoutCheckFailures: 0,
    });
  });

  it("should report a boot load failure through the health status, not only the counters", async () => {
    const manager = integration.getSagaManager();
    const healthy = await manager.healthCheck();
    expect(healthy.status).toBe("healthy");
    expect(healthy.details.recoveredAtBoot).toBe(true);

    // A process whose boot recovery load failed is reachable but does not know
    // what was in flight. Reporting that as healthy is how a permanently blind
    // engine passes every probe it is asked.
    // `getMetrics()` returns a copy, so the counter is raised on the live
    // lifecycle the health check actually reads.
    (
      manager as unknown as { lifecycle: { metrics: { bootLoadFailures: number } } }
    ).lifecycle.metrics.bootLoadFailures = 1;

    const degraded = await manager.healthCheck();
    expect(degraded.status).toBe("degraded");
    expect(degraded.details.recoveredAtBoot).toBe(false);
    expect(degraded.details.database).toBe(true);
  });
});
