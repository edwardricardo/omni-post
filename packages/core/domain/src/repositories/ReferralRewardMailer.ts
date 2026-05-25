/**
 * @file ReferralRewardMailer.ts
 * @description Role port for sending the referral-reward email. The use case
 *              provides business data; the infrastructure adapter renders the
 *              template and sends it. Keeps presentation/transport out of the
 *              application layer.
 * @layer domain
 */

import type { Result } from "@shared/types";

/** Business data for the referral-reward email. */
export interface ReferralRewardEmailData {
  referrerName: string;
  referredCompanyName: string;
  rewardDays: number;
  newExpiryDate: string;
  totalConversions: number;
  billingUrl: string;
  accountName: string;
}

/** Sends the referral-reward email to a referrer. */
export interface ReferralRewardMailer {
  sendReferralReward(to: string, data: ReferralRewardEmailData): Promise<Result<void, Error>>;
}
