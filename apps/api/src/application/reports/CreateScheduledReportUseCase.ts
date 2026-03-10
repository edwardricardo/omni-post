/**
 * @file CreateScheduledReportUseCase.ts
 * @description Creates a new scheduled report entity for a project. Validates input,
 *   delegates creation to the ScheduledReport entity factory, and persists via repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ScheduledReportRepository } from "../../domain/repositories/ScheduledReportRepository.js";
import { ScheduledReport } from "../../domain/entities/ScheduledReport.js";
import { ProjectId } from "../../domain/value-objects/EntityId.js";
import { type CreateScheduledReportInput, type CreateScheduledReportOutput } from "./types.js";

/**
 * @class CreateScheduledReportUseCase
 * @description Orchestrates scheduled report creation: validates input,
 *   constructs the entity via its factory, and persists it.
 */
export class CreateScheduledReportUseCase
  implements UseCase<CreateScheduledReportInput, CreateScheduledReportOutput, UseCaseError>
{
  constructor(private readonly reportRepository: ScheduledReportRepository) {}

  /**
   * @method execute
   * @description Creates a new scheduled report and persists it.
   * @param input - Validated creation parameters
   * @returns Result with the new report ID on success
   */
  async execute(
    input: CreateScheduledReportInput
  ): Promise<Result<CreateScheduledReportOutput, UseCaseError>> {
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid projectId: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          projectIdResult.error
        )
      );
    }

    const reportResult = ScheduledReport.create({
      projectId: projectIdResult.value,
      name: input.name,
      cronSchedule: input.cronSchedule,
      recipients: input.recipients,
      ...(input.format !== undefined && { format: input.format }),
      ...(input.filters !== undefined && { filters: input.filters }),
    });

    if (!reportResult.ok) {
      return err(
        new UseCaseError(
          reportResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          reportResult.error
        )
      );
    }

    const report = reportResult.value;

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

    return ok({ id: report.id.value });
  }
}
