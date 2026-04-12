/**
 * @file types.ts
 * @description Type definitions for the billing and subscription module including plan
 *              structures, tier hierarchies, feature limits, and account subscription state.
 * @layer infrastructure
 */

import type { SubscriptionTier } from "@shared/types";

// Define Subscription type hierarchy
export type SubscriptionHierarchy = "FREE" | "STARTER" | "PRO" | "ENTERPRISE";

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxProjects: number;
  features: string[];
  limits: {
    postsPerMonth: number;
    mediaStorageGB: number;
    teamMembers: number;
    apiRequestsPerDay: number;
    analyticsRetentionDays: number;
  };
}

export interface AccountSubscriptionInfo {
  id: string;
  email: string;
  name: string;
  subscription: SubscriptionTier;
  maxProjects: number;
  currentProjects: number;
  createdAt: Date;
  updatedAt: Date;
  plan: SubscriptionPlan;
  usage: {
    projectsUsed: number;
    projectsRemaining: number;
    utilizationPercent: number;
  };
  isActive: boolean;
  daysRemaining?: number;
  trial: {
    isOnTrial: boolean;
    trialStartDate: Date | null;
    trialEndDate: Date | null;
    trialDaysRemaining: number;
    trialExpired: boolean;
  };
  billing: {
    billingCycle: string;
    autoRenewal: boolean;
    nextBillingDate: Date | null;
    lastBillingDate: Date | null;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  };
}

export interface SubscriptionChangeRequest {
  newTier: SubscriptionTier;
  billingCycle: "monthly" | "yearly";
  effectiveDate?: Date;
  reason?: string;
}

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

export interface StartTrialRequest {
  accountId: string;
  tier?: SubscriptionTier;
  trialDurationDays?: number;
  autoRenewal?: boolean;
  billingCycle?: "monthly" | "yearly";
}

// Subscription plan definitions
export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, SubscriptionPlan> = {
  BASIC: {
    tier: "BASIC",
    name: "Basic Plan",
    description: "Perfect for individuals and small projects",
    monthlyPrice: 9.99,
    yearlyPrice: 99.99,
    maxProjects: 1,
    features: [
      "Up to 1 project",
      "100 posts per month",
      "1GB media storage",
      "2 social accounts",
      "Basic analytics",
      "Email support",
    ],
    limits: {
      postsPerMonth: 100,
      mediaStorageGB: 1,
      teamMembers: 1,
      apiRequestsPerDay: 1000,
      analyticsRetentionDays: 30,
    },
  },
  PRO: {
    tier: "PRO",
    name: "Pro Plan",
    description: "Great for growing businesses and teams",
    monthlyPrice: 29.99,
    yearlyPrice: 299.99,
    maxProjects: 5,
    features: [
      "Up to 5 projects",
      "1,000 posts per month",
      "10GB media storage",
      "10 social accounts",
      "Advanced analytics",
      "Team collaboration",
      "Priority support",
    ],
    limits: {
      postsPerMonth: 1000,
      mediaStorageGB: 10,
      teamMembers: 5,
      apiRequestsPerDay: 10000,
      analyticsRetentionDays: 90,
    },
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    name: "Enterprise Plan",
    description: "For large organizations with advanced needs",
    monthlyPrice: 99.99,
    yearlyPrice: 999.99,
    maxProjects: 50,
    features: [
      "Up to 50 projects",
      "Unlimited posts",
      "100GB media storage",
      "Unlimited social accounts",
      "Advanced analytics & reporting",
      "White-label options",
      "Custom integrations",
      "Dedicated account manager",
      "24/7 phone support",
    ],
    limits: {
      postsPerMonth: -1, // Unlimited
      mediaStorageGB: 100,
      teamMembers: 25,
      apiRequestsPerDay: 100000,
      analyticsRetentionDays: 365,
    },
  },
};

// Prisma types for proper type safety
export interface PrismaAccountWhereInput {
  subscription?: SubscriptionTier;
  OR?: Array<{
    email?: { contains: string; mode: "insensitive" };
    name?: { contains: string; mode: "insensitive" };
  }>;
  isOnTrial?: boolean;
  autoRenewal?: boolean;
  trialEndDate?: {
    lte?: Date;
    gte?: Date;
  };
  createdAt?: {
    gte?: Date;
  };
}

export interface PrismaAccountOrderByInput {
  createdAt?: "asc" | "desc";
  updatedAt?: "asc" | "desc";
  email?: "asc" | "desc";
  subscription?: "asc" | "desc";
}
