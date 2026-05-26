/**
 * @file SubscriptionStatsQueryRepository.ts
 * @description Read-model port for the aggregations powering subscription
 *   analytics (MRR, status distribution, churn risk, growth). Returns raw
 *   counts/sums as flat DTOs; the percentage and risk-bucket math stays in the
 *   SubscriptionStatsService.
 * @layer domain
 */

/**
 * One subscription-status bucket with its count and summed monthly price.
 */
export interface SubscriptionStatusGroupDto {
  status: string;
  count: number;
  pricePerMonthSum: number;
}

/**
 * Account IDs that posted within a time window, used to bucket churn risk.
 */
export interface ChurnActivityWindowsDto {
  /** Distinct account IDs with a post in the last 14 days. */
  activeAccountIds: string[];
  /** Distinct account IDs with a post in the [30d, 14d) window. */
  moderateAccountIds: string[];
}

/**
 * SubscriptionStatsQueryRepository — read-only aggregations for analytics.
 * Implemented by PrismaSubscriptionStatsQueryRepository.
 */
export interface SubscriptionStatsQueryRepository {
  /**
   * Group subscriptions by status, returning per-status count and summed
   * monthly price.
   */
  groupByStatus(): Promise<SubscriptionStatusGroupDto[]>;

  /**
   * Count all accounts.
   */
  countAccounts(): Promise<number>;

  /**
   * Count accounts created at or after the given date.
   */
  countAccountsCreatedSince(since: Date): Promise<number>;

  /**
   * Count accounts created within the [from, to) window.
   */
  countAccountsCreatedBetween(from: Date, to: Date): Promise<number>;

  /**
   * Count subscriptions backed by a provider bundle (bundleId not null).
   */
  countBundleSubscriptions(): Promise<number>;

  /**
   * Resolve the churn-risk activity windows (active vs. moderate posters)
   * relative to now.
   */
  getChurnActivityWindows(
    fourteenDaysAgo: Date,
    thirtyDaysAgo: Date
  ): Promise<ChurnActivityWindowsDto>;

  /**
   * Count cancellation audit-log entries (action contains "CANCEL") created at
   * or after the given date.
   */
  countCancellationsSince(since: Date): Promise<number>;
}
