/**
 * @file UpdateCustomReportUseCase.ts
 * @description Updates an existing custom report. Guards ownership by accountId,
 *   validates updated fields via domain entity, and persists changes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomReportRepository } from "../../domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { CustomReport } from "../../domain/entities/CustomReport.js";
import type { UpdateCustomReportInput } from "./types.js";

/**
 * @class UpdateCustomReportUseCase
 * @description Validates ownership and updates a custom report.
 */
export class UpdateCustomReportUseCase implements UseCase<
  UpdateCustomReportInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Updates an existing custom report after ownership validation.
   * @param input - Report ID, accountId, and fields to update
   * @returns Result<void> on success
   */
  async execute(input: UpdateCustomReportInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
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

      const dto = findResult.value;

      if (dto.accountId !== input.accountId) {
        return err(
          new UseCaseError(
            "Access denied: report belongs to a different account",
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }

      // Reconstitute entity to validate the update
      const entity = CustomReport.reconstitute({
        id: dto.id,
        accountId: dto.accountId,
        name: dto.name,
        metrics: dto.metrics as import("../../domain/analytics/ReportSchema.js").MetricKey[],
        dimensions:
          dto.dimensions as import("../../domain/analytics/ReportSchema.js").DimensionKey[],
        dateRange:
          dto.dateRange as import("../../domain/analytics/ReportSchema.js").DateRangePreset,
        chartType: dto.chartType as import("../../domain/analytics/ReportSchema.js").ChartType,
        isShared: dto.isShared,
        createdById: dto.createdById,
        createdAt: dto.createdAt,
        updatedAt: dto.updatedAt,
        ...(dto.projectId !== null && { projectId: dto.projectId }),
        ...(dto.description !== null && { description: dto.description }),
        ...(dto.dateRangeStart !== null && { dateRangeStart: dto.dateRangeStart }),
        ...(dto.dateRangeEnd !== null && { dateRangeEnd: dto.dateRangeEnd }),
        ...(dto.filters !== null && { filters: dto.filters }),
      });

      const updateResult = entity.update({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.metrics !== undefined && { metrics: input.metrics }),
        ...(input.dimensions !== undefined && { dimensions: input.dimensions }),
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

      if (!updateResult.ok) {
        return err(
          new UseCaseError(
            updateResult.error.message,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            updateResult.error
          )
        );
      }

      // Build persistence update payload from validated entity
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = entity.name;
      if (input.description !== undefined) updateData.description = entity.description;
      if (input.metrics !== undefined) updateData.metrics = entity.metrics;
      if (input.dimensions !== undefined) updateData.dimensions = entity.dimensions;
      if (input.dateRange !== undefined) updateData.dateRange = entity.dateRange;
      if (input.dateRangeStart !== undefined) updateData.dateRangeStart = entity.dateRangeStart;
      if (input.dateRangeEnd !== undefined) updateData.dateRangeEnd = entity.dateRangeEnd;
      if (input.chartType !== undefined) updateData.chartType = entity.chartType;
      if (input.filters !== undefined) updateData.filters = entity.filters;
      if (input.isShared !== undefined) updateData.isShared = entity.isShared;

      const persistResult = await this.repository.update(input.reportId, updateData);
      if (!persistResult.ok) {
        return err(
          new UseCaseError(
            "Failed to update custom report",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            persistResult.error
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
          "Failed to update custom report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
