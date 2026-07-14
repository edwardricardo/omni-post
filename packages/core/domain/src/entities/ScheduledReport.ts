/**
 * @file ScheduledReport.ts
 * @description Domain entity for scheduled analytics reports.
 *   Represents a recurring report configuration with cron scheduling,
 *   format selection, and recipient management.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { ScheduledReportId, ProjectId } from "../value-objects/EntityId.js";
import { DomainError } from "../errors/index.js";

/**
 * Error for invalid scheduled report configuration
 */
class InvalidScheduledReportError extends DomainError {
  constructor(message: string) {
    super(message, "INVALID_SCHEDULED_REPORT");
  }
}

/**
 * Props for reconstituting a ScheduledReport from persistence
 */
export interface ScheduledReportProps extends EntityProps {
  id: ScheduledReportId;
  accountId: string;
  projectId: ProjectId;
  name: string;
  cronSchedule: string;
  format: string;
  recipients: string[];
  filters: Record<string, unknown>;
  isActive: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

/**
 * Props for creating a new ScheduledReport
 */
export interface ScheduledReportCreateProps {
  accountId: string;
  projectId: ProjectId;
  name: string;
  cronSchedule: string;
  format?: string;
  recipients: string[];
  filters?: Record<string, unknown>;
}

// Basic cron validation: 5 space-separated fields
const CRON_REGEX = /^(\S+\s+){4}\S+$/;

/**
 * ScheduledReport Entity
 *
 * Represents a recurring analytics report that is generated on a cron
 * schedule and delivered to a list of recipients via email.
 */
export class ScheduledReport extends Entity<ScheduledReportId> {
  private readonly _accountId: string;
  private readonly _projectId: ProjectId;
  private readonly _name: string;
  private _cronSchedule: string;
  private _format: string;
  private _recipients: string[];
  private _filters: Record<string, unknown>;
  private _isActive: boolean;
  private _lastRunAt?: Date;
  private _nextRunAt?: Date;

  private constructor(props: ScheduledReportProps) {
    super(props.id, props.createdAt);
    this._accountId = props.accountId;
    this._projectId = props.projectId;
    this._name = props.name;
    this._cronSchedule = props.cronSchedule;
    this._format = props.format;
    this._recipients = [...props.recipients];
    this._filters = { ...props.filters };
    this._isActive = props.isActive;
    if (props.lastRunAt !== undefined) {
      this._lastRunAt = props.lastRunAt;
    }
    if (props.nextRunAt !== undefined) {
      this._nextRunAt = props.nextRunAt;
    }
    if (props.updatedAt !== undefined) {
      this._updatedAt = props.updatedAt;
    }
  }

  /**
   * @method create
   * @description Factory method for creating a new ScheduledReport entity.
   *   Validates name, recipients, and cron format before construction.
   * @param props - Creation parameters
   * @returns Result containing the entity or a validation error
   */
  static create(
    props: ScheduledReportCreateProps
  ): Result<ScheduledReport, InvalidScheduledReportError> {
    if (!props.name || props.name.trim().length === 0) {
      return err(new InvalidScheduledReportError("Report name must not be empty"));
    }

    if (!props.recipients || props.recipients.length === 0) {
      return err(new InvalidScheduledReportError("At least one recipient is required"));
    }

    if (!CRON_REGEX.test(props.cronSchedule)) {
      return err(
        new InvalidScheduledReportError(
          `Invalid cron schedule: ${props.cronSchedule}. Expected 5 space-separated fields.`
        )
      );
    }

    const format = props.format ?? "CSV";
    if (format !== "CSV" && format !== "JSON") {
      return err(
        new InvalidScheduledReportError(`Invalid format: ${format}. Must be CSV or JSON.`)
      );
    }

    const now = new Date();
    const nextRunAt = computeNextRun(props.cronSchedule, now);

    return ok(
      new ScheduledReport({
        id: ScheduledReportId.generate(),
        accountId: props.accountId,
        projectId: props.projectId,
        name: props.name.trim(),
        cronSchedule: props.cronSchedule,
        format,
        recipients: [...props.recipients],
        filters: props.filters ? { ...props.filters } : {},
        isActive: true,
        ...(nextRunAt !== undefined && { nextRunAt }),
      })
    );
  }

  /**
   * @method fromPersistence
   * @description Reconstitutes a ScheduledReport entity from stored data.
   * @param props - Persistence properties
   * @returns A fully hydrated ScheduledReport entity
   */
  static fromPersistence(props: ScheduledReportProps): ScheduledReport {
    return new ScheduledReport(props);
  }

  // -- Getters --

  /**
   * @description Owning account id, denormalized from the parent project.
   *   Server-derived and tenant-scoping only — never exposed via `toJSON`.
   */
  get accountId(): string {
    return this._accountId;
  }
  get projectId(): ProjectId {
    return this._projectId;
  }
  get name(): string {
    return this._name;
  }
  get cronSchedule(): string {
    return this._cronSchedule;
  }
  get format(): string {
    return this._format;
  }
  get recipients(): string[] {
    return [...this._recipients];
  }
  get filters(): Record<string, unknown> {
    return { ...this._filters };
  }
  get isActive(): boolean {
    return this._isActive;
  }
  get lastRunAt(): Date | undefined {
    return this._lastRunAt;
  }
  get nextRunAt(): Date | undefined {
    return this._nextRunAt;
  }
  get entityType(): string {
    return "ScheduledReport";
  }

  // -- Commands --

  /**
   * @method activate
   * @description Activates the report schedule.
   */
  activate(): void {
    this._isActive = true;
    this._nextRunAt = computeNextRun(this._cronSchedule, new Date());
    this.markUpdated();
  }

  /**
   * @method deactivate
   * @description Deactivates the report schedule.
   */
  deactivate(): void {
    this._isActive = false;
    this.markUpdated();
  }

  /**
   * @method updateSchedule
   * @description Updates the cron schedule and optionally the recipients list.
   * @param cronSchedule - New cron expression
   * @param recipients - Optional new recipients list
   */
  updateSchedule(cronSchedule: string, recipients?: string[]): void {
    this._cronSchedule = cronSchedule;
    if (recipients !== undefined) {
      this._recipients = [...recipients];
    }
    this._nextRunAt = computeNextRun(cronSchedule, new Date());
    this.markUpdated();
  }

  /**
   * @method recordExecution
   * @description Records that the report was executed, updating lastRunAt
   *   and computing the next scheduled run time.
   */
  recordExecution(): void {
    const now = new Date();
    this._lastRunAt = now;
    this._nextRunAt = computeNextRun(this._cronSchedule, now);
    this.markUpdated();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      projectId: this._projectId.value,
      name: this._name,
      cronSchedule: this._cronSchedule,
      format: this._format,
      recipients: this._recipients,
      filters: this._filters,
      isActive: this._isActive,
      ...(this._lastRunAt !== undefined && { lastRunAt: this._lastRunAt.toISOString() }),
      ...(this._nextRunAt !== undefined && { nextRunAt: this._nextRunAt.toISOString() }),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}

/**
 * Simplified next-run calculator based on cron expression.
 * Parses the minute and hour fields to compute the next occurrence.
 * Falls back to 1 hour from now for complex expressions.
 */
function computeNextRun(cronSchedule: string, from: Date): Date {
  const parts = cronSchedule.split(/\s+/);
  const next = new Date(from.getTime());

  // Try to parse simple minute/hour values
  const minutePart = parts[0];
  const hourPart = parts[1];

  if (minutePart && hourPart && /^\d+$/.test(minutePart) && /^\d+$/.test(hourPart)) {
    const minute = parseInt(minutePart, 10);
    const hour = parseInt(hourPart, 10);
    next.setMinutes(minute, 0, 0);
    next.setHours(hour);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  // Fallback: schedule 1 hour from now
  next.setTime(from.getTime() + 60 * 60 * 1000);
  return next;
}
