/**
 * @file FailBulkScheduleRowUseCase.ts
 * @description Records the terminal failure of a bulk-schedule row whose job
 *              exhausted its retries (moved to the DLQ). Marks the manifest item
 *              FAILED and settles the batch so it can reach COMPLETED. Idempotent
 *              and UoW-wrapped. Kept separate from ProcessBulkScheduleRowUseCase
 *              so "give up on this row" is a distinct, testable responsibility
 *              from "process this row".
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { BulkScheduleBatchRepository } from "../../domain/repositories/BulkScheduleBatchRepository.js";

/** The row to fail and the human-readable reason. */
export interface FailBulkScheduleRowInput {
  batchId: string;
  itemId: string;
  reason: string;
}

/**
 * @class FailBulkScheduleRowUseCase
 * @description Marks one manifest item FAILED and settles its batch.
 */
export class FailBulkScheduleRowUseCase implements UseCase<
  FailBulkScheduleRowInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly batchRepo: BulkScheduleBatchRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Records the terminal failure transactionally (idempotent).
   * @param input - Batch + item ids and the failure reason.
   * @returns ok on success, INTERNAL_ERROR on an unexpected write failure.
   */
  async execute(input: FailBulkScheduleRowInput): Promise<Result<void, UseCaseError>> {
    const work = async (): Promise<void> => {
      await this.batchRepo.markItemFailed(input.itemId, input.reason);
      await this.batchRepo.completeBatchIfSettled(input.batchId);
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.executeInTransaction(work);
      } else {
        await work();
      }
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to record bulk schedule row failure",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
