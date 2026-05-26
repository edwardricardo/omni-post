/**
 * @file RecurringPost.ts
 * @description Domain entity for recurring post schedules. A RecurringPost
 *   references a template post and creates new posts from it on a cron schedule.
 *   Supports lifecycle management (activate/deactivate), occurrence tracking,
 *   and limit enforcement.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { RecurringPostId, ProjectId } from "../value-objects/EntityId.js";
import { DomainError, InvalidValueError } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Value Object: CronExpression
// ---------------------------------------------------------------------------

/**
 * Basic cron validation: 5 space-separated fields (minute hour day month weekday)
 */
const CRON_REGEX = /^(\S+\s+){4}\S+$/;

/**
 * @class CronExpression
 * @description Value object that validates and wraps a cron expression string.
 *   Only accepts standard 5-field cron syntax.
 */
export class CronExpression {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * @method create
   * @description Validates and creates a CronExpression value object.
   * @param expression - The raw cron expression string
   * @returns Result containing a valid CronExpression or an error
   */
  static create(expression: string): Result<CronExpression, DomainError> {
    if (!expression || expression.trim().length === 0) {
      return err(
        new InvalidValueError("CronExpression", expression, "Cron expression must not be empty")
      );
    }

    const trimmed = expression.trim();

    if (!CRON_REGEX.test(trimmed)) {
      return err(
        new InvalidValueError(
          "CronExpression",
          trimmed,
          "Invalid cron expression. Expected 5 space-separated fields (minute hour day month weekday)."
        )
      );
    }

    return ok(new CronExpression(trimmed));
  }

  /**
   * @method fromStringUnsafe
   * @description Reconstitutes a CronExpression from persistence without validation.
   */
  static fromStringUnsafe(expression: string): CronExpression {
    return new CronExpression(expression);
  }

  get value(): string {
    return this._value;
  }

  equals(other: CronExpression): boolean {
    return this._value === other._value;
  }
}

// ---------------------------------------------------------------------------
// Content variation type
// ---------------------------------------------------------------------------

const CONTENT_VARIATIONS = ["EXACT", "ROTATED", "AI_GENERATED"] as const;
export type ContentVariation = (typeof CONTENT_VARIATIONS)[number];

function isValidContentVariation(value: string): value is ContentVariation {
  return (CONTENT_VARIATIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Domain Events
// ---------------------------------------------------------------------------

/**
 * Domain event: RecurringPost was activated
 */
export class RecurringPostActivated {
  readonly aggregateId: string;
  readonly occurredAt: Date;

  constructor(recurringPostId: string) {
    this.aggregateId = recurringPostId;
    this.occurredAt = new Date();
  }
}

/**
 * Domain event: RecurringPost was deactivated
 */
export class RecurringPostDeactivated {
  readonly aggregateId: string;
  readonly occurredAt: Date;

  constructor(recurringPostId: string) {
    this.aggregateId = recurringPostId;
    this.occurredAt = new Date();
  }
}

export type RecurringPostEvent = RecurringPostActivated | RecurringPostDeactivated;

// ---------------------------------------------------------------------------
// Entity Props
// ---------------------------------------------------------------------------

/**
 * Props for reconstituting a RecurringPost from persistence
 */
export interface RecurringPostProps extends EntityProps {
  id: RecurringPostId;
  projectId: ProjectId;
  templatePostId: string;
  name: string;
  cronExpression: CronExpression;
  timezone: string;
  startDate: Date;
  endDate?: Date;
  maxOccurrences?: number;
  occurrenceCount: number;
  isActive: boolean;
  lastScheduledAt?: Date;
  nextScheduledAt?: Date;
  channels: string[];
  contentVariation: ContentVariation;
}

/**
 * Props for creating a new RecurringPost
 */
export interface RecurringPostCreateProps {
  projectId: ProjectId;
  templatePostId: string;
  name: string;
  cronExpression: CronExpression;
  timezone?: string;
  startDate: Date;
  endDate?: Date;
  maxOccurrences?: number;
  channels: string[];
  contentVariation?: ContentVariation;
}

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

/**
 * @class RecurringPost
 * @description Entity representing a recurring post schedule that creates
 *   new posts from a template on a cron schedule. Manages lifecycle,
 *   occurrence tracking, and limit enforcement.
 */
export class RecurringPost extends Entity<RecurringPostId> {
  private readonly _projectId: ProjectId;
  private readonly _templatePostId: string;
  private _name: string;
  private _cronExpression: CronExpression;
  private _timezone: string;
  private _startDate: Date;
  private _endDate?: Date;
  private _maxOccurrences?: number;
  private _occurrenceCount: number;
  private _isActive: boolean;
  private _lastScheduledAt?: Date;
  private _nextScheduledAt?: Date;
  private _channels: string[];
  private _contentVariation: ContentVariation;

  private constructor(props: RecurringPostProps) {
    super(props.id, props.createdAt);
    this._projectId = props.projectId;
    this._templatePostId = props.templatePostId;
    this._name = props.name;
    this._cronExpression = props.cronExpression;
    this._timezone = props.timezone;
    this._startDate = props.startDate;
    if (props.endDate !== undefined) {
      this._endDate = props.endDate;
    }
    if (props.maxOccurrences !== undefined) {
      this._maxOccurrences = props.maxOccurrences;
    }
    this._occurrenceCount = props.occurrenceCount;
    this._isActive = props.isActive;
    if (props.lastScheduledAt !== undefined) {
      this._lastScheduledAt = props.lastScheduledAt;
    }
    if (props.nextScheduledAt !== undefined) {
      this._nextScheduledAt = props.nextScheduledAt;
    }
    this._channels = [...props.channels];
    this._contentVariation = props.contentVariation;
    if (props.updatedAt !== undefined) {
      this._updatedAt = props.updatedAt;
    }
  }

  /**
   * @method create
   * @description Factory method for creating a new RecurringPost entity.
   */
  static create(props: RecurringPostCreateProps): Result<RecurringPost, DomainError> {
    if (!props.name || props.name.trim().length === 0) {
      return err(new InvalidValueError("RecurringPost.name", props.name, "Name must not be empty"));
    }

    if (!props.templatePostId || props.templatePostId.trim().length === 0) {
      return err(
        new InvalidValueError(
          "RecurringPost.templatePostId",
          props.templatePostId,
          "Template post ID must not be empty"
        )
      );
    }

    if (props.channels.length === 0) {
      return err(
        new InvalidValueError(
          "RecurringPost.channels",
          "[]",
          "At least one channel must be specified"
        )
      );
    }

    if (props.endDate !== undefined && props.endDate <= props.startDate) {
      return err(
        new InvalidValueError(
          "RecurringPost.endDate",
          props.endDate.toISOString(),
          "End date must be after start date"
        )
      );
    }

    if (props.maxOccurrences !== undefined && props.maxOccurrences <= 0) {
      return err(
        new InvalidValueError(
          "RecurringPost.maxOccurrences",
          String(props.maxOccurrences),
          "Max occurrences must be a positive integer"
        )
      );
    }

    const variation = props.contentVariation ?? "EXACT";

    const now = new Date();
    const nextScheduledAt = computeNextRun(props.cronExpression.value, now);

    return ok(
      new RecurringPost({
        id: RecurringPostId.generate(),
        projectId: props.projectId,
        templatePostId: props.templatePostId,
        name: props.name.trim(),
        cronExpression: props.cronExpression,
        timezone: props.timezone ?? "UTC",
        startDate: props.startDate,
        ...(props.endDate !== undefined && { endDate: props.endDate }),
        ...(props.maxOccurrences !== undefined && { maxOccurrences: props.maxOccurrences }),
        occurrenceCount: 0,
        isActive: true,
        ...(nextScheduledAt !== undefined && { nextScheduledAt }),
        channels: [...props.channels],
        contentVariation: variation,
      })
    );
  }

  /**
   * @method fromPersistence
   * @description Reconstitutes a RecurringPost from stored data.
   */
  static fromPersistence(props: RecurringPostProps): RecurringPost {
    return new RecurringPost(props);
  }

  // -- Getters --

  get projectId(): ProjectId {
    return this._projectId;
  }
  get templatePostId(): string {
    return this._templatePostId;
  }
  get name(): string {
    return this._name;
  }
  get cronExpression(): CronExpression {
    return this._cronExpression;
  }
  get timezone(): string {
    return this._timezone;
  }
  get startDate(): Date {
    return this._startDate;
  }
  get endDate(): Date | undefined {
    return this._endDate;
  }
  get maxOccurrences(): number | undefined {
    return this._maxOccurrences;
  }
  get occurrenceCount(): number {
    return this._occurrenceCount;
  }
  get isActive(): boolean {
    return this._isActive;
  }
  get lastScheduledAt(): Date | undefined {
    return this._lastScheduledAt;
  }
  get nextScheduledAt(): Date | undefined {
    return this._nextScheduledAt;
  }
  get channels(): string[] {
    return [...this._channels];
  }
  get contentVariation(): ContentVariation {
    return this._contentVariation;
  }
  get entityType(): string {
    return "RecurringPost";
  }

  // -- Commands --

  /**
   * @method activate
   * @description Activates the recurring schedule. Recomputes the next occurrence.
   */
  activate(): Result<void, DomainError> {
    if (this.hasReachedLimit()) {
      return err(
        new InvalidValueError(
          "RecurringPost.activate",
          String(this._occurrenceCount),
          "Cannot activate: occurrence limit has been reached"
        )
      );
    }
    this._isActive = true;
    this._nextScheduledAt = computeNextRun(this._cronExpression.value, new Date());
    this.markUpdated();
    return ok(undefined);
  }

  /**
   * @method deactivate
   * @description Deactivates the recurring schedule.
   */
  deactivate(): void {
    this._isActive = false;
    this.markUpdated();
  }

  /**
   * @method recordOccurrence
   * @description Records that one occurrence was created. Increments the counter
   *   and recomputes the next scheduled time. Deactivates if limit is reached.
   */
  recordOccurrence(): void {
    this._occurrenceCount += 1;
    this._lastScheduledAt = new Date();

    if (this.hasReachedLimit()) {
      this._isActive = false;
      return;
    }

    this._nextScheduledAt = computeNextRun(this._cronExpression.value, new Date());
    this.markUpdated();
  }

  /**
   * @method hasReachedLimit
   * @description Returns true if the occurrence count has reached maxOccurrences,
   *   or if the current time is past the endDate.
   */
  hasReachedLimit(): boolean {
    if (this._maxOccurrences !== undefined && this._occurrenceCount >= this._maxOccurrences) {
      return true;
    }
    if (this._endDate !== undefined && new Date() > this._endDate) {
      return true;
    }
    return false;
  }

  /**
   * @method updateDetails
   * @description Updates mutable fields of the recurring post.
   */
  updateDetails(updates: {
    name?: string;
    cronExpression?: CronExpression;
    timezone?: string;
    startDate?: Date;
    endDate?: Date;
    maxOccurrences?: number;
    channels?: string[];
    contentVariation?: string;
  }): Result<void, DomainError> {
    if (updates.name !== undefined) {
      if (updates.name.trim().length === 0) {
        return err(
          new InvalidValueError("RecurringPost.name", updates.name, "Name must not be empty")
        );
      }
      this._name = updates.name.trim();
    }

    if (updates.contentVariation !== undefined) {
      if (!isValidContentVariation(updates.contentVariation)) {
        return err(
          new InvalidValueError(
            "RecurringPost.contentVariation",
            updates.contentVariation,
            "Must be one of: EXACT, ROTATED, AI_GENERATED"
          )
        );
      }
      this._contentVariation = updates.contentVariation;
    }

    if (updates.cronExpression !== undefined) {
      this._cronExpression = updates.cronExpression;
    }
    if (updates.timezone !== undefined) {
      this._timezone = updates.timezone;
    }
    if (updates.startDate !== undefined) {
      this._startDate = updates.startDate;
    }
    if (updates.endDate !== undefined) {
      this._endDate = updates.endDate;
    }
    if (updates.maxOccurrences !== undefined) {
      this._maxOccurrences = updates.maxOccurrences;
    }
    if (updates.channels !== undefined) {
      this._channels = [...updates.channels];
    }

    // Recompute next occurrence if cron changed
    if (updates.cronExpression !== undefined) {
      this._nextScheduledAt = computeNextRun(this._cronExpression.value, new Date());
    }

    this.markUpdated();
    return ok(undefined);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      projectId: this._projectId.value,
      templatePostId: this._templatePostId,
      name: this._name,
      cronExpression: this._cronExpression.value,
      timezone: this._timezone,
      startDate: this._startDate.toISOString(),
      ...(this._endDate !== undefined && { endDate: this._endDate.toISOString() }),
      ...(this._maxOccurrences !== undefined && { maxOccurrences: this._maxOccurrences }),
      occurrenceCount: this._occurrenceCount,
      isActive: this._isActive,
      ...(this._lastScheduledAt !== undefined && {
        lastScheduledAt: this._lastScheduledAt.toISOString(),
      }),
      ...(this._nextScheduledAt !== undefined && {
        nextScheduledAt: this._nextScheduledAt.toISOString(),
      }),
      channels: this._channels,
      contentVariation: this._contentVariation,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Simplified next-run calculator
// ---------------------------------------------------------------------------

/**
 * Parses simple minute/hour fields from a cron expression to compute the next
 * occurrence. Falls back to 1 hour from the reference time for complex patterns.
 */
function computeNextRun(cronExpression: string, from: Date): Date {
  const parts = cronExpression.split(/\s+/);
  const next = new Date(from.getTime());

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

  // Fallback: 1 hour from now
  next.setTime(from.getTime() + 60 * 60 * 1000);
  return next;
}
