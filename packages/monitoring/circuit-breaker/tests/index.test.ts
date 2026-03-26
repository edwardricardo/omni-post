/**
 * Circuit Breaker Monitor Tests
 *
 * Verifies that getServiceStatus, getAllServicesStatus, getAlertHistory
 * return real data from internal state — not hardcoded values.
 */
import { describe, it, beforeEach, expect } from "vitest";
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
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("SERVICE_NOT_FOUND");
      }
    });

    it("returns healthy status for CLOSED service with low error rate", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "get-posts", state: "CLOSED", errorRate: 0.1 })
      );

      const result = monitor.getServiceStatus("api");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.service).toBe("api");
        expect(result.value.overallHealth).toBe("healthy");
        expect(result.value.operations.length).toBe(1);

        const op = result.value.operations[0]!;
        expect(op.operation).toBe("get-posts");
        expect(op.state).toBe("CLOSED");
        expect(op.health).toBe("healthy");
        expect(op.errorRate).toBe(0.1);
      }
    });

    it("returns unhealthy status for OPEN service", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "db", operation: "query", state: "OPEN", errorRate: 0.9 })
      );

      const result = monitor.getServiceStatus("db");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.overallHealth).toBe("unhealthy");

        const op = result.value.operations[0]!;
        expect(op.state).toBe("OPEN");
        expect(op.health).toBe("unhealthy");
      }
    });

    it("returns degraded status for HALF_OPEN service", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "redis", operation: "cache", state: "HALF_OPEN", errorRate: 0.3 })
      );

      const result = monitor.getServiceStatus("redis");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.overallHealth).toBe("degraded");

        const op = result.value.operations[0]!;
        expect(op.state).toBe("HALF_OPEN");
        expect(op.health).toBe("degraded");
      }
    });

    it("returns degraded for CLOSED service with high error rate (>0.5)", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "CLOSED", errorRate: 0.7 })
      );

      const result = monitor.getServiceStatus("api");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.overallHealth).toBe("degraded");
        expect(result.value.operations[0]!.health).toBe("degraded");
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
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.operations.length).toBe(2);
        // Overall should be unhealthy because one op is OPEN
        expect(result.value.overallHealth).toBe("unhealthy");
      }
    });
  });

  // ── getAllServicesStatus ─────────────────────────────────────────────

  describe("getAllServicesStatus", () => {
    it("returns empty array when no services registered", () => {
      const result = monitor.getAllServicesStatus();
      expect(result.length).toBe(0);
    });

    it("returns all registered services with correct state mapping", () => {
      monitor.updateMetrics(makeMetrics({ service: "api", operation: "get", state: "CLOSED" }));
      monitor.updateMetrics(makeMetrics({ service: "db", operation: "query", state: "OPEN" }));
      monitor.updateMetrics(
        makeMetrics({ service: "redis", operation: "cache", state: "HALF_OPEN" })
      );

      const result = monitor.getAllServicesStatus();
      expect(result.length).toBe(3);

      const api = result.find((s) => s.service === "api");
      const db = result.find((s) => s.service === "db");
      const redis = result.find((s) => s.service === "redis");

      expect(api).toBeTruthy();
      expect(db).toBeTruthy();
      expect(redis).toBeTruthy();

      expect(api!.operations[0]!.state).toBe("closed");
      expect(db!.operations[0]!.state).toBe("open");
      expect(redis!.operations[0]!.state).toBe("half-open");
    });
  });

  // ── getAlertHistory ─────────────────────────────────────────────────

  describe("getAlertHistory", () => {
    it("returns empty array when no alerts triggered", () => {
      const history = monitor.getAlertHistory();
      expect(history.length).toBe(0);
    });

    it("records alerts when OPEN state triggers circuit_breaker_open rule", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "OPEN", errorRate: 1 })
      );

      const history = monitor.getAlertHistory();
      expect(history.length).toBeGreaterThan(0);

      const alert = history[0]!;
      expect(alert.service).toBe("api");
      expect(alert.operation).toBe("publish");
      expect(alert.severity).toBe("critical");
      expect(alert.rule).toBe("circuit_breaker_open");
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
      expect(limited.length).toBe(1);
    });

    it("returns alerts in reverse chronological order (newest first)", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "first", operation: "op", state: "OPEN", errorRate: 1 })
      );
      monitor.updateMetrics(
        makeMetrics({ service: "second", operation: "op", state: "OPEN", errorRate: 1 })
      );

      const history = monitor.getAlertHistory();
      expect(history[0]!.service).toBe("second");
    });
  });

  // ── clearAlertHistory ───────────────────────────────────────────────

  describe("clearAlertHistory", () => {
    it("clears all alert history", () => {
      monitor.updateMetrics(
        makeMetrics({ service: "api", operation: "publish", state: "OPEN", errorRate: 1 })
      );
      expect(monitor.getAlertHistory().length).toBeGreaterThan(0);

      monitor.clearAlertHistory();
      expect(monitor.getAlertHistory().length).toBe(0);
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

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.service).toBe("api");
      expect(alerts[0]!.severity).toBe("critical");
    });
  });
});
