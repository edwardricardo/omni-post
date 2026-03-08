import { prisma } from "@infra/prisma";
import { type Result } from "@shared/types";
import type { AdminRole } from "@infra/prisma";
import { BaseService } from "../services/BaseService";

export interface AuditLogEntry {
  id: string;
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: any;
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
  details?: any;
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
  constructor() {
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
        const auditLog = await prisma.auditLog.create({
          data: {
            ...(params.userId && { userId: params.userId }),
            action: params.action,
            ...(params.resource && { resource: params.resource }),
            ...(params.resourceId && { resourceId: params.resourceId }),
            ...(params.details && { details: params.details }),
            ...(params.ipAddress && { ipAddress: params.ipAddress }),
            ...(params.userAgent && { userAgent: params.userAgent }),
            success: params.success ?? true,
            ...(params.error && { error: params.error }),
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
              },
            },
          },
        });

        return auditLog as AuditLogEntry;
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

        const where: any = {};

        if (userId) where.userId = userId;
        if (action) where.action = { contains: action, mode: "insensitive" };
        if (resource) where.resource = resource;
        if (resourceId) where.resourceId = resourceId;
        if (success !== undefined) where.success = success;

        if (startDate || endDate) {
          where.createdAt = {};
          if (startDate) where.createdAt.gte = startDate;
          if (endDate) where.createdAt.lte = endDate;
        }

        const logs = await prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: Math.min(limit, 1000), // Cap at 1000 for performance
          skip: offset,
        });

        return logs as AuditLogEntry[];
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

        const where: any = {};

        if (userId) where.userId = userId;
        if (action) where.action = { contains: action, mode: "insensitive" };
        if (resource) where.resource = resource;
        if (resourceId) where.resourceId = resourceId;
        if (success !== undefined) where.success = success;

        if (startDate || endDate) {
          where.createdAt = {};
          if (startDate) where.createdAt.gte = startDate;
          if (endDate) where.createdAt.lte = endDate;
        }

        // Get basic counts
        const [total, successful, failed] = await Promise.all([
          prisma.auditLog.count({ where }),
          prisma.auditLog.count({ where: { ...where, success: true } }),
          prisma.auditLog.count({ where: { ...where, success: false } }),
        ]);

        // Get top actions
        const topActionsRaw = await prisma.auditLog.groupBy({
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
        const topResourcesRaw = await prisma.auditLog.groupBy({
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
        const topUsersRaw = await prisma.auditLog.groupBy({
          by: ["userId"],
          where: { ...where, userId: { not: null } },
          _count: { userId: true },
          orderBy: { _count: { userId: "desc" } },
          take: 10,
        });

        const userIds = topUsersRaw.map((item) => item.userId!);
        const users = await prisma.adminUser.findMany({
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

        const result = await prisma.auditLog.deleteMany({
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
}

// Singleton instance
export const auditService = new AuditService();

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
