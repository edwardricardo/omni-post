/**
 * @file GetOrCreateReferralCodeUseCase.ts
 * @description Returns existing referral code for account or creates a new one.
 *              Idempotent — calling multiple times returns the same code.
 * @layer application
 */

import { randomBytes } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export interface ReferralCodeInput {
  accountId: string;
  accountName?: string;
}

export interface ReferralCodeOutput {
  code: string;
  shareUrl: string;
  usageCount: number;
  conversions: number;
}

export interface ReferralCodeRepository {
  findByAccountId(accountId: string): Promise<{
    code: string;
    usageCount: number;
    conversions: number;
  } | null>;
  create(params: { accountId: string; code: string }): Promise<void>;
}

export class GetOrCreateReferralCodeUseCase implements UseCase<
  ReferralCodeInput,
  ReferralCodeOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: ReferralCodeRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: ReferralCodeInput): Promise<Result<ReferralCodeOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<ReferralCodeOutput, UseCaseError>> => {
      const existing = await this.repo.findByAccountId(input.accountId);
      if (existing) {
        const clientUrl = process.env.CLIENT_URL ?? "http://localhost:3002";
        return ok({
          code: existing.code,
          shareUrl: `${clientUrl}/register?ref=${existing.code}`,
          usageCount: existing.usageCount,
          conversions: existing.conversions,
        });
      }

      const prefix = (input.accountName ?? "REF")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8)
        .toUpperCase();
      const suffix = randomBytes(3).toString("hex").toUpperCase();
      const year = new Date().getFullYear();
      const code = `${prefix}${year}-${suffix}`;

      await this.repo.create({ accountId: input.accountId, code });

      const clientUrl = process.env.CLIENT_URL ?? "http://localhost:3002";
      return ok({
        code,
        shareUrl: `${clientUrl}/register?ref=${code}`,
        usageCount: 0,
        conversions: 0,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ReferralCodeOutput, UseCaseError> = ok({
          code: "",
          shareUrl: "",
          usageCount: 0,
          conversions: 0,
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
          "Failed to get or create referral code",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
