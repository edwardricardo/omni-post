/**
 * @file AccountQueryRepository.ts
 * @description Repository port for Account read-model queries — provides DTO-based access for billing and subscription services that need account-project relations.
 * @layer domain
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
 * Aggregate trial counts for the admin trial-statistics view.
 */
export interface TrialStatsCounts {
  totalTrials: number;
  activeTrials: number;
  expiredTrials: number;
  converted: number;
  startedThisMonth: number;
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

  /**
   * Return on-trial accounts whose trial end date falls within `[now, until]`,
   * with their projects loaded, ordered by trial end date ascending.
   *
   * Returns the same hydrated shape as {@link findWithProjects} so trial-response
   * building is identical regardless of how the account was fetched.
   */
  findExpiringTrials(now: Date, until: Date): Promise<AccountWithProjects[]>;

  /**
   * Return on-trial accounts with auto-renewal enabled whose trial has already
   * expired (`trialEndDate <= now`), with their projects loaded.
   *
   * Returns the same hydrated shape as {@link findWithProjects}.
   */
  findAutoRenewableExpired(now: Date): Promise<AccountWithProjects[]>;

  /**
   * Return aggregate trial counts used by the admin trial-statistics view.
   */
  getTrialStatsCounts(): Promise<TrialStatsCounts>;

  /**
   * Toggle the SSO enabled flag and provider on an account.
   *
   * Used by SAML/OIDC SSO use cases to enable/disable single sign-on.
   *
   * @param accountId - The account to update
   * @param enabled - Whether SSO is enabled
   * @param ssoProvider - The SSO provider type (NONE, SAML, OIDC). Defaults to NONE when disabling.
   * @returns ok(void) on success, err("NOT_FOUND") if the account does not exist
   */
  setSsoEnabled(
    accountId: string,
    enabled: boolean,
    ssoProvider?: "NONE" | "SAML" | "OIDC"
  ): Promise<Result<void, "NOT_FOUND">>;
}
