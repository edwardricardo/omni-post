/**
 * @file PrismaGrantRewardRepository.ts
 * @description Prisma adapter for GrantRewardRepository port.
 *              Handles referral reward granting: finding referrals, referrer accounts,
 *              subscriptions, and extending trial/subscription periods.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  GrantRewardRepository,
  ReferralRewardEmailContext,
} from "../../application/referral/GrantReferralRewardUseCase.js";

export class PrismaGrantRewardRepository implements GrantRewardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findReferralById
   * @description Finds a referral by its ID with reward status.
   */
  async findReferralById(referralId: string): Promise<{
    id: string;
    referralCodeId: string;
    rewardGranted: boolean;
    status: string;
  } | null> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: {
        id: true,
        referralCodeId: true,
        rewardGranted: true,
        status: true,
      },
    });
    return referral;
  }

  /**
   * @method findReferrerAccountId
   * @description Resolves the account that owns a referral code.
   */
  async findReferrerAccountId(referralCodeId: string): Promise<string | null> {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: referralCodeId },
      select: { accountId: true },
    });
    return code?.accountId ?? null;
  }

  /**
   * @method findSubscription
   * @description Finds the active subscription for an account.
   */
  async findSubscription(accountId: string): Promise<{
    id: string;
    status: string;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
  } | null> {
    const subscription = await this.prisma.accountSubscription.findUnique({
      where: { accountId },
      select: {
        id: true,
        status: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
      },
    });
    return subscription;
  }

  /**
   * @method extendSubscription
   * @description Extends the current period end date of a subscription.
   */
  async extendSubscription(subscriptionId: string, newEnd: Date): Promise<void> {
    await this.prisma.accountSubscription.update({
      where: { id: subscriptionId },
      data: { currentPeriodEnd: newEnd },
    });
  }

  /**
   * @method extendTrial
   * @description Extends the trial end date of a subscription.
   */
  async extendTrial(subscriptionId: string, newTrialEnd: Date): Promise<void> {
    await this.prisma.accountSubscription.update({
      where: { id: subscriptionId },
      data: { trialEndsAt: newTrialEnd },
    });
  }

  /**
   * @method setRewardGranted
   * @description Marks the referral reward as granted.
   */
  async setRewardGranted(referralId: string): Promise<void> {
    await this.prisma.referral.update({
      where: { id: referralId },
      data: { rewardGranted: true },
    });
  }

  /**
   * @method findReferralRewardEmailContext
   * @description Resolves the data needed to render the referral-reward email
   *   (referrer email/name, referred company name, total conversions for the code).
   *   Returns null when the referral or its referrer account cannot be located.
   */
  async findReferralRewardEmailContext(
    referralId: string
  ): Promise<ReferralRewardEmailContext | null> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: {
        referredAccount: { select: { name: true } },
        referralCode: {
          select: {
            conversions: true,
            account: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!referral || !referral.referralCode.account) {
      return null;
    }

    return {
      referrerEmail: referral.referralCode.account.email,
      referrerName: referral.referralCode.account.name,
      referredCompanyName: referral.referredAccount?.name ?? "a new customer",
      totalConversions: referral.referralCode.conversions,
    };
  }
}
