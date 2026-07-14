/**
 * @file CreateScheduledReportUseCase.ts
 * @description Creates a new scheduled report entity for a project. Validates input,
 *   resolves the parent project through the guard-scoped ProjectRepository to
 *   enforce project-ownership (foreign project → NOT_FOUND) and thread the
 *   project's accountId onto the row, then persists via repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type ScheduledReportRepository } from "@core/domain/repositories/ScheduledReportRepository.js";
import { type ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { ScheduledReport } from "@core/domain/entities/ScheduledReport.js";
import { ProjectId } from "@core/domain/value-objects/EntityId.js";
import { type CreateScheduledReportInput, type CreateScheduledReportOutput } from "./types.js";

/**
 * @class CreateScheduledReportUseCase
 * @description Orchestrates scheduled report creation: validates input,
 *   constructs the entity via its factory, and persists it.
 */
export class CreateScheduledReportUseCase implements UseCase<
  CreateScheduledReportInput,
  CreateScheduledReportOutput,
  UseCaseError
> {
  constructor(
    private readonly reportRepository: ScheduledReportRepository,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

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

    // Ownership check: resolve the project through the guard-scoped repository.
    // A foreign or nonexistent projectId resolves to EntityNotFoundError under
    // the caller's tenant context. Return NOT_FOUND BEFORE `doWork` so the
    // catch-all below can never flatten it to INTERNAL_ERROR (anti-enumeration:
    // NOT_FOUND, never 403).
    const projectResult = await this.projectRepository.findById(projectIdResult.value);
    if (!projectResult.ok) {
      return err(new UseCaseError(projectResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const accountId = projectResult.value.accountId.toString();

    const reportResult = ScheduledReport.create({
      accountId,
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

    const doWork = async (): Promise<Result<CreateScheduledReportOutput, UseCaseError>> => {
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
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateScheduledReportOutput, UseCaseError> = ok({ id: "" });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create scheduled report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
