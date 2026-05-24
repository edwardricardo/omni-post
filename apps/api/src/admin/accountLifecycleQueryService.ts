/**
 * @file accountLifecycleQueryService.ts
 * @description Handles read-only queries for admin account management:
 *              listing with filters/pagination and aggregate statistics.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import { logger } from "../lib/logger.js";

const adminLogger = logger.child({ module: "admin" });
import type { AdminRoleKind } from "../domain/repositories/ReadModelDtos.js";
import type { AdminUserDto } from "../domain/repositories/ReadModelDtos.js";
import type { AdminSessionDto } from "../domain/repositories/AdminSessionRepository.js";
import { BaseService } from "../services/BaseService.js";
import type { AccountProfile, AccountFilters, AccountStats } from "./accountLifecycleTypes.js";

// ---------------------------------------------------------------------------
// Internal helper — maps a Prisma AdminUser row to the public AccountProfile
// shape.  Shared with AccountLifecycleService via import so both modules stay
// in sync without duplicating the logic.
// ---------------------------------------------------------------------------

export async function mapAdminUserToProfile(
  prisma: PrismaClient,
  user: {
    id: string;
    email: string;
    name: string;
    role: AdminRoleKind;
    isActive: boolean;
    emailVerified: boolean;
    lastLoginAt: Date | null;
    mfaEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    sessions?: Array<{ createdAt: Date }>;
  }
): Promise<AccountProfile> {
  const sessionCount = user.sessions
    ? user.sessions.length
    : await prisma.adminSession.count({
        where: { userId: user.id, isActive: true },
      });

  const lastActivity = user.sessions?.[0]?.createdAt ?? user.lastLoginAt ?? null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    sessionCount,
    lastActivity,
  };
}

// ---------------------------------------------------------------------------

export class AccountLifecycleQueryService extends BaseService {
  constructor(private readonly prisma: PrismaClient) {
    super("AccountLifecycleQueryService");
  }

  /**
   * Map an admin user (optionally with preloaded sessions) to the public
   * AccountProfile shape, resolving the active session count when sessions
   * are not provided.
   *
   * @param user - Admin user DTO, optionally carrying preloaded sessions
   * @returns The mapped AccountProfile
   */
  async mapUserToProfile(
    user: AdminUserDto & { sessions?: AdminSessionDto[] }
  ): Promise<AccountProfile> {
    return mapAdminUserToProfile(this.prisma, user);
  }

  /**
   * List accounts with filtering and pagination
   */
  async listAccounts(
    filters: AccountFilters = {},
    page = 1,
    limit = 50
  ): Promise<
    Result<
      { accounts: AccountProfile[]; total: number; page: number; limit: number },
      "DATABASE_ERROR"
    >
  > {
    try {
      const offset = (page - 1) * limit;

      // Build where clause
      const where: Record<string, unknown> = {};

      if (filters.role) {
        where.role = { name: filters.role };
      }

      if (filters.isActive !== undefined) {
        where.isActive = filters.isActive;
      }

      if (filters.emailVerified !== undefined) {
        where.emailVerified = filters.emailVerified;
      }

      if (filters.mfaEnabled !== undefined) {
        where.mfaEnabled = filters.mfaEnabled;
      }

      if (filters.lastLoginAfter || filters.lastLoginBefore) {
        where.lastLoginAt = {};
        if (filters.lastLoginAfter) {
          (where.lastLoginAt as Record<string, Date>).gte = filters.lastLoginAfter;
        }
        if (filters.lastLoginBefore) {
          (where.lastLoginAt as Record<string, Date>).lte = filters.lastLoginBefore;
        }
      }

      if (filters.createdAfter || filters.createdBefore) {
        where.createdAt = {};
        if (filters.createdAfter) {
          (where.createdAt as Record<string, Date>).gte = filters.createdAfter;
        }
        if (filters.createdBefore) {
          (where.createdAt as Record<string, Date>).lte = filters.createdBefore;
        }
      }

      if (filters.search) {
        where.OR = [
          { email: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
        ];
      }

      // Get total count
      const total = await this.prisma.adminUser.count({ where });

      // Get users
      const users = await this.prisma.adminUser.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          role: true,
          sessions: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const accounts = await Promise.all(
        users.map((user) => mapAdminUserToProfile(this.prisma, { ...user, role: user.role.name }))
      );

      return ok({
        accounts,
        total,
        page,
        limit,
      });
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "List accounts error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get account statistics
   */
  async getAccountStats(): Promise<Result<AccountStats, "DATABASE_ERROR">> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalAccounts,
        activeAccounts,
        emailVerifiedAccounts,
        mfaEnabledAccounts,
        recentLogins,
        recentRegistrations,
        roleStats,
      ] = await Promise.all([
        this.prisma.adminUser.count(),
        this.prisma.adminUser.count({ where: { isActive: true } }),
        this.prisma.adminUser.count({ where: { emailVerified: true } }),
        this.prisma.adminUser.count({ where: { mfaEnabled: true } }),
        this.prisma.adminUser.count({ where: { lastLoginAt: { gte: sevenDaysAgo } } }),
        this.prisma.adminUser.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        this.prisma.adminUser.groupBy({
          by: ["roleId"],
          _count: { id: true },
        }),
      ]);

      // Resolve role names from IDs
      const roles = await this.prisma.role.findMany({ where: { isActive: true } });
      const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

      const accountsByRole: Record<string, number> = {};
      for (const role of roles) {
        accountsByRole[role.name] = 0;
      }

      roleStats.forEach((stat) => {
        const roleName = roleNameById.get(stat.roleId) ?? stat.roleId;
        accountsByRole[roleName] = stat._count.id;
      });

      return ok({
        totalAccounts,
        activeAccounts,
        inactiveAccounts: totalAccounts - activeAccounts,
        emailVerifiedAccounts,
        mfaEnabledAccounts,
        accountsByRole,
        recentLogins,
        recentRegistrations,
      });
    } catch (error: unknown) {
      adminLogger.error({ err: error }, "Get account stats error");
      return err("DATABASE_ERROR");
    }
  }
}
