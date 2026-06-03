/**
 * @file schedulingCsv.ts
 * @description Content-pure bulk-scheduling CSV parser. Validates structural
 *              requirements (required headers, row cap, per-row Zod shape) and
 *              infers media type from URL file extension. Per-row validation is
 *              independent — one bad row never aborts the rest.
 *
 *              Provider/scheduling validation is intentionally absent here;
 *              it moves to ConfirmBulkScheduleUseCase once channels are selected.
 *
 *              Server-side tokenizer: csv-parse (Adaltas). The pure Zod schema +
 *              media-type table are importable by the client (PR3) without
 *              importing csv-parse (server-only).
 * @layer application
 */

import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { MediaType } from "@core/domain/value-objects/MediaAttachment.js";

// ---------------------------------------------------------------------------
// Shared constants — importable by client without pulling in csv-parse
// ---------------------------------------------------------------------------

/** Required CSV headers — no provider column. */
export const REQUIRED_HEADERS = ["content", "scheduledFor"] as const;

/** Forbidden columns that must not appear in the upload. */
const FORBIDDEN_HEADERS = ["provider", "platform"] as const;

/** Maximum rows per upload (hard cap). */
export const MAX_BULK_SCHEDULE_ROWS = 5000;

// ---------------------------------------------------------------------------
// Media-type extension table (single source of truth for client + server)
// ---------------------------------------------------------------------------

/**
 * @description Extension → MediaType mapping table (case-insensitive).
 *   Client may import this object directly without importing csv-parse.
 *   Fallback for unrecognized extensions = per-row blocked error (no default).
 */
export const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, MediaType>> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  bmp: "image",
  heic: "image",
  heif: "image",
  gif: "gif",
  mp4: "video",
  mov: "video",
  m4v: "video",
  webm: "video",
  avi: "video",
  mkv: "video",
};

/**
 * @function inferMediaType
 * @description Infer MediaType from a URL by extracting its path extension.
 *   Strips query strings before extraction. Returns the MediaType or null when
 *   the extension is absent or unrecognized.
 * @param url - A URL string (already validated as a valid URL).
 * @returns The MediaType or null for unrecognized/absent extensions.
 */
export function inferMediaType(url: string): MediaType | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const lastDot = pathname.lastIndexOf(".");
  if (lastDot === -1) {
    return null;
  }
  const ext = pathname.slice(lastDot + 1).toLowerCase();
  return MEDIA_TYPE_BY_EXTENSION[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Shared Zod row schema (client-importable without csv-parse)
// ---------------------------------------------------------------------------

/**
 * Raw row shape (csv-parse with `columns:true` yields string values).
 * Provider-free. Structural validation only — semantic validation (char cap,
 * scheduling constraints) happens at ConfirmBulkScheduleUseCase.
 */
export const schedulingCsvRowSchema = z.object({
  content: z.string().min(1, "content is required"),
  scheduledFor: z.string().min(1, "scheduledFor is required"),
  timezone: z.string().optional(),
  title: z.string().max(280, "title exceeds 280 characters").optional(),
  mediaUrls: z.string().optional(),
  tags: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A single media item with resolved type. */
export interface SchedulingCsvRowMedia {
  readonly url: string;
  readonly type: MediaType;
}

/** A validated, content-pure scheduling row ready for the confirm phase. */
export interface SchedulingCsvRow {
  /** 1-based CSV data row number (header excluded) — maps to the batch manifest item. */
  row: number;
  content: string;
  /** ISO 8601 string (normalized from the parsed date). */
  scheduledFor: string;
  timezone: string;
  title?: string;
  /** Typed media items with resolved MediaType. */
  media: SchedulingCsvRowMedia[];
  tags: string[];
}

/** A per-row (or header/parse-level) validation error. */
export interface SchedulingCsvRowError {
  /** 1-based data row number; `0` for header/parse-level errors. */
  row: number;
  field?: string;
  message: string;
}

/** Outcome of parsing+validating a scheduling CSV. */
export interface ParseSchedulingCsvResult {
  validRows: SchedulingCsvRow[];
  errors: SchedulingCsvRowError[];
  totalDataRows: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const urlSchema = z.string().url();

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
      if (!urlSchema.safeParse(url).success) {
        errors.push({ row, field: "mediaUrls", message: `Invalid URL: ${url}` });
        mediaError = true;
        break;
      }
      const mediaType = inferMediaType(url);
      if (mediaType === null) {
        const lastDot = new URL(url).pathname.lastIndexOf(".");
        const ext = lastDot !== -1 ? new URL(url).pathname.slice(lastDot) : "(none)";
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
