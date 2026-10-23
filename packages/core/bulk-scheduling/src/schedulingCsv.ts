/**
 * @file schedulingCsv.ts
 * @description Server-side bulk-scheduling CSV parser: `parseSchedulingCsv` binds
 *              csv-parse's Node build to the shared parser, `parseSchedulingCsvWith`
 *              in `schedulingCsvSchema.ts`, which holds the header, row-cap, per-row
 *              and media-type rules. The browser binds the same parser to csv-parse's
 *              browser build (`apps/client/lib/csv/bulkSchedulingCsvParser.ts`), so the
 *              two return the same result for the same text.
 *
 *              Provider/scheduling validation is intentionally absent here;
 *              it moves to ConfirmBulkScheduleUseCase once channels are selected.
 *
 *              This module imports `csv-parse/sync`, whose Node build reads the global
 *              `Buffer`; browser code imports `schedulingCsvSchema.ts` instead.
 * @layer application
 */

import { parse } from "csv-parse/sync";

import { parseSchedulingCsvWith } from "./schedulingCsvSchema.js";
import type { ParseSchedulingCsvResult } from "./schedulingCsvSchema.js";

// Re-export everything from the tokenizer-free module so callers that
// import from `schedulingCsv` still get the full public surface.
export {
  REQUIRED_HEADERS,
  FORBIDDEN_HEADERS,
  MAX_BULK_SCHEDULE_ROWS,
  MAX_BULK_SCHEDULE_CSV_BYTES,
  inferMediaType,
  parseSchedulingCsvWith,
  schedulingCsvRowSchema,
} from "./schedulingCsvSchema.js";

export { MEDIA_TYPE_BY_EXTENSION } from "./schedulingCsvSchema.js";

export type {
  SchedulingCsvRowMedia,
  SchedulingCsvRow,
  SchedulingCsvRowError,
  ParseSchedulingCsvResult,
  SchedulingCsvTokenizer,
  SchedulingCsvTokenizerOptions,
} from "./schedulingCsvSchema.js";

/**
 * @function parseSchedulingCsv
 * @description Parses and validates a bulk-scheduling CSV on the server, with
 *   csv-parse's Node build as the tokenizer. A CSV over the byte cap (refused
 *   before tokenizing), a malformed CSV, missing required headers, a forbidden
 *   column (provider, platform) or more rows than the row cap produce a single
 *   `row: 0` error; each data row is validated independently.
 * @param csv - Raw CSV text (header row + data rows).
 * @returns `{ validRows, errors, totalDataRows }` — never throws.
 */
export function parseSchedulingCsv(csv: string): ParseSchedulingCsvResult {
  return parseSchedulingCsvWith(csv, parse);
}
