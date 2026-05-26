/**
 * @file index.ts
 * @description Subscription module barrel: re-exports the subscription types,
 *              service classes, and the SubscriptionService facade. Construction
 *              is owned by the DI composition root (setupServices).
 * @layer infrastructure
 */

export * from "./types";

export { SubscriptionPlanService } from "./SubscriptionPlanService.js";
export { SubscriptionManagementService } from "./SubscriptionManagementService.js";
export { TrialManagementService } from "./TrialManagementService.js";
export { BillingService } from "./BillingService.js";
export { SubscriptionStatsService } from "./SubscriptionStatsService.js";
export { SubscriptionService } from "./SubscriptionService.js";
