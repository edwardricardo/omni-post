/**
 * @file GetUsageUseCase.ts
 * @description Returns usage metrics for an account for a given year/month period.
 *   When no data exists for the period, returns zeroed-out metrics.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  UsageMetricRepository,
  UsageMetricData,
} from "../../domain/repositories/UsageMetricRepository.js";

export interface GetUsageInput {
  accountId: string;
  year: number;
  month: number; // 1-12
}

export type UsageDto = Omit<UsageMetricData, "id" | "updatedAt">;

export class GetUsageUseCase {
  constructor(private readonly repository: UsageMetricRepository) {}

  async execute(input: GetUsageInput): Promise<Result<UsageDto, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (input.month < 1 || input.month > 12) {
      return err(
        new UseCaseError("month must be between 1 and 12", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const row = await this.repository.findByPeriod(input.accountId, input.year, input.month);

    if (!row) {
      return ok({
        accountId: input.accountId,
        periodYear: input.year,
        periodMonth: input.month,
        postsPublished: 0,
        aiCallsMade: 0,
        storageGb: 0,
        teamMemberCount: 0,
      });
    }

    return ok({
      accountId: row.accountId,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      postsPublished: row.postsPublished,
      aiCallsMade: row.aiCallsMade,
      storageGb: row.storageGb,
      teamMemberCount: row.teamMemberCount,
    });
  }
}
