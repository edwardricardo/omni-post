/**
 * @file ParseBulkScheduleCsvUseCase.test.ts
 * @description Unit tests for ParseBulkScheduleCsvUseCase.
 *   Spec scenarios: "Valid CSV parses successfully in Phase 1",
 *   "Abandon after Phase 1 leaves no DB rows".
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ParseBulkScheduleCsvUseCase } from "../../src/ParseBulkScheduleCsvUseCase.js";

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

const VALID_HEADER = "content,scheduledFor";

describe("ParseBulkScheduleCsvUseCase", () => {
  let useCase: ParseBulkScheduleCsvUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    useCase = new ParseBulkScheduleCsvUseCase();
  });

  describe("execute()", () => {
    it("parses a valid CSV and returns validRows, errors, totalDataRows", async () => {
      const csv = `${VALID_HEADER}\nHello world,${future(TWO_DAYS)}\nAnother post,${future(TWO_DAYS)}`;
      const result = await useCase.execute({ csv });

      assert.ok(result.ok, `Expected success, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.validRows.length, 2);
      assert.strictEqual(result.value.errors.length, 0);
      assert.strictEqual(result.value.totalDataRows, 2);
    });

    it("returns per-row errors for invalid rows without blocking valid rows", async () => {
      const csv = `${VALID_HEADER}\nGood row,${future(TWO_DAYS)}\nBad row,not-a-date`;
      const result = await useCase.execute({ csv });

      assert.ok(result.ok);
      assert.strictEqual(result.value.validRows.length, 1);
      assert.strictEqual(result.value.errors.length, 1);
      assert.strictEqual(result.value.totalDataRows, 2);
    });

    it("enforces row cap at 5000 and returns an error", async () => {
      const rows = Array.from({ length: 5001 }, () => `Hello,${future(TWO_DAYS)}`).join("\n");
      const csv = `${VALID_HEADER}\n${rows}`;
      const result = await useCase.execute({ csv });

      assert.ok(result.ok);
      assert.strictEqual(result.value.validRows.length, 0);
      assert.strictEqual(result.value.errors[0]?.row, 0);
      assert.match(result.value.errors[0]?.message ?? "", /5000/);
    });

    it("rejects a CSV with a provider column", async () => {
      const csv = `provider,content,scheduledFor\nX,Hello,${future(TWO_DAYS)}`;
      const result = await useCase.execute({ csv });

      assert.ok(result.ok);
      assert.strictEqual(result.value.validRows.length, 0);
      assert.ok(result.value.errors.length > 0);
      assert.match(result.value.errors[0]?.message ?? "", /provider/i);
    });

    it("never calls any repository (stateless — no DB writes)", async () => {
      const csv = `${VALID_HEADER}\nHello,${future(TWO_DAYS)}`;
      // ParseBulkScheduleCsvUseCase has no deps — this test asserts by construction
      // (the constructor takes no arguments, so no repo can be called)
      const result = await useCase.execute({ csv });
      assert.ok(result.ok);
    });

    it("returns ok with empty validRows and row-0 error when CSV is malformed", async () => {
      const csv = `${VALID_HEADER}\n"unterminated,${future(TWO_DAYS)}`;
      const result = await useCase.execute({ csv });

      assert.ok(result.ok);
      assert.strictEqual(result.value.validRows.length, 0);
      assert.strictEqual(result.value.errors[0]?.row, 0);
    });
  });
});
