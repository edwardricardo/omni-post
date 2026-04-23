/**
 * @file index.ts
 * @description Circuit breaker implementation with CLOSED/OPEN/HALF_OPEN state machine,
 *              Prometheus metrics, and rolling failure-rate tracking for external service calls.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import * as client from "prom-client";
import * as pino from "pino";

// Circuit breaker state types
export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerMetrics {
  service: string;
  operation: string;
  state: CircuitBreakerState;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  rejectionCount: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttempt?: Date;
  errorRate: number;
  responseTime: {
    min: number;
    max: number;
    avg: number;
    p95: number;
    p99: number;
  };
}

export interface AlertRule {
  name: string;
  condition: (metrics: CircuitBreakerMetrics) => boolean;
  severity: "critical" | "warning" | "info";
  message: string;
  cooldown: number; // Milliseconds between alerts
}

export interface AlertEvent {
  timestamp: Date;
  rule: string;
  service: string;
  operation: string;
  severity: "critical" | "warning" | "info";
  message: string;
  metrics: CircuitBreakerMetrics;
}

const logger = pino.default({
  name: "circuit-breaker-monitor",
  level: process.env.LOG_LEVEL || "info",
});

export class CircuitBreakerMonitor {
  private registry: client.Registry;
  private alertRules: Map<string, AlertRule> = new Map();
  private lastAlerts: Map<string, Date> = new Map();
  private alertCallbacks: Array<(alert: AlertEvent) => void> = [];
  private alertHistory: AlertEvent[] = [];
  private serviceMetrics: Map<string, Map<string, CircuitBreakerMetrics>> = new Map();

  // Prometheus metrics
  private stateGauge: client.Gauge<string>;
  private requestCounter: client.Counter<string>;
  private errorRateGauge: client.Gauge<string>;
  private responseTimeHistogram: client.Histogram<string>;
  private alertCounter: client.Counter<string>;

  constructor(registry?: client.Registry) {
    this.registry = registry || new client.Registry();

    // Initialize Prometheus metrics
    this.stateGauge = new client.Gauge({
      name: "circuit_breaker_state",
      help: "Current state of circuit breakers (0=CLOSED, 1=HALF_OPEN, 2=OPEN)",
      labelNames: ["service", "operation"],
      registers: [this.registry],
    });

    this.requestCounter = new client.Counter({
      name: "circuit_breaker_requests_total",
      help: "Total number of requests through circuit breaker",
      labelNames: ["service", "operation", "result"],
      registers: [this.registry],
    });

    this.errorRateGauge = new client.Gauge({
      name: "circuit_breaker_error_rate",
      help: "Current error rate of circuit breaker",
      labelNames: ["service", "operation"],
      registers: [this.registry],
    });

    this.responseTimeHistogram = new client.Histogram({
      name: "circuit_breaker_response_time_seconds",
      help: "Response time of requests through circuit breaker",
      labelNames: ["service", "operation"],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
      registers: [this.registry],
    });

    this.alertCounter = new client.Counter({
      name: "circuit_breaker_alerts_total",
      help: "Total number of circuit breaker alerts triggered",
      labelNames: ["service", "operation", "rule", "severity"],
      registers: [this.registry],
    });

    this.setupDefaultAlertRules();
  }

  private setupDefaultAlertRules(): void {
    // Critical: Circuit breaker is open
    this.addAlertRule({
      name: "circuit_breaker_open",
      condition: (metrics) => metrics.state === "OPEN",
      severity: "critical",
      message: "Circuit breaker is OPEN - service may be unavailable",
      cooldown: 300000, // 5 minutes
    });

    // Warning: High error rate
    this.addAlertRule({
      name: "high_error_rate",
      condition: (metrics) => metrics.errorRate > 0.5 && metrics.state === "CLOSED",
      severity: "warning",
      message: "High error rate detected - circuit breaker may open soon",
      cooldown: 180000, // 3 minutes
    });

    // Warning: Slow response times
    this.addAlertRule({
      name: "slow_response_time",
      condition: (metrics) => metrics.responseTime.p95 > 10000, // 10 seconds
      severity: "warning",
      message: "Slow response times detected",
      cooldown: 300000, // 5 minutes
    });

    // Info: Circuit breaker recovered
    this.addAlertRule({
      name: "circuit_breaker_recovered",
      condition: (metrics) => {
        const wasOpen = this.lastAlerts.has(
          `circuit_breaker_open:${metrics.service}:${metrics.operation}`
        );
        return wasOpen && metrics.state === "CLOSED" && metrics.successCount > 0;
      },
      severity: "info",
      message: "Circuit breaker has recovered and is now CLOSED",
      cooldown: 60000, // 1 minute
    });
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.name, rule);
    logger.info(`Added alert rule: ${rule.name}`);
  }

  onAlert(callback: (alert: AlertEvent) => void): void {
    this.alertCallbacks.push(callback);
  }

  updateMetrics(metrics: CircuitBreakerMetrics): void {
    const { service, operation } = metrics;

    // Store metrics in serviceMetrics map
    if (!this.serviceMetrics.has(service)) {
      this.serviceMetrics.set(service, new Map());
    }
    const operationMap = this.serviceMetrics.get(service)!;
    operationMap.set(operation, { ...metrics });

    // Update Prometheus metrics
    this.stateGauge.set(
      { service, operation },
      metrics.state === "CLOSED" ? 0 : metrics.state === "HALF_OPEN" ? 1 : 2
    );

    this.errorRateGauge.set({ service, operation }, metrics.errorRate);

    // Update counters (assuming these are deltas)
    this.requestCounter.inc({ service, operation, result: "success" }, metrics.successCount);
    this.requestCounter.inc({ service, operation, result: "failure" }, metrics.failureCount);
    this.requestCounter.inc({ service, operation, result: "timeout" }, metrics.timeoutCount);
    this.requestCounter.inc({ service, operation, result: "rejection" }, metrics.rejectionCount);

    // Check alert rules
    this.checkAlertRules(metrics);

    logger.debug(
      {
        state: metrics.state,
        errorRate: metrics.errorRate,
        responseTimeP95: metrics.responseTime.p95,
      },
      `Updated metrics for ${service}:${operation}`
    );
  }

  private checkAlertRules(metrics: CircuitBreakerMetrics): void {
    const { service, operation } = metrics;

    for (const [ruleName, rule] of Array.from(this.alertRules)) {
      const alertKey = `${ruleName}:${service}:${operation}`;
      const lastAlert = this.lastAlerts.get(alertKey);
      const now = new Date();

      // Check cooldown
      if (lastAlert && now.getTime() - lastAlert.getTime() < rule.cooldown) {
        continue;
      }

      // Check condition
      if (rule.condition(metrics)) {
        const alertEvent: AlertEvent = {
          timestamp: now,
          rule: ruleName,
          service,
          operation,
          severity: rule.severity,
          message: rule.message,
          metrics: { ...metrics },
        };

        this.triggerAlert(alertEvent);
        this.lastAlerts.set(alertKey, now);
      }
    }
  }

  private triggerAlert(alert: AlertEvent): void {
    // Store alert in history
    this.alertHistory.push(alert);

    // Update alert counter
    this.alertCounter.inc({
      service: alert.service,
      operation: alert.operation,
      rule: alert.rule,
      severity: alert.severity,
    });

    // Log alert
    logger[
      alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warn" : "info"
    ](
      {
        rule: alert.rule,
        service: alert.service,
        operation: alert.operation,
        state: alert.metrics.state,
        errorRate: alert.metrics.errorRate,
      },
      `Circuit breaker alert: ${alert.message}`
    );

    // Notify callbacks
    this.alertCallbacks.forEach((callback) => {
      try {
        callback(alert);
      } catch (callbackError) {
        logger.error({ error: callbackError }, "Error in alert callback");
      }
    });
  }

  getServiceStatus(service: string): Result<
    {
      service: string;
      overallHealth: "healthy" | "degraded" | "unhealthy";
      operations: Array<{
        operation: string;
        state: CircuitBreakerState;
        health: "healthy" | "degraded" | "unhealthy";
        errorRate: number;
        lastUpdate: Date;
      }>;
    },
    "SERVICE_NOT_FOUND"
  > {
    const operationMap = this.serviceMetrics.get(service);
    if (!operationMap || operationMap.size === 0) {
      return err("SERVICE_NOT_FOUND" as const);
    }

    const operations = Array.from(operationMap.values()).map((metrics) => {
      const health = this.determineOperationHealth(metrics);
      const lastUpdate =
        metrics.lastFailureTime && metrics.lastSuccessTime
          ? metrics.lastFailureTime > metrics.lastSuccessTime
            ? metrics.lastFailureTime
            : metrics.lastSuccessTime
          : metrics.lastFailureTime || metrics.lastSuccessTime || new Date();

      return {
        operation: metrics.operation,
        state: metrics.state,
        health,
        errorRate: metrics.errorRate,
        lastUpdate,
      };
    });

    const overallHealth = this.computeOverallHealth(operations.map((op) => op.health));

    return ok({
      service,
      overallHealth,
      operations,
    });
  }

  private determineOperationHealth(
    metrics: CircuitBreakerMetrics
  ): "healthy" | "degraded" | "unhealthy" {
    if (metrics.state === "OPEN") {
      return "unhealthy";
    }
    if (metrics.state === "HALF_OPEN") {
      return "degraded";
    }
    // CLOSED state: degraded if error rate is above threshold
    if (metrics.errorRate > 0.5) {
      return "degraded";
    }
    return "healthy";
  }

  private computeOverallHealth(
    healths: Array<"healthy" | "degraded" | "unhealthy">
  ): "healthy" | "degraded" | "unhealthy" {
    if (healths.some((h) => h === "unhealthy")) {
      return "unhealthy";
    }
    if (healths.some((h) => h === "degraded")) {
      return "degraded";
    }
    return "healthy";
  }

  getAllServicesStatus(): Array<{
    service: string;
    overallHealth: "healthy" | "degraded" | "unhealthy";
    operations: Array<{
      state: "open" | "closed" | "half-open";
    }>;
  }> {
    const results: Array<{
      service: string;
      overallHealth: "healthy" | "degraded" | "unhealthy";
      operations: Array<{ state: "open" | "closed" | "half-open" }>;
    }> = [];

    for (const serviceName of this.serviceMetrics.keys()) {
      const statusResult = this.getServiceStatus(serviceName);
      if (statusResult.ok) {
        const stateMapping: Record<CircuitBreakerState, "open" | "closed" | "half-open"> = {
          OPEN: "open",
          CLOSED: "closed",
          HALF_OPEN: "half-open",
        };

        results.push({
          service: statusResult.value.service,
          overallHealth: statusResult.value.overallHealth,
          operations: statusResult.value.operations.map((op) => ({
            state: stateMapping[op.state],
          })),
        });
      }
    }

    return results;
  }

  getMetricsRegistry(): client.Registry {
    return this.registry;
  }

  async exportMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  clearAlertHistory(): void {
    this.lastAlerts.clear();
    this.alertHistory.length = 0;
    logger.info("Cleared alert history");
  }

  getAlertHistory(limit = 100): AlertEvent[] {
    // Return the most recent alerts, newest first
    return this.alertHistory.slice(-limit).reverse();
  }
}

// Global monitor instance
let globalMonitor: CircuitBreakerMonitor | null = null;

export function createCircuitBreakerMonitor(registry?: client.Registry): CircuitBreakerMonitor {
  if (!globalMonitor) {
    globalMonitor = new CircuitBreakerMonitor(registry);
  }
  return globalMonitor;
}

export function getCircuitBreakerMonitor(): CircuitBreakerMonitor | null {
  return globalMonitor;
}
