/**
 * @file PricingCalculator.ts
 * @description Pure domain service for provider-based pricing calculation.
 *              Zero infrastructure imports. All prices come from parameters (loaded from DB).
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvariantViolationError } from "../errors/DomainError.js";

export interface ProviderTier {
  minProviders: number;
  maxProviders: number | null;
  pricePerProviderMonth: number;
  isActive: boolean;
}

export interface AccountTier {
  minAccounts: number;
  maxAccounts: number | null;
  multiplier: number;
  isActive: boolean;
}

export interface BundleDef {
  id: string;
  name: string;
  slug: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive: boolean;
}

export interface AccountLine {
  accountNumber: number;
  multiplier: number;
  price: number;
}

export interface PriceBreakdown {
  pricePerProvider: number;
  basePricePerAccount: number;
  accountLines: AccountLine[];
  subtotal: number;
  savings: number;
}

export interface PriceQuote {
  total: number;
  breakdown: PriceBreakdown;
}

export interface BundleMatch {
  bundle: BundleDef;
  total: number;
  savings: number;
}

export class PricingCalculator {
  static calculateCustomPrice(
    providerCount: number,
    accountCount: number,
    providerTiers: ProviderTier[],
    accountTiers: AccountTier[]
  ): Result<PriceQuote, InvariantViolationError> {
    const pricePerProviderResult = this.getProviderTierPrice(providerCount, providerTiers);
    if (!pricePerProviderResult.ok) return pricePerProviderResult;
    const pricePerProvider = pricePerProviderResult.value;
    const basePricePerAccount = pricePerProvider * providerCount;

    let total = 0;
    const accountLines: AccountLine[] = [];

    for (let i = 1; i <= accountCount; i++) {
      const multiplierResult = this.getAccountMultiplier(i, accountTiers);
      if (!multiplierResult.ok) return multiplierResult;
      const multiplier = multiplierResult.value;
      const price = Math.round(basePricePerAccount * multiplier * 100) / 100;
      total += price;
      accountLines.push({ accountNumber: i, multiplier, price });
    }

    total = Math.round(total * 100) / 100;
    const noDiscountTotal = basePricePerAccount * accountCount;

    return ok({
      total,
      breakdown: {
        pricePerProvider,
        basePricePerAccount,
        accountLines,
        subtotal: total,
        savings: Math.round((noDiscountTotal - total) * 100) / 100,
      },
    });
  }

  static calculateBundlePrice(
    bundlePricePerAccount: number,
    accountCount: number,
    accountTiers: AccountTier[]
  ): Result<PriceQuote, InvariantViolationError> {
    let total = 0;
    const accountLines: AccountLine[] = [];

    for (let i = 1; i <= accountCount; i++) {
      const multiplierResult = this.getAccountMultiplier(i, accountTiers);
      if (!multiplierResult.ok) return multiplierResult;
      const multiplier = multiplierResult.value;
      const price = Math.round(bundlePricePerAccount * multiplier * 100) / 100;
      total += price;
      accountLines.push({ accountNumber: i, multiplier, price });
    }

    total = Math.round(total * 100) / 100;

    return ok({
      total,
      breakdown: {
        pricePerProvider: 0,
        basePricePerAccount: bundlePricePerAccount,
        accountLines,
        subtotal: total,
        savings: Math.round((bundlePricePerAccount * accountCount - total) * 100) / 100,
      },
    });
  }

  static findCheaperBundle(
    selectedProviders: string[],
    customTotal: number,
    bundles: BundleDef[],
    accountCount: number,
    accountTiers: AccountTier[]
  ): Result<BundleMatch | null, InvariantViolationError> {
    let best: { bundle: BundleDef; total: number } | null = null;

    for (const bundle of bundles.filter((b) => b.isActive)) {
      const coversAll = selectedProviders.every((p) => bundle.providers.includes(p));
      if (!coversAll) continue;

      const bundleQuoteResult = this.calculateBundlePrice(
        bundle.pricePerAccountMonth,
        accountCount,
        accountTiers
      );
      if (!bundleQuoteResult.ok) return bundleQuoteResult;
      const { total } = bundleQuoteResult.value;

      if (total < customTotal) {
        if (!best || total < best.total) {
          best = { bundle, total };
        }
      }
    }

    if (!best) return ok(null);
    return ok({
      bundle: best.bundle,
      total: best.total,
      savings: Math.round((customTotal - best.total) * 100) / 100,
    });
  }

  private static getProviderTierPrice(
    count: number,
    tiers: ProviderTier[]
  ): Result<number, InvariantViolationError> {
    const active = tiers.filter((t) => t.isActive).sort((a, b) => b.minProviders - a.minProviders);

    const tier = active.find(
      (t) => count >= t.minProviders && (t.maxProviders === null || count <= t.maxProviders)
    );

    if (!tier) {
      return err(
        new InvariantViolationError(
          `No active pricing tier covers provider count ${count} (tier configuration gap)`
        )
      );
    }
    return ok(tier.pricePerProviderMonth);
  }

  private static getAccountMultiplier(
    accountNumber: number,
    tiers: AccountTier[]
  ): Result<number, InvariantViolationError> {
    const active = tiers.filter((t) => t.isActive).sort((a, b) => b.minAccounts - a.minAccounts);

    const tier = active.find(
      (t) =>
        accountNumber >= t.minAccounts && (t.maxAccounts === null || accountNumber <= t.maxAccounts)
    );

    if (!tier) {
      return err(
        new InvariantViolationError(
          `No active account tier covers account number ${accountNumber} (tier configuration gap)`
        )
      );
    }
    return ok(tier.multiplier);
  }
}
