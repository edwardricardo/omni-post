/**
 * @file SubscriptionManagementService.ts
 * @description Core subscription lifecycle: get, list, suspend, validate limits.
 *   Uses the AccountSubscription + ProviderBundle model for provider-based subscriptions.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";
import type { AccountSubscriptionQueryRepository } from "@core/domain/repositories/AccountSubscriptionQueryRepository.js";
import type { AccountSubscriptionPort } from "@core/domain/repositories/AccountSubscriptionPort.js";
import type { ProjectQueryRepositoryPort } from "@core/domain/repositories/ProjectQueryRepository.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { BillingService } from "./BillingService.js";

export class SubscriptionManagementService {
  constructor(
    private readonly accountQueryRepo: AccountQueryRepositoryPort,
    private readonly subscriptionQueryRepo: AccountSubscriptionQueryRepository,
    private readonly subscriptionPort: AccountSubscriptionPort,
    private readonly projectQueryRepo: ProjectQueryRepositoryPort,
    private readonly billingService: BillingService,
    private readonly auditEmitter: AuditEmitterPort
  ) {}

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
    return this.subscriptionQueryRepo.getDetailByAccountId(accountId);
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
    const { subscriptions, total } = await this.subscriptionQueryRepo.list(filters, page, limit);
    return { subscriptions, total, page, limit };
  }

  /**
   * @method validateSubscriptionLimits
   * @description Checks whether an account can perform a given operation based on its
   *   AccountSubscription limits (maxProjects from DB, inline defaults for team/storage).
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
    Result<{ allowed: boolean; limit: number; current: number; remaining: number }, UseCaseError>
  > {
    try {
      const maxProjects = await this.subscriptionQueryRepo.getMaxProjects(accountId);

      if (maxProjects === null) {
        return err(new UseCaseError(`Account not found: ${accountId}`, USE_CASE_ERRORS.NOT_FOUND));
      }

      switch (operation) {
        case "CREATE_PROJECT": {
          const currentProjects = await this.projectQueryRepo.countByAccountId(accountId);
          const remaining = Math.max(0, maxProjects - currentProjects);
          return ok({
            allowed: remaining >= amount,
            limit: maxProjects,
            current: currentProjects,
            remaining,
          });
        }
        case "ADD_TEAM_MEMBER": {
          const currentMembers = await this.projectQueryRepo.countByAccountId(accountId);
          const teamLimit = maxProjects * 5;
          const remaining = Math.max(0, teamLimit - currentMembers);
          return ok({
            allowed: remaining >= amount,
            limit: teamLimit,
            current: currentMembers,
            remaining,
          });
        }
        case "UPLOAD_MEDIA": {
          const mediaCounts = await this.projectQueryRepo.getMediaCountsByAccount(accountId);
          const AVG_SIZE_MB: Record<string, number> = { image: 2, gif: 2, video: 20 };
          let totalMB = 0;
          for (const group of mediaCounts) {
            totalMB += group.count * (AVG_SIZE_MB[group.type] ?? 2);
          }
          const storageUsedGB = Math.round((totalMB / 1024) * 100) / 100;
          const storageLimit = maxProjects * 10;
          const remaining = Math.max(0, storageLimit - storageUsedGB);
          return ok({
            allowed: remaining >= amount,
            limit: storageLimit,
            current: storageUsedGB,
            remaining,
          });
        }
        default:
          return ok({ allowed: true, limit: 0, current: 0, remaining: 0 });
      }
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to validate subscription limits",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
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
  ): Promise<Result<void, UseCaseError>> {
    try {
      const accountResult = await this.accountQueryRepo.findById(accountId);
      if (!accountResult.ok) {
        return err(new UseCaseError(`Account not found: ${accountId}`, USE_CASE_ERRORS.NOT_FOUND));
      }

      const account = accountResult.value;

      // Also update AccountSubscription status if it exists
      await this.subscriptionPort.cancelByAccountId(accountId);

      if (suspendedByUserId) {
        await this.auditEmitter.emit({
          action: "SUBSCRIPTION_SUSPEND",
          category: "BILLING",
          severity: "HIGH",
          userId: suspendedByUserId,
          accountId,
          details: {
            email: account.email,
            reason,
          },
        });
      }

      await this.billingService.logBillingEvent({
        accountId,
        type: "SUSPENSION",
        currency: "USD",
        reason,
        ...(suspendedByUserId && { processedBy: suspendedByUserId }),
      });

      return ok(undefined);
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to suspend subscription",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
