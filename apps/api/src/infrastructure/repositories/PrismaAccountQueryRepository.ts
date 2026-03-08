/**
 * Infrastructure Layer - Prisma Account Query Repository (Read Model Adapter)
 *
 * Part of R1-B: Hexagonal migration — billing services read-model.
 *
 * Implements AccountQueryRepositoryPort using Prisma ORM.
 * This adapter handles the read-side operations required by billing services:
 * - findWithProjects (account + Project[] relation)
 * - findManyWithProjects (batch)
 * - findById (lightweight, no relation)
 * - updateSubscription (partial subscription fields)
 * - getExpiringTrials (scheduled job / notification query)
 *
 * IMPORTANT: This is a SEPARATE adapter from PrismaAccountRepository.
 * PrismaAccountRepository is the write-side hexagonal adapter that works
 * with domain entities (Account, AccountId). This adapter works with raw
 * domain DTOs for billing use cases that need Prisma relations directly.
 *
 * @module infrastructure/repositories/PrismaAccountQueryRepository
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  AccountQueryRepositoryPort,
  AccountWithProjects,
  SubscriptionUpdateData,
} from "../../domain/repositories/AccountQueryRepository.js";
import type { AccountDto } from "../../domain/repositories/ReadModelDtos.js";

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
   * Uses findUnique (exact ID match) — no soft-delete filtering applied
   * here because billing services need to read accounts even during
   * suspension states.
   */
  async findWithProjects(accountId: string): Promise<Result<AccountWithProjects, "NOT_FOUND">> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
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
      where: { id: { in: accountIds } },
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
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
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
    const account = await this.prisma.account.findUnique({
      where: { email: email.toLowerCase() },
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
}
