/**
 * @file schedulingCsv.test.ts
 * @description Unit tests for the refactored content-pure CSV schema.
 *   Spec scenarios: all of "Content-Pure CSV Contract" — required headers,
 *   rejected provider column, row cap, per-row errors, media-type inference.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseSchedulingCsv, REQUIRED_HEADERS } from "../../src/schedulingCsv.js";

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
