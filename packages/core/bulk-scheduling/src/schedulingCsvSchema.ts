/**
 * @file schedulingCsvSchema.ts
 * @description Runtime-free bulk-scheduling CSV schema constants — safe to
 *              import in the browser (no `csv-parse`, no Node-only deps).
 *              The browser CSV parser (`apps/client/lib/csv/bulkSchedulingCsvParser.ts`)
 *              imports from this file; the server parser (`schedulingCsv.ts`)
 *              re-exports from this file to maintain a single source of truth.
 *
 *              Exported: REQUIRED_HEADERS, MAX_BULK_SCHEDULE_ROWS,
 *                        MEDIA_TYPE_BY_EXTENSION, inferMediaType,
 *                        schedulingCsvRowSchema, and shared row types.
 * @layer application
 */

import { z } from "zod";
import type { MediaType } from "@core/domain/value-objects/MediaAttachment.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Required CSV headers — no provider column. */
export const REQUIRED_HEADERS = ["content", "scheduledFor"] as const;

/** Maximum rows per upload (hard cap). */
export const MAX_BULK_SCHEDULE_ROWS = 5000;

// ---------------------------------------------------------------------------
// Media-type extension table (single source of truth for client + server)
// ---------------------------------------------------------------------------

/**
 * @description Extension → MediaType mapping table (case-insensitive).
 *   Browser-safe: no Node imports required.
 *   Fallback for unrecognized extensions = per-row error (no default).
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
 * Raw row shape. Provider-free. Structural validation only.
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
  /** 1-based CSV data row number (header excluded). */
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
