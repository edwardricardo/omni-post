/**
 * @file RunCustomReportQuery.ts
 * @description Executes a custom report and returns chart-ready mock data.
 *   Real data aggregation from analytics tables is a future enhancement.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomReportRepository } from "../../domain/repositories/CustomReportRepository.js";
import type { RunCustomReportInput, RunCustomReportOutput } from "./types.js";

/**
 * @class RunCustomReportQuery
 * @description Executes a custom report by ID and returns chart-ready data.
 *   Currently returns mock data; real analytics aggregation is planned.
 */
export class RunCustomReportQuery implements UseCase<
  RunCustomReportInput,
  RunCustomReportOutput,
  UseCaseError
> {
  constructor(private readonly repository: CustomReportRepository) {}

  /**
   * @method execute
   * @description Runs a custom report and returns chart-ready dataset.
   * @param input - reportId and accountId
   * @returns Result with labels and datasets for chart rendering
   */
  async execute(input: RunCustomReportInput): Promise<Result<RunCustomReportOutput, UseCaseError>> {
    try {
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

      if (dto.accountId !== input.accountId && !dto.isShared) {
        return err(
          new UseCaseError(
            "Access denied: report belongs to a different account",
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }

      // Generate mock chart-ready data based on report configuration
      const labels = generateLabels(dto.dateRange, dto.dimensions);
      const datasets = dto.metrics.map((metric) => ({
        label: metric,
        data: labels.map(() => Math.floor(Math.random() * 1000)),
      }));

      return ok({
        reportId: dto.id,
        labels,
        datasets,
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to run custom report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}

/**
 * Generates placeholder labels based on the date range and primary dimension.
 */
function generateLabels(dateRange: string, dimensions: string[]): string[] {
  const primaryDimension = dimensions[0] ?? "date";

  if (primaryDimension === "platform") {
    return ["Twitter/X", "Instagram", "Facebook", "LinkedIn", "TikTok"];
  }

  if (primaryDimension === "post_type") {
    return ["Text", "Image", "Video", "Carousel", "Story"];
  }

  if (primaryDimension === "campaign") {
    return ["Campaign A", "Campaign B", "Campaign C"];
  }

  // Default: date-based labels
  switch (dateRange) {
    case "LAST_7_DAYS":
      return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    case "LAST_30_DAYS":
      return Array.from({ length: 4 }, (_, i) => `Week ${i + 1}`);
    case "LAST_90_DAYS":
      return ["Month 1", "Month 2", "Month 3"];
    case "LAST_12_MONTHS":
      return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    default:
      return Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`);
  }
}
