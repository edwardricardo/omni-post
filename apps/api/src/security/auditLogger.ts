/**
 * @file auditLogger.ts
 * @description Security audit logger with real-time alerting, severity-based categorization,
 *              Redis-backed caching, and compliance-ready retention policies.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import { Redis } from "ioredis";
import type { FastifyRequest } from "fastify";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  deriveActorType,
  type AuditActorType,
} from "@core/domain/repositories/AuditLogRepository.js";
import { logger } from "../lib/logger.js";

interface AuditEvent {
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  userId?: string;
  /** CUSTOMER actor FK; exclusive with `userId` (DB CHECK). */
  customerUserId?: string;
  /** Actor discriminator; when absent it is derived from the FKs (backfill rule). */
  actorType?: AuditActorType;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  error?: string;
  severity?: "low" | "medium" | "high" | "critical";
  category?: "auth" | "data" | "system" | "security" | "billing" | "admin";
}

interface AuditConfig {
  enableRealTimeAlerts: boolean;
  retentionDays: number;
  alertThresholds: {
    failedLogins: number;
    suspiciousActivity: number;
    dataModifications: number;
  };
  sensitiveFields: string[];
  enableDetailedLogging: boolean;
}

export class AuditLogger {
  private redis: Redis;
  private config: AuditConfig;
  private scheduler: BackgroundTaskScheduler;
  private alertQueue: string = "security_alerts";

  constructor(
    private readonly prisma: PrismaClient,
    redis: Redis,
    scheduler: BackgroundTaskScheduler,
    config?: Partial<AuditConfig>
  ) {
    this.redis = redis;
    this.scheduler = scheduler;
    this.config = {
      enableRealTimeAlerts: true,
      retentionDays: 90,
      alertThresholds: {
        failedLogins: 5,
        suspiciousActivity: 10,
        dataModifications: 20,
      },
      sensitiveFields: ["password", "token", "key", "secret", "credentials"],
      enableDetailedLogging: true,
      ...config,
    };

    // Setup Redis error handling
    this.redis.on("error", (err) => {
      logger.error({ err }, "Redis connection error in audit logger");
    });

    // Register daily cleanup task via the centralised scheduler.
    this.scheduler.register(
      "audit-logger-cleanup",
      () => this.cleanupOldLogs(),
      24 * 60 * 60 * 1000
    );
  }

  /**
   * @method destroy
   * @description Unregister the cleanup task so the instance can be garbage
   *              collected. Called implicitly by the scheduler's shutdownAll()
   *              but exposed for explicit teardown.
   */
  destroy(): void {
    this.scheduler.unregister("audit-logger-cleanup");
  }

  // Log audit event with automatic enrichment
  async log(event: AuditEvent, req?: FastifyRequest): Promise<void> {
    try {
      // Enrich event with request data if available
      const enrichedEvent = await this.enrichEvent(event, req);

      // Sanitize sensitive data
      const sanitizedEvent = this.sanitizeEvent(enrichedEvent);

      // Store in database
      const createData: Record<string, unknown> = {
        action: sanitizedEvent.action,
        success: sanitizedEvent.success ?? true,
        actorType: deriveActorType(sanitizedEvent),
      };
      if (sanitizedEvent.resource) createData.resource = sanitizedEvent.resource;
      if (sanitizedEvent.resourceId) createData.resourceId = sanitizedEvent.resourceId;
      if (sanitizedEvent.details) createData.details = sanitizedEvent.details;
      if (sanitizedEvent.userId) createData.userId = sanitizedEvent.userId;
      if (sanitizedEvent.customerUserId) createData.customerUserId = sanitizedEvent.customerUserId;
      if (sanitizedEvent.ipAddress) createData.ipAddress = sanitizedEvent.ipAddress;
      if (sanitizedEvent.userAgent) createData.userAgent = sanitizedEvent.userAgent;
      if (sanitizedEvent.error) createData.error = sanitizedEvent.error;

      const _auditRecord = await this.prisma.auditLog.create({
        data: createData as Parameters<typeof this.prisma.auditLog.create>[0]["data"],
      });

      // Cache recent events in Redis for real-time monitoring
      await this.cacheRecentEvent(sanitizedEvent);

      // Check for suspicious patterns and trigger alerts
      if (this.config.enableRealTimeAlerts) {
        await this.checkForSuspiciousActivity(sanitizedEvent);
      }

      // Log to console for immediate visibility
      if (sanitizedEvent.severity === "critical" || sanitizedEvent.severity === "high") {
        logger.warn(
          {
            severity: sanitizedEvent.severity,
            action: sanitizedEvent.action,
            resource: sanitizedEvent.resource,
            resourceId: sanitizedEvent.resourceId,
            userId: sanitizedEvent.userId,
            ipAddress: sanitizedEvent.ipAddress,
          },
          "High severity audit event"
        );
      }
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to log audit event");
      // Still try to log critical events as fallback
      logger.error(
        {
          action: event.action,
          resource: event.resource,
          error: _error instanceof Error ? _error.message : "Unknown error",
        },
        "AUDIT FAILURE - Original event"
      );
    }
  }

  // Authentication-specific logging
  async logAuth(
    action: "LOGIN" | "LOGOUT" | "LOGIN_FAILED" | "PASSWORD_RESET" | "MFA_ENABLED" | "MFA_DISABLED",
    details: Record<string, unknown>,
    req?: FastifyRequest
  ): Promise<void> {
    await this.log(
      {
        action,
        category: "auth",
        severity: action === "LOGIN_FAILED" ? "medium" : "low",
        success: !action.includes("FAILED"),
        details,
      },
      req
    );
  }

  // Data modification logging
  async logDataChange(
    action: "CREATE" | "UPDATE" | "DELETE",
    resource: string,
    resourceId: string,
    changes: Record<string, unknown>,
    req?: FastifyRequest
  ): Promise<void> {
    await this.log(
      {
        action: `${resource.toUpperCase()}_${action}`,
        resource,
        resourceId,
        category: "data",
        severity: action === "DELETE" ? "medium" : "low",
        details: { changes },
      },
      req
    );
  }

  // Security event logging
  async logSecurity(
    action: string,
    details: Record<string, unknown>,
    severity: "low" | "medium" | "high" | "critical" = "medium",
    req?: FastifyRequest
  ): Promise<void> {
    await this.log(
      {
        action,
        category: "security",
        severity,
        details,
      },
      req
    );
  }

  // Administrative action logging
  async logAdmin(
    action: string,
    resource: string,
    resourceId: string,
    details: Record<string, unknown>,
    req?: FastifyRequest
  ): Promise<void> {
    await this.log(
      {
        action,
        resource,
        resourceId,
        category: "admin",
        severity: "medium",
        details,
      },
      req
    );
  }

  // System event logging
  async logSystem(
    action: string,
    details: Record<string, unknown>,
    severity: "low" | "medium" | "high" = "low"
  ): Promise<void> {
    await this.log({
      action,
      category: "system",
      severity,
      details,
    });
  }

  // Billing event logging
  async logBilling(
    action: string,
    accountId: string,
    details: Record<string, unknown>,
    req?: FastifyRequest
  ): Promise<void> {
    await this.log(
      {
        action,
        resource: "Account",
        resourceId: accountId,
        category: "billing",
        severity: "medium",
        details,
      },
      req
    );
  }

  // Query audit logs with filtering
  async queryLogs(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    category?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>[]> {
    try {
      const where: Record<string, unknown> = {};

      if (filters.userId) where.userId = filters.userId;
      if (filters.action) where.action = { contains: filters.action, mode: "insensitive" };
      if (filters.resource) where.resource = filters.resource;
      if (filters.success !== undefined) where.success = filters.success;

      if (filters.startDate || filters.endDate) {
        const createdAtFilter: { gte?: Date; lte?: Date } = {};
        if (filters.startDate) createdAtFilter.gte = filters.startDate;
        if (filters.endDate) createdAtFilter.lte = filters.endDate;
        where.createdAt = createdAtFilter;
      }

      // Filter by category and severity via details JSON field
      if (filters.category || filters.severity) {
        where.details = {
          path: ["category"],
          equals: filters.category,
        };
      }

      const logs = await this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: filters.limit || 100,
        skip: filters.offset || 0,
      });

      return logs;
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to query audit logs");
      return [];
    }
  }

  // Get audit statistics
  async getStatistics(timeframe: "hour" | "day" | "week" | "month" = "day"): Promise<{
    totalEvents: number;
    failedEvents: number;
    securityEvents: number;
    topActions: Array<{ action: string; count: number }>;
    topUsers: Array<{ userId: string; count: number }>;
  }> {
    try {
      const timeframeMappings = {
        hour: 1,
        day: 24,
        week: 24 * 7,
        month: 24 * 30,
      };

      const hoursBack = timeframeMappings[timeframe];
      const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const [totalEvents, failedEvents, securityEvents, actionStats, userStats] = await Promise.all(
        [
          this.prisma.auditLog.count({
            where: { createdAt: { gte: startDate } },
          }),
          this.prisma.auditLog.count({
            where: {
              createdAt: { gte: startDate },
              success: false,
            },
          }),
          this.prisma.auditLog.count({
            where: {
              createdAt: { gte: startDate },
              action: { contains: "SECURITY" },
            },
          }),
          this.prisma.auditLog.groupBy({
            by: ["action"],
            where: { createdAt: { gte: startDate } },
            _count: { action: true },
            orderBy: { _count: { action: "desc" } },
            take: 10,
          }),
          this.prisma.auditLog.groupBy({
            by: ["userId"],
            where: {
              createdAt: { gte: startDate },
              userId: { not: null },
            },
            _count: { userId: true },
            orderBy: { _count: { userId: "desc" } },
            take: 10,
          }),
        ]
      );

      return {
        totalEvents,
        failedEvents,
        securityEvents,
        topActions: actionStats.map((stat) => ({
          action: stat.action,
          count: stat._count.action,
        })),
        topUsers: userStats.map((stat) => ({
          userId: stat.userId!,
          count: stat._count.userId,
        })),
      };
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to get audit statistics");
      return {
        totalEvents: 0,
        failedEvents: 0,
        securityEvents: 0,
        topActions: [],
        topUsers: [],
      };
    }
  }

  // Private helper methods
  private async enrichEvent(event: AuditEvent, req?: FastifyRequest): Promise<AuditEvent> {
    const enriched = { ...event };

    if (req) {
      // Extract IP address
      enriched.ipAddress = enriched.ipAddress || this.extractIP(req);

      // Extract user agent
      const userAgent = req.headers["user-agent"];
      if (userAgent) {
        enriched.userAgent = enriched.userAgent || userAgent;
      }

      // Extract user ID from auth context (would need to implement based on auth system)
      const userId = this.extractUserId(req);
      if (userId) {
        enriched.userId = enriched.userId || userId;
      }

      // Add request metadata if detailed logging is enabled
      if (this.config.enableDetailedLogging) {
        enriched.details = {
          ...enriched.details,
          requestMethod: req.method,
          requestUrl: req.url,
          requestId: req.id,
        };
      }
    }

    // Add timestamp
    enriched.details = {
      ...enriched.details,
      timestamp: new Date().toISOString(),
      category: event.category || "system",
      severity: event.severity || "low",
    };

    return enriched;
  }

  private extractIP(req: FastifyRequest): string {
    const forwarded = req.headers["x-forwarded-for"] as string;
    if (forwarded) {
      const firstIP = forwarded.split(",")[0];
      return firstIP ? firstIP.trim() : req.ip || "unknown";
    }

    const realIP = req.headers["x-real-ip"] as string;
    if (realIP) return realIP;

    const cfConnectingIP = req.headers["cf-connecting-ip"] as string;
    if (cfConnectingIP) return cfConnectingIP;

    return req.socket?.remoteAddress || req.ip || "unknown";
  }

  /**
   * Extract user ID from the request auth context. Tries the admin auth
   * tier first (`req.auth.user.id`), then the regular user tier
   * (`req.user.id`). Returns undefined when neither is populated — callers
   * may pass `event.userId` explicitly via the `log()` API to bypass this
   * fallback path.
   */
  private extractUserId(req: FastifyRequest): string | undefined {
    return req.auth?.user?.id ?? req.user?.id;
  }

  private sanitizeEvent(event: AuditEvent): AuditEvent {
    const sanitized = { ...event };

    // Remove or mask sensitive fields from details
    if (sanitized.details) {
      sanitized.details = this.sanitizeObject(sanitized.details);
    }

    return sanitized;
  }

  private sanitizeObject(obj: unknown): Record<string, unknown> {
    if (typeof obj !== "object" || obj === null) {
      return {};
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // Check if field is sensitive
      const isSensitive = this.config.sensitiveFields.some((field) =>
        lowerKey.includes(field.toLowerCase())
      );

      if (isSensitive && typeof value === "string") {
        // Mask sensitive values
        sanitized[key] = this.maskSensitiveValue(value);
      } else if (typeof value === "object") {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private maskSensitiveValue(value: string): string {
    if (value.length <= 4) {
      return "***";
    }
    return value.substring(0, 2) + "*".repeat(value.length - 4) + value.substring(value.length - 2);
  }

  private async cacheRecentEvent(event: AuditEvent): Promise<void> {
    try {
      const cacheKey = `audit_recent:${event.category || "general"}`;
      const eventData = JSON.stringify({
        action: event.action,
        resource: event.resource,
        userId: event.userId,
        timestamp: Date.now(),
        severity: event.severity,
      });

      // Add to sorted set with timestamp as score
      await this.redis.zadd(cacheKey, Date.now(), eventData);

      // Keep only last 1000 events per category
      await this.redis.zremrangebyrank(cacheKey, 0, -1001);

      // Expire after 24 hours
      await this.redis.expire(cacheKey, 86400);
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to cache audit event");
    }
  }

  private async checkForSuspiciousActivity(event: AuditEvent): Promise<void> {
    try {
      const now = Date.now();
      const _hourAgo = now - 60 * 60 * 1000;

      // Check for failed login attempts
      if (event.action === "LOGIN_FAILED" && event.ipAddress) {
        const key = `failed_logins:${event.ipAddress}`;
        const attempts = await this.redis.incr(key);
        await this.redis.expire(key, 3600); // Expire after 1 hour

        if (attempts >= this.config.alertThresholds.failedLogins) {
          await this.triggerAlert("SUSPICIOUS_LOGIN_ATTEMPTS", {
            ipAddress: event.ipAddress,
            attempts,
            threshold: this.config.alertThresholds.failedLogins,
          });
        }
      }

      // Check for rapid API calls from same source
      if (event.ipAddress && event.category !== "system") {
        const key = `api_calls:${event.ipAddress}`;
        const calls = await this.redis.incr(key);
        await this.redis.expire(key, 300); // 5 minutes

        if (calls >= this.config.alertThresholds.suspiciousActivity) {
          await this.triggerAlert("SUSPICIOUS_API_ACTIVITY", {
            ipAddress: event.ipAddress,
            calls,
            threshold: this.config.alertThresholds.suspiciousActivity,
          });
        }
      }

      // Check for excessive data modifications
      if (event.category === "data" && event.userId) {
        const key = `data_mods:${event.userId}`;
        const modifications = await this.redis.incr(key);
        await this.redis.expire(key, 3600); // 1 hour

        if (modifications >= this.config.alertThresholds.dataModifications) {
          await this.triggerAlert("EXCESSIVE_DATA_MODIFICATIONS", {
            userId: event.userId,
            modifications,
            threshold: this.config.alertThresholds.dataModifications,
          });
        }
      }
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to check for suspicious activity");
    }
  }

  private async triggerAlert(alertType: string, details: Record<string, unknown>): Promise<void> {
    try {
      const alert = {
        type: alertType,
        details,
        timestamp: new Date().toISOString(),
        severity: "high",
      };

      // Add to alert queue for processing
      await this.redis.lpush(this.alertQueue, JSON.stringify(alert));

      // Log the alert as a security event
      await this.log({
        action: `SECURITY_ALERT_${alertType}`,
        category: "security",
        severity: "high",
        details: alert,
      });

      logger.warn({ alertType, ...details }, "Security alert triggered");
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to trigger security alert");
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);

      const deletedCount = await this.prisma.auditLog.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      logger.info(
        { deletedCount: deletedCount.count, retentionDays: this.config.retentionDays },
        "Cleaned up old audit logs"
      );
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to cleanup old audit logs");
    }
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    // No persistent timers to clean up in this implementation
  }
}

/**
 * @function createAuditLogger
 * @description Factory for AuditLogger with explicit dependencies for DI composition.
 * @param prisma - Prisma client
 * @param redis - Redis client
 * @param scheduler - Background task scheduler for retention sweeps
 * @param config - Optional partial config overriding defaults
 * @returns Configured AuditLogger instance
 */
export function createAuditLogger(
  prisma: PrismaClient,
  redis: Redis,
  scheduler: BackgroundTaskScheduler,
  config?: Partial<AuditConfig>
): AuditLogger {
  return new AuditLogger(prisma, redis, scheduler, config);
}

// Predefined audit configurations
export const AuditConfigs = {
  // High security environment
  HIGH_SECURITY: {
    enableRealTimeAlerts: true,
    retentionDays: 365,
    alertThresholds: {
      failedLogins: 3,
      suspiciousActivity: 5,
      dataModifications: 10,
    },
    enableDetailedLogging: true,
  },

  // Standard production environment
  PRODUCTION: {
    enableRealTimeAlerts: true,
    retentionDays: 90,
    alertThresholds: {
      failedLogins: 5,
      suspiciousActivity: 10,
      dataModifications: 20,
    },
    enableDetailedLogging: true,
  },

  // Development environment
  DEVELOPMENT: {
    enableRealTimeAlerts: false,
    retentionDays: 7,
    alertThresholds: {
      failedLogins: 10,
      suspiciousActivity: 50,
      dataModifications: 100,
    },
    enableDetailedLogging: true,
  },
} as const;
