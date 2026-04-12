/**
 * @file index.ts
 * @description Subscription module facade combining plan definitions, subscription
 *              management, billing events, trial handling, and analytics services.
 * @layer infrastructure
 */

// ---- Imports ----------------------------------------------------------------
import { prisma } from "@infra/prisma";
import type { Result, SubscriptionTier } from "@shared/types";
import { PrismaAccountQueryRepository } from "../../infrastructure/repositories/PrismaAccountQueryRepository.js";
import { subscriptionPlanService } from "./SubscriptionPlanService";
import { SubscriptionManagementService } from "./SubscriptionManagementService";
import { TrialManagementService } from "./TrialManagementService";
import { billingService } from "./BillingService";
import { subscriptionStatsService } from "./SubscriptionStatsService";
import type {
  SubscriptionPlan,
  AccountSubscriptionInfo,
  SubscriptionChangeRequest,
  SubscriptionStats,
  StartTrialRequest,
} from "./types";

// ---- Type + service re-exports ----------------------------------------------

// Export all types
export * from "./types";

// Export service classes (singletons are created below with injected deps)
export { SubscriptionPlanService, subscriptionPlanService } from "./SubscriptionPlanService";
export { SubscriptionManagementService } from "./SubscriptionManagementService";
export { TrialManagementService } from "./TrialManagementService";
export { BillingService, billingService } from "./BillingService";
export { SubscriptionStatsService, subscriptionStatsService } from "./SubscriptionStatsService";

// ---- Singleton creation (R1-B) ----------------------------------------------
// The prisma singleton is used here because billing/subscription/index.ts is a
// module-level factory that runs once at startup before the DI container is
// available. Services are later registered via:
//   container.registerInstance(TOKENS.SubscriptionService, subscriptionService)

const accountQueryRepo = new PrismaAccountQueryRepository(prisma);

export const subscriptionManagementService = new SubscriptionManagementService(accountQueryRepo);
export const trialManagementService = new TrialManagementService(accountQueryRepo);

// ---- Combined SubscriptionService facade ------------------------------------

/**
 * Combined Subscription Service
 * Provides a unified interface to all subscription functionality
 */
export class SubscriptionService {
  // Plan operations
  getSubscriptionPlan(tier: SubscriptionTier): SubscriptionPlan {
    return subscriptionPlanService.getSubscriptionPlan(tier);
  }

  getAllPlans(): SubscriptionPlan[] {
    return subscriptionPlanService.getAllPlans();
  }

  // Account subscription operations
  async getAccountSubscription(
    accountId: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "DATABASE_ERROR">> {
    return subscriptionManagementService.getAccountSubscription(accountId);
  }

  async updateSubscription(
    accountId: string,
    changeRequest: SubscriptionChangeRequest,
    updatedByUserId?: string
  ): Promise<
    Result<AccountSubscriptionInfo, "NOT_FOUND" | "INVALID_TIER" | "NO_CHANGE" | "DATABASE_ERROR">
  > {
    return subscriptionManagementService.updateSubscription(
      accountId,
      changeRequest,
      updatedByUserId
    );
  }

  async listAccountSubscriptions(
    filters?: {
      tier?: SubscriptionTier;
      status?: string;
      search?: string;
      sortBy?: "createdAt" | "updatedAt" | "email";
      sortOrder?: "asc" | "desc";
    },
    page?: number,
    limit?: number
  ): Promise<
    Result<
      { subscriptions: AccountSubscriptionInfo[]; total: number; page: number; limit: number },
      "DATABASE_ERROR"
    >
  > {
    return subscriptionManagementService.listAccountSubscriptions(filters, page, limit);
  }

  async validateSubscriptionLimits(
    accountId: string,
    operation: "CREATE_PROJECT" | "ADD_TEAM_MEMBER" | "UPLOAD_MEDIA",
    amount?: number
  ): Promise<
    Result<
      { allowed: boolean; limit: number; current: number; remaining: number },
      "NOT_FOUND" | "DATABASE_ERROR"
    >
  > {
    return subscriptionManagementService.validateSubscriptionLimits(accountId, operation, amount);
  }

  async suspendSubscription(
    accountId: string,
    reason: string,
    suspendedByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
    return subscriptionManagementService.suspendSubscription(accountId, reason, suspendedByUserId);
  }

  // Trial operations (delegated to TrialManagementService)
  async startTrial(
    request: StartTrialRequest,
    startedByUserId?: string
  ): Promise<
    Result<
      AccountSubscriptionInfo,
      "NOT_FOUND" | "ALREADY_ON_TRIAL" | "TRIAL_EXPIRED" | "DATABASE_ERROR"
    >
  > {
    return trialManagementService.startTrial(request, startedByUserId);
  }

  async endTrial(
    accountId: string,
    reason: string,
    endedByUserId?: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "NOT_ON_TRIAL" | "DATABASE_ERROR">> {
    return trialManagementService.endTrial(accountId, reason, endedByUserId);
  }

  async processAutoRenewals(): Promise<
    Result<
      {
        processed: number;
        failed: number;
        details: Array<{ accountId: string; status: "success" | "failed"; error?: string }>;
      },
      "DATABASE_ERROR"
    >
  > {
    return trialManagementService.processAutoRenewals();
  }

  async getExpiringTrials(
    daysBeforeExpiration?: number
  ): Promise<Result<AccountSubscriptionInfo[], "DATABASE_ERROR">> {
    return trialManagementService.getExpiringTrials(daysBeforeExpiration);
  }

  async convertTrialToPaid(
    accountId: string,
    billingCycle?: "monthly" | "yearly",
    convertedByUserId?: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "NOT_ON_TRIAL" | "DATABASE_ERROR">> {
    return trialManagementService.convertTrialToPaid(accountId, billingCycle, convertedByUserId);
  }

  // Statistics operations
  async getSubscriptionStats(): Promise<Result<SubscriptionStats, "DATABASE_ERROR">> {
    return subscriptionStatsService.getSubscriptionStats();
  }

  // Billing operations
  async logBillingEvent(
    event: Parameters<typeof billingService.logBillingEvent>[0]
  ): Promise<void> {
    return billingService.logBillingEvent(event);
  }
}

// Export singleton instance
export const subscriptionService = new SubscriptionService();
