/**
 * @file TrendRadarQueryRepository.ts
 * @description Read-side port for the trend radar: account-scoped listing
 *              of scored trends populated by the TREND_RADAR worker.
 *              Returned as flat DTOs (provider/source/urgency are wire
 *              strings; relevanceScore is a plain number even though the
 *              Prisma column is Decimal). Independent of the write-side
 *              TrendRadarResultPort (CQRS).
 * @layer domain
 */

/**
 * Flat DTO for one scored trend row. Wire-friendly: enum-shaped values are
 * plain strings, Decimal columns are plain numbers, timestamps are ISO-8601.
 */
export interface ScoredTrendDTO {
  topic: string;
  platform: string;
  source: string;
  sourceUrl: string | null;
  relevanceScore: number;
  postIdea: string | null;
  bestPlatform: string | null;
  urgency: "NOW" | "TODAY" | "THIS_WEEK";
  volume: number | null;
  fetchedAt: string;
}

/**
 * Account-scoped read options. `limit` is mandatory at the port layer; the
 * route handler decides defaults/clamps.
 */
export interface TrendRadarQueryOptions {
  limit: number;
}

/**
 * Page-style result; `total` lets future cursor pagination work without a
 * second round-trip. F0-API-3 callers ignore it but the contract is
 * future-proof.
 */
export interface TrendRadarListResult {
  scored: ScoredTrendDTO[];
  total: number;
}

/**
 * @interface TrendRadarQueryRepository
 * @description Port for reading an account's non-expired trend radar rows.
 */
export interface TrendRadarQueryRepository {
  /**
   * @method findByAccountId
   * @description Lists scored trends for an account, newest+highest
   *   relevance first, excluding rows past their `expiresAt` retention
   *   horizon (30 days).
   */
  findByAccountId(
    accountId: string,
    options: TrendRadarQueryOptions
  ): Promise<TrendRadarListResult>;
}
