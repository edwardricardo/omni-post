/**
 * @file schedulingCsvSchema.ts
 * @description The bulk-scheduling CSV contract and its one parser, free of any
 *              tokenizer import so the browser can load it: required and forbidden
 *              headers, the row and byte caps, the Zod row schema, the media-type table, and
 *              `parseSchedulingCsvWith`, which validates the records a tokenizer
 *              passed in returns. The server wrapper (`parseSchedulingCsv` in
 *              `schedulingCsv.ts`) passes csv-parse's Node build; the browser
 *              wrapper (`apps/client/lib/csv/bulkSchedulingCsvParser.ts`) passes its
 *              browser build. Both run it with the same options, so both return the
 *              same result for the same text.
 *
 *              Exported: REQUIRED_HEADERS, FORBIDDEN_HEADERS, MAX_BULK_SCHEDULE_ROWS,
 *                        MAX_BULK_SCHEDULE_CSV_BYTES, MEDIA_TYPE_BY_EXTENSION, inferMediaType,
 *                        schedulingCsvRowSchema, parseSchedulingCsvWith,
 *                        and the shared row and tokenizer types.
 * @layer application
 */

import { z } from "zod";
import type { MediaType } from "@core/domain/value-objects/MediaAttachment.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Required CSV headers — no provider column. */
export const REQUIRED_HEADERS = ["content", "scheduledFor"] as const;

/** Columns that must not appear in the upload: channels are chosen at confirm time. */
export const FORBIDDEN_HEADERS = ["provider", "platform"] as const;

/** Maximum rows per upload (hard cap). */
export const MAX_BULK_SCHEDULE_ROWS = 5000;

/**
 * Maximum size of an upload in UTF-8 bytes (16 MiB). `parseSchedulingCsvWith`
 * refuses a larger CSV before calling the tokenizer, so neither the browser's main
 * thread nor the server tokenizes a file of any size before the row cap applies.
 *
 * This cap bounds CSV bytes. `apps/api/src/bulk-scheduling/bulkScheduleRoutes.ts`
 * derives the route's body limit, which bounds JSON bytes, from it: twice the cap,
 * the most `JSON.stringify` writes for a CSV this parser accepts (see
 * `controlCharacterError`), plus the envelope around it. Every CSV within this cap
 * therefore reaches the parser and gets its typed answer, and a body over the
 * route's limit is a 413 by construction.
 */
export const MAX_BULK_SCHEDULE_CSV_BYTES = 16 * 1024 * 1024;

/** Separator of the multi-value cells (`mediaUrls`, `tags`). */
const CELL_SEPARATOR = "|";

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

// ---------------------------------------------------------------------------
// Tokenizer contract
// ---------------------------------------------------------------------------

/**
 * The csv-parse options every scheduling CSV is tokenized with, and the only ones:
 * any other csv-parse option is left at its default by design, because adding one
 * changes the server's and the browser's parse at once, so it lands with a case in
 * the client's parity corpus. Those defaults, not the three options below, are what
 * make only a comma delimit (`delimiter` unset), a quote open a quoted cell (`quote`
 * unset), and a row whose cell count differs from the header's make the tokenizer
 * throw (`relax_column_count` unset, so `false`).
 */
export interface SchedulingCsvTokenizerOptions {
  /** `columns: true` — the first row names the columns, and each record is keyed by them. */
  readonly columns: true;
  /** `skip_empty_lines: true` — a blank line yields no record; with `trim`, neither does a whitespace-only line. */
  readonly skip_empty_lines: true;
  /** `trim: true` — whitespace around each cell is dropped; whitespace inside quotes is kept. */
  readonly trim: true;
}

/**
 * The `parse` of csv-parse's sync builds, typed structurally so this module
 * imports neither build: `csv-parse/sync` on the server, `csv-parse/browser/esm/sync`
 * in the browser. It throws on text it cannot tokenize; the parser reports the
 * throw by its `code` and `lines`, never by its `message`. Under these options
 * csv-parse gives every record every header key; a record that lacks one is
 * validated like any other and fails the row schema on that field.
 */
export type SchedulingCsvTokenizer = (
  input: string,
  options: SchedulingCsvTokenizerOptions
) => Record<string, string>[];

/**
 * Held here, not by either wrapper, so the server and the browser cannot drift; typed
 * as literals and checked with `satisfies`, so it cannot widen away from the
 * interface's `true` types even without an annotation.
 */
const TOKENIZER_OPTIONS = {
  columns: true,
  skip_empty_lines: true,
  trim: true,
} as const satisfies SchedulingCsvTokenizerOptions;

/** Measures the byte cap; the browser and Node both define `TextEncoder`, which encodes UTF-8. */
const UTF8_ENCODER = new TextEncoder();

/** The most UTF-8 bytes one UTF-16 code unit encodes to, reached by every character from U+0800 to U+FFFF. */
const UTF8_MAX_BYTES_PER_UTF16_UNIT = 3;

/** The UTF-16 code units the control-character rule names; C0 is every unit below `SPACE`. */
const CHARACTER = { TAB: 0x09, LINE_FEED: 0x0a, CARRIAGE_RETURN: 0x0d, SPACE: 0x20 } as const;

/**
 * A csv-parse error code: an upper-case identifier, which carries nothing of the
 * input. A code of any other shape, from a future csv-parse or another tokenizer,
 * is never echoed: the message says only that an unrecognized error occurred.
 */
const TOKENIZER_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** True when `url` parses as an absolute URL. */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Split a `|`-separated cell into a trimmed, non-empty list. */
function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(CELL_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The extension named in an unrecognized-media error, or `(none)`. */
function extensionOf(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf(".");
    return lastDot === -1 ? "(none)" : pathname.slice(lastDot);
  } catch {
    return "(none)";
  }
}

/**
 * The row-0 message of a CSV the tokenizer rejected: `Malformed CSV`, then
 * csv-parse's error `code` when it is an upper-case identifier, or
 * `(unrecognized tokenizer error)` when a code of another shape is present, then
 * ` at line <n> of the file` when `lines` is a whole number. `lines` counts physical
 * lines of the file, header included, where a data error's `row` counts data
 * records, header excluded; a tokenizer error has no data row, so its `row` is 0
 * and the line is named as a line of the file. The thrown `message` is never used:
 * csv-parse quotes the input in some of them (`INVALID_OPENING_QUOTE` holds the cell
 * read so far, `CSV_INVALID_CLOSING_QUOTE` the character after the quote), and the
 * result is returned to the uploader and may be logged.
 */
function describeTokenizerError(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "Malformed CSV";
  }
  const rawCode = "code" in error ? error.code : undefined;
  let code = "";
  if (typeof rawCode === "string" && TOKENIZER_ERROR_CODE.test(rawCode)) {
    code = `: ${rawCode}`;
  } else if (rawCode !== undefined) {
    code = " (unrecognized tokenizer error)";
  }
  const line =
    "lines" in error && typeof error.lines === "number" && Number.isInteger(error.lines)
      ? ` at line ${error.lines} of the file`
      : "";
  return `Malformed CSV${code}${line}`;
}

/**
 * The row-0 error of a CSV over `MAX_BULK_SCHEDULE_CSV_BYTES`, or `null` when it fits,
 * measured without encoding the whole text whenever its length decides. A UTF-16 code
 * unit encodes to 1 to `UTF8_MAX_BYTES_PER_UTF16_UNIT` UTF-8 bytes: a lone surrogate
 * to the 3-byte replacement character, and a surrogate pair, two units, to 4 bytes,
 * under its 6-byte bound; so `csv.length <= bytes <= 3 * csv.length`, and every
 * character from U+0800 to U+FFFF reaches the upper bound. More code units than the
 * cap is therefore over it, refused in O(1) with `csv.length` as a lower bound of its
 * size; at most a third of the cap in code units is within it, accepted in O(1); only
 * a length in between is encoded, an allocation of at most three times the cap
 * whatever the size of the upload.
 */
function byteCapError(csv: string): SchedulingCsvRowError | null {
  const limit = `CSV exceeds the ${MAX_BULK_SCHEDULE_CSV_BYTES}-byte limit`;
  if (csv.length > MAX_BULK_SCHEDULE_CSV_BYTES) {
    return { row: 0, message: `${limit} (at least ${csv.length} bytes)` };
  }
  if (csv.length * UTF8_MAX_BYTES_PER_UTF16_UNIT <= MAX_BULK_SCHEDULE_CSV_BYTES) {
    return null;
  }
  const bytes = UTF8_ENCODER.encode(csv).byteLength;
  return bytes > MAX_BULK_SCHEDULE_CSV_BYTES
    ? { row: 0, message: `${limit} (${bytes} bytes)` }
    : null;
}

/**
 * The row-0 error of a CSV holding a C0 control character other than tab, line feed
 * and carriage return, the characters XML 1.0 also excludes from text, or `null`. No
 * post content needs them, and refusing them bounds what `JSON.stringify` writes for
 * an accepted CSV to two bytes per UTF-8 byte: it writes each of them as a six-byte
 * `\uXXXX`, and `"`, `\`, tab, line feed and carriage return as two-byte escapes. The
 * API's body limit is derived from that factor. The line is counted by line breaks: a
 * line feed, and a carriage return not followed by one.
 */
function controlCharacterError(csv: string): SchedulingCsvRowError | null {
  let line = 1;
  for (let index = 0; index < csv.length; index++) {
    const unit = csv.charCodeAt(index);
    if (unit >= CHARACTER.SPACE) {
      continue;
    }
    const nextIsLineFeed = csv.charCodeAt(index + 1) === CHARACTER.LINE_FEED;
    if (unit === CHARACTER.LINE_FEED || (unit === CHARACTER.CARRIAGE_RETURN && !nextIsLineFeed)) {
      line += 1;
    } else if (unit !== CHARACTER.TAB && unit !== CHARACTER.CARRIAGE_RETURN) {
      const codePoint = `U+${unit.toString(16).toUpperCase().padStart(4, "0")}`;
      return {
        row: 0,
        message: `CSV contains control character ${codePoint} at line ${line} of the file; only tab, line feed and carriage return are allowed`,
      };
    }
  }
  return null;
}

/**
 * @function parseSchedulingCsvWith
 * @description Refuses a CSV larger than `MAX_BULK_SCHEDULE_CSV_BYTES` in UTF-8, or
 *   holding a C0 control character other than tab, line feed and carriage return,
 *   without tokenizing it, then tokenizes the CSV with the tokenizer passed in and
 *   validates it. Each of those, text the tokenizer rejects (reported as
 *   `Malformed CSV: <code> at line <n> of the file`), a CSV with no data rows, a
 *   forbidden column (`provider`, `platform`), a missing required header or more rows
 *   than the row cap produce a single `row: 0` error. Each data row is then validated
 *   on its own: one bad row never aborts the rest. Within a row, `mediaUrls` is
 *   checked in cell order and stops at the first failing URL, so a row carries at
 *   most one media error.
 * @param csv - Raw CSV text (header row + data rows).
 * @param tokenize - csv-parse's sync `parse`, from the build the caller's runtime loads.
 * @returns `{ validRows, errors, totalDataRows }` — never throws.
 */
export function parseSchedulingCsvWith(
  csv: string,
  tokenize: SchedulingCsvTokenizer
): ParseSchedulingCsvResult {
  const validRows: SchedulingCsvRow[] = [];
  const errors: SchedulingCsvRowError[] = [];

  const textError = byteCapError(csv) ?? controlCharacterError(csv);
  if (textError !== null) {
    return { validRows, errors: [textError], totalDataRows: 0 };
  }

  let records: Record<string, string>[];
  try {
    records = tokenize(csv, TOKENIZER_OPTIONS);
  } catch (error: unknown) {
    return {
      validRows,
      errors: [{ row: 0, message: describeTokenizerError(error) }],
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
    const parsed = schedulingCsvRowSchema.safeParse(records[i] ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        errors.push({ row, ...(field.length > 0 && { field }), message: issue.message });
      }
      continue;
    }
    const data = parsed.data;

    // Structural check only: the date must parse.
    const dateTime = new Date(data.scheduledFor);
    if (isNaN(dateTime.getTime())) {
      errors.push({ row, field: "scheduledFor", message: `Invalid date: ${data.scheduledFor}` });
      continue;
    }

    const media: SchedulingCsvRowMedia[] = [];
    let mediaError: SchedulingCsvRowError | null = null;
    for (const url of splitList(data.mediaUrls)) {
      if (!isValidUrl(url)) {
        mediaError = { row, field: "mediaUrls", message: `Invalid URL: ${url}` };
        break;
      }
      const mediaType = inferMediaType(url);
      if (mediaType === null) {
        mediaError = {
          row,
          field: "mediaUrls",
          message: `Cannot determine media type from URL: ${url} (unrecognized extension ${extensionOf(url)} — supported: jpg/jpeg/png/webp/bmp/heic/heif/gif/mp4/mov/m4v/webm/avi/mkv)`,
        };
        break;
      }
      media.push({ url, type: mediaType });
    }
    if (mediaError !== null) {
      errors.push(mediaError);
      continue;
    }

    validRows.push({
      row,
      content: data.content,
      scheduledFor: dateTime.toISOString(),
      timezone: data.timezone && data.timezone.length > 0 ? data.timezone : "UTC",
      ...(data.title !== undefined && data.title.length > 0 && { title: data.title }),
      media,
      tags: splitList(data.tags),
    });
  }

  return { validRows, errors, totalDataRows: records.length };
}
