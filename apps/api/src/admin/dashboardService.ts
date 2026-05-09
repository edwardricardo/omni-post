/**
 * @file dashboardService.ts
 * @description Centralizes admin dashboard business logic with consistent error handling,
 *              logging, and performance tracking using BaseService pattern.
 * @layer infrastructure
 */

import { BaseService } from "../services/BaseService.js";
import { prisma } from "@infra/prisma";

/**
 * Dashboard Service
 * Handles admin dashboard data aggregation and statistics
 */
export class DashboardService extends BaseService {
  constructor() {
    super("DashboardService");
  }

  /**
   * Get overall dashboard statistics
   */
  async getStats() {
    return this.execute({ operation: "getStats" }, async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Get basic counts in parallel
      const [totalAccounts, activeAccounts, trialsActive, newAccountsToday, totalProjects] =
        await Promise.all([
          prisma.account.count(),
          prisma.account.count({ where: { isOnTrial: false } }),
          prisma.account.count({
            where: {
              isOnTrial: true,
              trialEndDate: { gte: now },
            },
          }),
          prisma.account.count({
            where: { createdAt: { gte: todayStart } },
          }),
          prisma.project.count(),
        ]);

      // Get subscription distribution from AccountSubscription
      const subscriptionStats = await prisma.accountSubscription.groupBy({
        by: ["status"],
        _count: { id: true },
      });

      const subscriptions: Record<string, number> = {
        TRIALING: 0,
        ACTIVE: 0,
        PAST_DUE: 0,
        CANCELED: 0,
        GRANDFATHERED: 0,
      };

      subscriptionStats.forEach((stat) => {
        subscriptions[stat.status] = stat._count.id;
      });

      // Get trials expiring soon (next 3 days)
      const trialExpiryDate = new Date();
      trialExpiryDate.setDate(trialExpiryDate.getDate() + 3);

      const trialsExpiring = await prisma.account.count({
        where: {
          isOnTrial: true,
          trialEndDate: {
            gte: now,
            lte: trialExpiryDate,
          },
        },
      });

      return {
        accounts: {
          total: totalAccounts,
          active: activeAccounts,
          trialsActive,
          trialsExpiring,
        },
        subscriptions,
        projects: totalProjects,
        activity: {
          newAccountsToday,
        },
        lastUpdated: new Date().toISOString(),
      };
    });
  }

  /**
   * @method mapAccountToSummary
   * @description Shape an Account row (with projects + accountSubscription includes)
   *   into the AccountSummary DTO consumed by the admin accounts UI and CSV export.
   */
  private mapAccountToSummary(
    account: Awaited<ReturnType<typeof prisma.account.findMany>>[number] & {
      projects: unknown[];
      accountSubscription: {
        bundle: { name: string } | null;
        maxProjects: number;
        status: string;
        providers: unknown[];
        pricePerMonth: unknown;
        bundleId: string | null;
      } | null;
    },
    now: Date
  ) {
    const trialExpired = account.trialEndDate ? now > account.trialEndDate : false;
    const trialDaysRemaining = account.trialEndDate
      ? Math.max(
          0,
          Math.ceil((account.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        )
      : 0;

    const sub = account.accountSubscription;
    const maxProjects = sub?.maxProjects ?? account.maxProjects;

    return {
      id: account.id,
      email: account.email,
      name: account.name,
      isActive: account.isActive,
      createdAt: account.createdAt.toISOString(),
      ...(account.phone && { phone: account.phone }),
      plan: {
        type: sub?.bundleId
          ? ("bundle" as const)
          : sub?.providers?.length
            ? ("custom" as const)
            : ("none" as const),
        name: sub?.bundle?.name ?? (sub?.providers?.length ? "Custom" : "No Plan"),
        status: sub?.status ?? "NONE",
        providers: sub?.providers?.map(String) ?? [],
        pricePerMonth: sub ? Number(sub.pricePerMonth) : 0,
      },
      trial: {
        isOnTrial: account.isOnTrial,
        trialDaysRemaining,
        trialExpired,
        ...(account.trialEndDate && { trialEndDate: account.trialEndDate.toISOString() }),
        autoRenewal: account.autoRenewal,
      },
      usage: {
        projectsUsed: account.projects.length,
        projectsRemaining: Math.max(0, maxProjects - account.projects.length),
        utilizationPercent:
          maxProjects > 0 ? Math.round((account.projects.length / maxProjects) * 100) : 0,
      },
    };
  }

  /**
   * Get accounts summary with usage details
   */
  async getAccountsSummary() {
    return this.execute({ operation: "getAccountsSummary" }, async () => {
      const accounts = await prisma.account.findMany({
        include: {
          projects: true,
          accountSubscription: { include: { bundle: true } },
        },
        take: 100,
        orderBy: { createdAt: "desc" },
      });

      const now = new Date();
      const accountSummaries = accounts.map((account) => this.mapAccountToSummary(account, now));

      return {
        accounts: accountSummaries,
        total: accountSummaries.length,
      };
    });
  }

  /**
   * @method getAccountsForExport
   * @description Returns full AccountSummary rows for CSV export. When `ids` is
   *   provided, scope to those accounts; otherwise return up to 1000 most-recent
   *   accounts (export ceiling — large exports should be paginated server-side
   *   in a future iteration). Mirrors the pattern of subscription/audit exports
   *   that route through the `exportToCSV` utility in `@packages/api-common`.
   */
  async getAccountsForExport(ids?: string[]) {
    return this.execute({ operation: "getAccountsForExport" }, async () => {
      const accounts = await prisma.account.findMany({
        where: ids && ids.length > 0 ? { id: { in: ids } } : {},
        include: {
          projects: true,
          accountSubscription: { include: { bundle: true } },
        },
        take: 1000,
        orderBy: { createdAt: "desc" },
      });

      const now = new Date();
      return accounts.map((account) => this.mapAccountToSummary(account, now));
    });
  }

  /**
   * Get subscriptions summary with trial details
   */
  async getSubscriptionsSummary() {
    return this.execute({ operation: "getSubscriptionsSummary" }, async () => {
      const now = new Date();

      // Get active subscriptions (not on trial) with plan data
      const activeSubscriptions = await prisma.account.findMany({
        where: {
          isOnTrial: false,
        },
        include: {
          accountSubscription: {
            include: { bundle: true },
          },
        },
        take: 50,
        orderBy: { createdAt: "desc" },
      });

      // Get trial accounts with plan data
      const trialAccounts = await prisma.account.findMany({
        where: {
          isOnTrial: true,
        },
        include: {
          accountSubscription: {
            include: { bundle: true },
          },
        },
        take: 50,
        orderBy: { trialStartDate: "desc" },
      });

      const trials = trialAccounts.map((account) => {
        const trialDaysRemaining = account.trialEndDate
          ? Math.max(
              0,
              Math.ceil((account.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            )
          : 0;

        let status: "ACTIVE" | "EXPIRING" | "EXPIRED" = "ACTIVE";
        if (trialDaysRemaining === 0) status = "EXPIRED";
        else if (trialDaysRemaining <= 2) status = "EXPIRING";

        const sub = account.accountSubscription;

        return {
          id: account.id,
          email: account.email,
          name: account.name,
          trialStartDate: account.trialStartDate?.toISOString() || "",
          trialEndDate: account.trialEndDate?.toISOString() || "",
          trialDaysRemaining,
          autoRenewal: account.autoRenewal,
          status,
          plan: sub
            ? {
                type: sub.bundleId
                  ? ("bundle" as const)
                  : sub.providers?.length
                    ? ("custom" as const)
                    : ("none" as const),
                name: sub.bundle?.name ?? (sub.providers?.length ? "Custom" : "No Plan"),
                status: sub.status,
                providers: sub.providers?.map(String) ?? [],
                pricePerMonth: Number(sub.pricePerMonth ?? 0),
              }
            : null,
        };
      });

      const subscriptionsWithDetails = activeSubscriptions.map((account) => {
        const sub = account.accountSubscription;
        return {
          id: account.id,
          email: account.email,
          name: account.name,
          billingCycle: account.billingCycle,
          autoRenewal: account.autoRenewal,
          createdAt: account.createdAt.toISOString(),
          nextBillingDate: account.nextBillingDate?.toISOString() || null,
          lastBillingDate: account.lastBillingDate?.toISOString() || null,
          plan: sub
            ? {
                type: sub.bundleId
                  ? ("bundle" as const)
                  : sub.providers?.length
                    ? ("custom" as const)
                    : ("none" as const),
                name: sub.bundle?.name ?? (sub.providers?.length ? "Custom" : "No Plan"),
                status: sub.status,
                providers: sub.providers?.map(String) ?? [],
                pricePerMonth: Number(sub.pricePerMonth ?? 0),
              }
            : null,
        };
      });

      // Calculate revenue from active + grandfathered subscriptions
      const revenueAccounts = await prisma.accountSubscription.findMany({
        where: { status: { in: ["ACTIVE", "GRANDFATHERED"] } },
        select: { pricePerMonth: true },
      });
      const monthlyRevenue = revenueAccounts.reduce(
        (sum, s) => sum + Number(s.pricePerMonth ?? 0),
        0
      );

      const totalTrialCount = trialAccounts.length;
      const totalActiveCount = revenueAccounts.length;
      const conversionRate =
        totalActiveCount + totalTrialCount > 0
          ? Math.round((totalActiveCount / (totalActiveCount + totalTrialCount)) * 1000) / 10
          : 0;

      // Calculate stats
      const stats = {
        activeSubscriptions: activeSubscriptions.length,
        activeTrials: trials.filter((t) => t.status === "ACTIVE").length,
        expiringTrials: trials.filter((t) => t.status === "EXPIRING").length,
        expiredTrials: trials.filter((t) => t.status === "EXPIRED").length,
        totalRevenue: monthlyRevenue,
        monthlyRevenue,
        conversionRate,
      };

      return {
        subscriptions: subscriptionsWithDetails,
        trials,
        stats,
      };
    });
  }

  /**
   * Get analytics overview
   */
  async getAnalyticsOverview() {
    return this.execute({ operation: "getAnalyticsOverview" }, async () => {
      const now = new Date();

      // Get basic metrics
      const totalUsers = await prisma.account.count();
      const activeUsers = await prisma.account.count({ where: { isOnTrial: false } });
      const newUsersToday = await prisma.account.count({
        where: {
          createdAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          },
        },
      });

      // Get subscription distribution from AccountSubscription
      const subscriptionStats = await prisma.accountSubscription.groupBy({
        by: ["status"],
        _count: { id: true },
      });

      const subscriptions: Record<string, number> = {
        TRIALING: 0,
        ACTIVE: 0,
        PAST_DUE: 0,
        CANCELED: 0,
        GRANDFATHERED: 0,
      };
      subscriptionStats.forEach((stat) => {
        subscriptions[stat.status] = stat._count.id;
      });

      const overview = {
        totalUsers,
        activeUsers,
        newUsersToday,
      };

      return {
        overview,
        subscriptions,
      };
    });
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();
