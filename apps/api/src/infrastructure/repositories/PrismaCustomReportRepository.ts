/**
 * @file PrismaCustomReportRepository.ts
 * @description Prisma adapter implementing the CustomReportRepository port.
 *   Handles persistence, retrieval, and schedule management for CustomReport entities.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import type {
  CustomReportRepository,
  CustomReportDto,
  ReportScheduleDto,
} from "@core/domain/repositories/CustomReportRepository.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import type { CustomReport } from "@core/domain/entities/CustomReport.js";

/**
 * Shape of a raw CustomReport row returned by Prisma.
 */
interface PrismaCustomReportRow {
  id: string;
  accountId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  metrics: string[];
  dimensions: string[];
  dateRange: string;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  chartType: string;
  filters: unknown;
  isShared: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Shape of a raw ReportSchedule row returned by Prisma.
 */
interface PrismaReportScheduleRow {
  id: string;
  reportId: string;
  cronExpression: string;
  timezone: string;
  format: string;
  recipients: string[];
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
}

/**
 * @class PrismaCustomReportRepository
 * @description Infrastructure adapter implementing CustomReportRepository
 *   using Prisma ORM for PostgreSQL persistence.
 */
export class PrismaCustomReportRepository implements CustomReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Persists a new CustomReport entity via Prisma create.
   */
  async save(report: CustomReport): Promise<Result<string, Error>> {
    try {
      const json = report.toJSON();
      const created = await this.prisma.customReport.create({
        data: {
          accountId: json.accountId as string,
          name: json.name as string,
          metrics: json.metrics as string[],
          dimensions: json.dimensions as string[],
          dateRange: (json.dateRange as string) ?? "LAST_30_DAYS",
          chartType: (json.chartType as string as $Enums.ReportChartType) ?? "LINE",
          isShared: (json.isShared as boolean) ?? false,
          createdById: json.createdById as string,
          ...(json.projectId !== undefined && { projectId: json.projectId as string }),
          ...(json.description !== undefined && { description: json.description as string }),
          ...(json.dateRangeStart !== undefined && {
            dateRangeStart: new Date(json.dateRangeStart as string),
          }),
          ...(json.dateRangeEnd !== undefined && {
            dateRangeEnd: new Date(json.dateRangeEnd as string),
          }),
          ...(json.filters !== undefined && {
            filters: json.filters as Prisma.InputJsonValue,
          }),
        },
      });

      return ok(created.id);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method update
   * @description Updates an existing CustomReport by ID.
   */
  async update(id: string, data: Record<string, unknown>): Promise<Result<void, Error>> {
    try {
      const updateData: Record<string, unknown> = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.metrics !== undefined) updateData.metrics = data.metrics;
      if (data.dimensions !== undefined) updateData.dimensions = data.dimensions;
      if (data.dateRange !== undefined) updateData.dateRange = data.dateRange;
      if (data.dateRangeStart !== undefined) updateData.dateRangeStart = data.dateRangeStart;
      if (data.dateRangeEnd !== undefined) updateData.dateRangeEnd = data.dateRangeEnd;
      if (data.chartType !== undefined) {
        updateData.chartType = data.chartType as $Enums.ReportChartType;
      }
      if (data.filters !== undefined) {
        updateData.filters = data.filters as Prisma.InputJsonValue;
      }
      if (data.isShared !== undefined) updateData.isShared = data.isShared;

      await this.prisma.customReport.update({
        where: { id },
        data: updateData,
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method findById
   * @description Finds a CustomReport by its ID.
   */
  async findById(id: string): Promise<Result<CustomReportDto, EntityNotFoundError>> {
    const row = await this.prisma.customReport.findUnique({
      where: { id },
    });

    if (!row) {
      return err(new EntityNotFoundError("CustomReport", id));
    }

    return ok(this.toDto(row as unknown as PrismaCustomReportRow));
  }

  /**
   * @method findByAccountId
   * @description Returns all custom reports for an account as flat DTOs.
   */
  async findByAccountId(accountId: string): Promise<CustomReportDto[]> {
    const rows = await this.prisma.customReport.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => this.toDto(row as unknown as PrismaCustomReportRow));
  }

  /**
   * @method delete
   * @description Deletes a CustomReport by its ID.
   */
  async delete(id: string): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.prisma.customReport.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      return err(new EntityNotFoundError("CustomReport", id));
    }

    await this.prisma.customReport.delete({
      where: { id },
    });

    return ok(undefined);
  }

  /**
   * @method saveSchedule
   * @description Creates a new ReportSchedule for a CustomReport.
   */
  async saveSchedule(data: {
    reportId: string;
    cronExpression: string;
    timezone: string;
    format: string;
    recipients: string[];
  }): Promise<Result<string, Error>> {
    try {
      const schedule = await this.prisma.reportSchedule.create({
        data: {
          reportId: data.reportId,
          cronExpression: data.cronExpression,
          timezone: data.timezone,
          format: data.format as $Enums.ReportFormat,
          recipients: data.recipients,
        },
      });

      return ok(schedule.id);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method findSchedulesByReportId
   * @description Lists all schedules for a given report.
   */
  async findSchedulesByReportId(reportId: string): Promise<ReportScheduleDto[]> {
    const rows = await this.prisma.reportSchedule.findMany({
      where: { reportId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => this.toScheduleDto(row as unknown as PrismaReportScheduleRow));
  }

  // -- Private helpers --

  private toDto(row: PrismaCustomReportRow): CustomReportDto {
    const filters =
      row.filters !== null && typeof row.filters === "object" && !Array.isArray(row.filters)
        ? (row.filters as Record<string, unknown>)
        : null;

    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      metrics: row.metrics,
      dimensions: row.dimensions,
      dateRange: row.dateRange,
      dateRangeStart: row.dateRangeStart,
      dateRangeEnd: row.dateRangeEnd,
      chartType: row.chartType,
      filters,
      isShared: row.isShared,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toScheduleDto(row: PrismaReportScheduleRow): ReportScheduleDto {
    return {
      id: row.id,
      reportId: row.reportId,
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      format: row.format,
      recipients: row.recipients,
      isActive: row.isActive,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      createdAt: row.createdAt,
    };
  }
}
