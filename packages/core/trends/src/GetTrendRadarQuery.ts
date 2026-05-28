/**
 * @file GetTrendRadarQuery.ts
 * @description CQRS read-side query that returns one account's trend
 *              radar — the latest scored trends populated by the
 *              TREND_RADAR worker, filtered to non-expired rows and
 *              ordered by relevance. Read-only, no Unit of Work.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  TrendRadarQueryRepository,
  ScoredTrendDTO,
} from "@core/domain/repositories/TrendRadarQueryRepository.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface GetTrendRadarInput {
  accountId: string;
  limit?: number;
}

export interface GetTrendRadarOutput {
  scored: ScoredTrendDTO[];
  total: number;
}

/**
 * @class GetTrendRadarQuery
 * @description Returns the trend radar page for the given account.
 */
export class GetTrendRadarQuery implements UseCase<
  GetTrendRadarInput,
  GetTrendRadarOutput,
  UseCaseError
> {
  constructor(private readonly repository: TrendRadarQueryRepository) {}

  /**
   * @method execute
   * @description Lists non-expired scored trends for `input.accountId`,
   *   clamping `limit` to the [1, MAX_LIMIT] range with `DEFAULT_LIMIT`
   *   fallback.
   * @param input - accountId (required) and optional limit override.
   * @returns Result with `{ scored, total }` or a UseCaseError.
   */
  async execute(input: GetTrendRadarInput): Promise<Result<GetTrendRadarOutput, UseCaseError>> {
    try {
      const requested = input.limit ?? DEFAULT_LIMIT;
      const limit = Math.min(Math.max(requested, 1), MAX_LIMIT);
      const page = await this.repository.findByAccountId(input.accountId, { limit });
      return ok({ scored: page.scored, total: page.total });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to fetch trend radar",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
