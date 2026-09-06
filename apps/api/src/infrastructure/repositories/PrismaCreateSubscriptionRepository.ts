/**
 * @file PrismaCreateSubscriptionRepository.ts
 * @description Prisma adapter for CreateSubscriptionRepository port.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { CreateSubscriptionRepository } from "@core/billing/CreateAccountSubscriptionUseCase.js";
import type { ProviderTier, AccountTier } from "@core/domain/billing/PricingCalculator.js";

export class PrismaCreateSubscriptionRepository implements CreateSubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAccount(accountId: string): Promise<{ id: string } | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true },
    });
  }

  async findSubscriptionByAccountId(accountId: string): Promise<{ id: string } | null> {
    return this.prisma.accountSubscription.findUnique({
      where: { accountId },
      select: { id: true },
    });
  }

  async findBundle(bundleId: string): Promise<{
    id: string;
    providers: string[];
    pricePerAccountMonth: number;
    isActive: boolean;
  } | null> {
    const b = await this.prisma.providerBundle.findUnique({ where: { id: bundleId } });
    if (!b) return null;
    return {
      id: b.id,
      providers: b.providers.map(String),
      pricePerAccountMonth: Number(b.pricePerAccountMonth),
      isActive: b.isActive,
    };
  }

  async findProviderPricingTiers(): Promise<ProviderTier[]> {
    const rows = await this.prisma.providerPricingTier.findMany({
      where: { isActive: true },
      orderBy: { minProviders: "asc" },
    });
    return rows.map((t) => ({
      minProviders: t.minProviders,
      maxProviders: t.maxProviders,
      pricePerProviderMonth: Number(t.pricePerProviderMonth),
      isActive: t.isActive,
    }));
  }

  async findAccountPricingTiers(): Promise<AccountTier[]> {
    const rows = await this.prisma.accountPricingTier.findMany({
      where: { isActive: true },
      orderBy: { minAccounts: "asc" },
    });
    return rows.map((t) => ({
      minAccounts: t.minAccounts,
      maxAccounts: t.maxAccounts,
      multiplier: Number(t.multiplier),
      isActive: t.isActive,
    }));
  }

  async createSubscription(params: {
    accountId: string;
    bundleId?: string;
    providers: string[];
    pricePerMonth: number;
    maxProjects: number;
    status: string;
    trialEndsAt?: Date;
  }): Promise<string> {
    const sub = await this.prisma.accountSubscription.create({
      data: {
        accountId: params.accountId,
        ...(params.bundleId !== undefined && { bundleId: params.bundleId }),
        providers: params.providers as never[],
        pricePerMonth: params.pricePerMonth,
        maxProjects: params.maxProjects,
        status: params.status as never,
        billingCycle: "MONTHLY",
        ...(params.trialEndsAt !== undefined && { trialEndsAt: params.trialEndsAt }),
      },
    });
    return sub.id;
  }
}
