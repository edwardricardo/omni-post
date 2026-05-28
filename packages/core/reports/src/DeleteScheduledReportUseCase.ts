/**
 * @file DeleteScheduledReportUseCase.ts
 * @description Deletes a scheduled report by its ID.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type ScheduledReportRepository } from "@core/domain/repositories/ScheduledReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { ScheduledReportId } from "@core/domain/value-objects/EntityId.js";
import { type DeleteScheduledReportInput } from "./types.js";

/**
 * @class DeleteScheduledReportUseCase
 * @description Deletes a scheduled report via the repository.
 */
export class DeleteScheduledReportUseCase implements UseCase<
  DeleteScheduledReportInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly reportRepository: ScheduledReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Deletes the scheduled report with the given ID.
   * @param input - Contains the reportId to delete
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: DeleteScheduledReportInput): Promise<Result<void, UseCaseError>> {
    const idResult = ScheduledReportId.fromString(input.reportId);
    if (!idResult.ok) {
      return err(
        new UseCaseError(
          `Invalid report ID: ${input.reportId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          idResult.error
        )
      );
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const deleteResult = await this.reportRepository.delete(idResult.value);
      if (!deleteResult.ok) {
        return err(
          new UseCaseError(
            "Scheduled report not found",
            USE_CASE_ERRORS.NOT_FOUND,
            deleteResult.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to delete scheduled report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
