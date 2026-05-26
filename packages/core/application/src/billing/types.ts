/**
 * @file types.ts
 * @description Type definitions for the billing and subscription module including stats,
 *              billing events, trial info, and trial response structures.
 * @layer infrastructure
 */

import type { SubscriptionTier } from "@shared/types";

export interface SubscriptionStats {
  totalSubscriptions: number;
  subscriptionsByTier: Record<SubscriptionTier, number>;
  totalRevenue: {
    monthly: number;
    yearly: number;
    total: number;
  };
  conversionRates: {
    basicToPro: number;
    proToEnterprise: number;
    overallUpgrade: number;
  };
  churnRisk: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
  };
  growthMetrics: {
    monthlyGrowthRate: number;
    newSubscriptionsThisMonth: number;
    cancelledSubscriptionsThisMonth: number;
  };
}

export interface BillingEvent {
  id: string;
  accountId: string;
  type:
    | "UPGRADE"
    | "DOWNGRADE"
    | "RENEWAL"
    | "CANCELLATION"
    | "SUSPENSION"
    | "REACTIVATION"
    | "TRIAL_START"
    | "TRIAL_END"
    | "AUTO_RENEWAL";
  fromTier?: SubscriptionTier;
  toTier?: SubscriptionTier;
  amount?: number;
  currency: string;
  reason?: string;
  processedBy?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TrialInfo {
  isOnTrial: boolean;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
  trialDaysRemaining: number;
  trialExpired: boolean;
}

/**
 * Response returned by trial lifecycle operations (start, end, convert, expiring).
 * Combines Account + AccountSubscription data without hardcoded plan constants.
 */
export interface AccountTrialResponse {
  id: string;
  email: string;
  name: string;
  maxProjects: number;
  currentProjects: number;
  createdAt: Date;
  updatedAt: Date;
  plan: {
    planType: "bundle" | "custom" | "none";
    bundleName: string | null;
    providers: string[];
    pricePerMonth: number;
    maxProjects: number;
    status: string;
    billingCycle: string;
  } | null;
  usage: {
    projectsUsed: number;
    projectsRemaining: number;
    utilizationPercent: number;
  };
  isActive: boolean;
  trial: TrialInfo;
  billing: {
    billingCycle: string;
    autoRenewal: boolean;
    nextBillingDate: Date | null;
    lastBillingDate: Date | null;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  };
}

export interface StartTrialRequest {
  accountId: string;
  tier?: SubscriptionTier;
  trialDurationDays?: number;
  autoRenewal?: boolean;
  billingCycle?: "monthly" | "yearly";
}
