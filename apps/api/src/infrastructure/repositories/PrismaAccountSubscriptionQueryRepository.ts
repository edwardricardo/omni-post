/**
 * @file PrismaAccountSubscriptionQueryRepository.ts
 * @description Prisma adapter implementing AccountSubscriptionQueryRepository
 *   (read side). Receives PrismaClient via constructor injection and returns
 *   flat DTOs with Decimal money fields coerced to numbers.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import type {
  AccountSubscriptionQueryRepository,
  AccountSubscriptionDetailDto,
  AccountSubscriptionListFilters,
  AccountSubscriptionListItemDto,
  AccountSubscriptionListResult,
  SubscriptionBundleSummaryDto,
  SubscriptionTrialStatusDto,
} from "@core/domain/repositories/AccountSubscriptionQueryRepository.js";

type BundleRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: Prisma.Decimal;
  isActive: boolean;
  sortOrder: number;
  maxPostsPerMonth: number | null;
  maxChannels: number | null;
};

function mapBundle(row: BundleRow): SubscriptionBundleSummaryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    providers: row.providers.map(String),
    pricePerAccountMonth: Number(row.pricePerAccountMonth),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    maxPostsPerMonth: row.maxPostsPerMonth,
    maxChannels: row.maxChannels,
  };
}

export class PrismaAccountSubscriptionQueryRepository implements AccountSubscriptionQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Return the subscription joined with its bundle and a minimal account
   * summary, or null when no subscription exists for the account.
   */
  async getDetailByAccountId(accountId: string): Promise<AccountSubscriptionDetailDto | null> {
    const sub = await this.prisma.accountSubscription.findUnique({
      where: { accountId },
      include: { bundle: true, account: { select: { id: true, name: true, email: true } } },
    });
    if (!sub) return null;
    return {
      id: sub.id,
      accountId: sub.accountId,
      bundleId: sub.bundleId,
      providers: sub.providers.map(String),
      maxProjects: sub.maxProjects,
      pricePerMonth: Number(sub.pricePerMonth),
      status: sub.status,
      billingCycle: sub.billingCycle,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
      bundle: sub.bundle ? mapBundle(sub.bundle as BundleRow) : null,
      account: sub.account,
    };
  }

  /**
   * Return a paginated, filtered subscription list with its total count.
   * Preserves the bundle/custom planType filter (bundleId not-null / null) and
   * the case-insensitive account email/name search.
   */
  async list(
    filters: AccountSubscriptionListFilters,
    page: number,
    limit: number
  ): Promise<AccountSubscriptionListResult> {
    const offset = (page - 1) * limit;
    const where: Prisma.AccountSubscriptionWhereInput = {};

    if (filters.status) {
      where.status = filters.status as NonNullable<Prisma.AccountSubscriptionWhereInput["status"]>;
    }
    if (filters.planType === "bundle") {
      where.bundleId = { not: null };
    } else if (filters.planType === "custom") {
      where.bundleId = null;
    }
    if (filters.search) {
      where.account = {
        OR: [
          { email: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.accountSubscription.findMany({
        where,
        include: { bundle: true, account: { select: { id: true, name: true, email: true } } },
        skip: offset,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.accountSubscription.count({ where }),
    ]);

    const subscriptions: AccountSubscriptionListItemDto[] = rows.map((sub) => ({
      id: sub.id,
      accountId: sub.accountId,
      bundleId: sub.bundleId,
      providers: sub.providers.map(String),
      maxProjects: sub.maxProjects,
      pricePerMonth: Number(sub.pricePerMonth),
      status: sub.status,
      billingCycle: sub.billingCycle,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
      bundle: sub.bundle ? mapBundle(sub.bundle as BundleRow) : null,
      account: sub.account,
    }));

    return { subscriptions, total };
  }

  /**
   * Return the maxProjects limit for an account's subscription, or null when no
   * subscription exists.
   */
  async getMaxProjects(accountId: string): Promise<number | null> {
    const sub = await this.prisma.accountSubscription.findUnique({
      where: { accountId },
      select: { maxProjects: true },
    });
    return sub ? sub.maxProjects : null;
  }

  /**
   * Return all active provider bundles ordered by sort position.
   */
  async listBundles(): Promise<SubscriptionBundleSummaryDto[]> {
    const rows = await this.prisma.providerBundle.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((row) => mapBundle(row as BundleRow));
  }

  /**
   * Return trial status from the AccountSubscription model, or null when no
   * subscription exists.
   */
  async getTrialStatusByAccountId(accountId: string): Promise<SubscriptionTrialStatusDto | null> {
    const sub = await this.prisma.accountSubscription.findUnique({
      where: { accountId },
    });
    if (!sub) return null;
    return {
      isTrialing: sub.status === "TRIALING",
      trialEndsAt: sub.trialEndsAt,
      daysRemaining: sub.trialEndsAt
        ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0,
      status: sub.status,
    };
  }
}
