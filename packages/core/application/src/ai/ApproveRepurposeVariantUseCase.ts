/**
 * @file ApproveRepurposeVariantUseCase.ts
 * @description Approves a repurpose variant and creates a Draft post from it.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface ApproveVariantInput {
  variantId: string;
  accountId: string;
  scheduleAt?: Date;
}

export interface ApproveVariantOutput {
  postId: string;
}

export interface ApproveVariantPort {
  loadVariant(variantId: string): Promise<{
    id: string;
    proposalId: string;
    platform: string;
    content: string;
    hashtags: string[];
    status: string;
    proposal: { accountId: string; sourcePostId: string };
  } | null>;
  setVariantApproved(variantId: string, postId: string): Promise<void>;
  createDraftPost(params: {
    accountId: string;
    platform: string;
    content: string;
    scheduleAt?: Date;
  }): Promise<string>;
}

export class ApproveRepurposeVariantUseCase implements UseCase<
  ApproveVariantInput,
  ApproveVariantOutput,
  UseCaseError
> {
  constructor(
    private readonly port: ApproveVariantPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: ApproveVariantInput): Promise<Result<ApproveVariantOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<ApproveVariantOutput, UseCaseError>> => {
      const variant = await this.port.loadVariant(input.variantId);
      if (!variant) {
        return err(new UseCaseError("Variant not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      if (variant.proposal.accountId !== input.accountId) {
        return err(new UseCaseError("Access denied", USE_CASE_ERRORS.FORBIDDEN));
      }

      if (variant.status !== "PENDING") {
        return err(
          new UseCaseError("Variant already processed", USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }

      const postId = await this.port.createDraftPost({
        accountId: input.accountId,
        platform: variant.platform,
        content: variant.content,
        ...(input.scheduleAt ? { scheduleAt: input.scheduleAt } : {}),
      });

      await this.port.setVariantApproved(input.variantId, postId);

      return ok({ postId });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ApproveVariantOutput, UseCaseError> = ok({ postId: "" });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to approve variant",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
