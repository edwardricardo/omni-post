/**
 * @file bulkSchedulingCsvParser.ts
 * @description Browser-safe CSV parser for bulk scheduling uploads.
 *              Uses PapaParse as the tokenizer (browser-compatible), then
 *              validates each row via the SHARED Zod schema and infers
 *              media type via the SHARED extension→MediaType table — both
 *              imported from `@core/bulk-scheduling` without pulling in
 *              `csv-parse` (server-only).
 *
 *              This is the SINGLE source of truth convergence: schema
 *              validation logic stays in the core package; this file only
 *              adds the browser tokenizer layer on top.
 * @layer infrastructure
 */

import Papa from "papaparse";
import {
  REQUIRED_HEADERS,
  MAX_BULK_SCHEDULE_ROWS,
  inferMediaType,
  schedulingCsvRowSchema,
} from "@core/bulk-scheduling/schedulingCsvSchema.js";
import type {
  SchedulingCsvRow,
  SchedulingCsvRowError,
  SchedulingCsvRowMedia,
  ParseSchedulingCsvResult,
} from "@core/bulk-scheduling/schedulingCsvSchema.js";

// Re-export the shared types so callers can import them from this module
// without needing to reference the core package path.
export type {
  SchedulingCsvRow,
  SchedulingCsvRowError,
  SchedulingCsvRowMedia,
  ParseSchedulingCsvResult,
};

// ---------------------------------------------------------------------------
// Internal constants (mirrored from core for runtime-free browser access)
// ---------------------------------------------------------------------------

/** Forbidden columns must not appear in the upload. */
const FORBIDDEN_HEADERS = ["provider", "platform"] as const;

/** Separator used to split multi-value cells (mediaUrls, tags). */
const CELL_SEPARATOR = "|";

// ---------------------------------------------------------------------------
// Helpers
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

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(CELL_SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @function parseClientSchedulingCsv
 * @description Parses and validates a bulk-scheduling CSV in the browser.
 *   Uses PapaParse for tokenization and the shared Zod schema + media-type
 *   table for validation — no drift between client and server rules.
 * @param csv - Raw CSV string (header row + data rows).
 * @returns `{ validRows, errors, totalDataRows }` — never throws.
 */
export function parseClientSchedulingCsv(csv: string): ParseSchedulingCsvResult {
  const validRows: SchedulingCsvRow[] = [];
  const errors: SchedulingCsvRowError[] = [];

  const parseResult = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  const records = parseResult.data;

  if (records.length === 0) {
    return {
      validRows,
      errors: [{ row: 0, message: "CSV has no data rows" }],
      totalDataRows: 0,
    };
  }

  const headerKeys = Object.keys(records[0] ?? {});

  // Reject forbidden columns before required checks — better UX.
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

  const missing = REQUIRED_HEADERS.filter((h) => !headerKeys.includes(h));
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
    const rowNum = i + 1;
    const rawRow = records[i] ?? {};

    const parsed = schedulingCsvRowSchema.safeParse(rawRow);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        errors.push({ row: rowNum, ...(field.length > 0 && { field }), message: issue.message });
      }
      continue;
    }
    const data = parsed.data;

    // Validate scheduledFor is a parseable ISO date.
    const dateTime = new Date(data.scheduledFor);
    if (isNaN(dateTime.getTime())) {
      errors.push({
        row: rowNum,
        field: "scheduledFor",
        message: `Invalid date: ${data.scheduledFor}`,
      });
      continue;
    }

    // Resolve typed media items.
    const rawMediaUrls = splitList(data.mediaUrls);
    const media: SchedulingCsvRowMedia[] = [];
    let mediaError = false;
    for (const url of rawMediaUrls) {
      if (!urlSchema.isValid(url)) {
        errors.push({ row: rowNum, field: "mediaUrls", message: `Invalid URL: ${url}` });
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
          // ignore — urlSchema already validated; this is just for the error message
        }
        errors.push({
          row: rowNum,
          field: "mediaUrls",
          message: `Cannot determine media type from URL: ${url} (unrecognized extension ${ext} — supported: jpg/jpeg/png/webp/bmp/heic/heif/gif/mp4/mov/m4v/webm/avi/mkv)`,
        });
        mediaError = true;
        break;
      }
      media.push({ url, type: mediaType });
    }
    if (mediaError) continue;

    const timezone = data.timezone && data.timezone.length > 0 ? data.timezone : "UTC";

    validRows.push({
      row: rowNum,
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

/**
 * @function generateClientCsvTemplate
 * @description Returns a CSV template string with content-pure headers and
 *   two example rows. No `provider` or `platform` column.
 */
export function generateClientCsvTemplate(): string {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19) + "Z";
  const dayAfter = new Date(Date.now() + 172_800_000).toISOString().slice(0, 19) + "Z";
  const headers = "content,scheduledFor,timezone,title,mediaUrls,tags";
  const row1 = `"Check out our latest update!",${tomorrow},America/New_York,,, `;
  const row2 = `"Behind the scenes look at what we're building",${dayAfter},America/New_York,"Launch Day",https://example.com/image.jpg,launch|product`;
  return [headers, row1, row2].join("\n");
}
