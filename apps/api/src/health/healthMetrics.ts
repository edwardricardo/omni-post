import * as client from "prom-client";
import type { HealthStatus } from "@monitoring/health-checks";

/**
 * Prometheus metrics for health monitoring
 *
 * These metrics are exposed via the /metrics endpoint for Prometheus scraping.
 */

/**
 * Overall system health status
 * 1 = healthy, 0.5 = degraded, 0 = unhealthy
 */
export const systemHealthGauge = new client.Gauge({
  name: "system_health_status",
  help: "Overall system health status (1=healthy, 0.5=degraded, 0=unhealthy)",
});

/**
 * Individual dependency health status
 * Labels: dependency (name), type (database/cache/queue/etc)
 */
export const dependencyHealthGauge = new client.Gauge({
  name: "dependency_health_status",
  help: "Individual dependency health status (1=healthy, 0.5=degraded, 0=unhealthy)",
  labelNames: ["dependency", "type"],
});

/**
 * Health check duration histogram
 * Tracks how long health checks take to complete
 */
export const healthCheckDurationHistogram = new client.Histogram({
  name: "health_check_duration_seconds",
  help: "Duration of health check operations",
  labelNames: ["dependency", "status"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

/**
 * Health check failure counter
 * Increments when a health check fails
 */
export const healthCheckFailureCounter = new client.Counter({
  name: "health_check_failures_total",
  help: "Total number of health check failures",
  labelNames: ["dependency", "type"],
});

/**
 * Critical dependency failures gauge
 * Number of critical dependencies currently unhealthy
 */
export const criticalDependencyFailuresGauge = new client.Gauge({
  name: "critical_dependency_failures",
  help: "Number of critical dependencies currently unhealthy",
});

/**
 * Health alert counter
 * Tracks total number of health alerts generated
 */
export const healthAlertCounter = new client.Counter({
  name: "health_alerts_total",
  help: "Total number of health alerts generated",
  labelNames: ["level", "dependency"],
});

/**
 * Active health alerts gauge
 * Number of unacknowledged health alerts
 */
export const activeHealthAlertsGauge = new client.Gauge({
  name: "active_health_alerts",
  help: "Number of active (unacknowledged) health alerts",
  labelNames: ["level"],
});

/**
 * Helper function to convert health status to numeric value
 */
export function healthStatusToNumber(status: HealthStatus): number {
  switch (status) {
    case "healthy":
      return 1;
    case "degraded":
      return 0.5;
    case "unhealthy":
      return 0;
  }
}

/**
 * Record health check metrics for a dependency
 */
export function recordHealthCheckMetrics(
  dependency: string,
  type: string,
  status: HealthStatus,
  latency: number,
  isCritical: boolean
): void {
  // Record health status
  const statusValue = healthStatusToNumber(status);
  dependencyHealthGauge.set({ dependency, type }, statusValue);

  // Record check duration
  healthCheckDurationHistogram.observe({ dependency, status }, latency / 1000);

  // Record failure if unhealthy
  if (status === "unhealthy") {
    healthCheckFailureCounter.inc({ dependency, type });

    // Update critical failures gauge if this is a critical dependency
    if (isCritical) {
      criticalDependencyFailuresGauge.inc();
    }
  }
}

/**
 * Record system health metrics
 */
export function recordSystemHealthMetrics(
  overallStatus: HealthStatus,
  score: number,
  criticalFailures: number
): void {
  systemHealthGauge.set(healthStatusToNumber(overallStatus));
  criticalDependencyFailuresGauge.set(criticalFailures);
}

/**
 * Record health alert metrics
 */
export function recordHealthAlertMetrics(
  level: "warning" | "error" | "critical",
  dependency?: string
): void {
  healthAlertCounter.inc({ level, dependency: dependency || "system" });
  activeHealthAlertsGauge.inc({ level });
}

/**
 * Clear acknowledged alerts from metrics
 */
export function acknowledgeHealthAlert(level: "warning" | "error" | "critical"): void {
  activeHealthAlertsGauge.dec({ level });
}
