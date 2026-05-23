/**
 * @file activityFeedService.ts
 * @description Transforms AuditLog entries into user-friendly ActivityItem objects
 *              for display in the dashboard activity feed.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import { type Result } from "@shared/types";
import { BaseService } from "../services/BaseService.js";
import { AuditActions } from "./auditService.js";

/**
 * A single item in the activity feed
 */
export interface ActivityItem {
  id: string;
  icon: string;
  title: string;
  description: string;
  timestamp: Date;
  actor?: {
    id: string;
    name: string;
    email: string;
  };
  resource?: string;
  resourceId?: string;
}

/**
 * Cursor-based pagination result for the activity feed
 */
export interface ActivityFeedPage {
  items: ActivityItem[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Filters for the activity feed query
 */
export interface ActivityFeedFilters {
  projectId?: string;
  accountId?: string;
  userId?: string;
  resource?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Maps audit actions to human-readable titles and icons
 */
const ACTION_DISPLAY: Record<string, { icon: string; title: string }> = {
  [AuditActions.LOGIN]: { icon: "log-in", title: "Signed in" },
  [AuditActions.LOGOUT]: { icon: "log-out", title: "Signed out" },
  [AuditActions.LOGIN_FAILED]: { icon: "alert-triangle", title: "Failed sign-in attempt" },
  [AuditActions.TOKEN_REFRESH]: { icon: "refresh-cw", title: "Refreshed session" },
  [AuditActions.SESSION_REVOKED]: { icon: "x-circle", title: "Revoked session" },
  [AuditActions.PASSWORD_RESET]: { icon: "key", title: "Reset password" },
  [AuditActions.USER_CREATED]: { icon: "user-plus", title: "Created user" },
  [AuditActions.USER_UPDATED]: { icon: "user", title: "Updated user" },
  [AuditActions.USER_DELETED]: { icon: "user-minus", title: "Deleted user" },
  [AuditActions.USER_SUSPENDED]: { icon: "user-x", title: "Suspended user" },
  [AuditActions.USER_ACTIVATED]: { icon: "user-check", title: "Activated user" },
  [AuditActions.ROLE_CHANGED]: { icon: "shield", title: "Changed role" },
  [AuditActions.ACCOUNT_CREATED]: { icon: "briefcase", title: "Created account" },
  [AuditActions.ACCOUNT_UPDATED]: { icon: "edit", title: "Updated account" },
  [AuditActions.ACCOUNT_DELETED]: { icon: "trash-2", title: "Deleted account" },
  [AuditActions.SUBSCRIPTION_CHANGED]: { icon: "credit-card", title: "Changed subscription" },
  [AuditActions.PROJECT_CREATED]: { icon: "folder-plus", title: "Created project" },
  [AuditActions.PROJECT_UPDATED]: { icon: "folder", title: "Updated project" },
  [AuditActions.PROJECT_DELETED]: { icon: "folder-minus", title: "Deleted project" },
  [AuditActions.POST_CREATED]: { icon: "file-plus", title: "Created post" },
  [AuditActions.POST_UPDATED]: { icon: "file-text", title: "Updated post" },
  [AuditActions.POST_DELETED]: { icon: "file-minus", title: "Deleted post" },
  [AuditActions.POST_PUBLISHED]: { icon: "send", title: "Published post" },
  [AuditActions.SYSTEM_CONFIG_CHANGED]: { icon: "settings", title: "Changed system config" },
  [AuditActions.CACHE_CLEARED]: { icon: "database", title: "Cleared cache" },
  [AuditActions.MAINTENANCE_MODE]: { icon: "tool", title: "Toggled maintenance mode" },
  [AuditActions.PERMISSION_DENIED]: { icon: "lock", title: "Permission denied" },
  [AuditActions.SUSPICIOUS_ACTIVITY]: { icon: "alert-octagon", title: "Suspicious activity" },
  [AuditActions.API_KEY_GENERATED]: { icon: "key", title: "Generated API key" },
  [AuditActions.MFA_ENABLED]: { icon: "shield", title: "Enabled MFA" },
  [AuditActions.MFA_DISABLED]: { icon: "shield-off", title: "Disabled MFA" },
};

const DEFAULT_DISPLAY = { icon: "activity", title: "Action performed" };

/**
 * @class ActivityFeedService
 * @description Reads AuditLog entries and transforms them into ActivityItem objects
 *              suitable for dashboard display. Uses cursor-based pagination.
 */
export class ActivityFeedService extends BaseService {
  constructor(private readonly prisma: PrismaClient) {
    super("ActivityFeedService");
  }

  /**
   * @method getFeed
   * @description Retrieves a page of activity feed items with cursor-based pagination.
   * @param filters - Optional filters for projectId, accountId, userId, resource, cursor
   * @returns Paginated activity feed page
   */
  async getFeed(filters: ActivityFeedFilters = {}): Promise<Result<ActivityFeedPage, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getFeed",
        metadata: { resource: filters.resource, limit: filters.limit },
      },
      async () => {
        const limit = Math.min(filters.limit ?? 25, 100);
        const where = this.buildWhereClause(filters);

        const logs = await this.prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: { id: true, email: true, name: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit + 1,
          ...(filters.cursor && {
            cursor: { id: filters.cursor },
            skip: 1,
          }),
        });

        const hasMore = logs.length > limit;
        const page = hasMore ? logs.slice(0, limit) : logs;
        const lastItem = page[page.length - 1];

        const items: ActivityItem[] = page.map((log) => this.toActivityItem(log));

        return {
          items,
          hasMore,
          ...(hasMore && lastItem && { nextCursor: lastItem.id }),
        };
      }
    );
  }

  /**
   * Build Prisma where clause from filters
   */
  private buildWhereClause(filters: ActivityFeedFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { success: true };

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.resource) {
      where.resource = filters.resource;
    }

    if (filters.projectId) {
      where.resourceId = filters.projectId;
      where.resource = "Project";
    }

    if (filters.accountId) {
      where.resourceId = filters.accountId;
      where.resource = "Account";
    }

    return where;
  }

  /**
   * Transform a raw AuditLog row into an ActivityItem
   */
  private toActivityItem(log: {
    id: string;
    action: string;
    resource?: string | null;
    resourceId?: string | null;
    details?: unknown;
    createdAt: Date;
    user?: { id: string; email: string; name: string } | null;
  }): ActivityItem {
    const display = ACTION_DISPLAY[log.action] ?? DEFAULT_DISPLAY;
    const description = this.buildDescription(
      log.action,
      log.resource,
      log.resourceId,
      log.details
    );

    return {
      id: log.id,
      icon: display.icon,
      title: display.title,
      description,
      timestamp: log.createdAt,
      ...(log.user && {
        actor: { id: log.user.id, name: log.user.name, email: log.user.email },
      }),
      ...(log.resource && { resource: log.resource }),
      ...(log.resourceId && { resourceId: log.resourceId }),
    };
  }

  /**
   * Build a human-readable description from the audit log metadata
   */
  private buildDescription(
    action: string,
    resource?: string | null,
    resourceId?: string | null,
    details?: unknown
  ): string {
    const parts: string[] = [];

    if (resource) {
      parts.push(resource);
    }

    if (resourceId) {
      parts.push(`(${resourceId.substring(0, 8)}...)`);
    }

    if (details && typeof details === "object" && !Array.isArray(details)) {
      const detailObj = details as Record<string, unknown>;
      if (typeof detailObj.name === "string") {
        parts.push(`"${detailObj.name}"`);
      }
      if (typeof detailObj.method === "string" && typeof detailObj.url === "string") {
        parts.push(`${detailObj.method} ${detailObj.url}`);
      }
    }

    if (parts.length === 0) {
      return action.replace(/_/g, " ").toLowerCase();
    }

    return parts.join(" ");
  }
}
