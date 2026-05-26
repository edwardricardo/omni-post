/**
 * @file SubscriptionPlanService.ts
 * @description Manages subscription plans from AccountSubscription + ProviderBundle models.
 *   Provides plan info and trial calculations via the subscription read port.
 * @layer application
 */

import type { AccountSubscriptionQueryRepository } from "@core/domain/repositories/AccountSubscriptionQueryRepository.js";
import { type TrialInfo } from "./types.js";

/**
 * Account fields required to compute trial information. A structural subset of
 * the persisted account row, kept Prisma-free so the application layer does not
 * depend on generated types.
 */
export interface TrialAccountView {
  isOnTrial: boolean;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
}

export class SubscriptionPlanService {
  constructor(private readonly subscriptionQueryRepo: AccountSubscriptionQueryRepository) {}

  /**
   * @method getAccountPlan
   * @description Retrieves plan info from the AccountSubscription model including bundle details and pricing.
   * @param accountId - The account ID to look up
   * @returns The account plan details, or null if no subscription exists
   */
  async getAccountPlan(accountId: string) {
    const sub = await this.subscriptionQueryRepo.getDetailByAccountId(accountId);

    if (!sub) return null;

    return {
      id: sub.id,
      planType: sub.bundleId
        ? ("bundle" as const)
        : sub.providers.length > 0
          ? ("custom" as const)
          : ("none" as const),
      bundleName: sub.bundle?.name ?? null,
      providers: sub.providers,
      pricePerMonth: sub.pricePerMonth,
      maxProjects: sub.maxProjects,
      status: sub.status,
      billingCycle: sub.billingCycle,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  }

  /**
   * @method getAllPlansFromDB
   * @description Fetches all active provider bundles, ordered by sort position.
   * @returns List of active provider bundles
   */
  async getAllPlansFromDB() {
    return this.subscriptionQueryRepo.listBundles();
  }

  /**
   * @method calculateTrialInfo
   * @description Computes trial status, remaining days, and expiration state for an account.
   * @param account - The account to evaluate trial info for
   * @returns Trial information including active status, dates, days remaining, and expiration
   */
  calculateTrialInfo(account: TrialAccountView): TrialInfo {
    const now = new Date();
    const trialEndDate = account.trialEndDate;
    const trialExpired = trialEndDate ? now > trialEndDate : false;
    const trialDaysRemaining = trialEndDate
      ? Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    return {
      isOnTrial: account.isOnTrial && !trialExpired,
      trialStartDate: account.trialStartDate,
      trialEndDate,
      trialDaysRemaining,
      trialExpired,
    };
  }
}
