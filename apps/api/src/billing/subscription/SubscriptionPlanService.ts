/**
 * @file SubscriptionPlanService.ts
 * @description Manages subscription plans from AccountSubscription + ProviderBundle models.
 *   Validates limits, provides plan info from DB instead of hardcoded constants.
 * @layer application
 */

import { ok, type Result, type SubscriptionTier } from "@shared/types";
import type { Account as PrismaAccount } from "@infra/prisma";
import { prisma } from "@infra/prisma";
import { AuditableService } from "../../services/AuditableService.js";
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  type AccountSubscriptionInfo,
  type SubscriptionHierarchy,
  type TrialInfo,
} from "./types.js";

type AccountWithProjects = PrismaAccount & { projects: unknown[] };

export class SubscriptionPlanService extends AuditableService {
  constructor() {
    super("SubscriptionPlanService");
  }

  /**
   * @method getSubscriptionPlan
   * @description Returns the hardcoded subscription plan details for a given tier.
   * @deprecated Prefer getAccountPlan(accountId) for provider-based model.
   * @param tier - The subscription tier to look up
   * @returns The subscription plan configuration for the given tier
   */
  getSubscriptionPlan(tier: SubscriptionTier): SubscriptionPlan {
    return SUBSCRIPTION_PLANS[tier];
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
   * @method getAllPlans
   * @description Returns all hardcoded subscription plans.
   * @deprecated Use getAllPlansFromDB instead.
   * @returns Array of all subscription plan configurations
   */
  getAllPlans(): SubscriptionPlan[] {
    return Object.values(SUBSCRIPTION_PLANS);
  }

  /**
   * @method validateSubscriptionLimits
   * @description Validates whether an operation is allowed based on the subscription's project, team, and storage limits.
   * @param subscriptionInfo - The account's current subscription information
   * @param operation - The operation to validate (CREATE_PROJECT, ADD_TEAM_MEMBER, UPLOAD_MEDIA)
   * @param amount - Number of units the operation would consume (defaults to 1)
   * @returns Result with allowed status, limit, current usage, and remaining capacity
   */
  async validateSubscriptionLimits(
    subscriptionInfo: AccountSubscriptionInfo,
    operation: "CREATE_PROJECT" | "ADD_TEAM_MEMBER" | "UPLOAD_MEDIA",
    amount = 1
  ): Promise<
    Result<{ allowed: boolean; limit: number; current: number; remaining: number }, never>
  > {
    const { plan, usage } = subscriptionInfo;

    switch (operation) {
      case "CREATE_PROJECT": {
        const remaining = usage.projectsRemaining;
        return ok({
          allowed: remaining >= amount,
          limit: plan.maxProjects,
          current: usage.projectsUsed,
          remaining,
        });
      }
      case "ADD_TEAM_MEMBER":
        return ok({
          allowed: plan.limits.teamMembers === -1 || usage.projectsUsed < plan.limits.teamMembers,
          limit: plan.limits.teamMembers,
          current: usage.projectsUsed,
          remaining: Math.max(0, plan.limits.teamMembers - usage.projectsUsed),
        });
      case "UPLOAD_MEDIA": {
        const storageUsedGB = await this.calculateStorageUsedGB(subscriptionInfo.id);
        const remaining = Math.max(0, plan.limits.mediaStorageGB - storageUsedGB);
        return ok({
          allowed: remaining >= amount,
          limit: plan.limits.mediaStorageGB,
          current: storageUsedGB,
          remaining,
        });
      }
      default:
        return ok({ allowed: true, limit: 0, current: 0, remaining: 0 });
    }
  }

  /**
   * Validate upgrade by comparing prices.
   * @deprecated Legacy tier hierarchy validation. Use price comparison.
   */
  validateUpgrade(current: SubscriptionHierarchy, target: SubscriptionHierarchy) {
    const hierarchy: SubscriptionHierarchy[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];
    const currentIndex = hierarchy.indexOf(current);
    const targetIndex = hierarchy.indexOf(target);
    if (targetIndex <= currentIndex) {
      return { allowed: false, reason: "Can only upgrade to a higher-tier plan" };
    }
    return { allowed: true };
  }

  /**
   * @deprecated Legacy tier hierarchy validation. Use price comparison.
   */
  validateDowngrade(
    current: SubscriptionHierarchy,
    target: SubscriptionHierarchy,
    currentProjectCount: number
  ) {
    const hierarchy: SubscriptionHierarchy[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];
    const currentIndex = hierarchy.indexOf(current);
    const targetIndex = hierarchy.indexOf(target);
    if (targetIndex >= currentIndex) {
      return { allowed: false, reason: "Can only downgrade to a lower-tier plan" };
    }
    const targetPlan = this.getSubscriptionPlan(target as unknown as SubscriptionTier);
    if (targetPlan.maxProjects !== -1 && currentProjectCount > targetPlan.maxProjects) {
      return {
        allowed: false,
        reason: `Cannot downgrade: You have ${currentProjectCount} projects but ${target} plan allows only ${targetPlan.maxProjects}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Map Account to SubscriptionInfo.
   * @deprecated Uses legacy Account.subscription field. Use getAccountPlan instead.
   */
  mapAccountToSubscriptionInfo(account: AccountWithProjects): AccountSubscriptionInfo {
    const defaultPlan = SUBSCRIPTION_PLANS.BASIC;
    const currentProjects = account.projects.length;
    const usage = this.calculateUsage(currentProjects, account.maxProjects);
    const trial = this.calculateTrialInfo(account);
    const billing = this.extractBillingInfo(account);

    return {
      id: account.id,
      email: account.email,
      name: account.name,
      subscription: "BASIC",
      maxProjects: account.maxProjects,
      currentProjects,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      plan: defaultPlan,
      usage,
      isActive: !trial.trialExpired,
      trial,
      billing,
    };
  }

  private async calculateStorageUsedGB(accountId: string): Promise<number> {
    const mediaCounts = await prisma.postMedia.groupBy({
      by: ["type"],
      where: { post: { project: { accountId } } },
      _count: { id: true },
    });
    const AVG_SIZE_MB: Record<string, number> = { image: 2, gif: 2, video: 20 };
    let totalMB = 0;
    for (const group of mediaCounts) {
      totalMB += group._count.id * (AVG_SIZE_MB[group.type] ?? 2);
    }
    return Math.round((totalMB / 1024) * 100) / 100;
  }

  private calculateUsage(currentProjects: number, maxProjects: number) {
    return {
      projectsUsed: currentProjects,
      projectsRemaining: Math.max(0, maxProjects - currentProjects),
      utilizationPercent: maxProjects > 0 ? Math.round((currentProjects / maxProjects) * 100) : 0,
    };
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

  private extractBillingInfo(account: PrismaAccount) {
    return {
      billingCycle: account.billingCycle,
      autoRenewal: account.autoRenewal,
      nextBillingDate: account.nextBillingDate,
      lastBillingDate: account.lastBillingDate,
      ...(account.stripeCustomerId && { stripeCustomerId: account.stripeCustomerId }),
      ...(account.stripeSubscriptionId && { stripeSubscriptionId: account.stripeSubscriptionId }),
    };
  }
}

export const subscriptionPlanService = new SubscriptionPlanService();
