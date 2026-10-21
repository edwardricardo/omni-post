/**
 * @file ScheduledTime.ts
 * @description Value object representing a scheduled publication time — immutable, validated with minimum lead time and maximum horizon constraints.
 * @layer domain
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
   * @method create
   * @description Creates a ScheduledTime after validating the date, its lead time of at least five
   *   minutes and its horizon of at most one year, both measured from `now`, and the timezone.
   * @param props - The date and time to schedule, and its timezone (UTC when omitted)
   * @param now - The instant the lead time and the horizon are measured from; the current time when omitted
   * @returns Result containing the ScheduledTime on success, InvalidValueError on failure
   */
  static create(
    props: ScheduledTimeProps,
    now: Date = new Date()
  ): Result<ScheduledTime, InvalidValueError> {
    const { dateTime, timezone = "UTC" } = props;

    // Validate dateTime is a valid Date object
    if (!(dateTime instanceof Date) || isNaN(dateTime.getTime())) {
      return err(new InvalidValueError("dateTime", dateTime, "Invalid date"));
    }

    // An invalid reference instant turns every comparison below into one against NaN, and each of
    // those is false, so any date at all would pass.
    if (!(now instanceof Date) || isNaN(now.getTime())) {
      return err(new InvalidValueError("now", now, "Invalid date"));
    }

    // Validate dateTime is in the future
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
   * @method fromISOString
   * @description Creates a ScheduledTime from an ISO 8601 string, validated against the current
   *   time as `create` validates it.
   * @param isoString - The date and time to schedule, as an ISO 8601 string
   * @param timezone - The timezone of the scheduled time; UTC when omitted
   * @returns Result containing the ScheduledTime on success, InvalidValueError on failure
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
   * @method fromNowPlusMinutes
   * @description Creates a ScheduledTime the given number of minutes after the current time.
   * @param minutes - How many minutes from now to schedule; at least 5
   * @param timezone - The timezone of the scheduled time; UTC when omitted
   * @returns Result containing the ScheduledTime on success, InvalidValueError on failure
   */
  static fromNowPlusMinutes(
    minutes: number,
    timezone: Timezone = "UTC"
  ): Result<ScheduledTime, InvalidValueError> {
    if (minutes < 5) {
      return err(new InvalidValueError("minutes", minutes, "Minutes must be at least 5"));
    }

    // One clock read: the date and its lead-time check measure from the same instant, so a
    // millisecond that passes between two reads cannot leave exactly five minutes one short.
    const now = new Date();
    const dateTime = new Date(now.getTime() + minutes * 60 * 1000);
    return ScheduledTime.create({ dateTime, timezone }, now);
  }

  /**
   * @method reconstitute
   * @description Rebuilds a ScheduledTime loaded from persistence without validation, because a
   *   stored time may already be in the past.
   * @param dateTime - The stored date and time
   * @param timezone - The stored timezone; UTC when omitted
   * @returns The ScheduledTime holding a copy of the given date
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
   * @method toISOString
   * @description Returns the scheduled time as an ISO 8601 string in UTC.
   * @returns The ISO 8601 representation of the scheduled time
   */
  toISOString(): string {
    return this._dateTime.toISOString();
  }

  /**
   * @method toFormattedString
   * @description Formats the scheduled time for the en-US locale in its own timezone.
   * @param options - Intl formatting options that override the default date, time and timezone name
   * @returns The formatted scheduled time
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
   * @method hasPassed
   * @description Tells whether the scheduled time is before the current time.
   * @returns True when the scheduled time has passed
   */
  hasPassed(): boolean {
    return this._dateTime.getTime() < Date.now();
  }

  /**
   * @method isWithinMinutes
   * @description Tells whether the scheduled time falls within the next given number of minutes.
   * @param minutes - The window, in minutes from the current time
   * @returns True when the scheduled time is in the future and at most `minutes` away
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
   * @method reschedule
   * @description Creates a ScheduledTime at a new date in the same timezone, validated against the
   *   current time as `create` validates it.
   * @param newDateTime - The new date and time to schedule
   * @returns Result containing the new ScheduledTime on success, InvalidValueError on failure
   */
  reschedule(newDateTime: Date): Result<ScheduledTime, InvalidValueError> {
    return ScheduledTime.create({ dateTime: newDateTime, timezone: this._timezone });
  }

  /**
   * @method delay
   * @description Creates a ScheduledTime the given number of minutes later, in the same timezone.
   * @param minutes - How many minutes to move the scheduled time later; must be positive
   * @returns Result containing the delayed ScheduledTime on success, InvalidValueError on failure
   */
  delay(minutes: number): Result<ScheduledTime, InvalidValueError> {
    if (minutes <= 0) {
      return err(new InvalidValueError("minutes", minutes, "Delay minutes must be positive"));
    }

    const newDateTime = new Date(this._dateTime.getTime() + minutes * 60 * 1000);
    return ScheduledTime.create({ dateTime: newDateTime, timezone: this._timezone });
  }

  /**
   * @method equals
   * @description Compares two scheduled times by instant and timezone.
   * @param other - The scheduled time to compare with
   * @returns True when both the instant and the timezone match
   */
  equals(other: ScheduledTime): boolean {
    return (
      this._dateTime.getTime() === other._dateTime.getTime() && this._timezone === other._timezone
    );
  }

  /**
   * @method compareTo
   * @description Orders this scheduled time against another by instant, ignoring the timezone.
   * @param other - The scheduled time to compare with
   * @returns `-1` when this is before `other`, `0` when they are at the same instant, `1` when this is after it
   */
  compareTo(other: ScheduledTime): -1 | 0 | 1 {
    const diff = this._dateTime.getTime() - other._dateTime.getTime();
    if (diff < 0) return -1;
    if (diff > 0) return 1;
    return 0;
  }

  /**
   * @method toJSON
   * @description Serializes the scheduled time as its ISO string, timezone and timestamp.
   * @returns A plain object with `dateTime`, `timezone` and `timestamp`
   */
  toJSON(): Record<string, unknown> {
    return {
      dateTime: this._dateTime.toISOString(),
      timezone: this._timezone,
      timestamp: this._dateTime.getTime(),
    };
  }
}
