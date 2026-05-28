/**
 * @file referralUseCases.test.ts
 * @description Unit tests for referral program use cases.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { GetOrCreateReferralCodeUseCase } from "@core/referral/GetOrCreateReferralCodeUseCase.js";
import { TrackReferralSignupUseCase } from "@core/referral/TrackReferralSignupUseCase.js";

function makeMockCodeRepo(
  existing: { code: string; usageCount: number; conversions: number } | null = null
) {
  return {
    findByAccountId: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockReferralRepo(codeExists = true) {
  return {
    findCodeByCode: vi.fn().mockResolvedValue(codeExists ? { id: "code-001" } : null),
    createReferral: vi.fn().mockResolvedValue(undefined),
    incrementUsageCount: vi.fn().mockResolvedValue(undefined),
  };
}

describe("GetOrCreateReferralCodeUseCase", () => {
  it("creates unique code for new account", async () => {
    const repo = makeMockCodeRepo(null);
    const useCase = new GetOrCreateReferralCodeUseCase(repo, "https://app.test");

    const result = await useCase.execute({ accountId: "acc-1", accountName: "Acme Corp" });

    assert.ok(result.ok);
    assert.ok(result.value.code.length > 0);
    assert.ok(result.value.shareUrl.includes(result.value.code));
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it("returns same code on subsequent calls (idempotent)", async () => {
    const repo = makeMockCodeRepo({ code: "ACME2026-A1B2C3", usageCount: 5, conversions: 2 });
    const useCase = new GetOrCreateReferralCodeUseCase(repo, "https://app.test");

    const result = await useCase.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.code, "ACME2026-A1B2C3");
    assert.strictEqual(result.value.usageCount, 5);
    assert.strictEqual(result.value.conversions, 2);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("code follows expected format", async () => {
    const repo = makeMockCodeRepo(null);
    const useCase = new GetOrCreateReferralCodeUseCase(repo, "https://app.test");

    const result = await useCase.execute({ accountId: "acc-1", accountName: "Test Company" });

    assert.ok(result.ok);
    assert.ok(/^[A-Z0-9]+-[A-F0-9]+$/i.test(result.value.code));
  });
});

describe("TrackReferralSignupUseCase", () => {
  it("creates PENDING referral on valid code", async () => {
    const repo = makeMockReferralRepo(true);
    const useCase = new TrackReferralSignupUseCase(repo);

    const result = await useCase.execute({
      referralCode: "ACME2026-ABC",
      referredEmail: "new@user.com",
    });

    assert.ok(result.ok);
    expect(repo.createReferral).toHaveBeenCalledOnce();
    expect(repo.incrementUsageCount).toHaveBeenCalledOnce();
  });

  it("increments usageCount", async () => {
    const repo = makeMockReferralRepo(true);
    const useCase = new TrackReferralSignupUseCase(repo);

    await useCase.execute({ referralCode: "CODE", referredEmail: "a@b.com" });

    expect(repo.incrementUsageCount).toHaveBeenCalledWith("code-001");
  });

  it("ignores invalid codes without throwing", async () => {
    const repo = makeMockReferralRepo(false);
    const useCase = new TrackReferralSignupUseCase(repo);

    const result = await useCase.execute({
      referralCode: "INVALID",
      referredEmail: "new@user.com",
    });

    assert.ok(result.ok);
    expect(repo.createReferral).not.toHaveBeenCalled();
    expect(repo.incrementUsageCount).not.toHaveBeenCalled();
  });
});
