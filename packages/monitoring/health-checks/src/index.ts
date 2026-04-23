/**
 * @file index.ts
 * @description Health-check orchestrator that runs registered checkers (DB, Redis, storage,
 *              providers, circuit breakers), aggregates status, and emits Prometheus metrics.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { ok, err, type Result } from "@shared/types";
import * as pino from "pino";
import * as client from "prom-client";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type {
  HealthStatus,
  DependencyHealth,
  SystemHealthReport,
  HealthAlert,
  HealthCheckConfig,
  HealthChecker,
} from "./types.js";

const logger = pino.default({
  name: "health-checks",
  level: process.env.LOG_LEVEL || "info",
});

// Prometheus metrics for health checks
const healthCheckDuration = new client.Histogram({
  name: "health_check_duration_seconds",
  help: "Duration of health check operations",
  labelNames: ["check_type", "dependency", "status"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const dependencyStatus = new client.Gauge({
  name: "dependency_status",
  help: "Status of system dependencies (1=healthy, 0.5=degraded, 0=unhealthy)",
  labelNames: ["dependency", "type"],
});

const systemHealth = new client.Gauge({
  name: "system_health_score",
  help: "Overall system health score (0-1)",
});

// Re-export shared types from types.ts so external consumers continue to
// import from this barrel without breaking their existing import paths.
export type {
  HealthStatus,
  HealthCheckResult,
  DependencyHealth,
  SystemHealthReport,
  HealthAlert,
  HealthCheckConfig,
  HealthChecker,
} from "./types.js";

export class HealthCheckManager {
  private checkers = new Map<
    string,
    {
      checker: HealthChecker;
      config: HealthCheckConfig & { critical: boolean; type: DependencyHealth["type"] };
    }
  >();
  private results = new Map<string, DependencyHealth>();
  private alerts: HealthAlert[] = [];
  private isRunning = false;
  private scheduler: BackgroundTaskScheduler | undefined;
  private readonly periodicTaskId = "health-check-manager-periodic";

  constructor(
    private globalConfig: HealthCheckConfig = {
      timeout: 5000,
      interval: 30000,
      retries: 3,
      alertThresholds: {
        degradedLatency: 1000,
        unhealthyLatency: 5000,
        criticalFailureCount: 3,
      },
    },
    scheduler?: BackgroundTaskScheduler
  ) {
    this.scheduler = scheduler;
  }

  /**
   * Register a health checker
   */
  register(
    name: string,
    checker: HealthChecker,
    options: {
      type: DependencyHealth["type"];
      critical?: boolean;
      config?: Partial<HealthCheckConfig>;
    }
  ): void {
    this.checkers.set(name, {
      checker,
      config: {
        ...this.globalConfig,
        ...options.config,
        critical: options.critical ?? true,
        type: options.type,
      },
    });

    logger.info(
      `Registered health checker: ${name} (${options.type}${options.critical ? ", critical" : ""})`
    );
  }

  /**
   * Check health of a specific dependency
   */
  async checkDependency(
    name: string
  ): Promise<Result<DependencyHealth, "NOT_FOUND" | "CHECK_FAILED">> {
    const entry = this.checkers.get(name);
    if (!entry) {
      return err("NOT_FOUND");
    }

    const timer = healthCheckDuration.startTimer({
      check_type: "individual",
      dependency: name,
      status: "pending",
    });

    try {
      const result = await this.executeHealthCheck(name, entry.checker, entry.config);
      timer({ status: result.status });

      // Update metrics
      dependencyStatus.set(
        { dependency: name, type: entry.config.type },
        this.statusToNumber(result.status)
      );

      this.results.set(name, result);
      return ok(result);
    } catch (error: unknown) {
      timer({ status: "error" });
      logger.error({ err: error }, `Health check failed for ${name}`);
      return err("CHECK_FAILED");
    }
  }

  /**
   * Check health of all dependencies
   */
  async checkAll(): Promise<SystemHealthReport> {
    const timer = healthCheckDuration.startTimer({
      check_type: "all",
      dependency: "system",
      status: "pending",
    });
    const startTime = Date.now();

    const checks = Array.from(this.checkers.entries()).map(async ([name, entry]) => {
      try {
        const result = await this.executeHealthCheck(name, entry.checker, entry.config);
        this.results.set(name, result);

        // Update dependency metrics
        dependencyStatus.set(
          { dependency: name, type: entry.config.type },
          this.statusToNumber(result.status)
        );

        return result;
      } catch (error: unknown) {
        logger.error({ err: error }, `Health check failed for ${name}`);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failedResult: DependencyHealth = {
          name,
          type: entry.config.type,
          status: "unhealthy",
          latency: -1,
          message: `Health check failed: ${errorMessage}`,
          details: { error: errorMessage },
          lastChecked: new Date(),
          critical: entry.config.critical,
        };
        this.results.set(name, failedResult);
        return failedResult;
      }
    });

    const dependencies = await Promise.all(checks);
    const duration = Date.now() - startTime;

    // Calculate overall health
    const { overall, score } = this.calculateOverallHealth(dependencies);

    // Update system health metric
    systemHealth.set(score);

    // Generate alerts
    this.generateAlerts(dependencies);

    const report: SystemHealthReport = {
      overall,
      score,
      timestamp: new Date(),
      uptime: process.uptime(),
      dependencies,
      metrics: {
        memory: process.memoryUsage(),
        cpu: this.getCpuUsage(),
        activeConnections: 0, // Will be populated by external metrics
        requestsInFlight: 0, // Will be populated by external metrics
      },
      alerts: this.getActiveAlerts(),
    };

    timer({ status: overall });
    logger.info(
      `System health check completed in ${duration}ms: ${overall} (score: ${score.toFixed(2)})`
    );

    return report;
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("Health check manager already running");
      return;
    }

    if (!this.scheduler) {
      throw new Error(
        "HealthCheckManager.start() requires a BackgroundTaskScheduler; pass one via the constructor."
      );
    }

    this.isRunning = true;
    this.scheduler.register(
      this.periodicTaskId,
      async () => {
        await this.checkAll();
      },
      this.globalConfig.interval,
      {
        immediate: true,
        onError: (err) => logger.error({ err }, "Periodic health check failed"),
      }
    );

    logger.info(`Health check manager started (interval: ${this.globalConfig.interval}ms)`);
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.scheduler) {
      this.scheduler.unregister(this.periodicTaskId);
    }

    logger.info("Health check manager stopped");
  }

  /**
   * Get current health status
   */
  getCurrentStatus(): SystemHealthReport | null {
    if (this.results.size === 0) return null;

    const dependencies = Array.from(this.results.values());
    const { overall, score } = this.calculateOverallHealth(dependencies);

    return {
      overall,
      score,
      timestamp: new Date(),
      uptime: process.uptime(),
      dependencies,
      metrics: {
        memory: process.memoryUsage(),
        cpu: this.getCpuUsage(),
        activeConnections: 0,
        requestsInFlight: 0,
      },
      alerts: this.getActiveAlerts(),
    };
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info(`Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Get alerts by level
   */
  getAlerts(level?: HealthAlert["level"]): HealthAlert[] {
    return level ? this.alerts.filter((a) => a.level === level) : [...this.alerts];
  }

  /**
   * Clear acknowledged alerts
   */
  clearAcknowledgedAlerts(): number {
    const count = this.alerts.filter((a) => a.acknowledged).length;
    this.alerts = this.alerts.filter((a) => !a.acknowledged);
    logger.info(`Cleared ${count} acknowledged alerts`);
    return count;
  }

  private async executeHealthCheck(
    name: string,
    checker: HealthChecker,
    config: HealthCheckConfig & { critical: boolean; type: DependencyHealth["type"] }
  ): Promise<DependencyHealth> {
    const startTime = Date.now();

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= config.retries; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Health check timeout")), config.timeout);
        });

        const result = await Promise.race([checker.check(), timeoutPromise]);

        const latency = Date.now() - startTime;

        return {
          name,
          type: config.type,
          status: result.status,
          latency,
          message: result.message || `${name} is ${result.status}`,
          details: {
            ...result.details,
            attempt,
            maxAttempts: config.retries,
          },
          lastChecked: new Date(),
          critical: config.critical,
        };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < config.retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    const latency = Date.now() - startTime;
    return {
      name,
      type: config.type,
      status: "unhealthy",
      latency,
      message: `Health check failed after ${config.retries} attempts`,
      details: {
        error: lastError?.message,
        attempts: config.retries,
      },
      lastChecked: new Date(),
      critical: config.critical,
    };
  }

  private calculateOverallHealth(dependencies: DependencyHealth[]): {
    overall: HealthStatus;
    score: number;
  } {
    if (dependencies.length === 0) {
      return { overall: "unhealthy", score: 0 };
    }

    let totalScore = 0;
    let criticalFailures = 0;
    let degradedCount = 0;

    for (const dep of dependencies) {
      const depScore = this.statusToNumber(dep.status);
      totalScore += depScore;

      if (dep.critical && dep.status === "unhealthy") {
        criticalFailures++;
      }
      if (dep.status === "degraded") {
        degradedCount++;
      }
    }

    const averageScore = totalScore / dependencies.length;

    // System is unhealthy if any critical dependency is down
    if (criticalFailures > 0) {
      return { overall: "unhealthy", score: Math.min(averageScore, 0.3) };
    }

    // System is degraded if more than 30% of dependencies are degraded or average score < 0.7
    if (degradedCount / dependencies.length > 0.3 || averageScore < 0.7) {
      return { overall: "degraded", score: averageScore };
    }

    return { overall: "healthy", score: averageScore };
  }

  private statusToNumber(status: HealthStatus): number {
    switch (status) {
      case "healthy":
        return 1;
      case "degraded":
        return 0.5;
      case "unhealthy":
        return 0;
    }
  }

  private generateAlerts(dependencies: DependencyHealth[]): void {
    for (const dep of dependencies) {
      // Generate alert for unhealthy critical dependencies
      if (dep.critical && dep.status === "unhealthy") {
        this.addAlert({
          level: "critical",
          message: `Critical dependency ${dep.name} is unhealthy: ${dep.message}`,
          dependency: dep.name,
        });
      }

      // Generate alert for high latency
      if (
        dep.status === "healthy" &&
        dep.latency > this.globalConfig.alertThresholds.unhealthyLatency
      ) {
        this.addAlert({
          level: "warning",
          message: `High latency detected for ${dep.name}: ${dep.latency}ms`,
          dependency: dep.name,
        });
      }

      // Generate alert for degraded non-critical dependencies
      if (!dep.critical && dep.status === "degraded") {
        this.addAlert({
          level: "warning",
          message: `Dependency ${dep.name} is degraded: ${dep.message}`,
          dependency: dep.name,
        });
      }
    }
  }

  private addAlert(alert: Omit<HealthAlert, "id" | "timestamp" | "acknowledged">): void {
    const fullAlert: HealthAlert = {
      id: `alert-${randomUUID()}`,
      timestamp: new Date(),
      acknowledged: false,
      ...alert,
    };

    // Don't add duplicate alerts
    const exists = this.alerts.some(
      (a) =>
        a.dependency === fullAlert.dependency &&
        a.level === fullAlert.level &&
        a.message === fullAlert.message &&
        !a.acknowledged
    );

    if (!exists) {
      this.alerts.push(fullAlert);
      logger.warn(`Health alert generated: ${alert.level} - ${alert.message}`);
    }
  }

  private getActiveAlerts(): HealthAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  private getCpuUsage(): number {
    // Simple CPU usage estimation based on process.cpuUsage()
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000000; // Convert to seconds
  }
}

// Global health check manager instance
let globalHealthManager: HealthCheckManager | null = null;

export function createHealthCheckManager(
  config?: Partial<HealthCheckConfig>,
  scheduler?: BackgroundTaskScheduler
): HealthCheckManager {
  if (!globalHealthManager) {
    const fullConfig: HealthCheckConfig = {
      timeout: config?.timeout ?? 5000,
      interval: config?.interval ?? 30000,
      retries: config?.retries ?? 3,
      alertThresholds: {
        degradedLatency: config?.alertThresholds?.degradedLatency ?? 1000,
        unhealthyLatency: config?.alertThresholds?.unhealthyLatency ?? 5000,
        criticalFailureCount: config?.alertThresholds?.criticalFailureCount ?? 3,
      },
    };
    globalHealthManager = new HealthCheckManager(fullConfig, scheduler);
  }
  return globalHealthManager;
}

export function getHealthCheckManager(): HealthCheckManager | null {
  return globalHealthManager;
}

// Export all health checkers
export { DatabaseHealthChecker, DatabaseConnectionPoolHealthChecker } from "./checkers/database.js";
export { RedisHealthChecker, CacheHealthChecker, QueueHealthChecker } from "./checkers/redis.js";
export { CircuitBreakerHealthChecker } from "./checkers/circuitBreaker.js";
export { StorageHealthChecker } from "./checkers/storage.js";
export { ProviderHealthChecker } from "./checkers/provider.js";

// Export tenant health monitoring
export {
  TenantHealthMonitor,
  createTenantHealthMonitor,
  type TenantHealthMetrics,
  type TenantAlertThresholds,
} from "./tenantHealth.js";
