/**
 * Subscription Service - Re-export Barrel
 *
 * This file is a backward-compatibility wrapper. All subscription logic has
 * been split into focused modules under `./subscription/`:
 *
 *   - types.ts                    — interfaces, SUBSCRIPTION_PLANS constant
 *   - SubscriptionPlanService.ts  — plan lookup, upgrade/downgrade validation
 *   - SubscriptionManagementService.ts — CRUD, list, limits, suspend
 *   - TrialManagementService.ts   — trial start/end/convert, auto-renewals
 *   - SubscriptionStatsService.ts — analytics and reporting
 *   - BillingService.ts           — billing events and payment helpers
 *   - index.ts                    — combined SubscriptionService facade + singleton
 *
 * Consumers importing from this file do NOT need to change their import paths.
 */

export {
  // Types
  type SubscriptionPlan,
  type AccountSubscriptionInfo,
  type SubscriptionChangeRequest,
  type SubscriptionStats,
  type BillingEvent,
  type TrialInfo,
  type StartTrialRequest,
  type SubscriptionHierarchy,
  type PrismaAccountWhereInput,
  type PrismaAccountOrderByInput,
  // Services
  SubscriptionPlanService,
  subscriptionPlanService,
  SubscriptionManagementService,
  subscriptionManagementService,
  TrialManagementService,
  trialManagementService,
  BillingService,
  billingService,
  SubscriptionStatsService,
  subscriptionStatsService,
  // Main facade (drop-in replacement for the monolithic class)
  SubscriptionService,
  subscriptionService,
} from "./subscription/index.js";
