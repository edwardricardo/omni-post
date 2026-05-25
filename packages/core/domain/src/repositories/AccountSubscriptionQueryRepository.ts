/**
 * @file AccountSubscriptionQueryRepository.ts
 * @description Read-model port for AccountSubscription queries consumed by the
 *   subscription management, plan, and trial services. Returns flat DTOs
 *   (CQRS read side) so the application layer stays free of Prisma types.
 * @layer domain
 */

/**
 * A provider bundle summary embedded in subscription details.
 */
export interface SubscriptionBundleSummaryDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive: boolean;
  sortOrder: number;
  maxPostsPerMonth: number | null;
  maxChannels: number | null;
}

/**
 * The account summary embedded in subscription details.
 */
export interface SubscriptionAccountSummaryDto {
  id: string;
  name: string;
  email: string;
}

/**
 * Full subscription detail: the AccountSubscription row joined with its bundle
 * and a minimal account summary.
 */
export interface AccountSubscriptionDetailDto {
  id: string;
  accountId: string;
  bundleId: string | null;
  providers: string[];
  maxProjects: number;
  pricePerMonth: number;
  status: string;
  billingCycle: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bundle: SubscriptionBundleSummaryDto | null;
  account: SubscriptionAccountSummaryDto;
}

/**
 * A single row in the paginated subscription list. Carries the columns the
 * admin list + CSV export render, plus the joined bundle and account summary.
 */
export interface AccountSubscriptionListItemDto {
  id: string;
  accountId: string;
  bundleId: string | null;
  providers: string[];
  maxProjects: number;
  pricePerMonth: number;
  status: string;
  billingCycle: string;
  createdAt: Date;
  updatedAt: Date;
  bundle: SubscriptionBundleSummaryDto | null;
  account: SubscriptionAccountSummaryDto;
}

/**
 * Filters for the subscription list query.
 */
export interface AccountSubscriptionListFilters {
  status?: string;
  planType?: "bundle" | "custom";
  search?: string;
}

/**
 * Paginated subscription list result.
 */
export interface AccountSubscriptionListResult {
  subscriptions: AccountSubscriptionListItemDto[];
  total: number;
}

/**
 * Trial status derived from the AccountSubscription model.
 */
export interface SubscriptionTrialStatusDto {
  isTrialing: boolean;
  trialEndsAt: Date | null;
  daysRemaining: number;
  status: string;
}

/**
 * AccountSubscriptionQueryRepository — read-only port for AccountSubscription
 * data. Implemented by PrismaAccountSubscriptionQueryRepository.
 */
export interface AccountSubscriptionQueryRepository {
  /**
   * Return the full subscription detail (sub + bundle + account summary) for an
   * account, or null when the account has no subscription.
   */
  getDetailByAccountId(accountId: string): Promise<AccountSubscriptionDetailDto | null>;

  /**
   * Return a paginated, filtered list of subscriptions with their total count.
   */
  list(
    filters: AccountSubscriptionListFilters,
    page: number,
    limit: number
  ): Promise<AccountSubscriptionListResult>;

  /**
   * Return the configured maximum number of projects for an account's
   * subscription, or null when the account has no subscription.
   */
  getMaxProjects(accountId: string): Promise<number | null>;

  /**
   * Return all active provider bundles ordered by sort position.
   */
  listBundles(): Promise<SubscriptionBundleSummaryDto[]>;

  /**
   * Return the trial status derived from the AccountSubscription model, or null
   * when the account has no subscription.
   */
  getTrialStatusByAccountId(accountId: string): Promise<SubscriptionTrialStatusDto | null>;
}
