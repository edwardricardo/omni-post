/**
 * @file RunCustomReportQuery.ts
 * @description Executes a custom report and returns chart-ready data from
 *              real AnalyticsDailySummary aggregations via AnalyticsAggregationQueryPort.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { CustomReportRepository } from "@core/domain/repositories/CustomReportRepository.js";
import type { RunCustomReportInput, RunCustomReportOutput } from "./types.js";
import type {
  AnalyticsAggregationQueryPort,
  AnalyticsSummaryRow,
} from "@core/domain/repositories/AnalyticsAggregationQueryPort.js";
import { metricRegistry, type MetricDefinition } from "@core/domain/analytics/MetricRegistry.js";
import { dimensionRegistry } from "@core/domain/analytics/DimensionRegistry.js";

/**
 * @class RunCustomReportQuery
 * @description Executes a custom report by ID and returns chart-ready data
 *              aggregated from AnalyticsDailySummary. CQRS query — reads only.
 */
export class RunCustomReportQuery implements UseCase<
  RunCustomReportInput,
  RunCustomReportOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly analyticsQuery?: AnalyticsAggregationQueryPort
  ) {}

  /**
   * @method execute
   * @description Runs a custom report and returns chart-ready dataset.
   * @param input - reportId and accountId
   * @returns Result with labels, datasets, and hasData flag
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

      if (!this.analyticsQuery) {
        return ok({ reportId: dto.id, labels: [], datasets: [], hasData: false });
      }

      const { startDate, endDate } = resolveDateRange(
        dto.dateRange,
        dto.dateRangeStart,
        dto.dateRangeEnd
      );

      const channelIds = await this.analyticsQuery.findChannelIdsByAccount(input.accountId);
      if (channelIds.length === 0) {
        return ok({ reportId: dto.id, labels: [], datasets: [], hasData: false });
      }

      const filters = (dto.filters ?? {}) as Record<string, string>;
      const rawData = await this.analyticsQuery.findSummaries({
        channelIds,
        startDate,
        endDate,
        ...(filters.platform ? { platformFilter: filters.platform } : {}),
      });

      if (rawData.length === 0) {
        return ok({ reportId: dto.id, labels: [], datasets: [], hasData: false });
      }

      const primaryDimension = dto.dimensions[0] ?? "date";
      const { labels, datasets } = aggregateByDimension(rawData, primaryDimension, dto.metrics);

      return ok({ reportId: dto.id, labels, datasets, hasData: true });
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

function resolveDateRange(
  dateRange: string,
  dateRangeStart: Date | null,
  dateRangeEnd: Date | null
): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = dateRangeEnd ?? now;

  switch (dateRange) {
    case "LAST_7_DAYS":
      return { startDate: new Date(now.getTime() - 7 * 86400000), endDate };
    case "LAST_30_DAYS":
      return { startDate: new Date(now.getTime() - 30 * 86400000), endDate };
    case "LAST_90_DAYS":
      return { startDate: new Date(now.getTime() - 90 * 86400000), endDate };
    case "LAST_12_MONTHS":
      return { startDate: new Date(now.getTime() - 365 * 86400000), endDate };
    case "CUSTOM":
      return {
        startDate: dateRangeStart ?? new Date(now.getTime() - 30 * 86400000),
        endDate,
      };
    default:
      return { startDate: new Date(now.getTime() - 30 * 86400000), endDate };
  }
}

/**
 * Groups rows by the requested dimension and computes each requested metric
 * per bucket via the governed registries. Unknown metrics are omitted (not
 * emitted as a misleading zero series); an unknown dimension falls back to
 * the default (`date`). Metric/dimension semantics live in one place — the
 * registries — so every consumer gets the same numbers.
 */
function aggregateByDimension(
  rows: AnalyticsSummaryRow[],
  dimension: string,
  metrics: string[]
): { labels: string[]; datasets: { label: string; data: number[] }[] } {
  const dim = dimensionRegistry.resolve(dimension);

  const buckets = new Map<string, AnalyticsSummaryRow[]>();
  for (const row of rows) {
    const key = dim.keyOf(row);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  const labels = Array.from(buckets.keys());
  const datasets = metrics
    .map((metric): MetricDefinition | undefined => metricRegistry.get(metric))
    .filter((def): def is MetricDefinition => def !== undefined)
    .map((def) => ({
      label: def.key,
      data: labels.map((label) => def.aggregate(buckets.get(label) ?? [])),
    }));

  return { labels, datasets };
}
