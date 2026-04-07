/**
 * Phase 3.4: Backend Service Consolidation - Account Mapper
 *
 * Provides consistent account data transformation patterns.
 * Eliminates 575-920 lines of duplicate mapping logic in subscriptionService.ts
 *
 * Features:
 * - Account → SubscriptionInfo mapping
 * - Trial calculation logic
 * - Usage statistics
 * - Billing information
 * - Plan details
 */

import type { Account, Project } from "@infra/prisma";

export interface SubscriptionPlan {
  name: string;
  displayName: string;
  maxProjects: number;
  features: string[];
  price?: {
    monthly: number;
    yearly: number;
  };
}

export interface TrialInfo {
  isOnTrial: boolean;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
  trialDaysRemaining: number;
  trialExpired: boolean;
}

export interface UsageInfo {
  projectsUsed: number;
  projectsRemaining: number;
  utilizationPercent: number;
}

export interface BillingInfo {
  billingCycle: string; // "monthly" or "yearly"
  autoRenewal: boolean;
  nextBillingDate: Date | null;
  lastBillingDate: Date | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface SubscriptionInfo {
  id: string;
  email: string;
  name: string | null;
  maxProjects: number;
  currentProjects: number;
  createdAt: Date;
  updatedAt: Date;
  usage: UsageInfo;
  isActive: boolean;
  trial: TrialInfo;
  billing: BillingInfo;
}

export interface AccountProfile {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  isActive: boolean;
}

/**
 * Account Mapper - Centralized account data transformation
 * Eliminates duplicate mapping logic across subscription service
 */
export class AccountMapper {
  /**
   * Map Account model to SubscriptionInfo response
   * Consolidates 25-40 lines of duplicate code found in 23 instances
   *
   * @example
   * const info = AccountMapper.toSubscriptionInfo(account);
   * return ok(info);
   */
  static toSubscriptionInfo(account: Account & { projects: Project[] }): SubscriptionInfo {
    const currentProjects = account.projects.length;
    const usage = this.calculateUsage(currentProjects, account.maxProjects);
    const trial = this.calculateTrialInfo(account);
    const billing = this.extractBillingInfo(account);

    return {
      id: account.id,
      email: account.email,
      name: account.name,
      maxProjects: account.maxProjects,
      currentProjects,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      usage,
      isActive: !trial.trialExpired,
      trial,
      billing,
    };
  }

  /**
   * Map Account to simple profile
   */
  static toProfile(account: Account): AccountProfile {
    const trial = this.calculateTrialInfo(account);

    return {
      id: account.id,
      email: account.email,
      name: account.name,
      createdAt: account.createdAt,
      isActive: !trial.trialExpired,
    };
  }

  /**
   * Calculate trial information
   * Consolidates trial calculation logic
   */
  static calculateTrialInfo(account: Account): TrialInfo {
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
   * Calculate usage statistics
   */
  static calculateUsage(currentProjects: number, maxProjects: number): UsageInfo {
    const projectsRemaining = Math.max(0, maxProjects - currentProjects);
    const utilizationPercent = Math.round((currentProjects / maxProjects) * 100);

    return {
      projectsUsed: currentProjects,
      projectsRemaining,
      utilizationPercent,
    };
  }

  /**
   * Extract billing information
   */
  static extractBillingInfo(account: Account): BillingInfo {
    return {
      billingCycle: account.billingCycle,
      autoRenewal: account.autoRenewal,
      nextBillingDate: account.nextBillingDate,
      lastBillingDate: account.lastBillingDate,
      ...(account.stripeCustomerId && { stripeCustomerId: account.stripeCustomerId }),
      ...(account.stripeSubscriptionId && {
        stripeSubscriptionId: account.stripeSubscriptionId,
      }),
    };
  }

  /**
   * Check if account can create more projects
   */
  static canCreateProject(
    account: Account,
    currentProjectCount: number
  ): {
    allowed: boolean;
    reason?: string;
  } {
    // Check trial status
    const trial = this.calculateTrialInfo(account);
    if (trial.trialExpired) {
      return {
        allowed: false,
        reason: "Trial has expired. Please upgrade to continue.",
      };
    }

    // Check project limit (-1 means unlimited)
    if (account.maxProjects !== -1 && currentProjectCount >= account.maxProjects) {
      return {
        allowed: false,
        reason: `Project limit reached (${account.maxProjects}). Please upgrade your plan.`,
      };
    }

    return { allowed: true };
  }
}
