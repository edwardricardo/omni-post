/**
 * @file UpdateScheduledReportUseCase.ts
 * @description Updates an existing scheduled report's schedule, recipients,
 *   or active status via entity methods.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ScheduledReportRepository } from "../../domain/repositories/ScheduledReportRepository.js";
import { ScheduledReportId } from "../../domain/value-objects/EntityId.js";
import { type UpdateScheduledReportInput } from "./types.js";

/**
 * @class UpdateScheduledReportUseCase
 * @description Loads a scheduled report, applies updates via entity methods, and saves.
 */
export class UpdateScheduledReportUseCase
  implements UseCase<UpdateScheduledReportInput, void, UseCaseError>
{
  constructor(private readonly reportRepository: ScheduledReportRepository) {}

  /**
   * @method execute
   * @description Updates a scheduled report.
   * @param input - Update parameters including reportId and optional fields
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: UpdateScheduledReportInput): Promise<Result<void, UseCaseError>> {
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

    const findResult = await this.reportRepository.findById(idResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError("Scheduled report not found", USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    const report = findResult.value;

    if (input.cronSchedule !== undefined) {
      report.updateSchedule(input.cronSchedule, input.recipients);
    } else if (input.recipients !== undefined) {
      report.updateSchedule(report.cronSchedule, input.recipients);
    }

    if (input.isActive !== undefined) {
      if (input.isActive) {
        report.activate();
      } else {
        report.deactivate();
      }
    }

    const saveResult = await this.reportRepository.save(report);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to save scheduled report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok(undefined);
  }
}
