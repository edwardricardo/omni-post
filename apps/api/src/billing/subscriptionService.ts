/**
 * @file subscriptionService.ts
 * @description Backward-compatibility barrel re-exporting all subscription types and
 *              services from the modularized subscription/ directory.
 * @layer infrastructure
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
