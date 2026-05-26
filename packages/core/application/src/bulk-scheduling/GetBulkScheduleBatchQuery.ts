/**
 * @file GetBulkScheduleBatchQuery.ts
 * @description Application query returning a bulk-scheduling batch manifest
 *              (batch + per-row items) scoped to the caller's account. CQRS read
 *              side — no UoW, no events. Powers the F1-CLI-4 progress poll.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  BulkScheduleQueryRepository,
  BulkScheduleBatchDTO,
} from "@core/domain/repositories/BulkScheduleQueryRepository.js";

/** Account scope + the batch to read. */
export interface GetBulkScheduleBatchInput {
  accountId: string;
  batchId: string;
}

/**
 * @class GetBulkScheduleBatchQuery
 * @description Reads one import batch and its per-row manifest, enforcing tenant
 *   isolation (a batch owned by another account reads as NOT_FOUND).
 */
export class GetBulkScheduleBatchQuery implements UseCase<
  GetBulkScheduleBatchInput,
  BulkScheduleBatchDTO,
  UseCaseError
> {
  constructor(private readonly queryRepo: BulkScheduleQueryRepository) {}

  /**
   * @method execute
   * @description Resolves the batch scoped to `accountId`.
   * @param input - Account scope and batch id.
   * @returns The manifest DTO, NOT_FOUND when absent/foreign, or INTERNAL_ERROR.
   */
  async execute(
    input: GetBulkScheduleBatchInput
  ): Promise<Result<BulkScheduleBatchDTO, UseCaseError>> {
    try {
      const batch = await this.queryRepo.getBatch(input.accountId, input.batchId);
      if (!batch) {
        return err(
          new UseCaseError(
            `Bulk schedule batch not found: ${input.batchId}`,
            USE_CASE_ERRORS.NOT_FOUND
          )
        );
      }
      return ok(batch);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to fetch bulk schedule batch",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
