/**
 * @file CreateCustomReportUseCase.ts
 * @description Creates a new custom report entity for an account. Validates input via
 *   the CustomReport entity factory and persists via repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomReportRepository } from "../../domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { CustomReport } from "../../domain/entities/CustomReport.js";
import type { CreateCustomReportInput, CreateCustomReportOutput } from "./types.js";

/**
 * @class CreateCustomReportUseCase
 * @description Orchestrates custom report creation: validates input,
 *   constructs the entity via its factory, and persists it.
 */
export class CreateCustomReportUseCase implements UseCase<
  CreateCustomReportInput,
  CreateCustomReportOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new custom report and persists it.
   * @param input - Validated creation parameters
   * @returns Result with the new report ID on success
   */
  async execute(
    input: CreateCustomReportInput
  ): Promise<Result<CreateCustomReportOutput, UseCaseError>> {
    const reportResult = CustomReport.create({
      accountId: input.accountId,
      name: input.name,
      metrics: input.metrics,
      dimensions: input.dimensions,
      createdById: input.createdById,
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.dateRange !== undefined && { dateRange: input.dateRange }),
      ...(input.dateRangeStart !== undefined && {
        dateRangeStart: new Date(input.dateRangeStart),
      }),
      ...(input.dateRangeEnd !== undefined && {
        dateRangeEnd: new Date(input.dateRangeEnd),
      }),
      ...(input.chartType !== undefined && { chartType: input.chartType }),
      ...(input.filters !== undefined && { filters: input.filters }),
      ...(input.isShared !== undefined && { isShared: input.isShared }),
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

    const doWork = async (): Promise<Result<CreateCustomReportOutput, UseCaseError>> => {
      const saveResult = await this.repository.save(report);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save custom report",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({ id: saveResult.value });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateCustomReportOutput, UseCaseError> = ok({ id: "" });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create custom report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
