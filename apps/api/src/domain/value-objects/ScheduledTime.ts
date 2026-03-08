/**
 * Domain Layer - ScheduledTime Value Object
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Represents an immutable scheduled publication time with validation.
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Minimum scheduling lead time in milliseconds (5 minutes)
 */
const MIN_LEAD_TIME_MS = 5 * 60 * 1000;

/**
 * Maximum scheduling horizon in milliseconds (1 year)
 */
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

export type Timezone =
  | "UTC"
  | "America/New_York"
  | "America/Los_Angeles"
  | "America/Chicago"
  | "America/Denver"
  | "America/Mexico_City"
  | "America/Sao_Paulo"
  | "America/Buenos_Aires"
  | "Europe/London"
  | "Europe/Paris"
  | "Europe/Berlin"
  | "Europe/Madrid"
  | "Europe/Rome"
  | "Asia/Tokyo"
  | "Asia/Shanghai"
  | "Asia/Hong_Kong"
  | "Asia/Singapore"
  | "Asia/Dubai"
  | "Asia/Seoul"
  | "Australia/Sydney"
  | "Pacific/Auckland"
  | (string & {});

/**
 * ScheduledTime construction properties
 */
export interface ScheduledTimeProps {
  dateTime: Date;
  timezone?: Timezone;
}

/**
 * ScheduledTime - Immutable value object representing a scheduled publication time
 *
 * @example
 * const scheduledTime = ScheduledTime.create({
 *   dateTime: new Date('2025-12-01T10:00:00Z'),
 *   timezone: 'America/New_York'
 * });
 */
export class ScheduledTime {
  private readonly _dateTime: Date;
  private readonly _timezone: Timezone;

  private constructor(dateTime: Date, timezone: Timezone) {
    this._dateTime = dateTime;
    this._timezone = timezone;
  }

  /**
   * Create a new ScheduledTime with validation
   */
  static create(props: ScheduledTimeProps): Result<ScheduledTime, InvalidValueError> {
    const { dateTime, timezone = "UTC" } = props;

    // Validate dateTime is a valid Date object
    if (!(dateTime instanceof Date) || isNaN(dateTime.getTime())) {
      return err(new InvalidValueError("dateTime", dateTime, "Invalid date"));
    }

    // Validate dateTime is in the future
    const now = new Date();
    if (dateTime.getTime() <= now.getTime()) {
      return err(
        new InvalidValueError(
          "dateTime",
          dateTime.toISOString(),
          "Scheduled time must be in the future"
        )
      );
    }

    // Validate minimum lead time
    const leadTime = dateTime.getTime() - now.getTime();
    if (leadTime < MIN_LEAD_TIME_MS) {
      return err(
        new InvalidValueError(
          "dateTime",
          dateTime.toISOString(),
          `Scheduled time must be at least 5 minutes in the future`
        )
      );
    }

    // Validate maximum horizon
    if (leadTime > MAX_HORIZON_MS) {
      return err(
        new InvalidValueError(
          "dateTime",
          dateTime.toISOString(),
          `Scheduled time cannot be more than 1 year in the future`
        )
      );
    }

    // Validate timezone exists (basic check)
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return err(new InvalidValueError("timezone", timezone, `Invalid timezone: "${timezone}"`));
    }

    return ok(new ScheduledTime(new Date(dateTime.getTime()), timezone));
  }

  /**
   * Create a ScheduledTime from an ISO string
   */
  static fromISOString(
    isoString: string,
    timezone: Timezone = "UTC"
  ): Result<ScheduledTime, InvalidValueError> {
    const dateTime = new Date(isoString);
    if (isNaN(dateTime.getTime())) {
      return err(new InvalidValueError("isoString", isoString, "Invalid ISO date string"));
    }
    return ScheduledTime.create({ dateTime, timezone });
  }

  /**
   * Create a ScheduledTime for now + specified minutes
   */
  static fromNowPlusMinutes(
    minutes: number,
    timezone: Timezone = "UTC"
  ): Result<ScheduledTime, InvalidValueError> {
    if (minutes < 5) {
      return err(new InvalidValueError("minutes", minutes, "Minutes must be at least 5"));
    }

    const dateTime = new Date(Date.now() + minutes * 60 * 1000);
    return ScheduledTime.create({ dateTime, timezone });
  }

  /**
   * Reconstitute a ScheduledTime from persistence (bypasses validation)
   * Use this only when loading from database where the time may be in the past.
   */
  static reconstitute(dateTime: Date, timezone: Timezone = "UTC"): ScheduledTime {
    return new ScheduledTime(new Date(dateTime.getTime()), timezone);
  }

  /**
   * Getters
   */
  get dateTime(): Date {
    // Return a copy to maintain immutability
    return new Date(this._dateTime.getTime());
  }

  get timezone(): Timezone {
    return this._timezone;
  }

  /**
   * Get the timestamp in milliseconds
   */
  get timestamp(): number {
    return this._dateTime.getTime();
  }

  /**
   * Get ISO string representation
   */
  toISOString(): string {
    return this._dateTime.toISOString();
  }

  /**
   * Get formatted string in the specified timezone
   */
  toFormattedString(options?: Intl.DateTimeFormatOptions): string {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: this._timezone,
      timeZoneName: "short",
    };

    return this._dateTime.toLocaleString("en-US", { ...defaultOptions, ...options });
  }

  /**
   * Check if the scheduled time has passed
   */
  hasPassed(): boolean {
    return this._dateTime.getTime() < Date.now();
  }

  /**
   * Check if the scheduled time is within the next N minutes
   */
  isWithinMinutes(minutes: number): boolean {
    const now = Date.now();
    const target = this._dateTime.getTime();
    const diff = target - now;
    return diff > 0 && diff <= minutes * 60 * 1000;
  }

  /**
   * Get milliseconds until scheduled time
   */
  get millisecondsUntil(): number {
    return Math.max(0, this._dateTime.getTime() - Date.now());
  }

  /**
   * Get minutes until scheduled time
   */
  get minutesUntil(): number {
    return Math.floor(this.millisecondsUntil / (60 * 1000));
  }

  /**
   * Get hours until scheduled time
   */
  get hoursUntil(): number {
    return Math.floor(this.millisecondsUntil / (60 * 60 * 1000));
  }

  /**
   * Create a new ScheduledTime with a different time (immutable update)
   * Note: Must still be in the future
   */
  reschedule(newDateTime: Date): Result<ScheduledTime, InvalidValueError> {
    return ScheduledTime.create({ dateTime: newDateTime, timezone: this._timezone });
  }

  /**
   * Delay the scheduled time by specified minutes (immutable update)
   */
  delay(minutes: number): Result<ScheduledTime, InvalidValueError> {
    if (minutes <= 0) {
      return err(new InvalidValueError("minutes", minutes, "Delay minutes must be positive"));
    }

    const newDateTime = new Date(this._dateTime.getTime() + minutes * 60 * 1000);
    return ScheduledTime.create({ dateTime: newDateTime, timezone: this._timezone });
  }

  /**
   * Equality check
   */
  equals(other: ScheduledTime): boolean {
    return (
      this._dateTime.getTime() === other._dateTime.getTime() && this._timezone === other._timezone
    );
  }

  /**
   * Compare to another ScheduledTime
   * Returns -1 if this is before, 0 if equal, 1 if this is after
   */
  compareTo(other: ScheduledTime): -1 | 0 | 1 {
    const diff = this._dateTime.getTime() - other._dateTime.getTime();
    if (diff < 0) return -1;
    if (diff > 0) return 1;
    return 0;
  }

  toJSON(): Record<string, unknown> {
    return {
      dateTime: this._dateTime.toISOString(),
      timezone: this._timezone,
      timestamp: this._dateTime.getTime(),
    };
  }
}
