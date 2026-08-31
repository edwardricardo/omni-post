/**
 * @file PrismaAccountQueryRepository.ts
 * @description Prisma adapter implementing AccountQueryRepositoryPort (read-side).
 *              Receives PrismaClient via constructor injection. Serves billing
 *              services with flat DTOs and relation-loaded account queries.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  AccountQueryRepositoryPort,
  AccountWithProjects,
  SubscriptionUpdateData,
  TrialStatsCounts,
} from "@core/domain/repositories/AccountQueryRepository.js";
import type { AccountDto } from "@core/domain/repositories/ReadModelDtos.js";

/**
 * PrismaAccountQueryRepository — implements AccountQueryRepositoryPort.
 *
 * Receives PrismaClient via constructor injection (DI container).
 *
 * @example
 * const repo = new PrismaAccountQueryRepository(prisma);
 * const result = await repo.findWithProjects("account-id");
 */
export class PrismaAccountQueryRepository implements AccountQueryRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find an account with its projects relation.
   *
   * Excludes soft-deleted accounts (`deletedAt: null`): a soft-deleted account is
   * deleted, not suspended — suspension is a subscription-status flag, deletion is
   * `deletedAt`. Uses findFirst (not findUnique) because `deletedAt` is not a unique
   * column and cannot be added to a findUnique where.
   */
  async findWithProjects(accountId: string): Promise<Result<AccountWithProjects, "NOT_FOUND">> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, deletedAt: null },
      include: { projects: true },
    });

    if (!account) return err("NOT_FOUND");
    // Prisma SubscriptionTier enum values are identical string literals at runtime — safe cast.
    return ok(account as unknown as AccountWithProjects);
  }

  /**
   * Find multiple accounts with their projects in a single query.
   *
   * Returns only accounts that actually exist (missing IDs are silently skipped).
   */
  async findManyWithProjects(accountIds: string[]): Promise<AccountWithProjects[]> {
    const rows = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, deletedAt: null },
      include: { projects: true },
    });
    return rows as unknown as AccountWithProjects[];
  }

  /**
   * Find a single account by ID without loading the projects relation.
   *
   * Lighter than findWithProjects — use when only the base Account row is needed
   * (e.g., audit logging in suspendSubscription).
   */
  async findById(accountId: string): Promise<Result<AccountDto, "NOT_FOUND">> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, deletedAt: null },
    });

    if (!account) return err("NOT_FOUND");
    return ok(account as unknown as AccountDto);
  }

  /**
   * Find a single account by email address without loading the projects relation.
   *
   * Email is normalized to lowercase before the query.
   */
  async findByEmail(email: string): Promise<Result<AccountDto, "NOT_FOUND">> {
    const account = await this.prisma.account.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });

    if (!account) return err("NOT_FOUND");
    return ok(account as unknown as AccountDto);
  }

  /**
   * Partially update subscription fields.
   *
   * Only fields present in `data` are applied — undefined fields are NOT
   * written to the DB (Prisma ignores undefined values in update payloads).
   *
   * Maps Prisma P2025 (record not found) to err("NOT_FOUND").
   */
  async updateSubscription(
    accountId: string,
    data: SubscriptionUpdateData
  ): Promise<Result<AccountDto, "NOT_FOUND">> {
    try {
      const account = await this.prisma.account.update({
        where: { id: accountId },
        data,
      });
      return ok(account as unknown as AccountDto);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "P2025"
      ) {
        return err("NOT_FOUND");
      }
      throw error;
    }
  }

  /**
   * Return accounts whose trial expires within the next `daysThreshold` days.
   *
   * Orders by trialEndDate ascending so the soonest-expiring accounts appear first.
   */
  async getExpiringTrials(daysThreshold: number): Promise<AccountDto[]> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    const rows = await this.prisma.account.findMany({
      where: {
        deletedAt: null,
        isOnTrial: true,
        trialEndDate: {
          lte: thresholdDate,
          gte: new Date(),
        },
      },
      orderBy: { trialEndDate: "asc" },
    });
    return rows as unknown as AccountDto[];
  }

  /**
   * Return on-trial accounts whose trial end date is in [now, until], with
   * projects loaded, ordered by trial end date ascending.
   */
  async findExpiringTrials(now: Date, until: Date): Promise<AccountWithProjects[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        deletedAt: null,
        isOnTrial: true,
        trialEndDate: { gte: now, lte: until },
      },
      include: { projects: true },
      orderBy: { trialEndDate: "asc" },
    });
    return rows as unknown as AccountWithProjects[];
  }

  /**
   * Return on-trial, auto-renewing accounts whose trial has expired
   * (trialEndDate <= now), with projects loaded.
   */
  async findAutoRenewableExpired(now: Date): Promise<AccountWithProjects[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        deletedAt: null,
        isOnTrial: true,
        autoRenewal: true,
        trialEndDate: { lte: now },
      },
      include: { projects: true },
    });
    return rows as unknown as AccountWithProjects[];
  }

  /**
   * Return aggregate trial counts for the admin trial-statistics view.
   */
  async getTrialStatsCounts(): Promise<TrialStatsCounts> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalTrials, activeTrials, expiredTrials, converted, startedThisMonth] =
      await Promise.all([
        this.prisma.account.count({ where: { deletedAt: null, isOnTrial: true } }),
        this.prisma.account.count({
          where: { deletedAt: null, isOnTrial: true, trialEndDate: { gte: now } },
        }),
        this.prisma.account.count({
          where: { deletedAt: null, isOnTrial: true, trialEndDate: { lt: now } },
        }),
        this.prisma.account.count({
          where: { deletedAt: null, isOnTrial: false, trialEndDate: { not: null } },
        }),
        this.prisma.account.count({
          where: { deletedAt: null, trialStartDate: { gte: thirtyDaysAgo } },
        }),
      ]);

    return { totalTrials, activeTrials, expiredTrials, converted, startedThisMonth };
  }

  /**
   * Toggle SSO enabled flag and provider on an account.
   *
   * Maps Prisma P2025 (record not found) to err("NOT_FOUND").
   */
  async setSsoEnabled(
    accountId: string,
    enabled: boolean,
    ssoProvider?: "NONE" | "SAML" | "OIDC"
  ): Promise<Result<void, "NOT_FOUND">> {
    try {
      const data: Record<string, unknown> = { ssoEnabled: enabled };
      if (ssoProvider !== undefined) {
        data.ssoProvider = ssoProvider;
      }
      await this.prisma.account.update({
        where: { id: accountId },
        data,
      });
      return ok(undefined);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "P2025"
      ) {
        return err("NOT_FOUND");
      }
      throw error;
    }
  }
}
