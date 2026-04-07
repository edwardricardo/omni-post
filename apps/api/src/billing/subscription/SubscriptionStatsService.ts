/**
 * @file SubscriptionStatsService.ts
 * @description Subscription analytics using AccountSubscription model.
 *   Calculates MRR, plan distribution, churn risk, and growth metrics
 *   from the provider-based billing model.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import { AuditableService } from "../../services/AuditableService.js";
import type { SubscriptionStats } from "./types.js";

export class SubscriptionStatsService extends AuditableService {
  constructor() {
    super("SubscriptionStatsService");
  }

  /**
   * Get comprehensive subscription statistics from AccountSubscription model.
   */
  async getSubscriptionStats(): Promise<Result<SubscriptionStats, "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Count by AccountSubscription status
      const [statusCounts, totalAccounts, newThisMonth, bundleCount] = await Promise.all([
        prisma.accountSubscription.groupBy({
          by: ["status"],
          _count: { id: true },
          _sum: { pricePerMonth: true },
        }),
        prisma.account.count(),
        prisma.account.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        prisma.accountSubscription.count({ where: { bundleId: { not: null } } }),
      ]);

      // Build status distribution
      const statusMap: Record<string, { count: number; mrr: number }> = {};
      let totalMRR = 0;
      let totalSubscriptions = 0;

      for (const row of statusCounts) {
        const mrr = Number(row._sum.pricePerMonth ?? 0);
        statusMap[row.status] = { count: row._count.id, mrr };
        totalSubscriptions += row._count.id;
        if (row.status === "ACTIVE" || row.status === "GRANDFATHERED") {
          totalMRR += mrr;
        }
      }

      const customCount = totalSubscriptions - bundleCount;

      // Legacy-compatible tier counts (derived from AccountSubscription data)
      const subscriptionsByTier = {
        BASIC: statusMap["TRIALING"]?.count ?? 0,
        PRO: (statusMap["ACTIVE"]?.count ?? 0) + (statusMap["GRANDFATHERED"]?.count ?? 0),
        ENTERPRISE: 0,
      };

      const totalRevenue = {
        monthly: totalMRR,
        yearly: totalMRR * 12,
        total: totalMRR,
      };

      const conversionRates = {
        basicToPro:
          totalSubscriptions > 0
            ? ((statusMap["ACTIVE"]?.count ?? 0) / totalSubscriptions) * 100
            : 0,
        proToEnterprise: 0,
        overallUpgrade:
          totalSubscriptions > 0
            ? (((statusMap["ACTIVE"]?.count ?? 0) + (statusMap["GRANDFATHERED"]?.count ?? 0)) /
                totalSubscriptions) *
              100
            : 0,
      };

      const [churnRisk, growthMetrics] = await Promise.all([
        this.calculateChurnRisk(totalAccounts),
        this.calculateGrowthMetrics(newThisMonth, thirtyDaysAgo),
      ]);

      return ok({
        totalSubscriptions,
        subscriptionsByTier,
        totalRevenue,
        conversionRates,
        churnRisk,
        growthMetrics,
        // New fields for provider-based model
        statusDistribution: statusMap,
        totalMRR,
        bundleCount,
        customCount,
      });
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "getSubscriptionStats",
      });
      this.logError(
        { serviceName: this.serviceName, operation: "getSubscriptionStats" },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  private async calculateChurnRisk(totalSubscriptions: number) {
    if (totalSubscriptions === 0) {
      return { highRisk: 0, mediumRisk: 0, lowRisk: 0 };
    }

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const activeAccountIds = await prisma.post.findMany({
      where: { createdAt: { gte: fourteenDaysAgo } },
      select: { project: { select: { accountId: true } } },
      distinct: ["projectId"],
    });
    const lowRiskAccountIds = new Set(activeAccountIds.map((p) => p.project.accountId));

    const moderateAccountIds = await prisma.post.findMany({
      where: { createdAt: { gte: thirtyDaysAgo, lt: fourteenDaysAgo } },
      select: { project: { select: { accountId: true } } },
      distinct: ["projectId"],
    });
    const mediumRiskAccountIds = new Set(
      moderateAccountIds.map((p) => p.project.accountId).filter((id) => !lowRiskAccountIds.has(id))
    );

    const lowRisk = lowRiskAccountIds.size;
    const mediumRisk = mediumRiskAccountIds.size;
    const highRisk = Math.max(0, totalSubscriptions - lowRisk - mediumRisk);

    return { highRisk, mediumRisk, lowRisk };
  }

  private async calculateGrowthMetrics(newSubscriptionsThisMonth: number, thirtyDaysAgo: Date) {
    const sixtyDaysAgo = new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [previousPeriodCount, cancelledCount] = await Promise.all([
      prisma.account.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      prisma.auditLog.count({
        where: { action: { contains: "CANCEL" }, createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const monthlyGrowthRate =
      previousPeriodCount > 0
        ? Math.round(
            ((newSubscriptionsThisMonth - previousPeriodCount) / previousPeriodCount) * 100 * 100
          ) / 100
        : newSubscriptionsThisMonth > 0
          ? 100
          : 0;

    return {
      monthlyGrowthRate,
      newSubscriptionsThisMonth,
      cancelledSubscriptionsThisMonth: cancelledCount,
    };
  }
}

export const subscriptionStatsService = new SubscriptionStatsService();
