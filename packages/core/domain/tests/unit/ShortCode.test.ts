/**
 * @file ShortCode.test.ts
 * @description Unit tests for the ShortCode value object — construction validation,
 *   random generation, immutability (private field), and value equality.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ShortCode } from "@core/domain/value-objects/ShortCode.js";

describe("ShortCode", () => {
  describe("fromString — valid inputs", () => {
    it("constructs successfully with a 3-character alphanumeric code", () => {
      const r = ShortCode.fromString("abc");
      assert.ok(r.ok);
      assert.strictEqual(r.value.value, "abc");
    });

    it("constructs successfully with hyphens", () => {
      const r = ShortCode.fromString("my-link-01");
      assert.ok(r.ok);
      assert.strictEqual(r.value.value, "my-link-01");
    });

    it("constructs successfully with a 50-character code (max length)", () => {
      const max = "a".repeat(50);
      const r = ShortCode.fromString(max);
      assert.ok(r.ok);
      assert.strictEqual(r.value.value.length, 50);
    });

    it("trims surrounding whitespace before validating", () => {
      const r = ShortCode.fromString("  abc  ");
      assert.ok(r.ok);
      assert.strictEqual(r.value.value, "abc");
    });
  });

  describe("fromString — invalid inputs", () => {
    it("rejects a code shorter than 3 characters", () => {
      const r = ShortCode.fromString("ab");
      assert.ok(!r.ok);
      assert.match(r.error.message, /at least 3/i);
    });

    it("rejects an empty string", () => {
      const r = ShortCode.fromString("");
      assert.ok(!r.ok);
    });

    it("rejects a code longer than 50 characters", () => {
      const r = ShortCode.fromString("a".repeat(51));
      assert.ok(!r.ok);
      assert.match(r.error.message, /at most 50/i);
    });

    it("rejects codes containing spaces", () => {
      const r = ShortCode.fromString("short code");
      assert.ok(!r.ok);
      assert.match(r.error.message, /letters, numbers, and hyphens/i);
    });

    it("rejects codes containing special characters (underscore, slash)", () => {
      const r = ShortCode.fromString("short_code");
      assert.ok(!r.ok);
    });
  });

  describe("generate", () => {
    it("generates a code of exactly 8 characters", () => {
      const code = ShortCode.generate();
      assert.strictEqual(code.value.length, 8);
    });

    it("generated code passes alphanumeric-hyphen validation", () => {
      const code = ShortCode.generate();
      const r = ShortCode.fromString(code.value);
      assert.ok(r.ok, `Generated code '${code.value}' did not pass re-validation`);
    });

    it("two consecutive generations produce different values (with overwhelming probability)", () => {
      const a = ShortCode.generate();
      const b = ShortCode.generate();
      // Collision probability is 1/(57^8) ≈ 2e-14 — effectively never
      assert.notStrictEqual(a.value, b.value);
    });
  });

  describe("equality + immutability", () => {
    it("two instances with the same value are equal", () => {
      const a = ShortCode.fromString("abc123");
      const b = ShortCode.fromString("abc123");
      assert.ok(a.ok && b.ok);
      assert.ok(a.value.equals(b.value));
    });

    it("two instances with different values are not equal", () => {
      const a = ShortCode.fromString("abc");
      const b = ShortCode.fromString("xyz");
      assert.ok(a.ok && b.ok);
      assert.ok(!a.value.equals(b.value));
    });

    it("toString and toJSON both return the raw code string", () => {
      const r = ShortCode.fromString("my-code");
      assert.ok(r.ok);
      assert.strictEqual(r.value.toString(), "my-code");
      assert.strictEqual(r.value.toJSON(), "my-code");
    });
  });
});
