/**
 * @file SubscriptionStatsService.ts
 * @description Subscription analytics using AccountSubscription model.
 *   Calculates MRR, plan distribution, churn risk, and growth metrics
 *   from the provider-based billing model via the stats read port.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import { BaseService } from "../../services/BaseService.js";
import type { SubscriptionStatsQueryRepository } from "@core/domain/repositories/SubscriptionStatsQueryRepository.js";
import type { SubscriptionStats } from "./types.js";

export class SubscriptionStatsService extends BaseService {
  constructor(private readonly statsQueryRepo: SubscriptionStatsQueryRepository) {
    super("SubscriptionStatsService");
  }

  /**
   * @method getSubscriptionStats
   * @description Calculates comprehensive subscription analytics including MRR, status distribution, churn risk, and growth metrics.
   * @returns Result with subscription statistics on success, or DATABASE_ERROR on failure
   */
  async getSubscriptionStats(): Promise<Result<SubscriptionStats, "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [statusGroups, totalAccounts, newThisMonth, bundleCount] = await Promise.all([
        this.statsQueryRepo.groupByStatus(),
        this.statsQueryRepo.countAccounts(),
        this.statsQueryRepo.countAccountsCreatedSince(thirtyDaysAgo),
        this.statsQueryRepo.countBundleSubscriptions(),
      ]);

      // Build status distribution
      const statusMap: Record<string, { count: number; mrr: number }> = {};
      let totalMRR = 0;
      let totalSubscriptions = 0;

      for (const row of statusGroups) {
        const mrr = row.pricePerMonthSum;
        statusMap[row.status] = { count: row.count, mrr };
        totalSubscriptions += row.count;
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

    const windows = await this.statsQueryRepo.getChurnActivityWindows(
      fourteenDaysAgo,
      thirtyDaysAgo
    );

    const lowRiskAccountIds = new Set(windows.activeAccountIds);
    const mediumRiskAccountIds = new Set(
      windows.moderateAccountIds.filter((id) => !lowRiskAccountIds.has(id))
    );

    const lowRisk = lowRiskAccountIds.size;
    const mediumRisk = mediumRiskAccountIds.size;
    const highRisk = Math.max(0, totalSubscriptions - lowRisk - mediumRisk);

    return { highRisk, mediumRisk, lowRisk };
  }

  private async calculateGrowthMetrics(newSubscriptionsThisMonth: number, thirtyDaysAgo: Date) {
    const sixtyDaysAgo = new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [previousPeriodCount, cancelledCount] = await Promise.all([
      this.statsQueryRepo.countAccountsCreatedBetween(sixtyDaysAgo, thirtyDaysAgo),
      this.statsQueryRepo.countCancellationsSince(thirtyDaysAgo),
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
