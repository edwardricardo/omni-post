/**
 * @file GrantReferralRewardUseCase.ts
 * @description Extends referrer's subscription by 30 days as reward.
 *              Idempotent — does not double-reward.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";

export interface GrantReferralRewardInput {
  referralId: string;
}

export interface GrantReferralRewardOutput {
  rewardedAccountId: string;
  newExpiry: Date;
}

export interface GrantRewardRepository {
  findReferralById(referralId: string): Promise<{
    id: string;
    referralCodeId: string;
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
}

const REWARD_DAYS = 30;

export class GrantReferralRewardUseCase implements UseCase<
  GrantReferralRewardInput,
  GrantReferralRewardOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: GrantRewardRepository,
    private readonly emailPort?: EmailPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: GrantReferralRewardInput
  ): Promise<Result<GrantReferralRewardOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<GrantReferralRewardOutput, UseCaseError>> => {
      const referral = await this.repo.findReferralById(input.referralId);
      if (!referral) {
        return err(new UseCaseError("Referral not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      if (referral.rewardGranted) {
        const accountId = await this.repo.findReferrerAccountId(referral.referralCodeId);
        return ok({ rewardedAccountId: accountId ?? "", newExpiry: new Date() });
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

    try {
      if (this.unitOfWork) {
        let result: Result<GrantReferralRewardOutput, UseCaseError> = ok({
          rewardedAccountId: "",
          newExpiry: new Date(),
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to grant referral reward",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
