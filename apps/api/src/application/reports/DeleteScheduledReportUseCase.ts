/**
 * @file DeleteScheduledReportUseCase.ts
 * @description Deletes a scheduled report by its ID.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ScheduledReportRepository } from "../../domain/repositories/ScheduledReportRepository.js";
import { ScheduledReportId } from "../../domain/value-objects/EntityId.js";
import { type DeleteScheduledReportInput } from "./types.js";

/**
 * @class DeleteScheduledReportUseCase
 * @description Deletes a scheduled report via the repository.
 */
export class DeleteScheduledReportUseCase
  implements UseCase<DeleteScheduledReportInput, void, UseCaseError>
{
  constructor(private readonly reportRepository: ScheduledReportRepository) {}

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
  }
}
