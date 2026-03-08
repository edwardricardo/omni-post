/**
 * Subscription Stats Service
 *
 * Provides subscription analytics, statistics, and reporting capabilities.
 * Calculates plan distribution, revenue metrics, churn rates, and growth
 * trends across all subscription tiers.
 *
 * @module billing/subscription/SubscriptionStatsService
 */
import { ok, err, type Result, type SubscriptionTier } from "@shared/types";
import { prisma } from "@infra/prisma";
import { AuditableService } from "../../services/AuditableService";
import { SUBSCRIPTION_PLANS, type SubscriptionStats } from "./types";

/**
 * Service responsible for subscription analytics, statistics, and reporting
 */
export class SubscriptionStatsService extends AuditableService {
  constructor() {
    super("SubscriptionStatsService");
  }

  /**
   * Get comprehensive subscription statistics
   */
  async getSubscriptionStats(): Promise<Result<SubscriptionStats, "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [totalSubscriptions, subscriptionsByTier, newSubscriptionsThisMonth] =
        await Promise.all([
          prisma.account.count(),
          prisma.account.groupBy({
            by: ["subscription"],
            _count: { id: true },
          }),
          prisma.account.count({
            where: { createdAt: { gte: thirtyDaysAgo } },
          }),
        ]);

      const tierCounts: Record<SubscriptionTier, number> = {
        BASIC: 0,
        PRO: 0,
        ENTERPRISE: 0,
      };

      subscriptionsByTier.forEach((stat) => {
        tierCounts[stat.subscription] = stat._count.id;
      });

      // Calculate revenue (mock calculation for admin interface)
      const totalRevenue = this.calculateTotalRevenue(tierCounts);

      // Calculate conversion rates (simplified)
      const conversionRates = this.calculateConversionRates(tierCounts, totalSubscriptions);

      const [churnRisk, growthMetrics] = await Promise.all([
        this.calculateChurnRisk(totalSubscriptions),
        this.calculateGrowthMetrics(newSubscriptionsThisMonth, thirtyDaysAgo),
      ]);

      return ok({
        totalSubscriptions,
        subscriptionsByTier: tierCounts,
        totalRevenue,
        conversionRates,
        churnRisk,
        growthMetrics,
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

  /**
   * Calculate total revenue across all tiers
   */
  private calculateTotalRevenue(tierCounts: Record<SubscriptionTier, number>) {
    const monthly =
      tierCounts.BASIC * SUBSCRIPTION_PLANS.BASIC.monthlyPrice +
      tierCounts.PRO * SUBSCRIPTION_PLANS.PRO.monthlyPrice +
      tierCounts.ENTERPRISE * SUBSCRIPTION_PLANS.ENTERPRISE.monthlyPrice;

    const yearly =
      tierCounts.BASIC * SUBSCRIPTION_PLANS.BASIC.yearlyPrice +
      tierCounts.PRO * SUBSCRIPTION_PLANS.PRO.yearlyPrice +
      tierCounts.ENTERPRISE * SUBSCRIPTION_PLANS.ENTERPRISE.yearlyPrice;

    return {
      monthly,
      yearly,
      total: monthly + yearly,
    };
  }

  /**
   * Calculate conversion rates between tiers
   */
  private calculateConversionRates(
    tierCounts: Record<SubscriptionTier, number>,
    totalSubscriptions: number
  ) {
    return {
      basicToPro:
        tierCounts.BASIC > 0 ? (tierCounts.PRO / (tierCounts.BASIC + tierCounts.PRO)) * 100 : 0,
      proToEnterprise:
        tierCounts.PRO > 0
          ? (tierCounts.ENTERPRISE / (tierCounts.PRO + tierCounts.ENTERPRISE)) * 100
          : 0,
      overallUpgrade:
        totalSubscriptions > 0
          ? ((tierCounts.PRO + tierCounts.ENTERPRISE) / totalSubscriptions) * 100
          : 0,
    };
  }

  /**
   * Calculate churn risk distribution based on account posting activity.
   *
   * Heuristic thresholds:
   *   - High risk:   no posts created in the last 30 days
   *   - Medium risk: most recent post is 14-30 days old
   *   - Low risk:    posted within the last 14 days
   *
   * Accounts with zero posts ever are classified as high risk.
   */
  private async calculateChurnRisk(totalSubscriptions: number) {
    if (totalSubscriptions === 0) {
      return { highRisk: 0, mediumRisk: 0, lowRisk: 0 };
    }

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Accounts that posted within the last 14 days (low risk)
    const activeAccountIds = await prisma.post.findMany({
      where: { createdAt: { gte: fourteenDaysAgo } },
      select: { project: { select: { accountId: true } } },
      distinct: ["projectId"],
    });
    const lowRiskAccountIds = new Set(activeAccountIds.map((p) => p.project.accountId));

    // Accounts that posted between 14-30 days ago but NOT in the last 14 days (medium risk)
    const moderateAccountIds = await prisma.post.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo, lt: fourteenDaysAgo },
      },
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

  /**
   * Calculate growth metrics by comparing account creation rates across
   * two consecutive 30-day periods, and counting cancellation audit events.
   *
   * Growth rate = ((current - previous) / previous) * 100
   * Cancellations are tracked via AuditLog with action containing "CANCEL".
   *
   * @param newSubscriptionsThisMonth - accounts created in the last 30 days (pre-computed)
   * @param thirtyDaysAgo - the Date marking 30 days ago (pre-computed by caller)
   */
  private async calculateGrowthMetrics(newSubscriptionsThisMonth: number, thirtyDaysAgo: Date) {
    const sixtyDaysAgo = new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [previousPeriodCount, cancelledCount] = await Promise.all([
      // Accounts created 30-60 days ago
      prisma.account.count({
        where: {
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
      // Cancellation events in the last 30 days (logged via AuditLog)
      prisma.auditLog.count({
        where: {
          action: { contains: "CANCEL" },
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    // Avoid division by zero: if no accounts in previous period, use raw count as rate
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
