/**
 * @file schedulingCsv.test.ts
 * @description Unit tests for the refactored content-pure CSV schema.
 *   Spec scenarios: all of "Content-Pure CSV Contract" — required headers,
 *   rejected provider column, row cap, per-row errors, media-type inference —
 *   plus the byte cap and the tokenizer-error message of the shared parser.
 * @layer infrastructure
 */

import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { parseSchedulingCsv, REQUIRED_HEADERS } from "../../src/schedulingCsv.js";
import {
  FORBIDDEN_HEADERS,
  MAX_BULK_SCHEDULE_CSV_BYTES,
  parseSchedulingCsvWith,
  type SchedulingCsvTokenizer,
} from "../../src/schedulingCsvSchema.js";

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
const HEADER = "content,scheduledFor";

describe("REQUIRED_HEADERS", () => {
  it("contains content and scheduledFor (no provider)", () => {
    assert.ok(REQUIRED_HEADERS.includes("content"));
    assert.ok(REQUIRED_HEADERS.includes("scheduledFor"));
    assert.ok(!(REQUIRED_HEADERS as readonly string[]).includes("provider"));
  });
});

describe("FORBIDDEN_HEADERS", () => {
  it("lists provider and platform, and no required header", () => {
    assert.deepStrictEqual([...FORBIDDEN_HEADERS], ["provider", "platform"]);
    for (const header of FORBIDDEN_HEADERS) {
      assert.ok(!(REQUIRED_HEADERS as readonly string[]).includes(header));
    }
  });
});

describe("parseSchedulingCsv — content-pure schema", () => {
  describe("required headers", () => {
    it("accepts CSV with only content + scheduledFor headers", () => {
      const csv = `${HEADER}\nHello world,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.validRows.length, 1);
    });

    it("reports row-0 error when content column is missing", () => {
      const csv = `scheduledFor\n${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 0);
      assert.match(result.errors[0]?.message ?? "", /content/);
    });

    it("reports row-0 error when scheduledFor column is missing", () => {
      const csv = `content\nHello world`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 0);
      assert.match(result.errors[0]?.message ?? "", /scheduledFor/);
    });

    it("rejects CSV that contains a provider column (forbidden column)", () => {
      const csv = `provider,content,scheduledFor\nX,Hello,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 0);
      assert.match(result.errors[0]?.message ?? "", /provider/i);
    });
  });

  describe("row cap", () => {
    it("enforces a hard cap of 5000 rows and returns row-0 error when exceeded", () => {
      const rows = Array.from({ length: 5001 }, () => `Hello,${future(TWO_DAYS)}`).join("\n");
      const csv = `${HEADER}\n${rows}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 0);
      assert.match(result.errors[0]?.message ?? "", /5000/);
    });

    it("accepts exactly 5000 rows without a cap error", () => {
      const rows = Array.from({ length: 5000 }, () => `Hello,${future(TWO_DAYS)}`).join("\n");
      const csv = `${HEADER}\n${rows}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.errors.filter((e) => e.row === 0).length, 0);
      assert.strictEqual(result.validRows.length, 5000);
    });
  });

  describe("per-row date errors", () => {
    it("returns per-row error for an unparseable scheduledFor date", () => {
      const csv = `${HEADER}\nHello,not-a-date`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 1);
      assert.ok(
        result.errors[0]?.field === "scheduledFor" ||
          result.errors[0]?.message.includes("scheduledFor")
      );
    });

    it("valid rows are not blocked by per-row errors on other rows", () => {
      const csv = `${HEADER}\nHello,not-a-date\nGood post,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0]?.row, 1);
      assert.strictEqual(result.validRows[0]?.row, 2);
    });
  });

  describe("media-type inference from URL extension", () => {
    const imageExtensions = ["jpg", "jpeg", "png", "webp", "bmp", "heic", "heif"];
    const gifExtension = "gif";
    const videoExtensions = ["mp4", "mov", "m4v", "webm", "avi", "mkv"];

    for (const ext of imageExtensions) {
      it(`maps .${ext} to MediaType image`, () => {
        const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/photo.${ext}`;
        const result = parseSchedulingCsv(csv);
        assert.strictEqual(result.validRows.length, 1, `Expected valid row for .${ext}`);
        assert.deepStrictEqual(result.validRows[0]?.media, [
          { url: `https://cdn.example.com/photo.${ext}`, type: "image" },
        ]);
      });
    }

    it(`maps .${gifExtension} to MediaType gif`, () => {
      const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/anim.gif`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.deepStrictEqual(result.validRows[0]?.media, [
        { url: "https://cdn.example.com/anim.gif", type: "gif" },
      ]);
    });

    for (const ext of videoExtensions) {
      it(`maps .${ext} to MediaType video`, () => {
        const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/clip.${ext}`;
        const result = parseSchedulingCsv(csv);
        assert.strictEqual(result.validRows.length, 1, `Expected valid row for .${ext}`);
        assert.deepStrictEqual(result.validRows[0]?.media, [
          { url: `https://cdn.example.com/clip.${ext}`, type: "video" },
        ]);
      });
    }

    it("returns per-row blocked error for an unrecognized extension (no fallback)", () => {
      const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/file.tiff`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 1);
      assert.strictEqual(result.errors[0]?.field, "mediaUrls");
      assert.match(result.errors[0]?.message ?? "", /tiff|unrecognized|cannot determine/i);
    });

    it("returns empty media array when no mediaUrls present", () => {
      const csv = `${HEADER}\nHello,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.deepStrictEqual(result.validRows[0]?.media, []);
    });

    it("handles case-insensitive extension mapping (.JPG -> image)", () => {
      const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/PHOTO.JPG`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.strictEqual(result.validRows[0]?.media[0]?.type, "image");
    });

    it("handles URL query strings when inferring extension", () => {
      const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/photo.jpg?w=100`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.strictEqual(result.validRows[0]?.media[0]?.type, "image");
    });

    it("blocks row when extension is absent (no path segment extension)", () => {
      const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},https://cdn.example.com/media`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.field, "mediaUrls");
    });
  });

  describe("content row without provider", () => {
    it("does NOT include a provider field in valid rows", () => {
      const csv = `${HEADER}\nHello world,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.ok(!("provider" in (result.validRows[0] ?? {})));
    });

    it("preserves 1-based row numbers", () => {
      const csv = `${HEADER}\nFirst row,${future(TWO_DAYS)}\nSecond row,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows[0]?.row, 1);
      assert.strictEqual(result.validRows[1]?.row, 2);
    });
  });

  describe("generic parsing — malformed input, tokenizer, list columns", () => {
    it("returns a row-0 error on a malformed CSV (inconsistent column count)", () => {
      const csv = `${HEADER}\nHello,${future(TWO_DAYS)},unexpected-extra-field`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 0);
      assert.match(result.errors[0]?.message ?? "", /malformed csv/i);
    });

    it("returns a row-0 error when the CSV has a header but no data rows", () => {
      const result = parseSchedulingCsv(HEADER);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 0);
      assert.match(result.errors[0]?.message ?? "", /no data rows/i);
    });

    it("preserves a quoted field that contains a comma", () => {
      const csv = `${HEADER}\n"Hello, world",${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.strictEqual(result.validRows[0]?.content, "Hello, world");
    });

    it("splits pipe-separated mediaUrls and tags into lists", () => {
      const csv = `content,scheduledFor,mediaUrls,tags\nHello,${future(TWO_DAYS)},https://cdn.example.com/a.jpg|https://cdn.example.com/b.png,foo|bar`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.strictEqual(result.validRows[0]?.media.length, 2);
      assert.deepStrictEqual(result.validRows[0]?.tags, ["foo", "bar"]);
    });

    it("returns a per-row error for a syntactically invalid media URL", () => {
      const csv = `content,scheduledFor,mediaUrls\nHello,${future(TWO_DAYS)},not a url`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 0);
      assert.strictEqual(result.errors[0]?.row, 1);
      assert.strictEqual(result.errors[0]?.field, "mediaUrls");
      assert.match(result.errors[0]?.message ?? "", /invalid url/i);
    });

    it("emits scheduledFor as a canonical ISO-8601 string with milliseconds", () => {
      const csv = `${HEADER}\nHello,${future(TWO_DAYS)}`;
      const result = parseSchedulingCsv(csv);
      assert.strictEqual(result.validRows.length, 1);
      assert.match(
        result.validRows[0]?.scheduledFor ?? "",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });
  });
});

describe("parseSchedulingCsvWith — injected tokenizer", () => {
  it("hands the tokenizer the CSV text and the shared options, then validates its records", () => {
    const calls: Parameters<SchedulingCsvTokenizer>[] = [];
    const tokenizer: SchedulingCsvTokenizer = (input, options) => {
      calls.push([input, options]);
      return [{ content: "Hello", scheduledFor: "2026-07-01T09:00:00Z" }];
    };

    const result = parseSchedulingCsvWith("any text", tokenizer);

    assert.deepStrictEqual(calls, [
      ["any text", { columns: true, skip_empty_lines: true, trim: true }],
    ]);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.validRows[0]?.content, "Hello");
    assert.strictEqual(result.totalDataRows, 1);
  });

  it("applies the header rules to the tokenizer's records", () => {
    const tokenizer: SchedulingCsvTokenizer = () => [
      { content: "Hello", scheduledFor: "2026-07-01T09:00:00Z", provider: "x" },
    ];

    const result = parseSchedulingCsvWith("ignored", tokenizer);

    assert.strictEqual(result.validRows.length, 0);
    assert.strictEqual(result.errors[0]?.row, 0);
    assert.match(result.errors[0]?.message ?? "", /forbidden column\(s\) detected: provider/i);
  });

  it("reports a record that lacks a required field as a per-row error on that field", () => {
    const tokenizer: SchedulingCsvTokenizer = () => [
      { content: "Hello", scheduledFor: "2026-07-01T09:00:00Z" },
      { content: "No date" },
    ];

    const result = parseSchedulingCsvWith("ignored", tokenizer);

    assert.deepStrictEqual(
      result.validRows.map((r) => r.row),
      [1]
    );
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0]?.row, 2);
    assert.strictEqual(result.errors[0]?.field, "scheduledFor");
    assert.strictEqual(result.totalDataRows, 2);
  });
});

// A tokenizer error is reported by its code and line: csv-parse's message can quote
// the input (INVALID_OPENING_QUOTE holds the cell read so far), and the result is
// returned to the uploader and may be logged.
const QUOTED_INPUT = "SECRET-CELL-CONTENT";

/** An error shaped like csv-parse's CsvError, whose message quotes the input. */
function csvParseError(fields: { code?: unknown; lines?: unknown }): Error {
  return Object.assign(
    new Error(`Invalid Opening Quote: a quote is found at line 2, value is "${QUOTED_INPUT}"`),
    fields
  );
}

/** A tokenizer that fails with `thrown`. */
function failingTokenizer(thrown: unknown): SchedulingCsvTokenizer {
  return () => {
    throw thrown;
  };
}

describe("parseSchedulingCsvWith — tokenizer errors", () => {
  it("returns one row-0 error naming the error's code and the line of the file, not its message", () => {
    const tokenizer = failingTokenizer(csvParseError({ code: "INVALID_OPENING_QUOTE", lines: 2 }));

    const result = parseSchedulingCsvWith('content\nx"', tokenizer);

    assert.deepStrictEqual(result, {
      validRows: [],
      errors: [{ row: 0, message: "Malformed CSV: INVALID_OPENING_QUOTE at line 2 of the file" }],
      totalDataRows: 0,
    });
  });

  it("names the code alone when the error carries no line count", () => {
    const tokenizer = failingTokenizer(csvParseError({ code: "CSV_QUOTE_NOT_CLOSED" }));

    const result = parseSchedulingCsvWith("ignored", tokenizer);

    assert.deepStrictEqual(result.errors, [
      { row: 0, message: "Malformed CSV: CSV_QUOTE_NOT_CLOSED" },
    ]);
  });

  it.each([
    ["an Error with no code", new Error(`unexpected ${QUOTED_INPUT}`)],
    ["a thrown string", `unexpected ${QUOTED_INPUT}`],
    ["a thrown null", null],
  ])("returns 'Malformed CSV' alone for %s", (_name, thrown) => {
    const result = parseSchedulingCsvWith("ignored", failingTokenizer(thrown));

    assert.deepStrictEqual(result, {
      validRows: [],
      errors: [{ row: 0, message: "Malformed CSV" }],
      totalDataRows: 0,
    });
  });

  it.each([
    ["a code holding more than an upper-case identifier", QUOTED_INPUT],
    ["a code that is not a string", 42],
  ])("says a code was present, without echoing it, for %s", (_name, code) => {
    const tokenizer = failingTokenizer(csvParseError({ code, lines: 2 }));

    const result = parseSchedulingCsvWith("ignored", tokenizer);

    assert.deepStrictEqual(result.errors, [
      { row: 0, message: "Malformed CSV (unrecognized tokenizer error) at line 2 of the file" },
    ]);
  });

  it("drops a line count that is not a whole number", () => {
    const tokenizer = failingTokenizer(
      csvParseError({ code: "CSV_QUOTE_NOT_CLOSED", lines: `2 ${QUOTED_INPUT}` })
    );

    const result = parseSchedulingCsvWith("ignored", tokenizer);

    assert.deepStrictEqual(result.errors, [
      { row: 0, message: "Malformed CSV: CSV_QUOTE_NOT_CLOSED" },
    ]);
  });
});

/** A tokenizer that records the length of each text it receives and returns one valid record. */
function recordingTokenizer(): { tokenize: SchedulingCsvTokenizer; inputLengths: number[] } {
  const inputLengths: number[] = [];
  return {
    inputLengths,
    tokenize: (input) => {
      inputLengths.push(input.length);
      return [{ content: "Hello", scheduledFor: "2026-07-01T09:00:00Z" }];
    },
  };
}

describe("parseSchedulingCsvWith — control characters", () => {
  it.each([
    ["U+0000 on the header line", "content\u0000,scheduledFor\nA,B", "U+0000", 1],
    ["U+0001 after a CRLF line break", "content,scheduledFor\r\nA\u0001,B", "U+0001", 2],
    ["U+0008 after a line feed", "content,scheduledFor\nA\b,B", "U+0008", 2],
    ["U+001F after two CR-only line breaks", "content,scheduledFor\rA,B\rC\u001f,D", "U+001F", 3],
  ])("refuses %s before tokenizing", (_name, csv, codePoint, line) => {
    const { tokenize, inputLengths } = recordingTokenizer();

    const result = parseSchedulingCsvWith(csv, tokenize);

    assert.deepStrictEqual(inputLengths, []);
    assert.deepStrictEqual(result, {
      validRows: [],
      errors: [
        {
          row: 0,
          message: `CSV contains control character ${codePoint} at line ${line} of the file; only tab, line feed and carriage return are allowed`,
        },
      ],
      totalDataRows: 0,
    });
  });

  it("tokenizes a CSV whose only control characters are tab, line feed and carriage return", () => {
    const { tokenize, inputLengths } = recordingTokenizer();
    const csv = "content\tx,scheduledFor\r\nA\tB,2026-07-01T09:00:00Z\nC,D\r";

    const result = parseSchedulingCsvWith(csv, tokenize);

    assert.deepStrictEqual(inputLengths, [csv.length]);
    assert.deepStrictEqual(result.errors, []);
  });
});

// A UTF-16 code unit is 1 to 3 UTF-8 bytes, so `csv.length` bounds the size both ways:
// over the cap in code units is refused, and at most a third of it is accepted, both
// without encoding; only a length in between is measured. The spy on the encoder's
// prototype counts those measurements.
describe("parseSchedulingCsvWith — byte cap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the 16 MiB body limit of POST /bulk-scheduling/parse", () => {
    assert.strictEqual(MAX_BULK_SCHEDULE_CSV_BYTES, 16 * 1024 * 1024);
  });

  it("refuses a CSV with more code units than the cap without encoding or tokenizing it", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const { tokenize, inputLengths } = recordingTokenizer();

    const result = parseSchedulingCsvWith("x".repeat(MAX_BULK_SCHEDULE_CSV_BYTES + 1), tokenize);

    assert.strictEqual(encode.mock.calls.length, 0);
    assert.deepStrictEqual(inputLengths, []);
    assert.deepStrictEqual(result, {
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

  it("tokenizes a CSV of at most a third of the cap in code units without encoding it", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const { tokenize, inputLengths } = recordingTokenizer();
    // Three UTF-8 bytes per code unit: the largest size this length allows is within the cap.
    const units = Math.floor(MAX_BULK_SCHEDULE_CSV_BYTES / 3);

    const result = parseSchedulingCsvWith("€".repeat(units), tokenize);

    assert.strictEqual(encode.mock.calls.length, 0);
    assert.deepStrictEqual(inputLengths, [units]);
    assert.deepStrictEqual(result.errors, []);
  });

  it("measures once and refuses a CSV under the cap in code units but over it in bytes", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const { tokenize, inputLengths } = recordingTokenizer();
    const characters = MAX_BULK_SCHEDULE_CSV_BYTES / 2 + 1;

    const result = parseSchedulingCsvWith("é".repeat(characters), tokenize);

    assert.deepStrictEqual(result.errors, [
      {
        row: 0,
        message: `CSV exceeds the ${MAX_BULK_SCHEDULE_CSV_BYTES}-byte limit (${characters * 2} bytes)`,
      },
    ]);
    assert.strictEqual(encode.mock.calls.length, 1);
    assert.deepStrictEqual(inputLengths, []);
  });

  it.each([
    ["one byte under the cap", MAX_BULK_SCHEDULE_CSV_BYTES - 1],
    ["exactly the cap", MAX_BULK_SCHEDULE_CSV_BYTES],
  ])("measures once and tokenizes a CSV of %s", (_name, bytes) => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const { tokenize, inputLengths } = recordingTokenizer();

    const result = parseSchedulingCsvWith("x".repeat(bytes), tokenize);

    assert.strictEqual(encode.mock.calls.length, 1);
    assert.deepStrictEqual(inputLengths, [bytes]);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.validRows.length, 1);
  });
});

// One mediaUrls cell holding both media failures: the row gets exactly one error,
// the first failure in cell order, and the next row is still validated.
const INVALID_URL = "not-a-url";
const UNKNOWN_EXTENSION_URL = "https://cdn.example.com/file.tiff";
const INVALID_URL_ERROR = { row: 1, field: "mediaUrls", message: `Invalid URL: ${INVALID_URL}` };
const UNKNOWN_EXTENSION_ERROR = {
  row: 1,
  field: "mediaUrls",
  message: `Cannot determine media type from URL: ${UNKNOWN_EXTENSION_URL} (unrecognized extension .tiff — supported: jpg/jpeg/png/webp/bmp/heic/heif/gif/mp4/mov/m4v/webm/avi/mkv)`,
};
const MEDIA_FAILURE_ORDERS = [
  [
    "an invalid URL before an unknown extension",
    [INVALID_URL, UNKNOWN_EXTENSION_URL],
    INVALID_URL_ERROR,
  ],
  [
    "an unknown extension before an invalid URL",
    [UNKNOWN_EXTENSION_URL, INVALID_URL],
    UNKNOWN_EXTENSION_ERROR,
  ],
] as const;

describe("one media error per row, the first failure", () => {
  it.each(MEDIA_FAILURE_ORDERS)(
    "returns only the first media error for %s, through the shared parser",
    (_name, urls, expected) => {
      const tokenizer: SchedulingCsvTokenizer = () => [
        { content: "Bad media", scheduledFor: "2026-07-01T09:00:00Z", mediaUrls: urls.join("|") },
        { content: "Good", scheduledFor: "2026-07-01T09:00:00Z" },
      ];

      const result = parseSchedulingCsvWith("ignored", tokenizer);

      assert.deepStrictEqual(result.errors, [expected]);
      assert.deepStrictEqual(
        result.validRows.map((r) => r.row),
        [2]
      );
    }
  );

  it.each(MEDIA_FAILURE_ORDERS)(
    "returns only the first media error for %s, through parseSchedulingCsv",
    (_name, urls, expected) => {
      const csv = `content,scheduledFor,mediaUrls\nBad media,${future(TWO_DAYS)},${urls.join("|")}\nGood,${future(TWO_DAYS)},`;

      const result = parseSchedulingCsv(csv);

      assert.deepStrictEqual(result.errors, [expected]);
      assert.deepStrictEqual(
        result.validRows.map((r) => r.row),
        [2]
      );
    }
  );
});
