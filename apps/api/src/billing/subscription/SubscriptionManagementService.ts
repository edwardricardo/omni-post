/**
 * @file SubscriptionManagementService.ts
 * @description Core subscription lifecycle: get, list, suspend, validate limits.
 *   Uses the AccountSubscription + ProviderBundle model for provider-based subscriptions.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";
import { AuditableService } from "../../services/AuditableService.js";
import { billingService } from "./BillingService.js";

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
    Result<
      { allowed: boolean; limit: number; current: number; remaining: number },
      "NOT_FOUND" | "DATABASE_ERROR"
    >
  > {
    const startTime = Date.now();
    try {
      const subscription = await prisma.accountSubscription.findUnique({
        where: { accountId },
        select: { maxProjects: true },
      });

      if (!subscription) {
        return err("NOT_FOUND");
      }

      switch (operation) {
        case "CREATE_PROJECT": {
          const currentProjects = await prisma.project.count({ where: { accountId } });
          const remaining = Math.max(0, subscription.maxProjects - currentProjects);
          return ok({
            allowed: remaining >= amount,
            limit: subscription.maxProjects,
            current: currentProjects,
            remaining,
          });
        }
        case "ADD_TEAM_MEMBER": {
          const currentMembers = await prisma.project.count({ where: { accountId } });
          const teamLimit = subscription.maxProjects * 5;
          const remaining = Math.max(0, teamLimit - currentMembers);
          return ok({
            allowed: remaining >= amount,
            limit: teamLimit,
            current: currentMembers,
            remaining,
          });
        }
        case "UPLOAD_MEDIA": {
          const mediaCounts = await prisma.postMedia.groupBy({
            by: ["type"],
            where: { post: { project: { accountId } } },
            _count: { id: true },
          });
          const AVG_SIZE_MB: Record<string, number> = { image: 2, gif: 2, video: 20 };
          let totalMB = 0;
          for (const group of mediaCounts) {
            totalMB += group._count.id * (AVG_SIZE_MB[group.type] ?? 2);
          }
          const storageUsedGB = Math.round((totalMB / 1024) * 100) / 100;
          const storageLimit = subscription.maxProjects * 10;
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
