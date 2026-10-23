/**
 * @file bulkSchedulingCsvParser.test.ts
 * @description Tests for the client-side bulk scheduling CSV parser, the browser
 *              wrapper of the core parser: required headers, the forbidden
 *              `provider` and `platform` columns, the row and byte caps and the
 *              media-type table, then the tokenizer's behaviours the upload flow
 *              relies on. Both wrappers call `parseSchedulingCsvWith`, so the parity
 *              corpus pins that csv-parse's browser build, here, and its Node build,
 *              in `parseSchedulingCsv`, return the same result for every input,
 *              malformed ones included. The corpus lives here, not in the core's
 *              tests, because it compares the two wrappers and the browser wrapper
 *              is in this app, which a package's tests cannot import. A malformed
 *              CSV is asserted on our own `Malformed CSV:` format and csv-parse's
 *              error code, never on csv-parse's message wording, which the parser
 *              does not surface.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { parseSchedulingCsv } from "@core/bulk-scheduling/schedulingCsv.js";
import {
  MAX_BULK_SCHEDULE_CSV_BYTES,
  MAX_BULK_SCHEDULE_ROWS,
} from "@core/bulk-scheduling/schedulingCsvSchema.js";
import {
  parseClientSchedulingCsv,
  generateClientCsvTemplate,
} from "../../lib/csv/bulkSchedulingCsvParser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csv(...lines: string[]): string {
  return lines.join("\n");
}

/** A valid CSV of `count` data rows. */
function csvOfRows(count: number): string {
  return csv(
    "content,scheduledFor",
    ...Array.from({ length: count }, (_, i) => `Row ${i},2026-07-01T09:00:00Z`)
  );
}

/** A valid one-row CSV of exactly `bytes` UTF-8 bytes, its content cell padded with ASCII. */
function csvOfBytes(bytes: number): string {
  const header = "content,scheduledFor\n";
  const date = ",2026-07-01T09:00:00Z";
  return header + "x".repeat(bytes - header.length - date.length) + date;
}

/** The row-0 error of a CSV the tokenizer rejects with csv-parse error `code`. */
function malformed(code: string): { row: number; message: unknown } {
  return {
    row: 0,
    message: expect.stringMatching(new RegExp(`^Malformed CSV: ${code} at line \\d+ of the file$`)),
  };
}

// ---------------------------------------------------------------------------
// Required headers
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — required headers", () => {
  it("accepts a CSV with only content + scheduledFor headers", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", "Hello world,2026-07-01T09:00:00Z")
    );
    expect(result.validRows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.totalDataRows).toBe(1);
  });

  it("rejects CSV with missing required header: content", () => {
    const result = parseClientSchedulingCsv(csv("scheduledFor", "2026-07-01T09:00:00Z"));
    expect(result.validRows).toHaveLength(0);
    expect(result.errors[0]?.message).toMatch(/content/i);
  });

  it("rejects CSV with missing required header: scheduledFor", () => {
    const result = parseClientSchedulingCsv(csv("content", "Hello world"));
    expect(result.validRows).toHaveLength(0);
    expect(result.errors[0]?.message).toMatch(/scheduledFor/i);
  });
});

// ---------------------------------------------------------------------------
// Forbidden provider column
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — forbidden provider column", () => {
  it("rejects CSV containing a 'provider' column", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor,provider", "Hello world,2026-07-01T09:00:00Z,instagram")
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.errors[0]?.row).toBe(0);
    expect(result.errors[0]?.message).toMatch(/provider/i);
  });

  it("rejects CSV containing a 'platform' column", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor,platform", "Hello world,2026-07-01T09:00:00Z,x")
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.errors[0]?.message).toMatch(/platform/i);
  });
});

// ---------------------------------------------------------------------------
// Row cap
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — row cap", () => {
  it("rejects a CSV with 5001 data rows", () => {
    const rows = ["content,scheduledFor"];
    for (let i = 0; i < 5001; i++) {
      rows.push(`Row ${i},2026-07-01T09:00:00Z`);
    }
    const result = parseClientSchedulingCsv(rows.join("\n"));
    expect(result.validRows).toHaveLength(0);
    expect(result.errors[0]?.row).toBe(0);
    expect(result.errors[0]?.message).toMatch(/5000/);
  });

  it("accepts exactly 5000 data rows", () => {
    const rows = ["content,scheduledFor"];
    for (let i = 0; i < 5000; i++) {
      rows.push(`Row ${i},2026-07-01T09:00:00Z`);
    }
    const result = parseClientSchedulingCsv(rows.join("\n"));
    expect(result.errors.filter((e) => e.row === 0)).toHaveLength(0);
    expect(result.validRows).toHaveLength(5000);
  });
});

// ---------------------------------------------------------------------------
// Byte cap: a file past it is refused before tokenizing, on the main thread too
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — byte cap", () => {
  it("refuses a valid one-row CSV one byte over the cap", () => {
    const result = parseClientSchedulingCsv(csvOfBytes(MAX_BULK_SCHEDULE_CSV_BYTES + 1));
    expect(result).toEqual({
      validRows: [],
      errors: [
        {
          row: 0,
          message: `CSV exceeds the ${MAX_BULK_SCHEDULE_CSV_BYTES}-byte limit (at least ${MAX_BULK_SCHEDULE_CSV_BYTES + 1} bytes)`,
        },
      ],
      totalDataRows: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Media type mapping (matches server-side MEDIA_TYPE_BY_EXTENSION table)
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — media type inference", () => {
  it("maps .jpg to MediaType image", () => {
    const result = parseClientSchedulingCsv(
      csv(
        "content,scheduledFor,mediaUrls",
        "Hello,2026-07-01T09:00:00Z,https://cdn.example.com/photo.jpg"
      )
    );
    expect(result.validRows[0]?.media[0]?.type).toBe("image");
  });

  it("maps .mp4 to MediaType video", () => {
    const result = parseClientSchedulingCsv(
      csv(
        "content,scheduledFor,mediaUrls",
        "Hello,2026-07-01T09:00:00Z,https://cdn.example.com/video.mp4"
      )
    );
    expect(result.validRows[0]?.media[0]?.type).toBe("video");
  });

  it("maps .gif to MediaType gif", () => {
    const result = parseClientSchedulingCsv(
      csv(
        "content,scheduledFor,mediaUrls",
        "Hello,2026-07-01T09:00:00Z,https://cdn.example.com/anim.gif"
      )
    );
    expect(result.validRows[0]?.media[0]?.type).toBe("gif");
  });

  it("blocks a row with an unrecognized extension (.tiff)", () => {
    const result = parseClientSchedulingCsv(
      csv(
        "content,scheduledFor,mediaUrls",
        "Hello,2026-07-01T09:00:00Z,https://cdn.example.com/file.tiff"
      )
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.errors[0]?.field).toBe("mediaUrls");
    expect(result.errors[0]?.message).toMatch(/tiff|unrecognized/i);
  });

  it("accepts a row with no mediaUrls", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", "Hello,2026-07-01T09:00:00Z")
    );
    expect(result.validRows[0]?.media).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-row errors (one bad row does not abort the rest)
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — per-row errors", () => {
  it("returns valid rows even when some rows have errors", () => {
    const result = parseClientSchedulingCsv(
      csv(
        "content,scheduledFor",
        "Good row,2026-07-01T09:00:00Z",
        "Bad date,not-a-date",
        "Another good,2026-07-02T09:00:00Z"
      )
    );
    expect(result.validRows).toHaveLength(2);
    expect(result.errors).toHaveLength(1); // invalid date on row 2
    expect(result.totalDataRows).toBe(3);
  });

  it("flags empty content as an error", () => {
    const result = parseClientSchedulingCsv(csv("content,scheduledFor", ",2026-07-01T09:00:00Z"));
    expect(result.errors[0]?.field).toBe("content");
  });

  it("flags invalid scheduledFor date as an error", () => {
    const result = parseClientSchedulingCsv(csv("content,scheduledFor", "Hello,not-a-date"));
    expect(result.errors[0]?.field).toBe("scheduledFor");
  });
});

// ---------------------------------------------------------------------------
// Tokenizer behaviours the upload flow relies on
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — tokenizer", () => {
  it("parses CRLF line endings like LF", () => {
    const result = parseClientSchedulingCsv(
      "content,scheduledFor\r\nHello,2026-07-01T09:00:00Z\r\nBye,2026-07-02T09:00:00Z\r\n"
    );
    expect(result.errors).toEqual([]);
    expect(result.validRows.map((r) => r.content)).toEqual(["Hello", "Bye"]);
  });

  it("keeps commas, line breaks and doubled quotes inside a quoted content cell", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", '"Hello, world\nShe said ""hi""",2026-07-01T09:00:00Z')
    );
    expect(result.errors).toEqual([]);
    expect(result.validRows[0]?.content).toBe('Hello, world\nShe said "hi"');
  });

  it("trims whitespace around header names and unquoted cells", () => {
    const result = parseClientSchedulingCsv(
      csv(" content , scheduledFor , title ", "  Hello  ,  2026-07-01T09:00:00Z  ,  Launch  ")
    );
    expect(result.errors).toEqual([]);
    expect(result.validRows[0]).toMatchObject({
      content: "Hello",
      scheduledFor: "2026-07-01T09:00:00.000Z",
      title: "Launch",
    });
  });

  it("skips blank lines and numbers rows by data record", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", "", "Good,2026-07-01T09:00:00Z", "", "", "Bad,not-a-date", "")
    );
    expect(result.totalDataRows).toBe(2);
    expect(result.validRows.map((r) => r.row)).toEqual([1]);
    expect(result.errors).toEqual([
      { row: 2, field: "scheduledFor", message: "Invalid date: not-a-date" },
    ]);
  });

  it("ignores a byte-order mark before the header row", () => {
    const result = parseClientSchedulingCsv(
      "﻿" + csv("content,scheduledFor", "Hello,2026-07-01T09:00:00Z")
    );
    expect(result.errors).toEqual([]);
    expect(result.validRows).toHaveLength(1);
  });

  it("keeps every cell as a string, with no numeric or boolean coercion", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor,title,tags", "42,2026-07-01T09:00:00Z,true,007|1e3")
    );
    expect(result.errors).toEqual([]);
    expect(result.validRows[0]).toMatchObject({
      content: "42",
      title: "true",
      tags: ["007", "1e3"],
    });
  });

  it("returns 'CSV has no data rows' for a header-only CSV", () => {
    const result = parseClientSchedulingCsv("content,scheduledFor\n");
    expect(result).toEqual({
      validRows: [],
      errors: [{ row: 0, message: "CSV has no data rows" }],
      totalDataRows: 0,
    });
  });

  it("returns 'CSV has no data rows' for an empty input", () => {
    const result = parseClientSchedulingCsv("");
    expect(result.errors).toEqual([{ row: 0, message: "CSV has no data rows" }]);
    expect(result.totalDataRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed and ambiguous input: the server parser's answer, given locally
// ---------------------------------------------------------------------------

describe("parseClientSchedulingCsv — malformed input", () => {
  it("rejects a row with fewer cells than the header as a malformed CSV", () => {
    const result = parseClientSchedulingCsv(csv("content,scheduledFor", "Hello"));
    expect(result).toEqual({
      validRows: [],
      errors: [malformed("CSV_RECORD_INCONSISTENT_COLUMNS")],
      totalDataRows: 0,
    });
  });

  it("rejects a row with more cells than the header as a malformed CSV", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", "Hello,2026-07-01T09:00:00Z,extra")
    );
    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual([malformed("CSV_RECORD_INCONSISTENT_COLUMNS")]);
  });

  it("rejects an unclosed quote as a malformed CSV", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", '"Hello,2026-07-01T09:00:00Z')
    );
    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual([malformed("CSV_QUOTE_NOT_CLOSED")]);
  });

  it.each([
    [
      "a quote inside an unquoted cell",
      csv("content,scheduledFor", 'SECRET-CELL"x,2026-07-01T09:00:00Z'),
      "INVALID_OPENING_QUOTE",
    ],
    [
      "a character after a closing quote",
      csv("content,scheduledFor", '"SECRET-CELL"#,2026-07-01T09:00:00Z'),
      "CSV_INVALID_CLOSING_QUOTE",
    ],
  ])("names %s by its code, without echoing the input", (_name, input, code) => {
    const result = parseClientSchedulingCsv(input);
    expect(result.errors).toEqual([malformed(code)]);
    expect(result.errors[0]?.message).not.toContain("SECRET-CELL");
  });

  it("reads only commas as delimiters: a semicolon-delimited file misses its required columns", () => {
    const result = parseClientSchedulingCsv(
      csv("content;scheduledFor", "Hello;2026-07-01T09:00:00Z")
    );
    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual([
      { row: 0, message: "Missing required column(s): content, scheduledFor" },
    ]);
  });

  it("keeps whitespace inside a quoted cell", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", '"  Hello  ",2026-07-01T09:00:00Z')
    );
    expect(result.validRows[0]?.content).toBe("  Hello  ");
  });

  it("skips a line that holds only whitespace", () => {
    const result = parseClientSchedulingCsv(
      csv("content,scheduledFor", "   ", "Hello,2026-07-01T09:00:00Z")
    );
    expect(result.errors).toEqual([]);
    expect(result.totalDataRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Parity of the two wrappers: csv-parse's browser build against its Node build
// ---------------------------------------------------------------------------

const PARITY_CORPUS: ReadonlyArray<readonly [string, string]> = [
  ["a minimal valid row", csv("content,scheduledFor", "Hello,2026-07-01T09:00:00Z")],
  [
    "every optional column",
    csv(
      "content,scheduledFor,timezone,title,mediaUrls,tags",
      '"Launch, day",2026-07-01T09:00:00Z,America/New_York,"Title",https://cdn.example.com/a.jpg|https://cdn.example.com/b.mp4,a|b'
    ),
  ],
  ["CRLF line endings", "content,scheduledFor\r\nHello,2026-07-01T09:00:00Z\r\n"],
  ["a CR-only line ending", "content,scheduledFor\rHello,2026-07-01T09:00:00Z"],
  ["non-ASCII text", csv("content,scheduledFor", '"Café ☕ 🚀 日本語",2026-07-01T09:00:00Z')],
  ["blank lines", csv("content,scheduledFor", "", "Hello,2026-07-01T09:00:00Z", "")],
  ["a whitespace-only line", csv("content,scheduledFor", "   ", "Hello,2026-07-01T09:00:00Z")],
  [
    "whitespace inside a quoted cell",
    csv("content,scheduledFor", '"  Hello  ",2026-07-01T09:00:00Z'),
  ],
  [
    "whitespace around a quoted cell",
    csv("content,scheduledFor", '  "Hello"  ,2026-07-01T09:00:00Z'),
  ],
  ["a semicolon-delimited file", csv("content;scheduledFor", "Hello;2026-07-01T09:00:00Z")],
  ["a tab-delimited file", csv("content\tscheduledFor", "Hello\t2026-07-01T09:00:00Z")],
  ["a short row", csv("content,scheduledFor", "Hello")],
  ["a long row", csv("content,scheduledFor", "Hello,2026-07-01T09:00:00Z,extra")],
  ["an unclosed quote", csv("content,scheduledFor", '"Hello,2026-07-01T09:00:00Z')],
  ["a quote inside an unquoted cell", csv("content,scheduledFor", 'Hel"lo,2026-07-01T09:00:00Z')],
  [
    "a character after a closing quote",
    csv("content,scheduledFor", '"Hello"#,2026-07-01T09:00:00Z'),
  ],
  ["a duplicate header", csv("content,content,scheduledFor", "A,B,2026-07-01T09:00:00Z")],
  ["a control character", csv("content,scheduledFor", "Hel\u0001lo,2026-07-01T09:00:00Z")],
  ["a forbidden column", csv("content,scheduledFor,provider", "Hello,2026-07-01T09:00:00Z,x")],
  [
    "both forbidden columns",
    csv("content,scheduledFor,provider,platform", "Hello,2026-07-01T09:00:00Z,x,y"),
  ],
  [
    "an invalid URL before an unknown extension in one mediaUrls cell",
    csv(
      "content,scheduledFor,mediaUrls",
      "Bad,2026-07-01T09:00:00Z,not-a-url|https://cdn.example.com/file.tiff",
      "Good,2026-07-01T09:00:00Z,"
    ),
  ],
  [
    "an unknown extension before an invalid URL in one mediaUrls cell",
    csv(
      "content,scheduledFor,mediaUrls",
      "Bad,2026-07-01T09:00:00Z,https://cdn.example.com/file.tiff|not-a-url",
      "Good,2026-07-01T09:00:00Z,"
    ),
  ],
  ["exactly the row cap", csvOfRows(MAX_BULK_SCHEDULE_ROWS)],
  ["one row past the row cap", csvOfRows(MAX_BULK_SCHEDULE_ROWS + 1)],
  ["one byte past the byte cap", csvOfBytes(MAX_BULK_SCHEDULE_CSV_BYTES + 1)],
  ["a header-only file", "content,scheduledFor"],
  ["an empty file", ""],
];

describe("parseClientSchedulingCsv — same result as the server wrapper", () => {
  it.each(PARITY_CORPUS)("returns parseSchedulingCsv's result for %s", (_name, input) => {
    expect(parseClientSchedulingCsv(input)).toEqual(parseSchedulingCsv(input));
  });
});

// ---------------------------------------------------------------------------
// Template generator
// ---------------------------------------------------------------------------

describe("generateClientCsvTemplate", () => {
  it("produces a CSV with content and scheduledFor headers but NO provider column", () => {
    const template = generateClientCsvTemplate();
    const firstLine = template.split("\n")[0] ?? "";
    expect(firstLine).toContain("content");
    expect(firstLine).toContain("scheduledFor");
    expect(firstLine).not.toContain("provider");
    expect(firstLine).not.toContain("platform");
  });

  it("produces a template the parser accepts with no errors", () => {
    const result = parseClientSchedulingCsv(generateClientCsvTemplate());
    expect(result.errors).toEqual([]);
    expect(result.validRows).toHaveLength(2);
  });
});
