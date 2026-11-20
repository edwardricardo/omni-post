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

/** How long a check's one attempt may take before it reports a failure. */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** The refresh interval while the last report is healthy or degraded. */
const HEALTHY_REFRESH_INTERVAL_MS = 30_000;

/**
 * The refresh interval while the last report is unhealthy. A check makes one attempt bounded by
 * the timeout, so a dependency that recovers reads healthy within one interval plus one timeout.
 */
const UNHEALTHY_REFRESH_INTERVAL_MS = 5_000;

/** The timing and alert thresholds a manager uses for every setting its caller does not pass. */
const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
  timeout: HEALTH_CHECK_TIMEOUT_MS,
  interval: HEALTHY_REFRESH_INTERVAL_MS,
  unhealthyInterval: UNHEALTHY_REFRESH_INTERVAL_MS,
  alertThresholds: {
    degradedLatency: 1000,
    unhealthyLatency: 5000,
    criticalFailureCount: 3,
  },
};

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
  // ECMAScript-private rather than TypeScript-private: `private` is erased at
  // runtime and index access (`manager["checkers"]`) slips past it at compile
  // time, which is exactly how the public dependency route came to publish the
  // registered dependency map. `#` makes that reach a syntax error, so the
  // registry can only be read through the methods that decide what to expose.
  readonly #checkers = new Map<
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
  /** The interval the refresh task is registered with now; set by `start`. */
  private refreshIntervalMs: number | undefined;

  constructor(
    private globalConfig: HealthCheckConfig = DEFAULT_HEALTH_CHECK_CONFIG,
    scheduler?: BackgroundTaskScheduler
  ) {
    this.scheduler = scheduler;
  }

  /**
   * @method register
   * @description Registers a checker under a dependency name, with this manager's timing unless
   *   the options override it. A dependency is critical unless the options say otherwise.
   * @param name - The dependency name reports and `checkDependency` use.
   * @param checker - The checker that probes the dependency.
   * @param options - The dependency's type, whether it is critical, and any timing override.
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
    this.#checkers.set(name, {
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
   * @method checkDependency
   * @description Runs one dependency's checker now, in one attempt, and records its result in the
   *   report `getCurrentStatus` answers from.
   * @param name - The dependency name it was registered under.
   * @returns The dependency's health, `NOT_FOUND` for a name nothing registered, or `CHECK_FAILED`
   *   when the check could not be run.
   */
  async checkDependency(
    name: string
  ): Promise<Result<DependencyHealth, "NOT_FOUND" | "CHECK_FAILED">> {
    const entry = this.#checkers.get(name);
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
   * @method checkAll
   * @description Runs every registered checker concurrently, one attempt each, records the
   *   results, updates the metrics and the alerts, and builds the system report.
   * @returns The report: overall status, score, dependencies, process metrics and active alerts.
   */
  async checkAll(): Promise<SystemHealthReport> {
    const timer = healthCheckDuration.startTimer({
      check_type: "all",
      dependency: "system",
      status: "pending",
    });
    const startTime = Date.now();

    const checks = Array.from(this.#checkers.entries()).map(async ([name, entry]) => {
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
   * @method start
   * @description Starts refreshing the report on the scheduler: a first refresh at once, then
   *   every `interval` while the last report is healthy or degraded and every
   *   `unhealthyInterval` while it is unhealthy.
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
    this.refreshIntervalMs = this.globalConfig.interval;
    this.scheduler.register(this.periodicTaskId, this.refresh, this.refreshIntervalMs, {
      immediate: true,
      onError: this.onRefreshError,
    });

    logger.info(
      `Health check manager started (interval: ${this.globalConfig.interval}ms, ` +
        `${this.globalConfig.unhealthyInterval}ms while unhealthy)`
    );
  }

  /**
   * @method stop
   * @description Stops the refresh. A refresh already running finishes without re-arming it.
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.scheduler) {
      this.scheduler.unregister(this.periodicTaskId);
    }

    logger.info("Health check manager stopped");
  }

  /** One refresh: check every dependency, then arm the next refresh for what the report says. */
  private readonly refresh = async (): Promise<void> => {
    const report = await this.checkAll();
    this.rearmRefresh(report.overall);
  };

  private readonly onRefreshError = (err: unknown): void => {
    logger.error({ err }, "Periodic health check failed");
  };

  /**
   * Registers the refresh again under its id when the report calls for the other interval; the
   * scheduler replaces a task registered twice under one id. An unchanged interval keeps the
   * running task and its phase, and a stopped manager is never re-armed.
   */
  private rearmRefresh(overall: HealthStatus): void {
    const intervalMs =
      overall === "unhealthy" ? this.globalConfig.unhealthyInterval : this.globalConfig.interval;
    if (!this.isRunning || !this.scheduler || intervalMs === this.refreshIntervalMs) return;

    this.refreshIntervalMs = intervalMs;
    this.scheduler.register(this.periodicTaskId, this.refresh, intervalMs, {
      onError: this.onRefreshError,
    });
  }

  /**
   * @method getCurrentStatus
   * @description Builds the report from the results last recorded, by a refresh or a check on
   *   demand, without running any checker.
   * @returns The report, or `null` before any check has run.
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
   * @method acknowledgeAlert
   * @description Marks an alert acknowledged, so it leaves the active alerts of later reports.
   * @param alertId - The alert's id.
   * @returns `true` when an alert has that id, `false` otherwise.
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
   * @method getAlerts
   * @description Lists the alerts raised so far, acknowledged ones included.
   * @param level - When given, only the alerts of that level.
   * @returns A copy of the matching alerts.
   */
  getAlerts(level?: HealthAlert["level"]): HealthAlert[] {
    return level ? this.alerts.filter((a) => a.level === level) : [...this.alerts];
  }

  /**
   * @method clearAcknowledgedAlerts
   * @description Drops every acknowledged alert.
   * @returns How many alerts were dropped.
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
    let timeoutHandle: NodeJS.Timeout | undefined;

    // One attempt: a failure is reported at once, and the next refresh is the retry, which is
    // what keeps an unhealthy report from outliving a recovered dependency.
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("Health check timeout")), config.timeout);
      });

      const result = await Promise.race([checker.check(), timeout]);

      return {
        name,
        type: config.type,
        status: result.status,
        latency: Date.now() - startTime,
        message: result.message || `${name} is ${result.status}`,
        details: { ...result.details },
        lastChecked: new Date(),
        critical: config.critical,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        name,
        type: config.type,
        status: "unhealthy",
        latency: Date.now() - startTime,
        message: `Health check failed: ${errorMessage}`,
        details: { error: errorMessage },
        lastChecked: new Date(),
        critical: config.critical,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
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

/**
 * @function createHealthCheckManager
 * @description Returns the process's health manager, building it on the first call: the package's
 *   timeout and refresh intervals, with any setting the caller passes in their place. Later calls
 *   return the same manager and ignore their arguments.
 * @param config - Settings that replace the package's defaults, field by field.
 * @param scheduler - The scheduler the refresh runs on; `start` requires one.
 * @returns The process's health manager.
 */
export function createHealthCheckManager(
  config?: Partial<HealthCheckConfig>,
  scheduler?: BackgroundTaskScheduler
): HealthCheckManager {
  if (!globalHealthManager) {
    const fullConfig: HealthCheckConfig = {
      ...DEFAULT_HEALTH_CHECK_CONFIG,
      ...config,
      alertThresholds: {
        ...DEFAULT_HEALTH_CHECK_CONFIG.alertThresholds,
        ...config?.alertThresholds,
      },
    };
    globalHealthManager = new HealthCheckManager(fullConfig, scheduler);
  }
  return globalHealthManager;
}

/**
 * @function getHealthCheckManager
 * @description Returns the process's health manager when `createHealthCheckManager` built one.
 * @returns The manager, or `null` before it was built.
 */
export function getHealthCheckManager(): HealthCheckManager | null {
  return globalHealthManager;
}

export { isUsable } from "./usable.js";

// Export all health checkers
export { DatabaseHealthChecker, DatabaseConnectionPoolHealthChecker } from "./checkers/database.js";
export { RedisHealthChecker, CacheHealthChecker } from "./checkers/redis.js";
export { QueueHealthChecker } from "./checkers/queue.js";
export { ConsumerPresenceHealthChecker } from "./checkers/consumerPresence.js";
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
