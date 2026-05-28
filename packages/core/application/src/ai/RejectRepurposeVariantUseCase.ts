/**
 * @file RejectRepurposeVariantUseCase.ts
 * @description Rejects a repurpose variant. If all variants in the proposal
 *              are rejected, marks the proposal as rejected too.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface RejectVariantInput {
  variantId: string;
  accountId: string;
}

export interface RejectVariantPort {
  loadVariant(variantId: string): Promise<{
    id: string;
    proposalId: string;
    status: string;
    proposal: { accountId: string };
  } | null>;
  setVariantRejected(variantId: string): Promise<void>;
  allVariantsRejected(proposalId: string): Promise<boolean>;
  setProposalRejected(proposalId: string): Promise<void>;
}

export class RejectRepurposeVariantUseCase implements UseCase<
  RejectVariantInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly port: RejectVariantPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: RejectVariantInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const variant = await this.port.loadVariant(input.variantId);
      if (!variant) {
        return err(new UseCaseError("Variant not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      if (variant.proposal.accountId !== input.accountId) {
        return err(new UseCaseError("Access denied", USE_CASE_ERRORS.FORBIDDEN));
      }

      await this.port.setVariantRejected(input.variantId);

      const allRejected = await this.port.allVariantsRejected(variant.proposalId);
      if (allRejected) {
        await this.port.setProposalRejected(variant.proposalId);
      }

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
          "Failed to reject variant",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
