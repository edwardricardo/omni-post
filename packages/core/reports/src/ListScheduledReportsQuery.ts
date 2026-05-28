/**
 * @file ListScheduledReportsQuery.ts
 * @description Query handler for listing scheduled reports by project.
 *   Delegates directly to the repository read method.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  type ScheduledReportRepository,
  type ScheduledReportDto,
} from "@core/domain/repositories/ScheduledReportRepository.js";
import { type ListScheduledReportsInput } from "./types.js";

/**
 * @class ListScheduledReportsQuery
 * @description Fetches all scheduled reports for a given project.
 */
export class ListScheduledReportsQuery implements UseCase<
  ListScheduledReportsInput,
  ScheduledReportDto[],
  UseCaseError
> {
  constructor(private readonly reportRepository: ScheduledReportRepository) {}

  /**
   * @method execute
   * @description Lists scheduled reports for a project.
   * @param input - Query parameters including projectId
   * @returns Result containing an array of ScheduledReportDto
   */
  async execute(
    input: ListScheduledReportsInput
  ): Promise<Result<ScheduledReportDto[], UseCaseError>> {
    if (!input.projectId || input.projectId.trim().length === 0) {
      return err(
        new UseCaseError("Project ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const reports = await this.reportRepository.findByProjectId(input.projectId);
    return ok(reports);
  }
}
