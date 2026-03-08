/**
 * Trial Management Service
 *
 * Handles all trial lifecycle operations including starting trials, ending trials,
 * converting trials to paid subscriptions, and querying expiring trials. Extends
 * AuditableService to ensure all trial changes are logged for compliance
 * and billing audit trails.
 *
 * Extracted from SubscriptionManagementService as part of H8 large file splitting.
 *
 * R1-B: Migrated from legacy AccountRepository singleton to AccountQueryRepositoryPort
 * injected via DI container.
 *
 * @module billing/subscription/TrialManagementService
 */
import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("billing");
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";
import { AuditableService } from "../../services/AuditableService";
import { subscriptionPlanService } from "./SubscriptionPlanService";
import { billingService } from "./BillingService";
import { SUBSCRIPTION_PLANS, type AccountSubscriptionInfo, type StartTrialRequest } from "./types";

/**
 * Service responsible for trial period management operations:
 * start trial, end trial, convert trial to paid, expiring trials
 */
export class TrialManagementService extends AuditableService {
  constructor(private readonly accountQueryRepo: AccountQueryRepositoryPort) {
    super("TrialManagementService");
  }

  /**
   * Get account subscription information.
   * Used internally after trial mutations to return updated subscription info.
   */
  private async getAccountSubscription(
    accountId: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "DATABASE_ERROR">> {
    const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

    if (!accountResult.ok) {
      return err("NOT_FOUND");
    }

    const account = accountResult.value;
    const subscriptionInfo = subscriptionPlanService.mapAccountToSubscriptionInfo(account);

    return ok(subscriptionInfo);
  }

  /**
   * Start trial period for an account
   */
  async startTrial(
    request: StartTrialRequest,
    startedByUserId?: string
  ): Promise<
    Result<
      AccountSubscriptionInfo,
      "NOT_FOUND" | "ALREADY_ON_TRIAL" | "TRIAL_EXPIRED" | "DATABASE_ERROR"
    >
  > {
    const startTime = Date.now();
    try {
      const {
        accountId,
        tier = "PRO",
        trialDurationDays = 7,
        autoRenewal = false,
        billingCycle = "monthly",
      } = request;

      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      // Calculate trial info
      const trialInfo = subscriptionPlanService.calculateTrialInfo(account);

      // Check if account is already on trial or trial has expired
      if (trialInfo.isOnTrial) {
        return err("ALREADY_ON_TRIAL");
      }

      const now = new Date();
      const trialEndDate = new Date(now.getTime() + trialDurationDays * 24 * 60 * 60 * 1000);
      const nextBillingDate = billingService.calculateNextBillingDate(billingCycle, trialEndDate);

      await prisma.account.update({
        where: { id: accountId },
        data: {
          isOnTrial: true,
          trialStartDate: now,
          trialEndDate,
          subscription: tier,
          maxProjects: SUBSCRIPTION_PLANS[tier].maxProjects,
          autoRenewal,
          billingCycle,
          ...(autoRenewal && { nextBillingDate }),
          updatedAt: now,
        },
        include: {
          projects: true,
        },
      });

      // Log account action for audit trail
      if (startedByUserId) {
        await this.logAccountAction(startedByUserId, {
          accountId,
          action: "TRIAL_START",
          category: "BILLING",
          severity: "MEDIUM",
          details: {
            email: account.email,
            tier,
            trialDurationDays,
            trialEndDate: trialEndDate.toISOString(),
            autoRenewal,
            billingCycle,
          },
        });
      }

      // Log billing event
      await billingService.logBillingEvent({
        accountId,
        type: "TRIAL_START",
        toTier: tier,
        currency: "USD",
        reason: `${trialDurationDays}-day trial started`,
        ...(startedByUserId && { processedBy: startedByUserId }),
        metadata: {
          trialDurationDays,
          trialEndDate: trialEndDate.toISOString(),
          autoRenewal,
          billingCycle,
        },
      });

      return this.getAccountSubscription(accountId);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "startTrial",
        accountId: request.accountId,
        ...(startedByUserId !== undefined && { userId: startedByUserId }),
      });
      this.logError(
        {
          serviceName: this.serviceName,
          operation: "startTrial",
          accountId: request.accountId,
          ...(startedByUserId !== undefined && { userId: startedByUserId }),
        },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * End trial period for an account
   */
  async endTrial(
    accountId: string,
    reason: string,
    endedByUserId?: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "NOT_ON_TRIAL" | "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      if (!account.isOnTrial) {
        return err("NOT_ON_TRIAL");
      }

      await prisma.account.update({
        where: { id: accountId },
        data: {
          isOnTrial: false,
          trialEndDate: new Date(),
          subscription: "BASIC", // Downgrade to basic after trial
          maxProjects: SUBSCRIPTION_PLANS.BASIC.maxProjects,
          autoRenewal: false,
          nextBillingDate: null,
          updatedAt: new Date(),
        },
        include: {
          projects: true,
        },
      });

      // Log account action for audit trail
      if (endedByUserId) {
        await this.logAccountAction(endedByUserId, {
          accountId,
          action: "TRIAL_END",
          category: "BILLING",
          severity: "MEDIUM",
          details: {
            email: account.email,
            fromTier: account.subscription,
            toTier: "BASIC",
            reason,
          },
        });
      }

      // Log billing event
      await billingService.logBillingEvent({
        accountId,
        type: "TRIAL_END",
        fromTier: account.subscription,
        toTier: "BASIC",
        currency: "USD",
        reason,
        ...(endedByUserId && { processedBy: endedByUserId }),
      });

      return this.getAccountSubscription(accountId);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "endTrial",
        accountId,
        ...(endedByUserId !== undefined && { userId: endedByUserId }),
      });
      this.logError(
        {
          serviceName: this.serviceName,
          operation: "endTrial",
          accountId,
          ...(endedByUserId !== undefined && { userId: endedByUserId }),
        },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get accounts with expiring trials (for notifications)
   */
  async getExpiringTrials(
    daysBeforeExpiration = 1
  ): Promise<Result<AccountSubscriptionInfo[], "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysBeforeExpiration);

      const accounts = await prisma.account.findMany({
        where: {
          isOnTrial: true,
          trialEndDate: {
            gte: new Date(),
            lte: targetDate,
          },
        },
        include: {
          projects: true,
        },
        orderBy: {
          trialEndDate: "asc",
        },
      });

      // Map accounts to subscription info
      const accountInfos = accounts
        .map((account) => subscriptionPlanService.mapAccountToSubscriptionInfo(account))
        .filter(Boolean);

      return ok(accountInfos);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "getExpiringTrials",
      });
      this.logError(
        { serviceName: this.serviceName, operation: "getExpiringTrials" },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Convert trial to paid subscription
   */
  async convertTrialToPaid(
    accountId: string,
    billingCycle: "monthly" | "yearly" = "monthly",
    convertedByUserId?: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "NOT_ON_TRIAL" | "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      if (!account.isOnTrial) {
        return err("NOT_ON_TRIAL");
      }

      const plan = subscriptionPlanService.getSubscriptionPlan(account.subscription);
      const amount = billingService.calculateBillingAmount(
        plan.monthlyPrice,
        plan.yearlyPrice,
        billingCycle
      );
      const now = new Date();
      const nextBilling = billingService.calculateNextBillingDate(billingCycle, now);

      await prisma.account.update({
        where: { id: accountId },
        data: {
          isOnTrial: false,
          billingCycle,
          autoRenewal: true,
          lastBillingDate: now,
          nextBillingDate: nextBilling,
          updatedAt: now,
        },
        include: {
          projects: true,
        },
      });

      // Log account action for audit trail
      if (convertedByUserId) {
        await this.logAccountAction(convertedByUserId, {
          accountId,
          action: "TRIAL_CONVERT",
          category: "BILLING",
          severity: "HIGH",
          details: {
            email: account.email,
            tier: account.subscription,
            billingCycle,
            amount,
            nextBillingDate: nextBilling.toISOString(),
          },
        });
      }

      // Log billing event
      await billingService.logBillingEvent({
        accountId,
        type: "UPGRADE",
        toTier: account.subscription,
        amount,
        currency: "USD",
        reason: "Trial converted to paid subscription",
        ...(convertedByUserId && { processedBy: convertedByUserId }),
        metadata: {
          billingCycle,
          nextBillingDate: nextBilling.toISOString(),
          convertedFromTrial: true,
        },
      });

      return this.getAccountSubscription(accountId);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "convertTrialToPaid",
        accountId,
        ...(convertedByUserId !== undefined && { userId: convertedByUserId }),
      });
      this.logError(
        {
          serviceName: this.serviceName,
          operation: "convertTrialToPaid",
          accountId,
          ...(convertedByUserId !== undefined && { userId: convertedByUserId }),
        },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Process auto-renewals for accounts with expired trials
   */
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
    const startTime = Date.now();
    try {
      const now = new Date();

      // Find accounts with expired trials and auto-renewal enabled
      const expiredTrialAccounts = await prisma.account.findMany({
        where: {
          isOnTrial: true,
          autoRenewal: true,
          trialEndDate: {
            lte: now,
          },
        },
        include: {
          projects: true,
        },
      });

      const results = await Promise.allSettled(
        expiredTrialAccounts.map(async (account) => {
          try {
            const plan = SUBSCRIPTION_PLANS[account.subscription];
            const amount = billingService.calculateBillingAmount(
              plan.monthlyPrice,
              plan.yearlyPrice,
              account.billingCycle as "monthly" | "yearly"
            );

            const nextBilling = billingService.calculateNextBillingDate(
              account.billingCycle as "monthly" | "yearly",
              now
            );

            await prisma.account.update({
              where: { id: account.id },
              data: {
                isOnTrial: false,
                lastBillingDate: now,
                nextBillingDate: nextBilling,
                updatedAt: now,
              },
            });

            // Log account action for audit trail (system action, no userId)
            await this.logAccountAction("system", {
              accountId: account.id,
              action: "AUTO_RENEWAL",
              category: "BILLING",
              severity: "MEDIUM",
              details: {
                email: account.email,
                tier: account.subscription,
                amount,
                billingCycle: account.billingCycle,
                nextBillingDate: nextBilling.toISOString(),
              },
            });

            // Log billing event
            await billingService.logBillingEvent({
              accountId: account.id,
              type: "AUTO_RENEWAL",
              toTier: account.subscription,
              amount,
              currency: "USD",
              reason: "Automatic renewal after trial period",
              metadata: {
                billingCycle: account.billingCycle,
                nextBillingDate: nextBilling.toISOString(),
                previousTrialEndDate: account.trialEndDate?.toISOString(),
              },
            });

            return { accountId: account.id, status: "success" as const };
          } catch (_error: unknown) {
            log.error({ err: _error, accountId: account.id }, "Auto-renewal failed for account");
            return {
              accountId: account.id,
              status: "failed" as const,
              error: _error instanceof Error ? _error.message : "Unknown error",
            };
          }
        })
      );

      const details = results.map((result) =>
        result.status === "fulfilled"
          ? result.value
          : { accountId: "unknown", status: "failed" as const, error: "Promise rejected" }
      );

      const processed = details.filter((d) => d.status === "success").length;
      const failed = details.filter((d) => d.status === "failed").length;

      return ok({
        processed,
        failed,
        details,
      });
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "processAutoRenewals",
      });
      this.logError(
        { serviceName: this.serviceName, operation: "processAutoRenewals" },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }
}
