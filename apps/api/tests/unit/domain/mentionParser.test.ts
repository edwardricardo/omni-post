/**
 * @file mentionParser.test.ts
 * @description Unit tests for the MentionParser domain service.
 *   Validates parsing, validation, plain text conversion, and deduplication.
 */

import { describe, it, expect } from "vitest";
import { MentionParser } from "../../../src/domain/services/MentionParser.js";

describe("MentionParser", () => {
  describe("parse", () => {
    it("returns empty array when text has no mentions", () => {
      const result = MentionParser.parse("Hello, this is a regular note.");
      expect(result).toEqual([]);
    });

    it("parses a single mention", () => {
      const text = "Hey @[Alice Smith](uuid-001), can you check this?";
      const result = MentionParser.parse(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        displayName: "Alice Smith",
        customerUserId: "uuid-001",
        raw: "@[Alice Smith](uuid-001)",
      });
    });

    it("parses multiple mentions", () => {
      const text = "@[Alice](id-1) and @[Bob](id-2) should review this.";
      const result = MentionParser.parse(text);

      expect(result).toHaveLength(2);
      expect(result[0]?.customerUserId).toBe("id-1");
      expect(result[1]?.customerUserId).toBe("id-2");
    });

    it("parses mentions with UUID-style IDs", () => {
      const text = "cc @[Jane Doe](550e8400-e29b-41d4-a716-446655440000)";
      const result = MentionParser.parse(text);

      expect(result).toHaveLength(1);
      expect(result[0]?.customerUserId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("ignores malformed mentions - plain @word without brackets", () => {
      const text = "Hey @alice, can you review? Also @bob";
      const result = MentionParser.parse(text);
      expect(result).toEqual([]);
    });

    it("ignores incomplete bracket syntax", () => {
      const text = "Hey @[Alice] check this @[Bob](";
      const result = MentionParser.parse(text);
      expect(result).toEqual([]);
    });

    it("handles empty string", () => {
      const result = MentionParser.parse("");
      expect(result).toEqual([]);
    });

    it("handles mention at start and end of text", () => {
      const text = "@[Start](id-1) middle text @[End](id-2)";
      const result = MentionParser.parse(text);

      expect(result).toHaveLength(2);
      expect(result[0]?.displayName).toBe("Start");
      expect(result[1]?.displayName).toBe("End");
    });
  });

  describe("validate", () => {
    it("returns true when all mentions reference valid team member IDs", () => {
      const mentions = [
        { displayName: "Alice", customerUserId: "id-1", raw: "@[Alice](id-1)" },
        { displayName: "Bob", customerUserId: "id-2", raw: "@[Bob](id-2)" },
      ];
      const validIds = ["id-1", "id-2", "id-3"];

      expect(MentionParser.validate(mentions, validIds)).toBe(true);
    });

    it("returns false when a mention references an invalid team member ID", () => {
      const mentions = [
        { displayName: "Alice", customerUserId: "id-1", raw: "@[Alice](id-1)" },
        { displayName: "Ghost", customerUserId: "id-999", raw: "@[Ghost](id-999)" },
      ];
      const validIds = ["id-1", "id-2"];

      expect(MentionParser.validate(mentions, validIds)).toBe(false);
    });

    it("returns true when mentions array is empty", () => {
      expect(MentionParser.validate([], ["id-1"])).toBe(true);
    });

    it("returns false when valid IDs array is empty but mentions exist", () => {
      const mentions = [{ displayName: "Alice", customerUserId: "id-1", raw: "@[Alice](id-1)" }];
      expect(MentionParser.validate(mentions, [])).toBe(false);
    });
  });

  describe("toPlainText", () => {
    it("replaces mention markup with plain @Name", () => {
      const text = "Hey @[Alice Smith](uuid-001), please review.";
      const result = MentionParser.toPlainText(text);

      expect(result).toBe("Hey @Alice Smith, please review.");
    });

    it("handles multiple mentions", () => {
      const text = "@[Alice](id-1) and @[Bob](id-2) should check.";
      const result = MentionParser.toPlainText(text);

      expect(result).toBe("@Alice and @Bob should check.");
    });

    it("returns original text when no mentions present", () => {
      const text = "No mentions here.";
      expect(MentionParser.toPlainText(text)).toBe(text);
    });

    it("handles empty string", () => {
      expect(MentionParser.toPlainText("")).toBe("");
    });
  });

  describe("extractUniqueIds", () => {
    it("extracts unique team member IDs from text", () => {
      const text = "@[Alice](id-1) and @[Bob](id-2) need to see this.";
      const result = MentionParser.extractUniqueIds(text);

      expect(result).toEqual(["id-1", "id-2"]);
    });

    it("deduplicates repeated mentions of the same person", () => {
      const text = "@[Alice](id-1) said something. @[Alice](id-1) agreed.";
      const result = MentionParser.extractUniqueIds(text);

      expect(result).toEqual(["id-1"]);
    });

    it("returns empty array when no mentions", () => {
      expect(MentionParser.extractUniqueIds("No mentions")).toEqual([]);
    });
  });
});
