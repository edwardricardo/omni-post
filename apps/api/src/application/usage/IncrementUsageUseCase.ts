/**
 * @file IncrementUsageUseCase.ts
 * @description Increments a usage counter (postsPublished or aiCallsMade) for the
 *   given account in the current calendar period. Upserts the row when absent.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UsageMetricRepository } from "../../domain/repositories/UsageMetricRepository.js";

export type IncrementableField = "postsPublished" | "aiCallsMade";

export interface IncrementUsageInput {
  accountId: string;
  field: IncrementableField;
  /** Number to add — defaults to 1 */
  delta?: number;
}

export class IncrementUsageUseCase {
  constructor(private readonly repository: UsageMetricRepository) {}

  async execute(input: IncrementUsageInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1; // 1-12

    await this.repository.increment(input.accountId, year, month, input.field, input.delta ?? 1);
    return ok(undefined);
  }
}
