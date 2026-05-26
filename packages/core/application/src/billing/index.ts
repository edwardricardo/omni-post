/**
 * @file index.ts
 * @description Per-context barrel for billing/subscription. Exposes the 6
 *   subscription services (facade + plan + management + stats + billing +
 *   trial) plus the 3 use-cases that already lived here, plus the shared
 *   types module.
 * @layer application
 */

export { SubscriptionService } from "./SubscriptionService.js";
export { SubscriptionPlanService, type TrialAccountView } from "./SubscriptionPlanService.js";
export { SubscriptionManagementService } from "./SubscriptionManagementService.js";
export { SubscriptionStatsService } from "./SubscriptionStatsService.js";
export { BillingService, type ChangeType } from "./BillingService.js";
export { TrialManagementService } from "./TrialManagementService.js";
export * from "./types.js";

// Existing use-cases already in this folder (kept by reference; barrel
// surfaces them alongside the services).
export { CreateAccountSubscriptionUseCase } from "./CreateAccountSubscriptionUseCase.js";
export { ChangeAccountSubscriptionUseCase } from "./ChangeAccountSubscriptionUseCase.js";
export { UpdatePricingConfigUseCase } from "./UpdatePricingConfigUseCase.js";
