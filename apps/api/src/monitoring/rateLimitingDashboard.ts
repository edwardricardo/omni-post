/**
 * @file rateLimitingDashboard.ts
 * @description Monitoring dashboard providing analytics, alerting, and real-time metrics
 *              for the advanced rate limiting system.
 * @layer infrastructure
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod/v4";
import Redis from "ioredis";
import { ApiMetrics } from "../metrics/apiMetrics.js";
import { AppError } from "../lib/errors/index.js";
import { createLogger } from "../lib/logger.js";

const monitoringLogger = createLogger("monitoring");

interface RateLimitMetrics {
  total_requests: number;
  rate_limited_requests: number;
  burst_protected_requests: number;
  emergency_mode_activations: number;
  tenant_specific_blocks: Record<string, number>;
  average_response_time: number;
  peak_usage_periods: Array<{
    timestamp: string;
    requests_per_minute: number;
    tenant: string;
  }>;
  distributed_instance_stats: Record<
    string,
    {
      active: boolean;
      last_heartbeat: string;
      requests_handled: number;
    }
  >;
}

export interface AlertConfig {
  enabled: boolean;
  thresholds: {
    rate_limit_ratio: number; // Alert when rate limiting > X% of requests
    emergency_activations: number; // Alert after X emergency activations
    tenant_abuse_threshold: number; // Alert when tenant exceeds normal usage by X%
    response_time_threshold: number; // Alert when avg response time > X ms
  };
  notification_channels: {
    slack?: {
      webhook_url: string;
      channel: string;
    };
    email?: {
      recipients: string[];
      smtp_config: object;
    };
    pagerduty?: {
      integration_key: string;
      severity: string;
    };
  };
}

export class RateLimitingDashboard {
  private redis: Redis;
  private metrics: ApiMetrics;
  private alertConfig: AlertConfig;
  private readonly METRICS_PREFIX = "rate_limit:metrics:";
  private readonly ALERT_PREFIX = "rate_limit:alerts:";

  constructor(redis: Redis, metrics: ApiMetrics, alertConfig: AlertConfig) {
    this.redis = redis;
    this.metrics = metrics;
    this.alertConfig = alertConfig;
  }

  /**
   * Get comprehensive rate limiting metrics for dashboard
   */
  async getMetrics(timeRange: "1h" | "24h" | "7d" = "1h"): Promise<RateLimitMetrics> {
    const now = Date.now();
    const timeMs = this.getTimeRangeMs(timeRange);
    const startTime = now - timeMs;

    const [
      totalRequests,
      rateLimitedRequests,
      burstProtectedRequests,
      emergencyActivations,
      tenantStats,
      distributedStats,
    ] = await Promise.all([
      this.getTotalRequests(startTime, now),
      this.getRateLimitedRequests(startTime, now),
      this.getBurstProtectedRequests(startTime, now),
      this.getEmergencyActivations(startTime, now),
      this.getTenantSpecificStats(startTime, now),
      this.getDistributedInstanceStats(),
    ]);

    const peakUsage = await this.getPeakUsagePeriods(startTime, now);
    const avgResponseTime = await this.getAverageResponseTime(startTime, now);

    return {
      total_requests: totalRequests,
      rate_limited_requests: rateLimitedRequests,
      burst_protected_requests: burstProtectedRequests,
      emergency_mode_activations: emergencyActivations,
      tenant_specific_blocks: tenantStats,
      average_response_time: avgResponseTime,
      peak_usage_periods: peakUsage,
      distributed_instance_stats: distributedStats as Record<
        string,
        { active: boolean; last_heartbeat: string; requests_handled: number }
      >,
    };
  }

  /**
   * Register dashboard routes with Fastify
   */
  async register(app: FastifyInstance) {
    // Main dashboard endpoint
    app.get(
      "/admin/rate-limiting/dashboard",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const querySchema = z.object({
          timeRange: z.enum(["1h", "24h", "7d"]).default("1h"),
        });

        try {
          const { timeRange } = querySchema.parse(request.query);
          const metrics = await this.getMetrics(timeRange);

          return reply.send({
            ok: true,
            data: metrics,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          app.log.error({ error }, "Invalid query parameters for rate limit metrics");
          throw AppError.badRequest("Invalid query parameters");
        }
      }
    );

    // Real-time metrics endpoint
    app.get(
      "/admin/rate-limiting/realtime",
      async (_request: FastifyRequest, reply: FastifyReply) => {
        const realTimeMetrics = await this.getRealTimeMetrics();

        return reply.send({
          ok: true,
          data: realTimeMetrics,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // Tenant-specific analytics
    app.get(
      "/admin/rate-limiting/tenant/:tenantId",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const paramsSchema = z.object({
          tenantId: z.string().min(1),
        });

        const querySchema = z.object({
          timeRange: z.enum(["1h", "24h", "7d"]).default("24h"),
        });

        try {
          const { tenantId } = paramsSchema.parse(request.params);
          const { timeRange } = querySchema.parse(request.query);

          const tenantMetrics = await this.getTenantMetrics(tenantId, timeRange);

          return reply.send({
            ok: true,
            tenant: tenantId,
            data: tenantMetrics,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          app.log.error({ error }, "Invalid parameters for tenant rate limit metrics");
          throw AppError.badRequest("Invalid parameters");
        }
      }
    );

    // Alert configuration endpoint
    app.get(
      "/admin/rate-limiting/alerts",
      async (_request: FastifyRequest, reply: FastifyReply) => {
        const activeAlerts = await this.getActiveAlerts();

        return reply.send({
          ok: true,
          config: this.alertConfig,
          active_alerts: activeAlerts,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // Emergency mode status
    app.get(
      "/admin/rate-limiting/emergency-status",
      async (_request: FastifyRequest, reply: FastifyReply) => {
        const emergencyStatus = await this.getEmergencyModeStatus();

        return reply.send({
          ok: true,
          emergency_mode: emergencyStatus,
          timestamp: new Date().toISOString(),
        });
      }
    );
  }

  /**
   * Check for alert conditions and trigger notifications
   */
  async checkAlerts(): Promise<void> {
    if (!this.alertConfig.enabled) {
      return;
    }

    const metrics = await this.getMetrics("1h");
    const alerts: Array<{ type: string; message: string; severity: "warning" | "critical" }> = [];

    // Check rate limiting ratio
    const rateLimitRatio = metrics.rate_limited_requests / metrics.total_requests;
    if (rateLimitRatio > this.alertConfig.thresholds.rate_limit_ratio) {
      alerts.push({
        type: "high_rate_limiting",
        message: `High rate limiting detected: ${(rateLimitRatio * 100).toFixed(2)}% of requests are being rate limited`,
        severity: rateLimitRatio > 0.5 ? "critical" : "warning",
      });
    }

    // Check emergency mode activations
    if (metrics.emergency_mode_activations > this.alertConfig.thresholds.emergency_activations) {
      alerts.push({
        type: "emergency_mode_frequent",
        message: `Emergency mode activated ${metrics.emergency_mode_activations} times in the past hour`,
        severity: "critical",
      });
    }

    // Check response time degradation
    if (metrics.average_response_time > this.alertConfig.thresholds.response_time_threshold) {
      alerts.push({
        type: "response_time_degradation",
        message: `Average response time elevated: ${metrics.average_response_time}ms`,
        severity: "warning",
      });
    }

    // Check for tenant abuse patterns
    for (const [tenantId, blocks] of Object.entries(metrics.tenant_specific_blocks)) {
      const normalUsage = await this.getTenantNormalUsage(tenantId);
      const abuseRatio = blocks / (normalUsage || 1);

      if (abuseRatio > this.alertConfig.thresholds.tenant_abuse_threshold) {
        alerts.push({
          type: "tenant_abuse",
          message: `Tenant ${tenantId} showing unusual usage pattern: ${blocks} blocks (${abuseRatio.toFixed(2)}x normal)`,
          severity: "warning",
        });
      }
    }

    // Send alerts if any were triggered
    if (alerts.length > 0) {
      await this.sendAlerts(alerts);
    }
  }

  private async getTotalRequests(startTime: number, endTime: number): Promise<number> {
    // Implementation would query Redis time series data
    const key = `${this.METRICS_PREFIX}total_requests`;
    return this.getTimeSeriesSum(key, startTime, endTime);
  }

  private async getRateLimitedRequests(startTime: number, endTime: number): Promise<number> {
    const key = `${this.METRICS_PREFIX}rate_limited`;
    return this.getTimeSeriesSum(key, startTime, endTime);
  }

  private async getBurstProtectedRequests(startTime: number, endTime: number): Promise<number> {
    const key = `${this.METRICS_PREFIX}burst_protected`;
    return this.getTimeSeriesSum(key, startTime, endTime);
  }

  private async getEmergencyActivations(startTime: number, endTime: number): Promise<number> {
    const key = `${this.METRICS_PREFIX}emergency_activations`;
    return this.getTimeSeriesSum(key, startTime, endTime);
  }

  private async getTenantSpecificStats(
    startTime: number,
    endTime: number
  ): Promise<Record<string, number>> {
    const pattern = `${this.METRICS_PREFIX}tenant:*:blocks`;
    const keys = await this.redis.keys(pattern);
    const stats: Record<string, number> = {};

    for (const key of keys) {
      const tenantId = key.split(":")[3];
      if (tenantId) {
        stats[tenantId] = await this.getTimeSeriesSum(key, startTime, endTime);
      }
    }

    return stats;
  }

  private async getDistributedInstanceStats(): Promise<Record<string, unknown>> {
    const pattern = "rate_limit:instances:*";
    const keys = await this.redis.keys(pattern);
    const stats: Record<string, unknown> = {};

    for (const key of keys) {
      const instanceId = key.split(":")[2];
      if (instanceId) {
        const data = await this.redis.hgetall(key);
        stats[instanceId] = {
          active: data.active === "true",
          last_heartbeat: data.last_heartbeat,
          requests_handled: parseInt(data.requests_handled || "0", 10),
        };
      }
    }

    return stats;
  }

  private async getPeakUsagePeriods(
    _startTime: number,
    _endTime: number
  ): Promise<Array<{ timestamp: string; requests_per_minute: number; tenant: string }>> {
    // Implementation would analyze time series data to find peak usage
    return [];
  }

  private async getAverageResponseTime(startTime: number, endTime: number): Promise<number> {
    const key = `${this.METRICS_PREFIX}response_times`;
    return this.getTimeSeriesAverage(key, startTime, endTime);
  }

  private async getRealTimeMetrics(): Promise<object> {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    return {
      current_requests_per_minute:
        (await this.getTimeSeriesSum(`${this.METRICS_PREFIX}total_requests`, fiveMinutesAgo, now)) /
        5,
      active_rate_limits: await this.getActiveRateLimits(),
      emergency_mode_active: await this.isEmergencyModeActive(),
      distributed_instances: Object.keys(await this.getDistributedInstanceStats()).length,
    };
  }

  private async getTenantMetrics(tenantId: string, timeRange: string): Promise<object> {
    const now = Date.now();
    const timeMs = this.getTimeRangeMs(timeRange);
    const startTime = now - timeMs;

    return {
      requests: await this.getTimeSeriesSum(
        `${this.METRICS_PREFIX}tenant:${tenantId}:requests`,
        startTime,
        now
      ),
      blocks: await this.getTimeSeriesSum(
        `${this.METRICS_PREFIX}tenant:${tenantId}:blocks`,
        startTime,
        now
      ),
      burst_usage: await this.getTimeSeriesSum(
        `${this.METRICS_PREFIX}tenant:${tenantId}:burst`,
        startTime,
        now
      ),
      tier: (await this.redis.get(`tenant:${tenantId}:tier`)) || "basic",
      current_usage: await this.getTenantCurrentUsage(tenantId),
    };
  }

  private async getActiveAlerts(): Promise<Array<unknown>> {
    const keys = await this.redis.keys(`${this.ALERT_PREFIX}*`);
    const alerts = [];

    for (const key of keys) {
      const alert = await this.redis.get(key);
      if (alert) {
        alerts.push(JSON.parse(alert));
      }
    }

    return alerts;
  }

  private async getEmergencyModeStatus(): Promise<object> {
    const isActive = await this.isEmergencyModeActive();
    const activationCount =
      (await this.redis.get(`${this.METRICS_PREFIX}emergency_activations:today`)) || "0";
    const lastActivation = await this.redis.get("rate_limit:emergency:last_activation");

    return {
      active: isActive,
      activations_today: parseInt(activationCount, 10),
      last_activation: lastActivation,
      current_error_rate: await this.getCurrentErrorRate(),
    };
  }

  private async sendAlerts(
    alerts: Array<{ type: string; message: string; severity: string }>
  ): Promise<void> {
    // Store alerts in Redis for dashboard display
    for (const alert of alerts) {
      const alertKey = `${this.ALERT_PREFIX}${Date.now()}:${alert.type}`;
      await this.redis.setex(
        alertKey,
        86400,
        JSON.stringify({
          ...alert,
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Send to external notification channels
    if (this.alertConfig.notification_channels.slack) {
      await this.sendSlackAlerts(alerts);
    }

    if (this.alertConfig.notification_channels.email) {
      await this.sendEmailAlerts(alerts);
    }

    if (this.alertConfig.notification_channels.pagerduty) {
      await this.sendPagerDutyAlerts(alerts);
    }
  }

  private async sendSlackAlerts(
    alerts: Array<{ type: string; message: string; severity: string }>
  ): Promise<void> {
    // Slack webhook implementation
    monitoringLogger.info({ alerts }, "Slack alerts would be sent");
  }

  private async sendEmailAlerts(
    alerts: Array<{ type: string; message: string; severity: string }>
  ): Promise<void> {
    // Email notification implementation
    monitoringLogger.info({ alertCount: alerts.length }, "Email alerts would be sent");
  }

  private async sendPagerDutyAlerts(
    alerts: Array<{ type: string; message: string; severity: string }>
  ): Promise<void> {
    // PagerDuty integration implementation
    monitoringLogger.info({ alertCount: alerts.length }, "PagerDuty alerts would be sent");
  }

  // Helper methods
  private getTimeRangeMs(timeRange: string): number {
    switch (timeRange) {
      case "1h":
        return 60 * 60 * 1000;
      case "24h":
        return 24 * 60 * 60 * 1000;
      case "7d":
        return 7 * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000;
    }
  }

  private async getTimeSeriesSum(
    _key: string,
    _startTime: number,
    _endTime: number
  ): Promise<number> {
    // Future: implement real Redis time-series queries (e.g. TS.RANGE) once RedisTimeSeries module is enabled
    return 0;
  }

  private async getTimeSeriesAverage(
    _key: string,
    _startTime: number,
    _endTime: number
  ): Promise<number> {
    // Future: implement real Redis time-series average (e.g. TS.RANGE + aggregation) once RedisTimeSeries module is enabled
    return 0;
  }

  private async getActiveRateLimits(): Promise<number> {
    const keys = await this.redis.keys("rate_limit:*:*");
    return keys.length;
  }

  private async isEmergencyModeActive(): Promise<boolean> {
    const emergencyKey = "rate_limit:emergency:active";
    const result = await this.redis.get(emergencyKey);
    return result === "true";
  }

  private async getTenantNormalUsage(_tenantId: string): Promise<number> {
    // Future: calculate baseline from historical Redis time-series data (e.g. 30-day rolling average)
    return 0;
  }

  private async getTenantCurrentUsage(tenantId: string): Promise<object> {
    const currentWindowKey = `rate_limit:${tenantId}:current`;
    const usage = (await this.redis.get(currentWindowKey)) || "0";

    return {
      current_window_requests: parseInt(usage, 10),
      window_start: Date.now() - 60 * 1000, // 1 minute window
      percentage_used: (parseInt(usage, 10) / 60) * 100, // Assuming 60 req/min limit
    };
  }

  private async getCurrentErrorRate(): Promise<number> {
    // Future: compute error rate from Redis time-series counters (errors / total requests)
    return 0;
  }
}

/**
 * Default alert configuration
 */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  thresholds: {
    rate_limit_ratio: 0.15, // Alert when >15% of requests are rate limited
    emergency_activations: 2, // Alert after 2 emergency activations per hour
    tenant_abuse_threshold: 3.0, // Alert when tenant exceeds 3x normal usage
    response_time_threshold: 2000, // Alert when avg response time > 2s
  },
  notification_channels: {
    // Configuration would be loaded from environment
  },
};
