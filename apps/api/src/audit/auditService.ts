/**
 * @file auditService.ts
 * @description Service for creating and querying audit log entries, providing
 *              compliance-ready trails for user actions, security events, and system changes.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import { type Result, type AdminRole } from "@shared/types";
import { BaseService } from "../services/BaseService.js";

export interface AuditLogEntry {
  id: string;
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  error?: string;
  createdAt: Date;
  user?: {
    id: string;
    email: string;
    name: string;
    role: AdminRole;
  };
}

export interface CreateAuditLogParams {
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  error?: string;
}

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class AuditService extends BaseService {
  constructor(private readonly prisma: PrismaClient) {
    super("AuditService");
  }
  /**
   * Log an audit event
   */
  async log(params: CreateAuditLogParams): Promise<Result<AuditLogEntry, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "log",
        ...(params.userId && { userId: params.userId }),
        metadata: { action: params.action, resource: params.resource },
      },
      async () => {
        const createData: Record<string, unknown> = {
          action: params.action,
          success: params.success ?? true,
        };
        if (params.userId) createData.userId = params.userId;
        if (params.resource) createData.resource = params.resource;
        if (params.resourceId) createData.resourceId = params.resourceId;
        if (params.details) createData.details = params.details;
        if (params.ipAddress) createData.ipAddress = params.ipAddress;
        if (params.userAgent) createData.userAgent = params.userAgent;
        if (params.error) createData.error = params.error;

        const auditLog = await this.prisma.auditLog.create({
          data: createData as Parameters<typeof this.prisma.auditLog.create>[0]["data"],
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: { select: { name: true } },
              },
            },
          },
        });

        // Map role relation to string
        const mapped = {
          ...auditLog,
          ...(auditLog.user && { user: { ...auditLog.user, role: auditLog.user.role.name } }),
        };
        return mapped as AuditLogEntry;
      }
    );
  }

  /**
   * Get audit logs with filtering
   */
  async getLogs(filters: AuditLogFilters = {}): Promise<Result<AuditLogEntry[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getLogs",
        ...(filters.userId && { userId: filters.userId }),
        metadata: {
          action: filters.action,
          resource: filters.resource,
          limit: filters.limit || 50,
        },
      },
      async () => {
        const {
          userId,
          action,
          resource,
          resourceId,
          success,
          startDate,
          endDate,
          limit = 50,
          offset = 0,
        } = filters;

        const where: Record<string, unknown> = {};

        if (userId) where.userId = userId;
        if (action) where.action = { contains: action, mode: "insensitive" };
        if (resource) where.resource = resource;
        if (resourceId) where.resourceId = resourceId;
        if (success !== undefined) where.success = success;

        if (startDate || endDate) {
          const createdAt: Record<string, Date> = {};
          if (startDate) createdAt.gte = startDate;
          if (endDate) createdAt.lte = endDate;
          where.createdAt = createdAt;
        }

        const logs = await this.prisma.auditLog.findMany({
          where: where as Record<string, unknown> & { createdAt?: Record<string, Date> },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: Math.min(limit, 1000), // Cap at 1000 for performance
          skip: offset,
        });

        // Map role relation to string for each log entry
        return logs.map((log) => ({
          ...log,
          ...(log.user && { user: { ...log.user, role: log.user.role.name } }),
        })) as AuditLogEntry[];
      }
    );
  }

  /**
   * Get audit log statistics
   */
  async getStats(filters: Omit<AuditLogFilters, "limit" | "offset"> = {}): Promise<
    Result<
      {
        total: number;
        successful: number;
        failed: number;
        topActions: Array<{ action: string; count: number }>;
        topResources: Array<{ resource: string; count: number }>;
        topUsers: Array<{ user: string; email: string; count: number }>;
      },
      string
    >
  > {
    return this.executeWithErrorHandling(
      {
        operation: "getStats",
        ...(filters.userId && { userId: filters.userId }),
        metadata: {
          action: filters.action,
          resource: filters.resource,
          ...(filters.startDate && { startDate: filters.startDate }),
          ...(filters.endDate && { endDate: filters.endDate }),
        },
      },
      async () => {
        const { userId, action, resource, resourceId, success, startDate, endDate } = filters;

        const where: Record<string, unknown> = {};

        if (userId) where.userId = userId;
        if (action) where.action = { contains: action, mode: "insensitive" };
        if (resource) where.resource = resource;
        if (resourceId) where.resourceId = resourceId;
        if (success !== undefined) where.success = success;

        if (startDate || endDate) {
          const createdAt: Record<string, Date> = {};
          if (startDate) createdAt.gte = startDate;
          if (endDate) createdAt.lte = endDate;
          where.createdAt = createdAt;
        }

        // Get basic counts
        const [total, successful, failed] = await Promise.all([
          this.prisma.auditLog.count({ where }),
          this.prisma.auditLog.count({ where: { ...where, success: true } }),
          this.prisma.auditLog.count({ where: { ...where, success: false } }),
        ]);

        // Get top actions
        const topActionsRaw = await this.prisma.auditLog.groupBy({
          by: ["action"],
          where,
          _count: { action: true },
          orderBy: { _count: { action: "desc" } },
          take: 10,
        });

        const topActions = topActionsRaw.map((item) => ({
          action: item.action,
          count: item._count.action,
        }));

        // Get top resources
        const topResourcesRaw = await this.prisma.auditLog.groupBy({
          by: ["resource"],
          where: { ...where, resource: { not: null } },
          _count: { resource: true },
          orderBy: { _count: { resource: "desc" } },
          take: 10,
        });

        const topResources = topResourcesRaw.map((item) => ({
          resource: item.resource!,
          count: item._count.resource,
        }));

        // Get top users
        const topUsersRaw = await this.prisma.auditLog.groupBy({
          by: ["userId"],
          where: { ...where, userId: { not: null } },
          _count: { userId: true },
          orderBy: { _count: { userId: "desc" } },
          take: 10,
        });

        const userIds = topUsersRaw.map((item) => item.userId!);
        const users = await this.prisma.adminUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        });

        const topUsers = topUsersRaw.map((item) => {
          const user = users.find((u) => u.id === item.userId);
          return {
            user: user?.name || "Unknown",
            email: user?.email || "Unknown",
            count: item._count.userId,
          };
        });

        return {
          total,
          successful,
          failed,
          topActions,
          topResources,
          topUsers,
        };
      }
    );
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserLogs(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<Result<AuditLogEntry[], string>> {
    return this.getLogs({ userId, limit, offset });
  }

  /**
   * Get audit logs for a specific resource
   */
  async getResourceLogs(
    resource: string,
    resourceId?: string,
    limit = 50,
    offset = 0
  ): Promise<Result<AuditLogEntry[], string>> {
    return this.getLogs({
      resource,
      ...(resourceId && { resourceId }),
      limit,
      offset,
    });
  }

  /**
   * Delete old audit logs (data retention)
   */
  async cleanup(retentionDays = 90): Promise<Result<number, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "cleanup",
        metadata: { retentionDays },
      },
      async () => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const result = await this.prisma.auditLog.deleteMany({
          where: {
            createdAt: {
              lt: cutoffDate,
            },
          },
        });

        return result.count;
      }
    );
  }

  /**
   * @method logCredentialDecrypt
   * @description Emit an audit event for every credential decryption.
   *   Implements OWASP ASVS V16.3.2 (L3): "logging when sensitive data is
   *   accessed (without logging the sensitive data itself)". The plaintext
   *   never reaches this method — only the structured context. Read-side
   *   audit only; encrypts are not audited (the *write* of an encrypted
   *   value is its own create/update event, audited via repos elsewhere).
   *
   *   Request-scoped fields (userId, ipAddress, userAgent, correlationId)
   *   are auto-enriched from `decryptAuditContext` AsyncLocalStorage when
   *   running inside a Fastify request. Workers / cron / tests run outside
   *   any request scope — in those cases the audit row carries only the
   *   field/record/caller, which honestly reflects "system-initiated decrypt".
   * @param event - Structured context provided by EncryptionService.
   *   `success: false` indicates AAD mismatch or auth tag failure.
   */
  async logCredentialDecrypt(event: {
    fieldName: string;
    recordId: string;
    caller?: string;
    success: boolean;
    error?: string;
  }): Promise<void> {
    // Lazy import to avoid a circular dep — the security layer imports from
    // the audit layer when wiring DI, but the audit module is loaded during
    // the request lifecycle so the AsyncLocalStorage value is available.
    const { getRequestAuditContext } = await import("../security/decryptAuditContext.js");
    const ctx = getRequestAuditContext();

    const params: CreateAuditLogParams = {
      action: AuditActions.CREDENTIAL_DECRYPTED,
      resource: event.fieldName,
      resourceId: event.recordId,
      success: event.success,
      details: {
        fieldName: event.fieldName,
        ...(event.caller !== undefined && { caller: event.caller }),
        ...(ctx?.correlationId !== undefined && { correlationId: ctx.correlationId }),
      },
      ...(ctx?.userId !== undefined && { userId: ctx.userId }),
      ...(ctx?.ipAddress !== undefined && { ipAddress: ctx.ipAddress }),
      ...(ctx?.userAgent !== undefined && { userAgent: ctx.userAgent }),
      ...(event.error !== undefined && { error: event.error }),
    };

    // Fire-and-forget at the EncryptionService layer; here we just await
    // so the test surface can assert on the persistence behaviour.
    await this.log(params);
  }
}

// Audit action constants
export const AuditActions = {
  // Authentication
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",
  TOKEN_REFRESH: "TOKEN_REFRESH",
  SESSION_REVOKED: "SESSION_REVOKED",
  PASSWORD_RESET: "PASSWORD_RESET",

  // User Management
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_DELETED: "USER_DELETED",
  USER_SUSPENDED: "USER_SUSPENDED",
  USER_ACTIVATED: "USER_ACTIVATED",
  ROLE_CHANGED: "ROLE_CHANGED",

  // Account Management
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  ACCOUNT_UPDATED: "ACCOUNT_UPDATED",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  SUBSCRIPTION_CHANGED: "SUBSCRIPTION_CHANGED",

  // Project Management
  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_UPDATED: "PROJECT_UPDATED",
  PROJECT_DELETED: "PROJECT_DELETED",

  // Content Management
  POST_CREATED: "POST_CREATED",
  POST_UPDATED: "POST_UPDATED",
  POST_DELETED: "POST_DELETED",
  POST_PUBLISHED: "POST_PUBLISHED",

  // System Administration
  SYSTEM_CONFIG_CHANGED: "SYSTEM_CONFIG_CHANGED",
  CACHE_CLEARED: "CACHE_CLEARED",
  MAINTENANCE_MODE: "MAINTENANCE_MODE",

  // Security
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SUSPICIOUS_ACTIVITY: "SUSPICIOUS_ACTIVITY",
  API_KEY_GENERATED: "API_KEY_GENERATED",
  MFA_ENABLED: "MFA_ENABLED",
  MFA_DISABLED: "MFA_DISABLED",
  // Sensitive-data access (ASVS V16.3.2): every credential decrypt emits
  // this action with fieldName + recordId + (optional) caller in details.
  // The plaintext NEVER reaches the audit row.
  CREDENTIAL_DECRYPTED: "CREDENTIAL_DECRYPTED",
} as const;

// Resources
export const AuditResources = {
  USER: "AdminUser",
  ACCOUNT: "Account",
  PROJECT: "Project",
  POST: "Post",
  SESSION: "AdminSession",
  SYSTEM: "System",
  API: "API",
} as const;
