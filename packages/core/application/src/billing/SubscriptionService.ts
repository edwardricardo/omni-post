/**
 * @file SubscriptionService.ts
 * @description Unified facade over the subscription plan, management, trial,
 *              statistics, and billing services. Receives each collaborator by
 *              constructor injection so the composition root owns their wiring.
 * @layer application
 */

import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { SubscriptionPlanService } from "./SubscriptionPlanService.js";
import type { SubscriptionManagementService } from "./SubscriptionManagementService.js";
import type { TrialManagementService } from "./TrialManagementService.js";
import type { SubscriptionStatsService } from "./SubscriptionStatsService.js";
import type { BillingService } from "./BillingService.js";
import type { AccountTrialResponse, SubscriptionStats, StartTrialRequest } from "./types.js";

/**
 * Combined Subscription Service — a unified interface to all subscription
 * functionality, delegating to the injected domain services.
 */
export class SubscriptionService {
  constructor(
    private readonly plans: SubscriptionPlanService,
    private readonly management: SubscriptionManagementService,
    private readonly trials: TrialManagementService,
    private readonly stats: SubscriptionStatsService,
    private readonly billing: BillingService
  ) {}

  // Plan operations
  async getAllPlansFromDB() {
    return this.plans.getAllPlansFromDB();
  }

  // Account subscription operations (provider-based)
  async getProviderSubscription(accountId: string) {
    return this.management.getProviderSubscription(accountId);
  }

  async listProviderSubscriptions(
    filters?: { status?: string; planType?: "bundle" | "custom"; search?: string },
    page?: number,
    limit?: number
  ) {
    return this.management.listProviderSubscriptions(filters, page, limit);
  }

  async validateSubscriptionLimits(
    accountId: string,
    operation: "CREATE_PROJECT" | "ADD_TEAM_MEMBER" | "UPLOAD_MEDIA",
    amount?: number
  ): Promise<
    Result<{ allowed: boolean; limit: number; current: number; remaining: number }, UseCaseError>
  > {
    return this.management.validateSubscriptionLimits(accountId, operation, amount);
  }

  async suspendSubscription(
    accountId: string,
    reason: string,
    suspendedByUserId?: string
  ): Promise<Result<void, UseCaseError>> {
    return this.management.suspendSubscription(accountId, reason, suspendedByUserId);
  }

  // Trial operations
  async startTrial(
    request: StartTrialRequest,
    startedByUserId?: string
  ): Promise<Result<AccountTrialResponse, UseCaseError>> {
    return this.trials.startTrial(request, startedByUserId);
  }

  async endTrial(
    accountId: string,
    reason: string,
    endedByUserId?: string
  ): Promise<Result<AccountTrialResponse, UseCaseError>> {
    return this.trials.endTrial(accountId, reason, endedByUserId);
  }

  async processAutoRenewals(triggeredByUserId?: string | null): Promise<
    Result<
      {
        processed: number;
        failed: number;
        details: Array<{ accountId: string; status: "success" | "failed"; error?: string }>;
      },
      UseCaseError
    >
  > {
    return this.trials.processAutoRenewals(triggeredByUserId);
  }

  async getExpiringTrials(
    daysBeforeExpiration?: number
  ): Promise<Result<AccountTrialResponse[], UseCaseError>> {
    return this.trials.getExpiringTrials(daysBeforeExpiration);
  }

  async convertTrialToPaid(
    accountId: string,
    billingCycle?: "monthly" | "yearly",
    convertedByUserId?: string
  ): Promise<Result<AccountTrialResponse, UseCaseError>> {
    return this.trials.convertTrialToPaid(accountId, billingCycle, convertedByUserId);
  }

  async getTrialStats(): Promise<{
    totalTrials: number;
    activeTrials: number;
    expiredTrials: number;
    convertedTrials: number;
    trialsStartedThisMonth: number;
    conversionRate: number;
    expiringIn24Hours: number;
  }> {
    return this.trials.getTrialStats();
  }

  // Statistics operations
  async getSubscriptionStats(): Promise<Result<SubscriptionStats, UseCaseError>> {
    return this.stats.getSubscriptionStats();
  }

  // Billing operations
  async logBillingEvent(event: Parameters<BillingService["logBillingEvent"]>[0]): Promise<void> {
    return this.billing.logBillingEvent(event);
  }
}
