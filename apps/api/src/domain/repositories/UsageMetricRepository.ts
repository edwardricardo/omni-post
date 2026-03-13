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
}
