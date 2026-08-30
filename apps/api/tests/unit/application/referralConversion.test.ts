/**
 * @file referralConversion.test.ts
 * @description Unit tests for ConvertReferralUseCase and GrantReferralRewardUseCase.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ConvertReferralUseCase } from "@core/referral/ConvertReferralUseCase.js";
import { GrantReferralRewardUseCase } from "@core/referral/GrantReferralRewardUseCase.js";
import { ok } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

function makeMockConvertRepo(
  pending: { id: string; referralCodeId: string | null; status: string } | null = {
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

  it("still converts when the referral code was erased, without touching its counter", async () => {
    // `Referral.referralCodeId` is nullable + SET NULL: hard-deleting the
    // referrer's account destroys the code but the referral survives as
    // history. The conversion is a fact about the referred account, so it
    // still happens; the counter it would have incremented no longer exists.
    repo = makeMockConvertRepo({ id: "ref-1", referralCodeId: null, status: "PENDING" });
    useCase = new ConvertReferralUseCase(repo, grantReward);

    const result = await useCase.execute({ accountId: "acc-new" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.converted, true);
    expect(repo.setConverted).toHaveBeenCalledWith("ref-1", expect.any(Date));
    expect(repo.incrementConversions).not.toHaveBeenCalled();
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

  it("returns NOT_FOUND without a lookup when the referral code was erased", async () => {
    // `Referral.referralCodeId` is nullable + SET NULL: the code (and with it
    // the referrer it pointed at) can be hard-deleted while the referral row
    // survives. There is no referrer left to reward, and no id to look one up
    // with, so the reward is refused rather than granted to nobody.
    const grantRepo = makeMockGrantRepo({ referralCodeId: null });
    const useCase = new GrantReferralRewardUseCase(grantRepo);

    const result = await useCase.execute({ referralId: "ref-1" });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    expect(grantRepo.findReferrerAccountId).not.toHaveBeenCalled();
    expect(grantRepo.setRewardGranted).not.toHaveBeenCalled();
  });

  describe("email notification", () => {
    function makeMockMailer() {
      return {
        sendReferralReward: vi.fn().mockResolvedValue(ok(undefined)),
      };
    }

    it("sends referral reward email when a mailer is provided and reward is newly granted", async () => {
      const grantRepo = makeMockGrantRepo();
      const mailer = makeMockMailer();
      const useCase = new GrantReferralRewardUseCase(grantRepo, mailer);

      await useCase.execute({ referralId: "ref-1" });
      // Email send is fire-and-forget — yield once to let the microtask resolve.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mailer.sendReferralReward).toHaveBeenCalledOnce();
      const [to, data] = mailer.sendReferralReward.mock.calls[0] ?? [];
      assert.strictEqual(to, "referrer@example.com");
      assert.strictEqual(data?.referredCompanyName, "Globex Corp.");
      assert.strictEqual(data?.rewardDays, 30);
      assert.strictEqual(data?.accountName, "Acme Inc.");
    });

    it("does not send email when reward was already granted previously", async () => {
      const grantRepo = makeMockGrantRepo({ rewardGranted: true });
      const mailer = makeMockMailer();
      const useCase = new GrantReferralRewardUseCase(grantRepo, mailer);

      await useCase.execute({ referralId: "ref-1" });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mailer.sendReferralReward).not.toHaveBeenCalled();
    });

    it("does not crash when the mailer is omitted", async () => {
      const grantRepo = makeMockGrantRepo();
      const useCase = new GrantReferralRewardUseCase(grantRepo);

      const result = await useCase.execute({ referralId: "ref-1" });

      assert.ok(result.ok);
      expect(grantRepo.findReferralRewardEmailContext).not.toHaveBeenCalled();
    });

    it("does not crash when email context lookup returns null", async () => {
      const grantRepo = makeMockGrantRepo();
      grantRepo.findReferralRewardEmailContext.mockResolvedValue(null);
      const mailer = makeMockMailer();
      const useCase = new GrantReferralRewardUseCase(grantRepo, mailer);

      const result = await useCase.execute({ referralId: "ref-1" });
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.ok(result.ok);
      expect(mailer.sendReferralReward).not.toHaveBeenCalled();
    });
  });
});
