import type { FastifyRequest, FastifyReply } from "fastify";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import Redis from "ioredis";
import { createLogger } from "../lib/logger.js";

const monitoringLogger = createLogger("monitoring");

interface PerformanceMetrics {
  responseTime: number;
  statusCode: number;
  method: string;
  route: string;
  timestamp: Date;
  memoryUsage: NodeJS.MemoryUsage;
  userAgent?: string;
  ip?: string;
}

interface EndpointStats {
  route: string;
  method: string;
  totalRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  throughput: number; // requests per minute
  lastUpdated: Date;
}

interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  cpuUsage: number;
  responseTimeP95: number;
  errorRate: number;
  activeConnections: number;
  queueDepth: number;
  cacheHitRate: number;
}

interface AlertRule {
  name: string;
  condition: (metrics: PerformanceMetrics) => boolean;
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
  lastTriggered?: Date;
  cooldownMinutes: number;
}

export class PerformanceMonitor {
  private metrics: ApiMetrics;
  private redis: Redis;
  private recentMetrics: PerformanceMetrics[] = [];
  private maxRecentMetrics: number = 1000;
  private alertRules: AlertRule[] = [];
  private slowRequestThreshold: number = 200; // ms
  private criticalRequestThreshold: number = 1000; // ms

  constructor(metrics: ApiMetrics, redis: Redis) {
    this.metrics = metrics;
    this.redis = redis;
    this.initializeAlertRules();
    this.startBackgroundTasks();
  }

  /**
   * Initialize default alert rules
   */
  private initializeAlertRules(): void {
    this.alertRules = [
      {
        name: "High Response Time",
        condition: (metrics) => metrics.responseTime > this.slowRequestThreshold,
        threshold: 5, // 5 slow requests
        windowMinutes: 5,
        enabled: true,
        cooldownMinutes: 10,
      },
      {
        name: "Critical Response Time",
        condition: (metrics) => metrics.responseTime > this.criticalRequestThreshold,
        threshold: 1, // 1 critical request
        windowMinutes: 1,
        enabled: true,
        cooldownMinutes: 5,
      },
      {
        name: "High Error Rate",
        condition: (metrics) => metrics.statusCode >= 500,
        threshold: 3, // 3 server errors
        windowMinutes: 5,
        enabled: true,
        cooldownMinutes: 10,
      },
      {
        name: "High Memory Usage",
        condition: (metrics) => {
          const memPercent = (metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal) * 100;
          return memPercent > 85;
        },
        threshold: 1,
        windowMinutes: 1,
        enabled: true,
        cooldownMinutes: 15,
      },
    ];
  }

  /**
   * Record performance metrics for a request
   */
  async recordRequest(
    req: FastifyRequest,
    reply: FastifyReply,
    responseTime: number
  ): Promise<void> {
    const performanceMetrics: PerformanceMetrics = {
      responseTime,
      statusCode: reply.statusCode,
      method: req.method,
      route: this.extractRoute(req.url),
      timestamp: new Date(),
      memoryUsage: process.memoryUsage(),
      ...(req.headers["user-agent"] ? { userAgent: req.headers["user-agent"] as string } : {}),
      ip: req.ip,
    };

    // Store in memory for quick access
    this.recentMetrics.push(performanceMetrics);
    if (this.recentMetrics.length > this.maxRecentMetrics) {
      this.recentMetrics = this.recentMetrics.slice(-this.maxRecentMetrics);
    }

    // Record in main metrics system
    const finishTimer = this.metrics.recordRequest(req.method, req.url);
    finishTimer(reply.statusCode);

    // Store in Redis for persistence and aggregation
    await this.storeMetricsInRedis(performanceMetrics);

    // Check alert rules
    await this.checkAlertRules(performanceMetrics);

    // Log slow requests
    if (responseTime > this.slowRequestThreshold) {
      monitoringLogger.warn(
        {
          method: req.method,
          url: req.url,
          responseTime: `${responseTime}ms`,
          statusCode: reply.statusCode,
          userAgent: req.headers["user-agent"],
        },
        "Slow request detected"
      );
    }
  }

  /**
   * Extract clean route from URL
   */
  private extractRoute(url: string): string {
    // Remove query parameters
    const cleanUrl = url.split("?")[0];
    if (!cleanUrl) return "/";

    // Normalize common patterns
    return cleanUrl
      .replace(/\/\d+/g, "/:id") // Replace numeric IDs
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "/:uuid") // Replace UUIDs
      .replace(/\/\w{20,}/g, "/:token"); // Replace long tokens
  }

  /**
   * Store metrics in Redis for aggregation
   */
  private async storeMetricsInRedis(metrics: PerformanceMetrics): Promise<void> {
    try {
      const minute = Math.floor(Date.now() / 60000) * 60000; // Round to minute
      const key = `perf:${minute}:${metrics.method}:${metrics.route}`;

      // Store aggregated data
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(key, "count", 1);
      pipeline.hincrby(key, "totalTime", metrics.responseTime);
      pipeline.hincrby(key, "errors", metrics.statusCode >= 400 ? 1 : 0);
      pipeline.expire(key, 7 * 24 * 60 * 60); // Keep for 7 days

      // Store response times for percentile calculation
      const timesKey = `perf:times:${minute}:${metrics.method}:${metrics.route}`;
      pipeline.lpush(timesKey, metrics.responseTime);
      pipeline.ltrim(timesKey, 0, 999); // Keep last 1000 requests
      pipeline.expire(timesKey, 24 * 60 * 60); // Keep for 24 hours

      await pipeline.exec();
    } catch (_error: unknown) {
      monitoringLogger.warn({ err: _error }, "Failed to store performance metrics in Redis");
    }
  }

  /**
   * Check alert rules
   */
  private async checkAlertRules(metrics: PerformanceMetrics): Promise<void> {
    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      // Check cooldown
      if (rule.lastTriggered) {
        const cooldownEnd = new Date(rule.lastTriggered.getTime() + rule.cooldownMinutes * 60000);
        if (new Date() < cooldownEnd) continue;
      }

      // Check if condition is met
      if (rule.condition(metrics)) {
        await this.evaluateAlertRule(rule, metrics);
      }
    }
  }

  /**
   * Evaluate if alert rule should trigger
   */
  private async evaluateAlertRule(
    rule: AlertRule,
    currentMetrics: PerformanceMetrics
  ): Promise<void> {
    const windowStart = new Date(Date.now() - rule.windowMinutes * 60000);
    const recentViolations = this.recentMetrics.filter(
      (m) => m.timestamp > windowStart && rule.condition(m)
    ).length;

    if (recentViolations >= rule.threshold) {
      await this.triggerAlert(rule, currentMetrics, recentViolations);
    }
  }

  /**
   * Trigger alert
   */
  private async triggerAlert(
    rule: AlertRule,
    metrics: PerformanceMetrics,
    violationCount: number
  ): Promise<void> {
    rule.lastTriggered = new Date();

    const alert = {
      rule: rule.name,
      timestamp: new Date(),
      violationCount,
      currentMetrics: {
        responseTime: metrics.responseTime,
        statusCode: metrics.statusCode,
        route: metrics.route,
        method: metrics.method,
      },
      systemHealth: await this.getSystemHealth(),
    };

    monitoringLogger.error({ alert }, "Performance alert triggered");

    // Store alert in Redis
    try {
      await this.redis.lpush("performance:alerts", JSON.stringify(alert));
      await this.redis.ltrim("performance:alerts", 0, 99); // Keep last 100 alerts
    } catch (_error: unknown) {
      monitoringLogger.warn({ err: _error }, "Failed to store alert in Redis");
    }

    // In production, this would trigger notifications (email, Slack, etc.)
    this.sendAlert(alert);
  }

  /**
   * Send alert (placeholder for notification system)
   */
  private sendAlert(alert: unknown): void {
    // Implement notification logic here
    // Could send to Slack, email, PagerDuty, etc.
    monitoringLogger.info({ alert }, "Alert would be sent to notification system");
  }

  /**
   * Get endpoint statistics
   */
  async getEndpointStats(timeRangeMinutes: number = 60): Promise<EndpointStats[]> {
    try {
      const now = Date.now();
      const startTime = now - timeRangeMinutes * 60000;
      const endTime = now;

      const stats = new Map<
        string,
        {
          count: number;
          totalTime: number;
          errors: number;
          responseTimes: number[];
        }
      >();

      // Aggregate data from recent metrics
      const relevantMetrics = this.recentMetrics.filter(
        (m) => m.timestamp.getTime() >= startTime && m.timestamp.getTime() <= endTime
      );

      relevantMetrics.forEach((metrics) => {
        const key = `${metrics.method}:${metrics.route}`;
        if (!stats.has(key)) {
          stats.set(key, {
            count: 0,
            totalTime: 0,
            errors: 0,
            responseTimes: [],
          });
        }

        const stat = stats.get(key)!;
        stat.count++;
        stat.totalTime += metrics.responseTime;
        if (metrics.statusCode >= 400) stat.errors++;
        stat.responseTimes.push(metrics.responseTime);
      });

      // Convert to EndpointStats array
      const endpointStats: EndpointStats[] = [];

      stats.forEach((stat, key) => {
        const [method, route] = key.split(":");
        if (!method || !route) return;
        const sortedTimes = stat.responseTimes.sort((a, b) => a - b);

        endpointStats.push({
          route,
          method,
          totalRequests: stat.count,
          averageResponseTime: Math.round(stat.totalTime / stat.count),
          p95ResponseTime: this.getPercentile(sortedTimes, 95),
          p99ResponseTime: this.getPercentile(sortedTimes, 99),
          errorRate: (stat.errors / stat.count) * 100,
          throughput: stat.count / timeRangeMinutes,
          lastUpdated: new Date(),
        });
      });

      return endpointStats.sort((a, b) => b.totalRequests - a.totalRequests);
    } catch (_error: unknown) {
      monitoringLogger.error({ err: _error }, "Error getting endpoint stats");
      return [];
    }
  }

  /**
   * Get system health overview
   */
  async getSystemHealth(): Promise<SystemHealth> {
    try {
      const memUsage = process.memoryUsage();
      const recentMetrics = this.recentMetrics.slice(-100); // Last 100 requests

      const responseTimes = recentMetrics.map((m) => m.responseTime).sort((a, b) => a - b);
      const p95ResponseTime = this.getPercentile(responseTimes, 95);

      const errors = recentMetrics.filter((m) => m.statusCode >= 400).length;
      const errorRate = recentMetrics.length > 0 ? (errors / recentMetrics.length) * 100 : 0;

      const memPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      let status: SystemHealth["status"] = "healthy";
      if (p95ResponseTime > this.slowRequestThreshold || errorRate > 5 || memPercentage > 85) {
        status = "degraded";
      }
      if (p95ResponseTime > this.criticalRequestThreshold || errorRate > 10 || memPercentage > 95) {
        status = "unhealthy";
      }

      return {
        status,
        uptime: process.uptime(),
        memoryUsage: {
          used: memUsage.heapUsed,
          total: memUsage.heapTotal,
          percentage: memPercentage,
        },
        cpuUsage: 0, // Would need additional monitoring
        responseTimeP95: p95ResponseTime,
        errorRate,
        activeConnections: 0, // Would need server connection tracking
        queueDepth: 0, // Would need queue monitoring
        cacheHitRate: 0, // Would need cache monitoring
      };
    } catch (_error: unknown) {
      monitoringLogger.error({ err: _error }, "Error getting system health");
      return {
        status: "unhealthy",
        uptime: 0,
        memoryUsage: { used: 0, total: 0, percentage: 0 },
        cpuUsage: 0,
        responseTimeP95: 0,
        errorRate: 100,
        activeConnections: 0,
        queueDepth: 0,
        cacheHitRate: 0,
      };
    }
  }

  /**
   * Calculate percentile from sorted array
   */
  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;

    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))] || 0;
  }

  /**
   * Start background monitoring tasks
   */
  private startBackgroundTasks(): void {
    // Clean up old metrics every 10 minutes
    const cleanupInterval = setInterval(
      () => {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
        this.recentMetrics = this.recentMetrics.filter((m) => m.timestamp > cutoff);
      },
      10 * 60 * 1000
    );
    cleanupInterval.unref();

    // Health check every 30 seconds
    const healthCheckInterval = setInterval(async () => {
      const health = await this.getSystemHealth();
      if (health.status !== "healthy") {
        monitoringLogger.warn({ health }, "System health check");
      }
    }, 30 * 1000);
    healthCheckInterval.unref();
  }

  /**
   * Create performance monitoring middleware
   */
  createMiddleware() {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();

      // Track the response using the response hook pattern
      const originalSend = reply.send.bind(reply);
      const self = this;
      reply.send = function (payload?: unknown) {
        const responseTime = Date.now() - startTime;
        // Record asynchronously to avoid blocking response
        void self.recordRequest(req, reply, responseTime);
        return originalSend(payload);
      };
    };
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(count: number = 10): Promise<any[]> {
    try {
      const alerts = await this.redis.lrange("performance:alerts", 0, count - 1);
      return alerts.map((alert) => JSON.parse(alert));
    } catch (_error: unknown) {
      monitoringLogger.warn({ err: _error }, "Failed to get recent alerts");
      return [];
    }
  }

  /**
   * Update alert rule configuration
   */
  updateAlertRule(ruleName: string, updates: Partial<AlertRule>): boolean {
    const rule = this.alertRules.find((r) => r.name === ruleName);
    if (!rule) return false;

    Object.assign(rule, updates);
    return true;
  }

  /**
   * Get performance dashboard data
   */
  async getDashboardData(timeRangeMinutes: number = 60): Promise<{
    systemHealth: SystemHealth;
    endpointStats: EndpointStats[];
    recentAlerts: Record<string, unknown>[];
    slowRequests: PerformanceMetrics[];
  }> {
    const [systemHealth, endpointStats, recentAlerts] = await Promise.all([
      this.getSystemHealth(),
      this.getEndpointStats(timeRangeMinutes),
      this.getRecentAlerts(5),
    ]);

    const slowRequests = this.recentMetrics
      .filter((m) => m.responseTime > this.slowRequestThreshold)
      .slice(-10)
      .sort((a, b) => b.responseTime - a.responseTime);

    return {
      systemHealth,
      endpointStats,
      recentAlerts,
      slowRequests,
    };
  }
}
