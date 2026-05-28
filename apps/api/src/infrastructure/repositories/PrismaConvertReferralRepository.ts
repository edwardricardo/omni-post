/**
 * @file PrismaConvertReferralRepository.ts
 * @description Prisma adapter for ConvertReferralRepository port.
 *              Finds pending referrals by account and marks them converted.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ConvertReferralRepository } from "@core/referral/ConvertReferralUseCase.js";

export class PrismaConvertReferralRepository implements ConvertReferralRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findPendingByAccountId
   * @description Finds a pending referral for the given referred account.
   */
  async findPendingByAccountId(
    accountId: string
  ): Promise<{ id: string; referralCodeId: string; status: string } | null> {
    const referral = await this.prisma.referral.findFirst({
      where: {
        referredAccountId: accountId,
        status: "PENDING",
      },
      select: {
        id: true,
        referralCodeId: true,
        status: true,
      },
    });
    return referral;
  }

  /**
   * @method setConverted
   * @description Marks a referral as CONVERTED with a timestamp.
   */
  async setConverted(referralId: string, convertedAt: Date): Promise<void> {
    await this.prisma.referral.update({
      where: { id: referralId },
      data: {
        status: "CONVERTED",
        convertedAt,
      },
    });
  }

  /**
   * @method incrementConversions
   * @description Increments the conversions counter on the referral code.
   */
  async incrementConversions(referralCodeId: string): Promise<void> {
    await this.prisma.referralCode.update({
      where: { id: referralCodeId },
      data: {
        conversions: { increment: 1 },
      },
    });
  }
}
