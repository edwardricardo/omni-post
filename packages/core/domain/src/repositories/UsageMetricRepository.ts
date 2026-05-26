/**
 * @file UsageMetricRepository.ts
 * @description Domain port interface for usage metric persistence.
 *   Technology-free — no Prisma, no infrastructure imports.
 * @layer domain
 */

export interface UsageMetricData {
  id: string;
  accountId: string;
  periodYear: number;
  periodMonth: number;
  postsPublished: number;
  aiCallsMade: number;
  storageGb: number;
  teamMemberCount: number;
  updatedAt: Date;
}

/**
 * Plan + subscription context joined into a single read for the usage page.
 * `postsLimit` / `channelsLimit` are `null` when the bundle field is unset
 * (unlimited tier) — the caller maps `null` to "Unlimited" in the UI.
 */
export interface AccountUsageContext {
  /** Bundle name shown in the page header, e.g. "Pro", "Free", "Enterprise". */
  plan: string;
  /** Connected social channels for the account (Channel rows, not soft-deleted). */
  channelsCount: number;
  /** Bundle.maxPostsPerMonth — null for unlimited. */
  postsLimit: number | null;
  /** Bundle.maxChannels — null for unlimited. */
  channelsLimit: number | null;
  /** Account.maxTeamMembers (per-account override; bundle-independent today). */
  teamMembersLimit: number;
  /** Account.maxStorageBytes converted to GB. */
  storageLimitGb: number;
  /** Account.isOnTrial. */
  isOnTrial: boolean;
  /** Account.trialEndDate ISO string, or null. */
  trialEndDate: Date | null;
  /** Account.nextBillingDate ISO string, or null. */
  nextBillingDate: Date | null;
}

export interface UsageMetricRepository {
  /**
   * Increment a single numeric counter for the current period.
   * Upserts the row if it does not exist yet.
   */
  increment(
    accountId: string,
    year: number,
    month: number,
    field: "postsPublished" | "aiCallsMade",
    delta?: number
  ): Promise<void>;

  /**
   * Set the storage or team member count for the current period (absolute value).
   */
  set(
    accountId: string,
    year: number,
    month: number,
    field: "storageGb" | "teamMemberCount",
    value: number
  ): Promise<void>;

  /**
   * Read the usage metrics for a specific period.
   * Returns null if no data exists for that period.
   */
  findByPeriod(accountId: string, year: number, month: number): Promise<UsageMetricData | null>;

  /**
   * Read plan + subscription + channel-count context joined for an account.
   * Returns null when the account is missing entirely. Subscription /
   * bundle / channel data may be partial — callers must tolerate
   * defaults via the use-case-layer mapping.
   */
  findAccountContext(accountId: string): Promise<AccountUsageContext | null>;
}
