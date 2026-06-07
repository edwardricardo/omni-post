/**
 * @file IncrementUsageUseCase.test.ts
 * @description Unit tests for IncrementUsageUseCase.
 *   Tier 3 — mocks UsageMetricRepository; verifies increment + validation contract.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { IncrementUsageUseCase } from "../../src/IncrementUsageUseCase.js";
import type { UsageMetricRepository } from "@core/domain/repositories/UsageMetricRepository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";

function makeRepo(): UsageMetricRepository {
  return {
    increment: vi.fn(async () => undefined),
    findByAccountPeriod: vi.fn(async () => null),
  } as unknown as UsageMetricRepository;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncrementUsageUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
  });

  describe("happy path — increment postsPublished", () => {
    it("returns ok(undefined) when accountId is valid and field is postsPublished", async () => {
      const useCase = new IncrementUsageUseCase(repo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID, field: "postsPublished" });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value, undefined);
    });
  });

  describe("happy path — increment aiCallsMade with custom delta", () => {
    it("returns ok(undefined) when field is aiCallsMade and delta is provided", async () => {
      const useCase = new IncrementUsageUseCase(repo);

      const result = await useCase.execute({
        accountId: ACCOUNT_ID,
        field: "aiCallsMade",
        delta: 5,
      });

      assert.ok(result.ok);
    });
  });

  describe("validation failed — empty accountId", () => {
    it("returns VALIDATION_FAILED error when accountId is an empty string", async () => {
      const useCase = new IncrementUsageUseCase(repo);

      const result = await useCase.execute({ accountId: "", field: "postsPublished" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("internal error — repository throws", () => {
    it("returns INTERNAL_ERROR when the repository increment call throws", async () => {
      const failingRepo: UsageMetricRepository = {
        ...repo,
        increment: vi.fn(async () => {
          throw new Error("DB error");
        }),
      } as unknown as UsageMetricRepository;
      const useCase = new IncrementUsageUseCase(failingRepo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID, field: "postsPublished" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});
