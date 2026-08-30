/**
 * @file GrantReferralRewardUseCase.ts
 * @description Extends referrer's subscription by 30 days as reward.
 *              Idempotent — does not double-reward.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ReferralRewardMailer } from "@core/domain/repositories/ReferralRewardMailer.js";

export interface GrantReferralRewardInput {
  referralId: string;
}

export interface GrantReferralRewardOutput {
  rewardedAccountId: string;
  newExpiry: Date;
}

export interface ReferralRewardEmailContext {
  referrerEmail: string;
  referrerName: string;
  referredCompanyName: string;
  totalConversions: number;
}

export interface GrantRewardRepository {
  findReferralById(referralId: string): Promise<{
    id: string;
    /**
     * `null` once the referral code has been hard-deleted: the FK is
     * `ON DELETE SET NULL` so the referral survives as history after the
     * referrer's account is erased. A referral with no code has no referrer
     * left to reward.
     */
    referralCodeId: string | null;
    rewardGranted: boolean;
    status: string;
  } | null>;
  findReferrerAccountId(referralCodeId: string): Promise<string | null>;
  findSubscription(accountId: string): Promise<{
    id: string;
    status: string;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
  } | null>;
  extendSubscription(subscriptionId: string, newEnd: Date): Promise<void>;
  extendTrial(subscriptionId: string, newTrialEnd: Date): Promise<void>;
  setRewardGranted(referralId: string): Promise<void>;
  findReferralRewardEmailContext(referralId: string): Promise<ReferralRewardEmailContext | null>;
}

const REWARD_DAYS = 30;
const DEFAULT_BILLING_BASE_URL = "https://app.omnipost.io";

export class GrantReferralRewardUseCase implements UseCase<
  GrantReferralRewardInput,
  GrantReferralRewardOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: GrantRewardRepository,
    private readonly mailer?: ReferralRewardMailer,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: GrantReferralRewardInput
  ): Promise<Result<GrantReferralRewardOutput, UseCaseError>> {
    let alreadyRewarded = false;

    const doWork = async (): Promise<Result<GrantReferralRewardOutput, UseCaseError>> => {
      const referral = await this.repo.findReferralById(input.referralId);
      if (!referral) {
        return err(new UseCaseError("Referral not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      if (referral.rewardGranted) {
        alreadyRewarded = true;
        const accountId =
          referral.referralCodeId === null
            ? null
            : await this.repo.findReferrerAccountId(referral.referralCodeId);
        return ok({ rewardedAccountId: accountId ?? "", newExpiry: new Date() });
      }

      // An erased code leaves no id to resolve a referrer with, so the reward
      // is refused instead of being granted to nobody. Same outcome as a code
      // whose account is gone, reported before the pointless lookup.
      if (referral.referralCodeId === null) {
        return err(
          new UseCaseError(
            "Referrer account not found: the referral code no longer exists",
            USE_CASE_ERRORS.NOT_FOUND
          )
        );
      }

      const referrerAccountId = await this.repo.findReferrerAccountId(referral.referralCodeId);
      if (!referrerAccountId) {
        return err(new UseCaseError("Referrer account not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      const subscription = await this.repo.findSubscription(referrerAccountId);
      let newExpiry = new Date(Date.now() + REWARD_DAYS * 24 * 60 * 60 * 1000);

      if (subscription) {
        if (subscription.status === "TRIALING" && subscription.trialEndsAt) {
          newExpiry = new Date(
            subscription.trialEndsAt.getTime() + REWARD_DAYS * 24 * 60 * 60 * 1000
          );
          await this.repo.extendTrial(subscription.id, newExpiry);
        } else if (subscription.currentPeriodEnd) {
          newExpiry = new Date(
            subscription.currentPeriodEnd.getTime() + REWARD_DAYS * 24 * 60 * 60 * 1000
          );
          await this.repo.extendSubscription(subscription.id, newExpiry);
        }
      }

      await this.repo.setRewardGranted(input.referralId);

      return ok({ rewardedAccountId: referrerAccountId, newExpiry });
    };

    let result: Result<GrantReferralRewardOutput, UseCaseError>;
    try {
      if (this.unitOfWork) {
        let inner: Result<GrantReferralRewardOutput, UseCaseError> = ok({
          rewardedAccountId: "",
          newExpiry: new Date(),
        });
        await this.unitOfWork.executeInTransaction(async () => {
          inner = await doWork();
        });
        result = inner;
      } else {
        result = await doWork();
      }
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to grant referral reward",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }

    if (result.ok && !alreadyRewarded && this.mailer) {
      void this.sendRewardEmail(input.referralId, result.value).catch(() => {
        // Email failures must never roll back the granted reward — the
        // transaction has already committed. Swallow + rely on logger
        // hooks in the EmailPort adapter for observability.
      });
    }

    return result;
  }

  private async sendRewardEmail(
    referralId: string,
    output: GrantReferralRewardOutput
  ): Promise<void> {
    if (!this.mailer) return;

    const ctx = await this.repo.findReferralRewardEmailContext(referralId);
    if (!ctx) return;

    const billingUrl = `${DEFAULT_BILLING_BASE_URL}/dashboard/settings/billing`;
    const newExpiryDate = output.newExpiry.toISOString().split("T")[0] ?? "";

    await this.mailer.sendReferralReward(ctx.referrerEmail, {
      referrerName: ctx.referrerName,
      referredCompanyName: ctx.referredCompanyName,
      rewardDays: REWARD_DAYS,
      newExpiryDate,
      totalConversions: ctx.totalConversions,
      billingUrl,
      accountName: ctx.referrerName,
    });
  }
}
