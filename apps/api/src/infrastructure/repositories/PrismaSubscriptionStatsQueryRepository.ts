/**
 * @file PrismaSubscriptionStatsQueryRepository.ts
 * @description Prisma adapter implementing SubscriptionStatsQueryRepository.
 *   Receives PrismaClient via constructor injection and returns raw aggregation
 *   DTOs with Decimal sums coerced to numbers.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  SubscriptionStatsQueryRepository,
  SubscriptionStatusGroupDto,
  ChurnActivityWindowsDto,
} from "../../domain/repositories/SubscriptionStatsQueryRepository.js";

export class PrismaSubscriptionStatsQueryRepository implements SubscriptionStatsQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Group subscriptions by status with per-status count and summed monthly
   * price.
   */
  async groupByStatus(): Promise<SubscriptionStatusGroupDto[]> {
    const rows = await this.prisma.accountSubscription.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { pricePerMonth: true },
    });
    return rows.map((row) => ({
      status: row.status,
      count: row._count.id,
      pricePerMonthSum: Number(row._sum.pricePerMonth ?? 0),
    }));
  }

  /**
   * Count all accounts.
   */
  async countAccounts(): Promise<number> {
    return this.prisma.account.count();
  }

  /**
   * Count accounts created at or after `since`.
   */
  async countAccountsCreatedSince(since: Date): Promise<number> {
    return this.prisma.account.count({ where: { createdAt: { gte: since } } });
  }

  /**
   * Count accounts created within the [from, to) window.
   */
  async countAccountsCreatedBetween(from: Date, to: Date): Promise<number> {
    return this.prisma.account.count({ where: { createdAt: { gte: from, lt: to } } });
  }

  /**
   * Count subscriptions backed by a provider bundle.
   */
  async countBundleSubscriptions(): Promise<number> {
    return this.prisma.accountSubscription.count({ where: { bundleId: { not: null } } });
  }

  /**
   * Resolve distinct account IDs that posted in the active (last 14 days) and
   * moderate ([30d, 14d)) windows.
   */
  async getChurnActivityWindows(
    fourteenDaysAgo: Date,
    thirtyDaysAgo: Date
  ): Promise<ChurnActivityWindowsDto> {
    const activeRows = await this.prisma.post.findMany({
      where: { createdAt: { gte: fourteenDaysAgo } },
      select: { project: { select: { accountId: true } } },
      distinct: ["projectId"],
    });
    const moderateRows = await this.prisma.post.findMany({
      where: { createdAt: { gte: thirtyDaysAgo, lt: fourteenDaysAgo } },
      select: { project: { select: { accountId: true } } },
      distinct: ["projectId"],
    });
    return {
      activeAccountIds: activeRows.map((p) => p.project.accountId),
      moderateAccountIds: moderateRows.map((p) => p.project.accountId),
    };
  }

  /**
   * Count cancellation audit-log entries created at or after `since`.
   */
  async countCancellationsSince(since: Date): Promise<number> {
    return this.prisma.auditLog.count({
      where: { action: { contains: "CANCEL" }, createdAt: { gte: since } },
    });
  }
}
