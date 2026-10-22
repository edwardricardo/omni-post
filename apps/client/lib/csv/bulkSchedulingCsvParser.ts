/**
 * @file bulkSchedulingCsvParser.ts
 * @description Browser wrapper of the bulk-scheduling CSV parser: binds the browser
 *              build of csv-parse to `parseSchedulingCsvWith`, the one parser in
 *              `@core/bulk-scheduling`, which the server binds to csv-parse's Node
 *              build. The upload therefore shows the server's answer for the same
 *              text, malformed input included, before the round trip; the server
 *              stays authoritative. Also builds the downloadable CSV template.
 * @layer infrastructure
 */

// The browser subpath, not `csv-parse/sync`: the Node build reads the global
// `Buffer`, which a browser does not define; the browser build bundles its own.
import { parse } from "csv-parse/browser/esm/sync";
import { parseSchedulingCsvWith } from "@core/bulk-scheduling/schedulingCsvSchema.js";
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

/**
 * @function parseClientSchedulingCsv
 * @description Parses and validates a bulk-scheduling CSV in the browser, with the
 *   core parser and csv-parse's browser build as its tokenizer. A CSV over the
 *   core's byte cap is refused before tokenizing, so a large file does not hold the
 *   main thread, and a CSV the tokenizer rejects (unclosed quote, a row whose cell
 *   count differs from the header's) yields one `row: 0` error, as on the server.
 * @param csv - Raw CSV string (header row + data rows).
 * @returns `{ validRows, errors, totalDataRows }` — never throws.
 */
export function parseClientSchedulingCsv(csv: string): ParseSchedulingCsvResult {
  return parseSchedulingCsvWith(csv, parse);
}

/**
 * @function generateClientCsvTemplate
 * @description Returns a CSV template string with content-pure headers and
 *   two example rows. No `provider` or `platform` column.
 * @returns The template: a header row and two example data rows, joined by `\n`.
 */
export function generateClientCsvTemplate(): string {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19) + "Z";
  const dayAfter = new Date(Date.now() + 172_800_000).toISOString().slice(0, 19) + "Z";
  const headers = "content,scheduledFor,timezone,title,mediaUrls,tags";
  const row1 = `"Check out our latest update!",${tomorrow},America/New_York,,, `;
  const row2 = `"Behind the scenes look at what we're building",${dayAfter},America/New_York,"Launch Day",https://example.com/image.jpg,launch|product`;
  return [headers, row1, row2].join("\n");
}
