/**
 * @file EmailAddress.test.ts
 * @description Unit tests for normalizeEmail — the single definition of when two
 *   typed addresses are the same registration identity.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";

describe("normalizeEmail", () => {
  describe("identity folding", () => {
    it("returns the same value for addresses differing only in case", () => {
      const canonical = normalizeEmail("foo@example.com");

      assert.strictEqual(normalizeEmail("Foo@Example.com"), canonical);
      assert.strictEqual(normalizeEmail("FOO@EXAMPLE.COM"), canonical);
      assert.strictEqual(normalizeEmail("fOo@eXaMpLe.CoM"), canonical);
    });

    it("folds the LOCAL part, not just the domain", () => {
      // The domain is case-insensitive per DNS, but the local part is the half
      // a naive `toLowerCase()` on the domain alone would miss — and the half
      // that actually causes duplicate registrations.
      assert.strictEqual(normalizeEmail("Foo@example.com"), "foo@example.com");
    });

    it("strips surrounding whitespace", () => {
      assert.strictEqual(normalizeEmail("  foo@example.com  "), "foo@example.com");
      assert.strictEqual(normalizeEmail("\tfoo@example.com\n"), "foo@example.com");
    });

    it("folds case and whitespace together", () => {
      assert.strictEqual(normalizeEmail("  Foo@Example.COM  "), "foo@example.com");
    });
  });

  describe("idempotency", () => {
    // The data migration and the write path both rely on this: re-running
    // normalization over already-normalized rows must be a no-op, or the
    // backfill's `WHERE email <> lower(btrim(email))` guard would keep matching.
    it("returns its own output unchanged when applied twice", () => {
      for (const raw of [
        "  Foo@Example.COM ",
        "foo@example.com",
        "A@B.CO",
        "",
        "   ",
        "not-an-address",
      ]) {
        const once = normalizeEmail(raw);
        assert.strictEqual(normalizeEmail(once), once, `not idempotent for ${JSON.stringify(raw)}`);
      }
    });
  });

  describe("distinct addresses stay distinct", () => {
    it("does not collapse addresses that differ by more than case or padding", () => {
      assert.notStrictEqual(normalizeEmail("foo@example.com"), normalizeEmail("bar@example.com"));
      assert.notStrictEqual(normalizeEmail("foo@example.com"), normalizeEmail("foo@example.org"));
      // Internal whitespace is NOT stripped — only the ends are trimmed. An
      // address with a space in the middle is not the same identity as one
      // without, and silently welding them would merge two distinct rows.
      assert.notStrictEqual(normalizeEmail("fo o@example.com"), normalizeEmail("foo@example.com"));
    });

    it("preserves the plus-addressing tag rather than stripping it", () => {
      // Gmail treats `foo+tag@` as an alias of `foo@`, but that is a
      // PROVIDER-specific rule, not a general one. Applying it here would merge
      // two addresses that other providers deliver to different mailboxes.
      assert.strictEqual(normalizeEmail("Foo+Tag@Example.com"), "foo+tag@example.com");
      assert.notStrictEqual(
        normalizeEmail("foo+tag@example.com"),
        normalizeEmail("foo@example.com")
      );
    });
  });
});
