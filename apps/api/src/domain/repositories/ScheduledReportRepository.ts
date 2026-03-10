/**
 * @file ScheduledReportRepository.ts
 * @description Command and query repository port for ScheduledReport persistence.
 *   Supports CRUD operations and a query for due (ready-to-execute) reports.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type ScheduledReport } from "../entities/ScheduledReport.js";
import { type ScheduledReportId } from "../value-objects/EntityId.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Flat DTO returned by read/query methods.
 */
export interface ScheduledReportDto {
  id: string;
  projectId: string;
  name: string;
  cronSchedule: string;
  format: string;
  recipients: string[];
  filters: Record<string, unknown>;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @interface ScheduledReportRepository
 * @description Port for ScheduledReport persistence and querying.
 */
export interface ScheduledReportRepository {
  /**
   * @method save
   * @description Persist a ScheduledReport entity (create or update).
   */
  save(report: ScheduledReport): Promise<Result<void, Error>>;

  /**
   * @method findById
   * @description Find a ScheduledReport by its domain ID.
   */
  findById(id: ScheduledReportId): Promise<Result<ScheduledReport, EntityNotFoundError>>;

  /**
   * @method findByProjectId
   * @description List all reports for a project as flat DTOs.
   */
  findByProjectId(projectId: string): Promise<ScheduledReportDto[]>;

  /**
   * @method findDueReports
   * @description Find active reports whose nextRunAt is at or before the given timestamp.
   */
  findDueReports(now: Date): Promise<ScheduledReportDto[]>;

  /**
   * @method delete
   * @description Delete a ScheduledReport by its domain ID.
   */
  delete(id: ScheduledReportId): Promise<Result<void, EntityNotFoundError>>;
}
