/**
 * @file MassForceReauthByProviderUseCase.test.ts
 * @description Unit tests for the cross-tenant mass force-reauth use case.
 *              Stubs both repositories to verify validation, tier toggles,
 *              and aggregated DTO output.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { MassForceReauthByProviderUseCase } from "../../../../src/application/providers/MassForceReauthByProviderUseCase.js";
import type { ChannelRepository } from "../../../../src/domain/repositories/ChannelRepository.js";
import type { ProviderConnectionRepository } from "../../../../src/application/providers/ProviderConnectionRepository.js";

function makeChannelRepo(overrides: Partial<ChannelRepository> = {}): ChannelRepository {
  return {
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    findByProjectAndProvider: vi.fn(),
    findPrimaryByProjectAndProvider: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    hardDelete: vi.fn(),
    bulkMarkForReauthByProvider: vi.fn().mockResolvedValue({ count: 12, channelIds: ["c1", "c2"] }),
    bulkSoftDeleteByProvider: vi.fn().mockResolvedValue({ count: 5, channelIds: ["c3", "c4"] }),
    ...overrides,
  } as ChannelRepository;
}

function makePcRepo(
  overrides: Partial<ProviderConnectionRepository> = {}
): ProviderConnectionRepository {
  return {
    bulkDisableByProvider: vi.fn().mockResolvedValue({ count: 7, connectionIds: ["pc1", "pc2"] }),
    ...overrides,
  };
}

describe("MassForceReauthByProviderUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty provider with VALIDATION_FAILED", async () => {
    const useCase = new MassForceReauthByProviderUseCase(makeChannelRepo(), makePcRepo());
    const result = await useCase.execute({ provider: " ", reason: "x" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects invalid provider string with VALIDATION_FAILED", async () => {
    const useCase = new MassForceReauthByProviderUseCase(makeChannelRepo(), makePcRepo());
    const result = await useCase.execute({ provider: "NOT_A_PROVIDER", reason: "x" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects empty reason with VALIDATION_FAILED", async () => {
    const useCase = new MassForceReauthByProviderUseCase(makeChannelRepo(), makePcRepo());
    const result = await useCase.execute({ provider: "FACEBOOK", reason: "  " });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("default flags only Channels (flagChannels=true by default)", async () => {
    const channelRepo = makeChannelRepo();
    const pcRepo = makePcRepo();
    const useCase = new MassForceReauthByProviderUseCase(channelRepo, pcRepo);
    const result = await useCase.execute({ provider: "FACEBOOK", reason: "rotation" });
    assert.ok(result.ok);
    assert.equal(result.value.channelsFlagged, 12);
    assert.equal(result.value.providerConnectionsDisabled, 0);
    assert.equal(result.value.channelsSoftDeleted, 0);
    assert.deepEqual(result.value.tiers, {
      flagChannels: true,
      disableProviderConnections: false,
      softDeleteChannels: false,
    });
    assert.equal(
      (channelRepo.bulkMarkForReauthByProvider as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
    assert.equal((pcRepo.bulkDisableByProvider as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    assert.equal(
      (channelRepo.bulkSoftDeleteByProvider as ReturnType<typeof vi.fn>).mock.calls.length,
      0
    );
  });

  it("disableProviderConnections=true triggers ProviderConnection bulk disable", async () => {
    const channelRepo = makeChannelRepo();
    const pcRepo = makePcRepo();
    const useCase = new MassForceReauthByProviderUseCase(channelRepo, pcRepo);
    const result = await useCase.execute({
      provider: "FACEBOOK",
      reason: "rotation",
      disableProviderConnections: true,
    });
    assert.ok(result.ok);
    assert.equal(result.value.providerConnectionsDisabled, 7);
    assert.deepEqual(result.value.providerConnectionIds, ["pc1", "pc2"]);
  });

  it("softDeleteChannels=true triggers bulk soft-delete", async () => {
    const channelRepo = makeChannelRepo();
    const useCase = new MassForceReauthByProviderUseCase(channelRepo, makePcRepo());
    const result = await useCase.execute({
      provider: "FACEBOOK",
      reason: "incident",
      flagChannels: false,
      softDeleteChannels: true,
    });
    assert.ok(result.ok);
    assert.equal(result.value.channelsSoftDeleted, 5);
    assert.deepEqual(result.value.tiers, {
      flagChannels: false,
      disableProviderConnections: false,
      softDeleteChannels: true,
    });
  });

  it("combines all 3 tiers: 3 repo calls, aggregated counts in DTO", async () => {
    const channelRepo = makeChannelRepo();
    const pcRepo = makePcRepo();
    const useCase = new MassForceReauthByProviderUseCase(channelRepo, pcRepo);
    const result = await useCase.execute({
      provider: "FACEBOOK",
      reason: "incident",
      flagChannels: true,
      disableProviderConnections: true,
      softDeleteChannels: true,
    });
    assert.ok(result.ok);
    assert.equal(result.value.channelsFlagged, 12);
    assert.equal(result.value.providerConnectionsDisabled, 7);
    assert.equal(result.value.channelsSoftDeleted, 5);
    assert.equal(
      (channelRepo.bulkMarkForReauthByProvider as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
    assert.equal((pcRepo.bulkDisableByProvider as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.equal(
      (channelRepo.bulkSoftDeleteByProvider as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
  });

  it("all-flags-false → returns zero counts without touching repos", async () => {
    const channelRepo = makeChannelRepo();
    const pcRepo = makePcRepo();
    const useCase = new MassForceReauthByProviderUseCase(channelRepo, pcRepo);
    const result = await useCase.execute({
      provider: "FACEBOOK",
      reason: "x",
      flagChannels: false,
      disableProviderConnections: false,
      softDeleteChannels: false,
    });
    assert.ok(result.ok);
    assert.equal(result.value.channelsFlagged, 0);
    assert.equal(result.value.providerConnectionsDisabled, 0);
    assert.equal(result.value.channelsSoftDeleted, 0);
    assert.equal(
      (channelRepo.bulkMarkForReauthByProvider as ReturnType<typeof vi.fn>).mock.calls.length,
      0
    );
  });

  it("returns INTERNAL_ERROR when ChannelRepository throws", async () => {
    const channelRepo = makeChannelRepo({
      bulkMarkForReauthByProvider: vi.fn().mockRejectedValue(new Error("DB exploded")),
    });
    const useCase = new MassForceReauthByProviderUseCase(channelRepo, makePcRepo());
    const result = await useCase.execute({ provider: "FACEBOOK", reason: "x" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("runs inside UoW.executeInTransaction when UoW is provided", async () => {
    const uowExecute = vi.fn(async (cb: () => Promise<void>) => {
      await cb();
    });
    const useCase = new MassForceReauthByProviderUseCase(makeChannelRepo(), makePcRepo(), {
      executeInTransaction: uowExecute,
    });
    const result = await useCase.execute({ provider: "FACEBOOK", reason: "x" });
    assert.ok(result.ok);
    assert.equal(uowExecute.mock.calls.length, 1);
  });
});
