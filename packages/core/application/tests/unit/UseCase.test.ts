/**
 * @file UseCase.test.ts
 * @description Unit tests for UseCaseError construction + USE_CASE_ERRORS constants —
 *   the shared error contract consumed by all @core application use cases.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { UseCaseError, USE_CASE_ERRORS } from "../../src/UseCase.js";

describe("USE_CASE_ERRORS constants", () => {
  it("defines NOT_FOUND with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.NOT_FOUND, "NOT_FOUND");
  });

  it("defines VALIDATION_FAILED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.VALIDATION_FAILED, "VALIDATION_FAILED");
  });

  it("defines UNAUTHORIZED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.UNAUTHORIZED, "UNAUTHORIZED");
  });

  it("defines FORBIDDEN with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.FORBIDDEN, "FORBIDDEN");
  });

  it("defines CONFLICT with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.CONFLICT, "CONFLICT");
  });

  it("defines INTERNAL_ERROR with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.INTERNAL_ERROR, "INTERNAL_ERROR");
  });

  it("defines NOT_IMPLEMENTED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.NOT_IMPLEMENTED, "NOT_IMPLEMENTED");
  });

  it("defines GUARDRAIL_REJECTED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.GUARDRAIL_REJECTED, "GUARDRAIL_REJECTED");
  });

  it("exposes exactly 8 known error codes (no undocumented additions)", () => {
    const keys = Object.keys(USE_CASE_ERRORS);
    assert.strictEqual(keys.length, 8);
  });
});

describe("UseCaseError", () => {
  describe("construction", () => {
    it("sets message, code, and name correctly", () => {
      const e = new UseCaseError("Not found", USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(e.message, "Not found");
      assert.strictEqual(e.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(e.name, "UseCaseError");
    });

    it("is an instance of Error (extends Error)", () => {
      const e = new UseCaseError("msg", "SOME_CODE");
      assert.ok(e instanceof Error);
    });

    it("sets originalError when a cause is provided", () => {
      const cause = new Error("root cause");
      const e = new UseCaseError("wrapper", USE_CASE_ERRORS.INTERNAL_ERROR, cause);
      assert.strictEqual(e.originalError, cause);
    });

    it("leaves originalError undefined when no cause is provided", () => {
      const e = new UseCaseError("msg", USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(e.originalError, undefined);
    });
  });

  describe("code contract", () => {
    it("code matches the USE_CASE_ERRORS constant passed at construction", () => {
      for (const [, code] of Object.entries(USE_CASE_ERRORS)) {
        const e = new UseCaseError("test", code);
        assert.strictEqual(e.code, code, `Expected code ${code}`);
      }
    });
  });
});
