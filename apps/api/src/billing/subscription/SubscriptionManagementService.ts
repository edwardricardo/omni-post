/**
 * Subscription Management Service
 *
 * Handles core subscription lifecycle operations including plan upgrades,
 * downgrades, cancellations, suspensions, and auto-renewals. Extends
 * AuditableService to ensure all subscription changes are logged for compliance
 * and billing audit trails.
 *
 * Trial-related operations have been extracted to TrialManagementService.
 *
 * R1-B: Migrated from legacy AccountRepository singleton to AccountQueryRepositoryPort
 * injected via DI container.
 *
 * @module billing/subscription/SubscriptionManagementService
 */
import { ok, err, type Result, type SubscriptionTier } from "@shared/types";
import { prisma } from "@infra/prisma";
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";
import { AuditableService } from "../../services/AuditableService";
import { subscriptionPlanService } from "./SubscriptionPlanService";
import { billingService } from "./BillingService";
import {
  type AccountSubscriptionInfo,
  type SubscriptionChangeRequest,
  type SubscriptionHierarchy,
  type PrismaAccountWhereInput,
  type PrismaAccountOrderByInput,
} from "./types";

/**
 * Service responsible for core subscription management operations:
 * get, update, list, validate limits, suspend, auto-renewals
 */
export class SubscriptionManagementService extends AuditableService {
  constructor(private readonly accountQueryRepo: AccountQueryRepositoryPort) {
    super("SubscriptionManagementService");
  }

  /**
   * Get account subscription information
   */
  async getAccountSubscription(
    accountId: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;
      const subscriptionInfo = subscriptionPlanService.mapAccountToSubscriptionInfo(account);

      return ok(subscriptionInfo);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "getAccountSubscription",
        accountId,
      });
      this.logError(
        { serviceName: this.serviceName, operation: "getAccountSubscription", accountId },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Update account subscription
   */
  async updateSubscription(
    accountId: string,
    changeRequest: SubscriptionChangeRequest,
    updatedByUserId?: string
  ): Promise<
    Result<AccountSubscriptionInfo, "NOT_FOUND" | "INVALID_TIER" | "NO_CHANGE" | "DATABASE_ERROR">
  > {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      if (account.subscription === changeRequest.newTier) {
        return err("NO_CHANGE");
      }

      const newPlan = subscriptionPlanService.getSubscriptionPlan(changeRequest.newTier);
      if (!newPlan) {
        return err("INVALID_TIER");
      }

      // Validate upgrade/downgrade
      const isUpgrade =
        billingService.getChangeType(account.subscription, changeRequest.newTier) === "UPGRADE";
      const validationResult = isUpgrade
        ? subscriptionPlanService.validateUpgrade(
            account.subscription as SubscriptionHierarchy,
            changeRequest.newTier as SubscriptionHierarchy
          )
        : subscriptionPlanService.validateDowngrade(
            account.subscription as SubscriptionHierarchy,
            changeRequest.newTier as SubscriptionHierarchy,
            account.projects.length
          );

      if (!validationResult.allowed) {
        this.logWarning(
          { operation: "updateSubscription", accountId },
          validationResult.reason || "Subscription change validation failed"
        );
      }

      const oldTier = account.subscription;
      const currentProjects = account.projects.length;

      // Check if downgrading would exceed project limits
      if (currentProjects > newPlan.maxProjects) {
        this.logWarning(
          { operation: "updateSubscription", accountId },
          `Account has ${currentProjects} projects but new tier allows only ${newPlan.maxProjects}`
        );
      }

      // Update subscription
      await prisma.account.update({
        where: { id: accountId },
        data: {
          subscription: changeRequest.newTier,
          maxProjects: newPlan.maxProjects,
          updatedAt: new Date(),
        },
        include: {
          projects: true,
        },
      });

      // Log account action for audit trail
      if (updatedByUserId) {
        await this.logAccountAction(updatedByUserId, {
          accountId,
          action: "SUBSCRIPTION_UPDATE",
          category: "BILLING",
          severity: "MEDIUM",
          details: {
            email: account.email,
            fromTier: oldTier,
            toTier: changeRequest.newTier,
            billingCycle: changeRequest.billingCycle,
            reason: changeRequest.reason,
          },
        });
      }

      // Log billing event
      await billingService.logBillingEvent({
        accountId,
        type: billingService.getChangeType(oldTier, changeRequest.newTier),
        fromTier: oldTier,
        toTier: changeRequest.newTier,
        amount: billingService.calculateBillingAmount(
          newPlan.monthlyPrice,
          newPlan.yearlyPrice,
          changeRequest.billingCycle
        ),
        currency: "USD",
        ...(changeRequest.reason && { reason: changeRequest.reason }),
        ...(updatedByUserId && { processedBy: updatedByUserId }),
        metadata: {
          billingCycle: changeRequest.billingCycle,
          effectiveDate: changeRequest.effectiveDate,
        },
      });

      return this.getAccountSubscription(accountId);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "updateSubscription",
        accountId,
        ...(updatedByUserId !== undefined && { userId: updatedByUserId }),
      });
      this.logError(
        {
          serviceName: this.serviceName,
          operation: "updateSubscription",
          accountId,
          ...(updatedByUserId !== undefined && { userId: updatedByUserId }),
        },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * List all account subscriptions with filtering
   */
  async listAccountSubscriptions(
    filters: {
      tier?: SubscriptionTier;
      search?: string;
      sortBy?: "createdAt" | "updatedAt" | "email" | "subscription";
      sortOrder?: "asc" | "desc";
    } = {},
    page = 1,
    limit = 50
  ): Promise<
    Result<
      { subscriptions: AccountSubscriptionInfo[]; total: number; page: number; limit: number },
      "DATABASE_ERROR"
    >
  > {
    const startTime = Date.now();
    try {
      const offset = (page - 1) * limit;

      // Build where clause with proper types
      const where: PrismaAccountWhereInput = {};

      if (filters.tier) {
        where.subscription = filters.tier;
      }

      if (filters.search) {
        where.OR = [
          { email: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
        ];
      }

      // Build orderBy clause with proper types
      const orderBy: PrismaAccountOrderByInput = {};
      if (filters.sortBy) {
        orderBy[filters.sortBy] = filters.sortOrder || "desc";
      } else {
        orderBy.createdAt = "desc";
      }

      // Get total count
      const total = await prisma.account.count({ where });

      // Get accounts
      const accounts = await prisma.account.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        include: {
          projects: true,
        },
      });

      // Map accounts to subscription info
      const subscriptions = accounts.map((account) =>
        subscriptionPlanService.mapAccountToSubscriptionInfo(account)
      );

      return ok({
        subscriptions,
        total,
        page,
        limit,
      });
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "listAccountSubscriptions",
      });
      this.logError(
        { serviceName: this.serviceName, operation: "listAccountSubscriptions" },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Validate subscription limits
   */
  async validateSubscriptionLimits(
    accountId: string,
    operation: "CREATE_PROJECT" | "ADD_TEAM_MEMBER" | "UPLOAD_MEDIA",
    amount = 1
  ): Promise<
    Result<
      { allowed: boolean; limit: number; current: number; remaining: number },
      "NOT_FOUND" | "DATABASE_ERROR"
    >
  > {
    const startTime = Date.now();
    try {
      const subscriptionResult = await this.getAccountSubscription(accountId);
      if (!subscriptionResult.ok) {
        return subscriptionResult as Result<
          { allowed: boolean; limit: number; current: number; remaining: number },
          "NOT_FOUND" | "DATABASE_ERROR"
        >;
      }

      return subscriptionPlanService.validateSubscriptionLimits(
        subscriptionResult.value,
        operation,
        amount
      );
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "validateSubscriptionLimits",
        accountId,
      });
      this.logError(
        { serviceName: this.serviceName, operation: "validateSubscriptionLimits", accountId },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Suspend account subscription
   */
  async suspendSubscription(
    accountId: string,
    reason: string,
    suspendedByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findById(accountId);

      if (!accountResult.ok) {
        return err("NOT_FOUND");
      }

      const account = accountResult.value;

      // Log account action for audit trail
      if (suspendedByUserId) {
        await this.logAccountAction(suspendedByUserId, {
          accountId,
          action: "SUBSCRIPTION_SUSPEND",
          category: "BILLING",
          severity: "HIGH",
          details: {
            email: account.email,
            tier: account.subscription,
            reason,
          },
        });
      }

      // Log billing event
      await billingService.logBillingEvent({
        accountId,
        type: "SUSPENSION",
        currency: "USD",
        reason,
        ...(suspendedByUserId && { processedBy: suspendedByUserId }),
      });

      return ok(undefined);
    } catch (error) {
      const serviceError = this.createServiceError(error, {
        serviceName: this.serviceName,
        operation: "suspendSubscription",
        accountId,
        ...(suspendedByUserId !== undefined && { userId: suspendedByUserId }),
      });
      this.logError(
        {
          serviceName: this.serviceName,
          operation: "suspendSubscription",
          accountId,
          ...(suspendedByUserId !== undefined && { userId: suspendedByUserId }),
        },
        serviceError,
        Date.now() - startTime
      );
      return err("DATABASE_ERROR");
    }
  }
}
