/**
 * @file TrackReferralSignupUseCase.ts
 * @description Tracks a referral signup when a new user registers with a referral code.
 *              Silently ignores invalid codes — never throws to the user.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface TrackReferralInput {
  referralCode: string;
  referredEmail: string;
  referredAccountId?: string;
}

export interface ReferralRepository {
  findCodeByCode(code: string): Promise<{ id: string } | null>;
  createReferral(params: {
    referralCodeId: string;
    referredEmail: string;
    referredAccountId?: string;
  }): Promise<void>;
  incrementUsageCount(codeId: string): Promise<void>;
}

export class TrackReferralSignupUseCase implements UseCase<TrackReferralInput, void, UseCaseError> {
  constructor(
    private readonly repo: ReferralRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: TrackReferralInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const codeRecord = await this.repo.findCodeByCode(input.referralCode);
      if (!codeRecord) {
        return ok(undefined);
      }

      await this.repo.createReferral({
        referralCodeId: codeRecord.id,
        referredEmail: input.referredEmail,
        ...(input.referredAccountId !== undefined && {
          referredAccountId: input.referredAccountId,
        }),
      });

      await this.repo.incrementUsageCount(codeRecord.id);

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to track referral signup",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
