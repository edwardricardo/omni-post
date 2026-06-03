/**
 * @file bulkSchedulingCsvParser.integration.test.ts
 * @description Tests for the client-side bulk scheduling CSV parser.
 *              Validates that it converges with the shared server-side schema:
 *              same required headers, same media-type extension table,
 *              same row cap, and rejects the legacy `provider` column.
 *              Uses PapaParse (browser-safe) as the tokenizer, but validates
 *              each row via the SHARED Zod schema + media-type table from
 *              `packages/core/bulk-scheduling/src/schedulingCsv.ts`.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
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
});
