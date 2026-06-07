/**
 * @file GetOrCreateReferralCodeUseCase.test.ts
 * @description Unit tests for GetOrCreateReferralCodeUseCase.
 *   Tier 3 — mocks ReferralCodeRepository; verifies idempotent get-or-create contract.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GetOrCreateReferralCodeUseCase } from "../../src/GetOrCreateReferralCodeUseCase.js";
import type { ReferralCodeRepository } from "../../src/GetOrCreateReferralCodeUseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const CLIENT_URL = "https://app.example.com";
const EXISTING_CODE = "ACME2025-AABBCC";

function makeRepo(
  existingCode?: { code: string; usageCount: number; conversions: number } | null
): ReferralCodeRepository {
  return {
    findByAccountId: vi.fn(async () => existingCode ?? null),
    create: vi.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GetOrCreateReferralCodeUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("existing code returned — idempotent", () => {
    it("returns ok with the existing code and shareUrl when account already has a code", async () => {
      const repo = makeRepo({ code: EXISTING_CODE, usageCount: 5, conversions: 2 });
      const useCase = new GetOrCreateReferralCodeUseCase(repo, CLIENT_URL);

      const result = await useCase.execute({ accountId: ACCOUNT_ID });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.code, EXISTING_CODE);
      assert.ok(result.value.shareUrl.includes(EXISTING_CODE));
      assert.strictEqual(result.value.usageCount, 5);
      assert.strictEqual(result.value.conversions, 2);
    });
  });

  describe("new code created", () => {
    it("returns ok with a newly generated code when account has no existing code", async () => {
      const repo = makeRepo(null);
      const useCase = new GetOrCreateReferralCodeUseCase(repo, CLIENT_URL);

      const result = await useCase.execute({ accountId: ACCOUNT_ID, accountName: "TestCo" });

      assert.ok(result.ok);
      assert.ok(typeof result.value.code === "string" && result.value.code.length > 0);
      assert.ok(result.value.shareUrl.startsWith(CLIENT_URL));
      assert.strictEqual(result.value.usageCount, 0);
      assert.strictEqual(result.value.conversions, 0);
    });
  });

  describe("shareUrl format", () => {
    it("includes the code as a ref query param in the shareUrl", async () => {
      const repo = makeRepo({ code: EXISTING_CODE, usageCount: 0, conversions: 0 });
      const useCase = new GetOrCreateReferralCodeUseCase(repo, CLIENT_URL);

      const result = await useCase.execute({ accountId: ACCOUNT_ID });

      assert.ok(result.ok);
      assert.ok(result.value.shareUrl.includes(`ref=${EXISTING_CODE}`));
    });
  });

  describe("new code respects accountName prefix", () => {
    it("generates a code that starts with the sanitized account name prefix", async () => {
      const repo = makeRepo(null);
      const useCase = new GetOrCreateReferralCodeUseCase(repo, CLIENT_URL);

      const result = await useCase.execute({ accountId: ACCOUNT_ID, accountName: "AcmeCorp" });

      assert.ok(result.ok);
      assert.ok(
        result.value.code.startsWith("ACMECORP") || result.value.code.startsWith("ACME"),
        `Code ${result.value.code} should start with ACME prefix`
      );
    });
  });
});
