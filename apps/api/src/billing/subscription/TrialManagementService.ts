/**
 * @file TrialManagementService.ts
 * @description Service managing trial lifecycle operations: start, end, convert to paid,
 *              and expiring trial queries. Emits audit logs via the `emitAudit` composition
 *              helper; no longer inherits from AuditableService.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("billing");
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { AccountSubscriptionQueryRepository } from "@core/domain/repositories/AccountSubscriptionQueryRepository.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { Account } from "@core/domain/entities/Account.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { emitAudit, logServiceError } from "../../services/audit.js";
import type { SubscriptionPlanService } from "./SubscriptionPlanService";
import type { BillingService } from "./BillingService";
import { type AccountTrialResponse, type StartTrialRequest } from "./types";

/**
 * Service responsible for trial period management operations:
 * start trial, end trial, convert trial to paid, expiring trials
 */
export class TrialManagementService {
  constructor(
    private readonly accountRepository: AccountRepositoryPort,
    private readonly accountQueryRepo: AccountQueryRepositoryPort,
    private readonly subscriptionQueryRepo: AccountSubscriptionQueryRepository,
    private readonly subscriptionPlanService: SubscriptionPlanService,
    private readonly billingService: BillingService,
    private readonly auditLog: AuditLogRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * Load the Account aggregate by its string id.
   */
  private async loadAccount(accountId: string): Promise<Result<Account, "NOT_FOUND">> {
    const result = await this.accountRepository.findById(AccountId.fromStringUnsafe(accountId));
    if (!result.ok) return err("NOT_FOUND");
    return ok(result.value);
  }

  /**
   * Persist the Account aggregate, joining the active Unit of Work transaction
   * when one is configured.
   */
  private async persistAccount(account: Account): Promise<void> {
    const doSave = async (): Promise<void> => {
      const saved = await this.accountRepository.save(account);
      if (!saved.ok) throw saved.error;
    };
    if (this.unitOfWork) {
      await this.unitOfWork.executeInTransaction(doSave);
    } else {
      await doSave();
    }
  }

  /**
   * @method buildTrialResponse
   * @description Builds an AccountTrialResponse from Account + AccountSubscription data.
   * @param accountId - The account ID to look up
   * @returns Result with trial response on success, or NOT_FOUND/DATABASE_ERROR on failure
   */
  private async buildTrialResponse(
    accountId: string
  ): Promise<Result<AccountTrialResponse, "NOT_FOUND" | "DATABASE_ERROR">> {
    const accountResult = await this.accountQueryRepo.findWithProjects(accountId);
    if (!accountResult.ok) return err("NOT_FOUND");

    const account = accountResult.value;
    const subscription = await this.subscriptionQueryRepo.getDetailByAccountId(accountId);

    const trial = this.subscriptionPlanService.calculateTrialInfo(account);
    const currentProjects = account.projects.length;

    return ok({
      id: account.id,
      email: account.email,
      name: account.name,
      maxProjects: account.maxProjects,
      currentProjects,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      plan: subscription
        ? {
            planType: subscription.bundleId
              ? ("bundle" as const)
              : subscription.providers.length > 0
                ? ("custom" as const)
                : ("none" as const),
            bundleName: subscription.bundle?.name ?? null,
            providers: subscription.providers,
            pricePerMonth: subscription.pricePerMonth,
            maxProjects: subscription.maxProjects,
            status: subscription.status,
            billingCycle: subscription.billingCycle,
          }
        : null,
      usage: {
        projectsUsed: currentProjects,
        projectsRemaining: Math.max(0, account.maxProjects - currentProjects),
        utilizationPercent:
          account.maxProjects > 0 ? Math.round((currentProjects / account.maxProjects) * 100) : 0,
      },
      isActive: !trial.trialExpired,
      trial,
      billing: {
        billingCycle: account.billingCycle,
        autoRenewal: account.autoRenewal,
        nextBillingDate: account.nextBillingDate,
        lastBillingDate: account.lastBillingDate,
        ...(account.stripeCustomerId && { stripeCustomerId: account.stripeCustomerId }),
        ...(account.stripeSubscriptionId && {
          stripeSubscriptionId: account.stripeSubscriptionId,
        }),
      },
    });
  }

  /**
   * @method getTrialStatusFromSubscription
   * @description Reads trial status from the new AccountSubscription model.
   *   This is an additive method — legacy Account-based trial fields remain
   *   untouched until the billing migration completes.
   * @param accountId - The account ID to check
   * @returns Trial status object or null if no subscription exists
   */
  async getTrialStatusFromSubscription(accountId: string): Promise<{
    isTrialing: boolean;
    trialEndsAt: Date | null;
    daysRemaining: number;
    status: string;
  } | null> {
    return this.subscriptionQueryRepo.getTrialStatusByAccountId(accountId);
  }

  /**
   * Start trial period for an account
   */
  async startTrial(
    request: StartTrialRequest,
    startedByUserId?: string
  ): Promise<
    Result<
      AccountTrialResponse,
      "NOT_FOUND" | "ALREADY_ON_TRIAL" | "TRIAL_EXPIRED" | "DATABASE_ERROR"
    >
  > {
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
      const trialInfo = this.subscriptionPlanService.calculateTrialInfo(account);

      // Check if account is already on trial or trial has expired
      if (trialInfo.isOnTrial) {
        return err("ALREADY_ON_TRIAL");
      }

      const now = new Date();
      const trialEndDate = new Date(now.getTime() + trialDurationDays * 24 * 60 * 60 * 1000);
      const nextBillingDate = this.billingService.calculateNextBillingDate(
        billingCycle,
        trialEndDate
      );

      const accountAggregate = await this.loadAccount(accountId);
      if (!accountAggregate.ok) return err("NOT_FOUND");
      accountAggregate.value.startTrial({
        trialDurationDays,
        autoRenewal,
        billingCycle,
        nextBillingDate,
      });
      await this.persistAccount(accountAggregate.value);

      // Log account action for audit trail
      if (startedByUserId) {
        await emitAudit(this.auditLog, {
          action: "TRIAL_START",
          category: "BILLING",
          severity: "MEDIUM",
          userId: startedByUserId,
          accountId,
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
      await this.billingService.logBillingEvent({
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

      return this.buildTrialResponse(accountId);
    } catch (error) {
      logServiceError("startTrial", error, {
        accountId: request.accountId,
        ...(startedByUserId !== undefined && { userId: startedByUserId }),
      });
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
  ): Promise<Result<AccountTrialResponse, "NOT_FOUND" | "NOT_ON_TRIAL" | "DATABASE_ERROR">> {
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      if (!account.isOnTrial) {
        return err("NOT_ON_TRIAL");
      }

      const accountAggregate = await this.loadAccount(accountId);
      if (!accountAggregate.ok) return err("NOT_FOUND");
      accountAggregate.value.endTrial();
      await this.persistAccount(accountAggregate.value);

      // Log account action for audit trail
      if (endedByUserId) {
        await emitAudit(this.auditLog, {
          action: "TRIAL_END",
          category: "BILLING",
          severity: "MEDIUM",
          userId: endedByUserId,
          accountId,
          details: {
            email: account.email,
            reason,
          },
        });
      }

      // Log billing event
      await this.billingService.logBillingEvent({
        accountId,
        type: "TRIAL_END",
        currency: "USD",
        reason,
        ...(endedByUserId && { processedBy: endedByUserId }),
      });

      return this.buildTrialResponse(accountId);
    } catch (error) {
      logServiceError("endTrial", error, {
        accountId,
        ...(endedByUserId !== undefined && { userId: endedByUserId }),
      });
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get accounts with expiring trials (for notifications)
   */
  async getExpiringTrials(
    daysBeforeExpiration = 1
  ): Promise<Result<AccountTrialResponse[], "DATABASE_ERROR">> {
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysBeforeExpiration);

      const accounts = await this.accountQueryRepo.findExpiringTrials(new Date(), targetDate);

      const accountInfos: AccountTrialResponse[] = [];
      for (const account of accounts) {
        const result = await this.buildTrialResponse(account.id);
        if (result.ok) {
          accountInfos.push(result.value);
        }
      }

      return ok(accountInfos);
    } catch (error) {
      logServiceError("getExpiringTrials", error);
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
  ): Promise<Result<AccountTrialResponse, "NOT_FOUND" | "NOT_ON_TRIAL" | "DATABASE_ERROR">> {
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      if (!account.isOnTrial) {
        return err("NOT_ON_TRIAL");
      }

      // Look up plan from AccountSubscription model
      const accountPlan = await this.subscriptionPlanService.getAccountPlan(accountId);
      const pricePerMonth = accountPlan ? accountPlan.pricePerMonth : 0;
      const amount = pricePerMonth * (billingCycle === "yearly" ? 12 : 1);
      const now = new Date();
      const nextBilling = this.billingService.calculateNextBillingDate(billingCycle, now);

      const accountAggregate = await this.loadAccount(accountId);
      if (!accountAggregate.ok) return err("NOT_FOUND");
      accountAggregate.value.convertTrialToPaid({
        billingCycle,
        lastBillingDate: now,
        nextBillingDate: nextBilling,
      });
      await this.persistAccount(accountAggregate.value);

      // Log account action for audit trail
      if (convertedByUserId) {
        await emitAudit(this.auditLog, {
          action: "TRIAL_CONVERT",
          category: "BILLING",
          severity: "HIGH",
          userId: convertedByUserId,
          accountId,
          details: {
            email: account.email,
            billingCycle,
            amount,
            nextBillingDate: nextBilling.toISOString(),
          },
        });
      }

      // Log billing event
      await this.billingService.logBillingEvent({
        accountId,
        type: "UPGRADE",
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

      return this.buildTrialResponse(accountId);
    } catch (error) {
      logServiceError("convertTrialToPaid", error, {
        accountId,
        ...(convertedByUserId !== undefined && { userId: convertedByUserId }),
      });
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Process auto-renewals for accounts with expired trials
   */
  async processAutoRenewals(triggeredByUserId?: string | null): Promise<
    Result<
      {
        processed: number;
        failed: number;
        details: Array<{ accountId: string; status: "success" | "failed"; error?: string }>;
      },
      "DATABASE_ERROR"
    >
  > {
    try {
      const now = new Date();

      // Find accounts with expired trials and auto-renewal enabled
      const expiredTrialAccounts = await this.accountQueryRepo.findAutoRenewableExpired(now);

      const results = await Promise.allSettled(
        expiredTrialAccounts.map(async (account) => {
          try {
            // Look up plan from AccountSubscription model
            const accountPlan = await this.subscriptionPlanService.getAccountPlan(account.id);
            const pricePerMonth = accountPlan ? accountPlan.pricePerMonth : 0;
            const cycle = account.billingCycle as "monthly" | "yearly";
            const amount = pricePerMonth * (cycle === "yearly" ? 12 : 1);

            const nextBilling = this.billingService.calculateNextBillingDate(cycle, now);

            const accountAggregate = await this.loadAccount(account.id);
            if (!accountAggregate.ok) {
              throw new Error(`Account not found: ${account.id}`);
            }
            accountAggregate.value.recordRenewal({
              lastBillingDate: now,
              nextBillingDate: nextBilling,
            });
            await this.persistAccount(accountAggregate.value);

            // Log account action for audit trail (system action, no userId)
            await emitAudit(this.auditLog, {
              action: "AUTO_RENEWAL",
              category: "BILLING",
              severity: "MEDIUM",
              accountId: account.id,
              details: {
                email: account.email,
                amount,
                billingCycle: account.billingCycle,
                nextBillingDate: nextBilling.toISOString(),
                previousTrialEndDate: account.trialEndDate?.toISOString(),
              },
            });

            // Log billing event
            await this.billingService.logBillingEvent({
              accountId: account.id,
              type: "AUTO_RENEWAL",
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

      await this.auditLog.create({
        action: "AUTO_RENEWAL_BATCH",
        resource: "Billing",
        ...(triggeredByUserId != null && { userId: triggeredByUserId }),
        details: { processed, failed, details, triggeredManually: true },
        success: failed === 0,
        ...(failed > 0 && { error: `${failed} account(s) failed to renew` }),
      });

      return ok({
        processed,
        failed,
        details,
      });
    } catch (error) {
      logServiceError("processAutoRenewals", error);
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Aggregate trial statistics for the admin dashboard: counts of total, active,
   * expired, converted, and started-this-month trials, plus the conversion rate.
   */
  async getTrialStats(): Promise<{
    totalTrials: number;
    activeTrials: number;
    expiredTrials: number;
    convertedTrials: number;
    trialsStartedThisMonth: number;
    conversionRate: number;
    expiringIn24Hours: number;
  }> {
    const counts = await this.accountQueryRepo.getTrialStatsCounts();
    const conversionRate =
      counts.totalTrials > 0
        ? Math.round((counts.converted / (counts.totalTrials + counts.converted)) * 100)
        : 0;
    return {
      totalTrials: counts.totalTrials,
      activeTrials: counts.activeTrials,
      expiredTrials: counts.expiredTrials,
      convertedTrials: counts.converted,
      trialsStartedThisMonth: counts.startedThisMonth,
      conversionRate,
      expiringIn24Hours: 0,
    };
  }
}
