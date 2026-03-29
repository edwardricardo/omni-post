/**
 * @file ScheduleCustomReportUseCase.ts
 * @description Creates a schedule for an existing custom report. Validates ownership,
 *   cron expression format, report format, and recipient list.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomReportRepository } from "../../domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { isValidReportFormat } from "../../domain/analytics/ReportSchema.js";
import type { ScheduleCustomReportInput, ScheduleCustomReportOutput } from "./types.js";

/** Basic cron validation: 5 space-separated fields */
const CRON_REGEX = /^(\S+\s+){4}\S+$/;

/**
 * @class ScheduleCustomReportUseCase
 * @description Creates a new schedule for a custom report.
 */
export class ScheduleCustomReportUseCase implements UseCase<
  ScheduleCustomReportInput,
  ScheduleCustomReportOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates and creates a report schedule.
   * @param input - Schedule configuration
   * @returns Result with the new schedule ID
   */
  async execute(
    input: ScheduleCustomReportInput
  ): Promise<Result<ScheduleCustomReportOutput, UseCaseError>> {
    // Validate cron expression
    if (!CRON_REGEX.test(input.cronExpression)) {
      return err(
        new UseCaseError(
          `Invalid cron expression: ${input.cronExpression}. Expected 5 space-separated fields.`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Validate format
    const format = input.format ?? "PDF";
    if (!isValidReportFormat(format)) {
      return err(
        new UseCaseError(
          `Invalid report format: ${format}. Must be CSV, JSON, PDF, XLSX, or XML.`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Validate recipients
    if (!input.recipients || input.recipients.length === 0) {
      return err(
        new UseCaseError("At least one recipient is required", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const doWork = async (): Promise<Result<ScheduleCustomReportOutput, UseCaseError>> => {
      // Verify report exists and belongs to account
      const findResult = await this.repository.findById(input.reportId);
      if (!findResult.ok) {
        return err(
          new UseCaseError(
            `Custom report not found: ${input.reportId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            findResult.error
          )
        );
      }

      if (findResult.value.accountId !== input.accountId) {
        return err(
          new UseCaseError(
            "Access denied: report belongs to a different account",
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }

      const saveResult = await this.repository.saveSchedule({
        reportId: input.reportId,
        cronExpression: input.cronExpression,
        timezone: input.timezone ?? "UTC",
        format,
        recipients: input.recipients,
      });

      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to create report schedule",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({ id: saveResult.value });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ScheduleCustomReportOutput, UseCaseError> = ok({ id: "" });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to schedule custom report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
