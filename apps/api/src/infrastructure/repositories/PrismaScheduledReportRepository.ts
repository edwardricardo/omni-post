/**
 * @file PrismaScheduledReportRepository.ts
 * @description Prisma adapter implementing the ScheduledReportRepository port.
 *   Handles persistence, retrieval, and due-report querying for ScheduledReport entities.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import type {
  ScheduledReportRepository,
  ScheduledReportDto,
} from "../../domain/repositories/ScheduledReportRepository.js";
import {
  ScheduledReport,
  type ScheduledReportProps,
} from "../../domain/entities/ScheduledReport.js";
import { ScheduledReportId, ProjectId } from "../../domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "../../domain/errors/index.js";

/**
 * Shape of a raw ScheduledReport row returned by Prisma.
 */
interface PrismaScheduledReportRow {
  id: string;
  projectId: string;
  name: string;
  cronSchedule: string;
  format: string;
  recipients: string[];
  filters: unknown;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaScheduledReportRepository
 * @description Infrastructure adapter implementing ScheduledReportRepository
 *   using Prisma ORM for PostgreSQL persistence.
 */
export class PrismaScheduledReportRepository implements ScheduledReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Persists a ScheduledReport entity via upsert.
   */
  async save(report: ScheduledReport): Promise<Result<void, Error>> {
    try {
      const data = {
        projectId: report.projectId.value,
        name: report.name,
        cronSchedule: report.cronSchedule,
        format: report.format as $Enums.ReportFormat,
        recipients: report.recipients,
        filters: report.filters as Prisma.InputJsonValue,
        isActive: report.isActive,
        ...(report.lastRunAt !== undefined && { lastRunAt: report.lastRunAt }),
        ...(report.nextRunAt !== undefined && { nextRunAt: report.nextRunAt }),
      };

      await this.prisma.scheduledReport.upsert({
        where: { id: report.id.value },
        create: {
          id: report.id.value,
          ...data,
        },
        update: {
          ...data,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method findById
   * @description Finds a ScheduledReport by its domain ID and reconstitutes it.
   */
  async findById(id: ScheduledReportId): Promise<Result<ScheduledReport, EntityNotFoundError>> {
    const row = await this.prisma.scheduledReport.findUnique({
      where: { id: id.value },
    });

    if (!row) {
      return err(new EntityNotFoundError("ScheduledReport", id.value));
    }

    return ok(this.toDomain(row as unknown as PrismaScheduledReportRow));
  }

  /**
   * @method findByProjectId
   * @description Returns all reports for a project as flat DTOs.
   */
  async findByProjectId(projectId: string): Promise<ScheduledReportDto[]> {
    const rows = await this.prisma.scheduledReport.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => this.toDto(row as unknown as PrismaScheduledReportRow));
  }

  /**
   * @method findDueReports
   * @description Returns active reports whose nextRunAt <= now.
   */
  async findDueReports(now: Date): Promise<ScheduledReportDto[]> {
    const rows = await this.prisma.scheduledReport.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
      orderBy: { nextRunAt: "asc" },
    });

    return rows.map((row) => this.toDto(row as unknown as PrismaScheduledReportRow));
  }

  /**
   * @method delete
   * @description Deletes a ScheduledReport by its ID.
   */
  async delete(id: ScheduledReportId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.prisma.scheduledReport.findUnique({
      where: { id: id.value },
      select: { id: true },
    });

    if (!exists) {
      return err(new EntityNotFoundError("ScheduledReport", id.value));
    }

    await this.prisma.scheduledReport.delete({
      where: { id: id.value },
    });

    return ok(undefined);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method toDomain
   * @description Reconstitutes a ScheduledReport entity from a raw Prisma row.
   */
  private toDomain(row: PrismaScheduledReportRow): ScheduledReport {
    const filters =
      row.filters !== null && typeof row.filters === "object" && !Array.isArray(row.filters)
        ? (row.filters as Record<string, unknown>)
        : {};

    const props: ScheduledReportProps = {
      id: ScheduledReportId.fromStringUnsafe(row.id),
      projectId: ProjectId.fromStringUnsafe(row.projectId),
      name: row.name,
      cronSchedule: row.cronSchedule,
      format: row.format,
      recipients: row.recipients,
      filters,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.lastRunAt !== null && { lastRunAt: row.lastRunAt }),
      ...(row.nextRunAt !== null && { nextRunAt: row.nextRunAt }),
    };

    return ScheduledReport.fromPersistence(props);
  }

  /**
   * @method toDto
   * @description Maps a raw Prisma row to a flat ScheduledReportDto.
   */
  private toDto(row: PrismaScheduledReportRow): ScheduledReportDto {
    const filters =
      row.filters !== null && typeof row.filters === "object" && !Array.isArray(row.filters)
        ? (row.filters as Record<string, unknown>)
        : {};

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      cronSchedule: row.cronSchedule,
      format: row.format,
      recipients: row.recipients,
      filters,
      isActive: row.isActive,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
