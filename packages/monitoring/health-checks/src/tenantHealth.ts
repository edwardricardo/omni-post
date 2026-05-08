/**
 * @file tenantHealth.ts
 * @description Per-tenant health scoring and alerting — computes tenant-level health metrics
 *              (queue depth, error rate) and emits Prometheus gauges for observability.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { ok, err, type Result } from "@shared/types";
import * as pino from "pino";
import * as client from "prom-client";
import type { HealthStatus, HealthAlert } from "./types.js";

const logger = pino.default({
  name: "tenant-health",
  level: process.env.LOG_LEVEL || "info",
});

// Prometheus metrics for tenant health
const tenantHealthScore = new client.Gauge({
  name: "tenant_health_score",
  help: "Health score for individual tenants (0-1)",
  labelNames: ["tenant_id", "project_id"],
});

const tenantQueueHealth = new client.Gauge({
  name: "tenant_queue_health",
  help: "Queue health status for tenant (1=healthy, 0.5=degraded, 0=unhealthy)",
  labelNames: ["tenant_id", "project_id", "queue_type"],
});

const _tenantStorageUsage = new client.Gauge({
  name: "tenant_storage_usage_bytes",
  help: "Storage usage by tenant in bytes",
  labelNames: ["tenant_id", "project_id"],
});

const tenantRateLimitStatus = new client.Gauge({
  name: "tenant_rate_limit_status",
  help: "Rate limit status for tenant (0=ok, 1=throttled)",
  labelNames: ["tenant_id", "project_id", "provider"],
});

export interface TenantHealthMetrics {
  tenantId: string;
  projectId: string;
  overallHealth: HealthStatus;
  score: number;
  timestamp: Date;
  queues: {
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
    status: HealthStatus;
  };
  storage: {
    usedBytes: number;
    quotaBytes: number;
    usagePercent: number;
    status: HealthStatus;
  };
  rateLimits: Array<{
    provider: string;
    remaining: number;
    resetTime: Date;
    throttled: boolean;
    status: HealthStatus;
  }>;
  integrations: Array<{
    provider: string;
    channelId: string;
    lastSuccess: Date | null;
    lastError: string | null;
    status: HealthStatus;
  }>;
  alerts: HealthAlert[];
}

export interface TenantAlertThresholds {
  queueBacklogWarning: number;
  queueBacklogCritical: number;
  storageWarningPercent: number;
  storageCriticalPercent: number;
  rateLimitWarningPercent: number;
  integrationFailureHours: number;
}

/** Minimal interface for the database repository used by TenantHealthMonitor. */
export interface TenantDbRepo {
  getProjectsByAccount(tenantId: string): Promise<Result<Array<{ id: string }>, unknown>>;
  listLogs(opts: { limit: number; offset: number }): Promise<
    Result<
      Array<{
        channelId: string;
        provider: string;
        status: string;
        createdAt: Date;
      }>,
      unknown
    >
  >;
}

/** Minimal interface for the queue adapter used by TenantHealthMonitor. */
export interface TenantQueueAdapter {
  health(): Promise<Result<{ waiting: number; active: number; failed: number }, unknown>>;
}

/**
 * Minimal interface for the storage adapter used by TenantHealthMonitor.
 * Storage metrics are not yet available in StoragePort, so this adapter
 * is accepted but not queried for specific methods.
 */
export interface TenantStorageAdapter {}

/** Minimal interface for the cache manager used by TenantHealthMonitor. */
export interface TenantCacheManager {
  get(
    key: string
  ): Promise<Result<{ remaining: number; resetTime: number; throttled: boolean } | null, unknown>>;
}

export class TenantHealthMonitor {
  private alerts = new Map<string, HealthAlert[]>(); // tenant -> alerts
  private readonly defaultThresholds: TenantAlertThresholds = {
    queueBacklogWarning: 50,
    queueBacklogCritical: 200,
    storageWarningPercent: 80,
    storageCriticalPercent: 95,
    rateLimitWarningPercent: 90,
    integrationFailureHours: 24,
  };
  private readonly thresholds: TenantAlertThresholds;

  constructor(
    private dbRepo: TenantDbRepo,
    private queueAdapter: TenantQueueAdapter,
    private storageAdapter: TenantStorageAdapter,
    private cacheManager: TenantCacheManager,
    thresholds?: Partial<TenantAlertThresholds>
  ) {
    this.thresholds = {
      ...this.defaultThresholds,
      ...(thresholds ? thresholds : {}),
    };
  }

  /**
   * Get comprehensive health metrics for a specific tenant
   */
  async getTenantHealth(
    tenantId: string,
    projectId: string
  ): Promise<Result<TenantHealthMetrics, "NOT_FOUND" | "ACCESS_DENIED">> {
    try {
      // Verify tenant has access to project
      const projectAccess = await this.verifyProjectAccess(tenantId, projectId);
      if (!projectAccess.ok) {
        return projectAccess;
      }

      // Gather metrics from various sources
      const [queueHealth, storageHealth, rateLimitHealth, integrationHealth] = await Promise.all([
        this.getQueueHealth(tenantId, projectId),
        this.getStorageHealth(projectId),
        this.getRateLimitHealth(tenantId, projectId),
        this.getIntegrationHealth(projectId),
      ]);

      // Calculate overall health score
      const components = [
        queueHealth.ok ? this.statusToNumber(queueHealth.value.status) : 0,
        storageHealth.ok ? this.statusToNumber(storageHealth.value.status) : 0,
        rateLimitHealth.ok ? this.calculateAverageRateLimitHealth(rateLimitHealth.value) : 0.5, // Rate limits are less critical
        integrationHealth.ok ? this.calculateAverageIntegrationHealth(integrationHealth.value) : 0,
      ];

      const score = components.reduce((sum, score) => sum + score, 0) / components.length;
      const overallHealth = this.scoreToStatus(score);

      // Generate alerts for this tenant
      const alerts = this.generateTenantAlerts(tenantId, projectId, {
        queue: queueHealth.ok ? queueHealth.value : null,
        storage: storageHealth.ok ? storageHealth.value : null,
        rateLimits: rateLimitHealth.ok ? rateLimitHealth.value : [],
        integrations: integrationHealth.ok ? integrationHealth.value : [],
      });

      // Update Prometheus metrics
      tenantHealthScore.set({ tenant_id: tenantId, project_id: projectId }, score);

      const metrics: TenantHealthMetrics = {
        tenantId,
        projectId,
        overallHealth,
        score,
        timestamp: new Date(),
        queues: queueHealth.ok
          ? queueHealth.value
          : {
              waiting: 0,
              active: 0,
              failed: 0,
              delayed: 0,
              status: "unhealthy" as HealthStatus,
            },
        storage: storageHealth.ok
          ? storageHealth.value
          : {
              usedBytes: 0,
              quotaBytes: 0,
              usagePercent: 0,
              status: "unhealthy" as HealthStatus,
            },
        rateLimits: rateLimitHealth.ok ? rateLimitHealth.value : [],
        integrations: integrationHealth.ok ? integrationHealth.value : [],
        alerts,
      };

      logger.info(
        `Tenant health check completed for ${tenantId}/${projectId}: ${overallHealth} (score: ${score.toFixed(2)})`
      );
      return ok(metrics);
    } catch (error: unknown) {
      logger.error({ err: error }, `Tenant health check failed for ${tenantId}/${projectId}`);
      return err("NOT_FOUND");
    }
  }

  /**
   * Get alerts for a specific tenant
   */
  getTenantAlerts(tenantId: string, level?: HealthAlert["level"]): HealthAlert[] {
    const tenantAlerts = this.alerts.get(tenantId) || [];
    return level ? tenantAlerts.filter((a) => a.level === level) : tenantAlerts;
  }

  /**
   * Acknowledge an alert for a tenant
   */
  acknowledgeTenantAlert(tenantId: string, alertId: string): boolean {
    const tenantAlerts = this.alerts.get(tenantId) || [];
    const alert = tenantAlerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info(`Tenant alert acknowledged: ${tenantId}/${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Clear acknowledged alerts for a tenant
   */
  clearTenantAcknowledgedAlerts(tenantId: string): number {
    const tenantAlerts = this.alerts.get(tenantId) || [];
    const count = tenantAlerts.filter((a) => a.acknowledged).length;
    const remaining = tenantAlerts.filter((a) => !a.acknowledged);
    this.alerts.set(tenantId, remaining);
    logger.info(`Cleared ${count} acknowledged alerts for tenant ${tenantId}`);
    return count;
  }

  private async verifyProjectAccess(
    tenantId: string,
    projectId: string
  ): Promise<Result<void, "NOT_FOUND" | "ACCESS_DENIED">> {
    try {
      // Simple project existence check for now
      // In a real system, you'd check tenant ownership/membership
      const projectsResult = await this.dbRepo.getProjectsByAccount(tenantId);
      if (!projectsResult.ok) {
        return err("ACCESS_DENIED");
      }

      const project = projectsResult.value.find((p) => p.id === projectId);

      if (!project) {
        return err("NOT_FOUND");
      }

      // For now, assume all tenants can access all projects
      // In production, you'd implement proper authorization logic here
      return ok(undefined);
    } catch {
      return err("ACCESS_DENIED");
    }
  }

  private async getQueueHealth(
    tenantId: string,
    projectId: string
  ): Promise<
    Result<
      { waiting: number; active: number; failed: number; delayed: number; status: HealthStatus },
      string
    >
  > {
    try {
      // Get general queue health (project-specific metrics not available in QueuePort)
      const queueHealth = await this.queueAdapter.health();

      if (!queueHealth.ok) {
        return err("Queue metrics unavailable");
      }

      const { waiting, active, failed } = queueHealth.value;
      const delayed = 0; // Not available in QueuePort interface

      // Determine status based on thresholds
      let status: HealthStatus = "healthy";
      if (waiting > this.thresholds.queueBacklogCritical || failed > 20) {
        status = "unhealthy";
      } else if (waiting > this.thresholds.queueBacklogWarning || failed > 5) {
        status = "degraded";
      }

      tenantQueueHealth.set(
        { tenant_id: tenantId, project_id: projectId, queue_type: "publication" },
        this.statusToNumber(status)
      );

      return ok({ waiting, active, failed, delayed, status });
    } catch {
      return err("Queue health check failed");
    }
  }

  private async getStorageHealth(
    _projectId: string
  ): Promise<
    Result<
      { usedBytes: number; quotaBytes: number; usagePercent: number; status: HealthStatus },
      string
    >
  > {
    try {
      // Storage metrics not available in StoragePort interface
      // Return default healthy status
      const usedBytes = 0;
      const quotaBytes = 1024 * 1024 * 1024; // 1GB default quota
      const usagePercent = 0;
      const status: HealthStatus = "healthy";

      return ok({ usedBytes, quotaBytes, usagePercent, status });
    } catch {
      return err("Storage health check failed");
    }
  }

  private async getRateLimitHealth(
    tenantId: string,
    projectId: string
  ): Promise<
    Result<
      Array<{
        provider: string;
        remaining: number;
        resetTime: Date;
        throttled: boolean;
        status: HealthStatus;
      }>,
      string
    >
  > {
    try {
      // Get rate limit status for all channels in the project
      // Note: Channel lookup not available in RepoPort interface
      // Return empty array for now
      const channels: Array<{ id: string; provider: string }> = [];

      const rateLimitStatuses = await Promise.all(
        channels.map(async (channel: { id: string; provider: string }) => {
          // Get rate limit info from cache (set by rate limiting middleware)
          const rateLimitKey = `rate_limit:${channel.provider}:${channel.id}`;
          const rateLimitData = await this.cacheManager.get(rateLimitKey);

          if (!rateLimitData.ok || !rateLimitData.value) {
            return {
              provider: channel.provider,
              remaining: 100, // Default to healthy
              resetTime: new Date(Date.now() + 3600000), // 1 hour from now
              throttled: false,
              status: "healthy" as HealthStatus,
            };
          }

          const { remaining, resetTime, throttled } = rateLimitData.value;
          const remainingPercent = (remaining / 100) * 100; // Assuming 100 is the limit

          let status: HealthStatus = "healthy";
          if (throttled || remainingPercent < 10) {
            status = "unhealthy";
          } else if (remainingPercent < this.thresholds.rateLimitWarningPercent) {
            status = "degraded";
          }

          tenantRateLimitStatus.set(
            { tenant_id: tenantId, project_id: projectId, provider: channel.provider },
            throttled ? 1 : 0
          );

          return {
            provider: channel.provider,
            remaining,
            resetTime: new Date(resetTime),
            throttled,
            status,
          };
        })
      );

      return ok(rateLimitStatuses);
    } catch {
      return err("Rate limit health check failed");
    }
  }

  private async getIntegrationHealth(_projectId: string): Promise<
    Result<
      Array<{
        provider: string;
        channelId: string;
        lastSuccess: Date | null;
        lastError: string | null;
        status: HealthStatus;
      }>,
      string
    >
  > {
    try {
      // Get recent publication logs for the project
      const recentLogs = await this.dbRepo.listLogs({
        limit: 100,
        offset: 0,
      });

      if (!recentLogs.ok) {
        return err("Integration health check failed");
      }

      // Filter logs from last 24 hours (client-side filtering due to interface limitations)
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const filteredLogs = recentLogs.value.filter((log) => log.createdAt >= last24Hours);

      // Group by channel and analyze success/failure patterns
      const channelHealth = new Map<
        string,
        {
          provider: string;
          channelId: string;
          lastSuccess: Date | null;
          lastError: string | null;
          successes: number;
          failures: number;
        }
      >();

      for (const log of filteredLogs) {
        const key = log.channelId;
        const existing = channelHealth.get(key) || {
          provider: log.provider,
          channelId: log.channelId,
          lastSuccess: null,
          lastError: null,
          successes: 0,
          failures: 0,
        };

        if (log.status === "OK") {
          existing.successes++;
          if (!existing.lastSuccess || log.createdAt > existing.lastSuccess) {
            existing.lastSuccess = log.createdAt;
          }
        } else {
          existing.failures++;
          existing.lastError = `Failed with status: ${log.status}`;
        }

        channelHealth.set(key, existing);
      }

      // Convert to health status
      const integrationStatuses = Array.from(channelHealth.values()).map((channel) => {
        const total = channel.successes + channel.failures;
        const successRate = total > 0 ? channel.successes / total : 1;

        // Check if integration has been failing for too long
        const hoursSinceLastSuccess = channel.lastSuccess
          ? (Date.now() - channel.lastSuccess.getTime()) / (1000 * 60 * 60)
          : 999;

        let status: HealthStatus = "healthy";
        if (successRate < 0.5 || hoursSinceLastSuccess > this.thresholds.integrationFailureHours) {
          status = "unhealthy";
        } else if (successRate < 0.8 || hoursSinceLastSuccess > 6) {
          status = "degraded";
        }

        return {
          provider: channel.provider,
          channelId: channel.channelId,
          lastSuccess: channel.lastSuccess,
          lastError: channel.lastError,
          status,
        };
      });

      return ok(integrationStatuses);
    } catch {
      return err("Integration health check failed");
    }
  }

  private generateTenantAlerts(
    tenantId: string,
    projectId: string,
    health: {
      queue: { waiting: number; failed: number } | null;
      storage: { usagePercent: number } | null;
      rateLimits: Array<{ provider: string; throttled: boolean }>;
      integrations: Array<{ provider: string; status: HealthStatus; lastError: string | null }>;
    }
  ): HealthAlert[] {
    const alerts: HealthAlert[] = [];

    // Queue alerts
    if (health.queue) {
      if (health.queue.waiting > this.thresholds.queueBacklogCritical) {
        alerts.push(
          this.createAlert(
            tenantId,
            "critical",
            `High queue backlog: ${health.queue.waiting} jobs waiting`
          )
        );
      } else if (health.queue.waiting > this.thresholds.queueBacklogWarning) {
        alerts.push(
          this.createAlert(
            tenantId,
            "warning",
            `Queue backlog: ${health.queue.waiting} jobs waiting`
          )
        );
      }

      if (health.queue.failed > 20) {
        alerts.push(
          this.createAlert(
            tenantId,
            "error",
            `High failure rate: ${health.queue.failed} failed jobs`
          )
        );
      }
    }

    // Storage alerts
    if (health.storage) {
      if (health.storage.usagePercent >= this.thresholds.storageCriticalPercent) {
        alerts.push(
          this.createAlert(
            tenantId,
            "critical",
            `Storage quota critical: ${health.storage.usagePercent.toFixed(1)}% used`
          )
        );
      } else if (health.storage.usagePercent >= this.thresholds.storageWarningPercent) {
        alerts.push(
          this.createAlert(
            tenantId,
            "warning",
            `Storage quota warning: ${health.storage.usagePercent.toFixed(1)}% used`
          )
        );
      }
    }

    // Rate limit alerts
    for (const rateLimit of health.rateLimits || []) {
      if (rateLimit.throttled) {
        alerts.push(this.createAlert(tenantId, "error", `Rate limited on ${rateLimit.provider}`));
      }
    }

    // Integration alerts
    for (const integration of health.integrations || []) {
      if (integration.status === "unhealthy") {
        alerts.push(
          this.createAlert(
            tenantId,
            "error",
            `${integration.provider} integration failing: ${integration.lastError || "Unknown error"}`
          )
        );
      }
    }

    // Store alerts for this tenant
    this.alerts.set(tenantId, [...(this.alerts.get(tenantId) || []), ...alerts]);

    return alerts;
  }

  private createAlert(tenantId: string, level: HealthAlert["level"], message: string): HealthAlert {
    return {
      id: `tenant-alert-${randomUUID()}`,
      level,
      message,
      timestamp: new Date(),
      acknowledged: false,
    };
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

  private scoreToStatus(score: number): HealthStatus {
    if (score >= 0.8) return "healthy";
    if (score >= 0.5) return "degraded";
    return "unhealthy";
  }

  private calculateAverageRateLimitHealth(rateLimits: Array<{ status: HealthStatus }>): number {
    if (rateLimits.length === 0) return 1; // No rate limits = healthy
    const total = rateLimits.reduce((sum, rl) => sum + this.statusToNumber(rl.status), 0);
    return total / rateLimits.length;
  }

  private calculateAverageIntegrationHealth(integrations: Array<{ status: HealthStatus }>): number {
    if (integrations.length === 0) return 1; // No integrations = healthy
    const total = integrations.reduce((sum, int) => sum + this.statusToNumber(int.status), 0);
    return total / integrations.length;
  }
}

// Export factory function
export function createTenantHealthMonitor(
  dbRepo: TenantDbRepo,
  queueAdapter: TenantQueueAdapter,
  storageAdapter: TenantStorageAdapter,
  cacheManager: TenantCacheManager,
  thresholds?: Partial<TenantAlertThresholds>
): TenantHealthMonitor {
  return new TenantHealthMonitor(dbRepo, queueAdapter, storageAdapter, cacheManager, thresholds);
}
