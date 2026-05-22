/**
 * @file schedulingCsv.test.ts
 * @description Unit tests for parseSchedulingCsv — per-row Zod + value-object
 *   validation, header/parse-level errors, and accurate 1-based row numbers.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseSchedulingCsv } from "../../../../src/application/bulk-scheduling/schedulingCsv.js";

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
const HEADER = "provider,content,scheduledFor";

describe("parseSchedulingCsv", () => {
  it("returns all rows as valid for a well-formed CSV", () => {
    const csv = `${HEADER}\nX,Hello world,${future(TWO_DAYS)}\nINSTAGRAM,Another post,${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.validRows.length, 2);
    assert.strictEqual(result.totalDataRows, 2);
    assert.strictEqual(result.validRows[0]?.provider, "X");
    assert.strictEqual(result.validRows[0]?.content, "Hello world");
    assert.strictEqual(result.validRows[0]?.timezone, "UTC");
    // 1-based row numbers map each valid row back to its CSV line.
    assert.strictEqual(result.validRows[0]?.row, 1);
    assert.strictEqual(result.validRows[1]?.row, 2);
  });

  it("collects per-row errors with the correct 1-based row number on a mixed CSV", () => {
    const csv = `${HEADER}\nX,Good,${future(TWO_DAYS)}\nMYSPACE,Bad provider,${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 1);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0]?.row, 2);
    assert.strictEqual(result.errors[0]?.field, "provider");
  });

  it("preserves the true CSV row number on a valid row that follows an invalid one", () => {
    const csv = `${HEADER}\nMYSPACE,Bad,${future(TWO_DAYS)}\nX,Good,${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 1);
    assert.strictEqual(result.validRows[0]?.row, 2); // row number is the CSV line, not the validRows index
    assert.strictEqual(result.errors[0]?.row, 1);
  });

  it("reports one error per row when all rows are invalid", () => {
    const csv = `${HEADER}\nMYSPACE,a,${future(TWO_DAYS)}\nORKUT,b,${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors.length, 2);
    assert.deepStrictEqual(
      result.errors.map((e) => e.row),
      [1, 2]
    );
  });

  it("reports a header-level error (row 0) when a required column is missing", () => {
    const csv = `provider,content\nX,no schedule column`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.row, 0);
    assert.match(result.errors[0]?.message ?? "", /scheduledFor/);
  });

  it("reports a parse-level error (row 0) on malformed CSV", () => {
    const csv = `${HEADER}\nX,"unterminated quote,${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.row, 0);
    assert.match(result.errors[0]?.message ?? "", /Malformed CSV/);
  });

  it("reports row 0 when the CSV has no data rows", () => {
    const result = parseSchedulingCsv(HEADER);
    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.row, 0);
  });

  it("rejects a provider that does not support scheduling", () => {
    const csv = `${HEADER}\nLINKEDIN,Pro post,${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.field, "provider");
    assert.match(result.errors[0]?.message ?? "", /does not support scheduling/);
  });

  it("rejects content longer than the provider's max characters", () => {
    const tooLong = "a".repeat(281); // X max = 280
    const csv = `${HEADER}\nX,${tooLong},${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.field, "content");
  });

  it("rejects a scheduledFor in the past, too-soon, too-far, or invalid", () => {
    const cases = [
      future(-TWO_DAYS), // past
      future(60 * 1000), // < 5 min lead
      future(400 * 24 * 60 * 60 * 1000), // > 1 year
      "not-a-date",
    ];
    for (const scheduledFor of cases) {
      const result = parseSchedulingCsv(`${HEADER}\nX,Hello,${scheduledFor}`);
      assert.strictEqual(result.validRows.length, 0, `should reject scheduledFor=${scheduledFor}`);
      assert.strictEqual(result.errors[0]?.field, "scheduledFor");
    }
  });

  it("rejects an invalid media URL", () => {
    const csv = `provider,content,scheduledFor,mediaUrls\nX,Hello,${future(TWO_DAYS)},not-a-url`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.field, "mediaUrls");
  });

  it("parses optional list columns (mediaUrls, tags) split by '|'", () => {
    const csv = `provider,content,scheduledFor,mediaUrls,tags\nX,Hello,${future(TWO_DAYS)},https://a.test/1.jpg|https://b.test/2.jpg,promo|launch`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 1);
    assert.deepStrictEqual(result.validRows[0]?.mediaUrls, [
      "https://a.test/1.jpg",
      "https://b.test/2.jpg",
    ]);
    assert.deepStrictEqual(result.validRows[0]?.tags, ["promo", "launch"]);
  });

  it("handles quoted fields containing commas", () => {
    const csv = `${HEADER}\nX,"Hello, world, again",${future(TWO_DAYS)}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows.length, 1);
    assert.strictEqual(result.validRows[0]?.content, "Hello, world, again");
  });

  it("normalizes provider casing and scheduledFor to ISO", () => {
    const when = future(TWO_DAYS);
    const csv = `${HEADER}\nx,Hello,${when}`;
    const result = parseSchedulingCsv(csv);

    assert.strictEqual(result.validRows[0]?.provider, "X");
    assert.strictEqual(result.validRows[0]?.scheduledFor, new Date(when).toISOString());
  });
});
