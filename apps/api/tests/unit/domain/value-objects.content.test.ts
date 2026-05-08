/**
 * @file value-objects.content.test.ts
 * @description Mutation-killing tests for Content value object.
 * Covers creation, validation, platform limits, immutable updates, equality.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { Content, CONTENT_LOCALES } from "../../../src/domain/value-objects/Content.js";
import { MediaId } from "../../../src/domain/value-objects/EntityId.js";

describe("Content value object", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe("create", () => {
    it("creates content with valid body", () => {
      const result = Content.create({ body: "Hello world" });
      assert.ok(result.ok);
      assert.equal(result.value.body, "Hello world");
    });

    it("trims body whitespace", () => {
      const result = Content.create({ body: "  Hello  " });
      assert.ok(result.ok);
      assert.equal(result.value.body, "Hello");
    });

    it("defaults locale to en", () => {
      const result = Content.create({ body: "Test" });
      assert.ok(result.ok);
      assert.equal(result.value.locale, "en");
    });

    it("accepts valid locale", () => {
      const result = Content.create({ body: "Hola", locale: "es" });
      assert.ok(result.ok);
      assert.equal(result.value.locale, "es");
    });

    it("rejects empty body", () => {
      const result = Content.create({ body: "" });
      assert.ok(!result.ok);
    });

    it("rejects whitespace-only body", () => {
      const result = Content.create({ body: "   " });
      assert.ok(!result.ok);
    });

    it("deduplicates tags", () => {
      const result = Content.create({ body: "Test", tags: ["a", "b", "a"] });
      assert.ok(result.ok);
      assert.equal(result.value.tags.length, 2);
    });

    it("removes empty tags", () => {
      const result = Content.create({ body: "Test", tags: ["valid", "", "  "] });
      assert.ok(result.ok);
      assert.equal(result.value.tags.length, 1);
      assert.equal(result.value.tags[0], "valid");
    });

    it("sets title when provided", () => {
      const result = Content.create({ body: "Body", title: "Title" });
      assert.ok(result.ok);
      assert.equal(result.value.title, "Title");
    });

    it("trims title whitespace", () => {
      const result = Content.create({ body: "Body", title: "  Title  " });
      assert.ok(result.ok);
      assert.equal(result.value.title, "Title");
    });

    it("sets summary when provided", () => {
      const result = Content.create({ body: "Body", summary: "Summary" });
      assert.ok(result.ok);
      assert.equal(result.value.summary, "Summary");
    });

    it("sets mediaIds when provided", () => {
      const mediaId = MediaId.generate();
      const result = Content.create({ body: "Body", mediaIds: [mediaId] });
      assert.ok(result.ok);
      assert.equal(result.value.mediaIds.length, 1);
    });

    it("defaults to empty tags when not provided", () => {
      const result = Content.create({ body: "Test" });
      assert.ok(result.ok);
      assert.equal(result.value.tags.length, 0);
    });

    it("defaults to empty mediaIds when not provided", () => {
      const result = Content.create({ body: "Test" });
      assert.ok(result.ok);
      assert.equal(result.value.mediaIds.length, 0);
    });
  });

  // =========================================================================
  // reconstitute
  // =========================================================================

  describe("reconstitute", () => {
    it("reconstitutes content from stored data", () => {
      const content = Content.reconstitute({
        body: "Stored body",
        tags: ["tag1"],
        locale: "en",
      });
      assert.equal(content.body, "Stored body");
      assert.equal(content.tags.length, 1);
    });

    it("deduplicates tags during reconstitution", () => {
      const content = Content.reconstitute({
        body: "Body",
        tags: ["a", "a", "b"],
        locale: "en",
      });
      assert.equal(content.tags.length, 2);
    });

    it("allows empty body during reconstitution", () => {
      // reconstitute bypasses empty body validation
      const content = Content.reconstitute({
        body: "",
        tags: [],
        locale: "en",
      });
      assert.equal(content.body, "");
    });
  });

  // =========================================================================
  // fitsInPlatform
  // =========================================================================

  describe("fitsInPlatform", () => {
    it("returns ok for short content on X", () => {
      const result = Content.create({ body: "Short tweet" });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("X");
      assert.ok(fits.ok);
    });

    it("returns error for body > 280 chars on X", () => {
      const longBody = "a".repeat(281);
      const result = Content.create({ body: longBody });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("X");
      assert.ok(!fits.ok);
    });

    it("accepts exactly 280 chars on X", () => {
      const exactBody = "a".repeat(280);
      const result = Content.create({ body: exactBody });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("X");
      assert.ok(fits.ok);
    });

    it("returns error for title > 100 chars on YouTube", () => {
      const result = Content.create({ body: "Body", title: "a".repeat(101) });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("YOUTUBE");
      assert.ok(!fits.ok);
    });

    it("accepts body up to 5000 chars on YouTube", () => {
      const result = Content.create({ body: "a".repeat(5000) });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("YOUTUBE");
      assert.ok(fits.ok);
    });

    it("accepts long body on Facebook (63206 limit)", () => {
      const result = Content.create({ body: "a".repeat(10000) });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("FACEBOOK");
      assert.ok(fits.ok);
    });

    it("accepts 2200 chars on Instagram", () => {
      const result = Content.create({ body: "a".repeat(2200) });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("INSTAGRAM");
      assert.ok(fits.ok);
    });

    it("rejects 2201 chars on Instagram", () => {
      const result = Content.create({ body: "a".repeat(2201) });
      assert.ok(result.ok);
      const fits = result.value.fitsInPlatform("INSTAGRAM");
      assert.ok(!fits.ok);
    });
  });

  // =========================================================================
  // Computed properties
  // =========================================================================

  describe("computed properties", () => {
    it("characterCount includes body length", () => {
      const result = Content.create({ body: "Hello" });
      assert.ok(result.ok);
      assert.equal(result.value.characterCount, 5);
    });

    it("characterCount includes title + body", () => {
      const result = Content.create({ body: "Body", title: "Title" });
      assert.ok(result.ok);
      assert.equal(result.value.characterCount, 9); // 4 + 5
    });

    it("wordCount counts words correctly", () => {
      const result = Content.create({ body: "Hello beautiful world" });
      assert.ok(result.ok);
      assert.equal(result.value.wordCount, 3);
    });

    it("wordCount includes title words", () => {
      const result = Content.create({ body: "body text", title: "My Title" });
      assert.ok(result.ok);
      assert.equal(result.value.wordCount, 4);
    });

    it("hasMedia returns false when no media", () => {
      const result = Content.create({ body: "No media" });
      assert.ok(result.ok);
      assert.equal(result.value.hasMedia, false);
    });

    it("hasMedia returns true when media present", () => {
      const result = Content.create({ body: "With media", mediaIds: [MediaId.generate()] });
      assert.ok(result.ok);
      assert.equal(result.value.hasMedia, true);
    });
  });

  // =========================================================================
  // Immutable updates
  // =========================================================================

  describe("immutable updates", () => {
    it("withBody returns new Content with updated body", () => {
      const original = Content.create({ body: "Original" });
      assert.ok(original.ok);
      const updated = original.value.withBody("Updated");
      assert.ok(updated.ok);
      assert.equal(updated.value.body, "Updated");
      assert.equal(original.value.body, "Original"); // unchanged
    });

    it("withBody rejects empty body", () => {
      const original = Content.create({ body: "Original" });
      assert.ok(original.ok);
      const updated = original.value.withBody("");
      assert.ok(!updated.ok);
    });

    it("withTitle returns new Content with updated title", () => {
      const original = Content.create({ body: "Body", title: "Old" });
      assert.ok(original.ok);
      const updated = original.value.withTitle("New");
      assert.equal(updated.title, "New");
      assert.equal(original.value.title, "Old"); // unchanged
    });

    it("withTitle clears title with undefined", () => {
      const original = Content.create({ body: "Body", title: "Title" });
      assert.ok(original.ok);
      const updated = original.value.withTitle(undefined);
      assert.equal(updated.title, undefined);
    });

    it("withTags returns new Content with updated tags", () => {
      const original = Content.create({ body: "Body", tags: ["old"] });
      assert.ok(original.ok);
      const updated = original.value.withTags(["new", "tags"]);
      assert.deepEqual([...updated.tags], ["new", "tags"]);
    });

    it("withTags deduplicates new tags", () => {
      const original = Content.create({ body: "Body" });
      assert.ok(original.ok);
      const updated = original.value.withTags(["a", "a", "b"]);
      assert.equal(updated.tags.length, 2);
    });

    it("withMedia appends media to existing", () => {
      const id1 = MediaId.generate();
      const id2 = MediaId.generate();
      const original = Content.create({ body: "Body", mediaIds: [id1] });
      assert.ok(original.ok);
      const updated = original.value.withMedia([id2]);
      assert.equal(updated.mediaIds.length, 2);
    });
  });

  // =========================================================================
  // Equality
  // =========================================================================

  describe("equals", () => {
    it("returns true for identical content", () => {
      const a = Content.create({ body: "Same", locale: "en", tags: ["tag"] });
      const b = Content.create({ body: "Same", locale: "en", tags: ["tag"] });
      assert.ok(a.ok && b.ok);
      assert.equal(a.value.equals(b.value), true);
    });

    it("returns false for different body", () => {
      const a = Content.create({ body: "A" });
      const b = Content.create({ body: "B" });
      assert.ok(a.ok && b.ok);
      assert.equal(a.value.equals(b.value), false);
    });

    it("returns false for different locale", () => {
      const a = Content.create({ body: "Same", locale: "en" });
      const b = Content.create({ body: "Same", locale: "es" });
      assert.ok(a.ok && b.ok);
      assert.equal(a.value.equals(b.value), false);
    });

    it("returns false for different tags", () => {
      const a = Content.create({ body: "Same", tags: ["a"] });
      const b = Content.create({ body: "Same", tags: ["b"] });
      assert.ok(a.ok && b.ok);
      assert.equal(a.value.equals(b.value), false);
    });

    it("returns false for different tag count", () => {
      const a = Content.create({ body: "Same", tags: ["a"] });
      const b = Content.create({ body: "Same", tags: ["a", "b"] });
      assert.ok(a.ok && b.ok);
      assert.equal(a.value.equals(b.value), false);
    });
  });

  // =========================================================================
  // toJSON
  // =========================================================================

  describe("toJSON", () => {
    it("serializes content correctly", () => {
      const result = Content.create({ body: "Test", title: "Title", tags: ["tag1"], locale: "en" });
      assert.ok(result.ok);
      const json = result.value.toJSON();
      assert.equal(json.body, "Test");
      assert.equal(json.title, "Title");
      assert.deepEqual(json.tags, ["tag1"]);
      assert.equal(json.locale, "en");
    });

    it("includes mediaIds as strings", () => {
      const mediaId = MediaId.generate();
      const result = Content.create({ body: "Test", mediaIds: [mediaId] });
      assert.ok(result.ok);
      const json = result.value.toJSON();
      assert.ok(Array.isArray(json.mediaIds));
      assert.equal((json.mediaIds as string[]).length, 1);
    });
  });

  // =========================================================================
  // CONTENT_LOCALES
  // =========================================================================

  describe("CONTENT_LOCALES", () => {
    it("includes en and es", () => {
      expect(CONTENT_LOCALES).toContain("en");
      expect(CONTENT_LOCALES).toContain("es");
    });

    it("includes all expected locales", () => {
      for (const locale of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh"]) {
        expect(CONTENT_LOCALES).toContain(locale);
      }
    });

    it("has exactly 9 locales", () => {
      assert.equal(CONTENT_LOCALES.length, 9);
    });
  });
});
