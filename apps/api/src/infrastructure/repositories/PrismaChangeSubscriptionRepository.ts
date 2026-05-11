/**
 * @file PrismaChangeSubscriptionRepository.ts
 * @description Prisma adapter for ChangeSubscriptionRepository port.
 * @layer infrastructure
 */

import { prisma } from "@infra/prisma";
import type { ChangeSubscriptionRepository } from "../../application/billing/ChangeAccountSubscriptionUseCase.js";
import type { ProviderTier, AccountTier } from "../../domain/billing/PricingCalculator.js";

export class PrismaChangeSubscriptionRepository implements ChangeSubscriptionRepository {
  async findSubscriptionByAccountId(accountId: string) {
    const sub = await prisma.accountSubscription.findUnique({
      where: { accountId },
      include: { bundle: true },
    });
    if (!sub) return null;
    return {
      id: sub.id,
      bundleId: sub.bundleId,
      providers: sub.providers.map(String),
      accountCount: sub.accountCount,
      pricePerMonth: Number(sub.pricePerMonth),
      maxProjects: sub.maxProjects,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      bundle: sub.bundle
        ? {
            id: sub.bundle.id,
            providers: sub.bundle.providers.map(String),
            pricePerAccountMonth: Number(sub.bundle.pricePerAccountMonth),
          }
        : null,
    };
  }

  async findBundle(bundleId: string): Promise<{
    id: string;
    providers: string[];
    pricePerAccountMonth: number;
    isActive: boolean;
  } | null> {
    const b = await prisma.providerBundle.findUnique({ where: { id: bundleId } });
    if (!b) return null;
    return {
      id: b.id,
      providers: b.providers.map(String),
      pricePerAccountMonth: Number(b.pricePerAccountMonth),
      isActive: b.isActive,
    };
  }

  async findProviderPricingTiers(): Promise<ProviderTier[]> {
    const rows = await prisma.providerPricingTier.findMany({
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
    const rows = await prisma.accountPricingTier.findMany({
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

  async createPriceHistory(params: {
    subscriptionId: string;
    previousPrice: number;
    newPrice: number;
    reason: string;
    effectiveAt: Date;
  }): Promise<void> {
    await prisma.subscriptionPriceHistory.create({
      data: {
        subscriptionId: params.subscriptionId,
        previousPrice: params.previousPrice,
        newPrice: params.newPrice,
        reason: params.reason,
        effectiveAt: params.effectiveAt,
      },
    });
  }

  async updateSubscription(
    subscriptionId: string,
    params: {
      bundleId?: string | null;
      providers?: string[];
      pricePerMonth?: number;
      maxProjects?: number;
      cancelAtPeriodEnd?: boolean;
    }
  ): Promise<void> {
    await prisma.accountSubscription.update({
      where: { id: subscriptionId },
      data: {
        ...(params.bundleId !== undefined && { bundleId: params.bundleId }),
        ...(params.providers !== undefined && { providers: params.providers as never[] }),
        ...(params.pricePerMonth !== undefined && { pricePerMonth: params.pricePerMonth }),
        ...(params.maxProjects !== undefined && { maxProjects: params.maxProjects }),
        ...(params.cancelAtPeriodEnd !== undefined && {
          cancelAtPeriodEnd: params.cancelAtPeriodEnd,
        }),
      },
    });
  }
}
