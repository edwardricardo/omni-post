/**
 * @file schedulingCsv.property.test.ts
 * @description Property suite for `parseSchedulingCsv`: it never throws on any input; a
 *   well-formed document of N rows yields N valid rows carrying the cells it was given; one bad
 *   row yields exactly one error on that row and leaves the others valid; the row cap refuses the
 *   whole document one row past the limit and not before; and every data row ends either valid or
 *   in error, never both and never neither. Every run is pinned to one seed, so a failure replays
 *   as fast-check prints it (`fc.assert(property, { seed, path })`).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  MAX_BULK_SCHEDULE_ROWS,
  parseSchedulingCsv,
  type ParseSchedulingCsvResult,
} from "../../src/schedulingCsv.js";

/**
 * One fixed seed for every property of this file, so CI reproduces a failure byte for byte; 100
 * runs is fast-check's own default, and a document of at most 40 rows parses in well under a
 * millisecond.
 */
const PROPERTY_RUN = { seed: 20_261_018, numRuns: 100 } as const;

/** A cap document holds about 5,000 rows, so its property runs a tenth as often. */
const CAP_RUN = { seed: 20_261_018, numRuns: 10 } as const;

interface GeneratedRow {
  readonly content: string;
  readonly scheduledFor: string;
  readonly timezone: string;
  readonly tags: readonly string[];
}

const HEADER = "content,scheduledFor,timezone,tags";

/** RFC 4180 quoting: every cell quoted, an embedded quote doubled. */
const quote = (cell: string): string => `"${cell.replaceAll('"', '""')}"`;

const toLine = (row: GeneratedRow): string =>
  [row.content, row.scheduledFor, row.timezone, row.tags.join("|")].map(quote).join(",");

const toDocument = (header: string, lines: readonly string[], eol: string): string =>
  [header, ...lines].join(eol);

const lineEnding = fc.constantFrom("\n", "\r\n");

const isoInstant = fc
  .date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2099-12-31T23:59:59.999Z"),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString());

/** Printable text with commas and quotes inside, never blank and never padded. */
const content = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((text) => text.trim() === text && text.length > 0);

const validRow: fc.Arbitrary<GeneratedRow> = fc.record({
  content,
  scheduledFor: isoInstant,
  timezone: fc.constantFrom("", "UTC", "Europe/Madrid", "America/New_York"),
  tags: fc.array(fc.stringMatching(/^[a-z0-9]{1,10}$/), { maxLength: 4 }),
});

const validRows = fc.array(validRow, { minLength: 1, maxLength: 40 });

/** The row numbers the parser reported, valid and in error, as two sorted lists. */
const reportedRows = (result: ParseSchedulingCsvResult): { valid: number[]; failed: number[] } => ({
  valid: result.validRows.map((row) => row.row),
  failed: [...new Set(result.errors.map((error) => error.row))].sort((a, b) => a - b),
});

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe("parseSchedulingCsv (property)", () => {
  it("never throws and reports rows inside the document for any input", () => {
    const arbitraryLines = fc
      .array(fc.string({ unit: fc.constantFrom("a", "1", ",", '"', " ", "|", "\n") }), {
        maxLength: 6,
      })
      .map((lines) => `content,scheduledFor\n${lines.join("\n")}`);
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: "binary" }), arbitraryLines), (csv) => {
        const result = parseSchedulingCsv(csv);
        const { totalDataRows } = result;
        assert.ok(Number.isInteger(totalDataRows) && totalDataRows >= 0);
        for (const error of result.errors) {
          assert.ok(error.row >= 0 && error.row <= totalDataRows, JSON.stringify(error));
        }
        for (const row of result.validRows) {
          assert.ok(row.row >= 1 && row.row <= totalDataRows, JSON.stringify(row));
        }
        if (result.errors.some((error) => error.row === 0)) {
          assert.strictEqual(result.validRows.length, 0);
        }
      }),
      PROPERTY_RUN
    );
  });

  it("returns every row of a well-formed document as valid, with the cells it was given", () => {
    fc.assert(
      fc.property(validRows, lineEnding, (rows, eol) => {
        const result = parseSchedulingCsv(toDocument(HEADER, rows.map(toLine), eol));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.totalDataRows, rows.length);
        assert.strictEqual(result.validRows.length, rows.length);
        rows.forEach((row, index) => {
          const parsed = result.validRows[index];
          assert.ok(parsed !== undefined);
          assert.strictEqual(parsed.row, index + 1);
          assert.strictEqual(parsed.content, row.content);
          assert.strictEqual(parsed.scheduledFor, row.scheduledFor);
          assert.strictEqual(parsed.timezone, row.timezone === "" ? "UTC" : row.timezone);
          assert.deepStrictEqual(parsed.tags, row.tags);
        });
      }),
      PROPERTY_RUN
    );
  });

  it("reports exactly one error on the one bad row and keeps every other row valid", () => {
    const breakRow = fc.constantFrom(
      { field: "content", apply: (row: GeneratedRow): GeneratedRow => ({ ...row, content: "" }) },
      {
        field: "scheduledFor",
        apply: (row: GeneratedRow): GeneratedRow => ({ ...row, scheduledFor: "not-a-date" }),
      }
    );
    fc.assert(
      fc.property(validRows, fc.nat(), breakRow, lineEnding, (rows, pick, breaker, eol) => {
        const badIndex = pick % rows.length;
        const lines = rows.map((row, index) =>
          toLine(index === badIndex ? breaker.apply(row) : row)
        );
        const result = parseSchedulingCsv(toDocument(HEADER, lines, eol));

        assert.strictEqual(result.errors.length, 1);
        assert.strictEqual(result.errors[0]?.row, badIndex + 1);
        assert.strictEqual(result.errors[0]?.field, breaker.field);
        assert.deepStrictEqual(
          reportedRows(result).valid,
          range(1, rows.length).filter((row) => row !== badIndex + 1)
        );
      }),
      PROPERTY_RUN
    );
  });

  it("refuses the whole document one row past the cap, and not at the cap", () => {
    const line = toLine({
      content: "Scheduled post",
      scheduledFor: "2030-01-01T00:00:00.000Z",
      timezone: "UTC",
      tags: [],
    });
    const rowCount = fc.oneof(
      fc.constantFrom(MAX_BULK_SCHEDULE_ROWS, MAX_BULK_SCHEDULE_ROWS + 1),
      fc.integer({ min: MAX_BULK_SCHEDULE_ROWS - 3, max: MAX_BULK_SCHEDULE_ROWS + 3 })
    );
    fc.assert(
      fc.property(rowCount, (count) => {
        const result = parseSchedulingCsv(toDocument(HEADER, Array(count).fill(line), "\n"));

        assert.strictEqual(result.totalDataRows, count);
        if (count > MAX_BULK_SCHEDULE_ROWS) {
          assert.strictEqual(result.validRows.length, 0);
          assert.strictEqual(result.errors.length, 1);
          assert.strictEqual(result.errors[0]?.row, 0);
        } else {
          assert.strictEqual(result.validRows.length, count);
          assert.deepStrictEqual(result.errors, []);
        }
      }),
      CAP_RUN
    );
  });

  it("ends every data row either valid or in error, never both and never neither", () => {
    const mixedRow = fc
      .tuple(
        fc.oneof(content, fc.constant("")),
        fc.oneof(isoInstant, fc.constantFrom("not-a-date", "")),
        fc.constantFrom(
          "",
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/a.mp4|https://cdn.example.com/b.png",
          "https://cdn.example.com/a.xyz",
          "not a url"
        )
      )
      .map((cells) => cells.map(quote).join(","));
    fc.assert(
      fc.property(fc.array(mixedRow, { minLength: 1, maxLength: 30 }), (lines) => {
        const result = parseSchedulingCsv(
          toDocument("content,scheduledFor,mediaUrls", lines, "\n")
        );
        const { valid, failed } = reportedRows(result);

        assert.ok(
          failed.every((row) => row > 0),
          "no document-level refusal expected"
        );
        assert.ok(
          valid.every((row) => !failed.includes(row)),
          "a row is valid and in error"
        );
        assert.deepStrictEqual(
          [...valid, ...failed].sort((a, b) => a - b),
          range(1, lines.length)
        );
      }),
      PROPERTY_RUN
    );
  });
});
