/**
 * @file PrismaUsageMetricRepository.ts
 * @description Prisma adapter implementing the UsageMetricRepository port.
 *   Uses upsert with atomic increments for concurrent-safe counter updates.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  UsageMetricRepository,
  UsageMetricData,
  AccountUsageContext,
} from "@core/domain/repositories/UsageMetricRepository.js";

const BYTES_PER_GB = 1024 * 1024 * 1024;

export class PrismaUsageMetricRepository implements UsageMetricRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async increment(
    accountId: string,
    year: number,
    month: number,
    field: "postsPublished" | "aiCallsMade",
    delta = 1
  ): Promise<void> {
    await this.prisma.usageMetric.upsert({
      where: {
        accountId_periodYear_periodMonth: { accountId, periodYear: year, periodMonth: month },
      },
      create: {
        accountId,
        periodYear: year,
        periodMonth: month,
        [field]: delta,
      },
      update: {
        [field]: { increment: delta },
      },
    });
  }

  async set(
    accountId: string,
    year: number,
    month: number,
    field: "storageGb" | "teamMemberCount",
    value: number
  ): Promise<void> {
    await this.prisma.usageMetric.upsert({
      where: {
        accountId_periodYear_periodMonth: { accountId, periodYear: year, periodMonth: month },
      },
      create: {
        accountId,
        periodYear: year,
        periodMonth: month,
        [field]: value,
      },
      update: { [field]: value },
    });
  }

  async findByPeriod(
    accountId: string,
    year: number,
    month: number
  ): Promise<UsageMetricData | null> {
    return this.prisma.usageMetric.findUnique({
      where: {
        accountId_periodYear_periodMonth: { accountId, periodYear: year, periodMonth: month },
      },
    });
  }

  /**
   * Three-leg JOIN read for the usage page:
   * - Account (limits + trial + billing)
   * - AccountSubscription → ProviderBundle (plan name + plan-level limits)
   * - Channel COUNT scoped to projects owned by the account
   *
   * Returns null only when the account itself doesn't exist. When the
   * account has no subscription / no bundle, defaults are surfaced as
   * `plan: "Free"` and `null` limits — the page maps null to "Unlimited".
   */
  async findAccountContext(accountId: string): Promise<AccountUsageContext | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        maxStorageBytes: true,
        maxTeamMembers: true,
        isOnTrial: true,
        trialEndDate: true,
        nextBillingDate: true,
        accountSubscription: {
          select: {
            bundle: {
              select: {
                name: true,
                maxPostsPerMonth: true,
                maxChannels: true,
              },
            },
          },
        },
      },
    });

    if (!account) return null;

    const channelsCount = await this.prisma.channel.count({
      where: {
        deletedAt: null,
        project: { accountId, deletedAt: null },
      },
    });

    const bundle = account.accountSubscription?.bundle;

    return {
      plan: bundle?.name ?? "Free",
      channelsCount,
      postsLimit: bundle?.maxPostsPerMonth ?? null,
      channelsLimit: bundle?.maxChannels ?? null,
      teamMembersLimit: account.maxTeamMembers,
      storageLimitGb: Number(account.maxStorageBytes) / BYTES_PER_GB,
      isOnTrial: account.isOnTrial,
      trialEndDate: account.trialEndDate,
      nextBillingDate: account.nextBillingDate,
    };
  }
}
