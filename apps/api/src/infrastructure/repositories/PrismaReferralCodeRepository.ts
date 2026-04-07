/**
 * @file PrismaReferralCodeRepository.ts
 * @description Prisma adapter for ReferralCodeRepository port.
 *              Handles referral code lookup by account and creation.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ReferralCodeRepository } from "../../application/referral/GetOrCreateReferralCodeUseCase.js";

export class PrismaReferralCodeRepository implements ReferralCodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findByAccountId
   * @description Finds the referral code for the given account.
   */
  async findByAccountId(
    accountId: string
  ): Promise<{ code: string; usageCount: number; conversions: number } | null> {
    const record = await this.prisma.referralCode.findUnique({
      where: { accountId },
      select: {
        code: true,
        usageCount: true,
        conversions: true,
      },
    });
    return record;
  }

  /**
   * @method create
   * @description Creates a new referral code for an account.
   */
  async create(params: { accountId: string; code: string }): Promise<void> {
    await this.prisma.referralCode.create({
      data: {
        accountId: params.accountId,
        code: params.code,
      },
    });
  }
}
