/**
 * @file schedulingCsvParser.ts
 * @description CSV parsing and validation for bulk scheduling uploads.
 *              Parses rows with date/time/timezone/platform/copy/media_url/campaign columns.
 * @layer infrastructure/frontend
 */

import Papa from "papaparse";

/** Valid platform identifiers (lowercase) */
export const VALID_PLATFORMS = [
  "x",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "snapchat",
  "telegram",
  "pinterest",
  "linkedin",
  "bluesky",
] as const;

export type ValidPlatform = (typeof VALID_PLATFORMS)[number];

/** A single row from the CSV after parsing */
export interface CsvRow {
  date: string;
  time: string;
  timezone: string;
  platform: string;
  copy: string;
  media_url?: string;
  campaign?: string;
}

/** A validated and parsed scheduling row */
export interface ValidatedCsvRow {
  /** Raw row data */
  raw: CsvRow;
  /** Row index (1-based) */
  rowIndex: number;
  /** Whether the row passed all validations */
  isValid: boolean;
  /** Validation error message if invalid */
  error?: string;
  /** Parsed date object (only set when isValid = true) */
  parsedDate?: Date;
  /** Day of week 0–6 (only set when isValid = true) */
  dayOfWeek?: number;
  /** Hour 0–23 (only set when isValid = true) */
  hour?: number;
  /** Minute 0–59 (only set when isValid = true) */
  minute?: number;
  /** Normalized platform name (only set when isValid = true) */
  normalizedPlatform?: ValidPlatform;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;
const EMAIL_SAFE_PLATFORMS = new Set<string>(VALID_PLATFORMS);

/**
 * @function parseSchedulingCsv
 * @description Parses a CSV string and validates each row against the scheduling schema.
 * @param csvText - Raw CSV text content
 * @returns Array of ValidatedCsvRow (valid and invalid rows together)
 */
export function parseSchedulingCsv(csvText: string): ValidatedCsvRow[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
    transform: (value) => value.trim(),
  });

  return result.data.map((row, index): ValidatedCsvRow => {
    const rowIndex = index + 1;

    const raw: CsvRow = {
      date: row["date"] ?? "",
      time: row["time"] ?? "",
      timezone: row["timezone"] ?? "UTC",
      platform: row["platform"] ?? "",
      copy: row["copy"] ?? "",
      ...(row["media_url"] !== undefined &&
        row["media_url"] !== "" && {
          media_url: row["media_url"],
        }),
      ...(row["campaign"] !== undefined &&
        row["campaign"] !== "" && {
          campaign: row["campaign"],
        }),
    };

    // Validate required fields
    if (!raw.date) {
      return { raw, rowIndex, isValid: false, error: "Missing required field: date" };
    }
    if (!DATE_REGEX.test(raw.date)) {
      return {
        raw,
        rowIndex,
        isValid: false,
        error: `Invalid date format: "${raw.date}". Expected YYYY-MM-DD`,
      };
    }
    if (!raw.time) {
      return { raw, rowIndex, isValid: false, error: "Missing required field: time" };
    }
    if (!TIME_REGEX.test(raw.time)) {
      return {
        raw,
        rowIndex,
        isValid: false,
        error: `Invalid time format: "${raw.time}". Expected HH:MM`,
      };
    }
    if (!raw.platform) {
      return { raw, rowIndex, isValid: false, error: "Missing required field: platform" };
    }

    const normalizedPlatform = raw.platform.toLowerCase();
    if (!EMAIL_SAFE_PLATFORMS.has(normalizedPlatform)) {
      return {
        raw,
        rowIndex,
        isValid: false,
        error: `Invalid platform: "${raw.platform}". Must be one of: ${VALID_PLATFORMS.join(", ")}`,
      };
    }

    // Parse date and time
    const [year, month, day] = raw.date.split("-").map(Number) as [number, number, number];
    const [hour, minute] = raw.time.split(":").map(Number) as [number, number];

    // Validate numeric ranges
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { raw, rowIndex, isValid: false, error: `Invalid date values in "${raw.date}"` };
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { raw, rowIndex, isValid: false, error: `Invalid time values in "${raw.time}"` };
    }

    const parsedDate = new Date(year, month - 1, day, hour, minute);
    if (isNaN(parsedDate.getTime())) {
      return {
        raw,
        rowIndex,
        isValid: false,
        error: `Cannot parse date/time: ${raw.date} ${raw.time}`,
      };
    }

    return {
      raw,
      rowIndex,
      isValid: true,
      parsedDate,
      dayOfWeek: parsedDate.getDay(),
      hour,
      minute,
      normalizedPlatform: normalizedPlatform as ValidPlatform,
    };
  });
}

/**
 * @function generateCsvTemplate
 * @description Returns a CSV template string with headers and two example rows.
 */
export function generateCsvTemplate(): string {
  const headers = "date,time,timezone,platform,copy,media_url,campaign";
  const example1 = `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)},09:00,America/New_York,x,"Check out our latest update! 🚀",,launch`;
  const example2 = `${new Date(Date.now() + 172800000).toISOString().slice(0, 10)},14:00,America/New_York,instagram,"Behind the scenes look at what we're building",https://example.com/image.jpg,launch`;
  return [headers, example1, example2].join("\n");
}
