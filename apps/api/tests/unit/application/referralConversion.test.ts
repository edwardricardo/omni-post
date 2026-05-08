/**
 * @file referralConversion.test.ts
 * @description Unit tests for ConvertReferralUseCase and GrantReferralRewardUseCase.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ConvertReferralUseCase } from "../../../src/application/referral/ConvertReferralUseCase.js";
import { GrantReferralRewardUseCase } from "../../../src/application/referral/GrantReferralRewardUseCase.js";
import { ok } from "@shared/types";

function makeMockConvertRepo(
  pending: { id: string; referralCodeId: string; status: string } | null = {
    id: "ref-1",
    referralCodeId: "code-1",
    status: "PENDING",
  }
) {
  return {
    findPendingByAccountId: vi.fn().mockResolvedValue(pending),
    setConverted: vi.fn().mockResolvedValue(undefined),
    incrementConversions: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockGrantReward() {
  return {
    execute: vi
      .fn()
      .mockResolvedValue(ok({ rewardedAccountId: "acc-referrer", newExpiry: new Date() })),
  };
}

describe("ConvertReferralUseCase", () => {
  let repo: ReturnType<typeof makeMockConvertRepo>;
  let grantReward: ReturnType<typeof makeMockGrantReward>;
  let useCase: ConvertReferralUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockConvertRepo();
    grantReward = makeMockGrantReward();
    useCase = new ConvertReferralUseCase(repo, grantReward);
  });

  it("converts PENDING referral to CONVERTED", async () => {
    const result = await useCase.execute({ accountId: "acc-new" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.converted, true);
    expect(repo.setConverted).toHaveBeenCalledWith("ref-1", expect.any(Date));
  });

  it("increments ReferralCode.conversions", async () => {
    await useCase.execute({ accountId: "acc-new" });

    expect(repo.incrementConversions).toHaveBeenCalledWith("code-1");
  });

  it("triggers GrantReferralRewardUseCase", async () => {
    await useCase.execute({ accountId: "acc-new" });

    expect(grantReward.execute).toHaveBeenCalledWith({ referralId: "ref-1" });
  });

  it("returns converted: false when no PENDING referral exists", async () => {
    repo = makeMockConvertRepo(null);
    useCase = new ConvertReferralUseCase(repo, grantReward);

    const result = await useCase.execute({ accountId: "unknown" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.converted, false);
    expect(repo.setConverted).not.toHaveBeenCalled();
  });

  it("returns converted: false when referral already CONVERTED", async () => {
    repo = makeMockConvertRepo({ id: "ref-1", referralCodeId: "code-1", status: "CONVERTED" });
    useCase = new ConvertReferralUseCase(repo, grantReward);

    const result = await useCase.execute({ accountId: "acc-old" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.converted, false);
  });
});

describe("GrantReferralRewardUseCase", () => {
  const now = Date.now();
  const futureDate = new Date(now + 15 * 24 * 60 * 60 * 1000);

  function makeMockGrantRepo(overrides: Record<string, unknown> = {}) {
    return {
      findReferralById: vi.fn().mockResolvedValue({
        id: "ref-1",
        referralCodeId: "code-1",
        rewardGranted: false,
        status: "CONVERTED",
        ...overrides,
      }),
      findReferrerAccountId: vi.fn().mockResolvedValue("acc-referrer"),
      findSubscription: vi.fn().mockResolvedValue({
        id: "sub-1",
        status: "ACTIVE",
        currentPeriodEnd: futureDate,
        trialEndsAt: null,
      }),
      extendSubscription: vi.fn().mockResolvedValue(undefined),
      extendTrial: vi.fn().mockResolvedValue(undefined),
      setRewardGranted: vi.fn().mockResolvedValue(undefined),
      findReferralRewardEmailContext: vi.fn().mockResolvedValue({
        referrerEmail: "referrer@example.com",
        referrerName: "Acme Inc.",
        referredCompanyName: "Globex Corp.",
        totalConversions: 3,
      }),
    };
  }

  it("extends ACTIVE subscription by 30 days", async () => {
    const grantRepo = makeMockGrantRepo();
    const useCase = new GrantReferralRewardUseCase(grantRepo);

    const result = await useCase.execute({ referralId: "ref-1" });

    assert.ok(result.ok);
    expect(grantRepo.extendSubscription).toHaveBeenCalledOnce();
    const newEnd = grantRepo.extendSubscription.mock.calls[0]?.[1] as Date;
    const expectedEnd = futureDate.getTime() + 30 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(newEnd.getTime() - expectedEnd) < 1000);
  });

  it("extends TRIALING subscription by extending trialEndsAt", async () => {
    const trialEnd = new Date(now + 5 * 24 * 60 * 60 * 1000);
    const grantRepo = makeMockGrantRepo();
    grantRepo.findSubscription.mockResolvedValue({
      id: "sub-1",
      status: "TRIALING",
      currentPeriodEnd: null,
      trialEndsAt: trialEnd,
    });
    const useCase = new GrantReferralRewardUseCase(grantRepo);

    const result = await useCase.execute({ referralId: "ref-1" });

    assert.ok(result.ok);
    expect(grantRepo.extendTrial).toHaveBeenCalledOnce();
  });

  it("sets referral.rewardGranted = true", async () => {
    const grantRepo = makeMockGrantRepo();
    const useCase = new GrantReferralRewardUseCase(grantRepo);

    await useCase.execute({ referralId: "ref-1" });

    expect(grantRepo.setRewardGranted).toHaveBeenCalledWith("ref-1");
  });

  it("does not reward twice if rewardGranted is already true", async () => {
    const grantRepo = makeMockGrantRepo({ rewardGranted: true });
    const useCase = new GrantReferralRewardUseCase(grantRepo);

    const result = await useCase.execute({ referralId: "ref-1" });

    assert.ok(result.ok);
    expect(grantRepo.extendSubscription).not.toHaveBeenCalled();
    expect(grantRepo.setRewardGranted).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when referral does not exist", async () => {
    const grantRepo = makeMockGrantRepo();
    grantRepo.findReferralById.mockResolvedValue(null);
    const useCase = new GrantReferralRewardUseCase(grantRepo);

    const result = await useCase.execute({ referralId: "nope" });

    assert.ok(!result.ok);
  });

  describe("email notification", () => {
    function makeMockEmailPort() {
      return {
        send: vi.fn().mockResolvedValue(ok(undefined)),
      };
    }

    it("sends referral reward email when emailPort is provided and reward is newly granted", async () => {
      const grantRepo = makeMockGrantRepo();
      const emailPort = makeMockEmailPort();
      const useCase = new GrantReferralRewardUseCase(grantRepo, emailPort);

      await useCase.execute({ referralId: "ref-1" });
      // Email send is fire-and-forget — yield once to let the microtask resolve.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(emailPort.send).toHaveBeenCalledOnce();
      const call = emailPort.send.mock.calls[0]?.[0];
      assert.deepStrictEqual(call?.to, ["referrer@example.com"]);
      assert.match(call?.subject ?? "", /Globex Corp\./);
      assert.match(call?.subject ?? "", /30 free days/);
      assert.ok(call?.html?.includes("Acme Inc."));
    });

    it("does not send email when reward was already granted previously", async () => {
      const grantRepo = makeMockGrantRepo({ rewardGranted: true });
      const emailPort = makeMockEmailPort();
      const useCase = new GrantReferralRewardUseCase(grantRepo, emailPort);

      await useCase.execute({ referralId: "ref-1" });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(emailPort.send).not.toHaveBeenCalled();
    });

    it("does not crash when emailPort is omitted", async () => {
      const grantRepo = makeMockGrantRepo();
      const useCase = new GrantReferralRewardUseCase(grantRepo);

      const result = await useCase.execute({ referralId: "ref-1" });

      assert.ok(result.ok);
      expect(grantRepo.findReferralRewardEmailContext).not.toHaveBeenCalled();
    });

    it("does not crash when email context lookup returns null", async () => {
      const grantRepo = makeMockGrantRepo();
      grantRepo.findReferralRewardEmailContext.mockResolvedValue(null);
      const emailPort = makeMockEmailPort();
      const useCase = new GrantReferralRewardUseCase(grantRepo, emailPort);

      const result = await useCase.execute({ referralId: "ref-1" });
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.ok(result.ok);
      expect(emailPort.send).not.toHaveBeenCalled();
    });
  });
});
