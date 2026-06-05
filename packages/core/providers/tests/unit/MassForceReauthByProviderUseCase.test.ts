/**
 * @file MassForceReauthByProviderUseCase.test.ts
 * @description Unit tests for MassForceReauthByProviderUseCase.
 *   Tier 3 — mocks ChannelRepository; asserts the Result and output shape.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { MassForceReauthByProviderUseCase } from "../../src/MassForceReauthByProviderUseCase.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CH1 = "c1000000-0000-4000-8000-000000000001";
const CH2 = "c2000000-0000-4000-8000-000000000002";

function makeChannelRepo(flagCount = 2, flagIds = [CH1, CH2]): ChannelRepository {
  return {
    bulkMarkForReauthByProvider: vi.fn(async () => ({ count: flagCount, channelIds: flagIds })),
    bulkSoftDeleteByProvider: vi.fn(async () => ({ count: 0, channelIds: [] })),
    findIdsByProjectId: vi.fn(async () => []),
    findByProjectId: vi.fn(async () => []),
    findById: vi.fn(async () => ({ ok: false, error: new Error("not found") })),
    findConnectionViewsByProjectScopedToAccount: vi.fn(async () => []),
    findOwnerAccountIdByChannelId: vi.fn(async () => ({ ok: true, value: "acc-1" })),
    findByProjectAndProvider: vi.fn(async () => []),
    findPrimaryByProjectAndProvider: vi.fn(async () => ({
      ok: false,
      error: new Error("not found"),
    })),
    findByProjectProviderAccount: vi.fn(async () => null),
    findUsageByChannelIds: vi.fn(async () => new Map()),
    save: vi.fn(async () => ({ ok: true, value: undefined })),
    delete: vi.fn(async () => ({ ok: true, value: undefined })),
    hardDelete: vi.fn(async () => ({ ok: true, value: undefined })),
  } as unknown as ChannelRepository;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MassForceReauthByProviderUseCase", () => {
  let channelRepo: ReturnType<typeof makeChannelRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    channelRepo = makeChannelRepo();
  });

  describe("happy path — channels flagged", () => {
    it("returns ok with channelsFlagged count when provider is valid", async () => {
      const useCase = new MassForceReauthByProviderUseCase(channelRepo);

      const result = await useCase.execute({
        provider: "INSTAGRAM",
        reason: "OAuth client secret rotated",
      });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.channelsFlagged, 2);
      assert.deepStrictEqual(result.value.channelIds, [CH1, CH2]);
      assert.strictEqual(result.value.provider, "INSTAGRAM");
    });
  });

  describe("no channels — empty result is still ok", () => {
    it("returns ok with zero counts when no channels exist for the provider", async () => {
      const emptyRepo = makeChannelRepo(0, []);
      const useCase = new MassForceReauthByProviderUseCase(emptyRepo);

      const result = await useCase.execute({
        provider: "TIKTOK",
        reason: "Security audit",
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.channelsFlagged, 0);
      assert.deepStrictEqual(result.value.channelIds, []);
    });
  });

  describe("validation failed — empty provider", () => {
    it("returns VALIDATION_FAILED when provider string is blank", async () => {
      const useCase = new MassForceReauthByProviderUseCase(channelRepo);

      const result = await useCase.execute({ provider: "   ", reason: "rotation" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("validation failed — invalid provider name", () => {
    it("returns VALIDATION_FAILED when provider is not a known enum value", async () => {
      const useCase = new MassForceReauthByProviderUseCase(channelRepo);

      const result = await useCase.execute({ provider: "UNKNOWN_PROVIDER", reason: "rotation" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });
});
