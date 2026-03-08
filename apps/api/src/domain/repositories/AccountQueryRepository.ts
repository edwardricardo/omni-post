/**
 * Domain Layer - Account Query Repository Port (Read Model)
 *
 * Part of R1-B: Hexagonal migration — Account query methods needed by billing services.
 *
 * This port defines the read-model operations that go beyond the standard CRUD
 * provided by AccountRepositoryPort. The write side (AccountRepositoryPort) uses
 * domain entities (Account, AccountId). This read side works directly with plain
 * domain DTOs so that billing services can receive the relations (e.g., ProjectDto[])
 * that subscription calculations require.
 *
 * @module domain/repositories/AccountQueryRepository
 */

import type { Result } from "@shared/types";
import type { AccountDto, ProjectDto, SubscriptionTierKind } from "./ReadModelDtos.js";

/**
 * An AccountDto hydrated with its ProjectDto[] relation.
 *
 * Used by billing services that need to count / inspect projects
 * (e.g., to validate downgrade limits, map subscription info).
 */
export type AccountWithProjects = AccountDto & { projects: ProjectDto[] };

/**
 * Shape of the partial update payload accepted by updateSubscription.
 *
 * All fields are optional — only those provided will be written to the DB.
 * Using exactOptionalPropertyTypes-safe optional fields.
 */
export interface SubscriptionUpdateData {
  subscription?: SubscriptionTierKind;
  maxProjects?: number;
  isOnTrial?: boolean;
  trialEndDate?: Date | null;
}

/**
 * AccountQueryRepositoryPort — Read-model port for Account billing queries.
 *
 * Implementations:
 *   - PrismaAccountQueryRepository (infrastructure/repositories/)
 *
 * This is intentionally separate from AccountRepositoryPort (the write side)
 * to follow CQRS / hexagonal separation of concerns.
 */
export interface AccountQueryRepositoryPort {
  /**
   * Find an account with its related projects.
   *
   * Used by billing services to check project counts before
   * plan changes and to map subscription info.
   *
   * @returns ok(account) if found, err("NOT_FOUND") otherwise
   */
  findWithProjects(accountId: string): Promise<Result<AccountWithProjects, "NOT_FOUND">>;

  /**
   * Find multiple accounts with their related projects in a single query.
   *
   * @param accountIds - List of account IDs to fetch
   * @returns Array of matched accounts (silently omits non-existent IDs)
   */
  findManyWithProjects(accountIds: string[]): Promise<AccountWithProjects[]>;

  /**
   * Find a single account by ID (without project relation).
   *
   * Lightweight alternative to findWithProjects when projects are not needed
   * (e.g., suspension audit logging).
   *
   * @returns ok(account) if found, err("NOT_FOUND") otherwise
   */
  findById(accountId: string): Promise<Result<AccountDto, "NOT_FOUND">>;

  /**
   * Find a single account by email address (without project relation).
   *
   * Email comparison is case-insensitive (normalized to lowercase internally).
   *
   * @returns ok(account) if found, err("NOT_FOUND") otherwise
   */
  findByEmail(email: string): Promise<Result<AccountDto, "NOT_FOUND">>;

  /**
   * Partially update subscription-related fields on an account.
   *
   * Only the fields present in `data` are written — undefined fields are
   * left unchanged in the database.
   *
   * @returns ok(updatedAccount) on success, err("NOT_FOUND") if the account does not exist
   */
  updateSubscription(
    accountId: string,
    data: SubscriptionUpdateData
  ): Promise<Result<AccountDto, "NOT_FOUND">>;

  /**
   * Return accounts whose trial period expires within the next `daysThreshold` days.
   *
   * Used by scheduled jobs / notification services to warn users before their
   * trial expires.
   *
   * @param daysThreshold - Number of days ahead to look (e.g., 1 = expiring tomorrow)
   */
  getExpiringTrials(daysThreshold: number): Promise<AccountDto[]>;
}
