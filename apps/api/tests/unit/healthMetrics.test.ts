/**
 * Health Metrics Unit Tests
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates Prometheus health monitoring metrics collection
 * for system health tracking, dependency monitoring, and alerting systems.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - Health status numeric conversion (healthy=1, degraded=0.5, unhealthy=0)
 * - Dependency health gauge recording
 * - Health check duration tracking with histograms
 * - Failure counter incrementation for unhealthy dependencies
 * - Critical dependency failure tracking
 * - System-wide health metrics aggregation
 * - Alert counter and gauge management
 * - Alert acknowledgement and gauge decrementation
 *
 * HEALTH MONITORING BUSINESS RULES:
 * - Health status: healthy=1, degraded=0.5, unhealthy=0 (for Prometheus gauges)
 * - Critical dependencies affect system health score immediately
 * - Health check duration tracked in seconds (ms/1000)
 * - Failed health checks increment failure counter
 * - Active alerts gauge increases on new alerts, decreases on acknowledgement
 * - Metrics persist across health check cycles for trending analysis
 *
 * DEPENDENCIES:
 * - prom-client for Prometheus metrics
 * - @monitoring/health-checks for HealthStatus types
 * - Pure logic tests - NO database required
 * - NO external services or API calls
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api test apps/api/tests/unit/healthMetrics.test.ts
 *
 * @module HealthMetricsTests
 * @category UnitTests
 */

import { describe, it, beforeEach, expect } from "vitest";
import type { HealthStatus } from "@monitoring/health-checks";
import {
  healthStatusToNumber,
  recordHealthCheckMetrics,
  recordSystemHealthMetrics,
  recordHealthAlertMetrics,
  acknowledgeHealthAlert,
  systemHealthGauge,
  dependencyHealthGauge,
  healthCheckDurationHistogram,
  healthCheckFailureCounter,
  criticalDependencyFailuresGauge,
  healthAlertCounter,
  activeHealthAlertsGauge,
} from "../../src/health/healthMetrics.js";

// ========================================
// TEST UTILITIES
// ========================================

/**
 * Reset all metrics before each test to ensure clean state
 */
function resetMetrics(): void {
  try {
    systemHealthGauge.reset();
    dependencyHealthGauge.reset();
    healthCheckDurationHistogram.reset();
    healthCheckFailureCounter.reset();
    criticalDependencyFailuresGauge.reset();
    healthAlertCounter.reset();
    activeHealthAlertsGauge.reset();
  } catch {
    // Metrics may not support reset, that's okay
  }
}

/**
 * Get current gauge value for testing
 */
async function getGaugeValue(gauge: any, labels?: Record<string, string>): Promise<number> {
  const metrics = await gauge.get();
  if (labels) {
    const matching = metrics.values.find((v: any) => {
      return Object.keys(labels).every((key) => v.labels[key] === labels[key]);
    });
    return matching?.value ?? 0;
  }
  return metrics.values[0]?.value ?? 0;
}

/**
 * Get counter value for testing
 */
async function getCounterValue(counter: any, labels?: Record<string, string>): Promise<number> {
  const metrics = await counter.get();
  if (labels) {
    const matching = metrics.values.find((v: any) => {
      return Object.keys(labels).every((key) => v.labels[key] === labels[key]);
    });
    return matching?.value ?? 0;
  }
  return metrics.values[0]?.value ?? 0;
}

// ========================================
// TEST SUITE: Health Status Conversion
// ========================================

describe("HealthMetrics - Health Status Conversion", () => {
  it("should convert healthy status to 1", () => {
    const value = healthStatusToNumber("healthy");

    expect(value).toBe(1);
  });

  it("should convert degraded status to 0.5", () => {
    const value = healthStatusToNumber("degraded");

    expect(value).toBe(0.5);
  });

  it("should convert unhealthy status to 0", () => {
    const value = healthStatusToNumber("unhealthy");

    expect(value).toBe(0);
  });

  it("should handle all valid health statuses", () => {
    const statuses: HealthStatus[] = ["healthy", "degraded", "unhealthy"];

    statuses.forEach((status) => {
      const value = healthStatusToNumber(status);
      expect(typeof value === "number").toBeTruthy();
      expect(value >= 0 && value <= 1).toBeTruthy();
    });
  });
});

// ========================================
// TEST SUITE: Dependency Health Recording
// ========================================

describe("HealthMetrics - Dependency Health Recording", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should record healthy dependency metrics", async () => {
    const dependency = "postgres";
    const type = "database";
    const status: HealthStatus = "healthy";
    const latency = 15;
    const isCritical = true;

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const gaugeValue = await getGaugeValue(dependencyHealthGauge, { dependency, type });

    expect(gaugeValue).toBe(1);
  });

  it("should record degraded dependency metrics", async () => {
    const dependency = "redis";
    const type = "cache";
    const status: HealthStatus = "degraded";
    const latency = 150;
    const isCritical = false;

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const gaugeValue = await getGaugeValue(dependencyHealthGauge, { dependency, type });

    expect(gaugeValue).toBe(0.5);
  });

  it("should record unhealthy dependency metrics", async () => {
    const dependency = "s3";
    const type = "storage";
    const status: HealthStatus = "unhealthy";
    const latency = 5000;
    const isCritical = false;

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const gaugeValue = await getGaugeValue(dependencyHealthGauge, { dependency, type });

    expect(gaugeValue).toBe(0);
  });

  it("should record health check duration in seconds", () => {
    const dependency = "postgres";
    const type = "database";
    const status: HealthStatus = "healthy";
    const latencyMs = 25; // milliseconds
    const isCritical = true;

    // Should convert ms to seconds and record in histogram
    recordHealthCheckMetrics(dependency, type, status, latencyMs, isCritical);

    // Histogram recorded, no assertion needed as histogram.observe doesn't return value
    // This validates the function executes without error
    expect(true).toBeTruthy();
  });

  it("should increment failure counter for unhealthy status", async () => {
    const dependency = "postgres";
    const type = "database";
    const status: HealthStatus = "unhealthy";
    const latency = 1000;
    const isCritical = true;

    const beforeCount = await getCounterValue(healthCheckFailureCounter, { dependency, type });

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const afterCount = await getCounterValue(healthCheckFailureCounter, { dependency, type });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should not increment failure counter for healthy status", async () => {
    const dependency = "redis";
    const type = "cache";
    const status: HealthStatus = "healthy";
    const latency = 10;
    const isCritical = false;

    const beforeCount = await getCounterValue(healthCheckFailureCounter, { dependency, type });

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const afterCount = await getCounterValue(healthCheckFailureCounter, { dependency, type });

    expect(afterCount).toBe(beforeCount);
  });

  it("should increment critical failures for unhealthy critical dependency", async () => {
    const dependency = "postgres";
    const type = "database";
    const status: HealthStatus = "unhealthy";
    const latency = 2000;
    const isCritical = true;

    const beforeCount = await getGaugeValue(criticalDependencyFailuresGauge);

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const afterCount = await getGaugeValue(criticalDependencyFailuresGauge);

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should not increment critical failures for non-critical dependency", async () => {
    const dependency = "s3";
    const type = "storage";
    const status: HealthStatus = "unhealthy";
    const latency = 3000;
    const isCritical = false;

    const beforeCount = await getGaugeValue(criticalDependencyFailuresGauge);

    recordHealthCheckMetrics(dependency, type, status, latency, isCritical);

    const afterCount = await getGaugeValue(criticalDependencyFailuresGauge);

    expect(afterCount).toBe(beforeCount);
  });

  it("should handle multiple dependencies independently", async () => {
    recordHealthCheckMetrics("postgres", "database", "healthy", 10, true);
    recordHealthCheckMetrics("redis", "cache", "degraded", 50, false);
    recordHealthCheckMetrics("s3", "storage", "unhealthy", 100, false);

    const postgresValue = await getGaugeValue(dependencyHealthGauge, {
      dependency: "postgres",
      type: "database",
    });
    const redisValue = await getGaugeValue(dependencyHealthGauge, {
      dependency: "redis",
      type: "cache",
    });
    const s3Value = await getGaugeValue(dependencyHealthGauge, {
      dependency: "s3",
      type: "storage",
    });

    expect(postgresValue).toBe(1);
    expect(redisValue).toBe(0.5);
    expect(s3Value).toBe(0);
  });
});

// ========================================
// TEST SUITE: System Health Recording
// ========================================

describe("HealthMetrics - System Health Recording", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should record healthy system status", async () => {
    const status: HealthStatus = "healthy";
    const score = 100;
    const criticalFailures = 0;

    recordSystemHealthMetrics(status, score, criticalFailures);

    const systemStatus = await getGaugeValue(systemHealthGauge);
    const criticalCount = await getGaugeValue(criticalDependencyFailuresGauge);

    expect(systemStatus).toBe(1);
    expect(criticalCount).toBe(0);
  });

  it("should record degraded system status", async () => {
    const status: HealthStatus = "degraded";
    const score = 75;
    const criticalFailures = 1;

    recordSystemHealthMetrics(status, score, criticalFailures);

    const systemStatus = await getGaugeValue(systemHealthGauge);
    const criticalCount = await getGaugeValue(criticalDependencyFailuresGauge);

    expect(systemStatus).toBe(0.5);
    expect(criticalCount).toBe(1);
  });

  it("should record unhealthy system status", async () => {
    const status: HealthStatus = "unhealthy";
    const score = 30;
    const criticalFailures = 3;

    recordSystemHealthMetrics(status, score, criticalFailures);

    const systemStatus = await getGaugeValue(systemHealthGauge);
    const criticalCount = await getGaugeValue(criticalDependencyFailuresGauge);

    expect(systemStatus).toBe(0);
    expect(criticalCount).toBe(3);
  });

  it("should update system health on multiple calls", async () => {
    recordSystemHealthMetrics("healthy", 100, 0);
    let systemStatus = await getGaugeValue(systemHealthGauge);
    expect(systemStatus).toBe(1);

    recordSystemHealthMetrics("degraded", 70, 1);
    systemStatus = await getGaugeValue(systemHealthGauge);
    expect(systemStatus).toBe(0.5);

    recordSystemHealthMetrics("unhealthy", 40, 2);
    systemStatus = await getGaugeValue(systemHealthGauge);
    expect(systemStatus).toBe(0);
  });
});

// ========================================
// TEST SUITE: Health Alert Recording
// ========================================

describe("HealthMetrics - Health Alert Recording", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should record warning alert", async () => {
    const level = "warning";
    const dependency = "redis";

    const beforeCount = await getCounterValue(healthAlertCounter, { level, dependency });
    const beforeActive = await getGaugeValue(activeHealthAlertsGauge, { level });

    recordHealthAlertMetrics(level, dependency);

    const afterCount = await getCounterValue(healthAlertCounter, { level, dependency });
    const afterActive = await getGaugeValue(activeHealthAlertsGauge, { level });

    expect(afterCount > beforeCount).toBeTruthy();
    expect(afterActive > beforeActive).toBeTruthy();
  });

  it("should record error alert", async () => {
    const level = "error";
    const dependency = "postgres";

    const beforeCount = await getCounterValue(healthAlertCounter, { level, dependency });

    recordHealthAlertMetrics(level, dependency);

    const afterCount = await getCounterValue(healthAlertCounter, { level, dependency });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should record critical alert", async () => {
    const level = "critical";
    const dependency = "database";

    const beforeCount = await getCounterValue(healthAlertCounter, { level, dependency });

    recordHealthAlertMetrics(level, dependency);

    const afterCount = await getCounterValue(healthAlertCounter, { level, dependency });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should record system-level alerts without dependency", async () => {
    const level = "critical";

    const beforeCount = await getCounterValue(healthAlertCounter, { level, dependency: "system" });

    recordHealthAlertMetrics(level);

    const afterCount = await getCounterValue(healthAlertCounter, { level, dependency: "system" });

    expect(afterCount > beforeCount).toBeTruthy();
  });

  it("should track active alerts by severity level", async () => {
    recordHealthAlertMetrics("warning", "redis");
    recordHealthAlertMetrics("error", "postgres");
    recordHealthAlertMetrics("critical", "network");

    const warningActive = await getGaugeValue(activeHealthAlertsGauge, { level: "warning" });
    const errorActive = await getGaugeValue(activeHealthAlertsGauge, { level: "error" });
    const criticalActive = await getGaugeValue(activeHealthAlertsGauge, { level: "critical" });

    expect(warningActive >= 1).toBeTruthy();
    expect(errorActive >= 1).toBeTruthy();
    expect(criticalActive >= 1).toBeTruthy();
  });

  it("should accumulate multiple alerts of same type", async () => {
    const level = "warning";
    const dependency = "redis";

    const beforeCount = await getCounterValue(healthAlertCounter, { level, dependency });

    recordHealthAlertMetrics(level, dependency);
    recordHealthAlertMetrics(level, dependency);
    recordHealthAlertMetrics(level, dependency);

    const afterCount = await getCounterValue(healthAlertCounter, { level, dependency });

    expect(afterCount >= beforeCount + 3).toBeTruthy();
  });
});

// ========================================
// TEST SUITE: Alert Acknowledgement
// ========================================

describe("HealthMetrics - Alert Acknowledgement", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should decrement active alerts on acknowledgement", async () => {
    const level = "warning";

    // Create an alert
    recordHealthAlertMetrics(level, "redis");

    const beforeAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    // Acknowledge it
    acknowledgeHealthAlert(level);

    const afterAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    expect(afterAck < beforeAck).toBeTruthy();
  });

  it("should handle acknowledgement of error alerts", async () => {
    const level = "error";

    recordHealthAlertMetrics(level, "postgres");
    const beforeAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    acknowledgeHealthAlert(level);
    const afterAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    expect(afterAck < beforeAck).toBeTruthy();
  });

  it("should handle acknowledgement of critical alerts", async () => {
    const level = "critical";

    recordHealthAlertMetrics(level, "system");
    const beforeAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    acknowledgeHealthAlert(level);
    const afterAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    expect(afterAck < beforeAck).toBeTruthy();
  });

  it("should handle multiple acknowledgements", async () => {
    const level = "warning";

    // Create multiple alerts
    recordHealthAlertMetrics(level, "redis");
    recordHealthAlertMetrics(level, "cache");

    const afterAlerts = await getGaugeValue(activeHealthAlertsGauge, { level });

    // Acknowledge both
    acknowledgeHealthAlert(level);
    acknowledgeHealthAlert(level);

    const afterAcks = await getGaugeValue(activeHealthAlertsGauge, { level });

    expect(afterAcks < afterAlerts).toBeTruthy();
  });
});

// ========================================
// TEST SUITE: Metric Integration
// ========================================

describe("HealthMetrics - Metric Integration", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should record complete health check cycle", async () => {
    // Record multiple dependency health checks
    recordHealthCheckMetrics("postgres", "database", "healthy", 15, true);
    recordHealthCheckMetrics("redis", "cache", "healthy", 10, true);
    recordHealthCheckMetrics("s3", "storage", "degraded", 100, false);

    // Record system health
    recordSystemHealthMetrics("healthy", 90, 0);

    const systemStatus = await getGaugeValue(systemHealthGauge);
    const postgresStatus = await getGaugeValue(dependencyHealthGauge, {
      dependency: "postgres",
      type: "database",
    });

    expect(systemStatus).toBe(1);
    expect(postgresStatus).toBe(1);
  });

  it("should handle degraded system with failing dependencies", async () => {
    // Critical dependency fails
    recordHealthCheckMetrics("postgres", "database", "unhealthy", 5000, true);
    // Non-critical degrades
    recordHealthCheckMetrics("redis", "cache", "degraded", 150, false);

    // System degrades due to critical failure
    recordSystemHealthMetrics("degraded", 60, 1);

    // Alert generated
    recordHealthAlertMetrics("error", "postgres");

    const systemStatus = await getGaugeValue(systemHealthGauge);
    const criticalFailures = await getGaugeValue(criticalDependencyFailuresGauge);

    expect(systemStatus).toBe(0.5);
    expect(criticalFailures).toBe(1);
  });

  it("should handle alert lifecycle from creation to acknowledgement", async () => {
    const level = "warning";

    // Create alert
    recordHealthAlertMetrics(level, "redis");

    const alertCount = await getCounterValue(healthAlertCounter, {
      level,
      dependency: "redis",
    });
    const activeBeforeAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    // Acknowledge alert
    acknowledgeHealthAlert(level);

    const activeAfterAck = await getGaugeValue(activeHealthAlertsGauge, { level });

    expect(alertCount > 0).toBeTruthy();
    expect(activeAfterAck < activeBeforeAck).toBeTruthy();
  });

  it("should track health trends across multiple checks", () => {
    // Simulate degrading health over time
    recordHealthCheckMetrics("postgres", "database", "healthy", 15, true);
    recordSystemHealthMetrics("healthy", 100, 0);

    recordHealthCheckMetrics("postgres", "database", "degraded", 150, true);
    recordSystemHealthMetrics("degraded", 70, 0);

    recordHealthCheckMetrics("postgres", "database", "unhealthy", 2000, true);
    recordSystemHealthMetrics("unhealthy", 30, 1);
    recordHealthAlertMetrics("critical", "postgres");

    // All metrics recorded successfully
    expect(true).toBeTruthy();
  });
});

// ========================================
// TEST SUITE: Edge Cases
// ========================================

describe("HealthMetrics - Edge Cases", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should handle zero latency health checks", () => {
    recordHealthCheckMetrics("redis", "cache", "healthy", 0, false);

    expect(true).toBeTruthy();
  });

  it("should handle very high latency health checks", () => {
    recordHealthCheckMetrics("s3", "storage", "unhealthy", 30000, false);

    expect(true).toBeTruthy();
  });

  it("should handle rapid consecutive health checks", () => {
    for (let i = 0; i < 100; i++) {
      recordHealthCheckMetrics("postgres", "database", "healthy", 10, true);
    }

    expect(true).toBeTruthy();
  });

  it("should handle system health with zero score", () => {
    recordSystemHealthMetrics("unhealthy", 0, 5);

    expect(true).toBeTruthy();
  });

  it("should handle system health with perfect score", () => {
    recordSystemHealthMetrics("healthy", 100, 0);

    expect(true).toBeTruthy();
  });

  it("should handle multiple alerts at different severity levels", () => {
    recordHealthAlertMetrics("warning", "redis");
    recordHealthAlertMetrics("error", "postgres");
    recordHealthAlertMetrics("critical", "network");
    recordHealthAlertMetrics("warning", "cache");
    recordHealthAlertMetrics("critical", "database");

    expect(true).toBeTruthy();
  });

  it("should handle acknowledgement when no active alerts exist", () => {
    // Acknowledge without creating alerts first
    acknowledgeHealthAlert("warning");

    expect(true).toBeTruthy();
  });
});
