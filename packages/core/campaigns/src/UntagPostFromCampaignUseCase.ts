/**
 * @file UntagPostFromCampaignUseCase.ts
 * @description Removes a post's association with a campaign. Resolves the parent
 *   campaign through the guard-scoped repository BEFORE deleting the join row,
 *   so a foreign or missing campaign resolves to NOT_FOUND and the owner's
 *   `campaignPost` join row is never touched. The join table carries no
 *   accountId column, so guard enrollment alone does not close this path.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import { CampaignId } from "@core/domain/value-objects/EntityId.js";
import { type CampaignPostInput } from "./types.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @class UntagPostFromCampaignUseCase
 * @description Removes the association between a post and a campaign.
 */
export class UntagPostFromCampaignUseCase implements UseCase<
  CampaignPostInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Removes a post from the specified campaign.
   * @param input - Contains campaignId and postId to disassociate
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: CampaignPostInput): Promise<Result<void, UseCaseError>> {
    const campaignIdResult = CampaignId.fromString(input.campaignId);
    if (!campaignIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid campaignId: ${input.campaignId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          campaignIdResult.error
        )
      );
    }

    if (!input.postId || input.postId.trim().length === 0) {
      return err(new UseCaseError("Post ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Verify the campaign resolves under the caller's tenant context before
    // touching the join table. The guard scopes this findById to the caller's
    // account, so a foreign/missing campaign returns NOT_FOUND here and
    // `removePost` never runs — the owner's join row survives.
    const findResult = await this.campaignRepository.findById(campaignIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    // Remove post association (atomically via UoW when available)
    const persist = async (): Promise<Result<void, UseCaseError>> => {
      const removeResult = await this.campaignRepository.removePost(
        campaignIdResult.value,
        input.postId.trim()
      );
      if (!removeResult.ok) {
        return err(
          new UseCaseError(
            "Failed to untag post from campaign",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            removeResult.error
          )
        );
      }
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await persist();
        });
        return result;
      }
      return await persist();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to untag post from campaign",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
