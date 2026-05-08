/**
 * @file GetUsageUseCase.ts
 * @description Returns usage metrics for an account for a given year/month
 *              period enriched with plan limits + trial + billing context
 *              from a 3-leg JOIN (Account / AccountSubscription / Channel).
 *              Counters default to zero when no UsageMetric row exists yet
 *              for the period; account context returns NotFound when the
 *              account itself doesn't exist.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UsageMetricRepository } from "../../domain/repositories/UsageMetricRepository.js";

export interface GetUsageInput {
  accountId: string;
  year: number;
  month: number; // 1-12
}

/**
 * Output DTO consumed by `/dashboard/settings/usage`. `postsLimit` and
 * `channelsLimit` are nullable — the UI renders "Unlimited" for null
 * (enterprise tier or no subscription).
 */
export interface UsageDto {
  accountId: string;
  periodYear: number;
  periodMonth: number;

  // Counters (from UsageMetric row)
  postsPublished: number;
  aiCallsMade: number;
  storageGb: number;
  teamMemberCount: number;

  // Plan context (from Account + AccountSubscription + Bundle JOIN)
  plan: string;
  channelsCount: number;
  postsLimit: number | null;
  channelsLimit: number | null;
  teamMembersLimit: number;
  storageLimitGb: number;
  isOnTrial: boolean;
  trialEndDate: string | null;
  nextBillingDate: string | null;
}

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

    const context = await this.repository.findAccountContext(input.accountId);
    if (!context) {
      return err(
        new UseCaseError(`Account not found: ${input.accountId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    const metricRow = await this.repository.findByPeriod(input.accountId, input.year, input.month);

    return ok({
      accountId: input.accountId,
      periodYear: input.year,
      periodMonth: input.month,
      postsPublished: metricRow?.postsPublished ?? 0,
      aiCallsMade: metricRow?.aiCallsMade ?? 0,
      storageGb: metricRow?.storageGb ?? 0,
      teamMemberCount: metricRow?.teamMemberCount ?? 0,
      plan: context.plan,
      channelsCount: context.channelsCount,
      postsLimit: context.postsLimit,
      channelsLimit: context.channelsLimit,
      teamMembersLimit: context.teamMembersLimit,
      storageLimitGb: context.storageLimitGb,
      isOnTrial: context.isOnTrial,
      trialEndDate: context.trialEndDate ? context.trialEndDate.toISOString() : null,
      nextBillingDate: context.nextBillingDate ? context.nextBillingDate.toISOString() : null,
    });
  }
}
