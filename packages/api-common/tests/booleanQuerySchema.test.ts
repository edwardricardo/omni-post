/**
 * @file booleanQuerySchema.test.ts
 * @description Tests for the shared boolean query-string schema: the two
 *              spellings a query string can carry map to booleans, every other
 *              value is refused, and optional/default composition keeps the
 *              default of each flag when the parameter is absent.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { BooleanQuerySchema } from "../src/schemas.js";

describe("BooleanQuerySchema", () => {
  it("returns true when the value is the string true", () => {
    expect(BooleanQuerySchema.parse("true")).toBe(true);
  });

  it("returns false when the value is the string false", () => {
    expect(BooleanQuerySchema.parse("false")).toBe(false);
  });

  it.each(["", "TRUE", "False", "1", "0", "yes", "no", " true", "true "])(
    "refuses the string %j",
    (value) => {
      expect(BooleanQuerySchema.safeParse(value).success).toBe(false);
    }
  );

  it.each([
    ["a real boolean", true],
    ["a number", 1],
    ["null", null],
    ["a repeated key", ["true", "false"]],
  ])("refuses %s", (_label, value) => {
    expect(BooleanQuerySchema.safeParse(value).success).toBe(false);
  });

  describe("composed with optional and default", () => {
    const schema = z.object({
      flag: BooleanQuerySchema.optional(),
      withDefault: BooleanQuerySchema.default(true),
    });

    it("leaves an absent optional flag undefined and applies the default", () => {
      expect(schema.parse({})).toEqual({ flag: undefined, withDefault: true });
    });

    it("turns a defaulted flag off when the value is false", () => {
      expect(schema.parse({ withDefault: "false" }).withDefault).toBe(false);
    });

    it("keeps a defaulted flag on when the value is true", () => {
      expect(schema.parse({ withDefault: "true" }).withDefault).toBe(true);
    });

    it("reads an optional flag given as false as false, not as absent", () => {
      expect(schema.parse({ flag: "false" }).flag).toBe(false);
    });

    it("refuses an empty value on a defaulted flag instead of applying the default", () => {
      expect(schema.safeParse({ withDefault: "" }).success).toBe(false);
    });
  });
});
