/**
 * @file CustomerAccountBillingService.ts
 * @description Customer-account status + billing operations for the admin console:
 *              toggle account status (with audit), compute the per-account billing
 *              breakdown via PricingCalculator, and adjust grandfathering windows.
 *              Receives PrismaClient by injection (admin-config tables have no
 *              dedicated ports yet — backlog: hexagonal pricing/billing ports) and
 *              writes audit through the AuditLogRepository port (spine canon).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import {
  AUDIT_ACTOR_TYPE,
  type AuditLogRepository,
} from "@core/domain/repositories/AuditLogRepository.js";
import {
  PricingCalculator,
  type ProviderTier,
  type AccountTier,
  type BundleDef,
} from "@core/domain/billing/PricingCalculator.js";

/** Account status fields editable by an admin. */
export interface UpdateAccountStatusInput {
  isActive?: boolean;
  name?: string;
  email?: string;
  phone?: string;
}

/** Public projection returned after an account-status update. */
export interface AccountStatusView {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  updatedAt: Date;
}

/** Error carrying a calculator/code + message for billing computations. */
export interface BillingError {
  code: string;
  message: string;
}

/** Full billing breakdown returned to the admin billing view. */
export interface AccountBillingView {
  accountId: string;
  accountName: string;
  planType: "custom" | "bundle" | "none";
  bundleInfo: { name: string; slug: string } | null;
  isGrandfathered: boolean;
  grandfathering: {
    lockedPrice: number;
    currentListPrice: number;
    savingsFromGrandfathering: number;
    expiresAt: string | null;
  } | null;
  providers: Array<{ platform: string; pricePerProvider: number }>;
  calculation: {
    providerCount: number;
    accountCount: number;
    basePrice: number;
    totalMonthly: number;
    listPrice: number;
    savings: number;
  };
  cheaperBundle: {
    bundle: { name: string; slug: string };
    bundleTotal: number;
    customTotal: number;
    savings: number;
  } | null;
  trial?: { isOnTrial: true; trialEndDate: string; daysRemaining: number };
}

/**
 * Admin-console customer-account billing operations.
 *
 * Register as a singleton in the DI container via
 * TOKENS.CustomerAccountBillingService.
 */
export class CustomerAccountBillingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLog: AuditLogRepository
  ) {}

  /**
   * @method updateAccountStatus
   * @description Apply admin edits to a customer account and audit the change.
   * @param accountId - Customer Account ID
   * @param body - Editable status fields
   * @param adminUserId - Acting admin (for the audit trail), if present
   * @returns Ok(view) or Err("NOT_FOUND")
   */
  async updateAccountStatus(
    accountId: string,
    body: UpdateAccountStatusInput,
    adminUserId?: string
  ): Promise<Result<AccountStatusView, "NOT_FOUND">> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return err("NOT_FOUND");
    }

    const updatedAccount = await this.prisma.account.update({
      where: { id: accountId },
      data: {
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
      },
      select: { id: true, email: true, name: true, phone: true, isActive: true, updatedAt: true },
    });

    if (adminUserId) {
      await this.auditLog.create({
        action: "ACCOUNT_UPDATE",
        actorType: AUDIT_ACTOR_TYPE.ADMIN,
        resource: "Account",
        resourceId: accountId,
        userId: adminUserId,
        success: true,
        details: {
          changes: {
            ...(body.isActive !== undefined && {
              isActive: { from: account.isActive, to: body.isActive },
            }),
            ...(body.name !== undefined && { name: { from: account.name, to: body.name } }),
          },
          updatedBy: adminUserId,
        },
      });
    }

    return ok(updatedAccount);
  }

  /**
   * @method getAccountBilling
   * @description Compute the per-account billing breakdown (custom-price tiers,
   *   cheaper-bundle comparison, grandfathering, trial).
   * @param accountId - Customer Account ID
   * @returns Ok(view) or Err({ code, message }) ("NOT_FOUND" or a calculator error)
   */
  async getAccountBilling(accountId: string): Promise<Result<AccountBillingView, BillingError>> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return err({ code: "NOT_FOUND", message: "Account not found" });
    }

    const subscription = await this.prisma.accountSubscription.findUnique({
      where: { accountId },
      include: { bundle: true, history: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    const subscriptionProviders = subscription?.providers?.map(String) ?? [];
    const providerCounts = new Map<string, number>();
    for (const p of subscriptionProviders) {
      providerCounts.set(p, 1);
    }

    const rawProviderTiers = await this.prisma.providerPricingTier.findMany({
      where: { isActive: true },
      orderBy: { minProviders: "asc" },
    });
    const rawAccountTiers = await this.prisma.accountPricingTier.findMany({
      where: { isActive: true },
      orderBy: { minAccounts: "asc" },
    });
    const rawBundles = await this.prisma.providerBundle.findMany({ where: { isActive: true } });

    const providerTiers: ProviderTier[] = rawProviderTiers.map((t) => ({
      minProviders: t.minProviders,
      maxProviders: t.maxProviders,
      pricePerProviderMonth: Number(t.pricePerProviderMonth),
      isActive: t.isActive,
    }));
    const accountTiers: AccountTier[] = rawAccountTiers.map((t) => ({
      minAccounts: t.minAccounts,
      maxAccounts: t.maxAccounts,
      multiplier: Number(t.multiplier),
      isActive: t.isActive,
    }));
    const bundles: BundleDef[] = rawBundles.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      providers: b.providers.map(String),
      pricePerAccountMonth: Number(b.pricePerAccountMonth),
      isActive: b.isActive,
    }));

    const providerCount = providerCounts.size;
    const hasTiers = providerTiers.length > 0;
    let total = 0;
    let breakdown = {
      pricePerProvider: 0,
      basePricePerAccount: 0,
      accountLines: [] as Array<{ accountNumber: number; multiplier: number; price: number }>,
      subtotal: 0,
      savings: 0,
    };
    let cheaperBundle: AccountBillingView["cheaperBundle"] = null;

    if (hasTiers && providerCount > 0) {
      const priceResult = PricingCalculator.calculateCustomPrice(
        providerCount,
        1,
        providerTiers,
        accountTiers
      );
      if (!priceResult.ok) {
        return err({ code: priceResult.error.code, message: priceResult.error.message });
      }
      total = priceResult.value.total;
      breakdown = priceResult.value.breakdown;

      const selectedProviders = Array.from(providerCounts.keys());
      const cheaperBundleResult = PricingCalculator.findCheaperBundle(
        selectedProviders,
        total,
        bundles,
        1,
        accountTiers
      );
      if (!cheaperBundleResult.ok) {
        return err({
          code: cheaperBundleResult.error.code,
          message: cheaperBundleResult.error.message,
        });
      }
      const cheaperBundleMatch = cheaperBundleResult.value;
      if (cheaperBundleMatch) {
        cheaperBundle = {
          bundle: { name: cheaperBundleMatch.bundle.name, slug: cheaperBundleMatch.bundle.slug },
          bundleTotal: cheaperBundleMatch.total,
          customTotal: total,
          savings: cheaperBundleMatch.savings,
        };
      }
    }

    const providers = Array.from(providerCounts.keys()).map((platform) => ({
      platform,
      pricePerProvider: breakdown.pricePerProvider,
    }));

    let planType: "custom" | "bundle" | "none" = "none";
    let bundleInfo: { name: string; slug: string } | null = null;
    let isGrandfathered = false;
    let grandfathering: AccountBillingView["grandfathering"] = null;

    if (subscription) {
      if (subscription.bundleId && subscription.bundle) {
        planType = "bundle";
        bundleInfo = { name: subscription.bundle.name, slug: subscription.bundle.slug };
      } else if (subscription.providers.length > 0) {
        planType = "custom";
      }

      if (subscription.status === "GRANDFATHERED") {
        isGrandfathered = true;
        const lockedPrice = Number(subscription.pricePerMonth);
        const currentListPrice = total;
        const lastHistory = subscription.history[0];
        grandfathering = {
          lockedPrice,
          currentListPrice,
          savingsFromGrandfathering: Math.round((currentListPrice - lockedPrice) * 100) / 100,
          expiresAt: lastHistory?.effectiveAt ? lastHistory.effectiveAt.toISOString() : null,
        };
      }
    }

    return ok({
      accountId: account.id,
      accountName: account.name,
      planType,
      bundleInfo,
      isGrandfathered,
      grandfathering,
      providers,
      calculation: {
        providerCount,
        accountCount: 1,
        basePrice: breakdown.basePricePerAccount,
        totalMonthly: isGrandfathered ? Number(subscription!.pricePerMonth) : total,
        listPrice: total,
        savings: breakdown.savings,
      },
      cheaperBundle,
      ...(account.isOnTrial &&
        account.trialEndDate && {
          trial: {
            isOnTrial: true as const,
            trialEndDate: account.trialEndDate.toISOString(),
            daysRemaining: Math.max(
              0,
              Math.ceil((account.trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            ),
          },
        }),
    });
  }

  /**
   * @method updateGrandfathering
   * @description Adjust the grandfathering expiry (effectiveAt) for a
   *   grandfathered subscription, updating or creating the price-history row.
   * @param accountId - Customer Account ID
   * @param newDate - New effective date (caller validates it is in the future)
   * @returns Ok({ effectiveAt }) or Err("NOT_FOUND")
   */
  async updateGrandfathering(
    accountId: string,
    newDate: Date
  ): Promise<Result<{ effectiveAt: string }, "NOT_FOUND">> {
    const sub = await this.prisma.accountSubscription.findUnique({
      where: { accountId },
      include: { history: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!sub || sub.status !== "GRANDFATHERED") {
      return err("NOT_FOUND");
    }

    const history = sub.history[0];
    if (history) {
      await this.prisma.subscriptionPriceHistory.update({
        where: { id: history.id },
        data: { effectiveAt: newDate },
      });
    } else {
      await this.prisma.subscriptionPriceHistory.create({
        data: {
          subscriptionId: sub.id,
          previousPrice: sub.pricePerMonth,
          newPrice: sub.pricePerMonth,
          reason: "Grandfathering window adjusted",
          effectiveAt: newDate,
        },
      });
    }

    return ok({ effectiveAt: newDate.toISOString() });
  }
}
