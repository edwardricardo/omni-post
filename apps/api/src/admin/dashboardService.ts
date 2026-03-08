/**
 * Dashboard Service - P0-6 Phase 2
 *
 * Centralizes admin dashboard business logic with consistent error handling,
 * logging, and performance tracking using BaseService pattern.
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

      // Get subscription distribution
      const subscriptionStats = await prisma.account.groupBy({
        by: ["subscription"],
        _count: { id: true },
      });

      const subscriptions = {
        basic: 0,
        pro: 0,
        enterprise: 0,
      };

      subscriptionStats.forEach((stat) => {
        const key = stat.subscription.toLowerCase() as keyof typeof subscriptions;
        subscriptions[key] = stat._count.id;
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
   * Get accounts summary with usage details
   */
  async getAccountsSummary() {
    return this.execute({ operation: "getAccountsSummary" }, async () => {
      const accounts = await prisma.account.findMany({
        include: {
          projects: true,
        },
        take: 100,
        orderBy: { createdAt: "desc" },
      });

      const now = new Date();
      const accountSummaries = accounts.map((account) => {
        const trialExpired = account.trialEndDate ? now > account.trialEndDate : false;
        const trialDaysRemaining = account.trialEndDate
          ? Math.max(
              0,
              Math.ceil((account.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            )
          : 0;

        return {
          id: account.id,
          email: account.email,
          name: account.name,
          subscription: account.subscription,
          isActive: !trialExpired,
          createdAt: account.createdAt.toISOString(),
          trial: {
            isOnTrial: account.isOnTrial && !trialExpired,
            trialDaysRemaining,
            trialExpired,
          },
          usage: {
            projectsUsed: account.projects.length,
            projectsRemaining: Math.max(0, account.maxProjects - account.projects.length),
            utilizationPercent: Math.round((account.projects.length / account.maxProjects) * 100),
          },
        };
      });

      return {
        accounts: accountSummaries,
        total: accountSummaries.length,
      };
    });
  }

  /**
   * Get subscriptions summary with trial details
   */
  async getSubscriptionsSummary() {
    return this.execute({ operation: "getSubscriptionsSummary" }, async () => {
      const now = new Date();

      // Get active subscriptions (not on trial)
      const activeSubscriptions = await prisma.account.findMany({
        where: {
          isOnTrial: false,
        },
        select: {
          id: true,
          email: true,
          name: true,
          subscription: true,
          billingCycle: true,
          autoRenewal: true,
          nextBillingDate: true,
          lastBillingDate: true,
          createdAt: true,
        },
        take: 50,
        orderBy: { createdAt: "desc" },
      });

      // Get trial accounts
      const trialAccounts = await prisma.account.findMany({
        where: {
          isOnTrial: true,
        },
        select: {
          id: true,
          email: true,
          name: true,
          subscription: true,
          trialStartDate: true,
          trialEndDate: true,
          autoRenewal: true,
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

        return {
          id: account.id,
          email: account.email,
          name: account.name,
          subscription: account.subscription,
          trialStartDate: account.trialStartDate?.toISOString() || "",
          trialEndDate: account.trialEndDate?.toISOString() || "",
          trialDaysRemaining,
          autoRenewal: account.autoRenewal,
          status,
        };
      });

      const subscriptionsWithDetails = activeSubscriptions.map((sub) => ({
        ...sub,
        createdAt: sub.createdAt.toISOString(),
        nextBillingDate: sub.nextBillingDate?.toISOString() || null,
        lastBillingDate: sub.lastBillingDate?.toISOString() || null,
      }));

      // Calculate stats
      const stats = {
        activeSubscriptions: activeSubscriptions.length,
        activeTrials: trials.filter((t) => t.status === "ACTIVE").length,
        expiringTrials: trials.filter((t) => t.status === "EXPIRING").length,
        expiredTrials: trials.filter((t) => t.status === "EXPIRED").length,
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

      // Get subscription distribution
      const subscriptionStats = await prisma.account.groupBy({
        by: ["subscription"],
        _count: { id: true },
      });

      const subscriptions: Record<string, number> = { basic: 0, pro: 0, enterprise: 0, trials: 0 };
      subscriptionStats.forEach((stat) => {
        const key = stat.subscription.toLowerCase();
        subscriptions[key] = stat._count.id;
      });

      // Add trials count
      subscriptions.trials = await prisma.account.count({ where: { isOnTrial: true } });

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
