/**
 * @file SubscriptionPlanService.ts
 * @description Manages subscription plans from AccountSubscription + ProviderBundle models.
 *   Provides plan info and trial calculations from DB.
 * @layer application
 */

import type { Account as PrismaAccount } from "@infra/prisma";
import { prisma } from "@infra/prisma";
import { AuditableService } from "../../services/AuditableService.js";
import { type TrialInfo } from "./types.js";

export class SubscriptionPlanService extends AuditableService {
  constructor() {
    super("SubscriptionPlanService");
  }

  /**
   * @method getAccountPlan
   * @description Retrieves plan info from the AccountSubscription model including bundle details and pricing.
   * @param accountId - The account ID to look up
   * @returns The account plan details, or null if no subscription exists
   */
  async getAccountPlan(accountId: string) {
    const sub = await prisma.accountSubscription.findUnique({
      where: { accountId },
      include: { bundle: true },
    });

    if (!sub) return null;

    return {
      id: sub.id,
      planType: sub.bundleId
        ? ("bundle" as const)
        : sub.providers.length > 0
          ? ("custom" as const)
          : ("none" as const),
      bundleName: sub.bundle?.name ?? null,
      providers: sub.providers.map(String),
      pricePerMonth: Number(sub.pricePerMonth),
      maxProjects: sub.maxProjects,
      status: sub.status,
      billingCycle: sub.billingCycle,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  }

  /**
   * @method getAllPlansFromDB
   * @description Fetches all active provider bundles from the database, ordered by sort position.
   * @returns List of active provider bundles
   */
  async getAllPlansFromDB() {
    return prisma.providerBundle.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  /**
   * @method calculateTrialInfo
   * @description Computes trial status, remaining days, and expiration state for an account.
   * @param account - The account to evaluate trial info for
   * @returns Trial information including active status, dates, days remaining, and expiration
   */
  calculateTrialInfo(account: PrismaAccount): TrialInfo {
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

export const subscriptionPlanService = new SubscriptionPlanService();
