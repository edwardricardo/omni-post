/**
 * @file subscriptionService.ts
 * @description Backward-compatibility barrel re-exporting subscription types and
 *              service classes from the modularized subscription/ directory.
 *              Service instances are resolved from the DI container.
 * @layer infrastructure
 */

export {
  // Types
  type AccountTrialResponse,
  type SubscriptionStats,
  type BillingEvent,
  type TrialInfo,
  type StartTrialRequest,
  // Service classes
  SubscriptionPlanService,
  SubscriptionManagementService,
  TrialManagementService,
  BillingService,
  SubscriptionStatsService,
  // Main facade
  SubscriptionService,
} from "./subscription/index.js";
