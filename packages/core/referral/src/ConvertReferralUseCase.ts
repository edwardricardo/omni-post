/**
 * @file ConvertReferralUseCase.ts
 * @description Converts a PENDING referral to CONVERTED when the referred
 *              account makes their first payment. Triggers reward grant.
 *              Idempotent — second call is a no-op.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface ConvertReferralInput {
  accountId: string;
}

export interface ConvertReferralOutput {
  converted: boolean;
  referralId?: string;
}

export interface ConvertReferralRepository {
  findPendingByAccountId(accountId: string): Promise<{
    id: string;
    referralCodeId: string;
    status: string;
  } | null>;
  setConverted(referralId: string, convertedAt: Date): Promise<void>;
  incrementConversions(referralCodeId: string): Promise<void>;
}

export class ConvertReferralUseCase implements UseCase<
  ConvertReferralInput,
  ConvertReferralOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: ConvertReferralRepository,
    private readonly grantReward?: {
      execute: (input: { referralId: string }) => Promise<Result<unknown, unknown>>;
    },
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: ConvertReferralInput): Promise<Result<ConvertReferralOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<ConvertReferralOutput, UseCaseError>> => {
      const referral = await this.repo.findPendingByAccountId(input.accountId);

      if (!referral || referral.status !== "PENDING") {
        return ok({ converted: false });
      }

      await this.repo.setConverted(referral.id, new Date());
      await this.repo.incrementConversions(referral.referralCodeId);

      if (this.grantReward) {
        await this.grantReward.execute({ referralId: referral.id });
      }

      return ok({ converted: true, referralId: referral.id });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ConvertReferralOutput, UseCaseError> = ok({ converted: false });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to convert referral",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
