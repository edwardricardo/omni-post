/**
 * @file SubscriptionManagementService.ts
 * @description Core subscription lifecycle: get, update, list, suspend.
 *   Dual-mode: supports both legacy Account.subscription AND new AccountSubscription model.
 *   Legacy methods marked @deprecated for incremental removal.
 * @layer application
 */
import { ok, err, type Result, type SubscriptionTier } from "@shared/types";
import { prisma } from "@infra/prisma";
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";
import { AuditableService } from "../../services/AuditableService.js";
import { subscriptionPlanService } from "./SubscriptionPlanService.js";
import { billingService } from "./BillingService.js";
import { type AccountSubscriptionInfo, type SubscriptionChangeRequest } from "./types.js";

export class SubscriptionManagementService extends AuditableService {
  constructor(private readonly accountQueryRepo: AccountQueryRepositoryPort) {
    super("SubscriptionManagementService");
  }

  // ═══════════════════════════════════════════════════════════════
  // New AccountSubscription-based methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * @method getProviderSubscription
   * @description Retrieves the provider-based subscription for an account, including bundle and account details.
   * @param accountId - The account ID to look up
   * @returns The account subscription with bundle and account info, or null if not found
   */
  async getProviderSubscription(accountId: string) {
    return prisma.accountSubscription.findUnique({
      where: { accountId },
      include: { bundle: true, account: { select: { id: true, name: true, email: true } } },
    });
  }

  /**
   * @method listProviderSubscriptions
   * @description Returns a paginated list of provider-based subscriptions with optional status, plan type, and search filters.
   * @param filters - Optional filters for status, plan type (bundle/custom), and text search
   * @param page - Page number (defaults to 1)
   * @param limit - Results per page (defaults to 50)
   * @returns Paginated subscription list with total count
   */
  async listProviderSubscriptions(
    filters: { status?: string; planType?: "bundle" | "custom"; search?: string } = {},
    page = 1,
    limit = 50
  ) {
    const offset = (page - 1) * limit;
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.planType === "bundle") {
      where.bundleId = { not: null };
    } else if (filters.planType === "custom") {
      where.bundleId = null;
    }
    if (filters.search) {
      where.account = {
        OR: [
          { email: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
        ],
      };
    }

    const [subscriptions, total] = await Promise.all([
      prisma.accountSubscription.findMany({
        where,
        include: { bundle: true, account: { select: { id: true, name: true, email: true } } },
        skip: offset,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.accountSubscription.count({ where }),
    ]);

    return { subscriptions, total, page, limit };
  }

  // ═══════════════════════════════════════════════════════════════
  // Legacy methods (kept for backward compatibility)
  // ═══════════════════════════════════════════════════════════════

  /**
   * @method getAccountSubscription
   * @description Retrieves subscription info for an account using the legacy Account model.
   * @deprecated Use getProviderSubscription instead.
   * @param accountId - The account ID to look up
   * @returns Result with subscription info on success, or NOT_FOUND/DATABASE_ERROR on failure
   */
  async getAccountSubscription(
    accountId: string
  ): Promise<Result<AccountSubscriptionInfo, "NOT_FOUND" | "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findWithProjects(accountId);
      if (!accountResult.ok) return err("NOT_FOUND");

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
   * @method updateSubscription
   * @description Legacy stub that logs a deprecation warning and returns INVALID_TIER.
   * @deprecated Removed -- Account.subscription field no longer exists. Use ChangeAccountSubscriptionUseCase instead.
   * @param _accountId - The account ID (unused)
   * @param _changeRequest - The change request payload (unused)
   * @param _updatedByUserId - The admin user ID (unused)
   * @returns Result with INVALID_TIER error
   */
  async updateSubscription(
    _accountId: string,
    _changeRequest: SubscriptionChangeRequest,
    _updatedByUserId?: string
  ): Promise<
    Result<AccountSubscriptionInfo, "NOT_FOUND" | "INVALID_TIER" | "NO_CHANGE" | "DATABASE_ERROR">
  > {
    this.logWarning(
      { operation: "updateSubscription", accountId: _accountId },
      "Legacy updateSubscription called — use ChangeAccountSubscriptionUseCase"
    );
    return err("INVALID_TIER");
  }

  /**
   * @method listAccountSubscriptions
   * @description Legacy stub that logs a deprecation warning and returns an empty list.
   * @deprecated Removed -- Account.subscription field no longer exists. Use listProviderSubscriptions instead.
   * @param _filters - Filter options (unused)
   * @param _page - Page number (unused)
   * @param _limit - Results per page (unused)
   * @returns Result with empty subscription list
   */
  async listAccountSubscriptions(
    _filters: {
      tier?: SubscriptionTier;
      status?: string;
      search?: string;
      sortBy?: "createdAt" | "updatedAt" | "email";
      sortOrder?: "asc" | "desc";
    } = {},
    _page = 1,
    _limit = 50
  ): Promise<
    Result<
      { subscriptions: AccountSubscriptionInfo[]; total: number; page: number; limit: number },
      "DATABASE_ERROR"
    >
  > {
    this.logWarning(
      { operation: "listAccountSubscriptions" },
      "Legacy listAccountSubscriptions called — use listProviderSubscriptions"
    );
    return ok({ subscriptions: [], total: 0, page: _page, limit: _limit });
  }

  /**
   * @method validateSubscriptionLimits
   * @description Checks whether an account can perform a given operation based on its subscription plan limits.
   * @param accountId - The account ID to validate
   * @param operation - The operation type to check (CREATE_PROJECT, ADD_TEAM_MEMBER, UPLOAD_MEDIA)
   * @param amount - Number of units the operation would consume (defaults to 1)
   * @returns Result with allowed status, limit, current usage, and remaining capacity
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
   * @method suspendSubscription
   * @description Cancels an account's subscription, logs an audit trail, and records a billing suspension event.
   * @param accountId - The account ID to suspend
   * @param reason - Explanation for the suspension
   * @param suspendedByUserId - Optional admin user ID who initiated the suspension
   * @returns Result with void on success, or NOT_FOUND/DATABASE_ERROR on failure
   */
  async suspendSubscription(
    accountId: string,
    reason: string,
    suspendedByUserId?: string
  ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
    const startTime = Date.now();
    try {
      const accountResult = await this.accountQueryRepo.findById(accountId);
      if (!accountResult.ok) return err("NOT_FOUND");

      const account = accountResult.value;

      // Also update AccountSubscription status if it exists
      await prisma.accountSubscription.updateMany({
        where: { accountId },
        data: { status: "CANCELED" },
      });

      if (suspendedByUserId) {
        await this.logAccountAction(suspendedByUserId, {
          accountId,
          action: "SUBSCRIPTION_SUSPEND",
          category: "BILLING",
          severity: "HIGH",
          details: {
            email: account.email,
            reason,
          },
        });
      }

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
