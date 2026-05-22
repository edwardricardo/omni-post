/**
 * @file schedulingCsv.ts
 * @description Parses a bulk-scheduling CSV and validates each row up front (Zod
 *              shape + domain value objects), reporting per-row errors without
 *              aborting the batch. Pure function — no DB, no queue, no HTTP. The
 *              enqueue/FlowProducer side (F1-API-3) consumes `validRows`.
 *
 *              Canonical server-side parser: `csv-parse` (Adaltas), same family
 *              as `csv-stringify`. Per-row validation via Zod `safeParse` +
 *              `Provider` / `ScheduledTime` value objects.
 * @layer application
 */

import { parse } from "csv-parse/sync";
import { z } from "zod";
import { Provider } from "../../domain/value-objects/Provider.js";
import { ScheduledTime } from "../../domain/value-objects/ScheduledTime.js";

/** A validated, normalized scheduling row ready for enqueue (F1-API-3). */
export interface SchedulingCsvRow {
  /** 1-based CSV data row number (header excluded) — maps to the batch manifest item. */
  row: number;
  provider: string;
  content: string;
  /** ISO 8601 string (normalized from the parsed date). */
  scheduledFor: string;
  timezone: string;
  title?: string;
  mediaUrls: string[];
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

const REQUIRED_HEADERS = ["provider", "content", "scheduledFor"] as const;

/**
 * Raw row shape (csv-parse with `columns:true` yields string values). Semantic
 * validation (provider/schedule/length) happens in the pipeline, not here.
 */
export const schedulingCsvRowSchema = z.object({
  provider: z.string().min(1, "provider is required"),
  content: z.string().min(1, "content is required"),
  scheduledFor: z.string().min(1, "scheduledFor is required"),
  timezone: z.string().optional(),
  title: z.string().max(280, "title exceeds 280 characters").optional(),
  mediaUrls: z.string().optional(),
  tags: z.string().optional(),
});

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

/**
 * @function parseSchedulingCsv
 * @description Parses the CSV and validates every row up front. A malformed CSV,
 *   missing required headers, or no data rows produce a single `row: 0` error.
 *   Each data row is validated independently — one bad row never aborts the rest.
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
  const missing = REQUIRED_HEADERS.filter((header) => !headerKeys.includes(header));
  if (missing.length > 0) {
    return {
      validRows,
      errors: [{ row: 0, message: `Missing required column(s): ${missing.join(", ")}` }],
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

    const providerResult = Provider.fromString(data.provider);
    if (!providerResult.ok) {
      errors.push({ row, field: "provider", message: providerResult.error.message });
      continue;
    }
    const provider = providerResult.value;

    if (!provider.supportsScheduling()) {
      errors.push({
        row,
        field: "provider",
        message: `Provider ${provider.type} does not support scheduling`,
      });
      continue;
    }

    if (data.content.length > provider.maxCharacters) {
      errors.push({
        row,
        field: "content",
        message: `content exceeds ${provider.maxCharacters} characters for ${provider.type}`,
      });
      continue;
    }

    const timezone = data.timezone && data.timezone.length > 0 ? data.timezone : "UTC";
    const dateTime = new Date(data.scheduledFor);
    const scheduledResult = ScheduledTime.create({ dateTime, timezone });
    if (!scheduledResult.ok) {
      errors.push({ row, field: "scheduledFor", message: scheduledResult.error.message });
      continue;
    }

    const mediaUrls = splitList(data.mediaUrls);
    const invalidUrl = mediaUrls.find((url) => !urlSchema.safeParse(url).success);
    if (invalidUrl !== undefined) {
      errors.push({ row, field: "mediaUrls", message: `Invalid URL: ${invalidUrl}` });
      continue;
    }

    validRows.push({
      row,
      provider: provider.type,
      content: data.content,
      scheduledFor: dateTime.toISOString(),
      timezone,
      ...(data.title !== undefined && data.title.length > 0 && { title: data.title }),
      mediaUrls,
      tags: splitList(data.tags),
    });
  }

  return { validRows, errors, totalDataRows: records.length };
}
