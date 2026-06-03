/**
 * @file schedulingCsv.ts
 * @description Server-side bulk-scheduling CSV parser. Validates structural
 *              requirements (required headers, row cap, per-row Zod shape) and
 *              infers media type from URL file extension. Per-row validation is
 *              independent — one bad row never aborts the rest.
 *
 *              Provider/scheduling validation is intentionally absent here;
 *              it moves to ConfirmBulkScheduleUseCase once channels are selected.
 *
 *              Server-side tokenizer: csv-parse (Adaltas, server-only).
 *              The pure Zod schema + media-type table live in `schedulingCsvSchema.ts`
 *              (runtime-free) so the browser can import them without pulling in
 *              csv-parse.
 * @layer application
 */

import { parse } from "csv-parse/sync";

import {
  REQUIRED_HEADERS,
  MAX_BULK_SCHEDULE_ROWS,
  inferMediaType,
  schedulingCsvRowSchema,
} from "./schedulingCsvSchema.js";

import type {
  SchedulingCsvRowMedia,
  SchedulingCsvRow,
  SchedulingCsvRowError,
  ParseSchedulingCsvResult,
} from "./schedulingCsvSchema.js";

// Re-export everything from the runtime-free schema module so callers that
// import from `schedulingCsv` still get the full public surface.
export {
  REQUIRED_HEADERS,
  MAX_BULK_SCHEDULE_ROWS,
  inferMediaType,
  schedulingCsvRowSchema,
} from "./schedulingCsvSchema.js";

export { MEDIA_TYPE_BY_EXTENSION } from "./schedulingCsvSchema.js";

export type {
  SchedulingCsvRowMedia,
  SchedulingCsvRow,
  SchedulingCsvRowError,
  ParseSchedulingCsvResult,
} from "./schedulingCsvSchema.js";

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Forbidden columns that must not appear in the upload. */
const FORBIDDEN_HEADERS = ["provider", "platform"] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const urlSchema = {
  isValid: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
};

/** Split a `|`-separated cell into a trimmed, non-empty list. */
function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * @function parseSchedulingCsv
 * @description Parses the CSV and validates every row up front. A malformed CSV,
 *   missing required headers, forbidden columns (provider), or exceeding the row
 *   cap produce a single `row: 0` error. Each data row is validated independently
 *   — one bad row never aborts the rest.
 * @param csv - Raw CSV text (header row + data rows).
 * @returns `{ validRows, errors, totalDataRows }` — never throws.
 */
export function parseSchedulingCsv(csv: string): ParseSchedulingCsvResult {
  const validRows: SchedulingCsvRow[] = [];
  const errors: SchedulingCsvRowError[] = [];

  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      validRows,
      errors: [{ row: 0, message: `Malformed CSV: ${message}` }],
      totalDataRows: 0,
    };
  }

  if (records.length === 0) {
    return { validRows, errors: [{ row: 0, message: "CSV has no data rows" }], totalDataRows: 0 };
  }

  const headerKeys = Object.keys(records[0] ?? {});

  // Reject forbidden columns before checking required ones — better UX.
  const forbidden = FORBIDDEN_HEADERS.filter((h) => headerKeys.includes(h));
  if (forbidden.length > 0) {
    return {
      validRows,
      errors: [
        {
          row: 0,
          message: `Forbidden column(s) detected: ${forbidden.join(", ")}. The CSV must not include a provider or platform column — target channels are selected at confirm time.`,
        },
      ],
      totalDataRows: records.length,
    };
  }

  const missing = REQUIRED_HEADERS.filter((header) => !headerKeys.includes(header));
  if (missing.length > 0) {
    return {
      validRows,
      errors: [{ row: 0, message: `Missing required column(s): ${missing.join(", ")}` }],
      totalDataRows: records.length,
    };
  }

  // Hard row cap.
  if (records.length > MAX_BULK_SCHEDULE_ROWS) {
    return {
      validRows,
      errors: [
        {
          row: 0,
          message: `CSV exceeds the ${MAX_BULK_SCHEDULE_ROWS}-row limit (${records.length} rows)`,
        },
      ],
      totalDataRows: records.length,
    };
  }

  for (let i = 0; i < records.length; i++) {
    const row = i + 1; // 1-based, header excluded
    const rawRow = records[i] ?? {};

    const parsed = schedulingCsvRowSchema.safeParse(rawRow);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        errors.push({ row, ...(field.length > 0 && { field }), message: issue.message });
      }
      continue;
    }
    const data = parsed.data;

    // Validate scheduledFor is a parseable date (structural only).
    const dateTime = new Date(data.scheduledFor);
    if (isNaN(dateTime.getTime())) {
      errors.push({ row, field: "scheduledFor", message: `Invalid date: ${data.scheduledFor}` });
      continue;
    }

    // Resolve media items with type inference.
    const rawMediaUrls = splitList(data.mediaUrls);
    const media: SchedulingCsvRowMedia[] = [];
    let mediaError = false;
    for (const url of rawMediaUrls) {
      if (!urlSchema.isValid(url)) {
        errors.push({ row, field: "mediaUrls", message: `Invalid URL: ${url}` });
        mediaError = true;
        break;
      }
      const mediaType = inferMediaType(url);
      if (mediaType === null) {
        let ext = "(none)";
        try {
          const pathname = new URL(url).pathname;
          const lastDot = pathname.lastIndexOf(".");
          if (lastDot !== -1) ext = pathname.slice(lastDot);
        } catch {
          // ignore
        }
        errors.push({
          row,
          field: "mediaUrls",
          message: `Cannot determine media type from URL: ${url} (unrecognized extension ${ext} — supported: jpg/jpeg/png/webp/bmp/heic/heif/gif/mp4/mov/m4v/webm/avi/mkv)`,
        });
        mediaError = true;
        break;
      }
      media.push({ url, type: mediaType });
    }
    if (mediaError) {
      continue;
    }

    const timezone = data.timezone && data.timezone.length > 0 ? data.timezone : "UTC";

    validRows.push({
      row,
      content: data.content,
      scheduledFor: dateTime.toISOString(),
      timezone,
      ...(data.title !== undefined && data.title.length > 0 && { title: data.title }),
      media,
      tags: splitList(data.tags),
    });
  }

  return { validRows, errors, totalDataRows: records.length };
}
