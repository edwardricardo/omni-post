/**
 * Subscription Plan Service
 *
 * Manages subscription plan definitions, tier validation, and feature access
 * checks. Handles plan lookups, upgrade/downgrade eligibility, trial period
 * management, and enforces per-tier resource limits.
 *
 * @module billing/subscription/SubscriptionPlanService
 */

import { ok, type Result, type SubscriptionTier } from "@shared/types";
import type { Account as PrismaAccount } from "@infra/prisma";
import { prisma } from "@infra/prisma";
import { AuditableService } from "../../services/AuditableService";
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  type AccountSubscriptionInfo,
  type SubscriptionHierarchy,
  type TrialInfo,
} from "./types";

type AccountWithProjects = PrismaAccount & { projects: unknown[] };
export class SubscriptionPlanService extends AuditableService {
  constructor() {
    super("SubscriptionPlanService");
  }

  /**
   * Get subscription plan details
   */
  getSubscriptionPlan(tier: SubscriptionTier): SubscriptionPlan {
    return SUBSCRIPTION_PLANS[tier];
  }

  /**
   * Get all available subscription plans
   */
  getAllPlans(): SubscriptionPlan[] {
    return Object.values(SUBSCRIPTION_PLANS);
  }

  /**
   * Validate subscription limits
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
        return ok({
          allowed: true,
          limit: 0,
          current: 0,
          remaining: 0,
        });
    }
  }

  /**
   * Validate upgrade using tier hierarchy
   */
  validateUpgrade(current: SubscriptionHierarchy, target: SubscriptionHierarchy) {
    const hierarchy: SubscriptionHierarchy[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];
    const currentIndex = hierarchy.indexOf(current);
    const targetIndex = hierarchy.indexOf(target);

    if (targetIndex <= currentIndex) {
      return {
        allowed: false,
        reason: "Can only upgrade to a higher-tier plan",
      };
    }

    return { allowed: true };
  }

  /**
   * Validate downgrade using tier hierarchy
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
      return {
        allowed: false,
        reason: "Can only downgrade to a lower-tier plan",
      };
    }

    // Check if target plan can accommodate current projects
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
   * Map Account to SubscriptionInfo using centralized logic
   */
  mapAccountToSubscriptionInfo(account: AccountWithProjects): AccountSubscriptionInfo {
    const plan = this.getSubscriptionPlan(account.subscription);
    const currentProjects = account.projects.length;

    const usage = this.calculateUsage(currentProjects, account.maxProjects);
    const trial = this.calculateTrialInfo(account);
    const billing = this.extractBillingInfo(account);

    return {
      id: account.id,
      email: account.email,
      name: account.name,
      subscription: account.subscription,
      maxProjects: account.maxProjects,
      currentProjects,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      plan,
      usage,
      isActive: !trial.trialExpired,
      trial,
      billing,
    };
  }

  /**
   * Calculate estimated storage usage in GB for an account.
   *
   * PostMedia does not have a `size` column, so we estimate using average
   * file sizes per media type:
   *   - image: ~2 MB
   *   - gif:   ~2 MB
   *   - video: ~20 MB
   *
   * This is a heuristic. When a `size` column is added to PostMedia,
   * switch to `_sum: { size: true }` for an exact calculation.
   */
  private async calculateStorageUsedGB(accountId: string): Promise<number> {
    const mediaCounts = await prisma.postMedia.groupBy({
      by: ["type"],
      where: {
        post: { project: { accountId } },
      },
      _count: { id: true },
    });

    const AVG_SIZE_MB: Record<string, number> = {
      image: 2,
      gif: 2,
      video: 20,
    };

    let totalMB = 0;
    for (const group of mediaCounts) {
      const avgMB = AVG_SIZE_MB[group.type] ?? 2;
      totalMB += group._count.id * avgMB;
    }

    // Convert MB to GB with 2 decimal precision
    return Math.round((totalMB / 1024) * 100) / 100;
  }

  /**
   * Calculate usage statistics
   */
  private calculateUsage(currentProjects: number, maxProjects: number) {
    return {
      projectsUsed: currentProjects,
      projectsRemaining: Math.max(0, maxProjects - currentProjects),
      utilizationPercent: Math.round((currentProjects / maxProjects) * 100),
    };
  }

  /**
   * Calculate trial information
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

  /**
   * Extract billing information
   */
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
