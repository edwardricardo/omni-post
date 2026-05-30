/**
 * @file AuditableService.ts
 * @description Base service class extending BaseService with compliance-ready audit logging
 *              for user actions, account changes, and resource modifications.
 * @layer infrastructure
 */

import { BaseService, type ServiceContext } from "./BaseService";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import { logger } from "../lib/logger.js";

// Audit action types (matching database schema - uses strings, not enums)
export type AuditAction = string;
export type AuditCategory =
  | "AUTHENTICATION"
  | "ACCOUNT"
  | "DATA"
  | "DATA_ACCESS"
  | "SECURITY"
  | "COMPLIANCE"
  | "SYSTEM"
  | "BILLING";
export type AuditSeverity = "LOW" | "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AuditLogEntry {
  action: AuditAction;
  category: AuditCategory;
  severity: AuditSeverity;
  userId?: string;
  accountId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface UserActionOptions {
  action: AuditAction;
  category: AuditCategory;
  severity?: AuditSeverity;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AccountActionOptions extends UserActionOptions {
  accountId: string;
}

export interface ResourceActionOptions extends AccountActionOptions {
  resourceType: string;
  resourceId: string;
}

/**
 * Auditable Service - Base class for services requiring audit logging
 * Extends BaseService with audit trail capabilities
 */
export abstract class AuditableService extends BaseService {
  /**
   * @param serviceName - Human-readable service name for log context.
   * @param auditLog - Audit-trail persistence port. Required: audit logging is
   *   compliance-critical, so there is no silent no-op fallback. Tests inject an
   *   in-memory implementation.
   */
  constructor(
    serviceName: string,
    protected readonly auditLog: AuditLogRepository
  ) {
    super(serviceName);
  }

  /**
   * Log a user action (authentication, profile changes, etc.)
   *
   * @example
   * await this.logUserAction(userId, {
   *   action: 'USER_LOGIN',
   *   category: 'AUTHENTICATION',
   *   severity: 'INFO',
   *   details: { method: 'password' },
   *   ipAddress: req.ip,
   *   userAgent: req.headers['user-agent']
   * });
   */
  protected async logUserAction(userId: string, options: UserActionOptions): Promise<void> {
    const entry: AuditLogEntry = {
      action: options.action,
      category: options.category,
      severity: options.severity || "INFO",
      userId,
      ...(options.details !== undefined && { details: options.details }),
      ...(options.ipAddress !== undefined && { ipAddress: options.ipAddress }),
      ...(options.userAgent !== undefined && { userAgent: options.userAgent }),
    };

    await this.writeAuditLog(entry);
  }

  /**
   * Log an account-level action (subscription, billing, settings)
   *
   * @example
   * await this.logAccountAction(userId, {
   *   accountId: account.id,
   *   action: 'SUBSCRIPTION_UPGRADE',
   *   category: 'BILLING',
   *   severity: 'HIGH',
   *   details: {
   *     from: 'FREE',
   *     to: 'PRO',
   *     billingCycle: 'MONTHLY'
   *   }
   * });
   */
  protected async logAccountAction(userId: string, options: AccountActionOptions): Promise<void> {
    const entry: AuditLogEntry = {
      action: options.action,
      category: options.category,
      severity: options.severity || "MEDIUM",
      userId,
      accountId: options.accountId,
      ...(options.details !== undefined && { details: options.details }),
      ...(options.ipAddress !== undefined && { ipAddress: options.ipAddress }),
      ...(options.userAgent !== undefined && { userAgent: options.userAgent }),
    };

    await this.writeAuditLog(entry);
  }

  /**
   * Log an account-level action performed by the system itself (auto-renewal,
   * scheduled jobs) rather than a user. The audit row is written with a null
   * `userId`: `AuditLog.userId` is nullable with an `onDelete: SetNull` FK to
   * `AdminUser`, so a sentinel string like `"system"` would violate the foreign
   * key and the write would be silently swallowed by `writeAuditLog`'s catch.
   *
   * @example
   * await this.logSystemAction({
   *   accountId: account.id,
   *   action: 'AUTO_RENEWAL',
   *   category: 'BILLING',
   *   severity: 'MEDIUM',
   *   details: { amount, billingCycle },
   * });
   */
  protected async logSystemAction(options: AccountActionOptions): Promise<void> {
    const entry: AuditLogEntry = {
      action: options.action,
      category: options.category,
      severity: options.severity || "MEDIUM",
      accountId: options.accountId,
      ...(options.details !== undefined && { details: options.details }),
      ...(options.ipAddress !== undefined && { ipAddress: options.ipAddress }),
      ...(options.userAgent !== undefined && { userAgent: options.userAgent }),
    };

    await this.writeAuditLog(entry);
  }

  /**
   * Log a resource action (create, update, delete operations)
   *
   * @example
   * await this.logResourceAction(userId, {
   *   accountId: account.id,
   *   action: 'RESOURCE_CREATE',
   *   category: 'DATA',
   *   resourceType: 'Post',
   *   resourceId: post.id,
   *   severity: 'LOW',
   *   details: {
   *     title: post.title,
   *     status: post.status
   *   }
   * });
   */
  protected async logResourceAction(userId: string, options: ResourceActionOptions): Promise<void> {
    const entry: AuditLogEntry = {
      action: options.action,
      category: options.category,
      severity: options.severity || "LOW",
      userId,
      accountId: options.accountId,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      ...(options.details !== undefined && { details: options.details }),
      ...(options.ipAddress !== undefined && { ipAddress: options.ipAddress }),
      ...(options.userAgent !== undefined && { userAgent: options.userAgent }),
    };

    await this.writeAuditLog(entry);
  }

  /**
   * Log security-related events (MFA, password changes, permission changes)
   *
   * @example
   * await this.logSecurityEvent(userId, accountId, {
   *   action: 'MFA_ENABLED',
   *   category: 'SECURITY',
   *   severity: 'HIGH',
   *   details: { method: 'totp' }
   * });
   */
  protected async logSecurityEvent(
    userId: string,
    accountId: string,
    options: Omit<UserActionOptions, "category">
  ): Promise<void> {
    await this.logAccountAction(userId, {
      accountId,
      category: "SECURITY",
      ...options,
    });
  }

  /**
   * Log data access events (for compliance and privacy)
   *
   * @example
   * await this.logDataAccess(userId, accountId, {
   *   action: 'DATA_EXPORT',
   *   resourceType: 'Analytics',
   *   resourceId: project.id,
   *   details: { format: 'CSV', recordCount: 1000 }
   * });
   */
  protected async logDataAccess(
    userId: string,
    accountId: string,
    options: Omit<ResourceActionOptions, "category" | "accountId">
  ): Promise<void> {
    await this.logResourceAction(userId, {
      accountId,
      category: "DATA_ACCESS",
      severity: "MEDIUM",
      ...options,
    });
  }

  /**
   * Log compliance-related events (GDPR, data deletion, consent)
   *
   * @example
   * await this.logComplianceEvent(userId, accountId, {
   *   action: 'DATA_DELETION_REQUEST',
   *   severity: 'CRITICAL',
   *   details: { scope: 'all_personal_data' }
   * });
   */
  protected async logComplianceEvent(
    userId: string,
    accountId: string,
    options: Omit<AccountActionOptions, "category" | "accountId">
  ): Promise<void> {
    await this.logAccountAction(userId, {
      accountId,
      category: "COMPLIANCE",
      severity: "CRITICAL",
      ...options,
    });
  }

  /**
   * Write audit log entry to database
   * Can be overridden for custom audit log storage
   *
   * Note: Maps AuditableService structure to Prisma AuditLog schema
   * - action: stored as-is
   * - resourceType: stored as 'resource' field
   * - category/severity: stored in details for queryability
   */
  protected async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      // Merge category/severity into details for storage
      const enrichedDetails = {
        ...(entry.details || {}),
        category: entry.category,
        severity: entry.severity,
        ...(entry.metadata || {}),
      };

      await this.auditLog.create({
        action: entry.action,
        details: enrichedDetails,
        success: true, // Default to success for normal audit logs
        ...(entry.resourceType && { resource: entry.resourceType }),
        ...(entry.resourceId && { resourceId: entry.resourceId }),
        ...(entry.userId && { userId: entry.userId }),
        ...(entry.accountId && { accountId: entry.accountId }),
        ...(entry.ipAddress && { ipAddress: entry.ipAddress }),
        ...(entry.userAgent && { userAgent: entry.userAgent }),
      });
    } catch (error) {
      // Log audit logging failure (don't throw to avoid breaking main operation)
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          entry,
        },
        "Failed to write audit log"
      );
    }
  }

  /**
   * Execute operation with automatic audit logging
   * Logs both success and failure
   *
   * @example
   * return this.executeWithAudit(
   *   { operation: 'updateUser', userId, accountId },
   *   {
   *     action: 'USER_UPDATE',
   *     category: 'ACCOUNT',
   *     resourceType: 'User',
   *     resourceId: userId
   *   },
   *   async () => {
   *     const updated = await prisma.user.update({ ... });
   *     return updated;
   *   }
   * );
   */
  protected async executeWithAudit<T>(
    context: Omit<ServiceContext, "serviceName">,
    auditOptions: {
      action: AuditAction;
      category: AuditCategory;
      resourceType?: string;
      resourceId?: string;
      severity?: AuditSeverity;
      ipAddress?: string;
      userAgent?: string;
    },
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let error: unknown;

    try {
      const result = await operation();
      // Log successful operation
      if (context.userId) {
        const entry: AuditLogEntry = {
          action: auditOptions.action,
          category: auditOptions.category,
          severity: auditOptions.severity || "LOW",
          userId: context.userId,
          ...(context.accountId !== undefined && { accountId: context.accountId }),
          ...(auditOptions.resourceType !== undefined && {
            resourceType: auditOptions.resourceType,
          }),
          ...(auditOptions.resourceId !== undefined && { resourceId: auditOptions.resourceId }),
          ...(auditOptions.ipAddress !== undefined && { ipAddress: auditOptions.ipAddress }),
          ...(auditOptions.userAgent !== undefined && { userAgent: auditOptions.userAgent }),
          details: {
            operation: context.operation,
            durationMs: Date.now() - startTime,
            success: true,
          },
        };
        await this.writeAuditLog(entry);
      }

      return result;
    } catch (err) {
      error = err;

      // Log failed operation
      if (context.userId) {
        const entry: AuditLogEntry = {
          action: auditOptions.action,
          category: auditOptions.category,
          severity: "HIGH", // Failed operations are high severity
          userId: context.userId,
          ...(context.accountId !== undefined && { accountId: context.accountId }),
          ...(auditOptions.resourceType !== undefined && {
            resourceType: auditOptions.resourceType,
          }),
          ...(auditOptions.resourceId !== undefined && { resourceId: auditOptions.resourceId }),
          ...(auditOptions.ipAddress !== undefined && { ipAddress: auditOptions.ipAddress }),
          ...(auditOptions.userAgent !== undefined && { userAgent: auditOptions.userAgent }),
          details: {
            operation: context.operation,
            durationMs: Date.now() - startTime,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
        };
        await this.writeAuditLog(entry);
      }

      throw err;
    }
  }

  /**
   * Query audit logs for a user
   * Note: category is stored in details field, not as a direct column
   */
  protected async getUserAuditLogs(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    return this.auditLog.findByUser(userId, options);
  }

  /**
   * Query audit logs for a resource.
   */
  protected async getResourceAuditLogs(
    resource: string,
    resourceId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    return this.auditLog.findByResource(resource, resourceId, options);
  }

  /**
   * Query audit logs scoped to an account. Customer-facing flow — the caller
   * binds `accountId` from the authenticated `TenantContext`. Admin
   * compliance reads use `findByUser` / `findByResource` without account
   * filter (AuditLog stays outside RLS by canon — immutable evidence).
   */
  protected async getAccountAuditLogs(
    accountId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    return this.auditLog.findByAccount(accountId, options);
  }
}
