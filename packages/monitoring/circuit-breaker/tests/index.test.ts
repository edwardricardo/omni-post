/**
 * Circuit Breaker Monitor Tests
 *
 * Verifies that getServiceStatus, getAllServicesStatus, getAlertHistory
 * return real data from internal state — not hardcoded values.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreakerMonitor, type CircuitBreakerMetrics } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<CircuitBreakerMetrics> = {}): CircuitBreakerMetrics {
  return {
    service: "test-service",
    operation: "publish",
    state: "CLOSED",
    successCount: 100,
    failureCount: 0,
    timeoutCount: 0,
    rejectionCount: 0,
    errorRate: 0,
    responseTime: { min: 10, max: 200, avg: 50, p95: 150, p99: 190 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CircuitBreakerMonitor", () => {
  let monitor: CircuitBreakerMonitor;

  beforeEach(() => {
    monitor = new CircuitBreakerMonitor();
  });

  // ── getServiceStatus ────────────────────────────────────────────────

  describe("getServiceStatus", () => {
    it("returns SERVICE_NOT_FOUND for unknown service", () => {
      const result = monitor.getServiceStatus("non-existent");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error, "SERVICE_NOT_FOUND");
      }
    });

    it("returns healthy status for CLOSED service with low error rate", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "get-posts", state: "CLOSED", errorRate: 0.1 })
      );

      const result = monitor.getServiceStatus("api");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.service, "api");
        assert.equal(result.value.overallHealth, "healthy");
        assert.equal(result.value.operations.length, 1);

        const op = result.value.operations[0]!;
        assert.equal(op.operation, "get-posts");
        assert.equal(op.state, "CLOSED");
        assert.equal(op.health, "healthy");
        assert.equal(op.errorRate, 0.1);
      }
    });

    it("returns unhealthy status for OPEN service", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "db", operation: "query", state: "OPEN", errorRate: 0.9 })
      );

      const result = monitor.getServiceStatus("db");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.overallHealth, "unhealthy");

        const op = result.value.operations[0]!;
        assert.equal(op.state, "OPEN");
        assert.equal(op.health, "unhealthy");
      }
    });

    it("returns degraded status for HALF_OPEN service", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "redis", operation: "cache", state: "HALF_OPEN", errorRate: 0.3 })
      );

      const result = monitor.getServiceStatus("redis");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.overallHealth, "degraded");

        const op = result.value.operations[0]!;
        assert.equal(op.state, "HALF_OPEN");
        assert.equal(op.health, "degraded");
      }
    });

    it("returns degraded for CLOSED service with high error rate (>0.5)", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "CLOSED", errorRate: 0.7 })
      );

      const result = monitor.getServiceStatus("api");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.overallHealth, "degraded");
        assert.equal(result.value.operations[0]!.health, "degraded");
      }
    });

    it("tracks multiple operations per service", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "get-posts", state: "CLOSED", errorRate: 0 })
      );
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "OPEN", errorRate: 1 })
      );

      const result = monitor.getServiceStatus("api");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.operations.length, 2);
        // Overall should be unhealthy because one op is OPEN
        assert.equal(result.value.overallHealth, "unhealthy");
      }
    });
  });

  // ── getAllServicesStatus ─────────────────────────────────────────────

  describe("getAllServicesStatus", () => {
    it("returns empty array when no services registered", () => {
      const result = monitor.getAllServicesStatus();
      assert.equal(result.length, 0);
    });

    it("returns all registered services with correct state mapping", () => {
      monitor.updateMetrics(makeMetrics({ service: "api", operation: "get", state: "CLOSED" }));
      monitor.updateMetrics(makeMetrics({ service: "db", operation: "query", state: "OPEN" }));
      monitor.updateMetrics(
        makeMetrics({ service: "redis", operation: "cache", state: "HALF_OPEN" })
      );

      const result = monitor.getAllServicesStatus();
      assert.equal(result.length, 3);

      const api = result.find((s) => s.service === "api");
      const db = result.find((s) => s.service === "db");
      const redis = result.find((s) => s.service === "redis");

      assert.ok(api, "api service should be in results");
      assert.ok(db, "db service should be in results");
      assert.ok(redis, "redis service should be in results");

      assert.equal(api.operations[0]!.state, "closed");
      assert.equal(db.operations[0]!.state, "open");
      assert.equal(redis.operations[0]!.state, "half-open");
    });
  });

  // ── getAlertHistory ─────────────────────────────────────────────────

  describe("getAlertHistory", () => {
    it("returns empty array when no alerts triggered", () => {
      const history = monitor.getAlertHistory();
      assert.equal(history.length, 0);
    });

    it("records alerts when OPEN state triggers circuit_breaker_open rule", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "OPEN", errorRate: 1 })
      );

      const history = monitor.getAlertHistory();
      assert.ok(history.length > 0, "Should have at least one alert");

      const alert = history[0]!;
      assert.equal(alert.service, "api");
      assert.equal(alert.operation, "publish");
      assert.equal(alert.severity, "critical");
      assert.equal(alert.rule, "circuit_breaker_open");
    });

    it("respects limit parameter", () => {
      // Trigger multiple alerts by clearing cooldowns between each
      monitor.updateMetrics(
        makeMetrics({ service: "s1", operation: "op1", state: "OPEN", errorRate: 1 })
      );
      monitor.updateMetrics(
        makeMetrics({ service: "s2", operation: "op2", state: "OPEN", errorRate: 1 })
      );

      const limited = monitor.getAlertHistory(1);
      assert.equal(limited.length, 1);
    });

    it("returns alerts in reverse chronological order (newest first)", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "first", operation: "op", state: "OPEN", errorRate: 1 })
      );
      monitor.updateMetrics(
        makeMetrics({ service: "second", operation: "op", state: "OPEN", errorRate: 1 })
      );

      const history = monitor.getAlertHistory();
      assert.equal(history[0]!.service, "second");
    });
  });

  // ── clearAlertHistory ───────────────────────────────────────────────

  describe("clearAlertHistory", () => {
    it("clears all alert history", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "OPEN", errorRate: 1 })
      );
      assert.ok(monitor.getAlertHistory().length > 0);

      monitor.clearAlertHistory();
      assert.equal(monitor.getAlertHistory().length, 0);
    });
  });

  // ── Alert callbacks ─────────────────────────────────────────────────

  describe("onAlert callback", () => {
    it("fires callback when alert is triggered", () => {
      const alerts: Array<{ service: string; severity: string }> = [];
      monitor.onAlert((alert) => {
        alerts.push({ service: alert.service, severity: alert.severity });
      });

      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "OPEN", errorRate: 1 })
      );

      assert.ok(alerts.length > 0, "Callback should have been fired");
      assert.equal(alerts[0]!.service, "api");
      assert.equal(alerts[0]!.severity, "critical");
    });
  });
});
