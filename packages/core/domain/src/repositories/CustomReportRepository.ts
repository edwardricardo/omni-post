/**
 * @file CustomReportRepository.ts
 * @description Repository port for CustomReport persistence and querying.
 *   Supports CRUD operations and account-scoped listing.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type CustomReport } from "../entities/CustomReport.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Flat DTO returned by read/query methods.
 */
export interface CustomReportDto {
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
  filters: Record<string, unknown> | null;
  isShared: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flat DTO for ReportSchedule read/query methods.
 */
export interface ReportScheduleDto {
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
 * @interface CustomReportRepository
 * @description Port for CustomReport persistence and querying.
 */
export interface CustomReportRepository {
  /**
   * @method save
   * @description Persist a CustomReport entity (create via Prisma create).
   */
  save(report: CustomReport): Promise<Result<string, Error>>;

  /**
   * @method update
   * @description Update an existing CustomReport by ID.
   */
  update(id: string, data: Record<string, unknown>): Promise<Result<void, Error>>;

  /**
   * @method findById
   * @description Find a CustomReport by its ID.
   */
  findById(id: string): Promise<Result<CustomReportDto, EntityNotFoundError>>;

  /**
   * @method findByAccountId
   * @description List all custom reports for an account as flat DTOs.
   */
  findByAccountId(accountId: string): Promise<CustomReportDto[]>;

  /**
   * @method delete
   * @description Delete a CustomReport by its ID (cascades to schedules).
   */
  delete(id: string): Promise<Result<void, EntityNotFoundError>>;

  /**
   * @method saveSchedule
   * @description Create a new ReportSchedule for a CustomReport.
   */
  saveSchedule(data: {
    reportId: string;
    cronExpression: string;
    timezone: string;
    format: string;
    recipients: string[];
  }): Promise<Result<string, Error>>;

  /**
   * @method findSchedulesByReportId
   * @description List all schedules for a given report.
   */
  findSchedulesByReportId(reportId: string): Promise<ReportScheduleDto[]>;
}
