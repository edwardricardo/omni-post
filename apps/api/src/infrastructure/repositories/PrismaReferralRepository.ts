/**
 * @file PrismaReferralRepository.ts
 * @description Prisma adapter for ReferralRepository port.
 *              Handles referral tracking: code lookup, referral creation,
 *              and usage count increments.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ReferralRepository } from "@core/application/referral/TrackReferralSignupUseCase.js";

export class PrismaReferralRepository implements ReferralRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findCodeByCode
   * @description Finds a referral code record by its code string.
   */
  async findCodeByCode(code: string): Promise<{ id: string } | null> {
    const record = await this.prisma.referralCode.findUnique({
      where: { code },
      select: { id: true },
    });
    return record;
  }

  /**
   * @method createReferral
   * @description Creates a new referral entry in PENDING status.
   */
  async createReferral(params: {
    referralCodeId: string;
    referredEmail: string;
    referredAccountId?: string;
  }): Promise<void> {
    await this.prisma.referral.create({
      data: {
        referralCodeId: params.referralCodeId,
        referredEmail: params.referredEmail,
        ...(params.referredAccountId !== undefined && {
          referredAccountId: params.referredAccountId,
        }),
        status: "PENDING",
      },
    });
  }

  /**
   * @method incrementUsageCount
   * @description Increments the usage counter on a referral code.
   */
  async incrementUsageCount(codeId: string): Promise<void> {
    await this.prisma.referralCode.update({
      where: { id: codeId },
      data: {
        usageCount: { increment: 1 },
      },
    });
  }
}
