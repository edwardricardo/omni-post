/**
 * @file UpdateScheduledReportUseCase.ts
 * @description Updates an existing scheduled report's schedule, recipients,
 *   or active status via entity methods.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type ScheduledReportRepository } from "@core/domain/repositories/ScheduledReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { ScheduledReportId } from "@core/domain/value-objects/EntityId.js";
import { type UpdateScheduledReportInput } from "./types.js";

/**
 * @class UpdateScheduledReportUseCase
 * @description Loads a scheduled report, applies updates via entity methods, and saves.
 */
export class UpdateScheduledReportUseCase implements UseCase<
  UpdateScheduledReportInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly reportRepository: ScheduledReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

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

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
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
          "Failed to update scheduled report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
