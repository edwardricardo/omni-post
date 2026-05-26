/**
 * @file CustomReport.ts
 * @description Domain entity for custom report builder. Validates metrics, dimensions,
 *   date range configuration, and chart type. Uses raw string IDs since Prisma model
 *   uses cuid() for primary keys.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { DomainError } from "../errors/index.js";
import {
  isValidMetric,
  isValidDimension,
  isValidDateRange,
  isValidChartType,
  type MetricKey,
  type DimensionKey,
  type DateRangePreset,
  type ChartType,
} from "../analytics/ReportSchema.js";

/**
 * Error for invalid custom report configuration
 */
export class InvalidCustomReportError extends DomainError {
  constructor(message: string) {
    super(message, "INVALID_CUSTOM_REPORT");
  }
}

/**
 * Props for reconstituting a CustomReport from persistence
 */
export interface CustomReportProps {
  readonly id: string;
  readonly accountId: string;
  readonly projectId?: string;
  readonly name: string;
  readonly description?: string;
  readonly metrics: MetricKey[];
  readonly dimensions: DimensionKey[];
  readonly dateRange: DateRangePreset;
  readonly dateRangeStart?: Date;
  readonly dateRangeEnd?: Date;
  readonly chartType: ChartType;
  readonly filters?: Record<string, unknown>;
  readonly isShared: boolean;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Props for creating a new CustomReport
 */
export interface CreateCustomReportInput {
  readonly accountId: string;
  readonly projectId?: string;
  readonly name: string;
  readonly description?: string;
  readonly metrics: string[];
  readonly dimensions: string[];
  readonly dateRange?: string;
  readonly dateRangeStart?: Date;
  readonly dateRangeEnd?: Date;
  readonly chartType?: string;
  readonly filters?: Record<string, unknown>;
  readonly isShared?: boolean;
  readonly createdById: string;
}

/**
 * Props for updating an existing CustomReport
 */
export interface UpdateCustomReportInput {
  readonly name?: string;
  readonly description?: string;
  readonly metrics?: string[];
  readonly dimensions?: string[];
  readonly dateRange?: string;
  readonly dateRangeStart?: Date;
  readonly dateRangeEnd?: Date;
  readonly chartType?: string;
  readonly filters?: Record<string, unknown>;
  readonly isShared?: boolean;
}

/**
 * CustomReport Entity
 *
 * Represents a user-configured analytics report with selectable metrics,
 * dimensions, date ranges, and chart visualization options.
 */
export class CustomReport {
  private _name: string;
  private _description?: string;
  private _metrics: MetricKey[];
  private _dimensions: DimensionKey[];
  private _dateRange: DateRangePreset;
  private _dateRangeStart?: Date;
  private _dateRangeEnd?: Date;
  private _chartType: ChartType;
  private _filters?: Record<string, unknown>;
  private _isShared: boolean;
  private _updatedAt: Date;

  private constructor(private readonly props: CustomReportProps) {
    this._name = props.name;
    this._metrics = [...props.metrics];
    this._dimensions = [...props.dimensions];
    this._dateRange = props.dateRange;
    this._chartType = props.chartType;
    this._isShared = props.isShared;
    this._updatedAt = props.updatedAt;
    if (props.description !== undefined) {
      this._description = props.description;
    }
    if (props.dateRangeStart !== undefined) {
      this._dateRangeStart = props.dateRangeStart;
    }
    if (props.dateRangeEnd !== undefined) {
      this._dateRangeEnd = props.dateRangeEnd;
    }
    if (props.filters !== undefined) {
      this._filters = { ...props.filters };
    }
  }

  // -- Factory Methods --

  /**
   * @method create
   * @description Factory method for creating a new CustomReport entity.
   *   Validates name, metrics, dimensions, date range, and chart type.
   * @param input - Creation parameters
   * @returns Result containing the entity or a validation error
   */
  static create(input: CreateCustomReportInput): Result<CustomReport, InvalidCustomReportError> {
    if (!input.name || input.name.trim().length === 0) {
      return err(new InvalidCustomReportError("Report name must not be empty"));
    }

    if (input.name.trim().length > 200) {
      return err(new InvalidCustomReportError("Report name must not exceed 200 characters"));
    }

    if (!input.metrics || input.metrics.length === 0) {
      return err(new InvalidCustomReportError("At least one metric is required"));
    }

    const invalidMetrics = input.metrics.filter((m) => !isValidMetric(m));
    if (invalidMetrics.length > 0) {
      return err(new InvalidCustomReportError(`Unknown metrics: ${invalidMetrics.join(", ")}`));
    }

    if (!input.dimensions || input.dimensions.length === 0) {
      return err(new InvalidCustomReportError("At least one dimension is required"));
    }

    const invalidDimensions = input.dimensions.filter((d) => !isValidDimension(d));
    if (invalidDimensions.length > 0) {
      return err(
        new InvalidCustomReportError(`Unknown dimensions: ${invalidDimensions.join(", ")}`)
      );
    }

    const dateRange = input.dateRange ?? "LAST_30_DAYS";
    if (!isValidDateRange(dateRange)) {
      return err(new InvalidCustomReportError(`Invalid date range: ${dateRange}`));
    }

    if (dateRange === "CUSTOM") {
      if (!input.dateRangeStart || !input.dateRangeEnd) {
        return err(
          new InvalidCustomReportError(
            "CUSTOM date range requires both dateRangeStart and dateRangeEnd"
          )
        );
      }
      if (input.dateRangeStart >= input.dateRangeEnd) {
        return err(new InvalidCustomReportError("dateRangeStart must be before dateRangeEnd"));
      }
    }

    const chartType = input.chartType ?? "LINE";
    if (!isValidChartType(chartType)) {
      return err(new InvalidCustomReportError(`Invalid chart type: ${chartType}`));
    }

    const now = new Date();

    return ok(
      new CustomReport({
        id: "",
        accountId: input.accountId,
        name: input.name.trim(),
        metrics: input.metrics as MetricKey[],
        dimensions: input.dimensions as DimensionKey[],
        dateRange: dateRange as DateRangePreset,
        chartType: chartType as ChartType,
        isShared: input.isShared ?? false,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.dateRangeStart !== undefined && { dateRangeStart: input.dateRangeStart }),
        ...(input.dateRangeEnd !== undefined && { dateRangeEnd: input.dateRangeEnd }),
        ...(input.filters !== undefined && { filters: input.filters }),
      })
    );
  }

  /**
   * @method reconstitute
   * @description Reconstitutes a CustomReport entity from stored data.
   * @param props - Persistence properties
   * @returns A fully hydrated CustomReport entity
   */
  static reconstitute(props: CustomReportProps): CustomReport {
    return new CustomReport(props);
  }

  // -- Getters --

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get projectId(): string | undefined {
    return this.props.projectId;
  }
  get name(): string {
    return this._name;
  }
  get description(): string | undefined {
    return this._description;
  }
  get metrics(): MetricKey[] {
    return [...this._metrics];
  }
  get dimensions(): DimensionKey[] {
    return [...this._dimensions];
  }
  get dateRange(): DateRangePreset {
    return this._dateRange;
  }
  get dateRangeStart(): Date | undefined {
    return this._dateRangeStart;
  }
  get dateRangeEnd(): Date | undefined {
    return this._dateRangeEnd;
  }
  get chartType(): ChartType {
    return this._chartType;
  }
  get filters(): Record<string, unknown> | undefined {
    return this._filters ? { ...this._filters } : undefined;
  }
  get isShared(): boolean {
    return this._isShared;
  }
  get createdById(): string {
    return this.props.createdById;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  // -- Commands --

  /**
   * @method update
   * @description Partially updates report configuration with validation.
   * @param data - Fields to update
   * @returns Result<void> on success, InvalidCustomReportError on failure
   */
  update(data: UpdateCustomReportInput): Result<void, InvalidCustomReportError> {
    if (data.name !== undefined) {
      if (data.name.trim().length === 0) {
        return err(new InvalidCustomReportError("Report name must not be empty"));
      }
      if (data.name.trim().length > 200) {
        return err(new InvalidCustomReportError("Report name must not exceed 200 characters"));
      }
    }

    if (data.metrics !== undefined) {
      if (data.metrics.length === 0) {
        return err(new InvalidCustomReportError("At least one metric is required"));
      }
      const invalidMetrics = data.metrics.filter((m) => !isValidMetric(m));
      if (invalidMetrics.length > 0) {
        return err(new InvalidCustomReportError(`Unknown metrics: ${invalidMetrics.join(", ")}`));
      }
    }

    if (data.dimensions !== undefined) {
      if (data.dimensions.length === 0) {
        return err(new InvalidCustomReportError("At least one dimension is required"));
      }
      const invalidDimensions = data.dimensions.filter((d) => !isValidDimension(d));
      if (invalidDimensions.length > 0) {
        return err(
          new InvalidCustomReportError(`Unknown dimensions: ${invalidDimensions.join(", ")}`)
        );
      }
    }

    const effectiveDateRange = data.dateRange ?? this._dateRange;
    if (data.dateRange !== undefined && !isValidDateRange(data.dateRange)) {
      return err(new InvalidCustomReportError(`Invalid date range: ${data.dateRange}`));
    }

    if (effectiveDateRange === "CUSTOM") {
      const effectiveStart = data.dateRangeStart ?? this._dateRangeStart;
      const effectiveEnd = data.dateRangeEnd ?? this._dateRangeEnd;
      if (!effectiveStart || !effectiveEnd) {
        return err(
          new InvalidCustomReportError(
            "CUSTOM date range requires both dateRangeStart and dateRangeEnd"
          )
        );
      }
      if (effectiveStart >= effectiveEnd) {
        return err(new InvalidCustomReportError("dateRangeStart must be before dateRangeEnd"));
      }
    }

    if (data.chartType !== undefined && !isValidChartType(data.chartType)) {
      return err(new InvalidCustomReportError(`Invalid chart type: ${data.chartType}`));
    }

    // Apply validated updates
    if (data.name !== undefined) {
      this._name = data.name.trim();
    }
    if (data.description !== undefined) {
      this._description = data.description;
    }
    if (data.metrics !== undefined) {
      this._metrics = data.metrics as MetricKey[];
    }
    if (data.dimensions !== undefined) {
      this._dimensions = data.dimensions as DimensionKey[];
    }
    if (data.dateRange !== undefined) {
      this._dateRange = data.dateRange as DateRangePreset;
    }
    if (data.dateRangeStart !== undefined) {
      this._dateRangeStart = data.dateRangeStart;
    }
    if (data.dateRangeEnd !== undefined) {
      this._dateRangeEnd = data.dateRangeEnd;
    }
    if (data.chartType !== undefined) {
      this._chartType = data.chartType as ChartType;
    }
    if (data.filters !== undefined) {
      this._filters = { ...data.filters };
    }
    if (data.isShared !== undefined) {
      this._isShared = data.isShared;
    }

    this._updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method toJSON
   * @description Serializes the entity to a plain object.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      accountId: this.props.accountId,
      ...(this.props.projectId !== undefined && { projectId: this.props.projectId }),
      name: this._name,
      ...(this._description !== undefined && { description: this._description }),
      metrics: [...this._metrics],
      dimensions: [...this._dimensions],
      dateRange: this._dateRange,
      ...(this._dateRangeStart !== undefined && {
        dateRangeStart: this._dateRangeStart.toISOString(),
      }),
      ...(this._dateRangeEnd !== undefined && {
        dateRangeEnd: this._dateRangeEnd.toISOString(),
      }),
      chartType: this._chartType,
      ...(this._filters !== undefined && { filters: this._filters }),
      isShared: this._isShared,
      createdById: this.props.createdById,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
